import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_HISTORY_KEY } from '../../history/singleton.js';
import { addDomain, cleanupRouters, newRouter, typeSystem, recordingExecutor } from './harness.js';

// DESIGN §3.3 (package entry), PRD FR `cpt-frontx-routing-fr-frontx-router`:
// the entry publishes the ready `router`, the router's two abstract
// dependencies, and what the engine-provider package imports; the history
// adapter seam, the unbound back-projection helper and the error class stay
// internal. The package-internal type contracts are pinned absent from the
// built declarations' export list in `dist-internal.test.ts`.

afterEach(cleanupRouters);

const surface = async (): Promise<Record<string, unknown>> => {
  vi.resetModules();
  return (await import('../../index.js')) as unknown as Record<string, unknown>;
};

describe('public entry — what the package publishes', () => {
  it('publishes a ready router instance carrying every member the runtime calls', async () => {
    const entry = await surface();
    const router = entry.router as Record<string, unknown> | undefined;
    expect(router).toBeDefined();
    for (const member of [
      'connect',
      'registerDomain',
      'registerExtension',
      'releaseDomain',
      'releaseExtension',
      'startDomain',
      'stopDomain',
      'reflect',
      'assignOccupantValue',
      'supplyNavigation',
      'ownEntryAddress',
    ]) {
      expect(router?.[member], member).toBeTypeOf('function');
    }
  });

  it('publishes the router abstract dependencies ActionsChainExecutor and RouterTypeSystem as abstract classes', async () => {
    const entry = await surface();
    expect(entry.ActionsChainExecutor).toBeTypeOf('function');
    expect(entry.RouterTypeSystem).toBeTypeOf('function');
  });

  it('publishes what the engine-provider package imports', async () => {
    const entry = await surface();
    for (const name of ['createRouteSignal', 'resolveNavigationHistory', 'namesEqual', 'parseGrammar', 'serializeGrammar']) {
      expect(entry[name], name).toBeTypeOf('function');
    }
  });

  it('does not publish the history adapter seam, the unbound back-projection helper, or the error class', async () => {
    const entry = await surface();
    for (const name of ['HistoryAdapter', 'AdapterLocation', 'createAdapter', 'backProjectEntries', 'RoutingError']) {
      expect(entry[name], name).toBeUndefined();
    }
  });
});

describe('public entry — the router resolves its history lazily', () => {
  it('lets a registry be built in a realm with no window and no history: admission and the occupant value need none', async () => {
    delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];
    const router = await newRouter();
    router.connect(recordingExecutor().executor, typeSystem);

    const { domainId, route } = addDomain(router, { extA: 'alpha' });

    expect(router.assignOccupantValue(domainId, 'extA')).toEqual({ domainKey: route, extension: 'alpha' });
    expect(() => router.reflect(domainId, ['extA'], 'push')).not.toThrow();
  });

  it('propagates any other failure to resolve its history: only a realm with no navigation history is skipped', async () => {
    const failure = new Error('history subscription failed');
    const realm = globalThis as Record<PropertyKey, unknown>;
    realm[NAVIGATION_HISTORY_KEY as unknown as string] = {
      location: { path: '/', search: '', hash: '', position: 0 },
      subscribe: () => {
        throw failure;
      },
      push: () => undefined,
      replace: () => undefined,
      go: () => undefined,
    };
    try {
      const router = await newRouter();
      router.connect(recordingExecutor().executor, typeSystem);
      const { domainId } = addDomain(router, { extA: 'alpha' });

      expect(() => router.reflect(domainId, ['extA'], 'push')).toThrow(failure);
    } finally {
      delete realm[NAVIGATION_HISTORY_KEY as unknown as string];
    }
  });
});
