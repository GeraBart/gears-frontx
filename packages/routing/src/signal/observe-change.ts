/**
 * Observable Transition Signal — `cpt-frontx-algo-routing-route-ownership-signal-observe-change`.
 * Observer Release — `cpt-frontx-algo-routing-route-ownership-signal-release`.
 *
 * The two algorithms share this module because release closes over exactly
 * the fan-out subscription this file's own observer registers at creation — the
 * identical relationship `fanout-dispatch.ts` already has between `subscribe`
 * and the release function it returns.
 *
 * FEATURE (route-ownership-signal) §3, "Observable Transition Signal" /
 * "Observer Release".
 */
import { RoutingError } from '../errors.js';
import { validateName } from '../grammar/name.js';
import { parseGrammar } from '../grammar/parse.js';
import type {
  CreateObserver,
  DomainKey,
  ExtensionRegistration,
  ExtensionToken,
  NavigationHistory,
  ReleaseFunction,
  RegisteredExtensionsSource,
  ResolvedEntry,
  Transition,
  TransitionDiff,
} from '../types/index.js';
import { resolveEntries } from './entry-resolution.js';

/**
 * Validates every extension token of the registered-extensions set read for a
 * resolution — FEATURE §3 (Observable Transition Signal), steps 1.1 and 2.1.
 */
function validateRegistrations<TRouteOwner>(
  registrations: readonly ExtensionRegistration<TRouteOwner>[],
): void {
  for (const registration of registrations) {
    if (!validateName(registration.extension)) {
      throw RoutingError.invalidExtensionToken(registration.extension);
    }
  }
}

function validateDomainKey(domainKey: string): asserts domainKey is DomainKey {
  if (!validateName(domainKey)) {
    throw RoutingError.invalidDomainKey(domainKey);
  }
}

function resolveCurrentEntries<TRouteOwner>(
  history: NavigationHistory,
  domainKey: DomainKey,
  source: RegisteredExtensionsSource<TRouteOwner>,
): readonly ResolvedEntry<TRouteOwner>[] {
  const location = history.location;
  const parsed = parseGrammar({
    shellSubroute: location.path,
    search: location.search,
    hash: location.hash,
  });
  // Read live for every resolution and copied, so a source that hands back its
  // own mutable list is never held past this call.
  const registrations = source.getRegistrations().map((registration) => ({ ...registration }));
  validateRegistrations(registrations);
  return resolveEntries(domainKey, parsed.entries, { getRegistrations: () => registrations });
}

function paramsEqual(
  a: ResolvedEntry['params'],
  b: ResolvedEntry['params'],
): boolean {
  return a.length === b.length && a.every((p, i) => p.name === b[i].name && p.value === b[i].value);
}

/**
 * Computes the diff between a newly resolved ordered list and the
 * previously reported one — FEATURE §3, Observable Transition Signal,
 * step 2.2.
 */
function computeDiff<TRouteOwner>(
  previous: readonly ResolvedEntry<TRouteOwner>[],
  current: readonly ResolvedEntry<TRouteOwner>[],
): TransitionDiff {
  const previousByExtension = new Map(previous.map((entry) => [entry.extension, entry]));
  const currentByExtension = new Map(current.map((entry) => [entry.extension, entry]));

  const added: ExtensionToken[] = [];
  const payloadChanged: ExtensionToken[] = [];

  for (const entry of current) {
    const before = previousByExtension.get(entry.extension);
    if (before === undefined) {
      added.push(entry.extension);
    } else if (!paramsEqual(before.params, entry.params)) {
      payloadChanged.push(entry.extension);
    }
  }

  const removed: ExtensionToken[] = [];
  for (const entry of previous) {
    if (!currentByExtension.has(entry.extension)) {
      removed.push(entry.extension);
    }
  }

  const previousCommonOrder = previous
    .filter((entry) => currentByExtension.has(entry.extension))
    .map((entry) => entry.extension);
  const currentCommonOrder = current
    .filter((entry) => previousByExtension.has(entry.extension))
    .map((entry) => entry.extension);
  const reordered =
    previousCommonOrder.length !== currentCommonOrder.length ||
    previousCommonOrder.some((token, index) => token !== currentCommonOrder[index]);

  const unresolved = current.filter((entry) => !entry.resolution.resolved).map((entry) => entry.extension);

  return { added, removed, payloadChanged, reordered, unresolved };
}

function diffIsEmpty(diff: TransitionDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.payloadChanged.length === 0 &&
    !diff.reordered
  );
}

// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2
// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-release:p2
// @cpt-flow:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-resolution-and-observation:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-release:p1
/**
 * Builds a `CreateObserver` function bound to `history` rather than
 * resolving the realm-shared
 * singleton internally — the identical seam `./url-back-projection.js`'s
 * `createBackProjectEntries` adds for the same reason. Not exported
 * directly; `createRouteSignal` (`./route-signal.js`) is this package's own
 * public construction path for a `history`-bound instance.
 */
export function createObserverBoundTo(history: NavigationHistory): CreateObserver {
  return (domainKey, source, onTransition) => {
  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-create
  // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-create-observer
  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-resolve
  // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-resolve-entries-at-creation
  validateDomainKey(domainKey);
  // The registered-extensions set is read afresh by every resolution, the
  // initial one included, so an extension registered later resolves from the
  // next navigation; nothing here watches the set for changes.
  // The baseline `reresolveAndReport` (below) reads and overwrites on every
  // later navigation; recorded before subscribing so a navigation caught by
  // that subscription has a correct state to diff against.
  let previous = resolveCurrentEntries(history, domainKey, source);
  // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-resolve-entries-at-creation
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-resolve

  let released = false;

  /** FEATURE §3, Observable Transition Signal, steps 2.1-2.4. A navigation a
   * consumer callback issues from inside a transition it receives reaches
   * this observer as a later fan-out round, so rounds after the initial
   * report never run inside one another. The initial report runs outside any
   * fan-out round: a navigation its callback issues runs before that
   * callback returns (step 1.2 subscribes first for that reason). */
  function reresolveAndReport(cause: Transition['cause']): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-resolve-current
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-resolve-entries
    const current = resolveCurrentEntries(history, domainKey, source);
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-resolve-entries
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-resolve-current

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-compute-diff
    const diff = computeDiff(previous, current);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-compute-diff

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-if-diff-empty
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-no-report-unchanged
    // The "no call" branch has no code of its own — co-located with the
    // enclosing `if`/`else`, whose `else` arm below is the real code.
    if (diffIsEmpty(diff)) {
      // No consumer callback here could throw, so the baseline advances now.
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
      previous = current;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
    } else {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-else-diff-nonempty
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-report-transition
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-transition
      onTransition({ domainKey, cause, entries: current, diff });
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-transition
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-report-transition
      // Reached only once `onTransition` returns without throwing: a
      // callback that throws has not finished processing the transition, so
      // the baseline stays put and the next navigation to the same state
      // reports it again. The fan-out's own per-callback `try`/`catch`
      // isolates the throw from every other subscriber.
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
      previous = current;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-else-diff-nonempty
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-no-report-unchanged
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-if-diff-empty
  }

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-subscribe-fanout
  // Subscribed *before* the initial report below: a consumer that navigates
  // synchronously from inside its own first callback has that navigation
  // observed by this same subscription.
  const unsubscribeFanout = history.subscribe((notification) => {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-navigation
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-notify-navigation
    reresolveAndReport(notification.kind);
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-notify-navigation
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-navigation
  });
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-subscribe-fanout

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-report
  // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-initial-transition
  // If this first callback throws, no release function ever reaches the
  // caller, so the fan-out subscription is released here before the throw
  // propagates.
  try {
    onTransition({
      domainKey,
      cause: 'initial',
      entries: previous,
      diff: {
        added: previous.map((entry) => entry.extension),
        removed: [],
        payloadChanged: [],
        reordered: false,
        unresolved: previous.filter((entry) => !entry.resolution.resolved).map((entry) => entry.extension),
      },
    });
  } catch (error) {
    unsubscribeFanout();
    throw error;
  }
  // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-initial-transition
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-report
  // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-create-observer

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-when-release-called
  const release: ReleaseFunction = () => {
    if (released) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-if-called-again
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-release-repeat-noop
      return;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-release-repeat-noop
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-if-called-again
    }
    released = true;

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-unsubscribe-fanout
    unsubscribeFanout();
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-unsubscribe-fanout

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-return-release-done
    return;
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-return-release-done
  };
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-when-release-called

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-return-release
  return release;
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-return-release
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-create
  };
}
