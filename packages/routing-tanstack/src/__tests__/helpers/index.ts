// Shared test scaffolding for `packages/routing-tanstack`. Not part of the
// package's own public surface — imported only by files under `__tests__/`.
import { vi } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type Entry, type ExtensionToken, type Param } from '@gears-frontx/routing';
import { FakeHistoryAdapter } from './fake-history-adapter.js';

// `@gears-frontx/routing`'s own realm-shared singleton is keyed by this
// well-known `Symbol.for` value. Not exported from that package's own public
// entry, so this helper re-derives it through `Symbol.for`'s own global
// registry rather than importing a private constant — if the core changes
// this string, these tests fail loudly rather than leaking state across them.
const NAVIGATION_HISTORY_KEY = Symbol.for('@gears-frontx/routing/navigation-history/v1');

// jsdom's own session history, captured before `resetRealm` installs its
// double in its place: its `replaceState` is what moves jsdom's own
// `window.location`, which the navigation substrate's `window` adapter reads.
const realmHistory = window.history;
const replaceRealmAddress = window.history.replaceState.bind(realmHistory);

/** Installs `adapter` as the browser history the navigation substrate's
 * `window` adapter writes and reads per-entry state through. */
function installAsWindowHistory(adapter: FakeHistoryAdapter): void {
  const browserHistory = {
    get state(): unknown {
      return adapter.getState();
    },
    pushState(state: unknown, _unused: string, url: string): void {
      adapter.pushState(url, state);
    },
    replaceState(state: unknown, _unused: string, url: string): void {
      adapter.replaceState(url, state);
    },
    go(delta: number): void {
      adapter.go(delta);
    },
  };
  Object.defineProperty(window, 'history', { configurable: true, get: () => browserHistory });
}

/** Deletes any realm-shared `NavigationHistory` instance already resolved
 * under the well-known key, installs a `FakeHistoryAdapter` seeded at
 * `initialPath` as the page's own history, then resolves a fresh instance
 * through the public `resolveNavigationHistory()` — required before every
 * test that exercises a write path, so the singleton never leaks state
 * between tests. The fresh instance's `popstate` registration is routed to
 * `adapter` alone, so an instance a previous test resolved observes none of
 * this test's traversals. */
export function resetRealm(initialPath = '/en'): FakeHistoryAdapter {
  delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];
  const adapter = new FakeHistoryAdapter(initialPath, (path) => replaceRealmAddress(null, '', path));
  installAsWindowHistory(adapter);

  const addEventListener = window.addEventListener.bind(window);
  const register = vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'popstate' && typeof listener === 'function') {
      adapter.onPop(() => listener(new PopStateEvent('popstate')));
      return;
    }
    addEventListener(type, listener, options);
  }) as typeof window.addEventListener);
  try {
    resolveNavigationHistory();
  } finally {
    register.mockRestore();
  }
  return adapter;
}

/** A minimal `Entry` factory — casts the two branded string fields once,
 * here, instead of at every call site. */
export function entry(domainKey: string, extension: string, params: readonly Param[] = []): Entry {
  return { domainKey: domainKey as DomainKey, extension: extension as ExtensionToken, params };
}

export { FakeHistoryAdapter } from './fake-history-adapter.js';
