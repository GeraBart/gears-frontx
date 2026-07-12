// @cpt-flow:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1
// @cpt-state:cpt-frontx-state-composed-provenance-composition-resolution:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-composition-delivered:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1
import type { InventoryEntry } from '../inventory/types.js';
import { readManifestFromContent } from '../manifest/validate-contract.js';
import { resolveComposition } from '../composition/resolve.js';
import { CompositionResolutionState } from '../composition/state.js';
import { writeProvenance } from '../provenance/write.js';
import type { ProvenanceWriteFn } from '../provenance/types.js';
import type { ConflictCheckFn, WriteFileFn } from './types.js';

export type ComposedScaffoldResult =
  | { ok: true; message: string; provenanceLocation: string }
  | {
      ok: false;
      reason: 'registry-unreachable' | 'collision' | 'cycle' | 'resolve-error' | 'conflict' | 'provenance-failed';
      message: string;
    };

// @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-issue-scaffold
/**
 * Scaffold a composed project template: resolves the full composition tree,
 * writes all files under nearest-declaration-wins semantics, then records
 * provenance so the project can be updated or audited later.
 */
export async function scaffoldComposedProject(
  templateRef: string,
  targetDir: string,
  lookupFn: (name: string) => InventoryEntry | undefined,
  conflictCheckFn: ConflictCheckFn,
  writeFileFn: WriteFileFn,
  provenanceWriteFn: ProvenanceWriteFn,
): Promise<ComposedScaffoldResult> {
// @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-issue-scaffold

  // State: DECLARED → tracks composition resolution lifecycle for traceability
  // @cpt-begin:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-declared-resolving
  const stateTrace: CompositionResolutionState[] = [CompositionResolutionState.DECLARED];
  // @cpt-end:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-declared-resolving

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-resolve-root-template
  const rootEntry = lookupFn(templateRef);
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-resolve-root-template

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-check-registry-reach
  if (!rootEntry) {
    // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-abort-registry
    return {
      ok: false,
      reason: 'registry-unreachable',
      message: `Scaffold aborted — template "${templateRef}" not found in local inventory.`,
    };
    // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-abort-registry
  }
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-check-registry-reach

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-read-manifest
  const manifestResult = readManifestFromContent(rootEntry.content);
  if (!manifestResult.ok) {
    return {
      ok: false,
      reason: 'registry-unreachable',
      message: `Cannot read manifest for "${templateRef}": ${manifestResult.message}`,
    };
  }
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-read-manifest

  // Transition: DECLARED → RESOLVING
  stateTrace.push(CompositionResolutionState.RESOLVING);

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-invoke-resolution
  const compositionResult = resolveComposition(
    manifestResult.manifest,
    templateRef,
    new Set<string>(),
    0,
    null,
    lookupFn,
  );
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-invoke-resolution

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-check-resolution-error
  if (!compositionResult.ok) {
    // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-abort-resolution-error
    // @cpt-begin:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-resolving-collision-aborted
    stateTrace.push(CompositionResolutionState.COLLISION_ABORTED);
    // @cpt-end:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-resolving-collision-aborted
    return {
      ok: false,
      reason: compositionResult.reason,
      message:
        compositionResult.reason === 'collision'
          ? `Scaffold aborted — composition collision on: ${compositionResult.collisions.map((c) => c.path).join(', ')}`
          : compositionResult.reason === 'cycle'
            ? `Scaffold aborted — cycle detected in composition graph: ${compositionResult.path.join(' → ')}`
            : `Scaffold aborted — ${compositionResult.message}`,
    };
    // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-abort-resolution-error
  }
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-check-resolution-error

  // Transition: RESOLVING → RESOLVED
  // @cpt-begin:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-resolving-resolved
  stateTrace.push(CompositionResolutionState.RESOLVED);
  // @cpt-end:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-resolving-resolved

  const hasConflict = await conflictCheckFn(targetDir);
  if (hasConflict) {
    return {
      ok: false,
      reason: 'conflict',
      message: `Scaffold aborted — target directory "${targetDir}" contains conflicting content.`,
    };
  }

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-scaffold-composition
  for (const [, fileEntry] of compositionResult.files) {
    await writeFileFn(`${targetDir}/${fileEntry.path}`, fileEntry.content);
  }
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-scaffold-composition

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-invoke-provenance-write
  const provenanceResult = await writeProvenance(
    {
      templateIdentity: templateRef,
      scaffoldedFromVersion: manifestResult.manifest.version,
      sourceSpec: rootEntry.source,
    },
    targetDir,
    provenanceWriteFn,
  );
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-invoke-provenance-write

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-check-provenance-write-fail
  if (!provenanceResult.ok) {
    // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-report-provenance-fail
    return {
      ok: false,
      reason: 'provenance-failed',
      message: `Scaffold completed but provenance write failed: ${provenanceResult.message}`,
    };
    // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-report-provenance-fail
  }
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-check-provenance-write-fail

  // inst-activate-kit: stub — kit package not yet available; activation deferred to Pillar 3

  // @cpt-begin:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-resolved-scaffolded
  stateTrace.push(CompositionResolutionState.SCAFFOLDED);
  // @cpt-end:cpt-frontx-state-composed-provenance-composition-resolution:p1:inst-transition-resolved-scaffolded

  // @cpt-begin:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-return-success
  return {
    ok: true,
    message: `Scaffold complete — composed project written to "${targetDir}".`,
    provenanceLocation: provenanceResult.location,
  };
  // @cpt-end:cpt-frontx-flow-composed-provenance-scaffold-composed-project:p1:inst-return-success
}
