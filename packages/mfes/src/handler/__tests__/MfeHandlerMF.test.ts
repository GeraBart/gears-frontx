/**
 * MfeHandlerMF — publicPath resolution guard tests.
 *
 * Covers the "auto" / "auto/" placeholder guard added at
 * @cpt-begin/@cpt-end markers in MfeHandlerMF.ts's
 * `assertResolvedPublicPath`. Module Federation emits `publicPath: "auto"`
 * for any remote whose vite.config.ts does not set an explicit publicPath —
 * that literal string must never reach the fetch layer as a base URL (see
 * MfeHandlerMF.ts header comment: "No remoteEntry.js parsing is required" —
 * this handler has no channel to recover the real origin at runtime, so an
 * unresolved "auto" must fail loudly rather than silently building a bogus
 * same-origin relative URL).
 */
import { describe, expect, it, vi } from 'vitest';
import { MfeHandlerMF, LruCache } from '../MfeHandlerMF';
import { MfeLoadError } from '../../errors';
import type { MfeEntryMF } from '../../types/mfe-entry-mf';
import type { MfManifest, MfManifestShared } from '../../manifest/mf-manifest';

// Fixture type IDs use a mock notation rather than the real GTS strings: the
// handler treats them as opaque cache keys and error context, and MFES-1
// forbids @gears-frontx/mfes from carrying type-format literals at all.
const MANIFEST_ID = 'mock.mfe.mf_manifest.v1~test.manifest.v1';
const ENTRY_BASE_ID = 'mock.mfe.entry.v1~';
const ENTRY_ID = `${ENTRY_BASE_ID}test.entry.v1`;

function buildManifest(
  publicPath: string,
  shared: MfManifestShared[] = []
): MfManifest {
  return {
    id: MANIFEST_ID,
    name: 'testMfe',
    metaData: {
      name: 'testMfe',
      type: 'app',
      buildInfo: { buildVersion: '1.0.0', buildName: 'testMfe' },
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
      globalName: 'testMfe',
      publicPath,
    },
    shared,
  };
}

function buildEntry(
  manifest: MfManifest,
  exposeChunk: string = 'assets/lifecycle.js'
): MfeEntryMF {
  return {
    id: ENTRY_ID,
    requiredProperties: [],
    actions: [],
    domainActions: [],
    manifest,
    exposedModule: './lifecycle',
    exposeAssets: {
      js: { sync: [exposeChunk], async: [] },
      css: { sync: [], async: [] },
    },
  };
}

/** A `Response`-shaped object satisfying `fetchSourceText`'s checks. */
function jsResponse(body: string): Response {
  return {
    ok: true,
    headers: { get: () => 'application/javascript' },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Builds a `fetch` mock implementation that resolves each URL against
 * `routes` (keyed by the URL's trailing path segment, e.g. 'a.js'), after an
 * optional per-route delay, and records the wall-clock time each URL was
 * first invoked (dispatch time) and how many times it was called — the
 * signal these concurrency tests assert on.
 */
function createFetchRouter(
  routes: Record<string, { body: string; delayMs?: number }>
): {
  fetchImpl: (input: string | URL | Request) => Promise<Response>;
  dispatchedAt: Map<string, number>;
  callCounts: Map<string, number>;
} {
  const dispatchedAt = new Map<string, number>();
  const callCounts = new Map<string, number>();

  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    callCounts.set(url, (callCounts.get(url) ?? 0) + 1);
    if (!dispatchedAt.has(url)) {
      dispatchedAt.set(url, Date.now());
    }
    if (!key) {
      return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
    }
    const route = routes[key];
    if (route.delayMs === undefined || route.delayMs === 0) {
      return Promise.resolve(jsResponse(route.body));
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsResponse(route.body)), route.delayMs);
    });
  };

  return { fetchImpl, dispatchedAt, callCounts };
}

describe('MfeHandlerMF — unresolved publicPath placeholder guard', () => {
  it.each(['auto', 'auto/'])(
    'rejects manifest.metaData.publicPath === %j with a diagnostic MfeLoadError',
    async (placeholder) => {
      // retries: 0 — the guard's rejection is deterministic and must not be
      // masked by RetryHandler's exponential-backoff retries (default 2
      // retries would add seconds of real delay per assertion here).
      const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
      const entry = buildEntry(buildManifest(placeholder));

      // Fetch must never be reached — the guard fires before any network
      // access derived from the unresolved baseUrl.
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(
        handler.load(entry, `extension-${placeholder}`)
      ).rejects.toThrow(MfeLoadError);
      await expect(
        handler.load(entry, `extension-${placeholder}-msg`)
      ).rejects.toThrow(/unresolved Module Federation placeholder "auto/);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    }
  );

  it('does not reject a concrete resolved publicPath at the guard step', async () => {
    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(buildManifest('http://localhost:3099/'));

    // A concrete publicPath passes the guard and proceeds to fetch the
    // (nonexistent, in this unit test) chunk — asserting on the failure
    // mode confirms the guard did NOT reject it as an "auto" placeholder.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('network error for test'));

    await expect(handler.load(entry, 'extension-concrete')).rejects.toThrow(
      MfeLoadError
    );
    await expect(handler.load(entry, 'extension-concrete-2')).rejects.not.toThrow(
      /unresolved Module Federation placeholder/
    );
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3099/assets/lifecycle.js');

    fetchSpy.mockRestore();
  });
});

const PUBLIC_PATH = 'http://localhost:3099/';

function sharedDep(name: string, chunkPath: string): MfManifestShared {
  return { name, version: '1.0.0', chunkPath, unwrapKey: null };
}

/**
 * Concurrent-fetch behaviour of the two dependency-fanout loops
 * (`fetchSharedDepSources`'s shared-dep loop and
 * `createBlobUrlChainInternal`'s sibling loop) and the cycle-detection
 * fallback that keeps them from deadlocking on circular dependencies. Prior
 * coverage of these loops only mocked `fetch` to reject immediately, so the
 * concurrent-dispatch path, the cross-caller `inFlight`/`blobUrlMap` dedup
 * path, and the cycle-detection fallback were never actually exercised.
 */
describe('MfeHandlerMF — concurrent dependency fetch', () => {
  it('dispatches all shared-dependency fetches concurrently rather than one at a time', async () => {
    // Each dep is deliberately slow (40ms) and there are three of them.
    // A serial loop (await inside the loop before issuing the next fetch)
    // would issue dep-2's fetch only after dep-1's 40ms response arrived,
    // and dep-3's only after dep-2's — so the SECOND and THIRD fetch calls
    // would be dispatched ~40ms and ~80ms after the first. Concurrent
    // dispatch issues all three within a few ms of each other, regardless of
    // when each later resolves. Asserting on dispatch time (not total
    // elapsed load() time) isolates the dispatch-ordering behaviour and is
    // robust to the expose-chunk fetch that runs afterward.
    const manifest = buildManifest(PUBLIC_PATH, [
      sharedDep('dep-a', 'shared/dep-a.js'),
      sharedDep('dep-b', 'shared/dep-b.js'),
      sharedDep('dep-c', 'shared/dep-c.js'),
    ]);
    const entry = buildEntry(manifest);

    const { fetchImpl, dispatchedAt } = createFetchRouter({
      'dep-a.js': { body: 'export const a = 1;', delayMs: 40 },
      'dep-b.js': { body: 'export const b = 1;', delayMs: 40 },
      'dep-c.js': { body: 'export const c = 1;', delayMs: 40 },
      // Expose chunk: reject fast so the test doesn't wait on it — the
      // shared-dep dispatch timing has already been captured by then.
      'lifecycle.js': { body: '' },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    await handler.load(entry, 'ext-concurrent-shared').catch(() => {
      // The expose chunk resolves with an empty module (no lifecycle
      // exports), so load() rejects downstream of the assertion below —
      // irrelevant to what this test checks.
    });

    const depTimes = ['dep-a.js', 'dep-b.js', 'dep-c.js'].map((suffix) => {
      const url = [...dispatchedAt.keys()].find((u) => u.endsWith(suffix));
      expect(url, `expected a fetch call for ${suffix}`).toBeDefined();
      return dispatchedAt.get(url as string) as number;
    });

    const spread = Math.max(...depTimes) - Math.min(...depTimes);
    // Sequential dispatch would spread these by ~40-80ms (one full response
    // per iteration before the next fetch is even issued); concurrent
    // dispatch issues all three within a handful of milliseconds.
    expect(spread).toBeLessThan(30);

    fetchSpy.mockRestore();
  });

  it('shares a single underlying fetch across two concurrent callers requesting the same chunk', async () => {
    // The expose chunk imports two siblings, both of which statically
    // import a common chunk. Serial (depth-first, fully-awaited) sibling
    // processing would still de-dup this correctly; what this test isolates
    // is that fanning the two siblings out concurrently doesn't regress the
    // `inFlight` dedup for the chunk they share — a race the synchronous
    // check-then-set in `createBlobUrlChain` is documented to prevent, but
    // which this test alone (dedup count only) would still pass against a
    // fully serial implementation. See the next test for an assertion that
    // actually requires concurrent dispatch to pass.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const { fetchImpl, callCounts } = createFetchRouter({
      'lifecycle.js': {
        body: "import './sibling-a.js';\nimport './sibling-b.js';\nexport default { mount(){}, unmount(){} };",
      },
      'sibling-a.js': {
        body: "import './common.js';\nexport const a = 1;",
      },
      'sibling-b.js': {
        body: "import './common.js';\nexport const b = 1;",
      },
      // Delayed so both siblings' requests for it are in flight at once.
      'common.js': { body: 'export const common = 1;', delayMs: 20 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    // The blob URL chain (what this test targets) fully resolves before
    // `load()` reaches `importBlobModule` — dynamic `import()` of a `blob:`
    // URL isn't supported under Node/vitest's module loader, so the load
    // itself rejects downstream of the assertion below; that rejection is
    // irrelevant to what's being verified here (the fetch de-dup).
    await handler.load(entry, 'ext-shared-common-dep').catch(() => {});

    const commonCalls = [...callCounts.entries()].filter(([url]) =>
      url.endsWith('common.js')
    );
    expect(commonCalls).toHaveLength(1);
    expect(commonCalls[0][1]).toBe(1);

    fetchSpy.mockRestore();
  });

  it('dispatches two independent sibling static-import chains before either one resolves', async () => {
    // Unlike the dedup test above, this asserts on dispatch ORDER (a
    // deterministic in-process log), not dedup count or a wall-clock
    // threshold: sibling-a.js and sibling-b.js share no dependency here, so
    // a fully serial sibling loop (await sibling-a's entire recursive
    // subtree before even starting sibling-b) would still pass every
    // assertion in the test above, but would dispatch sibling-b.js's fetch
    // only AFTER sibling-a.js's fetch has already resolved. Concurrent
    // fan-out dispatches both before either resolves.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);
    const events: string[] = [];

    const fetchImpl = (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('lifecycle.js')) {
        events.push('dispatch:lifecycle.js');
        return Promise.resolve(
          jsResponse(
            "import './sibling-a.js';\nimport './sibling-b.js';\nexport default { mount(){}, unmount(){} };"
          )
        );
      }
      const match = ['sibling-a.js', 'sibling-b.js'].find((key) => url.endsWith(key));
      if (!match) {
        return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
      }
      events.push(`dispatch:${match}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          events.push(`resolve:${match}`);
          resolve(jsResponse(`export const v = '${match}';`));
        }, 15);
      });
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    await handler.load(entry, 'ext-sibling-dispatch-order').catch(() => {});

    const dispatchB = events.indexOf('dispatch:sibling-b.js');
    const resolveA = events.indexOf('resolve:sibling-a.js');
    expect(dispatchB, `dispatch log: ${events.join(', ')}`).toBeGreaterThan(-1);
    expect(resolveA, `dispatch log: ${events.join(', ')}`).toBeGreaterThan(-1);
    expect(dispatchB).toBeLessThan(resolveA);

    fetchSpy.mockRestore();
  });

  it('settles a diamond-shaped cross-branch cycle within bounded time instead of deadlocking', async () => {
    // a.js and b.js are independent siblings (both reached directly from
    // lifecycle.js) that both statically import c.js, and c.js statically
    // imports back to b.js — the cycle only closes once a's branch and b's
    // branch meet at c, not on either branch's own recursion path. A cycle
    // guard that only tracks each call's own ancestor chain (rather than
    // the shared in-flight entry) misses this shape entirely: c is reached
    // via a's path, which never has b.js as an ancestor, so it falls
    // through to joining b's already in-flight promise while b, elsewhere,
    // is joining c's — a genuine circular wait. The delay on c.js's fetch
    // ensures a's and b's branches are both genuinely mid-flight when they
    // each request c.js, reproducing the race rather than relying on
    // incidental ordering.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const { fetchImpl } = createFetchRouter({
      'lifecycle.js': {
        body: "import './a.js';\nimport './b.js';\nexport default { mount(){}, unmount(){} };",
      },
      'a.js': { body: "import './c.js';\nexport const a = 1;" },
      'b.js': { body: "import './c.js';\nexport const b = 1;" },
      'c.js': { body: "import './b.js';\nexport const c = 1;", delayMs: 20 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });

    const deadlockGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('deadlocked: diamond-shaped cycle never settled')),
        2000
      );
    });

    // Mapping both settlement kinds (fulfilled or rejected) to the same
    // sentinel means the race only rejects if `deadlockGuard` wins, i.e. a
    // real hang — the blob URL chain build is what would hang; `load()` may
    // still reject afterwards at `importBlobModule` (dynamic `import()` of a
    // `blob:` URL isn't supported under Node/vitest's module loader).
    const outcome = await Promise.race([
      handler.load(entry, 'ext-diamond-cycle').then(
        () => 'settled',
        () => 'settled'
      ),
      deadlockGuard,
    ]);
    expect(outcome).toBe('settled');

    fetchSpy.mockRestore();
  });

  it('settles mutually-importing chunks within bounded time instead of deadlocking', async () => {
    // x.js and y.js statically import each other on a single, linear call
    // path. This is the simplest cycle shape: x registers itself in
    // `inFlight` and starts resolving y; y sees x's still-pending `inFlight`
    // promise and awaits it; x cannot finish until y does. No rejection, no
    // timeout, unless the cycle is detected and short-circuited.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const { fetchImpl } = createFetchRouter({
      'lifecycle.js': {
        body: "import './x.js';\nexport default { mount(){}, unmount(){} };",
      },
      'x.js': { body: "import './y.js';\nexport const x = 1;" },
      'y.js': { body: "import './x.js';\nexport const y = 1;" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });

    const deadlockGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('deadlocked: mutually-importing chunks never settled')),
        2000
      );
    });

    // The blob URL chain build is what would hang; the load may still
    // reject afterwards at `importBlobModule` (dynamic `import()` of a
    // `blob:` URL isn't supported under Node/vitest's module loader) —
    // mapping both settlement kinds to the same sentinel means the race
    // only rejects if `deadlockGuard` wins, i.e. a real hang.
    const outcome = await Promise.race([
      handler.load(entry, 'ext-cycle').then(
        () => 'settled',
        () => 'settled'
      ),
      deadlockGuard,
    ]);
    expect(outcome).toBe('settled');

    fetchSpy.mockRestore();
  });

  it('rejects with a diagnostic MfeLoadError roughly at the configured timeout when a fetch never resolves', async () => {
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    // Never resolves — `RetryHandler.retry` only retries on a thrown error
    // and races nothing against a clock on its own, so without a timeout
    // race around the whole attempt this would hang the returned promise
    // indefinitely.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>(() => {}));

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0, timeout: 50 });

    const start = Date.now();
    await expect(handler.load(entry, 'ext-timeout')).rejects.toThrow(MfeLoadError);
    await expect(
      handler.load(entry, 'ext-timeout-msg')
    ).rejects.toThrow(/timed out after 50ms/);
    const elapsed = Date.now() - start;

    // Generous upper bound: two sequential 50ms-timeout attempts plus test
    // overhead should stay well under 1s; a hang would blow past this (and
    // the suite's own timeout) entirely.
    expect(elapsed).toBeLessThan(1000);

    fetchSpy.mockRestore();
  });

  it('fails fast on a manifest that declares the same shared-dependency name twice', async () => {
    const manifest = buildManifest(PUBLIC_PATH, [
      sharedDep('dup-dep', 'shared/dup-dep-v1.js'),
      sharedDep('dup-dep', 'shared/dup-dep-v2.js'),
    ]);
    const entry = buildEntry(manifest);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    await expect(handler.load(entry, 'ext-dup-shared-name')).rejects.toThrow(
      /declares 'dup-dep' more than once/
    );
    // The fail-fast check runs before any network access.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

describe('LruCache — capacity eviction and MRU re-insertion', () => {
  it('evicts the oldest entry once capacity is exceeded', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('re-inserting via get() marks a key most-recently-used, protecting it from the next eviction', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // Touch 'a' so it becomes most-recently-used; 'b' is now the oldest.
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new LruCache<string, number>(0)).toThrow(RangeError);
    expect(() => new LruCache<string, number>(-1)).toThrow(RangeError);
  });
});
