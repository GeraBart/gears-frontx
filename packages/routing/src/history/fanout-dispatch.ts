import { REENTRANT_ROUND_LIMIT, reportRoutingDefect } from '../diagnostics.js';
import { RoutingError } from '../errors.js';
import type { HistoryNotification, HistorySubscriber, ReleaseFunction } from '../types/index.js';

// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2

/**
 * A single `subscribe` registration. Its own identity (not the callback's)
 * is what a round's liveness check and the returned release function key
 * off — FEATURE §3, step 1: "return an unsubscribe function closed over
 * that registry entry," so two `subscribe` calls with the identical
 * callback reference remain two independent, independently releasable
 * registrations.
 */
interface SubscriberToken {
  readonly callback: HistorySubscriber;
}

/**
 * The fan-out registry and round-dispatch machinery shared by both dispatch
 * triggers in FEATURE §3 (the underlying browser subscription, and this
 * instance's own `push`/`replace` calls) — kept as its own class so
 * `navigation-history.ts` composes it rather than re-implementing the
 * snapshot/liveness/reentrancy rules inline.
 */
export class FanOutDispatcher {
  private readonly live = new Set<SubscriberToken>();
  private dispatching = false;
  private readonly pending: HistoryNotification[] = [];

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-add-subscriber
  subscribe(callback: HistorySubscriber): ReleaseFunction {
    const token: SubscriberToken = { callback };
    this.live.add(token);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-add-subscriber
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-unsubscribe
    return () => {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-remove-subscriber
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-unsubscribe-mid-round
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-unsubscribe-mid-round-safe
      // Removing the token from `live` immediately is what makes this safe to
      // call mid-round: the round in progress iterates the snapshot it
      // already took (step 4.1), and the still-live check below (inst-if-
      // still-live) is what turns this removal into a skip for a slot the
      // round has not reached yet — an invocation already completed earlier
      // in this same round is never undone by this delete.
      this.live.delete(token);
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-unsubscribe-mid-round-safe
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-unsubscribe-mid-round
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-remove-subscriber
    };
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-unsubscribe
  }

  /**
   * Dispatches one round for `notification`. A round triggered while another
   * is already in progress — a subscriber that navigates from inside its own
   * callback — is deferred to run after the in-progress round finishes,
   * never folded into it (step 4.4, reentrant navigation). Deferral is
   * bounded: a subscriber that queues a fresh round from every round it
   * receives is a feedback loop, not a cascade, and the drain below stops
   * and throws rather than serving it forever (step 4.4.2).
   */
  dispatch(notification: HistoryNotification): void {
    if (this.dispatching) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-reentrant-navigation
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-reentrant-new-round
      // Queuing rather than recursing into `runRound` is what keeps this
      // navigation's own dispatch a later, separate round instead of folding
      // it into the round already in progress.
      this.pending.push(notification);
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-reentrant-new-round
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-reentrant-navigation
      return;
    }

    this.dispatching = true;
    try {
      this.runRound(notification);
      // A round dispatched while this one was running queued itself above
      // instead of interleaving; drain it now as its own, later round.
      let drained = 0;
      while (this.pending.length > 0) {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-reentrant-round-limit
        // Checked before running the round rather than after, so the bound
        // counts rounds actually run and the breach costs no further
        // subscriber invocation. The queue is abandoned first and the throw
        // raised second: a subscriber feeding this loop has by now queued
        // work that is, by the fact of the breach, no longer trustworthy,
        // and leaving it behind would hand the very next legitimate
        // navigation a queue already primed to breach again.
        if (drained >= REENTRANT_ROUND_LIMIT) {
          this.pending.length = 0;
          throw RoutingError.reentrantRoundLimitExceeded(
            'navigation fan-out dispatch',
            REENTRANT_ROUND_LIMIT,
          );
        }
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-reentrant-round-limit
        drained += 1;
        const next = this.pending.shift();
        if (next !== undefined) {
          this.runRound(next);
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-dispatch-round
  private runRound(notification: HistoryNotification): void {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-snapshot-subscribers
    const snapshot = Array.from(this.live);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-snapshot-subscribers

    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-foreach-subscriber
    for (const token of snapshot) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-still-live
      // Marker wraps the liveness test itself — not only what happens once
      // it passes.
      if (!this.live.has(token)) {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-else-unsubscribed-before-turn
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-skip-unsubscribed-slot
        continue; // unsubscribed after the snapshot, before this slot — skip without invoking
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-skip-unsubscribed-slot
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-else-unsubscribed-before-turn
      }
      // A subscriber's own thrown error is isolated by this whole
      // `try`/`catch` — not re-throwing it is what stops it from
      // propagating past this one callback's own invocation and out of
      // `runRound`, so it never stops delivery to the remaining callbacks in
      // this same snapshot. `inst-isolate-error` wraps the full statement
      // (not the `catch` body alone) since the kit's marker rule
      // requires a marked block to wrap non-empty code.
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-catch-subscriber-error
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-isolate-error
      try {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-invoke-subscriber
        token.callback(notification);
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-invoke-subscriber
      } catch (error) {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-report-subscriber-error
        // Isolation is what this round owes the remaining subscribers;
        // silence is not. A subscriber that throws on every navigation used
        // to be indistinguishable from one quietly doing its job — the
        // failure never propagated and nothing else recorded it, so the
        // only visible symptom was whatever that subscriber was supposed to
        // have updated never updating.
        reportRoutingDefect('a navigation subscriber threw during a fan-out round', error);
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-report-subscriber-error
      }
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-isolate-error
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-catch-subscriber-error
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-still-live
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-foreach-subscriber
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-dispatch-round
}
