// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPENDENCY_FIELDS,
  MANIFEST_FILENAME,
  findDriftedSites,
  findEcosystemPinSites,
  findPackageJsonFiles,
  findPinSites,
  findTemplateDirs,
  isExactRegistryVersionPin,
  readEcosystemTruthVersions,
  runCli,
} from './template-pin-drift-check.mjs';

let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-pin-drift-'));
  return rootDir;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

// A minimal marker manifest — discovery only checks for the file's
// presence (`findTemplateDirs`), never its content.
async function writeManifest(templateDir) {
  await writeJson(path.join(templateDir, 'frontx-template.json'), {});
}

async function writeEcosystemPackages(root, versions = {}) {
  await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
    name: '@gears-frontx/api',
    version: versions.api ?? '0.3.0-alpha.0',
  });
  await writeJson(path.join(root, 'packages', 'mfes', 'package.json'), {
    name: '@gears-frontx/mfes',
    version: versions.mfes ?? '0.3.0-alpha.0',
  });
  await writeJson(path.join(root, 'packages', 'gts-plugin', 'package.json'), {
    name: '@gears-frontx/gts-plugin',
    version: versions['gts-plugin'] ?? '0.3.0-alpha.0',
  });
}

describe('readEcosystemTruthVersions', () => {
  it('reads the actual on-disk version of the three template-pinned ecosystem packages', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { api: '0.4.0-alpha.1' });

    const truth = readEcosystemTruthVersions(root);

    expect(truth).toEqual({
      '@gears-frontx/api': '0.4.0-alpha.1',
      '@gears-frontx/mfes': '0.3.0-alpha.0',
      '@gears-frontx/gts-plugin': '0.3.0-alpha.0',
    });
  });

  // CodeRabbit review finding on #493: an undefined/empty `name` or
  // `version` must fail CLOSED, not silently poison the truth map. A missing
  // `name` would key the truth entry as the literal string "undefined" and
  // leave the real package with NO entry at all — `findDriftedSites` treats
  // "no entry" as "not drifted", so every pinned site for that package would
  // silently stop being checked.
  it('throws, naming the offending file, when an ecosystem package.json has no valid "name"', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), { version: '0.3.0-alpha.0' });

    expect(() => readEcosystemTruthVersions(root)).toThrow(/packages[/\\]api[/\\]package\.json.*"name"/);
  });

  it('throws, naming the offending file, when an ecosystem package.json has no valid "version"', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'mfes', 'package.json'), { name: '@gears-frontx/mfes', version: '' });

    expect(() => readEcosystemTruthVersions(root)).toThrow(/packages[/\\]mfes[/\\]package\.json.*"version"/);
  });

  // CodeRabbit review finding on #493: the read and the parse must fail
  // closed the same way a missing field does. Node's bare ENOENT/SyntaxError
  // names neither this guard nor (for the parse) anything actionable, so a
  // red build would read as a broken script rather than a broken manifest.
  it('throws, naming the offending file, when an ecosystem package.json is missing entirely', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await rm(path.join(root, 'packages', 'gts-plugin', 'package.json'));

    expect(() => readEcosystemTruthVersions(root)).toThrow(
      /cannot read .*packages[/\\]gts-plugin[/\\]package\.json/,
    );
  });

  it('throws, naming the offending file, when an ecosystem package.json is not valid JSON', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeFile(path.join(root, 'packages', 'api', 'package.json'), '{ "name": broken');

    expect(() => readEcosystemTruthVersions(root)).toThrow(
      /cannot parse .*packages[/\\]api[/\\]package\.json as JSON/,
    );
  });
});

// The guard's own truth about what it governs. `isExactPin` (the ecosystem
// version policy's helper) answers a DIFFERENT question — "does this range
// carry a range operator" — which a monorepo-local `file:` specifier also
// answers "no" to, so reusing it made every `file:../../../packages/mfes` in
// template-mfe report as a pinned site drifted from a version it never
// expressed.
describe('isExactRegistryVersionPin', () => {
  it('accepts a bare exact registry version, prerelease included', () => {
    expect(isExactRegistryVersionPin('0.3.0-alpha.1')).toBe(true);
    expect(isExactRegistryVersionPin('1.2.3')).toBe(true);
  });

  it('rejects a local-path or protocol specifier, which expresses no version at all', () => {
    expect(isExactRegistryVersionPin('file:../../../packages/mfes')).toBe(false);
    expect(isExactRegistryVersionPin('link:../mfes')).toBe(false);
    expect(isExactRegistryVersionPin('workspace:*')).toBe(false);
    expect(isExactRegistryVersionPin('git+https://example.com/x.git')).toBe(false);
  });

  it('rejects a range — that is the ecosystem edge-compatibility policy\'s concern', () => {
    expect(isExactRegistryVersionPin('^0.3.0')).toBe(false);
    expect(isExactRegistryVersionPin('*')).toBe(false);
    expect(isExactRegistryVersionPin('>=0.2.0-0')).toBe(false);
  });
});

describe('findPackageJsonFiles / findTemplateDirs', () => {
  it('finds every package.json under a directory, skipping node_modules', async () => {
    const root = await makeRoot();
    const templateDir = path.join(root, 'template-shell');
    await writeJson(path.join(templateDir, 'package.json'), { name: 'tpl' });
    await writeJson(path.join(templateDir, 'packages', 'framework', 'package.json'), { name: 'framework' });
    await writeJson(path.join(templateDir, 'node_modules', 'some-dep', 'package.json'), { name: 'some-dep' });

    const files = findPackageJsonFiles(templateDir).map((f) => path.relative(templateDir, f)).sort();

    expect(files).toEqual(['package.json', 'packages/framework/package.json']);
  });

  // CodeRabbit review finding on #493: a pinned dependency site inside a
  // hidden directory is exactly as real as one anywhere else — skipping
  // dot-prefixed directories would silently stop checking it, the same
  // completeness hole found in `createFsListContentOwnedFilesFn`.
  it('does NOT skip a package.json nested under a dot-prefixed directory', async () => {
    const root = await makeRoot();
    const templateDir = path.join(root, 'template-shell');
    await writeJson(path.join(templateDir, '.hidden-workspace', 'package.json'), { name: 'hidden' });

    const files = findPackageJsonFiles(templateDir).map((f) => path.relative(templateDir, f)).sort();

    expect(files).toEqual(['.hidden-workspace/package.json']);
  });

  // A5 review finding: discovery is by manifest presence (ADR-0018), never
  // by a `template-*` name prefix — location- and name-independent.
  it('finds every top-level directory carrying frontx-template.json, regardless of its name', async () => {
    const root = await makeRoot();
    await writeManifest(path.join(root, 'template-shell'));
    await writeManifest(path.join(root, 'a-renamed-template'));
    await mkdir(path.join(root, 'packages'), { recursive: true }); // no manifest — not a template

    const dirs = findTemplateDirs(root).map((d) => path.basename(d)).sort();

    expect(dirs).toEqual(['a-renamed-template', 'template-shell']);
  });

  it('ignores a directory named template-* that carries no manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-empty'), { recursive: true });

    expect(findTemplateDirs(root)).toEqual([]);
  });

  it('ignores node_modules even if it somehow carries a manifest', async () => {
    const root = await makeRoot();
    await writeManifest(path.join(root, 'node_modules', 'something'));

    expect(findTemplateDirs(root)).toEqual([]);
  });

  // CodeRabbit review finding on #493: matches validate-templates.mjs's
  // same node_modules-only exclusion rule.
  it('does NOT ignore a dot-prefixed top-level directory that carries a manifest', async () => {
    const root = await makeRoot();
    await writeManifest(path.join(root, '.hidden-template'));

    expect(findTemplateDirs(root).map((d) => path.basename(d))).toEqual(['.hidden-template']);
  });
});

describe('findPinSites', () => {
  const governed = ['@gears-frontx/api', '@gears-frontx/mfes', '@gears-frontx/gts-plugin'];

  it('finds an exact-pinned governed dependency across dependencies/devDependencies', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), {
      dependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
      devDependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' },
    });

    const sites = findPinSites(root, governed);

    expect(sites).toHaveLength(2);
    expect(sites.map((s) => s.packageName).sort()).toEqual(['@gears-frontx/api', '@gears-frontx/mfes']);
  });

  it('ignores a range (non-exact-pin) declaration — that is the ecosystem edge-compatibility policy\'s concern, not this one', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), {
      peerDependencies: { '@gears-frontx/gts-plugin': '^0.3.0-alpha.0' },
      dependencies: { '@gears-frontx/api': '*' },
    });

    const sites = findPinSites(root, governed);

    expect(sites).toHaveLength(0);
  });

  // template-mfe's MFE fixtures declare exactly this shape. Reading it as a
  // pinned site produced a nonsense report ("pinned file:../../../packages/mfes,
  // actual 0.3.0-alpha.1") for a declaration that names no version.
  it('ignores a monorepo-local file: specifier — it expresses a path, not a pinned version', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), {
      devDependencies: {
        '@gears-frontx/mfes': 'file:../../../packages/mfes',
        '@gears-frontx/api': 'file:../../../packages/api',
      },
    });

    expect(findPinSites(root, governed)).toHaveLength(0);
  });

  it('ignores a package.json naming an ungoverned package', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), { dependencies: { react: '19.2.4' } });

    const sites = findPinSites(root, governed);

    expect(sites).toHaveLength(0);
  });

  it('skips a malformed package.json rather than throwing', async () => {
    const root = await makeRoot();
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'package.json'), 'not-valid-json{{{');

    expect(() => findPinSites(root, governed)).not.toThrow();
    expect(findPinSites(root, governed)).toHaveLength(0);
  });
});

// Reviewer ask on #492 (gs-layer): the templates are not the only place an
// exact ecosystem pin lives. `packages/gts-plugin` runtime-depends on
// `@gears-frontx/mfes` at an exact version, and a bump that misses it makes
// npm install two MFE runtime copies into one tree.
describe('findEcosystemPinSites', () => {
  const governed = ['@gears-frontx/api', '@gears-frontx/mfes', '@gears-frontx/gts-plugin'];

  it('finds the exact mfes pin inside gts-plugin\'s own dependencies', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'gts-plugin', 'package.json'), {
      name: '@gears-frontx/gts-plugin',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' },
    });

    const sites = findEcosystemPinSites(root, governed);

    expect(sites).toEqual([
      {
        file: path.join('packages', 'gts-plugin', 'package.json'),
        field: 'dependencies',
        packageName: '@gears-frontx/mfes',
        pinnedVersion: '0.3.0-alpha.0',
      },
    ]);
  });

  it('does not report a governed package pinning itself', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'mfes', 'package.json'), {
      name: '@gears-frontx/mfes',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' },
    });

    expect(findEcosystemPinSites(root, governed)).toEqual([]);
  });

  it('fails closed when a governed manifest cannot be read, rather than reporting no pins', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await rm(path.join(root, 'packages', 'mfes', 'package.json'));

    expect(() => findEcosystemPinSites(root, governed)).toThrow(/cannot read/);
  });
});

describe('findDriftedSites', () => {
  it('flags a pinned site whose version no longer matches the ecosystem truth', () => {
    const sites = [{ file: 'package.json', field: 'dependencies', packageName: '@gears-frontx/api', pinnedVersion: '0.3.0-alpha.0' }];
    const truth = { '@gears-frontx/api': '0.4.0-alpha.0' };

    const drifted = findDriftedSites(sites, truth);

    expect(drifted).toEqual([{ ...sites[0], actualVersion: '0.4.0-alpha.0' }]);
  });

  it('does not flag a pinned site that matches the ecosystem truth', () => {
    const sites = [{ file: 'package.json', field: 'dependencies', packageName: '@gears-frontx/api', pinnedVersion: '0.3.0-alpha.0' }];
    const truth = { '@gears-frontx/api': '0.3.0-alpha.0' };

    expect(findDriftedSites(sites, truth)).toEqual([]);
  });
});

describe('runCli', () => {
  it('passes when every pinned site across every template matches the ecosystem truth', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      dependencies: {
        '@gears-frontx/api': '0.3.0-alpha.0',
        '@gears-frontx/mfes': '0.3.0-alpha.0',
        '@gears-frontx/gts-plugin': '0.3.0-alpha.0',
      },
    });

    expect(runCli({ rootDir: root })).toBe(0);
  });

  it('fails when a template pin has drifted from the ecosystem\'s actual version', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { api: '0.4.0-alpha.0' });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'packages', 'framework', 'package.json'), {
      devDependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
    });

    expect(runCli({ rootDir: root })).toBe(1);
  });

  it('catches a drifted site nested arbitrarily deep, e.g. an MFE fixture package', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { mfes: '0.4.0-alpha.0' });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(
      path.join(root, 'template-shell', 'src-app', 'mfe_packages', 'widgets-fixture-a', 'package.json'),
      { dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' } },
    );

    expect(runCli({ rootDir: root })).toBe(1);
  });

  it('fails when the ecosystem\'s own intra-ecosystem pin has drifted, even with every template clean', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { mfes: '0.3.0-alpha.1' });
    await writeJson(path.join(root, 'packages', 'gts-plugin', 'package.json'), {
      name: '@gears-frontx/gts-plugin',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' },
    });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      dependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
    });

    expect(runCli({ rootDir: root })).toBe(1);
  });

  // A5 review finding: zero templates found must never be a silent pass.
  it('fails loudly, not vacuously, when no template is found', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    // No frontx-template.json anywhere — discovery must find nothing.

    expect(runCli({ rootDir: root })).toBe(1);
  });
});

// #492 review finding 2's "unguarded duplicated literal" class, reproduced
// by this script itself: MANIFEST_FILENAME and DEPENDENCY_FIELDS are each
// deliberately kept as a local literal (not an import from `@gears-frontx/cli`
// or `validate-content-self-containment.ts`) so this script never depends on
// the CLI package being built. That's a real property worth keeping — but a
// duplicated literal that can silently drift needs a guard. These tests read
// the CANONICAL TypeScript source as text (never `import`ed — a `.ts` file
// isn't loadable by plain node, and importing the built `dist/` would
// reintroduce exactly the build dependency this script exists to avoid) and
// assert the local copy still matches.
describe('duplicated-literal sync guards (#492 review finding 2)', () => {
  function readCliSource(relativePath) {
    const sourcePath = fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
    return readFileSync(sourcePath, 'utf8');
  }

  it('MANIFEST_FILENAME stays in sync with the canonical export in packages/cli/src/manifest/types.ts', () => {
    const source = readCliSource('packages/cli/src/manifest/types.ts');
    const match = /export const MANIFEST_FILENAME = '([^']+)';/.exec(source);

    expect(match, 'canonical MANIFEST_FILENAME export not found — did types.ts change shape?').not.toBeNull();
    expect(MANIFEST_FILENAME).toBe(match[1]);
  });

  it('DEPENDENCY_FIELDS stays in sync with validate-content-self-containment.ts', () => {
    const source = readCliSource('packages/cli/src/manifest/validate-content-self-containment.ts');
    const match = /const DEPENDENCY_FIELDS = (\[[^\]]*\])/.exec(source);

    expect(match, 'canonical DEPENDENCY_FIELDS declaration not found — did the algorithm module change shape?').not.toBeNull();
    const canonicalFields = JSON.parse(match[1].replace(/'/g, '"'));
    expect(DEPENDENCY_FIELDS).toEqual(canonicalFields);
  });
});
