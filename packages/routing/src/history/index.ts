// Public surface of the history half of the Navigation Substrate
// (`cpt-frontx-feature-routing-navigation-substrate`, DoD
// `cpt-frontx-dod-routing-navigation-substrate-shared-history` and
// `cpt-frontx-dod-routing-navigation-substrate-imperative-navigation`).
//
// The grammar codec half of this FEATURE (`grammar-parse`/`grammar-serialize`
// /name-validity) lives in `../grammar/` and is re-exported from
// `../index.ts` on its own.
//
// The public construction path takes no argument. The `HistoryAdapter` seam
// (`HistoryAdapter`, `AdapterLocation`, the `createAdapter` factory that
// `./singleton.js`'s resolver accepts) stays package-internal, together with
// `createNavigationHistory` and `createWindowHistoryAdapter` (DESIGN §3.3,
// surface scope): a test reaches them by importing `./singleton.js`,
// `./navigation-history.js` or `./adapter.js` directly, never through this
// package's public entry.
import { resolveNavigationHistory as resolveRealmNavigationHistory } from './singleton.js';
import type { NavigationHistory } from '../types/index.js';

/**
 * Resolves the realm-shared `NavigationHistory` singleton over the browser's
 * own history (`cpt-frontx-algo-routing-navigation-substrate-singleton-resolution`).
 */
export function resolveNavigationHistory(): NavigationHistory {
  return resolveRealmNavigationHistory();
}
