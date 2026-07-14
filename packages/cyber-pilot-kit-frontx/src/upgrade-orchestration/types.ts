// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// This module never defines its own diff/apply logic. `ComputeChangeSetFn` and
// `ApplyChangeSetFn` are structural aliases of the exact function types exported
// by `@gears-frontx/cli` (the F14 single change-set engine) so that any deps
// object satisfying these types is, by construction, invoking that one engine —
// there is no second implementation to diverge from it
// (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
import type {
  ChangeSet,
  ProvenanceRecord,
  ProjectSnapshot,
  ReadProvenanceFn,
  VersionedLookupFn,
  ReadProjectFileFn,
  WriteProjectFileFn,
  RemoveProjectFileFn,
  WriteProvenanceFn,
  computeChangeSet,
  applyChangeSet,
} from '@gears-frontx/cli';

export type {
  ChangeSet,
  ProvenanceRecord,
  ProjectSnapshot,
  ReadProvenanceFn,
  VersionedLookupFn,
  ReadProjectFileFn,
  WriteProjectFileFn,
  RemoveProjectFileFn,
  WriteProvenanceFn,
};

// The SINGLE F14 engine's public invocation surface, driven (never reimplemented) by this kit.
export type ComputeChangeSetFn = typeof computeChangeSet;
export type ApplyChangeSetFn = typeof applyChangeSet;

// @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1:inst-impact-types
export interface ChangeImpactEntry {
  path: string;
  kind: 'add' | 'modify' | 'remove';
  requiresAttention: boolean;
}

export interface ChangeImpactAnalysis {
  entries: ChangeImpactEntry[];
}
// @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1:inst-impact-types

// @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1:inst-downstream-types
export interface DownstreamEffectAssessment {
  incompatibilities: string[];
}
// @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1:inst-downstream-types

// @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1:inst-enriched-package-type
export interface EnrichedReviewPackage {
  changeSet: ChangeSet;
  impactAnalysis: ChangeImpactAnalysis;
  downstreamAssessment: DownstreamEffectAssessment;
}
// @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1:inst-enriched-package-type

export type EnrichmentResult =
  | { status: 'enriched'; package: EnrichedReviewPackage }
  | { status: 'empty' };

export type ReviewDecision = 'approved' | 'declined';

// @cpt-begin:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1:inst-present-review-fn-type
// The review gate is presented by this injected function; the caller (AI agent /
// developer-facing surface) decides approve/decline. No apply happens until it
// returns 'approved' (cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced).
export type PresentEnrichedReviewFn = (reviewPackage: EnrichedReviewPackage) => Promise<ReviewDecision>;
// @cpt-end:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1:inst-present-review-fn-type
