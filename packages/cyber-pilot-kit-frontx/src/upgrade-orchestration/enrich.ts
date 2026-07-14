// @cpt-algo:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
import type {
  ChangeSet,
  ChangeImpactAnalysis,
  ChangeImpactEntry,
  DownstreamEffectAssessment,
  EnrichmentResult,
  ProvenanceRecord,
  ComputeChangeSetFn,
  VersionedLookupFn,
  ReadProjectFileFn,
} from './types.js';

export interface EnrichmentDeps {
  // Invokes the SINGLE F14 change-set engine — never a second implementation
  // (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
  computeChangeSet: ComputeChangeSetFn;
  lookupByVersion: VersionedLookupFn;
  readProjectFile: ReadProjectFileFn;
}

// @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-impact-analysis
/**
 * Change-impact analysis: which project files are affected, what kind of
 * change each represents, and whether it requires developer attention before
 * apply (a conflict against local developer modifications always does).
 */
export function computeChangeImpact(changeSet: ChangeSet): ChangeImpactAnalysis {
  const entries: ChangeImpactEntry[] = [
    ...changeSet.clean.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      requiresAttention: false,
    })),
    ...changeSet.conflicts.map((entry) => ({
      path: entry.path,
      kind: entry.templateKind,
      requiresAttention: true,
    })),
  ];
  return { entries };
}
// @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-impact-analysis

// @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-downstream-assess
/**
 * Downstream-effect assessment: surfaces incompatibilities between the
 * proposed template change set and the project's local modifications, so the
 * developer can decline at the review gate rather than discover them post-apply.
 */
export function computeDownstreamEffects(changeSet: ChangeSet): DownstreamEffectAssessment {
  const incompatibilities = changeSet.conflicts.map(
    (conflict) =>
      `Local modification at "${conflict.path}" conflicts with the template's ${conflict.templateKind} change — manual reconciliation is required.`,
  );
  return { incompatibilities };
}
// @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-downstream-assess

// @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-extract-provenance
/**
 * Drives the single F14 CLI change-set engine and enriches its output with
 * change-impact analysis and downstream-effect assessment
 * (cpt-frontx-algo-ai-upgrade-orchestration-enrich).
 */
export async function enrichUpgradeChangeSet(
  projectRoot: string,
  provenance: ProvenanceRecord,
  targetVersion: string,
  deps: EnrichmentDeps,
): Promise<EnrichmentResult> {
  // Provenance was already read by the caller (flow inst-read-provenance) — reuse
  // it here rather than re-reading, and hand it to the engine's own compute step.
  const { templateIdentity, scaffoldedFromVersion } = provenance;
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-extract-provenance

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-invoke-engine
  const computeResult = await deps.computeChangeSet(projectRoot, targetVersion, {
    readProvenance: async () => provenance,
    lookupByVersion: deps.lookupByVersion,
    readProjectFile: deps.readProjectFile,
  });
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-invoke-engine

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-receive-changeset
  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-check-empty
  if (!computeResult.ok) {
    // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-empty-signal
    return { status: 'empty' };
    // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-empty-signal
  }

  const { changeSet } = computeResult;
  if (changeSet.clean.length === 0 && changeSet.conflicts.length === 0) {
    // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-empty-signal
    return { status: 'empty' };
    // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-empty-signal
  }
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-check-empty
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-receive-changeset

  // Extracted values are used only to select the engine invocation above; kept
  // referenced for observability at the call boundary.
  void templateIdentity;
  void scaffoldedFromVersion;

  const impactAnalysis = computeChangeImpact(changeSet);
  const downstreamAssessment = computeDownstreamEffects(changeSet);

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-combine-results
  const enriched = { changeSet, impactAnalysis, downstreamAssessment };
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-combine-results

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-return-enriched
  return { status: 'enriched', package: enriched };
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-return-enriched
}
