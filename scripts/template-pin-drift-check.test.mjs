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
  findPackageJsonFiles,
  findPinSites,
  findTemplateDirs,
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
});

describe('findPackageJsonFiles / findTemplateDirs', () => {
  it('finds every package.json under a directory, skipping node_modules and dot-dirs', async () => {
    const root = await makeRoot();
    const templateDir = path.join(root, 'template-standard');
    await writeJson(path.join(templateDir, 'package.json'), { name: 'tpl' });
    await writeJson(path.join(templateDir, 'packages', 'framework', 'package.json'), { name: 'framework' });
    await writeJson(path.join(templateDir, 'node_modules', 'some-dep', 'package.json'), { name: 'some-dep' });
    await writeJson(path.join(templateDir, '.turbo', 'package.json'), { name: 'ignored' });

    const files = findPackageJsonFiles(templateDir).map((f) => path.relative(templateDir, f)).sort();

    expect(files).toEqual(['package.json', 'packages/framework/package.json']);
  });

  // A5 review finding: discovery is by manifest presence (ADR-0018), never
  // by a `template-*` name prefix — location- and name-independent.
  it('finds every top-level directory carrying frontx-template.json, regardless of its name', async () => {
    const root = await makeRoot();
    await writeManifest(path.join(root, 'template-standard'));
    await writeManifest(path.join(root, 'a-renamed-template'));
    await mkdir(path.join(root, 'packages'), { recursive: true }); // no manifest — not a template

    const dirs = findTemplateDirs(root).map((d) => path.basename(d)).sort();

    expect(dirs).toEqual(['a-renamed-template', 'template-standard']);
  });

  it('ignores a directory named template-* that carries no manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-empty'), { recursive: true });

    expect(findTemplateDirs(root)).toEqual([]);
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
    await writeManifest(path.join(root, 'template-standard'));
    await writeJson(path.join(root, 'template-standard', 'package.json'), {
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
    await writeManifest(path.join(root, 'template-standard'));
    await writeJson(path.join(root, 'template-standard', 'packages', 'framework', 'package.json'), {
      devDependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
    });

    expect(runCli({ rootDir: root })).toBe(1);
  });

  it('catches a drifted site nested arbitrarily deep, e.g. an MFE fixture package', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { mfes: '0.4.0-alpha.0' });
    await writeManifest(path.join(root, 'template-standard'));
    await writeJson(
      path.join(root, 'template-standard', 'src-app', 'mfe_packages', 'widgets-fixture-a', 'package.json'),
      { dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' } },
    );

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
