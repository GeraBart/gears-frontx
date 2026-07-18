import type { InventoryEntry } from '../inventory/types';
import type { OwnershipBoundary } from '../manifest/types';
import { uniformApply } from './assembler';
import type { ReadContentItemsFn, StagedAssembly } from './types';

// @cpt-state:cpt-frontx-state-cli-scaffolding-assembly-op:p2
export enum AssemblyOpState {
  REQUESTED        = 'REQUESTED',
  RESOLVED         = 'RESOLVED',
  CONFLICT_CHECKED = 'CONFLICT_CHECKED',
  ASSEMBLED        = 'ASSEMBLED',
  ABORTED          = 'ABORTED',
}

export type AssemblyAbortReason =
  | { reason: 'unresolved'; templateRef: string; message: string }
  | { reason: 'manifest-unreadable'; templateRef: string; message: string }
  | { reason: 'conflict'; conflicts: BoundaryConflictEntry[]; message: string };

export type AssemblyOpResult =
  | { state: AssemblyOpState.ASSEMBLED; assembly: StagedAssembly }
  | { state: AssemblyOpState.ABORTED; abort: AssemblyAbortReason };

export interface BoundaryConflictEntry {
  ground: string;
  contestants: string[];
}

// The pre-flight conflict check's verdict shape. The RESOLVED → CONFLICT_CHECKED
// / RESOLVED → ABORTED transitions are decided by this verdict — this phase
// models the transition boundary as a SEAM (the `conflictVerdictFn` parameter
// below); the checker itself is implemented by P29
// (cpt-frontx-algo-cli-scaffolding-conflict-check), NOT here.
export type ConflictVerdict =
  | { ok: true }
  | { ok: false; conflicts: BoundaryConflictEntry[] };

export type ConflictVerdictFn = (
  assembly: StagedAssembly,
  alreadyOccupiedBoundaries: OwnershipBoundary[],
) => ConflictVerdict | Promise<ConflictVerdict>;

// Materializes a cleared, staged assembly into the target repository. Actual
// file/provenance writing is owned by the entry flows (P30) and
// composed-provenance (F13) — this phase only models the state transition
// boundary via this injected seam.
export type MaterializeAssemblyFn = (assembly: StagedAssembly) => Promise<void>;

export interface AssemblyOpInput {
  templateRefs: string[];
  targetHoldsAppliedTemplates: boolean;
  lookupFn: (name: string) => InventoryEntry | undefined;
  readContentFn: ReadContentItemsFn;
  alreadyOccupiedBoundaries: OwnershipBoundary[];
  conflictVerdictFn: ConflictVerdictFn;
  materializeFn: MaterializeAssemblyFn;
}

/**
 * Drives the assembly-op state machine: REQUESTED → RESOLVED →
 * CONFLICT_CHECKED → ASSEMBLED, or REQUESTED/RESOLVED → ABORTED. The same
 * driver runs for both seed and add (`cpt-frontx-algo-cli-scaffolding-uniform-apply`
 * is the ONE apply path) — `targetHoldsAppliedTemplates` and
 * `alreadyOccupiedBoundaries` are empty for a seed.
 */
export async function runAssemblyOp(input: AssemblyOpInput): Promise<AssemblyOpResult> {
  // FROM REQUESTED — every referenced template must be located in the local
  // inventory (via the shared resolver) and staged as an assembly to reach
  // RESOLVED; an unresolvable reference aborts before anything is staged.
  const applyResult = await uniformApply(
    input.templateRefs,
    input.targetHoldsAppliedTemplates,
    input.lookupFn,
    input.readContentFn,
  );

  if (!applyResult.ok) {
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-aborted-unresolved
    return {
      state: AssemblyOpState.ABORTED,
      abort: { reason: applyResult.reason, templateRef: applyResult.templateRef, message: applyResult.message },
    };
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-aborted-unresolved
  }

  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-resolved
  const assembly = applyResult.assembly;
  // REQUESTED → RESOLVED: every referenced template resolved and staged.
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-resolved

  // FROM RESOLVED — the pre-flight conflict check's verdict (the P29 seam)
  // decides CONFLICT_CHECKED (no intersecting boundary claim) vs ABORTED
  // (an intersecting claim; no files written).
  const verdict = await input.conflictVerdictFn(assembly, input.alreadyOccupiedBoundaries);

  if (!verdict.ok) {
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-aborted-conflict
    return {
      state: AssemblyOpState.ABORTED,
      abort: {
        reason: 'conflict',
        conflicts: verdict.conflicts,
        message: 'Apply aborted — the staged assembly has an intersecting ownership-boundary claim; no files written.',
      },
    };
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-aborted-conflict
  }

  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-checked
  // RESOLVED → CONFLICT_CHECKED: no intersecting boundary claim found.
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-checked

  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-checked-assembled
  await input.materializeFn(assembly);
  // CONFLICT_CHECKED → ASSEMBLED: the cleared assembly is materialized.
  return { state: AssemblyOpState.ASSEMBLED, assembly };
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-checked-assembled
}
