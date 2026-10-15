// The one internal adaptation entry point `ExtensionRouter` and
// `navigation()` call (FEATURE (engine-provider) §1.5; §3, History
// Adaptation, step 1): given an entry address, it adapts from that
// occupant's own entry (`./composed-history-source.js`); given none, in the
// shell runtime, from the shell's subroute, the pathname
// (`./shell-history-source.js`). Every derivation past this selection —
// router construction, mount, `createHref`, `block` — runs identically in
// both cases, since `RouterHistory` is the same shape either way.
import type { EntryAddress, NavigationHistory } from '@gears-frontx/routing';
import type { RouterHistory } from '@tanstack/react-router';
import { adaptComposedHistory } from './composed-history-source.js';
import { adaptShellHistory } from './shell-history-source.js';
import type { AdaptHistoryOptions } from './history-adaptation.js';

/**
 * Adapts `navigationHistory` into a `RouterHistory`, projecting from
 * `entryAddress`'s own entry when supplied, or from the shell's subroute
 * (the pathname) when it is not — the same route tree and the same
 * adaptation logic run in both cases (FEATURE §6, "Mode selection").
 */
// This function is also the default provider's own worked instance of the
// Swap-The-Router-Engine flow's step 3 ("adapt-history"): replacing the
// provider means replacing the call this function represents — marked at
// each of its two return statements below, the actual adapt call in each
// case.
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2
// @cpt-flow:cpt-frontx-flow-routing-engine-provider-swap-engine:p1
export function adaptProviderHistory(
  navigationHistory: NavigationHistory,
  entryAddress: EntryAddress | undefined,
  options?: AdaptHistoryOptions,
): RouterHistory {
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location
  if (entryAddress === undefined) {
    // @cpt-begin:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-adapt-history
    return adaptShellHistory(navigationHistory, options);
    // @cpt-end:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-adapt-history
  }
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location
  // @cpt-begin:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-adapt-history
  return adaptComposedHistory(navigationHistory, entryAddress, options);
  // @cpt-end:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-adapt-history
}
