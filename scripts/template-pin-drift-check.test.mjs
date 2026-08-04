// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ecosystemScopeMatcher } from './template-ecosystem-packages.mjs';
import {
  findDriftedSites,
  findEcosystemPinSites,
  findUnverifiableSites,
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

// A minimal marker manifest - discovery only checks for the file's presence
// (`findTemplateDirs`), never its content.
async function writeManifest(templateDir) {
  await writeJson(path.join(templateDir, 'frontx-template.json'), {});
}

async function writeEcosystemPackages(root, versions = {}) {
  for (const dir of ['api', 'mfes', 'gts-plugin']) {
    await writeJson(path.join(root, 'packages', dir, 'package.json'), {
      name: `@gears-frontx/${dir}`,
      version: versions[dir] ?? '0.3.0-alpha.0',
    });
  }
}

const isEcosystemScopeName = ecosystemScopeMatcher(['@gears-frontx/api']);

/** Runs the guard with its output captured, so a case can assert what it named. */
function run(root) {
  const lines = [];
  const record = (line) => lines.push(line);
  const exitCode = runCli({ rootDir: root, log: record, logError: record });
  return { exitCode, output: lines.join('\n') };
}

// Reviewer ask on #492 (gs-layer): the templates are not the only place an exact
// ecosystem pin lives. `packages/gts-plugin` runtime-depends on
// `@gears-frontx/mfes` at an exact version, and a bump that misses it makes npm
// install two MFE runtime copies into one tree.
describe('findEcosystemPinSites', () => {
  it('finds the exact mfes pin inside gts-plugin\'s own dependencies', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'gts-plugin', 'package.json'), {
      name: '@gears-frontx/gts-plugin',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' },
    });

    expect(findEcosystemPinSites(root, isEcosystemScopeName)).toEqual([
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

    expect(findEcosystemPinSites(root, isEcosystemScopeName)).toEqual([]);
  });

  it('scans every packages/* manifest, not only the ones that are a version truth', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'telemetry', 'package.json'), {
      name: '@gears-frontx/telemetry',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.2.0' },
    });

    expect(findEcosystemPinSites(root, isEcosystemScopeName)).toContainEqual({
      file: path.join('packages', 'telemetry', 'package.json'),
      field: 'dependencies',
      packageName: '@gears-frontx/mfes',
      pinnedVersion: '0.2.0',
    });
  });

  it('skips a packages/* directory that carries no manifest at all', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await mkdir(path.join(root, 'packages', 'not-a-package'), { recursive: true });

    expect(() => findEcosystemPinSites(root, isEcosystemScopeName)).not.toThrow();
  });

  it('fails closed when a manifest that IS there cannot be parsed, rather than reporting no pins', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeFile(path.join(root, 'packages', 'mfes', 'package.json'), '{ broken');

    expect(() => findEcosystemPinSites(root, isEcosystemScopeName)).toThrow(/cannot parse/);
  });
});

describe('findDriftedSites', () => {
  const site = { file: 'package.json', field: 'dependencies', packageName: '@gears-frontx/api', pinnedVersion: '0.3.0-alpha.0' };

  it('flags a pinned site whose version no longer matches the ecosystem truth', () => {
    expect(findDriftedSites([site], { '@gears-frontx/api': '0.4.0-alpha.0' })).toEqual([
      { ...site, actualVersion: '0.4.0-alpha.0' },
    ]);
  });

  it('does not flag a pinned site that matches the ecosystem truth', () => {
    expect(findDriftedSites([site], { '@gears-frontx/api': '0.3.0-alpha.0' })).toEqual([]);
  });
});

// The classification that lets `findDriftedSites` stay as simple as it is: "no
// truth entry" is indistinguishable from "matches" to a comparison, so a name
// that leaves `packages/` would otherwise take every pin on it out of the check.
describe('findUnverifiableSites', () => {
  const site = { file: 'package.json', field: 'dependencies', packageName: '@gears-frontx/ghost', pinnedVersion: '1.0.0' };

  it('flags an ecosystem-scope pin with no truth entry and no local definition', () => {
    expect(findUnverifiableSites([site], {}, new Set())).toEqual([site]);
  });

  it('does not flag a pin the scanned tree defines itself - npm resolves it through a workspace', () => {
    expect(findUnverifiableSites([site], {}, new Set(['@gears-frontx/ghost']))).toEqual([]);
  });

  it('does not flag a pin that has a truth entry, drifted or not', () => {
    expect(findUnverifiableSites([site], { '@gears-frontx/ghost': '2.0.0' }, new Set())).toEqual([]);
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

    expect(run(root).exitCode).toBe(0);
  });

  it('fails when a template pin has drifted from the ecosystem\'s actual version', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { api: '0.4.0-alpha.0' });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'packages', 'framework', 'package.json'), {
      devDependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
    });

    expect(run(root).exitCode).toBe(1);
  });

  it('catches a drifted site nested arbitrarily deep, e.g. an MFE fixture package', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { mfes: '0.4.0-alpha.0' });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(
      path.join(root, 'template-shell', 'src-app', 'mfe_packages', 'widgets-fixture-a', 'package.json'),
      { dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' } },
    );

    expect(run(root).exitCode).toBe(1);
  });

  // The regression the review of this branch asked for by name. `newpkg` is in
  // no list anywhere: not in this script, not in a shared constant, not in a
  // fixture helper. Discovery has to come from the manifests alone.
  it('discovers a newly introduced ecosystem package pin without any central list being edited', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'newpkg', 'package.json'), {
      name: '@gears-frontx/newpkg',
      version: '0.5.0-alpha.1',
    });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      dependencies: { '@gears-frontx/newpkg': '0.5.0-alpha.0' },
    });

    const { exitCode, output } = run(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('@gears-frontx/newpkg');
    expect(output).toContain('pinned 0.5.0-alpha.0, actual 0.5.0-alpha.1');
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

    expect(run(root).exitCode).toBe(1);
  });

  // #496 added `packages/telemetry` mid-review. This case exists to prove the
  // check REACHES the ecosystem scan - it declares a template so the earlier
  // no-template guard cannot be what returns 1, and asserts on the site the
  // scan names.
  it('reports a drifted pin declared by a packages/* manifest that is not itself a version truth', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'telemetry', 'package.json'), {
      name: '@gears-frontx/telemetry',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.2.0' },
    });
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      dependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
    });

    const { exitCode, output } = run(root);

    expect(exitCode).toBe(1);
    expect(output).toContain(path.join('packages', 'telemetry', 'package.json'));
    expect(output).toContain('pinned 0.2.0, actual 0.3.0-alpha.0');
  });

  // A5 review finding: zero templates found must never be a silent pass.
  it('fails loudly, not vacuously, when no template is found', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    // No frontx-template.json anywhere - discovery must find nothing.

    const { exitCode, output } = run(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('no template found');
  });

  // Review finding on #493: a malformed manifest used to count as zero pins.
  // It now aborts, and the abort has to reach the developer as this guard's own
  // failure with the file named - not as a node stack trace.
  it('exits 1 naming the file when a template manifest cannot be parsed', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeManifest(path.join(root, 'template-shell'));
    await writeFile(path.join(root, 'template-shell', 'package.json'), 'not-valid-json{{{');

    const { exitCode, output } = run(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('[template-pin-drift-check] FAIL:');
    expect(output).toContain(path.join('template-shell', 'package.json'));
  });

  it('exits 1 naming the file when an ecosystem manifest has no valid version', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), { name: '@gears-frontx/api' });
    await writeManifest(path.join(root, 'template-shell'));

    const { exitCode, output } = run(root);

    expect(exitCode).toBe(1);
    expect(output).toContain(path.join('packages', 'api', 'package.json'));
    expect(output).toContain('"version"');
  });

  // Deleting `packages/api/package.json` is what makes this rule load-bearing:
  // the name drops out of the truth map, and without the unverifiable-pin
  // classification every pin on it would quietly stop being compared.
  it('exits 1 naming the site when a pin names an ecosystem package this repo no longer publishes', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await rm(path.join(root, 'packages', 'api', 'package.json'));
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      dependencies: { '@gears-frontx/api': '0.3.0-alpha.0' },
    });

    const { exitCode, output } = run(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('cannot be verified');
    expect(output).toContain('@gears-frontx/api');
  });

  // template-shell is a workspace root whose members are `@gears-frontx/auth`,
  // `@gears-frontx/state` and friends: names in the ecosystem's own npm scope
  // that this repo's `packages/` deliberately does not publish. npm resolves
  // them through the workspace, so they have no registry version to drift from.
  it('does not report a pin on a package the template itself defines as a workspace member', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeManifest(path.join(root, 'template-shell'));
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      workspaces: ['packages/*'],
      dependencies: { '@gears-frontx/auth': '0.2.0-alpha.1' },
    });
    await writeJson(path.join(root, 'template-shell', 'packages', 'auth', 'package.json'), {
      name: '@gears-frontx/auth',
      version: '0.2.0-alpha.1',
    });

    expect(run(root).exitCode).toBe(0);
  });

  it('does not report a pin on a name the monorepo defines outside packages/, e.g. an internal/* workspace', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), { name: 'gears-frontx', workspaces: ['packages/*', 'internal/*'] });
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'internal', 'eslint-config', 'package.json'), {
      name: '@gears-frontx/eslint-config',
      version: '0.2.0-alpha.0',
    });
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.0',
      devDependencies: { '@gears-frontx/eslint-config': '0.2.0-alpha.0' },
    });
    await writeManifest(path.join(root, 'template-shell'));

    expect(run(root).exitCode).toBe(0);
  });
});
