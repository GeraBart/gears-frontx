// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { findTemplateDirs, loadCliModule, runCli } from './validate-templates.mjs';

let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-validate-templates-'));
  return rootDir;
}

function validManifest(overrides = {}) {
  return JSON.stringify({
    name: 'tpl',
    version: '1.0.0',
    ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    ...overrides,
  });
}

describe('findTemplateDirs', () => {
  // A5 review finding: a template is discovered by its manifest
  // (`frontx-template.json`, ADR-0018), never by a `template-*` name prefix —
  // location- and name-independent, so a #470-renamed/relocated template is
  // still found.
  it('finds every top-level directory carrying frontx-template.json, regardless of its name', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    await mkdir(path.join(root, 'a-renamed-template'), { recursive: true });
    await writeFile(path.join(root, 'a-renamed-template', 'frontx-template.json'), validManifest());
    await mkdir(path.join(root, 'packages'), { recursive: true }); // no manifest — not a template

    const dirs = findTemplateDirs(root, 'frontx-template.json').map((d) => path.basename(d)).sort();

    expect(dirs).toEqual(['a-renamed-template', 'template-shell']);
  });

  it('ignores a directory named template-* that carries no manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-empty'), { recursive: true });

    expect(findTemplateDirs(root, 'frontx-template.json')).toEqual([]);
  });

  it('ignores node_modules even if it somehow carries a manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules', 'something'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'something', 'frontx-template.json'), validManifest());

    expect(findTemplateDirs(root, 'frontx-template.json')).toEqual([]);
  });

  // CodeRabbit review finding on #493: excluding every dot-prefixed
  // directory from discovery reintroduces a location assumption the
  // manifest-presence principle (A5 round) exists to drop. node_modules is
  // the one true exclusion; a dot-prefixed directory carrying a real
  // manifest IS a template.
  it('does NOT ignore a dot-prefixed top-level directory that carries a manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, '.hidden-template'), { recursive: true });
    await writeFile(path.join(root, '.hidden-template', 'frontx-template.json'), validManifest());

    expect(findTemplateDirs(root, 'frontx-template.json').map((d) => path.basename(d))).toEqual(['.hidden-template']);
  });

  it('respects the manifest filename passed in, independent of any real CLI constant', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'a-different-manifest-name.json'), validManifest());

    expect(findTemplateDirs(root, 'frontx-template.json')).toEqual([]);
    expect(findTemplateDirs(root, 'a-different-manifest-name.json').map((d) => path.basename(d))).toEqual(['template-shell']);
  });
});

describe('runCli', () => {
  it('passes when every template directory validates', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    const logs = [];

    const exitCode = await runCli({ rootDir: root, log: (line) => logs.push(line) });

    expect(exitCode).toBe(0);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-shell'))).toBe(true);
  });

  it('fails when one template directory fails validation, and still checks the rest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-mfe'), { recursive: true });
    await writeFile(path.join(root, 'template-mfe', 'frontx-template.json'), JSON.stringify({}));
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    const logs = [];
    const errors = [];

    const exitCode = await runCli({ rootDir: root, log: (l) => logs.push(l), logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('FAIL') && l.includes('template-mfe'))).toBe(true);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-shell'))).toBe(true);
  });

  it('fails when a template carries a content self-containment violation', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(
      path.join(root, 'template-shell', 'frontx-template.json'),
      validManifest({ ownershipBoundaries: { exclusiveSubtrees: ['package.json'], sharedFiles: [] } }),
    );
    await writeFile(
      path.join(root, 'template-shell', 'package.json'),
      JSON.stringify({ dependencies: { '@gears-frontx/api': 'file:../../packages/api' } }),
    );
    const errors = [];

    const exitCode = await runCli({ rootDir: root, logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('not self-contained'))).toBe(true);
  });

  // A5 review finding: zero templates found must never be a silent pass —
  // it means discovery is broken (wrong root, renamed manifest) or every
  // template vanished, either of which needs a human's attention.
  it('fails loudly, not vacuously, when no template is found', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'packages'), { recursive: true }); // no manifest anywhere
    const errors = [];

    const exitCode = await runCli({ rootDir: root, logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('no template found'))).toBe(true);
  });

  // #492 review finding 3 ("confusing module-resolution error instead of a
  // clear message"), reproduced here for @gears-frontx/cli: a fresh clone or
  // a `clean:artifacts` run leaves packages/cli/dist missing, and a plain
  // `import('@gears-frontx/cli')` would throw node's raw ERR_MODULE_NOT_FOUND.
  // `loadCliModule` is injected here rather than actually deleting dist/,
  // which would make this test destructive to every other suite sharing the
  // built package.
  it('fails with a clear, actionable message — not a raw stack trace — when the CLI build is missing', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-shell'), { recursive: true });
    await writeFile(path.join(root, 'template-shell', 'frontx-template.json'), validManifest());
    const errors = [];

    const exitCode = await runCli({
      rootDir: root,
      logError: (l) => errors.push(l),
      loadCliModule: async () => ({
        ok: false,
        message: 'built @gears-frontx/cli not found (packages/cli/dist is missing) — run `npm run build:packages:cli` first.',
      }),
    });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('run `npm run build:packages:cli` first'))).toBe(true);
  });
});

describe('loadCliModule', () => {
  it('returns the loaded module on success', async () => {
    const fakeModule = { MANIFEST_FILENAME: 'frontx-template.json' };
    const result = await loadCliModule(async () => fakeModule);

    expect(result).toEqual({ ok: true, module: fakeModule });
  });

  it('maps ERR_MODULE_NOT_FOUND to a clear, actionable message instead of the raw error', async () => {
    const moduleNotFound = Object.assign(new Error("Cannot find module '@gears-frontx/cli'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    const result = await loadCliModule(async () => {
      throw moduleNotFound;
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('run `npm run build:packages:cli` first');
  });

  it('rethrows any other import error unchanged — only a missing build gets the friendly message', async () => {
    const otherError = new Error('unexpected syntax error in dist/index.js');

    await expect(loadCliModule(async () => {
      throw otherError;
    })).rejects.toThrow(otherError);
  });
});
