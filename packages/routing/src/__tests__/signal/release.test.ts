import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveNavigationHistory } from '../../history/singleton.js';
import { createObserver, resetRealm, staticSource } from '../helpers.js';
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

describe('release — repeated calls', () => {
  it('calling release more than once is a no-op after the first call', () => {
    resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const release = createObserver('screen' as DomainKey, staticSource(), onTransition);

    release();
    expect(() => release()).not.toThrow();
  });

  it('a second release call still leaves the observer silent on a later navigation', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const release = createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    release();
    release();
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).not.toHaveBeenCalled();
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
// fan-out round the dispatcher itself is still iterating. This one covers an
// observer releasing *itself* from inside its own callback while a navigation
// that callback issued is still waiting in the fan-out's own queue.
describe('release — self-release with an already-queued round', () => {
  it('release from inside a callback that queued a round: the queued round does not arrive', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, staticSource(), (transition) => {
      onTransition(transition);
      callCount += 1;
      if (callCount === 2) {
        // This callback runs inside a fan-out round, so the push below only
        // queues a further round.
        history.push('/en?screen=queued-x');
        release();
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    expect(callCount).toBe(2);
  });

  it('release from inside a callback that queued two rounds: neither arrives', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, staticSource(), () => {
      callCount += 1;
      if (callCount === 2) {
        history.push('/en?screen=queued-x');
        history.push('/en?screen=queued-y');
        release();
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    expect(callCount).toBe(2);
  });

  it('release called twice from inside that callback still drops the queued round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, staticSource(), () => {
      callCount += 1;
      if (callCount === 2) {
        history.push('/en?screen=queued-x');
        release();
        release();
      }
    });

    expect(() => resolveNavigationHistory(() => adapter).push('/en?screen=profile')).not.toThrow();

    expect(callCount).toBe(2);
  });

  it('a throwing callback on a live (not released) observer still drains its own queued round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const seen: number[] = [];
    let callCount = 0;

    createObserver('screen' as DomainKey, staticSource(), () => {
      callCount += 1;
      seen.push(callCount);
      if (callCount === 2) {
        history.push('/en?screen=queued-x');
        throw new Error('consumer blew up');
      }
    });

    resolveNavigationHistory(() => adapter).push('/en?screen=profile');

    // Initial report (1), the navigation that throws (2), then the round it
    // queued before throwing — still delivered, since nothing released this
    // observer. A throw isolates the round that threw; it must not cost the
    // round already queued behind it.
    expect(seen).toEqual([1, 2, 3]);
  });

  it('after release, a later genuine navigation produces nothing', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const history = resolveNavigationHistory(() => adapter);
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    let release: ReleaseFunction = () => undefined;
    let callCount = 0;

    release = createObserver('screen' as DomainKey, staticSource(), (transition) => {
      onTransition(transition);
      callCount += 1;
      if (callCount === 2) {
        history.push('/en?screen=queued-x');
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
    const history = resolveNavigationHistory(() => adapter);
    const firstOnTransition = vi.fn<(transition: Transition<string>) => void>();
    const secondOnTransition = vi.fn<(transition: Transition<string>) => void>();
    let firstRelease: ReleaseFunction = () => undefined;
    let firstCallCount = 0;

    firstRelease = createObserver('screen' as DomainKey, staticSource(), (transition) => {
      firstOnTransition(transition);
      firstCallCount += 1;
      if (firstCallCount === 2) {
        firstRelease();
      }
    });
    createObserver('screen' as DomainKey, staticSource(), secondOnTransition);

    firstOnTransition.mockClear();
    secondOnTransition.mockClear();

    history.push('/en?screen=profile');

    expect(firstOnTransition).toHaveBeenCalledTimes(1);
    expect(secondOnTransition).toHaveBeenCalledTimes(1);

    secondOnTransition.mockClear();
    history.push('/en?screen=dashboard');

    expect(firstOnTransition).toHaveBeenCalledTimes(1);
    expect(secondOnTransition).toHaveBeenCalledTimes(1);
  });
});
