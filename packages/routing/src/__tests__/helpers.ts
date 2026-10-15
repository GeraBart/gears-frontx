// Shared test scaffolding for `packages/routing`. Not part of the package's
// own public surface — imported only by files under `__tests__/`.

// DESIGN §3.3 public surface: the runtime values and the type-only names
// `src/index.ts` exports, pinned once here so `package.test.ts` (the runtime
// `import * as routing` pin) and `dist-internal.test.ts` (the built
// `dist/index.d.ts` presence/consumer checks) assert against the identical
// name list rather than two lists that could silently drift apart.
//
// A hand-listed subset (5 of the 10 actual runtime exports) would let a
// literal `@internal` in a `//` comment above `export { deriveExtensionToken,
// namesEqual, validateName }` (`../index.ts`) drop all three from
// `dist/index.d.ts` with no test failing, because the hand list never
// claimed to cover them. It is instead derived from
// `../index.js`'s own actual runtime exports (`Object.keys`, sorted) rather
// than maintained by hand, so a future export this package's own entry point
// adds or removes changes this list automatically instead of silently
// falling out of sync with it.
export const ROUTING_RUNTIME_SURFACE = Object.keys(routingIndex).sort();

// Type-only exports cannot be derived the same way — `export type { ... }`
// erases entirely at compile time, so there is no runtime object to call
// `Object.keys` on. This list is instead cross-checked by hand against every
// DESIGN §3.3 public-surface row that names a type rather than a function:
// the `NavigationHistory` contract (`NavigationHistory`, `Location`,
// `HistoryNotification`, `HistorySubscriber`, `NavigationKind`,
// `ReleaseFunction`, `HistoryVerb`); the URL grammar codec's input and output
// shapes (`ParseResult`, `SerializeInput`, `Entry`, `Param`, `ParamName`,
// `ParamValue`, `DomainKey`, `ExtensionToken`, `ParseWarning`,
// `ParseWarningCode`); `createRouteSignal`'s own return shape (`RouteSignal`)
// and the back-projection helper the engine-provider package uses through it
// (`BackProjectEntries`, `BackProjectionDelta`, `EntryInit`, `PayloadChange`,
// `ReplacedEntry`); and the engine-provider port (`EngineProviderInput`,
// `EngineProviderPort`, `EntryAddress`). The `HistoryAdapter` seam
// (`HistoryAdapter`, `AdapterLocation`) and the error class with its
// discriminant (`RoutingError`, `RoutingErrorCode`) are package-internal
// (DESIGN §3.3, surface scope), so they are not listed. Missing a public name
// here would let it go unverified — `helpers/surface-check.test.ts` proves
// the presence check this list feeds (`dist-internal.test.ts`) actually
// fails on a fixture missing a declared name.
export const ROUTING_TYPE_ONLY_SURFACE = [
  'BackProjectEntries',
  'BackProjectionDelta',
  'DomainKey',
  'EngineProviderInput',
  'EngineProviderPort',
  'Entry',
  'EntryAddress',
  'EntryInit',
  'ExtensionToken',
  'HistoryNotification',
  'HistorySubscriber',
  'HistoryVerb',
  'Location',
  'NavigationHistory',
  'NavigationKind',
  'Param',
  'ParamName',
  'ParamValue',
  'ParseResult',
  'ParseWarning',
  'ParseWarningCode',
  'PayloadChange',
  'ReleaseFunction',
  'ReplacedEntry',
  'RouteSignal',
  'SerializeInput',
] as const;

// The package-internal contracts DESIGN §3.3 lists below its table (name
// validity, extension-token derivation, the registered-extensions source,
// entry resolution, the observer factory, the transition) — asserted absent
// from the published export list, so a re-export slipping one of them into
// the public surface fails the same pin that catches a missing public name.
export const ROUTING_INTERNAL_TYPES = [
  'CreateObserver',
  'DeriveExtensionToken',
  'EntryResolution',
  'ExtensionRegistration',
  'ObserverHandle',
  'RegisteredExtensionsSource',
  'ResolveEntries',
  'ResolvedEntry',
  'Transition',
  'TransitionDiff',
  'ValidateName',
] as const;

// Internal building blocks DESIGN §3.3 explicitly excludes from the public
// surface (`./history/index.ts`'s own module comment) — asserted absent
// alongside `ROUTING_RUNTIME_SURFACE`'s presence, so a future re-export
// slipping one of these back in fails the same pin that catches a missing
// public name.
export const ROUTING_EXCLUDED_BUILDING_BLOCKS = ['createNavigationHistory', 'createWindowHistoryAdapter'] as const;
import * as routingIndex from '../index.js';
import { NAVIGATION_HISTORY_KEY, resolveNavigationHistory } from '../history/singleton.js';
import { RoutingError } from '../errors.js';
import { createRouteSignal } from '../signal/route-signal.js';
import { FakeHistoryAdapter } from './history/fake-history-adapter.js';
import type {
  BackProjectEntries,
  CreateObserver,
  DomainKey,
  Entry,
  ExtensionToken,
  Param,
  RegisteredExtensionsSource,
} from '../types/index.js';

// `backProjectEntries`/`createObserver` are not free, realm-singleton-
// defaulting exports of the package itself — a conforming consumer calls
// `createRouteSignal(history)` once and reuses the pair it returns. These two
// module-level bindings are this test suite's own equivalent of that call
// site, rebound by `resetRealm` on every reset so the call sites across this
// package's test files (`backProjectEntries(...)`, `createObserver(...)`) are
// always bound to whichever `NavigationHistory` the current test's
// `resetRealm` most recently constructed.
export let backProjectEntries: BackProjectEntries;
export let createObserver: CreateObserver;

/**
 * Deletes any instance already resolved under this realm's well-known key,
 * then resolves a fresh one against a `FakeHistoryAdapter` seeded at
 * `initialPath` — the setup every suite exercising `resolveNavigationHistory`
 * needs before each test, so the realm-global singleton never leaks state
 * between them. Also rebinds this file's own `backProjectEntries`/
 * `createObserver` (above) to the freshly resolved instance.
 */
export function resetRealm(initialPath = '/en'): FakeHistoryAdapter {
  delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];
  const adapter = new FakeHistoryAdapter(initialPath);
  const history = resolveNavigationHistory(() => adapter);
  const routeSignal = createRouteSignal(history);
  backProjectEntries = routeSignal.backProjectEntries;
  createObserver = routeSignal.createObserver;
  return adapter;
}

/** A minimal `Entry` factory — casts the two branded string fields once,
 * here, instead of at every call site. */
export function entry(domainKey: string, extension: string, params: readonly Param[] = []): Entry {
  return { domainKey: domainKey as DomainKey, extension: extension as ExtensionToken, params };
}

/**
 * Calls `fn`, asserts it threw a `RoutingError`, and returns it — the one
 * assertion idiom for every "throws RoutingError" test in this package,
 * replacing three different hand-rolled patterns that had accumulated
 * across suites (`expect.assertions` + try/catch; try/catch +
 * `expect.unreachable()`; try/catch + a manually thrown "expected a throw"
 * error).
 */
export function expectRoutingError(fn: () => void): RoutingError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RoutingError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a RoutingError to be thrown');
}

/** A registered-extensions source exposing only `getRegistrations` — the
 * whole of the source contract (FEATURE §1.5). */
export function staticSource(
  registrations: { extension: string; routeOwner: string }[] = [],
): RegisteredExtensionsSource<string> {
  return {
    getRegistrations: () =>
      registrations.map((r) => ({ extension: r.extension as ExtensionToken, routeOwner: r.routeOwner })),
  };
}

/** A registered-extensions source whose answer can be replaced after
 * creation via `set`. It notifies nobody: the observer reads the set once
 * when it starts, so a test uses `set` to prove what the source would return
 * later has no effect on how a navigation resolves. */
export function swappableSource(
  registrations: { extension: string; routeOwner: string }[] = [],
): RegisteredExtensionsSource<string> & {
  set(next: typeof registrations): void;
} {
  let current = registrations;
  return {
    getRegistrations: () =>
      current.map((r) => ({ extension: r.extension as ExtensionToken, routeOwner: r.routeOwner })),
    set(next: typeof registrations): void {
      current = next;
    },
  };
}
