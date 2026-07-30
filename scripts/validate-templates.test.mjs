// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { findTemplateDirs, runCli } from './validate-templates.mjs';

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
    await mkdir(path.join(root, 'template-standard'), { recursive: true });
    await writeFile(path.join(root, 'template-standard', 'frontx-template.json'), validManifest());
    await mkdir(path.join(root, 'a-renamed-template'), { recursive: true });
    await writeFile(path.join(root, 'a-renamed-template', 'frontx-template.json'), validManifest());
    await mkdir(path.join(root, 'packages'), { recursive: true }); // no manifest — not a template

    const dirs = findTemplateDirs(root).map((d) => path.basename(d)).sort();

    expect(dirs).toEqual(['a-renamed-template', 'template-standard']);
  });

  it('ignores a directory named template-* that carries no manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-empty'), { recursive: true });

    expect(findTemplateDirs(root)).toEqual([]);
  });

  it('ignores node_modules and dot-prefixed directories even if they somehow carry a manifest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules', 'something'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'something', 'frontx-template.json'), validManifest());
    await mkdir(path.join(root, '.hidden'), { recursive: true });
    await writeFile(path.join(root, '.hidden', 'frontx-template.json'), validManifest());

    expect(findTemplateDirs(root)).toEqual([]);
  });
});

describe('runCli', () => {
  it('passes when every template directory validates', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-standard'), { recursive: true });
    await writeFile(path.join(root, 'template-standard', 'frontx-template.json'), validManifest());
    const logs = [];

    const exitCode = await runCli({ rootDir: root, log: (line) => logs.push(line) });

    expect(exitCode).toBe(0);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-standard'))).toBe(true);
  });

  it('fails when one template directory fails validation, and still checks the rest', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-mfe'), { recursive: true });
    await writeFile(path.join(root, 'template-mfe', 'frontx-template.json'), JSON.stringify({}));
    await mkdir(path.join(root, 'template-standard'), { recursive: true });
    await writeFile(path.join(root, 'template-standard', 'frontx-template.json'), validManifest());
    const logs = [];
    const errors = [];

    const exitCode = await runCli({ rootDir: root, log: (l) => logs.push(l), logError: (l) => errors.push(l) });

    expect(exitCode).toBe(1);
    expect(errors.some((l) => l.includes('FAIL') && l.includes('template-mfe'))).toBe(true);
    expect(logs.some((l) => l.includes('PASS') && l.includes('template-standard'))).toBe(true);
  });

  it('fails when a template carries a content self-containment violation', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'template-standard'), { recursive: true });
    await writeFile(
      path.join(root, 'template-standard', 'frontx-template.json'),
      validManifest({ ownershipBoundaries: { exclusiveSubtrees: ['package.json'], sharedFiles: [] } }),
    );
    await writeFile(
      path.join(root, 'template-standard', 'package.json'),
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
});
