// @cpt-flow:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1
// @cpt-state:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
import { enrichUpgradeChangeSet } from './enrich.js';
import { OrchestrationLifecycleState, type OrchestrationLifecycleStateValue } from './state.js';
import type {
  ApplyChangeSetFn,
  ComputeChangeSetFn,
  EnrichedReviewPackage,
  PresentEnrichedReviewFn,
  ProjectSnapshot,
  ReadProjectFileFn,
  ReadProvenanceFn,
  RemoveProjectFileFn,
  VersionedLookupFn,
  WriteProjectFileFn,
  WriteProvenanceFn,
} from './types.js';

// All dependencies are injected. `computeChangeSet` and `applyChangeSet` MUST be
// the exact F14 engine functions exported by `@gears-frontx/cli` — this layer
// orchestrates and enriches that single engine, it never reimplements it
// (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
export interface OrchestrationDeps {
  readProvenance: ReadProvenanceFn;
  computeChangeSet: ComputeChangeSetFn;
  applyChangeSet: ApplyChangeSetFn;
  lookupByVersion: VersionedLookupFn;
  readProjectFile: ReadProjectFileFn;
  writeProjectFile: WriteProjectFileFn;
  removeProjectFile: RemoveProjectFileFn;
  writeProvenance: WriteProvenanceFn;
  presentEnrichedReview: PresentEnrichedReviewFn;
}

export type OrchestrationResult =
  | { status: 'applied'; targetVersion: string; snapshot: ProjectSnapshot; reviewPackage: EnrichedReviewPackage }
  | { status: 'declined'; reviewPackage: EnrichedReviewPackage }
  | { status: 'provenance-missing'; message: string }
  | { status: 'empty-changeset' }
  | { status: 'apply-failed'; message: string };

// @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-request-upgrade
/**
 * AI-driven upgrade orchestration: reads project provenance, drives the SINGLE
 * F14 CLI change-set engine, enriches its output with change-impact analysis
 * and downstream-effect assessment, enforces an unconditional review gate
 * before any apply, and applies or declines
 * (cpt-frontx-flow-ai-upgrade-orchestration-upgrade).
 */
export async function orchestrateAiDrivenUpgrade(
  projectRoot: string,
  targetVersion: string,
  deps: OrchestrationDeps,
): Promise<OrchestrationResult> {
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-request-upgrade

  let lifecycleState: OrchestrationLifecycleStateValue = OrchestrationLifecycleState.PROVENANCE_READ;

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-read-provenance
  const provenance = await deps.readProvenance(projectRoot);
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-read-provenance

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-provenance
  if (!provenance) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-missing
    return {
      status: 'provenance-missing',
      message: 'No provenance record found in project — AI-driven upgrade cannot proceed.',
    };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-missing
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-provenance

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-invoke-enrichment
  const enrichment = await enrichUpgradeChangeSet(projectRoot, provenance, targetVersion, {
    computeChangeSet: deps.computeChangeSet,
    lookupByVersion: deps.lookupByVersion,
    readProjectFile: deps.readProjectFile,
  });
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-invoke-enrichment

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-changeset
  if (enrichment.status === 'empty') {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-empty-changeset
    return { status: 'empty-changeset' };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-empty-changeset
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-changeset

  // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-analyzed
  lifecycleState = OrchestrationLifecycleState.ANALYZED;
  // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-analyzed

  const reviewPackage = enrichment.package;

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-present-review
  const decision = await deps.presentEnrichedReview(reviewPackage);
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-present-review

  // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-reviewed
  lifecycleState = OrchestrationLifecycleState.REVIEWED;
  // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-reviewed

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-approve
  if (decision === 'approved') {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-engine-apply
    const applyResult = await deps.applyChangeSet(reviewPackage.changeSet, projectRoot, provenance, {
      readProjectFile: deps.readProjectFile,
      writeProjectFile: deps.writeProjectFile,
      removeProjectFile: deps.removeProjectFile,
      writeProvenance: deps.writeProvenance,
    });
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-engine-apply

    if (!applyResult.ok) {
      return { status: 'apply-failed', message: applyResult.message };
    }

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-update-provenance
    // Provenance is updated to the newer template version inside applyChangeSet
    // (the F14 engine) — cpt-frontx-dod-ai-upgrade-orchestration-single-engine.
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-update-provenance

    // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-applied
    lifecycleState = OrchestrationLifecycleState.APPLIED;
    // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-applied

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-applied
    return { status: 'applied', targetVersion, snapshot: applyResult.snapshot, reviewPackage };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-applied
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-approve

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-decline
  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-no-write
  // Decline or flagged incompatibility: no engine apply is invoked, so no
  // project files are written and the project remains at its current version.
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-no-write

  // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-declined
  lifecycleState = OrchestrationLifecycleState.DECLINED;
  // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-declined

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-declined
  void lifecycleState; // lifecycle state held for observability
  return { status: 'declined', reviewPackage };
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-declined
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-decline
}
