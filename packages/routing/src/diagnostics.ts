/**
 * `@gears-frontx/routing` — the two facilities this package uses to make a
 * failure it must not propagate still observable, and to bound a re-entrancy
 * drain that would otherwise never end.
 *
 * `RoutingError` (`./errors.js`) is this package's channel for a failure the
 * caller can and must see, because it reaches that caller by propagating.
 * Neither facility here has that option: a subscriber's own throw must not
 * reach the code that dispatched the round (the fan-out's own isolation
 * rule), and a drain that has already run past its bound has no caller left
 * inside the loop to hand anything to. Before this module existed both cases
 * were resolved by an empty `catch`, which isolated the failure and erased
 * it in the same stroke — a subscriber throwing on every navigation was
 * indistinguishable, from outside, from one that never ran at all.
 *
 * `reportRoutingDefect` is deliberately the smallest channel that still
 * makes such a failure observable: no new option threaded through
 * `resolveNavigationHistory`, no new member on any published contract, and
 * nothing a consumer must opt into before a defect becomes visible. It is
 * the same shape, and the same reasoning, as `@gears-frontx/routing-tanstack`'s
 * own default error channel one layer up; this package stops short of that
 * package's injectable override, which only exists there because that
 * adapter's own entry points already take an options object to hang it on.
 *
 * @packageDocumentation
 */

/**
 * How many rounds a re-entrancy drain may run consecutively, in one
 * dispatch, before the drain is treated as a runaway feedback loop rather
 * than a legitimate cascade.
 *
 * Both places that defer a re-entrant round — the navigation fan-out
 * (`./history/fanout-dispatch.js`) and the transition observer
 * (`./signal/observe-change.js`) — share this one bound, so a consumer that
 * trips the loop through either one meets the identical rule.
 *
 * A legitimate cascade is short and terminates by construction: a guard that
 * redirects once, a canonicalizer that rewrites once, or one round per
 * subscriber in a realm whose subscriber count is itself small. Nothing in
 * this package's own contracts describes a design that needs a hundred
 * consecutive deferred rounds to settle, while a genuine loop — a subscriber
 * that navigates every time it is notified — reaches this bound in
 * microseconds and would otherwise run until the tab is closed, with the
 * loop being flat rather than recursive, so neither a stack overflow nor any
 * other symptom ever surfaces on its own. The bound is therefore set well
 * above every cascade this package can describe and far below any duration a
 * person would experience as a hang.
 */
export const REENTRANT_ROUND_LIMIT = 100;

/**
 * Reports a failure this package has caught and will not re-throw.
 *
 * Callers pass a message naming what failed and, where there is one, the
 * value that was thrown — never a recovery instruction, since there is no
 * caller left to act on one.
 */
export function reportRoutingDefect(message: string, cause?: unknown): void {
  const prefixed = `[@gears-frontx/routing] ${message}`;
  if (cause === undefined) {
    console.error(prefixed);
  } else {
    console.error(prefixed, cause);
  }
}
