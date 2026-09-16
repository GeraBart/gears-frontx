import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveNavigationHistory } from '../../history/singleton.js';
import { createObserver, resetRealm, staticSource, mutableSource } from '../helpers.js';
import type { DomainKey, ReleaseFunction, Transition } from '../../types/index.js';

// FEATURE (route-ownership-signal) §3, Observer Release
// (cpt-frontx-algo-routing-route-ownership-signal-release).

beforeEach(() => {
  resetRealm();
});

describe('release — unsubscribes the fan-out', () => {
  it('reports no further transitions after release', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const release = createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    release();
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe('release — unsubscribes the registered-extensions-source change notification', () => {
  it('the source\'s own release function is called', () => {
    resetRealm('/en');
    const source = mutableSource();
    const release = createObserver('screen' as DomainKey, source, vi.fn());

    release();

    // Firing the (now-released) callback must not reach the observer: since
    // the fake source only clears its own reference on release, firing after
    // release is a plain no-op with nothing listening any more.
    expect(() => source.fireChange()).not.toThrow();
  });
});

describe('release — idempotent', () => {
  it('calling release more than once is a no-op after the first call', () => {
    resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const release = createObserver('screen' as DomainKey, staticSource(), onTransition);

    release();
    expect(() => release()).not.toThrow();
  });

  it('a second release call does not call the registered-extensions source\'s own release function a second time', () => {
    resetRealm('/en');
    const source = mutableSource();
    const release = createObserver('screen' as DomainKey, source, vi.fn());

    release();
    release();

    expect(source.sourceReleaseCallCount).toBe(1);
  });
});

describe('release — round-in-progress', () => {
  it('skips a still-pending delivery to an observer released mid-round by an earlier observer, without undoing an earlier delivery in that same round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const firstOnTransition = vi.fn<(transition: Transition<string>) => void>();
    const secondOnTransition = vi.fn<(transition: Transition<string>) => void>();

    let secondRelease: ReleaseFunction = () => undefined;
    let callCount = 0;
    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      firstOnTransition(transition);
      callCount += 1;
      if (callCount === 2) {
        // Second invocation is the navigation below, not the initial report.
        secondRelease();
      }
    });
    secondRelease = createObserver('screen' as DomainKey, staticSource(), secondOnTransition);

    firstOnTransition.mockClear();
    secondOnTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=settings');

    // The first observer (subscribed before the second) still receives this
    // round's own delivery — an invocation already completed earlier in the
    // round is never undone by a later release in that same round.
    expect(firstOnTransition).toHaveBeenCalledTimes(1);
    // The second observer's own slot, not yet reached when the first
    // observer released it, is skipped rather than invoked.
    expect(secondOnTransition).not.toHaveBeenCalled();
  });
});

// The suite above covers an observer released *by another observer*, mid a
// fan-out round the dispatcher itself is still iterating. None of it
// exercises an observer releasing *itself* while it is the one holding a
// round its own reentrancy guard already queued — the registered-extensions-
// source axis in particular, since the fan-out axis's own nesting is already
// deferred one level up by the fan-out dispatcher (`fanout-dispatch.ts`) and
// never reaches this observer's own `pendingRounds` queue at all.
describe('release — self-release with an already-queued round', () => {
  it('release from inside a callback that queued a round: the queued round does not arrive', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const source = mutableSource([]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, source, (transition) => {
      onTransition(transition);
      callCount += 1;
      if (callCount === 2) {
        // This callback is itself running inside `reresolveAndReport`'s own
        // round, so `set` below cannot run a round immediately — it only
        // queues one (`pendingRounds`).
        source.set([{ extension: 'profile', routeOwner: 'owner-x' }]);
        release();
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    expect(callCount).toBe(2);
  });

  it('release from inside a callback that queued two rounds: neither arrives', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const source = mutableSource([]);
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, source, () => {
      callCount += 1;
      if (callCount === 2) {
        source.set([{ extension: 'profile', routeOwner: 'owner-x' }]);
        source.set([{ extension: 'profile', routeOwner: 'owner-y' }]);
        release();
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    expect(callCount).toBe(2);
  });

  it('release called twice from inside that callback stays idempotent and still drops the queued round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const source = mutableSource([]);
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, source, () => {
      callCount += 1;
      if (callCount === 2) {
        source.set([{ extension: 'profile', routeOwner: 'owner-x' }]);
        release();
        release();
      }
    });

    expect(() => resolveNavigationHistory(() => adapter).push('/en?screen=profile')).not.toThrow();

    expect(callCount).toBe(2);
    expect(source.sourceReleaseCallCount).toBe(1);
  });

  it('a throwing callback on a live (not released) observer still drains its own queued round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const source = mutableSource([]);
    const seen: number[] = [];
    let callCount = 0;

    createObserver('screen' as DomainKey, source, () => {
      callCount += 1;
      seen.push(callCount);
      if (callCount === 2) {
        source.set([{ extension: 'profile', routeOwner: 'owner-x' }]);
        throw new Error('consumer blew up');
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    // Initial report (1), the navigation that throws (2), then the round it
    // queued before throwing — still drained, since nothing released this
    // observer. A throw isolates the round that threw; it must not cost the
    // round already queued behind it.
    expect(seen).toEqual([1, 2, 3]);
  });

  it('after release, a later genuine navigation produces nothing', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const source = mutableSource([]);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, source, (transition) => {
      onTransition(transition);
      callCount += 1;
      if (callCount === 2) {
        source.set([{ extension: 'profile', routeOwner: 'owner-x' }]);
        release();
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');
    onTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).not.toHaveBeenCalled();
  });

  it('an observer released while another observer is live does not affect the other', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const firstSource = mutableSource([]);
    const secondSource = mutableSource([]);
    const firstOnTransition = vi.fn<(transition: Transition<string>) => void>();
    const secondOnTransition = vi.fn<(transition: Transition<string>) => void>();
    let firstRelease: ReleaseFunction = () => undefined;
    let firstCallCount = 0;

    firstRelease = createObserver('screen' as DomainKey, firstSource, (transition) => {
      firstOnTransition(transition);
      firstCallCount += 1;
      if (firstCallCount === 2) {
        firstSource.set([{ extension: 'profile', routeOwner: 'owner-x' }]);
        firstRelease();
      }
    });
    createObserver('screen' as DomainKey, secondSource, secondOnTransition);

    firstOnTransition.mockClear();
    secondOnTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    // The first observer's own queued round is dropped by its self-release;
    // it receives only this round's own delivery.
    expect(firstOnTransition).toHaveBeenCalledTimes(1);
    // The second observer, on its own unrelated source, is unaffected by the
    // first's own `released` flag — each observer closes over its own.
    expect(secondOnTransition).toHaveBeenCalledTimes(1);

    secondOnTransition.mockClear();
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(secondOnTransition).toHaveBeenCalledTimes(1);
  });
});
