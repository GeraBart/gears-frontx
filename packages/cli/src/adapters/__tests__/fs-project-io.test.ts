// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
import path from 'node:path';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsListContentOwnedFilesFn } from '../fs-project-io';

// Real-fs coverage for the ONE adapter this ticket adds (#493): everything
// else in fs-project-io.ts is an existing, already-integration-tested thin
// wrapper (exercised end-to-end via cli.test.ts's fake-deps suite); this new
// walker earns its own fixture-backed test because its walk/skip rules are
// exactly what the pure content self-containment algorithm depends on.
describe('createFsListContentOwnedFilesFn', () => {
  let templateDir: string;
  // A second root, outside the template, for the escaping-symlink cases.
  let outsideDir: string;

  afterEach(async () => {
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    outsideDir = '';
  });

  async function makeTemplate(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-list-subtree-'));
    templateDir = dir;
    return dir;
  }

  it('returns the single file when the subtree entry addresses a file directly', async () => {
    const dir = await makeTemplate();
    await writeFile(path.join(dir, 'package.json'), '{}');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'package.json');

    expect(files).toEqual(['package.json']);
  });

  it('walks a directory subtree recursively, returning POSIX-relative paths', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', 'auth', 'src'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', 'auth', 'src', 'index.ts'), 'export {};');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'packages');

    expect(files.sort()).toEqual(['packages/auth/package.json', 'packages/auth/src/index.ts']);
  });

  it('never descends into node_modules', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', 'auth', 'node_modules', 'some-dep'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', 'auth', 'node_modules', 'some-dep', 'package.json'), '{}');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'packages');

    expect(files).toEqual(['packages/auth/package.json']);
  });

  // CodeRabbit review finding on #493: skipping every dot-prefixed entry
  // opened a completeness hole in the exact guard this branch adds - a
  // carrier (`package.json`) nested under a hidden directory inside a
  // declared subtree went uninspected. `node_modules` is the only exclusion;
  // a dot-prefixed directory is ordinary template content and is walked.
  it('descends into a dot-prefixed directory found while walking, and includes files inside it', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', '.turbo'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', '.turbo', 'cache.json'), '{}');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'packages');

    expect(files.sort()).toEqual(['packages/.turbo/cache.json', 'packages/package.json']);
  });

  it('includes a dot-file directly (e.g. a template-shipped .gitignore) alongside ordinary files', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages'), { recursive: true });
    await writeFile(path.join(dir, 'packages', '.gitignore'), 'dist/\n');
    await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'packages');

    expect(files.sort()).toEqual(['packages/.gitignore', 'packages/package.json']);
  });

  it('inspects a carrier (package.json) nested under a dot-prefixed directory - the completeness hole this fix closes', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', '.hidden-workspace'), { recursive: true });
    await writeFile(path.join(dir, 'packages', '.hidden-workspace', 'package.json'), '{}');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'packages');

    expect(files).toEqual(['packages/.hidden-workspace/package.json']);
  });

  it("walks a subtree entry that is itself dot-prefixed (a template's own .frontx/ai bundle)", async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, '.frontx', 'ai', 'my-tpl'), { recursive: true });
    await writeFile(path.join(dir, '.frontx', 'ai', 'my-tpl', 'manifest.json'), '{}');
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, '.frontx/ai/my-tpl');

    expect(files).toEqual(['.frontx/ai/my-tpl/manifest.json']);
  });

  it('returns an empty list when the declared subtree entry does not exist on disk', async () => {
    const dir = await makeTemplate();
    const listContentOwnedFiles = createFsListContentOwnedFilesFn();

    const files = await listContentOwnedFiles(dir, 'never-created');

    expect(files).toEqual([]);
  });

  // CodeRabbit review finding on #493: `readdirSync(..., { withFileTypes: true })`
  // reports a symlink's OWN type, for which isDirectory() and isFile() are both
  // false - so every symlinked carrier fell through the walk and was never
  // inspected. What the link points at decides.
  describe('symlinks', () => {
    // A symlinked carrier is the whole point of the fix: this file WOULD have
    // been dropped from the enumeration, so its `file:` specifiers were never
    // checked for containment.
    it('includes a symlinked carrier file, resolving the link rather than skipping it', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'packages', 'real'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'real', 'package.json'), '{}');
      await symlink(
        path.join(dir, 'packages', 'real', 'package.json'),
        path.join(dir, 'packages', 'package.json'),
      );
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files.sort()).toEqual(['packages/package.json', 'packages/real/package.json']);
    });

    it('descends through a symlinked directory that stays inside the template', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'real-workspace'), { recursive: true });
      await writeFile(path.join(dir, 'real-workspace', 'package.json'), '{}');
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await symlink(path.join(dir, 'real-workspace'), path.join(dir, 'packages', 'linked'));
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files).toEqual(['packages/linked/package.json']);
    });

    // A link out of the template is the escape the whole check exists to catch.
    // Walking into it would report files that are not the template's content as
    // if they were.
    it('does NOT descend when a symlinked directory resolves outside the template', async () => {
      const dir = await makeTemplate();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-outside-'));
      await writeFile(path.join(outsideDir, 'package.json'), '{}');
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
      await symlink(outsideDir, path.join(dir, 'packages', 'escaping'));
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files).toEqual(['packages/package.json']);
    });

    it('does NOT include a symlinked file that resolves outside the template', async () => {
      const dir = await makeTemplate();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-outside-'));
      await writeFile(path.join(outsideDir, 'package.json'), '{}');
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await symlink(path.join(outsideDir, 'package.json'), path.join(dir, 'packages', 'package.json'));
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files).toEqual([]);
    });

    it('skips a broken symlink instead of throwing', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
      await symlink(path.join(dir, 'packages', 'gone'), path.join(dir, 'packages', 'dangling'));
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files).toEqual(['packages/package.json']);
    });

    // Only a symlink can make this walk cycle; without the visited-set the
    // link back to an ancestor recurses until the stack blows.
    it('terminates on a symlink cycle back to an ancestor directory', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'packages', 'auth'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
      await symlink(path.join(dir, 'packages'), path.join(dir, 'packages', 'auth', 'loop'));
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files).toEqual(['packages/auth/package.json']);
    });

    // The declared entry itself, not just something found while walking.
    it('returns an empty list when the declared subtree entry is a symlink out of the template', async () => {
      const dir = await makeTemplate();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-outside-'));
      await writeFile(path.join(outsideDir, 'package.json'), '{}');
      await symlink(outsideDir, path.join(dir, 'packages'));
      const listContentOwnedFiles = createFsListContentOwnedFilesFn();

      const files = await listContentOwnedFiles(dir, 'packages');

      expect(files).toEqual([]);
    });
  });
});
