// Shared scaffolding for the FrontX router suites (FEATURE route-ownership-signal
// §1.5 "Router members", §3 "Router Admission And Lifecycle"). Not part of the
// package's public surface — imported only by files under `__tests__/router/`.
//
// The router is reached only through the package's public entry. A fresh
// router instance is a fresh evaluation of that entry (`vi.resetModules()` +
// dynamic import); the navigation history is the realm-shared one, seeded
// through the package's own realm-reset helper over a fake history adapter.
// Nothing here waits on time: a user's back or forward step is observed
// through the history's own fan-out.
import { vi } from 'vitest';
import { resolveNavigationHistory } from '../../history/singleton.js';
import type { NavigationHistory } from '../../types/index.js';
import { resetRealm } from '../helpers.js';
import type { FakeHistoryAdapter } from '../history/fake-history-adapter.js';

/** Action type ids a fake type system hands the router; neither is a GTS id. */
export const MOUNT_ID = 'test.mount';
export const UNMOUNT_ID = 'test.unmount';

export interface Chain {
  action: { type: string; target: string; payload: { subject: string; history: string } };
}

export interface OccupantValueLike {
  domainKey: string;
  extension: string;
}

/** The router's members as the runtime calls them (FEATURE §1.5, Router members). */
export interface RouterLike {
  connect(executor: unknown, typeSystem: unknown): void;
  registerDomain(domainId: string, route: string, declaresUnmount: boolean): void;
  registerExtension(extensionId: string, domainId: string, route: string): void;
  releaseDomain(domainId: string): void;
  releaseExtension(extensionId: string): void;
  startDomain(domainId: string): void;
  stopDomain(domainId: string): void;
  reflect(domainId: string, extensionIds: string[], verb: 'push' | 'replace'): void;
  assignOccupantValue(domainId: string, extensionId: string): OccupantValueLike | undefined;
  supplyNavigation(readOccupantValue: () => unknown): void;
  ownEntryAddress(): OccupantValueLike | undefined;
}

export const typeSystem = {
  resolveMountExtActionId: () => MOUNT_ID,
  resolveUnmountExtActionId: () => UNMOUNT_ID,
};

export interface Sent {
  readonly chains: Chain[];
  readonly executor: { executeActionsChain(chain: Chain): void };
}

/** An executor that records every chain it is handed and runs none of them. */
export function recordingExecutor(): Sent {
  const chains: Chain[] = [];
  return { chains, executor: { executeActionsChain: (chain: Chain) => void chains.push(chain) } };
}

export const mountChain = (domainId: string, subject: string): Chain => ({
  action: { type: MOUNT_ID, target: domainId, payload: { subject, history: 'none' } },
});
export const unmountChain = (domainId: string, subject: string): Chain => ({
  action: { type: UNMOUNT_ID, target: domainId, payload: { subject, history: 'none' } },
});

/** The page's navigation history, and the fake adapter under it. */
export interface Page {
  readonly adapter: FakeHistoryAdapter;
  readonly history: NavigationHistory;
}

/** Starts a page: one fresh realm-shared history seeded at `initialPath`. */
export function newPage(initialPath: string): Page {
  const adapter = resetRealm(initialPath);
  return { adapter, history: resolveNavigationHistory() };
}

// Routers are released after each test so a route a test admitted never
// outlives it in the page-wide set of routed-domain routes.
const live: Array<{ router: RouterLike; domainId: string }> = [];

export function cleanupRouters(): void {
  vi.restoreAllMocks();
  for (const { router, domainId } of live.splice(0)) {
    router.stopDomain(domainId);
    router.releaseDomain(domainId);
  }
}

/** A new router instance: a fresh evaluation of the package entry, over the realm-shared history. */
export async function newRouter(): Promise<RouterLike> {
  vi.resetModules();
  const entry = (await import('../../index.js')) as unknown as { router?: RouterLike };
  if (entry.router === undefined) {
    throw new Error('the package entry exports no `router`');
  }
  return entry.router;
}

/** A router connected to a recording executor. */
export async function connectedRouter(): Promise<{ router: RouterLike; sent: Sent }> {
  const router = await newRouter();
  const sent = recordingExecutor();
  router.connect(sent.executor, typeSystem);
  return { router, sent };
}

let counter = 0;
/** A route no other test used, so page-wide route uniqueness never couples tests. */
export function freshRoute(prefix = 'dom'): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export interface DomainRig {
  readonly router: RouterLike;
  readonly domainId: string;
  readonly route: string;
}

/**
 * Registers one routed domain and its extensions (`extension id -> route`) on
 * `router`. The domain is not started: the caller sets the address, then
 * starts it.
 */
export function addDomain(
  router: RouterLike,
  extensions: Record<string, string>,
  options: { declaresUnmount?: boolean; route?: string } = {},
): DomainRig {
  const route = options.route ?? freshRoute();
  const domainId = `id-${route}`;
  router.registerDomain(domainId, route, options.declaresUnmount ?? true);
  live.push({ router, domainId });
  for (const [extensionId, extensionRoute] of Object.entries(extensions)) {
    router.registerExtension(extensionId, domainId, extensionRoute);
  }
  return { router, domainId, route };
}

/**
 * Delivers a user's back or forward step to `url` and resolves once the
 * history's own fan-out has delivered it to every subscriber registered so
 * far; the observers (registered earlier) have therefore already reported.
 */
export function userNavigates(page: Page, url: string): Promise<void> {
  const delivered = new Promise<void>((resolve) => {
    const release = page.history.subscribe(() => {
      release();
      resolve();
    });
  });
  page.adapter.simulateExternalPop(url);
  return delivered;
}

/** The query segments of the live URL, decoded, in URL order. */
export function segments(page: Page): string[] {
  const { search } = page.history.location;
  return decodeURIComponent(search.replace(/^\?/, ''))
    .split('&')
    .filter((segment) => segment !== '');
}

/** What the live URL carries under one domain key (token plus parameters), in URL order. */
export function entriesOf(page: Page, route: string): string[] {
  return segments(page)
    .filter((segment) => segment.startsWith(`${route}=`))
    .map((segment) => segment.slice(route.length + 1));
}

/** Counts the history writes made from now on, by verb. */
export function spyWrites(page: Page): { push: ReturnType<typeof vi.spyOn>; replace: ReturnType<typeof vi.spyOn> } {
  return {
    push: vi.spyOn(page.adapter, 'pushState'),
    replace: vi.spyOn(page.adapter, 'replaceState'),
  };
}
