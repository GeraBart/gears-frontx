// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
import { describe, it, expect } from 'vitest';
import { discoverExtensionBundleFromFs, type BundleFsReader } from '../fs-discovery.js';

/**
 * In-memory `BundleFsReader` for fully deterministic, disk-free scan tests.
 * `listDir` mirrors production `readdirSync` + directory-filter semantics:
 * it returns only DIRECTORY child names, never leaf file names, matching
 * `createFsBundleReader`'s real-fs behavior.
 */
function makeFakeReader(files: Record<string, string>): BundleFsReader {
  const dirChildren = new Map<string, Set<string>>();
  for (const filePath of Object.keys(files)) {
    const parts = filePath.split('/');
    // Every proper ancestor of the file's immediate parent is a directory
    // whose child (the next path segment) is itself also a directory.
    for (let i = 1; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i).join('/');
      const child = parts[i];
      if (!dirChildren.has(dir)) dirChildren.set(dir, new Set());
      dirChildren.get(dir)?.add(child);
    }
  }
  return {
    readFile(path: string): string | undefined {
      return files[path];
    },
    listDir(path: string): string[] | undefined {
      const children = dirChildren.get(path);
      return children ? Array.from(children) : undefined;
    },
  };
}

const CONTENT_ROOT = 'installed-templates/my-template';
const AI_ROOT = `${CONTENT_ROOT}/.frontx/ai`;

describe('discoverExtensionBundleFromFs (§1.5 AI-Extension Bundle Convention)', () => {
  it('reads the anchor, resolves conforming per-slot content, and feeds it as a bundle', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/extension.json`]: JSON.stringify({
        id: 'my-template-ai-bundle',
        contractVersion: '1.0.0',
        entries: [
          { id: 'skill-1', category: 'skills', path: 'skills/skill-1' },
          { id: 'workflow-1', category: 'workflows', path: 'workflows/workflow-1.md' },
          { id: 'guideline-1', category: 'guidelines', path: 'guidelines/guideline-1.md' },
          { id: 'ref-1', category: 'reference_artifacts', path: 'reference-artifacts/ref-1.yaml' },
        ],
      }),
      [`${AI_ROOT}/skills/skill-1/SKILL.md`]: '# Skill 1',
      [`${AI_ROOT}/workflows/workflow-1.md`]: '# Workflow 1',
      [`${AI_ROOT}/guidelines/guideline-1.md`]: '# Guideline 1',
      [`${AI_ROOT}/reference-artifacts/ref-1.yaml`]: 'key: value',
    });

    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);

    expect(result.structuralErrors).toHaveLength(0);
    expect(result.bundle).toHaveLength(4);
    expect(result.bundle).toContainEqual({ id: 'skill-1', category: 'skills', path: 'skills/skill-1' });
  });

  it('a bundle with no extension.json anchor yields a structural error and an empty bundle', () => {
    const reader = makeFakeReader({});
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.bundle).toHaveLength(0);
    expect(result.structuralErrors).toHaveLength(1);
    expect(result.structuralErrors[0].message).toMatch(/missing AI-extension bundle anchor/);
  });

  it('an unparseable anchor yields a structural error and an empty bundle', () => {
    const reader = makeFakeReader({ [`${AI_ROOT}/extension.json`]: '{not json' });
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.bundle).toHaveLength(0);
    expect(result.structuralErrors[0].message).toMatch(/not valid JSON/);
  });

  it('an identity-less anchor (missing "id") yields a structural error and an empty bundle', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/extension.json`]: JSON.stringify({ contractVersion: '1.0.0', entries: [] }),
    });
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.bundle).toHaveLength(0);
    expect(result.structuralErrors[0].message).toMatch(/missing a bundle identity/);
  });

  it('a subdirectory outside the four-slot closed set yields a "category outside the closed set" structural error', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/extension.json`]: JSON.stringify({ id: 'bundle', contractVersion: '1.0.0', entries: [] }),
      [`${AI_ROOT}/mocks/oob.md`]: 'oob content',
    });
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.structuralErrors).toHaveLength(1);
    expect(result.structuralErrors[0].message).toMatch(/outside the closed-set/);
  });

  it('a skill entry whose directory is missing SKILL.md is REJECTED, not silently skipped', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'broken-skill', category: 'skills', path: 'skills/broken-skill' }],
      }),
      [`${AI_ROOT}/skills/broken-skill/README.md`]: 'not a skill file',
    });
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.bundle).toHaveLength(0);
    expect(result.structuralErrors).toHaveLength(1);
    expect(result.structuralErrors[0].message).toMatch(/missing SKILL\.md/);
  });

  it('a malformed entry does not affect conforming entries from the same bundle', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [
          { id: 'broken-skill', category: 'skills', path: 'skills/broken-skill' },
          { id: 'ok-skill', category: 'skills', path: 'skills/ok-skill' },
        ],
      }),
      [`${AI_ROOT}/skills/ok-skill/SKILL.md`]: '# OK Skill',
    });
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.structuralErrors).toHaveLength(1);
    expect(result.bundle).toHaveLength(1);
    expect(result.bundle).toContainEqual({ id: 'ok-skill', category: 'skills', path: 'skills/ok-skill' });
  });

  it('an entry naming a category outside the closed set is a structural error, not a silent skip', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'oob-entry', category: 'mocks', path: 'mocks/oob-entry.md' }],
      }),
    });
    const result = discoverExtensionBundleFromFs(CONTENT_ROOT, reader);
    expect(result.bundle).toHaveLength(0);
    expect(result.structuralErrors[0].message).toMatch(/outside the closed set/);
  });
});
