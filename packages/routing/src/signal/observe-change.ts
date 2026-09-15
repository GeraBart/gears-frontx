/**
 * Observable Transition Signal — `cpt-frontx-algo-routing-route-ownership-signal-observe-change`.
 * Observer Release — `cpt-frontx-algo-routing-route-ownership-signal-release`.
 *
 * The two algorithms share this module because release closes over exactly
 * the subscriptions this file's own observer registers at creation — the
 * identical relationship `fanout-dispatch.ts` already has between `subscribe`
 * and the release function it returns.
 *
 * FEATURE (route-ownership-signal) §3, "Observable Transition Signal" /
 * "Observer Release".
 */
import { RoutingError } from '../errors.js';
import { isValidDomainKey, validateName } from '../grammar/name.js';
import { parseGrammar } from '../grammar/parse.js';
import type {
  CreateObserver,
  DomainKey,
  ExtensionToken,
  NavigationHistory,
  RegisteredExtensionsSource,
  ReleaseFunction,
  ResolvedEntry,
  TransitionDiff,
} from '../types/index.js';
import { resolveEntries } from './entry-resolution.js';

/**
 * Validates every extension token a registered-extensions source currently
 * declares — the identical check FEATURE §3 (Observable Transition Signal)
 * runs both at creation (step 1.1) and on every subsequent
 * registered-extensions-source change (step 3.1).
 */
function validateRegistrations<TRouteOwner>(source: RegisteredExtensionsSource<TRouteOwner>): void {
  for (const registration of source.getRegistrations()) {
    if (!validateName(registration.extension)) {
      throw RoutingError.invalidExtensionToken(registration.extension);
    }
  }
}

function validateDomainKeyAndRegistrations<TRouteOwner>(
  domainKey: string,
  source: RegisteredExtensionsSource<TRouteOwner>,
): asserts domainKey is DomainKey {
  if (!isValidDomainKey(domainKey)) {
    throw RoutingError.invalidDomainKey(domainKey);
  }
  validateRegistrations(source);
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
  return resolveEntries(domainKey, parsed.entries, source);
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
  const resolutionChanged: ExtensionToken[] = [];

  for (const entry of current) {
    const before = previousByExtension.get(entry.extension);
    if (before === undefined) {
      added.push(entry.extension);
      continue;
    }
    if (!paramsEqual(before.params, entry.params)) {
      payloadChanged.push(entry.extension);
    } else if (before.resolution.resolved !== entry.resolution.resolved) {
      resolutionChanged.push(entry.extension);
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

  return { added, removed, payloadChanged, reordered, resolutionChanged, unresolved };
}

function diffIsEmpty(diff: TransitionDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.payloadChanged.length === 0 &&
    !diff.reordered &&
    diff.resolutionChanged.length === 0
  );
}

// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2
// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-release:p2
// @cpt-flow:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-resolution-and-observation:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-release:p1
/**
 * Builds a `CreateObserver` function bound to `history` (F1 of the review
 * scope this factory closed) rather than resolving the realm-shared
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
  validateDomainKeyAndRegistrations(domainKey, source);

  // This observer's own initial state, recorded here as part of step 1.1
  // (H2, review round 20: the FEATURE's own former standalone "record"
  // step is now folded into this one, since subscribing before reporting —
  // below — needs this baseline set no later than this point) —
  // `reresolveAndReport` (below) reads and overwrites this same binding on
  // every later navigation.
  let previous = resolveCurrentEntries(history, domainKey, source);
  // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-resolve-entries-at-creation
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-resolve

  /** FEATURE §3, Observable Transition Signal, steps 2.1-2.5 — shared by a
   * fan-out navigation and a registered-extensions-source change alike
   * (step 3.2: "exactly as if a navigation had occurred"). */
  function reresolveAndReport(): void {
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
    // The "no call" branch this instruction names has no code of its own —
    // co-located with the enclosing `if`/`else`, whose `else` arm below is
    // the real code this pair wraps.
    if (diffIsEmpty(diff)) {
      // Nothing about this domain key's own entries changed — no call, and
      // the baseline advances immediately: there is no consumer callback
      // here that could throw and leave it stale.
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
      previous = current;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
    } else {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-else-diff-nonempty
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-report-transition
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-transition
      onTransition({ domainKey, entries: current, diff });
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-transition
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-report-transition
      // No `try`/`finally` here (M1, review round 20): the baseline advances
      // only once `onTransition` above returns without throwing — deliberately
      // reached *after* the call, not wrapped around it, so a consumer whose
      // own callback throws leaves `previous` exactly where it was. The next
      // navigation to the identical state then re-computes the identical,
      // non-empty diff against that same unmoved baseline and delivers it
      // again, instead of the baseline silently advancing past a transition
      // the consumer never actually finished processing and producing an
      // empty diff — and therefore no report at all — forever after (FEATURE
      // §3, Observable Transition Signal, step 2.5, amended). A subscriber
      // whose own callback throws is still isolated from every other
      // subscriber: this function itself runs inside the fan-out's own
      // per-callback `try`/`catch` (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`),
      // which is what stops this throw from reaching the remaining callbacks
      // in the same round, not anything in this function.
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
      previous = current;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-record-navigation-state
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-else-diff-nonempty
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-no-report-unchanged
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-if-diff-empty
  }

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-subscribe-fanout
  // Subscribed *before* the initial report below (H2, review round 20 —
  // previously this ran after): a consumer that navigates synchronously
  // from inside its own first callback must have that navigation observed
  // by this same subscription, not missed because it did not exist yet.
  // `previous` is already set (immediately above) by the time this
  // subscription can fire, so a reentrant dispatch triggered from within the
  // initial report has a correct baseline to diff against.
  const unsubscribeFanout = history.subscribe(() => {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-navigation
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-notify-navigation
    reresolveAndReport();
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-notify-navigation
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-navigation
  });
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-subscribe-fanout

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-report
  // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-initial-transition
  onTransition({
    domainKey,
    entries: previous,
    diff: {
      added: previous.map((entry) => entry.extension),
      removed: [],
      payloadChanged: [],
      reordered: false,
      resolutionChanged: [],
      unresolved: previous.filter((entry) => !entry.resolution.resolved).map((entry) => entry.extension),
    },
  });
  // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-report-initial-transition
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-initial-report
  // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-create-observer

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-if-source-has-notification
  let unsubscribeSource: ReleaseFunction | undefined;
  if (source.onChange !== undefined) {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-subscribe-extensions-source
    unsubscribeSource = source.onChange(() => {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-extensions-source-changes
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-validate-extensions-source-change
      validateRegistrations(source);
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-validate-extensions-source-change
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-reresolve-on-source-change
      reresolveAndReport();
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-reresolve-on-source-change
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-when-extensions-source-changes
    });
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-subscribe-extensions-source
  }
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-observe-change:p2:inst-if-source-has-notification

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-when-release-called
  let released = false;
  const release: ReleaseFunction = () => {
    if (released) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-if-called-again
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-release-idempotent
      return;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-release-idempotent
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-if-called-again
    }
    released = true;

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-unsubscribe-fanout
    unsubscribeFanout();
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-unsubscribe-fanout

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-if-subscribed-extensions-source
    if (unsubscribeSource !== undefined) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-unsubscribe-extensions-source
      unsubscribeSource();
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-unsubscribe-extensions-source
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-release:p2:inst-if-subscribed-extensions-source
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
