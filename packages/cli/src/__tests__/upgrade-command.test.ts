import { describe, it, expect, vi } from 'vitest';
// cpt-frontx-dod-upgrade-changeset-single-engine
// This test proves the frontx upgrade command/invocation surface drives the
// SAME change-set engine as the library path (upgradeChangeSetReviewApproval /
// computeChangeSet), so an external artifact (F17 AI orchestration) can invoke
// the engine through commands/upgrade.ts WITHOUT importing the engine modules
// directly.
import { upgradeCommand } from '../commands/upgrade.js';
import { computeChangeSet } from '../upgrade/compute.js';
import type { InventoryEntry } from '../inventory/types.js';
import { InventoryState } from '../inventory/types.js';

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

const BASE_PROVENANCE = {
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
  return (name: string, version: string) =>
    entries.find((e) => e.name === name && e.ref === version);
}

describe('upgradeCommand (F14 command/invocation surface)', () => {
  it('emits the same change set as the library computeChangeSet path, as JSON', async () => {
    const readProjectFile = async (p: string) =>
      p === `${PROJ_ROOT}/src/App.tsx` ? 'v1 content' : null;

    // Library path
    const libraryResult = await computeChangeSet(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      lookupByVersion: makeLookup([BASELINE, TARGET]),
      readProjectFile,
    });
    expect(libraryResult.ok).toBe(true);
    const expectedChangeSet = (libraryResult as Extract<typeof libraryResult, { ok: true }>).changeSet;

    // Command surface path — no import of compute.js/apply.js/flow.js required by the caller
    const commandResult = await upgradeCommand(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      lookupByVersion: makeLookup([BASELINE, TARGET]),
      readProjectFile,
      writeProjectFile: vi.fn(),
      removeProjectFile: vi.fn(),
      writeProvenance: vi.fn(),
      presentAndGetApproval: async () => 'declined',
    });

    expect(commandResult.status).toBe('declined');
    expect(commandResult.changeSetJson).toBeDefined();
    expect(JSON.parse(commandResult.changeSetJson!)).toEqual(expectedChangeSet);
  });

  it('does not write any project file until approval, driven through the command surface', async () => {
    const writeFn = vi.fn();
    const removeFn = vi.fn();

    const result = await upgradeCommand(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      lookupByVersion: makeLookup([BASELINE, TARGET]),
      readProjectFile: async () => null,
      writeProjectFile: writeFn,
      removeProjectFile: removeFn,
      writeProvenance: writeFn,
      presentAndGetApproval: async () => 'declined',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('declined');
    expect(writeFn).not.toHaveBeenCalled();
    expect(removeFn).not.toHaveBeenCalled();
  });

  it('reports resolution failure via the command surface without a change set', async () => {
    const result = await upgradeCommand(PROJ_ROOT, '99.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      lookupByVersion: makeLookup([BASELINE, TARGET]),
      readProjectFile: async () => null,
      writeProjectFile: vi.fn(),
      removeProjectFile: vi.fn(),
      writeProvenance: vi.fn(),
      presentAndGetApproval: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('resolution-failed');
    expect(result.changeSetJson).toBeUndefined();
    expect(result.message).toBeDefined();
  });
});
