// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsListSubtreeFilesFn } from '../fs-project-io';

// Real-fs coverage for the ONE adapter this ticket adds (#493): everything
// else in fs-project-io.ts is an existing, already-integration-tested thin
// wrapper (exercised end-to-end via cli.test.ts's fake-deps suite); this new
// walker earns its own fixture-backed test because its walk/skip rules are
// exactly what the pure content self-containment algorithm depends on.
describe('createFsListSubtreeFilesFn', () => {
  let templateDir: string;

  afterEach(async () => {
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
  });

  async function makeTemplate(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-list-subtree-'));
    templateDir = dir;
    return dir;
  }

  it('returns the single file when the subtree entry addresses a file directly', async () => {
    const dir = await makeTemplate();
    await writeFile(path.join(dir, 'package.json'), '{}');
    const listSubtreeFiles = createFsListSubtreeFilesFn();

    const files = await listSubtreeFiles(dir, 'package.json');

    expect(files).toEqual(['package.json']);
  });

  it('walks a directory subtree recursively, returning POSIX-relative paths', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', 'auth', 'src'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', 'auth', 'src', 'index.ts'), 'export {};');
    const listSubtreeFiles = createFsListSubtreeFilesFn();

    const files = await listSubtreeFiles(dir, 'packages');

    expect(files.sort()).toEqual(['packages/auth/package.json', 'packages/auth/src/index.ts']);
  });

  it('never descends into node_modules', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', 'auth', 'node_modules', 'some-dep'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', 'auth', 'node_modules', 'some-dep', 'package.json'), '{}');
    const listSubtreeFiles = createFsListSubtreeFilesFn();

    const files = await listSubtreeFiles(dir, 'packages');

    expect(files).toEqual(['packages/auth/package.json']);
  });

  it('never descends into a dot-prefixed directory found while walking', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', '.turbo'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', '.turbo', 'cache.json'), '{}');
    const listSubtreeFiles = createFsListSubtreeFilesFn();

    const files = await listSubtreeFiles(dir, 'packages');

    expect(files).toEqual(['packages/package.json']);
  });

  it("walks a subtree entry that is itself dot-prefixed (a template's own .frontx/ai bundle)", async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, '.frontx', 'ai', 'my-tpl'), { recursive: true });
    await writeFile(path.join(dir, '.frontx', 'ai', 'my-tpl', 'manifest.json'), '{}');
    const listSubtreeFiles = createFsListSubtreeFilesFn();

    const files = await listSubtreeFiles(dir, '.frontx/ai/my-tpl');

    expect(files).toEqual(['.frontx/ai/my-tpl/manifest.json']);
  });

  it('returns an empty list when the declared subtree entry does not exist on disk', async () => {
    const dir = await makeTemplate();
    const listSubtreeFiles = createFsListSubtreeFilesFn();

    const files = await listSubtreeFiles(dir, 'never-created');

    expect(files).toEqual([]);
  });
});
