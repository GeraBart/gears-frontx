// @cpt-algo:cpt-frontx-algo-upgrade-changeset-compute:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-computation:p1
import { readManifestFromContent } from '../manifest/validate-contract';
import type { ReadContentItemsFn } from '../scaffold/types';
import type {
  ChangeSet,
  CleanEntry,
  ConflictEntry,
  ProvenanceRecord,
  ReadProvenanceFn,
  ReadProjectFileFn,
  VersionedLookupFn,
} from './types';

export type ComputeResult =
  | { ok: true; changeSet: ChangeSet; provenance: ProvenanceRecord }
  | {
      ok: false;
      reason: 'no-provenance' | 'baseline-not-found' | 'target-not-found' | 'manifest-error';
      message: string;
    };

// @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-read-provenance
export async function computeChangeSet(
  projectRoot: string,
  targetVersion: string,
  deps: {
    readProvenance: ReadProvenanceFn;
    lookupByVersion: VersionedLookupFn;
    readProjectFile: ReadProjectFileFn;
    readContentItems: ReadContentItemsFn;
  },
): Promise<ComputeResult> {
  const provenance = await deps.readProvenance(projectRoot);
  if (!provenance) {
    return {
      ok: false,
      reason: 'no-provenance',
      message: 'No provenance record found in project — cannot compute upgrade.',
    };
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-read-provenance

  const { templateIdentity, scaffoldedFromVersion } = provenance;

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-resolve-baseline
  const baselineEntry = deps.lookupByVersion(templateIdentity, scaffoldedFromVersion);
  if (!baselineEntry) {
    return {
      ok: false,
      reason: 'baseline-not-found',
      message: `Baseline template "${templateIdentity}@${scaffoldedFromVersion}" not found in local inventory.`,
    };
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-resolve-baseline

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-resolve-target
  const targetEntry = deps.lookupByVersion(templateIdentity, targetVersion);
  if (!targetEntry) {
    return {
      ok: false,
      reason: 'target-not-found',
      message: `Target template "${templateIdentity}@${targetVersion}" not found in local inventory.`,
    };
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-resolve-target

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-diff-files
  // Manifests are still read to confirm each is well-formed before diffing;
  // they carry no content — content items are read directly from each
  // entry's resolved on-disk installed content path (never from the manifest).
  const baselineResult = readManifestFromContent(baselineEntry.content);
  const targetResult = readManifestFromContent(targetEntry.content);

  if (!baselineResult.ok || !targetResult.ok) {
    return { ok: false, reason: 'manifest-error', message: 'Failed to parse template manifest.' };
  }

  const baselineItems = await deps.readContentItems(baselineEntry);
  const targetItems = await deps.readContentItems(targetEntry);

  const baselineFiles = new Map<string, string>(baselineItems.map((f) => [f.path, f.content]));
  const targetFiles = new Map<string, string>(targetItems.map((f) => [f.path, f.content]));
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-diff-files

  const clean: CleanEntry[] = [];
  const conflicts: ConflictEntry[] = [];

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-for-each-file
  // Files added or modified in the target version
  for (const [filePath, targetContent] of targetFiles) {
    const baselineContent = baselineFiles.get(filePath);
    const absolutePath = `${projectRoot}/${filePath}`;

    if (baselineContent === undefined) {
      // File added in target — check if project already has it (would be a conflict)
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-check-local-mod
      const localContent = await deps.readProjectFile(absolutePath);
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-check-local-mod
      if (localContent !== null) {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-if-conflict
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-flag-conflict
        conflicts.push({ path: filePath, templateKind: 'add', templateContent: targetContent, localContent });
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-flag-conflict
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-if-conflict
      } else {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-else-clean
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-add-clean-entry
        clean.push({ kind: 'add', path: filePath, content: targetContent });
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-add-clean-entry
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-else-clean
      }
    } else if (baselineContent !== targetContent) {
      // File content changed in target — check for local developer modification
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-check-local-mod
      const localContent = await deps.readProjectFile(absolutePath);
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-check-local-mod
      if (localContent !== null && localContent !== baselineContent) {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-if-conflict
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-flag-conflict
        conflicts.push({ path: filePath, templateKind: 'modify', templateContent: targetContent, localContent });
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-flag-conflict
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-if-conflict
      } else {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-else-clean
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-add-clean-entry
        clean.push({ kind: 'modify', path: filePath, content: targetContent });
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-add-clean-entry
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-else-clean
      }
    }
  }

  // Files removed in the target version (present in baseline but absent in target)
  for (const [filePath, baselineContent] of baselineFiles) {
    if (!targetFiles.has(filePath)) {
      const absolutePath = `${projectRoot}/${filePath}`;
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-check-local-mod
      const localContent = await deps.readProjectFile(absolutePath);
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-check-local-mod
      if (localContent !== null && localContent !== baselineContent) {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-if-conflict
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-flag-conflict
        conflicts.push({ path: filePath, templateKind: 'remove', localContent });
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-flag-conflict
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-if-conflict
      } else {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-else-clean
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-add-clean-entry
        clean.push({ kind: 'remove', path: filePath });
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-add-clean-entry
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-else-clean
      }
    }
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-for-each-file

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-return-changeset
  return {
    ok: true,
    provenance,
    changeSet: {
      templateIdentity,
      baselineVersion: scaffoldedFromVersion,
      targetVersion,
      clean,
      conflicts,
    },
  };
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-compute:p1:inst-cmp-return-changeset
}
