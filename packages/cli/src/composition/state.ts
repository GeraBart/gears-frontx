// @cpt-state:cpt-frontx-state-composed-provenance-composition-resolution:p1
//
// States: DECLARED, RESOLVING, RESOLVED, CONFLICT_CHECKED, SCAFFOLDED, ABORTED.
// Initial state: DECLARED. `ABORTED` is the single FEATURE-named terminal
// error state (reached from RESOLVING on an unresolvable reference or
// reference cycle, and from RESOLVED on a same-target-path boundary
// conflict). Transition instruction markers (`inst-transition-*`) live at
// their call sites in `../scaffold/composed.ts`, where the state-machine
// driver actually runs — this enum only declares the possible states,
// mirroring the sibling convention in `../scaffold/state.ts`
// (`AssemblyOpState`), which carries no begin/end blocks of its own either.
export enum CompositionResolutionState {
  DECLARED         = 'DECLARED',
  RESOLVING        = 'RESOLVING',
  RESOLVED         = 'RESOLVED',
  CONFLICT_CHECKED = 'CONFLICT_CHECKED',
  SCAFFOLDED       = 'SCAFFOLDED',
  ABORTED          = 'ABORTED',
}
