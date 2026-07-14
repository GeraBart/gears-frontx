// @cpt-flow:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1
// @cpt-state:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
import { describe, it, expect, vi } from 'vitest';
import { computeChangeSet, applyChangeSet, InventoryState, type InventoryEntry } from '@gears-frontx/cli';
import { orchestrateAiDrivenUpgrade, type OrchestrationDeps } from '../orchestrate.js';
import type { ProvenanceRecord } from '../types.js';

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

const BASELINE = makeEntry('my-template', '1.0.0', [{ path: 'src/App.tsx', content: 'v1 content' }]);
const TARGET = makeEntry('my-template', '2.0.0', [{ path: 'src/App.tsx', content: 'v2 content' }]);

function makeLookup(entries: InventoryEntry[]) {
  return (name: string, version: string) => entries.find((e) => e.name === name && e.ref === version);
}

function baseDeps(overrides: Partial<OrchestrationDeps> = {}): OrchestrationDeps {
  return {
    readProvenance: vi.fn().mockResolvedValue(PROVENANCE),
    computeChangeSet,
    applyChangeSet,
    lookupByVersion: makeLookup([BASELINE, TARGET]),
    readProjectFile: vi.fn().mockResolvedValue(null),
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    removeProjectFile: vi.fn().mockResolvedValue(undefined),
    writeProvenance: vi.fn().mockResolvedValue(undefined),
    presentEnrichedReview: vi.fn().mockResolvedValue('declined'),
    ...overrides,
  };
}

describe('orchestrateAiDrivenUpgrade (F17 — drives the SINGLE F14 engine, never a second one)', () => {
  // inst-request-upgrade / inst-read-provenance / inst-check-provenance / inst-provenance-missing
  it('returns provenance-missing and performs no engine invocation when provenance is absent', async () => {
    const computeSpy = vi.fn();
    const deps = baseDeps({ readProvenance: vi.fn().mockResolvedValue(null), computeChangeSet: computeSpy });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, '2.0.0', deps);
    expect(result.status).toBe('provenance-missing');
    expect(computeSpy).not.toHaveBeenCalled();
  });

  // inst-invoke-enrichment / inst-check-changeset / inst-empty-changeset
  it('returns empty-changeset and presents no review when the engine change set is empty/unresolvable', async () => {
    const presentSpy = vi.fn();
    const deps = baseDeps({
      lookupByVersion: makeLookup([BASELINE]), // target not resolvable
      presentEnrichedReview: presentSpy,
    });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, '9.9.9', deps);
    expect(result.status).toBe('empty-changeset');
    expect(presentSpy).not.toHaveBeenCalled();
  });

  // inst-present-review / inst-gate-approve / inst-engine-apply / inst-update-provenance / inst-return-applied
  it('approval triggers the F14 engine apply and updates provenance to the newer version', async () => {
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);
    const writeProvenance = vi.fn().mockResolvedValue(undefined);
    const deps = baseDeps({
      presentEnrichedReview: vi.fn().mockResolvedValue('approved'),
      writeProjectFile,
      writeProvenance,
    });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, '2.0.0', deps);
    expect(result.status).toBe('applied');
    expect(writeProjectFile).toHaveBeenCalled();
    expect(writeProvenance).toHaveBeenCalled();
    const [, provenanceContent] = writeProvenance.mock.calls[0] as [string, string];
    expect(JSON.parse(provenanceContent).scaffoldedFromVersion).toBe('2.0.0');
  });

  // inst-gate-decline / inst-no-write / inst-return-declined — the review gate stands unconditionally
  it('decline writes no project files and leaves provenance unchanged', async () => {
    const writeProjectFile = vi.fn();
    const removeProjectFile = vi.fn();
    const writeProvenance = vi.fn();
    const deps = baseDeps({
      presentEnrichedReview: vi.fn().mockResolvedValue('declined'),
      writeProjectFile,
      removeProjectFile,
      writeProvenance,
    });
    const result = await orchestrateAiDrivenUpgrade(PROJ_ROOT, '2.0.0', deps);
    expect(result.status).toBe('declined');
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(removeProjectFile).not.toHaveBeenCalled();
    expect(writeProvenance).not.toHaveBeenCalled();
  });

  // Single-engine invariant: the exact @gears-frontx/cli functions are the ones driven
  it('drives the exact @gears-frontx/cli computeChangeSet/applyChangeSet functions (no reimplementation)', async () => {
    const deps = baseDeps({ presentEnrichedReview: vi.fn().mockResolvedValue('approved') });
    expect(deps.computeChangeSet).toBe(computeChangeSet);
    expect(deps.applyChangeSet).toBe(applyChangeSet);
    await orchestrateAiDrivenUpgrade(PROJ_ROOT, '2.0.0', deps);
  });
});
