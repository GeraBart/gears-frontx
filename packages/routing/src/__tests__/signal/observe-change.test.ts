import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveNavigationHistory } from '../../history/singleton.js';
import { createObserver, expectRoutingError, resetRealm, staticSource, swappableSource } from '../helpers.js';
import type { DomainKey, ExtensionToken, Transition } from '../../types/index.js';

// FEATURE (route-ownership-signal) §3, Observable Transition Signal
// (cpt-frontx-algo-routing-route-ownership-signal-observe-change).

beforeEach(() => {
  resetRealm();
});

describe('createObserver — initial report', () => {
  it('reports an initial transition synchronously, with every present entry as Added', () => {
    resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver(
      'screen' as DomainKey,
      staticSource([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]),
      onTransition,
    );

    expect(onTransition).toHaveBeenCalledTimes(1);
    const transition = onTransition.mock.calls[0][0];
    expect(transition.domainKey).toBe('screen');
    expect(transition.cause).toBe('initial');
    expect(transition.entries).toEqual([
      { extension: 'dashboard', params: [], resolution: { resolved: true, routeOwner: 'DashboardScreen' } },
    ]);
    expect(transition.diff).toEqual({
      added: ['dashboard'],
      removed: [],
      payloadChanged: [],
      reordered: false,
      unresolved: [],
    });
  });

  it('reports an initial transition with an empty entry list when the domain key addresses nothing', () => {
    resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver('screen' as DomainKey, staticSource([]), onTransition);

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].entries).toEqual([]);
    expect(onTransition.mock.calls[0][0].diff.added).toEqual([]);
  });

  it('lists an unresolved entry under both Added and Unresolved at creation', () => {
    resetRealm('/en?screen=unknown-screen');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver('screen' as DomainKey, staticSource([]), onTransition);

    const diff = onTransition.mock.calls[0][0].diff;
    expect(diff.added).toEqual(['unknown-screen']);
    expect(diff.unresolved).toEqual(['unknown-screen']);
  });

  it('observes a navigation performed synchronously from inside its own first callback, exactly once', () => {
    // If the fan-out subscription were registered only after the
    // initial report ran, a synchronous re-navigation from inside that
    // very first callback — the deep-link -> mount -> redirect pattern — would go
    // unobserved: the subscription that would catch it would not
    // exist yet at the moment the redirect fired.
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const receivedScreens: string[] = [];
    let redirected = false;

    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      const current = transition.entries[0]?.extension;
      receivedScreens.push(current ?? '(none)');
      if (!redirected) {
        redirected = true;
        history.push('/en?screen=other');
      }
    });

    // Initial report ('dashboard'), then the resulting redirect's own
    // transition ('other') — delivered exactly once, not zero times and not
    // twice.
    expect(receivedScreens).toEqual(['dashboard', 'other']);
    expect(history.location.search).toBe('screen=other');
  });
});

describe('createObserver — a throwing initial report', () => {
  it('leaves zero live subscriptions when the very first callback throws, so a later navigation calls nothing', () => {
    // The fan-out subscription is registered before this initial report
    // runs (so a synchronous redirect from a *successful* first callback is
    // still observed — see the "exactly once" test above). If the report
    // itself throws, `createObserver` throws too and never reaches the
    // return statement that would hand the caller a release function — so
    // without an explicit release inside the throw path, that subscription
    // would stay registered forever with nothing able to release it.
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const onTransition = vi.fn(() => {
      throw new Error('boom');
    });

    expect(() => createObserver('screen' as DomainKey, staticSource([]), onTransition)).toThrow('boom');
    expect(onTransition).toHaveBeenCalledTimes(1);

    history.push('/en?screen=other');

    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it('still delivers exactly once, and still allows a redirect from the first callback, when the first callback does not throw', () => {
    // Same scenario as the "exactly once" test above, restated here
    // alongside the throwing case so the two outcomes — release-on-throw
    // versus normal delivery — are visible side by side.
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const receivedScreens: string[] = [];
    let redirected = false;

    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      receivedScreens.push(transition.entries[0]?.extension ?? '(none)');
      if (!redirected) {
        redirected = true;
        history.push('/en?screen=other');
      }
    });

    expect(receivedScreens).toEqual(['dashboard', 'other']);
  });
});

describe('createObserver — subscribing before the initial report', () => {
  it('does not re-resolve a navigation it observes from inside its own initial report against a set registered during that report', () => {
    // The registered set is read once when the observer starts; a
    // registration a consumer makes from inside the first report does not
    // change how the navigation that report triggers resolves.
    const adapter = resetRealm('/en?screen=app');
    const history = resolveNavigationHistory(() => adapter);
    const source = swappableSource([]);
    const reportedResolutions: boolean[] = [];
    let calls = 0;

    createObserver('screen' as DomainKey, source, (transition) => {
      calls += 1;
      reportedResolutions.push(transition.entries[0]?.resolution.resolved ?? false);
      if (calls === 1) {
        source.set([{ extension: 'app', routeOwner: 'AppScreen' }]);
        history.push('/en?screen=app;mode=x');
      }
    });

    expect(reportedResolutions).toEqual([false, false]);
  });

  it('releases the fan-out subscription when the first report throws, subscribing to nothing else', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const onChange = vi.fn();
    const source = { ...staticSource(), onChange };
    const onTransition = vi.fn(() => {
      throw new Error('boom');
    });

    expect(() => createObserver('screen' as DomainKey, source, onTransition)).toThrow('boom');
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    history.push('/en?screen=other');

    expect(onTransition).toHaveBeenCalledTimes(1);
  });
});

describe('createObserver — input validation', () => {
  it('throws invalid-domain-key synchronously for a malformed domain key', () => {
    const error = expectRoutingError(() => createObserver('a.b' as DomainKey, staticSource([]), vi.fn()));
    expect(error.code).toBe('invalid-domain-key');
  });

  // §6 Acceptance Criteria: "a domain key that is not a single valid name —
  // `screen.tenants.tabs` among them".
  it('throws invalid-domain-key for the composite-shaped "screen.tenants.tabs", which is not a valid single-name domain key', () => {
    const error = expectRoutingError(() =>
      createObserver('screen.tenants.tabs' as DomainKey, staticSource([]), vi.fn()),
    );
    expect(error.code).toBe('invalid-domain-key');
  });

  it('throws invalid-extension-token synchronously naming a malformed registered extension', () => {
    const error = expectRoutingError(() =>
      createObserver('screen' as DomainKey, staticSource([{ extension: 'Bad', routeOwner: 'x' }]), vi.fn()),
    );
    expect(error.code).toBe('invalid-extension-token');
  });

  it('never calls onTransition when creation itself throws', () => {
    const onTransition = vi.fn();
    expect(() => createObserver('a.b' as DomainKey, staticSource([]), onTransition)).toThrow();
    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe('createObserver — reacting to navigation', () => {
  it('reports Added for an entry newly present after navigation', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver(
      'screen' as DomainKey,
      staticSource([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]),
      onTransition,
    );
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].diff.added).toEqual(['dashboard']);
  });

  it('reports Removed for an entry no longer present after navigation', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en');

    expect(onTransition.mock.calls[0][0].diff.removed).toEqual(['dashboard']);
  });

  it('reports Payload-changed for an entry whose params differ, never as Added/Removed', () => {
    const adapter = resetRealm('/en?screen=dashboard;orientation=left');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard;orientation=right');

    const diff = onTransition.mock.calls[0][0].diff;
    expect(diff.payloadChanged).toEqual(['dashboard']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('reports Reordered:true when two persisting tokens swap relative order, with no payload change', () => {
    const adapter = resetRealm('/en?widgets=line-a;range=7d&widgets=line-b;range=30d');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('widgets' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push(
      '/en?widgets=line-b;range=30d&widgets=line-a;range=7d',
    );

    const diff = onTransition.mock.calls[0][0].diff;
    expect(diff.reordered).toBe(true);
    expect(diff.payloadChanged).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('reports no transition at all when nothing about this domain key changed', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).not.toHaveBeenCalled();
  });

  it('reports no transition when only a foreign domain key or the hash changed', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard&modal=create-contact#section');

    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe('createObserver — the cause of each transition', () => {
  it('carries "push" for a navigation written through the substrate\'s push', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].cause).toBe('push');
  });

  it('carries "replace" for a navigation written through the substrate\'s replace', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).replace('/en?screen=dashboard');

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].cause).toBe('replace');
  });

  it('carries "history" for a navigation delivered by the browser\'s own subscription', async () => {
    const adapter = resetRealm('/en');
    const history = resolveNavigationHistory(() => adapter);
    const causes: string[] = [];
    let delivered: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      causes.push(transition.cause);
      if (causes.length === 2) {
        delivered();
      }
    });

    adapter.simulateExternalPop('/en?screen=dashboard');
    await arrived;

    expect(causes).toEqual(['initial', 'history']);
    expect(history.location.search).toBe('screen=dashboard');
  });

  it('carries "history" for a step through the substrate\'s go', async () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    history.push('/en?screen=settings');
    const causes: string[] = [];
    let delivered: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      causes.push(transition.cause);
      if (causes.length === 2) {
        delivered();
      }
    });

    history.go(-1);
    await arrived;

    expect(causes).toEqual(['initial', 'history']);
    expect(history.location.search).toBe('screen=dashboard');
  });

  it('carries each transition\'s own cause when pushes and replaces alternate', () => {
    const adapter = resetRealm('/en');
    const history = resolveNavigationHistory(() => adapter);
    const causes: string[] = [];
    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      causes.push(transition.cause);
    });

    history.push('/en?screen=a');
    history.replace('/en?screen=b');
    history.push('/en?screen=c');

    expect(causes).toEqual(['initial', 'push', 'replace', 'push']);
  });
});

describe('createObserver — the registered-extensions set is read once, at start', () => {
  it('does not read the source again on a later navigation', () => {
    const adapter = resetRealm('/en');
    const source = staticSource([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);
    const getRegistrations = vi.spyOn(source, 'getRegistrations');
    createObserver('screen' as DomainKey, source, vi.fn());
    const readsAtStart = getRegistrations.mock.calls.length;

    const history = resolveNavigationHistory(() => adapter);
    history.push('/en?screen=dashboard');
    history.push('/en?screen=other');

    expect(getRegistrations.mock.calls.length).toBe(readsAtStart);
  });

  it('resolves a later navigation against the set it read at start, not against what the source would return now', () => {
    const adapter = resetRealm('/en');
    const source = swappableSource([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([]);
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).toHaveBeenCalledTimes(1);
    const transition = onTransition.mock.calls[0][0];
    expect(transition.entries[0].resolution).toEqual({ resolved: true, routeOwner: 'DashboardScreen' });
    expect(transition.diff.unresolved).toEqual([]);
  });

  it('keeps an extension unregistered at start unresolved after the source later declares it', () => {
    const adapter = resetRealm('/en');
    const source = swappableSource([]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    const transition = onTransition.mock.calls[0][0];
    expect(transition.entries[0].resolution).toEqual({ resolved: false });
    expect(transition.diff.unresolved).toEqual(['dashboard']);
  });

  it('resolves a later navigation against the start set when the source returns its own live list and mutates it', () => {
    const adapter = resetRealm('/en');
    const live = [{ extension: 'dashboard' as ExtensionToken, routeOwner: 'DashboardScreen' }];
    const source = { getRegistrations: () => live };
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, source, onTransition);
    onTransition.mockClear();

    live[0].routeOwner = 'Swapped';
    live.push({ extension: 'settings' as ExtensionToken, routeOwner: 'SettingsScreen' });
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard&screen=settings');

    const transition = onTransition.mock.calls[0][0];
    expect(transition.entries.map((e) => e.resolution)).toEqual([
      { resolved: true, routeOwner: 'DashboardScreen' },
      { resolved: false },
    ]);
  });

  it('keeps the route owner read at start when the source later swaps it under the same token', () => {
    const adapter = resetRealm('/en?widgets=chart;range=90d');
    const source = swappableSource([{ extension: 'chart', routeOwner: 'ChartPlaceholder' }]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('widgets' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([{ extension: 'chart', routeOwner: 'ChartReal' }]);
    expect(onTransition).not.toHaveBeenCalled();
    resolveNavigationHistory(() => adapter).push('/en?widgets=chart;range=30d');

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].entries).toEqual([
      {
        extension: 'chart',
        params: [{ name: 'range', value: '30d' }],
        resolution: { resolved: true, routeOwner: 'ChartPlaceholder' },
      },
    ]);
  });

  it('delivers no transition when the source\'s answer changes and no navigation follows', () => {
    resetRealm('/en?screen=dashboard');
    const source = swappableSource([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([]);
    source.set([{ extension: 'dashboard', routeOwner: 'Other' }]);

    expect(onTransition).not.toHaveBeenCalled();
  });

  it('still validates every extension token the source declares at start', () => {
    resetRealm('/en');
    const error = expectRoutingError(() =>
      createObserver('screen' as DomainKey, staticSource([{ extension: 'Bad', routeOwner: 'x' }]), vi.fn()),
    );

    expect(error.code).toBe('invalid-extension-token');
  });
});

describe('createObserver — the diff categories', () => {
  it('carries exactly added, removed, payloadChanged, reordered and unresolved on the initial transition', () => {
    resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource(), onTransition);

    expect(Object.keys(onTransition.mock.calls[0][0].diff).sort()).toEqual([
      'added',
      'payloadChanged',
      'removed',
      'reordered',
      'unresolved',
    ]);
  });

  it('carries exactly added, removed, payloadChanged, reordered and unresolved on a later transition', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=settings');

    expect(onTransition.mock.calls[0][0].diff).toEqual({
      added: ['settings'],
      removed: ['dashboard'],
      payloadChanged: [],
      reordered: false,
      unresolved: ['settings'],
    });
  });

  it('delivers no transition when an unresolved entry persists unchanged across a navigation', () => {
    const adapter = resetRealm('/en?screen=unknown');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=unknown#anchor');

    expect(onTransition).not.toHaveBeenCalled();
  });

  it('delivers no transition when the source\'s answer changed but the entries did not', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const source = swappableSource([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([]);
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard#anchor');

    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe('createObserver — a throwing consumer callback', () => {
  it('does not advance the baseline when the callback throws, so the next navigation still diffs against the pre-throw state', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    let callCount = 0;
    const reported: { added: readonly string[]; removed: readonly string[] }[] = [];
    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      callCount += 1;
      // Skip the synchronous initial report (call 1) — only the two
      // navigation-triggered transitions below matter to this assertion.
      if (callCount > 1) {
        reported.push({ added: transition.diff.added, removed: transition.diff.removed });
      }
      if (callCount === 2) {
        throw new Error('boom');
      }
    });

    const history = resolveNavigationHistory(() => adapter);
    // The fan-out isolates a subscriber's own thrown error (FanOutDispatcher),
    // so this second transition (dashboard -> settings) reaches `onTransition`
    // and throws, but `history.push` itself never throws. The baseline stays
    // at 'dashboard' — the callback never finished processing 'settings'.
    history.push('/en?screen=settings');
    // Third transition: other. Because the baseline never advanced past
    // 'dashboard' (the callback that would have advanced it to
    // 'settings' threw first), this diff is computed against 'dashboard'
    // again, not against 'settings' — 'dashboard' is reported removed a
    // second time, and 'settings' (never confirmed processed) is not
    // reported removed at all.
    history.push('/en?screen=other');

    expect(reported).toEqual([
      { added: ['settings'], removed: ['dashboard'] },
      { added: ['other'], removed: ['dashboard'] },
    ]);
  });

  it('re-delivers the identical transition when navigation later returns to the state the throwing callback never finished processing', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    let callCount = 0;
    const reported: { added: readonly string[]; removed: readonly string[] }[] = [];
    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      callCount += 1;
      if (callCount === 1) {
        return; // skip the synchronous initial report
      }
      reported.push({ added: transition.diff.added, removed: transition.diff.removed });
      if (callCount === 2) {
        throw new Error('boom');
      }
    });

    const history = resolveNavigationHistory(() => adapter);
    history.push('/en?screen=settings'); // dashboard -> settings: reported, then throws; baseline stays 'dashboard'
    history.push('/en?screen=dashboard'); // settings -> dashboard: diffs against the still-frozen 'dashboard' baseline -> empty, no report
    history.push('/en?screen=settings'); // dashboard -> settings again: baseline never moved past 'dashboard', so this is the identical diff as the very first delivery

    expect(reported).toEqual([
      { added: ['settings'], removed: ['dashboard'] },
      { added: ['settings'], removed: ['dashboard'] },
    ]);
  });
});

describe('createObserver — a navigation issued from a transition callback, serialized by the fan-out', () => {
  it('a navigation issued synchronously from a transition callback does not clobber the baseline', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    let callCount = 0;
    const reported: { added: readonly string[]; removed: readonly string[] }[] = [];

    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      callCount += 1;
      if (callCount === 1) {
        return; // the initial report
      }
      reported.push({ added: transition.diff.added, removed: transition.diff.removed });
      if (callCount === 2) {
        history.push('/en?screen=other');
      }
    });

    history.push('/en?screen=settings');
    // The baseline now reads 'other'; a genuine later navigation back to
    // 'dashboard' must still be reported.
    history.push('/en?screen=dashboard');

    expect(reported.at(-1)).toEqual({ added: ['dashboard'], removed: ['other'] });
    expect(history.location.search).toBe('screen=dashboard');
  });

  it('carries each serialized round\'s own cause', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const causes: string[] = [];

    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      causes.push(transition.cause);
      if (causes.length === 2) {
        history.replace('/en?screen=other');
      }
    });

    history.push('/en?screen=settings');

    expect(causes).toEqual(['initial', 'push', 'replace']);
  });

  it('an asynchronous reentrant navigation (via go, settling on a microtask) still reports correctly', async () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    history.push('/en?screen=settings');
    history.push('/en?screen=other');

    const reported: string[] = [];
    let wentBack = false;
    let settled: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      settled = resolve;
    });
    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      reported.push(transition.entries[0]?.extension ?? '(none)');
      if (reported.length === 2) {
        settled();
      }
      if (!wentBack) {
        wentBack = true;
        history.go(-1);
      }
    });

    // The initial report only — `go`'s own popstate has not fired yet.
    expect(reported).toEqual(['other']);

    await arrived;

    expect(reported).toEqual(['other', 'settings']);
    expect(history.location.search).toBe('screen=settings');

    // A further genuine navigation still reports normally.
    history.push('/en?screen=dashboard');
    expect(reported).toEqual(['other', 'settings', 'dashboard']);
  });

  it('a throwing report still reports the navigation it queued, in its own later round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    let callCount = 0;
    const reportedScreens: string[] = [];

    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      callCount += 1;
      reportedScreens.push(transition.entries[0]?.extension ?? '(none)');
      if (callCount === 2) {
        history.push('/en?screen=nested'); // runs as a later fan-out round
        throw new Error('boom');
      }
    });

    history.push('/en?screen=settings');

    expect(reportedScreens).toEqual(['dashboard', 'settings', 'nested']);
    expect(history.location.search).toBe('screen=nested');
  });

  it('a throw with no nested navigation leaves no phantom round for the next navigation', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const reportedScreens: string[] = [];
    let callCount = 0;

    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      callCount += 1;
      reportedScreens.push(transition.entries[0]?.extension ?? '(none)');
      if (callCount === 2) {
        throw new Error('boom');
      }
    });

    history.push('/en?screen=settings'); // one round; its own callback throws, queuing nothing
    expect(reportedScreens).toEqual(['dashboard', 'settings']);

    history.push('/en?screen=other'); // exactly one further round, never a leaked extra one

    expect(reportedScreens).toEqual(['dashboard', 'settings', 'other']);
  });

  it('two consecutive, non-nested navigations each report exactly once', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    history.push('/en?screen=settings');
    history.push('/en?screen=other');

    expect(onTransition).toHaveBeenCalledTimes(2);
  });
});

describe('createObserver — an observer created inside another observer\'s callback', () => {
  it('each observer receives exactly one report for the resulting state, with its own cause', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const outer: { cause: string; screen: string }[] = [];
    const inner: { cause: string; screen: string }[] = [];
    let created = false;

    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      outer.push({ cause: transition.cause, screen: transition.entries[0]?.extension ?? '(none)' });
      if (transition.cause === 'push' && !created) {
        created = true;
        createObserver('screen' as DomainKey, staticSource(), (innerTransition) => {
          inner.push({ cause: innerTransition.cause, screen: innerTransition.entries[0]?.extension ?? '(none)' });
        });
      }
    });

    history.push('/en?screen=settings');

    expect(outer).toEqual([
      { cause: 'initial', screen: 'dashboard' },
      { cause: 'push', screen: 'settings' },
    ]);
    expect(inner).toEqual([{ cause: 'initial', screen: 'settings' }]);
  });
});

describe('createObserver — a throw from a later fan-out round', () => {
  it('a later, unrelated navigation reports exactly once once the serialized rounds above have settled — no extra round, none skipped', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    let callCount = 0;
    const reportedScreens: string[] = [];

    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      callCount += 1;
      reportedScreens.push(transition.entries[0]?.extension ?? '(none)');
      if (callCount === 2) {
        history.push('/en?screen=other');
      } else if (callCount === 3) {
        history.push('/en?screen=nested');
        throw new Error('boom');
      }
    });

    history.push('/en?screen=settings');
    expect(reportedScreens).toEqual(['dashboard', 'settings', 'other', 'nested']);

    reportedScreens.length = 0;
    history.push('/en?screen=unrelated');

    expect(reportedScreens).toEqual(['unrelated']);
  });

  it('replaying the exact URL the last serialized round settled on reports nothing — its own baseline matches that state', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    let callCount = 0;
    const reportedScreens: string[] = [];

    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      callCount += 1;
      reportedScreens.push(transition.entries[0]?.extension ?? '(none)');
      if (callCount === 2) {
        history.push('/en?screen=other');
      } else if (callCount === 3) {
        history.push('/en?screen=nested');
        throw new Error('boom');
      }
    });

    history.push('/en?screen=settings');
    expect(reportedScreens).toEqual(['dashboard', 'settings', 'other', 'nested']);

    reportedScreens.length = 0;
    history.push('/en?screen=nested'); // replays the state the last serialized round settled on

    expect(reportedScreens).toEqual([]);
  });

  it('a later round whose own callback throws leaves that state unrecorded, and does not stop a second observer on the same history', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);

    let firstCallCount = 0;
    const firstReported: string[] = [];
    createObserver('screen' as DomainKey, staticSource([]), (transition) => {
      firstCallCount += 1;
      firstReported.push(transition.entries[0]?.extension ?? '(none)');
      if (firstCallCount === 2) {
        history.push('/en?screen=other'); // runs as a later fan-out round
      } else if (firstCallCount === 3) {
        throw new Error('boom'); // this later round's own callback throws; nothing further issued
      }
    });

    const secondObserverCalls = vi.fn<(transition: Transition<string>) => void>();
    createObserver('screen' as DomainKey, staticSource([]), secondObserverCalls);
    secondObserverCalls.mockClear();

    history.push('/en?screen=settings');

    // The first observer's later round threw before it could record its
    // own commit, so the next navigation to the identical 'other' state is
    // reported again rather than absorbed as already seen.
    firstReported.length = 0;
    history.push('/en?screen=nested');
    history.push('/en?screen=other');
    expect(firstReported).toEqual(['nested', 'other']);

    expect(secondObserverCalls.mock.calls.at(-1)?.[0]?.entries[0]?.extension).toBe('other');
  });
});

describe('createObserver — inert and stale domain keys', () => {
  it('a domain key no entry currently addresses is inert, not an error; it resolves correctly once an entry under it later appears', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver('tabs' as DomainKey, staticSource([]), onTransition);
    expect(onTransition.mock.calls[0][0].entries).toEqual([]);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?tabs=contacts');

    expect(onTransition.mock.calls[0][0].diff.added).toEqual(['contacts']);
  });

  it('an observer keeps resolving correctly against its own domain key once its own entry is removed by a write elsewhere in the URL, as ordinary operation', () => {
    const adapter = resetRealm('/en?screen=tenants;tenantId=ABC&tabs=contacts');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver('tabs' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    // A structural reset elsewhere in the URL removes this domain's own
    // entry without this observer's own domain key ever changing — a
    // domain key carries no ancestry of its own and so cannot go "stale";
    // the observer keeps running until its own enclosing consumer releases
    // it.
    resolveNavigationHistory(() => adapter).push('/en?screen=settings');

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].entries).toEqual([]);
    expect(onTransition.mock.calls[0][0].diff.removed).toEqual(['contacts']);
  });
});
