// @gears-frontx/routing — package entry point.
//
// This package's public surface is specified by DESIGN §3.3
// (`cpt-frontx-routing-interface-package-entry`) and by two FEATUREs
// (packages/routing/architecture/features/):
//
//   - navigation-substrate    (cpt-frontx-feature-routing-navigation-substrate)
//   - route-ownership-signal  (cpt-frontx-feature-routing-route-ownership-signal)
//
// The package publishes the ready FrontX router, the router's two abstract
// dependencies, and what the engine-provider package imports. Every other
// helper stays internal.
//
// The public type contracts, one group per DESIGN §3.3 row. The package-
// internal contracts DESIGN §3.3 lists below its table — name validity,
// extension-token derivation, the registered-extensions source, entry
// resolution, the observer factory and the transition — are not exported.
// `export type` erases entirely at compile time: the type contracts carry no
// runtime footprint of their own.
export type {
  // `NavigationHistory` contract.
  HistoryNotification,
  HistorySubscriber,
  HistoryVerb,
  Location,
  NavigationHistory,
  NavigationKind,
  ReleaseFunction,
  // URL grammar codec.
  DomainKey,
  Entry,
  ExtensionToken,
  Param,
  ParamName,
  ParamValue,
  ParseResult,
  ParseWarning,
  ParseWarningCode,
  SerializeInput,
  // `createRouteSignal(history)`: the URL back-projection helper the
  // engine-provider package uses.
  BackProjectEntries,
  BackProjectionDelta,
  EntryInit,
  PayloadChange,
  ReplacedEntry,
  // Engine-provider port.
  EngineProviderInput,
  EngineProviderPort,
  EntryAddress,
} from './types/index.js';

// The FrontX router (`cpt-frontx-component-routing-router`; FEATURE
// route-ownership-signal §1.5, Router members and Engine-provider read): one
// ready instance per evaluated copy of this package, and so one per runtime.
// `ActionsChainExecutor` and `RouterTypeSystem` are its own abstract
// dependencies, runtime abstract classes the executor and the type system the
// runtime hands to `connect` conform to structurally.
export { router } from './router/router.js';
export { ActionsChainExecutor, RouterTypeSystem } from './router/abstract-dependencies.js';

// Navigation Substrate — history half (`cpt-frontx-feature-routing-navigation-substrate`,
// DoD `cpt-frontx-dod-routing-navigation-substrate-shared-history` /
// `cpt-frontx-dod-routing-navigation-substrate-imperative-navigation`).
// `resolveNavigationHistory` alone is the public construction path for the
// realm-shared history; see `./history/index.ts` for what stays internal.
export { resolveNavigationHistory } from './history/index.js';

// URL grammar codec (`cpt-frontx-feature-routing-navigation-substrate` §3:
// Grammar Parse, Grammar Serialize, Name Validity And Equality). Only the
// name-equality predicate is public: the name-validity predicate and the
// extension-token derivation are package-internal contracts (DESIGN §3.3)
// the FrontX router uses at registration.
export { namesEqual } from './grammar/name.js';
export { parseGrammar } from './grammar/parse.js';
export { serializeGrammar } from './grammar/serialize.js';

// Route Ownership Signal (`cpt-frontx-feature-routing-route-ownership-signal`,
// DoD `cpt-frontx-dod-routing-route-ownership-signal-resolution-and-observation`
// / `cpt-frontx-dod-routing-route-ownership-signal-release` /
// `cpt-frontx-dod-routing-route-ownership-signal-url-back-projection`) —
// `createRouteSignal` is the `history`-bound construction path for the
// observer factory and the URL back-projection helper; see
// `./signal/route-signal.js`. Entry resolution (`./signal/entry-resolution.js`)
// is this package's own internal primitive.
export { createRouteSignal } from './signal/route-signal.js';
export type { RouteSignal } from './signal/route-signal.js';
