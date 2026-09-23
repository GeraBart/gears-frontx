import { describe, expect, it, vi } from 'vitest';
import { REENTRANT_ROUND_LIMIT } from '../../diagnostics.js';
import { FanOutDispatcher } from '../../history/fanout-dispatch.js';
import { expectRoutingError } from '../helpers.js';
import type { HistoryNotification } from '../../types/index.js';

// FEATURE (navigation-substrate) §3, Fan-Out Subscription Dispatch, step 4
// and its Rationale.

const notification: HistoryNotification = {
  location: { path: '/en', search: '', hash: '', position: 0 },
  kind: 'push',
};

describe('FanOutDispatcher — registration order', () => {
  it('invokes every live subscriber once, in registration order', () => {
    const dispatcher = new FanOutDispatcher();
    const calls: string[] = [];
    dispatcher.subscribe(() => calls.push('a'));
    dispatcher.subscribe(() => calls.push('b'));
    dispatcher.subscribe(() => calls.push('c'));

    dispatcher.dispatch(notification);

    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

describe('FanOutDispatcher — error isolation', () => {
  it('a throwing subscriber does not stop delivery to the rest of the round', () => {
    // The throw is reported (its own suite, below); silenced here so this
    // suite's own subject — delivery to the rest of the round — is not
    // buried in the report it deliberately produces.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatcher = new FanOutDispatcher();
    const first = vi.fn();
    const third = vi.fn();
    dispatcher.subscribe(first);
    dispatcher.subscribe(() => {
      throw new Error('boom');
    });
    dispatcher.subscribe(third);

    expect(() => dispatcher.dispatch(notification)).not.toThrow();

    expect(first).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    reported.mockRestore();
  });
});

describe('FanOutDispatcher — mid-round unsubscribe', () => {
  it('a listener that unsubscribes itself receives that round\'s own invocation', () => {
    const dispatcher = new FanOutDispatcher();
    const calls: string[] = [];
    let release = (): void => undefined;
    release = dispatcher.subscribe(() => {
      calls.push('self');
      release();
    });

    dispatcher.dispatch(notification);

    expect(calls).toEqual(['self']);
  });

  it('a listener unsubscribed by an earlier listener in the same round is skipped, not invoked', () => {
    const dispatcher = new FanOutDispatcher();
    const calls: string[] = [];
    const laterCallback = vi.fn(() => calls.push('later'));
    dispatcher.subscribe(() => {
      calls.push('earlier');
      releaseLater();
    });
    const releaseLater = dispatcher.subscribe(laterCallback);

    dispatcher.dispatch(notification);

    expect(calls).toEqual(['earlier']);
    expect(laterCallback).not.toHaveBeenCalled();
  });

  it('unsubscribing mid-round never un-invokes a callback already completed earlier in that same round', () => {
    const dispatcher = new FanOutDispatcher();
    const earlierCallback = vi.fn();
    const releaseEarlier = dispatcher.subscribe(earlierCallback);
    dispatcher.subscribe(() => {
      releaseEarlier();
    });

    dispatcher.dispatch(notification);

    expect(earlierCallback).toHaveBeenCalledTimes(1);
  });

  it('a listener subscribed twice is two independent registrations, each releasable on its own', () => {
    const dispatcher = new FanOutDispatcher();
    const callback = vi.fn();
    const releaseFirst = dispatcher.subscribe(callback);
    dispatcher.subscribe(callback);

    releaseFirst();
    dispatcher.dispatch(notification);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('FanOutDispatcher — reentrant navigation', () => {
  it('a navigation triggered from inside a callback dispatches as a new, later round, not folded into the current one', () => {
    const dispatcher = new FanOutDispatcher();
    const order: string[] = [];
    const second: HistoryNotification = {
      location: { path: '/fr', search: '', hash: '', position: 1 },
      kind: 'push',
    };

    dispatcher.subscribe((n) => {
      order.push(`first-sees-${n.kind}-${n.location.path}`);
      if (n === notification) {
        dispatcher.dispatch(second);
        order.push('reentrant-dispatch-returned');
      }
    });
    dispatcher.subscribe((n) => {
      order.push(`second-sees-${n.kind}-${n.location.path}`);
    });

    dispatcher.dispatch(notification);

    // The reentrant dispatch call returns immediately (queued), and the
    // round in progress finishes iterating its own snapshot before the
    // queued round runs.
    expect(order).toEqual([
      'first-sees-push-/en',
      'reentrant-dispatch-returned',
      'second-sees-push-/en',
      'first-sees-push-/fr',
      'second-sees-push-/fr',
    ]);
  });
});

describe('FanOutDispatcher — release function', () => {
  it('the returned release function removes the subscriber from future rounds', () => {
    const dispatcher = new FanOutDispatcher();
    const callback = vi.fn();
    const release = dispatcher.subscribe(callback);

    release();
    dispatcher.dispatch(notification);

    expect(callback).not.toHaveBeenCalled();
  });

  it('calling release more than once is a no-op after the first call', () => {
    const dispatcher = new FanOutDispatcher();
    const callback = vi.fn();
    const release = dispatcher.subscribe(callback);

    release();
    expect(() => release()).not.toThrow();
    dispatcher.dispatch(notification);

    expect(callback).not.toHaveBeenCalled();
  });
});

describe('FanOutDispatcher — bounded deferral', () => {
  it('stops and throws when a subscriber queues a fresh round from every round it receives', () => {
    const dispatcher = new FanOutDispatcher();
    let rounds = 0;
    dispatcher.subscribe(() => {
      rounds += 1;
      // Capped far above the dispatcher's own bound so this test fails by
      // assertion rather than by running until the process is killed: an
      // unbounded drain serves every one of these and asks for more.
      if (rounds < 5000) {
        dispatcher.dispatch(notification);
      }
    });

    const error = expectRoutingError(() => dispatcher.dispatch(notification));

    expect(error.code).toBe('reentrant-round-limit-exceeded');
    expect(error.limit).toBe(REENTRANT_ROUND_LIMIT);
    expect(rounds).toBeLessThan(5000);
  });

  it('serves a cascade that settles on its own, without reaching the bound', () => {
    const dispatcher = new FanOutDispatcher();
    let rounds = 0;
    dispatcher.subscribe(() => {
      rounds += 1;
      if (rounds < 3) {
        dispatcher.dispatch(notification);
      }
    });

    expect(() => dispatcher.dispatch(notification)).not.toThrow();

    expect(rounds).toBe(3);
  });

  it('starts the next dispatch from an empty queue after a breach', () => {
    const dispatcher = new FanOutDispatcher();
    let looping = true;
    let rounds = 0;
    dispatcher.subscribe(() => {
      rounds += 1;
      if (looping && rounds < 5000) {
        dispatcher.dispatch(notification);
      }
    });

    expectRoutingError(() => dispatcher.dispatch(notification));
    looping = false;
    rounds = 0;

    expect(() => dispatcher.dispatch(notification)).not.toThrow();

    expect(rounds).toBe(1);
  });
});

describe('FanOutDispatcher — a throwing subscriber is reported, not only isolated', () => {
  it('reports the error the subscriber threw', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatcher = new FanOutDispatcher();
    const thrown = new Error('boom');
    dispatcher.subscribe(() => {
      throw thrown;
    });

    dispatcher.dispatch(notification);

    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0][1]).toBe(thrown);
    reported.mockRestore();
  });
});
