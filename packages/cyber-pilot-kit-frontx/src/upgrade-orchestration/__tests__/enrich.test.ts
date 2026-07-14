// @cpt-algo:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
import { describe, it, expect, vi } from 'vitest';
import { computeChangeSet, InventoryState, type InventoryEntry } from '@gears-frontx/cli';
import {
  enrichUpgradeChangeSet,
  computeChangeImpact,
  computeDownstreamEffects,
} from '../enrich.js';
import type { ChangeSet, ProvenanceRecord } from '../types.js';

function makeEntry(
  name: string,
  version: string,
  files: Array<{ path: string; content: string }>,
): InventoryEntry {
  const manifest = { name, version, kind: 'project-template', files };
  return {
    name,
    source: `local:${name}`,
    ref: version,
    status: InventoryState.INSTALLED,
    content: JSON.stringify(manifest),
  };
}

const PROJ_ROOT = '/proj';

const PROVENANCE: ProvenanceRecord = {
  templateIdentity: 'my-template',
  scaffoldedFromVersion: '1.0.0',
  sourceSpec: 'local:my-template',
};

const BASELINE = makeEntry('my-template', '1.0.0', [
  { path: 'src/App.tsx', content: 'v1 content' },
  { path: 'src/old.ts', content: 'old file' },
]);

const TARGET = makeEntry('my-template', '2.0.0', [
  { path: 'src/App.tsx', content: 'v2 content' },
  { path: 'src/new.ts', content: 'new file' },
]);

function makeLookup(entries: InventoryEntry[]) {
  return (name: string, version: string) => entries.find((e) => e.name === name && e.ref === version);
}

describe('computeChangeImpact', () => {
  // inst-impact-analysis
  it('flags conflicts as requiring attention, clean entries as not', () => {
    const changeSet: ChangeSet = {
      templateIdentity: 'my-template',
      baselineVersion: '1.0.0',
      targetVersion: '2.0.0',
      clean: [{ kind: 'add', path: 'src/new.ts', content: 'x' }],
      conflicts: [
        { path: 'src/App.tsx', templateKind: 'modify', templateContent: 'v2', localContent: 'local-edit' },
      ],
    };
    const impact = computeChangeImpact(changeSet);
    expect(impact.entries).toHaveLength(2);
    expect(impact.entries.find((e) => e.path === 'src/new.ts')?.requiresAttention).toBe(false);
    expect(impact.entries.find((e) => e.path === 'src/App.tsx')?.requiresAttention).toBe(true);
  });
});

describe('computeDownstreamEffects', () => {
  // inst-downstream-assess
  it('surfaces one incompatibility message per conflict', () => {
    const changeSet: ChangeSet = {
      templateIdentity: 'my-template',
      baselineVersion: '1.0.0',
      targetVersion: '2.0.0',
      clean: [],
      conflicts: [
        { path: 'src/App.tsx', templateKind: 'modify', templateContent: 'v2', localContent: 'local-edit' },
      ],
    };
    const assessment = computeDownstreamEffects(changeSet);
    expect(assessment.incompatibilities).toHaveLength(1);
    expect(assessment.incompatibilities[0]).toContain('src/App.tsx');
  });

  it('reports no incompatibilities when there are no conflicts', () => {
    const changeSet: ChangeSet = {
      templateIdentity: 'my-template',
      baselineVersion: '1.0.0',
      targetVersion: '2.0.0',
      clean: [{ kind: 'add', path: 'src/new.ts', content: 'x' }],
      conflicts: [],
    };
    expect(computeDownstreamEffects(changeSet).incompatibilities).toHaveLength(0);
  });
});

describe('enrichUpgradeChangeSet (drives the SINGLE F14 engine)', () => {
  // inst-extract-provenance / inst-invoke-engine / inst-receive-changeset / inst-combine-results / inst-return-enriched
  it('invokes the real @gears-frontx/cli computeChangeSet and enriches its output', async () => {
    const readProjectFile = vi.fn().mockResolvedValue(null);
    const result = await enrichUpgradeChangeSet(PROJ_ROOT, PROVENANCE, '2.0.0', {
      computeChangeSet,
      lookupByVersion: makeLookup([BASELINE, TARGET]),
      readProjectFile,
    });

    expect(result.status).toBe('enriched');
    if (result.status !== 'enriched') return;
    expect(result.package.changeSet.targetVersion).toBe('2.0.0');
    expect(result.package.impactAnalysis.entries.length).toBeGreaterThan(0);
    expect(result.package.downstreamAssessment).toBeDefined();
  });

  // inst-check-empty / inst-empty-signal — engine returns a resolution failure
  it('returns empty signal when the engine cannot resolve the change set', async () => {
    const result = await enrichUpgradeChangeSet(PROJ_ROOT, PROVENANCE, '9.9.9', {
      computeChangeSet,
      lookupByVersion: makeLookup([BASELINE]), // target 9.9.9 not in inventory
      readProjectFile: vi.fn().mockResolvedValue(null),
    });
    expect(result.status).toBe('empty');
  });

  // inst-check-empty / inst-empty-signal — engine returns a changeset with no clean/conflict entries
  it('returns empty signal when the resolved change set has no entries', async () => {
    const identicalTarget = makeEntry('my-template', '1.0.0', [
      { path: 'src/App.tsx', content: 'v1 content' },
      { path: 'src/old.ts', content: 'old file' },
    ]);
    const result = await enrichUpgradeChangeSet(PROJ_ROOT, PROVENANCE, '1.0.0', {
      computeChangeSet,
      lookupByVersion: makeLookup([BASELINE, identicalTarget]),
      readProjectFile: vi.fn().mockResolvedValue(null),
    });
    expect(result.status).toBe('empty');
  });
});
