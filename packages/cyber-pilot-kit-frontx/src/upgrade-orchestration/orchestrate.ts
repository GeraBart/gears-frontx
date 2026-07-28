// @cpt-flow:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1
// @cpt-state:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// PLAN CORRECTION (2026-07-14) — REOPENED: this module MUST NOT import
// the CLI package and MUST NOT link the F14 engine's `computeChangeSet`/
// `applyChangeSet` exports. It drives the SINGLE engine strictly through the
// injected `invokeUpgradeCommand` — the `frontx upgrade` COMMAND/INVOCATION
// SURFACE (`InvokeUpgradeCommandFn`) — never a compile-time package
// dependency (DESIGN §3.4; ADR-0027 `cpt-frontx-adr-ai-driven-upgrade-orchestration`).
import { enrichUpgradeChangeSet } from './enrich.js';
import { selectProvenanceRecord } from './types.js';
import type {
  ChangeSet,
  EnrichedReviewPackage,
  InvokeUpgradeCommandFn,
  PresentEnrichedReviewFn,
  ReadProvenanceFn,
  ReviewDecision,
} from './types.js';

// All dependencies are injected. `invokeUpgradeCommand` MUST drive the F14
// engine strictly through the `frontx upgrade` command/invocation surface —
// this layer orchestrates and enriches that single engine, it never
// reimplements it and never imports it as a package
// (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
export interface OrchestrationDeps {
  readProvenance: ReadProvenanceFn;
  invokeUpgradeCommand: InvokeUpgradeCommandFn;
  presentEnrichedReview: PresentEnrichedReviewFn;
}

export type OrchestrationResult =
  | { status: 'applied'; targetVersion: string; reviewPackage: EnrichedReviewPackage }
  | { status: 'declined'; reviewPackage: EnrichedReviewPackage }
  | { status: 'provenance-missing'; message: string }
  | { status: 'empty-changeset' }
  | { status: 'apply-failed'; message: string };

// @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-request-upgrade
/**
 * AI-driven upgrade orchestration: reads the project's provenance record SET
 * and selects the NAMED applied template to upgrade, drives the SINGLE F14
 * CLI change-set engine through its `frontx upgrade` command surface,
 * enriches its output with change-impact analysis and downstream-effect
 * assessment, enforces an unconditional review gate before any apply, and
 * applies or declines (cpt-frontx-flow-ai-upgrade-orchestration-upgrade).
 *
 * `appliedTemplateName` is the applied template's identity as recorded in
 * its own provenance record (`inst-request-upgrade`) — the developer either
 * names it directly or the AI first lists the applied templates from
 * provenance so one can be chosen.
 */
export async function orchestrateAiDrivenUpgrade(
  projectRoot: string,
  appliedTemplateName: string,
  targetVersion: string,
  deps: OrchestrationDeps,
): Promise<OrchestrationResult> {
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-request-upgrade

  // State: PROVENANCE_READ

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-read-provenance
  // Reads the FULL provenance record SET (one record per applied template —
  // `cpt-frontx-contract-project-provenance`), never a single
  // whole-repository origin record.
  const provenanceSet = await deps.readProvenance(projectRoot);
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-read-provenance

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-provenance
  // Selects the record for the NAMED applied template from the set; absent
  // when provenance is unreadable OR the set holds no matching record.
  const selectedRecord = provenanceSet ? selectProvenanceRecord(provenanceSet, appliedTemplateName) : undefined;
  if (!selectedRecord) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-missing
    return {
      status: 'provenance-missing',
      message: provenanceSet
        ? `No provenance record found for applied template "${appliedTemplateName}" — AI-driven upgrade cannot proceed.`
        : 'No provenance record set found in project — AI-driven upgrade cannot proceed.',
    };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-missing
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-provenance

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-extract-provenance
  // Extract the SELECTED applied template's identity and current version
  // from its provenance record — the command surface receives only
  // projectRoot/targetVersion and resolves its own provenance internally
  // when computing the change set; this orchestration layer's extraction is
  // what makes the enriched review package reflect the SELECTED template.
  const { templateIdentity, scaffoldedFromVersion } = selectedRecord;
  const selectedTemplate = { templateIdentity, currentVersion: scaffoldedFromVersion };
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-extract-provenance

  let reviewPackage: EnrichedReviewPackage | undefined;
  let sawEmptyChangeSet = false;

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-invoke-enrichment
  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-invoke-engine
  const commandResult = await deps.invokeUpgradeCommand(projectRoot, targetVersion, async (changeSet: ChangeSet) => {
    // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-invoke-engine
    // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-receive-changeset
    const enrichment = enrichUpgradeChangeSet(changeSet, selectedTemplate);
    // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-receive-changeset

    if (enrichment.status === 'empty') {
      sawEmptyChangeSet = true;
      // The command surface still requires a decision; declining is a safe
      // no-op signal — the empty-changeset short-circuit below is what the
      // caller actually observes.
      return 'declined' satisfies ReviewDecision;
    }

    reviewPackage = enrichment.package;

    // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-analyzed
    // Transition: PROVENANCE_READ → ANALYZED
    // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-analyzed

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-present-review
    const decision = await deps.presentEnrichedReview(reviewPackage);
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-present-review

    // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-reviewed
    // Transition: ANALYZED → REVIEWED
    // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-reviewed

    return decision;
  });
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-invoke-enrichment

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-changeset
  if (sawEmptyChangeSet || !reviewPackage) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-empty-changeset
    return { status: 'empty-changeset' };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-empty-changeset
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-changeset

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-approve
  if (commandResult.status === 'applied') {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-engine-apply
    // The engine apply step (writing project files non-destructively) is
    // triggered by the command surface itself, strictly after the developer
    // approval this orchestration layer returned above — never before it.
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-engine-apply

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-update-provenance
    // Provenance is updated to the newer template version inside the engine's
    // apply step, behind the command surface — cpt-frontx-dod-ai-upgrade-orchestration-single-engine.
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-update-provenance

    // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-applied
    // Transition: REVIEWED → APPLIED
    // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-applied

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-applied
    return { status: 'applied', targetVersion, reviewPackage };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-applied
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-approve

  if (commandResult.status === 'apply-failed') {
    return { status: 'apply-failed', message: commandResult.message ?? 'Engine apply failed.' };
  }

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-decline
  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-no-write
  // Decline or flagged incompatibility: the command surface's engine apply
  // step was never triggered, so no project files are written and the
  // project remains at its current version.
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-no-write

  // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-declined
  // Transition: REVIEWED → DECLINED
  // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-declined

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-declined
  return { status: 'declined', reviewPackage };
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-declined
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-decline
}
