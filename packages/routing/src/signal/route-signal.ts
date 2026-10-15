/**
 * Route Signal Factory — `history`-bound construction of the route
 * ownership signal's own write and observe surfaces.
 *
 * The package exports no free, top-level `backProjectEntries` or
 * `createObserver` resolving the realm-shared `NavigationHistory` singleton
 * internally: a caller that constructs its own `NavigationHistory` — a test
 * double, an SSR instance carrying its own adapter — could not make such a
 * function read *or write* through it. `createRouteSignal` is a single
 * factory that binds both surfaces to the identical `NavigationHistory`
 * given here, for both reading and writing.
 */
import { createBackProjectEntries } from './url-back-projection.js';
import { createObserverBoundTo } from './observe-change.js';
import type { BackProjectEntries, CreateObserver, NavigationHistory } from '../types/index.js';

/** The pair `createRouteSignal` returns, both bound to the same
 * `NavigationHistory` instance given at construction. */
export interface RouteSignal {
  /** `cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`,
   * bound to this signal's own `history`. */
  readonly backProjectEntries: BackProjectEntries;
  /** `cpt-frontx-algo-routing-route-ownership-signal-observe-change`, bound
   * to this signal's own `history`. */
  readonly createObserver: CreateObserver;
}

/**
 * Builds a `RouteSignal` bound to `history` — this package's own public
 * construction path for the route ownership signal's write
 * (`backProjectEntries`) and observe (`createObserver`) surfaces (FEATURE
 * (route-ownership-signal) §3). A conforming consumer using the realm-shared
 * singleton passes `resolveNavigationHistory()` (`../history/singleton.js`)
 * here once and reuses the returned pair; a test or an SSR entry point
 * passes its own `NavigationHistory` instead, and every read and write both
 * returned functions perform goes through that same instance.
 */
export function createRouteSignal(history: NavigationHistory): RouteSignal {
  return {
    backProjectEntries: createBackProjectEntries(history),
    createObserver: createObserverBoundTo(history),
  };
}
