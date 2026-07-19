import { describe, it, expect, vi } from 'vitest';
// cpt-frontx-dod-upgrade-changeset-computation cpt-frontx-dod-upgrade-changeset-apply
// cpt-frontx-dod-upgrade-changeset-rollback cpt-frontx-dod-upgrade-changeset-single-engine
import {
  upgradeChangeSetReviewApproval,
  type UpgradeFlowDeps,
} from '../upgrade/flow';
import { computeChangeSet } from '../upgrade/compute';
import { applyChangeSet } from '../upgrade/apply';
import { rollbackChangeSet } from '../upgrade/rollback';
import type { ChangeSet, ConflictEntry } from '../upgrade/types';
import type { ContentItem, ReadContentItemsFn } from '../scaffold/types';
import type { FetchFn } from '../resolver/types';
import type { OwnershipBoundary } from '../manifest/types';

// Content items live SEPARATELY from the manifest, in a registry keyed by
// "name@version", and are read via the injected `readContentItems` seam
// directly from the "installed content path" — never from the manifest.
const contentRegistry = new Map<string, ContentItem[]>();
const readContentItems: ReadContentItemsFn = async (entry) =>
  contentRegistry.get(`${entry.name}@${entry.ref}`) ?? [];

// Manifests, keyed by "name@version" — this is the shared resolver's
// fetchable content, DISTINCT from any single-entry local inventory. The
// upgrade engine must reach this registry through fetchFn (re-resolving via
// the provenance source-spec at a specific version) for BOTH the baseline
// and the target — never through a local-inventory lookup that only ever
// retains one version per entry.
const manifestByVersion = new Map<string, string>();

function registerVersion(
  name: string,
  version: string,
  files: Array<{ path: string; content: string }>,
  ownershipBoundaries: OwnershipBoundary = { exclusiveSubtrees: [], sharedFiles: [] },
): void {
  const manifest = { name, version, ownershipBoundaries };
  contentRegistry.set(`${name}@${version}`, files);
  manifestByVersion.set(`${name}@${version}`, JSON.stringify(manifest));
}

// The shared resolver's fetch primitive (cpt-frontx-feature-template-resolution).
// The requested version always arrives as the URL's trailing "@ref" segment
// (see resolver/resolve.ts buildFetchUrl) — this fake resolves purely from
// that, with NO access to any local inventory.
const fetchFn: FetchFn = async (url) => {
  const version = url.slice(url.lastIndexOf('@') + 1);
  const manifest = manifestByVersion.get(`my-template@${version}`);
  if (!manifest) {
    throw new Error(`Template "my-template" not found at version "${version}" via shared resolver.`);
  }
  return manifest;
};

const PROJ_ROOT = '/proj';

const BASE_PROVENANCE = {
  templateIdentity: 'my-template',
  scaffoldedFromVersion: '1.0.0',
  sourceSpec: 'local:acme/my-template@1.0.0',
};

registerVersion('my-template', '1.0.0', [
  { path: 'src/App.tsx', content: 'v1 content' },
  { path: 'src/old.ts', content: 'old file' },
]);

registerVersion('my-template', '2.0.0', [
  { path: 'src/App.tsx', content: 'v2 content' },
  { path: 'src/new.ts', content: 'new file' },
  // 'src/old.ts' intentionally removed in target version
]);

describe('upgradeChangeSetReviewApproval (F14 change-set engine flow)', () => {
  // (a) Produces reviewable change set, writes NO project files until developer approves
  it('(a) computes change set and writes no files until approved', async () => {
    const writeFn = vi.fn();
    const removeFn = vi.fn();
    const presentFn = vi
      .fn<(changeSet: ChangeSet) => Promise<'approved' | 'declined'>>()
      .mockResolvedValue('declined');

    const result = await upgradeChangeSetReviewApproval(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn,
      readProjectFile: async (p) =>
        p === `${PROJ_ROOT}/src/App.tsx` ? 'v1 content' : null,
      readContentItems,
      writeProjectFile: writeFn,
      removeProjectFile: removeFn,
      writeProvenance: writeFn,
      presentAndGetApproval: presentFn,
    });

    // Change set was presented to developer
    expect(presentFn).toHaveBeenCalledOnce();
    const presented = presentFn.mock.calls[0][0];
    expect(presented.clean.length + presented.conflicts.length).toBeGreaterThan(0);

    // Result is declined — no files touched
    expect(result.status).toBe('declined');
    expect(writeFn).not.toHaveBeenCalled();
    expect(removeFn).not.toHaveBeenCalled();
  });

  // (b) Approving writes ONLY the approved entries and updates provenance to the newer version
  it('(b) approving writes only approved entries and updates provenance to target version', async () => {
    const written = new Map<string, string>();
    const removed = new Set<string>();

    const result = await upgradeChangeSetReviewApproval(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn,
      readProjectFile: async (p) => {
        if (p === `${PROJ_ROOT}/src/App.tsx`) return 'v1 content';
        if (p === `${PROJ_ROOT}/src/old.ts`) return 'old file';
        return null;
      },
      readContentItems,
      writeProjectFile: async (p, c) => { written.set(p, c); },
      removeProjectFile: async (p) => { removed.add(p); },
      writeProvenance: async (p, c) => { written.set(p, c); },
      presentAndGetApproval: async () => 'approved',
    });

    expect(result.status).toBe('applied');

    // App.tsx modified from v1→v2
    expect(written.get(`${PROJ_ROOT}/src/App.tsx`)).toBe('v2 content');
    // new.ts added
    expect(written.get(`${PROJ_ROOT}/src/new.ts`)).toBe('new file');
    // old.ts removed
    expect(removed.has(`${PROJ_ROOT}/src/old.ts`)).toBe(true);
    // Provenance updated to 2.0.0
    const provContent = written.get(`${PROJ_ROOT}/.frontx/provenance.json`);
    expect(provContent).toBeDefined();
    expect(JSON.parse(provContent!).scaffoldedFromVersion).toBe('2.0.0');
  });

  // (c) Declining leaves the project byte-for-byte unchanged — no file created, modified, or deleted
  it('(c) declining leaves project byte-for-byte unchanged', async () => {
    const writeFn = vi.fn();
    const removeFn = vi.fn();

    const result = await upgradeChangeSetReviewApproval(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn,
      readProjectFile: async () => null,
      readContentItems,
      writeProjectFile: writeFn,
      removeProjectFile: removeFn,
      writeProvenance: writeFn,
      presentAndGetApproval: async () => 'declined',
    });

    expect(result.status).toBe('declined');
    expect(writeFn).not.toHaveBeenCalled();
    expect(removeFn).not.toHaveBeenCalled();
  });

  // (d) Applying then rolling back restores exact pre-upgrade state including provenance
  it('(d) rollback after apply restores exact pre-upgrade state including provenance', async () => {
    const files = new Map<string, string>([
      [`${PROJ_ROOT}/src/App.tsx`, 'v1 content'],
      [`${PROJ_ROOT}/src/old.ts`, 'old file'],
      [`${PROJ_ROOT}/.frontx/provenance.json`, JSON.stringify(BASE_PROVENANCE, null, 2)],
    ]);

    const deps: UpgradeFlowDeps = {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn,
      readProjectFile: async (p) => files.get(p) ?? null,
      readContentItems,
      writeProjectFile: async (p, c) => { files.set(p, c); },
      removeProjectFile: async (p) => { files.delete(p); },
      writeProvenance: async (p, c) => { files.set(p, c); },
      presentAndGetApproval: async () => 'approved',
    };

    const applyResult = await upgradeChangeSetReviewApproval(PROJ_ROOT, '2.0.0', deps);
    expect(applyResult.status).toBe('applied');

    // After apply: provenance at 2.0.0
    expect(
      JSON.parse(files.get(`${PROJ_ROOT}/.frontx/provenance.json`)!).scaffoldedFromVersion,
    ).toBe('2.0.0');

    // Rollback
    const snapshot = (applyResult as Extract<typeof applyResult, { status: 'applied' }>).snapshot;
    const rollbackResult = await rollbackChangeSet(snapshot, PROJ_ROOT, {
      writeProjectFile: async (p, c) => { files.set(p, c); },
      removeProjectFile: async (p) => { files.delete(p); },
    });

    expect(rollbackResult.ok).toBe(true);
    // Provenance restored to 1.0.0
    expect(
      JSON.parse(files.get(`${PROJ_ROOT}/.frontx/provenance.json`)!).scaffoldedFromVersion,
    ).toBe('1.0.0');
    // old.ts restored
    expect(files.get(`${PROJ_ROOT}/src/old.ts`)).toBe('old file');
    // new.ts removed (it was null pre-upgrade → rollback removes it)
    expect(files.has(`${PROJ_ROOT}/src/new.ts`)).toBe(false);
    // App.tsx restored to v1
    expect(files.get(`${PROJ_ROOT}/src/App.tsx`)).toBe('v1 content');
  });

  // (e) Single engine — computeChangeSet, applyChangeSet, rollbackChangeSet all from canonical modules
  it('(e) single shared engine: all functions exported from canonical upgrade modules', () => {
    // Both direct CLI (via upgradeChangeSetReviewApproval) and F17 AI orchestration
    // import from the same canonical modules — no second diff/apply implementation exists.
    expect(typeof upgradeChangeSetReviewApproval).toBe('function');
    expect(typeof computeChangeSet).toBe('function');
    expect(typeof applyChangeSet).toBe('function');
    expect(typeof rollbackChangeSet).toBe('function');
  });

  // (f) Target version that cannot be resolved → report failure and abort before writing any file
  it('(f) unresolvable target version aborts before writing any project file', async () => {
    const writeFn = vi.fn();
    const removeFn = vi.fn();
    const presentFn = vi.fn();

    const result = await upgradeChangeSetReviewApproval(PROJ_ROOT, '99.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn,
      readProjectFile: async () => null,
      readContentItems,
      writeProjectFile: writeFn,
      removeProjectFile: removeFn,
      writeProvenance: writeFn,
      presentAndGetApproval: presentFn,
    });

    expect(result.status).toBe('resolution-failed');
    expect(presentFn).not.toHaveBeenCalled();
    expect(writeFn).not.toHaveBeenCalled();
    expect(removeFn).not.toHaveBeenCalled();
  });

  // (g) Conflict — file affected by both template diff and local modification surfaced before approval
  it('(g) locally modified file conflicting with template diff is surfaced as a conflict', async () => {
    let capturedChangeSet: ChangeSet | undefined;

    await upgradeChangeSetReviewApproval(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn,
      readProjectFile: async (p) => {
        // App.tsx has been locally modified (differs from baseline 'v1 content')
        if (p === `${PROJ_ROOT}/src/App.tsx`) return 'locally modified content';
        return null;
      },
      readContentItems,
      writeProjectFile: vi.fn(),
      removeProjectFile: vi.fn(),
      writeProvenance: vi.fn(),
      presentAndGetApproval: async (cs) => {
        capturedChangeSet = cs;
        return 'declined';
      },
    });

    expect(capturedChangeSet).toBeDefined();
    expect(capturedChangeSet!.conflicts.length).toBeGreaterThan(0);
    const conflict = capturedChangeSet!.conflicts.find((c: ConflictEntry) => c.path === 'src/App.tsx');
    expect(conflict).toBeDefined();
    expect(conflict!.localContent).toBe('locally modified content');
  });

  // (h) Baseline is RE-RESOLVED via the shared resolver from the provenance
  // source-spec at the baseline version — never from a single-entry local
  // inventory. This fixture's "inventory" (manifestByVersion) holds BOTH
  // versions precisely because it IS the shared resolver's fetchable
  // content, not a local, single-entry inventory — a spy on fetchFn proves
  // the engine actually requests the baseline version, not just the target.
  it('(h) baseline is re-resolved through the shared resolver at the baseline version, not the local inventory', async () => {
    const requestedVersions: string[] = [];
    const spyFetchFn: FetchFn = async (url) => {
      requestedVersions.push(url.slice(url.lastIndexOf('@') + 1));
      return fetchFn(url);
    };

    const result = await computeChangeSet(PROJ_ROOT, '2.0.0', {
      readProvenance: async () => BASE_PROVENANCE,
      fetchFn: spyFetchFn,
      readProjectFile: async () => null,
      readContentItems,
    });

    expect(result.ok).toBe(true);
    // Both the baseline version (from provenance.scaffoldedFromVersion) and
    // the target version were independently re-resolved via the resolver.
    expect(requestedVersions).toContain('1.0.0');
    expect(requestedVersions).toContain('2.0.0');
  });

  // (i) region-union shared file: diff/apply touches ONLY this template's
  // own marker-delimited region, leaving a co-owning template's region
  // byte-for-byte untouched, both in the computed diff and after apply.
  it('(i) region-union shared file: diff and apply are scoped to this template\'s own owned region only', async () => {
    const SHARED_PATH = 'shared.config.js';
    // Distinct versions from the top-level fixture — this test registers its
    // own baseline/target so it cannot clobber the shared '1.0.0'/'2.0.0'
    // entries other tests in this file rely on.
    const REGION_PROVENANCE = {
      templateIdentity: 'my-template',
      scaffoldedFromVersion: '1.1.0',
      sourceSpec: 'local:acme/my-template@1.1.0',
    };
    const sharedBoundary: OwnershipBoundary = {
      exclusiveSubtrees: [],
      sharedFiles: [{ path: SHARED_PATH, mergeStrategy: 'region-union', ownedRegions: ['setup'] }],
    };

    registerVersion(
      'my-template',
      '1.1.0',
      [
        {
          path: SHARED_PATH,
          content: [
            '// frontx:region my-template:setup',
            'const setupV1 = true;',
            '// frontx:endregion my-template:setup',
            '// frontx:region other-template:extra',
            'const otherStaysPut = true;',
            '// frontx:endregion other-template:extra',
          ].join('\n'),
        },
      ],
      sharedBoundary,
    );
    registerVersion(
      'my-template',
      '2.1.0',
      [
        {
          path: SHARED_PATH,
          content: [
            '// frontx:region my-template:setup',
            'const setupV2 = true;',
            '// frontx:endregion my-template:setup',
          ].join('\n'),
        },
      ],
      sharedBoundary,
    );

    // The current project file — this template's region at the v1.1.0
    // baseline (unmodified locally) plus a co-owning template's region.
    const projectFileContent = [
      '// frontx:region my-template:setup',
      'const setupV1 = true;',
      '// frontx:endregion my-template:setup',
      '// frontx:region other-template:extra',
      'const otherStaysPut = true;',
      '// frontx:endregion other-template:extra',
    ].join('\n');

    const computeResult = await computeChangeSet(PROJ_ROOT, '2.1.0', {
      readProvenance: async () => REGION_PROVENANCE,
      fetchFn,
      readProjectFile: async (p) => (p === `${PROJ_ROOT}/${SHARED_PATH}` ? projectFileContent : null),
      readContentItems,
    });

    expect(computeResult.ok).toBe(true);
    const changeSet = (computeResult as Extract<typeof computeResult, { ok: true }>).changeSet;
    const regionEntry = changeSet.clean.find((e) => e.path === SHARED_PATH);
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionKey).toBe('setup');
    // Only the owned region's NEW content is carried — not the whole file.
    expect(regionEntry!.content).toContain('setupV2');
    expect(regionEntry!.content).not.toContain('otherStaysPut');

    // Apply: only this template's region is rewritten in the shared file;
    // the co-owning template's region is left byte-for-byte untouched.
    const files = new Map<string, string>([
      [`${PROJ_ROOT}/${SHARED_PATH}`, projectFileContent],
      [`${PROJ_ROOT}/.frontx/provenance.json`, JSON.stringify(REGION_PROVENANCE, null, 2)],
    ]);

    const applyResult = await applyChangeSet(changeSet, PROJ_ROOT, REGION_PROVENANCE, {
      readProjectFile: async (p) => files.get(p) ?? null,
      writeProjectFile: async (p, c) => { files.set(p, c); },
      removeProjectFile: async (p) => { files.delete(p); },
      writeProvenance: async (p, c) => { files.set(p, c); },
    });

    expect(applyResult.ok).toBe(true);
    const appliedContent = files.get(`${PROJ_ROOT}/${SHARED_PATH}`)!;
    expect(appliedContent).toContain('setupV2');
    expect(appliedContent).not.toContain('setupV1');
    // Co-owning template's region is byte-for-byte unchanged.
    expect(appliedContent).toContain('// frontx:region other-template:extra');
    expect(appliedContent).toContain('const otherStaysPut = true;');
    expect(appliedContent).toContain('// frontx:endregion other-template:extra');
  });
});
