import { describe, it, expect, vi } from 'vitest';
import { scaffoldComposedProject } from '../scaffold/composed.js';
import type { InventoryEntry } from '../inventory/types.js';
import { InventoryState } from '../inventory/types.js';

// Helper: build a minimal inventory entry with a serialized manifest.
function makeEntry(
  name: string,
  version: string,
  files: Array<{ path: string; content: string }>,
  compositions: Array<{ ref: string }> = [],
): InventoryEntry {
  const manifest = {
    name,
    version,
    ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
    files,
    referencedTemplates: compositions.map((c) => ({ ref: c.ref, appliedAt: '.' })),
  };
  return {
    name,
    source: `local:${name}`,
    ref: version,
    status: InventoryState.INSTALLED,
    content: JSON.stringify(manifest),
  };
}

// (a) Single scaffold operation delivers all manifest-declared MFEs
describe('scaffoldComposedProject', () => {
  it('(a) delivers all files from composed MFE templates', async () => {
    const registry = new Map<string, InventoryEntry>([
      ['root-project', makeEntry('root-project', '1.0.0', [], [{ ref: 'mfe-a' }, { ref: 'mfe-b' }])],
      ['mfe-a', makeEntry('mfe-a', '1.0.0', [{ path: 'src/a.ts', content: 'export const a = 1;' }])],
      ['mfe-b', makeEntry('mfe-b', '1.0.0', [{ path: 'src/b.ts', content: 'export const b = 2;' }])],
    ]);

    const lookupFn = (name: string) => registry.get(name);
    const conflictCheckFn = vi.fn().mockResolvedValue(false);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const provenanceWriteFn = vi.fn().mockResolvedValue(undefined);

    const result = await scaffoldComposedProject(
      'root-project',
      '/target',
      lookupFn,
      conflictCheckFn,
      writeFileFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(true);
    const writtenPaths = writeFileFn.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writtenPaths.some((p) => p.includes('src/a.ts'))).toBe(true);
    expect(writtenPaths.some((p) => p.includes('src/b.ts'))).toBe(true);
  });

  // (b) Transitive multi-level composition resolves all files at all depths
  it('(b) resolves transitive multi-level composition (depth=2 file)', async () => {
    const registry = new Map<string, InventoryEntry>([
      ['root', makeEntry('root', '1.0.0', [], [{ ref: 'template-a' }])],
      ['template-a', makeEntry('template-a', '1.0.0', [], [{ ref: 'template-b' }])],
      ['template-b', makeEntry('template-b', '1.0.0', [{ path: 'src/deep.ts', content: 'deep' }])],
    ]);

    const lookupFn = (name: string) => registry.get(name);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const provenanceWriteFn = vi.fn().mockResolvedValue(undefined);

    const result = await scaffoldComposedProject(
      'root',
      '/target',
      lookupFn,
      vi.fn().mockResolvedValue(false),
      writeFileFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(true);
    const writtenPaths = writeFileFn.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writtenPaths.some((p) => p.includes('src/deep.ts'))).toBe(true);
  });

  // (c) Nearest-declaration-wins: shallower depth wins on conflict
  it('(c) nearest-declaration-wins: root depth=0 beats composed depth=1 for same path', async () => {
    const registry = new Map<string, InventoryEntry>([
      [
        'root',
        makeEntry('root', '1.0.0', [{ path: 'shared.ts', content: 'root-content' }], [{ ref: 'template-a' }]),
      ],
      [
        'template-a',
        makeEntry('template-a', '1.0.0', [{ path: 'shared.ts', content: 'a-content' }]),
      ],
    ]);

    const lookupFn = (name: string) => registry.get(name);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const provenanceWriteFn = vi.fn().mockResolvedValue(undefined);

    const result = await scaffoldComposedProject(
      'root',
      '/target',
      lookupFn,
      vi.fn().mockResolvedValue(false),
      writeFileFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(true);
    const sharedCall = writeFileFn.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('shared.ts'),
    );
    expect(sharedCall).toBeDefined();
    expect(sharedCall![1]).toBe('root-content');
  });

  // (d) Unresolvable collision: same depth different declaring parents → abort, no files written
  it('(d) unresolvable collision at same depth/different parents → abort, no files written', async () => {
    // root composes [A, B]; A composes [X]; B composes [X]; X has "conflict.ts"
    // X at depth=2 via A (declaringParent=A) and via B (declaringParent=B) → collision
    const registry = new Map<string, InventoryEntry>([
      ['root', makeEntry('root', '1.0.0', [], [{ ref: 'tpl-a' }, { ref: 'tpl-b' }])],
      ['tpl-a', makeEntry('tpl-a', '1.0.0', [], [{ ref: 'tpl-x' }])],
      ['tpl-b', makeEntry('tpl-b', '1.0.0', [], [{ ref: 'tpl-x' }])],
      ['tpl-x', makeEntry('tpl-x', '1.0.0', [{ path: 'conflict.ts', content: 'x' }])],
    ]);

    const lookupFn = (name: string) => registry.get(name);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const provenanceWriteFn = vi.fn().mockResolvedValue(undefined);

    const result = await scaffoldComposedProject(
      'root',
      '/target',
      lookupFn,
      vi.fn().mockResolvedValue(false),
      writeFileFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('collision');
    }
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  // (e) Cycle detection: A composes B, B composes A → abort, no files written
  it('(e) cycle in composition graph → abort with cycle reason, no files written', async () => {
    const registry = new Map<string, InventoryEntry>([
      ['template-a', makeEntry('template-a', '1.0.0', [], [{ ref: 'template-b' }])],
      ['template-b', makeEntry('template-b', '1.0.0', [], [{ ref: 'template-a' }])],
    ]);

    const lookupFn = (name: string) => registry.get(name);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const provenanceWriteFn = vi.fn().mockResolvedValue(undefined);

    const result = await scaffoldComposedProject(
      'template-a',
      '/target',
      lookupFn,
      vi.fn().mockResolvedValue(false),
      writeFileFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('cycle');
    }
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  // (f) Provenance record written at scaffold with required fields
  it('(f) provenance record written with templateIdentity, scaffoldedFromVersion, sourceSpec', async () => {
    const registry = new Map<string, InventoryEntry>([
      ['simple-project', makeEntry('simple-project', '2.1.0', [{ path: 'index.ts', content: 'x' }])],
    ]);

    const lookupFn = (name: string) => registry.get(name);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const provenanceWriteFn = vi.fn().mockResolvedValue(undefined);

    await scaffoldComposedProject(
      'simple-project',
      '/my-project',
      lookupFn,
      vi.fn().mockResolvedValue(false),
      writeFileFn,
      provenanceWriteFn,
    );

    expect(provenanceWriteFn).toHaveBeenCalledOnce();
    const [provenancePath, provenanceContent] = provenanceWriteFn.mock.calls[0] as [string, string];
    expect(provenancePath).toBe('/my-project/.frontx/provenance.json');

    const parsed = JSON.parse(provenanceContent) as Record<string, unknown>;
    expect(parsed).toHaveProperty('templateIdentity');
    expect(parsed).toHaveProperty('scaffoldedFromVersion');
    expect(parsed).toHaveProperty('sourceSpec');
    expect(parsed['templateIdentity']).toBe('simple-project');
    expect(parsed['scaffoldedFromVersion']).toBe('2.1.0');
  });
});
