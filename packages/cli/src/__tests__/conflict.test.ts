// @cpt-algo:cpt-frontx-algo-cli-scaffolding-conflict-check:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-conflict-check:p1
import { describe, it, expect } from 'vitest';
import { checkAssemblyConflicts } from '../scaffold/conflict';
import type { ContributionEntry, StagedAssembly } from '../scaffold/types';
import type { OccupiedBoundaryEntry } from '../scaffold/state';
import type { OwnershipBoundary } from '../manifest/types';

function contribution(
  templateName: string,
  boundaries: OwnershipBoundary,
): ContributionEntry {
  return { templateName, files: [], ownershipBoundaries: boundaries };
}

function assemblyOf(...contributions: ContributionEntry[]): StagedAssembly {
  return { contributions };
}

const noSharedFiles: OwnershipBoundary['sharedFiles'] = [];

describe('checkAssemblyConflicts — F12 pre-flight assembly conflict check (cpt-frontx-algo-cli-scaffolding-conflict-check)', () => {
  // (a) A non-conflicting assembly PASSES — inst-cc-return-pass.
  it('(a) passes a non-conflicting assembly — disjoint exclusive subtrees, no already-occupied boundaries', () => {
    const assembly = assemblyOf(
      contribution('template-a', { exclusiveSubtrees: ['template-a/'], sharedFiles: noSharedFiles }),
      contribution('template-b', { exclusiveSubtrees: ['template-b/'], sharedFiles: noSharedFiles }),
    );

    const verdict = checkAssemblyConflicts(assembly, []);

    expect(verdict.ok).toBe(true);
  });

  // (b) Overlapping exclusive subtrees are REFUSED pre-write — inst-cc-if-subtree-clash /
  // inst-cc-record-subtree-conflict / inst-cc-return-conflict.
  it('(b) refuses the whole assembly when two templates claim the same exclusive subtree', () => {
    const assembly = assemblyOf(
      contribution('template-a', { exclusiveSubtrees: ['shared-subtree/'], sharedFiles: noSharedFiles }),
      contribution('template-b', { exclusiveSubtrees: ['shared-subtree/'], sharedFiles: noSharedFiles }),
    );

    const verdict = checkAssemblyConflicts(assembly, []);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.conflicts).toEqual([
      { ground: 'shared-subtree/', contestants: ['template-a', 'template-b'] },
    ]);
  });

  // (c) Overlapping shared-file owned regions with NO compatible merge are REFUSED —
  // inst-cc-if-region-clash / inst-cc-record-region-conflict / inst-cc-return-conflict.
  it('(c) refuses the whole assembly when two templates claim the same shared-file region without a compatible declared merge', () => {
    const assembly = assemblyOf(
      contribution('template-a', {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'package.json', mergeStrategy: 'deep-merge', ownedRegions: ['scripts.build'] }],
      }),
      contribution('template-b', {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'package.json', mergeStrategy: 'shallow-merge', ownedRegions: ['scripts.build'] }],
      }),
    );

    const verdict = checkAssemblyConflicts(assembly, []);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.conflicts).toEqual([
      { ground: 'package.json', contestants: ['template-a', 'template-b'] },
    ]);
  });

  // Disjoint regions of the same shared file, or the same region with a
  // compatible declared merge, are NOT a clash.
  it('accepts two templates owning disjoint regions of the same shared file', () => {
    const assembly = assemblyOf(
      contribution('template-a', {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'package.json', mergeStrategy: 'deep-merge', ownedRegions: ['scripts.build'] }],
      }),
      contribution('template-b', {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'package.json', mergeStrategy: 'deep-merge', ownedRegions: ['scripts.test'] }],
      }),
    );

    expect(checkAssemblyConflicts(assembly, []).ok).toBe(true);
  });

  it('accepts two templates claiming the same shared-file region under the same declared merge strategy', () => {
    const assembly = assemblyOf(
      contribution('template-a', {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: '.github/workflows/ci.yml', mergeStrategy: 'append', ownedRegions: ['jobs.test'] }],
      }),
      contribution('template-b', {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: '.github/workflows/ci.yml', mergeStrategy: 'append', ownedRegions: ['jobs.test'] }],
      }),
    );

    const verdict = checkAssemblyConflicts(assembly, []);
    expect(verdict.ok).toBe(true);
  });

  // A staged template clashing with an ALREADY-APPLIED template's occupied
  // boundary is refused too — the check compares the staged assembly against
  // what the repository already holds, not just within the staged set.
  it('refuses a staged template that claims an exclusive subtree an already-applied template occupies', () => {
    const assembly = assemblyOf(
      contribution('new-template', { exclusiveSubtrees: ['already-owned/'], sharedFiles: noSharedFiles }),
    );
    const alreadyOccupied: OccupiedBoundaryEntry[] = [
      { templateName: 'existing-template', boundary: { exclusiveSubtrees: ['already-owned/'], sharedFiles: noSharedFiles } },
    ];

    const verdict = checkAssemblyConflicts(assembly, alreadyOccupied);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.conflicts).toEqual([
      { ground: 'already-owned/', contestants: ['new-template', 'existing-template'] },
    ]);
  });

  // (d) The refusal report NAMES each contested ground and its contesting
  // templates for MULTIPLE simultaneous conflicts — never silently merges.
  it('(d) names every contested ground and its contesting templates when multiple conflicts exist', () => {
    const assembly = assemblyOf(
      contribution('template-a', {
        exclusiveSubtrees: ['dup-subtree/'],
        sharedFiles: [{ path: 'tsconfig.json', mergeStrategy: 'deep-merge', ownedRegions: ['compilerOptions.paths'] }],
      }),
      contribution('template-b', {
        exclusiveSubtrees: ['dup-subtree/'],
        sharedFiles: [{ path: 'tsconfig.json', mergeStrategy: 'shallow-merge', ownedRegions: ['compilerOptions.paths'] }],
      }),
    );

    const verdict = checkAssemblyConflicts(assembly, []);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.conflicts).toEqual(
      expect.arrayContaining([
        { ground: 'dup-subtree/', contestants: ['template-a', 'template-b'] },
        { ground: 'tsconfig.json', contestants: ['template-a', 'template-b'] },
      ]),
    );
    expect(verdict.conflicts).toHaveLength(2);
  });

  it('refuses BEFORE any file write — the verdict carries no write side-effect and materialization must gate on it', async () => {
    const assembly = assemblyOf(
      contribution('template-a', { exclusiveSubtrees: ['collide/'], sharedFiles: noSharedFiles }),
      contribution('template-b', { exclusiveSubtrees: ['collide/'], sharedFiles: noSharedFiles }),
    );
    const writes: string[] = [];
    const materializeFn = async () => {
      writes.push('materialized');
    };

    const verdict = checkAssemblyConflicts(assembly, []);
    // Simulates the real gate: runAssemblyOp only calls materializeFn when the
    // verdict is ok — a refused verdict must never be followed by a write.
    if (verdict.ok) {
      await materializeFn();
    }

    expect(verdict.ok).toBe(false);
    expect(writes).toHaveLength(0);
  });
});
