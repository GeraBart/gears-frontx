import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveNavigationHistory } from '../../history/singleton.js';
import { RoutingError } from '../../errors.js';
import { createObserver, expectRoutingError, resetRealm, staticSource, mutableSource } from '../helpers.js';
import type { DomainKey, Transition } from '../../types/index.js';

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
    expect(transition.entries).toEqual([
      { extension: 'dashboard', params: [], resolution: { resolved: true, routeOwner: 'DashboardScreen' } },
    ]);
    expect(transition.diff).toEqual({
      added: ['dashboard'],
      removed: [],
      payloadChanged: [],
      reordered: false,
      resolutionChanged: [],
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

  it('observes a navigation performed synchronously from inside its own first callback, exactly once (H2, review round 20)', () => {
    // Before H2, the fan-out subscription was registered only after the
    // initial report ran, so a synchronous re-navigation from inside that
    // very first callback — the deep-link -> mount -> redirect pattern — was
    // never observed: the subscription that would have caught it did not
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

describe('createObserver — a throwing initial report (D1)', () => {
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

describe('createObserver — input validation', () => {
  it('throws invalid-domain-key synchronously for a malformed domain key', () => {
    const error = expectRoutingError(() => createObserver('a.b' as DomainKey, staticSource([]), vi.fn()));
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

describe('createObserver — Resolution-changed', () => {
  it('reports Resolution-changed alone when a registration change flips an entry between resolved and unresolved', () => {
    resetRealm('/en?widgets=chart-old;range=90d');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const source = mutableSource([{ extension: 'chart-old', routeOwner: 'ChartOld' }]);
    createObserver('widgets' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([]);

    expect(onTransition).toHaveBeenCalledTimes(1);
    const diff = onTransition.mock.calls[0][0].diff;
    expect(diff.resolutionChanged).toEqual(['chart-old']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.payloadChanged).toEqual([]);
    expect(diff.reordered).toBe(false);
  });

  it('re-resolves against the current entries when the registered-extensions source changes, without a navigation', () => {
    resetRealm('/en?screen=dashboard');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const source = mutableSource([]);
    createObserver('screen' as DomainKey, source, onTransition);
    onTransition.mockClear();

    source.set([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].entries[0].resolution).toEqual({
      resolved: true,
      routeOwner: 'DashboardScreen',
    });
  });

  it('throws invalid-extension-token when the source\'s changed set now declares a malformed token', () => {
    resetRealm('/en?screen=dashboard');
    const source = mutableSource([]);
    createObserver('screen' as DomainKey, source, vi.fn());

    expect(() => source.set([{ extension: 'Bad', routeOwner: 'x' }])).toThrow(RoutingError);
  });
});

describe('createObserver — a throwing consumer callback (M1, review round 20)', () => {
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
    // 'dashboard' (M1: the callback that would have advanced it to
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

describe('createObserver — inert and stale domain keys', () => {
  it('a domain key no entry currently addresses is inert, not an error; it resolves correctly once an entry under it later appears', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver('screen.tenants.tabs' as DomainKey, staticSource([]), onTransition);
    expect(onTransition.mock.calls[0][0].entries).toEqual([]);
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen.tenants.tabs=contacts');

    expect(onTransition.mock.calls[0][0].diff.added).toEqual(['contacts']);
  });

  it('a nested observer whose enclosing entry changed its own extension resolves an empty list under its now-stale key, as ordinary operation', () => {
    const adapter = resetRealm('/en?screen=tenants;tenantId=ABC&screen.tenants.tabs=contacts');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();

    createObserver('screen.tenants.tabs' as DomainKey, staticSource([]), onTransition);
    onTransition.mockClear();

    // The enclosing `screen` entry switches from `tenants` to `settings` —
    // the nested observer's own key (`screen.tenants.tabs`) is now stale,
    // but it keeps running until its own enclosing consumer releases it.
    resolveNavigationHistory(() => adapter).push('/en?screen=settings');

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][0].entries).toEqual([]);
    expect(onTransition.mock.calls[0][0].diff.removed).toEqual(['contacts']);
  });
});
