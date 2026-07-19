// @cpt-flow:cpt-frontx-flow-cli-scaffolding-seed-repository:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-boundary-declared-assembly:p1
import { describe, it, expect } from 'vitest';
import { seedRepository } from '../commands/seed-repository';
import { addTemplate } from '../commands/add-template';
import type { InventoryEntry } from '../inventory/types';
import { InventoryState } from '../inventory/types';
import type { TemplateManifest } from '../manifest/types';
import type { ContentItem, ReadContentItemsFn, WriteFileFn } from '../scaffold/types';
import type { ProvenanceRecord, ProvenanceWriteFn } from '../provenance/types';
import type { ReadProvenanceRecordsFn } from '../scaffold/materialize';

// Same content-registry-keyed-by-name convention as assembler.test.ts — the
// manifest carries ONLY the four declared categories; content items live
// separately and are read via the injected readContentFn seam, directly from
// the installed content path, never from the manifest.
function makeEntry(
  name: string,
  content: ContentItem[],
  manifestOverrides: Partial<TemplateManifest> = {},
): InventoryEntry {
  const manifest: TemplateManifest = {
    name,
    version: '1.0.0',
    ownershipBoundaries: { exclusiveSubtrees: [`${name}/`], sharedFiles: [] },
    ...manifestOverrides,
  };
  contentRegistry.set(name, content);
  return {
    name,
    source: `github:acme/${name}@v1.0.0`,
    ref: 'v1.0.0',
    status: InventoryState.INSTALLED,
    content: JSON.stringify(manifest),
  };
}

const contentRegistry = new Map<string, ContentItem[]>();
const readContentFn: ReadContentItemsFn = async (entry) => contentRegistry.get(entry.name) ?? [];

function makeFsFake() {
  const files = new Map<string, string>();
  const writeFileFn: WriteFileFn = async (path, content) => {
    files.set(path, content);
  };
  const provenanceWriteFn: ProvenanceWriteFn = async (path, content) => {
    files.set(path, content);
  };
  const readProvenanceFn: ReadProvenanceRecordsFn = async (targetDir) => {
    const raw = files.get(`${targetDir}/.frontx/provenance.json`);
    return raw ? (JSON.parse(raw) as ProvenanceRecord[]) : [];
  };
  return { files, writeFileFn, provenanceWriteFn, readProvenanceFn };
}

describe('seedRepository — cpt-frontx-flow-cli-scaffolding-seed-repository', () => {
  it('seeds an empty target: resolves the referenced set incl. preset references, stages via P14, passes P29, materializes, writes one provenance record per applied template', async () => {
    const preset = makeEntry('preset-template', [{ path: 'preset-template/README.md', content: 'preset' }], {
      referencedTemplates: [{ ref: 'mfe-a', appliedAt: 'mfe-a/' }],
    });
    const mfeA = makeEntry('mfe-a', [{ path: 'mfe-a/index.ts', content: 'export const mfeA = true;' }]);
    const entries: Record<string, InventoryEntry> = { 'preset-template': preset, 'mfe-a': mfeA };
    const lookupFn = (n: string) => entries[n];
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository('preset-template', '/target', lookupFn, readContentFn, writeFileFn, provenanceWriteFn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedTemplates.sort()).toEqual(['mfe-a', 'preset-template']);
    expect(files.get('/target/preset-template/README.md')).toBe('preset');
    expect(files.get('/target/mfe-a/index.ts')).toBe('export const mfeA = true;');
    const provenance = JSON.parse(files.get('/target/.frontx/provenance.json')!) as ProvenanceRecord[];
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.templateIdentity).sort()).toEqual(['mfe-a', 'preset-template']);
  });

  it('aborts with no files written when the template reference cannot be resolved from the local inventory', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository('missing', '/target', () => undefined, readContentFn, writeFileFn, provenanceWriteFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    expect(files.size).toBe(0);
  });

  it('aborts BEFORE any file write when two templates in the staged assembly claim the same exclusive subtree', async () => {
    const templateA = makeEntry('template-a', [{ path: 'shared/a.ts', content: 'a' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['shared/'], sharedFiles: [] },
      referencedTemplates: [{ ref: 'template-b', appliedAt: 'template-b/' }],
    });
    const templateB = makeEntry('template-b', [{ path: 'shared/b.ts', content: 'b' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['shared/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'template-a': templateA, 'template-b': templateB };
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository('template-a', '/target', (n) => entries[n], readContentFn, writeFileFn, provenanceWriteFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason === 'conflict') {
      expect(result.conflicts).toEqual([{ ground: 'shared/', contestants: ['template-a', 'template-b'] }]);
    }
    expect(files.size).toBe(0);
  });
});

describe('addTemplate — cpt-frontx-flow-cli-scaffolding-add-template', () => {
  it('adds into an existing repository: stages via the SAME P14 path, submits staged assembly + already-occupied boundaries to P29, materializes ONLY the new contribution, adds one provenance record per newly applied template', async () => {
    const existing = makeEntry('existing-template', [{ path: 'existing/index.ts', content: 'existing' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['existing/'], sharedFiles: [] },
    });
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'existing-template': existing, 'new-template': newTemplate };
    const lookupFn = (n: string) => entries[n];
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([{ templateIdentity: 'existing-template', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/existing-template@v1.0.0' }]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      lookupFn,
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedTemplates).toEqual(['new-template']);
    // Only the new template's contribution is materialized — the existing
    // template's own file was never re-written by this operation.
    expect(files.get('/target/new/index.ts')).toBe('new');
    expect(files.has('/target/existing/index.ts')).toBe(false);
    const provenance = JSON.parse(files.get('/target/.frontx/provenance.json')!) as ProvenanceRecord[];
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.templateIdentity)).toEqual(['existing-template', 'new-template']);
  });

  it('aborts with no files written when the template reference cannot be resolved from the local inventory', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn } = makeFsFake();

    const result = await addTemplate('missing', '/target', () => undefined, readContentFn, writeFileFn, readProvenanceFn, provenanceWriteFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    expect(files.size).toBe(0);
  });

  it('aborts BEFORE any file write when the new template intersects an already-applied boundary', async () => {
    const existing = makeEntry('existing-template', [{ path: 'clash/existing.ts', content: 'existing' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['clash/'], sharedFiles: [] },
    });
    const clashing = makeEntry('clashing-template', [{ path: 'clash/new.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['clash/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'existing-template': existing, 'clashing-template': clashing };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([{ templateIdentity: 'existing-template', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/existing-template@v1.0.0' }]),
    );

    const result = await addTemplate(
      'clashing-template',
      '/target',
      (n) => entries[n],
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason === 'conflict') {
      expect(result.conflicts).toEqual([{ ground: 'clash/', contestants: ['clashing-template', 'existing-template'] }]);
    }
    // Only the pre-existing provenance file is present; no new file was written.
    expect(files.size).toBe(1);
    expect(files.has('/target/.frontx/provenance.json')).toBe(true);
  });
});

describe('boundary-declared-assembly DoD — cpt-frontx-dod-cli-scaffolding-boundary-declared-assembly', () => {
  it('reads declared ownership boundaries from the manifest and content from the installed content path scoped to those boundaries, never from the manifest', async () => {
    const entry = makeEntry('template-a', [
      { path: 'template-a/index.ts', content: 'in-bounds' },
      { path: 'unrelated/outside.ts', content: 'out-of-bounds' },
    ]);
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository('template-a', '/target', () => entry, readContentFn, writeFileFn, provenanceWriteFn);

    expect(result.ok).toBe(true);
    expect(files.get('/target/template-a/index.ts')).toBe('in-bounds');
    expect(files.has('/target/unrelated/outside.ts')).toBe(false);
  });
});
