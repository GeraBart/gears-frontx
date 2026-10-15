// Own-Subroute Navigation Outside The Rendered Tree —
// `cpt-frontx-algo-routing-engine-provider-navigation`.
//
// FEATURE (engine-provider) §2, "Reach The Own Subroute From Code Outside The
// Rendered Tree"; §3, "Own-Subroute Navigation Outside The Rendered Tree".
// Code outside the rendered tree, such as an action handler, reads and
// changes the calling runtime's own private subroute: an extension's own
// entry, or, in the shell runtime, the shell's subroute (the pathname).
import { resolveNavigationHistory, router } from '@gears-frontx/routing';
import type { RouterHistory } from '@tanstack/react-router';
import { adaptProviderHistory } from './engine-provider-history.js';

/** The calling runtime's own private subroute, outside the rendered tree. */
export interface Navigation {
  /** Pushes `path` onto the runtime's own private subroute. */
  navigate(path: string): void;
  /** Replaces the runtime's own private subroute with `path`. */
  replace(path: string): void;
  /** The runtime's own private subroute as `{ pathname, search }`. */
  location(): { pathname: string; search: string };
}

/**
 * A fresh adapted history over the calling runtime's own private subroute,
 * built at each member's own call and never mounted, so it registers no
 * subscription and reads the current location at that call. The entry
 * address is read only from the ready FrontX router; in an extension
 * runtime without router access that read throws, and the member refuses
 * with it.
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-navigation:p2
// @cpt-begin:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-fresh-per-call
// @cpt-begin:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-private-subroute
function ownSubrouteHistory(): RouterHistory {
  return adaptProviderHistory(resolveNavigationHistory(), router.ownEntryAddress());
}
// @cpt-end:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-private-subroute
// @cpt-end:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-fresh-per-call

/**
 * `navigate(path)`, `replace(path)` and `location()` over the calling
 * runtime's own private subroute, exposing neither the FrontX router, the
 * occupant value, nor the raw shared history.
 */
// @cpt-flow:cpt-frontx-flow-routing-engine-provider-own-subroute-navigation:p1
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-navigation:p1
export function navigation(): Navigation {
  // @cpt-begin:cpt-frontx-flow-routing-engine-provider-own-subroute-navigation:p1:inst-run-navigation
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-return
  return {
    // @cpt-begin:cpt-frontx-flow-routing-engine-provider-own-subroute-navigation:p1:inst-return-navigation-result
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-navigate
    navigate: (path: string): void => {
      ownSubrouteHistory().push(path);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-navigate
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-replace
    replace: (path: string): void => {
      ownSubrouteHistory().replace(path);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-replace
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-location
    location: (): { pathname: string; search: string } => {
      const { pathname, search } = ownSubrouteHistory().location;
      return { pathname, search };
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-location
    // @cpt-end:cpt-frontx-flow-routing-engine-provider-own-subroute-navigation:p1:inst-return-navigation-result
  };
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-navigation:p2:inst-nav-return
  // @cpt-end:cpt-frontx-flow-routing-engine-provider-own-subroute-navigation:p1:inst-run-navigation
}
