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

/** Sum of every recorded fetch call across all URLs. */
function totalFetches(callCounts: Map<string, number>): number {
  return [...callCounts.values()].reduce((sum, n) => sum + n, 0);
}

/** Calls recorded for the single URL ending in `suffix` (0 when never fetched). */
function fetchesFor(callCounts: Map<string, number>, suffix: string): number {
  let total = 0;
  for (const [url, count] of callCounts) {
    if (url.endsWith(suffix)) total += count;
  }
  return total;
}

/**
 * The per-load blob state `loadExposedModuleIsolated` builds internally.
 * Hand-built here so tests can drive `resolveLazyChunk` directly and then
 * inspect `blobUrlMap` — the durable record of which chunks actually got a
 * blob URL — which a `load()`-level test cannot observe (dynamic `import()`
 * of a `blob:` URL is unsupported under Node/vitest's module loader, so
 * `load()` always rejects downstream of the chain build).
 */
function buildLoadState(): {
  blobUrlMap: Map<string, string>;
  inFlight: Map<string, unknown>;
  baseUrl: string;
  entryId: string;
  sharedDepBlobUrls: Map<string, string>;
  entryChunkFilename: string;
} {
  return {
    blobUrlMap: new Map<string, string>(),
    inFlight: new Map<string, unknown>(),
    baseUrl: PUBLIC_PATH,
    entryId: ENTRY_ID,
    sharedDepBlobUrls: new Map<string, string>(),
    entryChunkFilename: 'assets/lifecycle.js',
  };
}

/** Invoke the handler's private `resolveLazyChunk` against a hand-built state. */
function resolveLazy(
  handler: MfeHandlerMF,
  relPath: string,
  loadState: unknown
): Promise<string> {
  return (
    handler as unknown as {
      resolveLazyChunk: (p: string, s: unknown) => Promise<string>;
    }
  ).resolveLazyChunk(relPath, loadState);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

  it('resolves a diamond-shaped cross-branch cycle: every chunk on it is blob-URL\'d and each is fetched once', async () => {
    // a.js and b.js are independent siblings (both reached directly from
    // root.js) that both statically import c.js, and c.js statically imports
    // back to b.js — the cycle only closes once a's branch and b's branch
    // meet at c, not on either branch's own recursion path. A cycle guard
    // that only tracks each call's own ancestor chain (rather than the
    // shared in-flight entry) misses this shape entirely: c is reached via
    // a's path, which never has b.js as an ancestor, so it falls through to
    // joining b's already in-flight promise while b, elsewhere, is joining
    // c's — a genuine circular wait.
    //
    // The 20ms delay on c.js is the ordering device, not incidental: it is
    // what guarantees b joins c's in-flight construction (contributing its
    // lineage) BEFORE c parses its own imports, which is the order in which
    // the cross-branch cycle is detectable at all. The assertions below are
    // on observable outcomes — which filenames ended up in `blobUrlMap` and
    // the per-chunk fetch counts — not merely on "it settled".
    const { fetchImpl, callCounts } = createFetchRouter({
      'root.js': { body: "import './a.js';\nimport './b.js';\nexport const r = 1;" },
      'a.js': { body: "import './c.js';\nexport const a = 1;" },
      'b.js': { body: "import './c.js';\nexport const b = 1;" },
      'c.js': { body: "import './b.js';\nexport const c = 1;", delayMs: 20 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const deadlockGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('deadlocked: diamond-shaped cycle never settled')),
        2000
      );
    });

    const blobUrl = await Promise.race([
      resolveLazy(handler, './root.js', loadState),
      deadlockGuard,
    ]);
    expect(blobUrl).toMatch(/^blob:/);

    // Every chunk on the cycle still receives its own blob URL — the
    // short-circuit costs one SPECIFIER its blob (c's import of b resolves
    // from origin), never a whole chunk.
    expect([...loadState.blobUrlMap.keys()].sort()).toEqual([
      'assets/a.js',
      'assets/b.js',
      'assets/c.js',
      'assets/root.js',
    ]);
    // Each chunk fetched exactly once: the shared `inFlight`/`blobUrlMap`
    // dedup holds across the two branches that meet at c.
    for (const chunk of ['root.js', 'a.js', 'b.js', 'c.js']) {
      expect(fetchesFor(callCounts, chunk), `fetch count for ${chunk}`).toBe(1);
    }
    // The origin-URL fallback is reported, not applied silently.
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(
      /dependency cycle: chunk 'assets\/b\.js'/
    );

    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("resolves mutually-importing chunks: both are blob-URL'd and each is fetched once", async () => {
    // x.js and y.js statically import each other on a single, linear call
    // path — the simplest cycle shape, and fully deterministic: no fetch
    // delay is needed to reproduce it, because x is on y's own recursion
    // path by construction. x registers itself in `inFlight` and starts
    // resolving y; y's request for x is short-circuited by the plain
    // ancestor check instead of awaiting x's still-pending promise.
    const { fetchImpl, callCounts } = createFetchRouter({
      'x.js': { body: "import './y.js';\nexport const x = 1;" },
      'y.js': { body: "import './x.js';\nexport const y = 1;" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const deadlockGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('deadlocked: mutually-importing chunks never settled')),
        2000
      );
    });

    const blobUrl = await Promise.race([
      resolveLazy(handler, './x.js', loadState),
      deadlockGuard,
    ]);
    expect(blobUrl).toMatch(/^blob:/);

    expect([...loadState.blobUrlMap.keys()].sort()).toEqual([
      'assets/x.js',
      'assets/y.js',
    ]);
    expect(fetchesFor(callCounts, 'x.js')).toBe(1);
    expect(fetchesFor(callCounts, 'y.js')).toBe(1);
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(
      /dependency cycle: chunk 'assets\/x\.js'/
    );

    warnSpy.mockRestore();
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

  it('never exceeds the configured fetch width for one chain build, however deep and wide the graph', async () => {
    // Six branches of depth three, each level fanning out again: 1 + 6 + 12
    // + 24 chunks. With a per-batch pool, each sibling group opened its own
    // pool of MAX_CONCURRENT_FETCHES, so the width multiplied by the
    // graph's bushiness — the level-2 groups alone could put well over the
    // width in flight at once. A single build-scoped budget holds the bound
    // no matter the shape.
    const WIDTH = 6;
    const routes: Record<string, { body: string; delayMs?: number }> = {};
    const branches = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
    routes['root.js'] = {
      body: branches.map((b) => `import './${b}.js';`).join('\n'),
      delayMs: 5,
    };
    for (const b of branches) {
      routes[`${b}.js`] = {
        body: [0, 1].map((i) => `import './${b}-${i}.js';`).join('\n'),
        delayMs: 5,
      };
      for (const i of [0, 1]) {
        routes[`${b}-${i}.js`] = {
          body: [0, 1].map((j) => `import './${b}-${i}-${j}.js';`).join('\n'),
          delayMs: 5,
        };
        for (const j of [0, 1]) {
          routes[`${b}-${i}-${j}.js`] = {
            body: `export const leaf = '${b}-${i}-${j}';`,
            delayMs: 5,
          };
        }
      }
    }

    let inFlight = 0;
    let peakInFlight = 0;
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((async (input: string | URL | Request) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        try {
          return await fetchImpl(input);
        } finally {
          inFlight -= 1;
        }
      }) as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const blobUrl = await resolveLazy(handler, './root.js', loadState);
    expect(blobUrl).toMatch(/^blob:/);
    // 1 root + 6 + 12 + 24 leaves all built.
    expect(loadState.blobUrlMap.size).toBe(43);
    expect(peakInFlight).toBeLessThanOrEqual(WIDTH);
    // Sanity: the budget is actually saturated, so the bound above is a
    // real ceiling rather than an artifact of nothing overlapping.
    expect(peakInFlight).toBeGreaterThan(1);

    fetchSpy.mockRestore();
  });

  it('reports the first failing sibling in declaration order, not the first to fail in wall-clock time', async () => {
    // `root.js` imports `first-bad.js` then `second-bad.js`; the SECOND one
    // fails immediately while the first takes 40ms to fail. Completion-order
    // reporting would surface `second-bad.js`; declaration-order reporting
    // (what `firstRejection` preserves across the concurrent fan-out) must
    // surface `first-bad.js` regardless of who lost the race.
    const { fetchImpl } = createFetchRouter({
      'root.js': {
        body: "import './first-bad.js';\nimport './second-bad.js';\nexport const r = 1;",
      },
      // Neither bad chunk is routed, so both reject; the delay decides only
      // WHICH rejects first in wall-clock time.
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('first-bad.js')) {
          return new Promise<Response>((_resolve, reject) => {
            setTimeout(() => reject(new TypeError('slow failure')), 40);
          });
        }
        if (url.endsWith('second-bad.js')) {
          return Promise.reject(new TypeError('fast failure'));
        }
        return fetchImpl(input);
      }) as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    await expect(resolveLazy(handler, './root.js', loadState)).rejects.toThrow(
      /first-bad\.js/
    );

    fetchSpy.mockRestore();
  });

  it('does not race the attempt against a clock when the configured timeout is non-positive', async () => {
    // 0 is the conventional "no timeout" idiom. A zero-delay timer would
    // fail every attempt immediately; the guard must disable the race.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const { fetchImpl } = createFetchRouter({
      'lifecycle.js': {
        body: 'export default { mount(){}, unmount(){} };',
        delayMs: 60,
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0, timeout: 0 });

    const start = Date.now();
    // The chain build itself completes; `load()` still rejects downstream at
    // `importBlobModule` (dynamic `import()` of a `blob:` URL is unsupported
    // under Node/vitest's module loader). What matters is HOW it rejects.
    await expect(handler.load(entry, 'ext-timeout-disabled')).rejects.not.toThrow(
      /timed out after/
    );
    // The attempt was allowed to run past the 0ms budget rather than being
    // failed at once.
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    expect(fetchSpy).toHaveBeenCalled();

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

/**
 * Regression coverage for the per-build failure token that replaced a
 * single load-wide `failed` flag on `LoadBlobState`. A shared, never-reset
 * flag latched permanently after the first failed lazy import, causing
 * every subsequent — otherwise entirely independent — lazy import on the
 * same already-mounted MFE to fail with
 * "failed to mint blob URL for lazy chunk" even though it never touched the
 * chunk that actually failed. These tests drive `resolveLazyChunk` directly
 * against a hand-built `LoadBlobState` (the private per-load state
 * `loadExposedModuleIsolated` would otherwise construct), since dynamic
 * `import()` of a `blob:` URL is not supported under Node/vitest's module
 * loader and would otherwise mask the failure downstream of the assertions
 * here.
 */
describe('MfeHandlerMF — lazy-import failure isolation', () => {
  it('does not let one failed lazy import block a later, independent lazy import on the same load', async () => {
    // `broken.js` itself fetches fine but statically imports `missing-dep.js`,
    // which does not. This is deliberate, not incidental: the failure must
    // surface through the sibling-fan-out rejection path in
    // `createBlobUrlChainInternal` (parse deps → fan out via `boundedMap` →
    // `firstRejection` → set the failure signal → throw) — the exact path
    // that used to set the shared, never-reset `loadState.failed` flag. A
    // fetch failure on the top-level lazy chunk's OWN source text rejects
    // before that code ever runs, so it would not exercise the bug this
    // test guards against.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('broken.js')) {
          return Promise.resolve(
            jsResponse("import './missing-dep.js';\nexport const broken = 1;")
          );
        }
        if (url.endsWith('missing-dep.js')) {
          return Promise.reject(new TypeError('network error for test'));
        }
        if (url.endsWith('ok.js')) {
          return Promise.resolve(jsResponse('export const ok = 1;'));
        }
        return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
      }) as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });

    // Hand-built per-load state, mirroring what `loadExposedModuleIsolated`
    // builds internally — no `failed` field: that shared flag is exactly
    // what this test proves must be gone.
    const loadState = {
      blobUrlMap: new Map<string, string>(),
      inFlight: new Map(),
      baseUrl: PUBLIC_PATH,
      entryId: ENTRY_ID,
      sharedDepBlobUrls: new Map<string, string>(),
      entryChunkFilename: 'assets/lifecycle.js',
    };

    // First lazy import fails (its target chunk 404s / network-errors).
    await expect(
      (handler as unknown as {
        resolveLazyChunk: (relPath: string, loadState: unknown) => Promise<string>;
      }).resolveLazyChunk('./broken.js', loadState)
    ).rejects.toThrow(MfeLoadError);

    // A second, wholly independent lazy import on the SAME load must still
    // succeed — it never depends on './broken.js' in any way. Before the
    // fix, the first failure latched `loadState.failed = true` for the rest
    // of the load's lifetime, so this second call would exit
    // `createBlobUrlChainInternal` immediately without fetching, mint no
    // `blobUrlMap` entry, and `resolveLazyChunk` would reject with:
    //   "__frontx_lazy: failed to mint blob URL for lazy chunk './ok.js'"
    // — observed directly against the pre-fix implementation.
    const blobUrl = await (
      handler as unknown as {
        resolveLazyChunk: (relPath: string, loadState: unknown) => Promise<string>;
      }
    ).resolveLazyChunk('./ok.js', loadState);
    expect(blobUrl).toMatch(/^blob:/);

    fetchSpy.mockRestore();
  });

  it('re-attempts a chunk the failed build abandoned instead of joining its settled, empty in-flight entry', async () => {
    // The previous test uses two DISJOINT lazy chunks, so the failed build
    // and the later one share nothing. This one makes them overlap, which is
    // the case the in-flight registry got wrong: `broken.js` fans out to
    // `a.js` (which imports a chunk that never loads) and to `slow.js`
    // (which is still mid-fetch when a's failure raises the build's failure
    // signal). `slow.js`'s construction therefore RESOLVES — it returns
    // early rather than throwing — without ever minting a blob URL, leaving
    // a settled promise in `inFlight` under 'assets/slow.js' that produced
    // nothing. Every later request for that filename then joined it,
    // resolved instantly, never re-fetched, and found no `blobUrlMap` entry:
    // `resolveLazyChunk` rejected with "failed to mint blob URL for lazy
    // chunk './slow.js'" for the rest of the page's life.
    const { fetchImpl, callCounts } = createFetchRouter({
      'broken.js': { body: "import './a.js';\nimport './slow.js';\nexport const b = 1;" },
      // `missing.js` is deliberately unrouted — the router rejects any URL
      // it has no route for, which is the network failure this needs.
      'a.js': { body: "import './missing.js';\nexport const a = 1;" },
      'slow.js': {
        body: "import './slow-dep.js';\nexport const s = 1;",
        delayMs: 50,
      },
      'slow-dep.js': { body: 'export const d = 1;' },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    await expect(resolveLazy(handler, './broken.js', loadState)).rejects.toThrow(
      MfeLoadError
    );

    // Let `slow.js`'s own fetch settle, so its construction runs its
    // abandon-without-a-blob-URL path while nothing is watching.
    await sleep(120);
    expect(loadState.blobUrlMap.has('assets/slow.js')).toBe(false);
    const fetchesBefore = totalFetches(callCounts);

    const blobUrl = await resolveLazy(handler, './slow.js', loadState);
    expect(blobUrl).toMatch(/^blob:/);
    expect(loadState.blobUrlMap.get('assets/slow.js')).toBe(blobUrl);

    // Construction genuinely re-ran rather than short-circuiting on the
    // stale entry: `slow-dep.js` — a chunk the abandoned build never got as
    // far as parsing, let alone fetching — is fetched now, so the build's
    // total fetch count increases.
    expect(fetchesFor(callCounts, 'slow-dep.js')).toBe(1);
    expect(totalFetches(callCounts)).toBeGreaterThan(fetchesBefore);
    // `slow.js`'s own source text is NOT re-fetched, and must not be: the
    // URL-keyed `sourceTextCache` retains a successful fetch for the
    // handler's lifetime, so re-attempting a construction reuses the source
    // it already has. Re-fetching the SOURCE is not what the fix restores;
    // re-running the CONSTRUCTION is.
    expect(fetchesFor(callCounts, 'slow.js')).toBe(1);

    fetchSpy.mockRestore();
  });
});

describe('MfeHandlerMF — unbuilt vs. cycle-short-circuited dependency at rewrite time', () => {
  // These drive the private `rewriteModuleImports` directly: the two
  // branches differ only in whether the build recorded the dependency as a
  // deliberate cycle short-circuit, which is build state no fetch mock can
  // set from the outside.
  const rewrite = (
    handler: MfeHandlerMF,
    source: string,
    loadState: unknown,
    chunkFilename: string,
    build: unknown
  ): string =>
    (
      handler as unknown as {
        rewriteModuleImports: (
          src: string,
          state: unknown,
          chunk: string,
          build: unknown
        ) => string;
      }
    ).rewriteModuleImports(source, loadState, chunkFilename, build);

  it("resolves a cycle-short-circuited dependency to its origin chunk URL", () => {
    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();
    const build = {
      failed: false,
      fetchBudget: null,
      cycleShortCircuits: new Set(['assets/cyclic.js']),
    };

    const result = rewrite(
      handler,
      "import './cyclic.js';\nexport const v = 1;",
      loadState,
      'assets/referrer.js',
      build
    );

    expect(result).toContain(`${PUBLIC_PATH}assets/cyclic.js`);
  });

  it('fails the load with a diagnostic naming the referring chunk and the dependency that was never built', () => {
    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();
    const build = {
      failed: false,
      fetchBudget: null,
      cycleShortCircuits: new Set<string>(),
    };

    let thrown: unknown;
    try {
      rewrite(
        handler,
        "import './never-built.js';\nexport const v = 1;",
        loadState,
        'assets/referrer.js',
        build
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MfeLoadError);
    expect((thrown as Error).message).toContain('assets/referrer.js');
    expect((thrown as Error).message).toContain('assets/never-built.js');
    // The whole point: no origin URL is emitted for it.
    expect((thrown as Error).message).toMatch(/origin URL/);
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
