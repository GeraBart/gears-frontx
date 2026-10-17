/**
 * The FrontX router (`cpt-frontx-component-routing-router`): the concrete
 * router that conforms structurally to the runtime's abstract router and keeps
 * the URL and the mounts in agreement for every routed domain
 * (`cpt-frontx-adr-extension-routing-port`). Its behaviour is specified by
 * FEATURE route-ownership-signal: §1.5 (Router members, Engine-provider
 * read), §2 (flow steps 3 to 9) and §3 (Router Admission And Lifecycle).
 *
 * The router imports nothing of the runtime and names no runtime type. It
 * reads ids, routes and one boolean per domain, and it reaches the runtime
 * only through the executor and the type system `connect` hands it
 * (`./abstract-dependencies.ts`). It never mounts or unmounts directly and
 * never reads how a chain is delivered, its execution state or its outcome.
 *
 * One instance exists per evaluated copy of this package, and so one per
 * runtime. Copies in one page share state only through the realm slots of
 * `./realm-state.ts`.
 *
 * @packageDocumentation
 */
import { reportRoutingDefect } from '../diagnostics.js';
import { RoutingError } from '../errors.js';
import { deriveExtensionToken, namesEqual, validateName } from '../grammar/name.js';
import { parseGrammar } from '../grammar/parse.js';
import { serializeGrammar } from '../grammar/serialize.js';
import { resolveNavigationHistory } from '../history/singleton.js';
import { createRouteSignal, type RouteSignal } from '../signal/route-signal.js';
import type {
  BackProjectionDelta,
  DomainKey,
  Entry,
  EntryAddress,
  ExtensionToken,
  HistoryVerb,
  NavigationHistory,
  RegisteredExtensionsSource,
  ReleaseFunction,
  ResolvedEntry,
  Transition,
} from '../types/index.js';
import type { ActionsChainExecutor, RouterTypeSystem } from './abstract-dependencies.js';
import {
  sharedNestedDomainKeys,
  sharedPageLoads,
  sharedRoutedDomainRoutes,
  type NestedDomainKeys,
  type PageLoad,
  type PageLoads,
  type RoutedDomainRoutes,
} from './realm-state.js';

/** The router's copy of one admitted routed domain. */
interface RoutedDomain {
  readonly domainId: string;
  readonly domainKey: DomainKey;
  declaresUnmount: boolean;
  /** The admitted extensions of this domain: extension id -> name. */
  readonly extensions: Map<string, ExtensionToken>;
  /** The observer's release, while the domain is observed. */
  release: ReleaseFunction | undefined;
  /** The extension ids of the last command received for this domain, used only for the write-back after a back or forward step. */
  lastCommand: string[];
  /** False until the observer's first transition has been handled; only later transitions log an unresolved entry. */
  initialObserved: boolean;
  /** The occupant value this domain's key is recorded under in the nested-domain record, if any. */
  recordedUnder: EntryAddress | undefined;
  /** The release of the single deferred write's subscription, while one is pending. */
  pendingWrite: ReleaseFunction | undefined;
  pendingTarget: ExtensionToken[];
  pendingVerb: HistoryVerb | undefined;
}

const PREFIX = '[@gears-frontx/routing]';

function isOccupantValue(value: unknown): value is EntryAddress {
  if (typeof value !== 'object' || value === null) return false;
  const { domainKey, extension } = value as { domainKey?: unknown; extension?: unknown };
  return typeof domainKey === 'string' && typeof extension === 'string' && validateName(domainKey) && validateName(extension);
}

function parseLocation(history: NavigationHistory) {
  const { path, search, hash } = history.location;
  return parseGrammar({ shellSubroute: path, search, hash });
}

// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1
// @cpt-flow:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-router-admission:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-router-user-change-dispatch:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-router-initial-route:p1
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-router-command-write:p1
export class FrontXRouter {
  private executor: ActionsChainExecutor | undefined;
  private typeSystem: RouterTypeSystem | undefined;
  /** The reader of the runtime's own occupant value; set only once navigation is supplied, so it stays unset in the shell runtime. */
  private readOccupantValue: (() => unknown) | undefined;
  /** Resolved on first use, so the router can be built in a realm with no `window`. */
  private cachedHistory: NavigationHistory | undefined;
  private cachedSignal: RouteSignal | undefined;
  private readonly domains = new Map<string, RoutedDomain>();
  private readonly routedRoutes: RoutedDomainRoutes = sharedRoutedDomainRoutes();
  private readonly nestedDomainKeys: NestedDomainKeys = sharedNestedDomainKeys();
  private readonly pageLoads: PageLoads = sharedPageLoads();
  /** This instance's identity in the routed-domain routes, compared by reference only. */
  private readonly ownerId: symbol = Symbol('@gears-frontx/routing router');

  // ------------------------------------------------------------------
  // Members the runtime calls (FEATURE §1.5, Router members)
  // ------------------------------------------------------------------

  connect(executor: ActionsChainExecutor, typeSystem: RouterTypeSystem): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-connect
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-keep-executor
    this.executor = executor;
    this.typeSystem = typeSystem;
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-keep-executor
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-connect
  }

  registerDomain(domainId: string, route: string, declaresUnmount: boolean): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-register-domain
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-domain-refused
    if (!validateName(route)) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-reject-domain
      throw new Error(`${PREFIX} domain "${domainId}" declares the route "${route}", which is not a valid name`);
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-reject-domain
    }
    // A route already held — by any routed domain live in the page,
    // including one of the same id — is a duplicate.
    if (this.routedRoutes.holderOf(route) !== undefined) {
      throw new Error(`${PREFIX} the route "${route}" is already held by another routed domain live in the page`);
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-domain-refused

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-record-domain
    this.routedRoutes.hold(route, { domainId, ownerId: this.ownerId });
    const state: RoutedDomain = {
      domainId,
      domainKey: route as DomainKey,
      declaresUnmount,
      extensions: new Map(),
      release: undefined,
      lastCommand: [],
      initialObserved: false,
      recordedUnder: undefined,
      pendingWrite: undefined,
      pendingTarget: [],
      pendingVerb: undefined,
    };
    this.domains.set(domainId, state);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-record-domain

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-runtime-is-extension
    const occupantValue = this.ownOccupantValue();
    if (occupantValue !== undefined) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-record-nested-domain
      this.recordNestedDomain(state, occupantValue);
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-record-nested-domain
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-runtime-is-extension
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-register-domain
  }

  registerExtension(extensionId: string, domainId: string, route: string): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-register-extension
    const state = this.domains.get(domainId);
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-domain-unrouted
    if (state === undefined) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-ignore-extension
      return;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-ignore-extension
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-domain-unrouted

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-derive-name
    const name = deriveExtensionToken(route);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-derive-name

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-extension-refused
    if (name === undefined) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-reject-extension
      throw new Error(
        `${PREFIX} extension "${extensionId}" declares the route ${JSON.stringify(route)}, which yields no valid name in routed domain "${domainId}"`,
      );
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-reject-extension
    }
    if ([...state.extensions.values()].some((held) => namesEqual(held, name))) {
      throw new Error(`${PREFIX} the name "${name}" is already held by another extension of routed domain "${domainId}"`);
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-extension-refused

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-record-extension
    state.extensions.set(extensionId, name);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-record-extension
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-register-extension
  }

  releaseDomain(domainId: string): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-release-domain
    const state = this.domains.get(domainId);
    if (state === undefined) return;
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-free-domain
    this.releaseObserver(state);
    this.cancelPendingWrite(state);
    this.domains.delete(domainId);
    this.routedRoutes.release(state.domainKey, this.ownerId);
    this.recordNestedDomain(state, undefined);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-free-domain
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-release-domain
  }

  releaseExtension(extensionId: string): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-release-extension
    const state = [...this.domains.values()].find((candidate) => candidate.extensions.has(extensionId));
    if (state === undefined) return;
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-free-extension
    const name = state.extensions.get(extensionId);
    state.extensions.delete(extensionId);
    state.lastCommand = state.lastCommand.filter((id) => id !== extensionId);
    if (name !== undefined) {
      state.pendingTarget = state.pendingTarget.filter((held) => !namesEqual(held, name));
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-free-extension
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-release-extension
  }

  startDomain(domainId: string): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-start-domain
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-nested-domain
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-start-observer
    const state = this.domains.get(domainId);
    if (state === undefined || state.release !== undefined) return;
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-recurse-nested-domain
    state.release = this.signal().createObserver<string>(state.domainKey, this.extensionsSource(state), (transition) =>
      this.onTransition(state, transition),
    );
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-recurse-nested-domain
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-start-observer
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-nested-domain
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-start-domain
  }

  stopDomain(domainId: string): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-stop-domain
    const state = this.domains.get(domainId);
    if (state === undefined) return;
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-stop-observer
    this.releaseObserver(state);
    state.initialObserved = false;
    state.lastCommand = [];
    this.cancelPendingWrite(state);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-stop-observer
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-stop-domain
  }

  /**
   * The runtime's command: the domain's URL entries must show exactly the
   * extensions `extensionIds`, written with `verb` (FEATURE §2, flow step 7).
   */
  reflect(domainId: string, extensionIds: string[], verb: HistoryVerb): void {
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-when-runtime-commands-domain
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-when-initial-route-ends
    // Only an acceptance command carries `push`: the router's own chains
    // carry `none` and every settle command is a `replace`.
    if (verb === 'push') {
      this.discardInitialRoute();
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-when-initial-route-ends
    const state = this.domains.get(domainId);
    if (state === undefined) return;
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-records-last-command
    state.lastCommand = [...extensionIds];
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-records-last-command
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-no-live-observer
    if (state.release === undefined) {
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-no-write-without-observer
      return;
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-no-write-without-observer
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-no-live-observer
    this.writeEntries(state, this.namesOf(state, extensionIds), verb);
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-when-runtime-commands-domain
  }

  assignOccupantValue(domainId: string, extensionId: string): EntryAddress | undefined {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-assign-occupant-value
    const state = this.domains.get(domainId);
    const name = state?.extensions.get(extensionId);
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-occupant-unrouted
    if (state === undefined || name === undefined) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-return-no-occupant-value
      return undefined;
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-return-no-occupant-value
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-if-occupant-unrouted
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-return-occupant-value
    return { domainKey: state.domainKey, extension: name };
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-return-occupant-value
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-assign-occupant-value
  }

  supplyNavigation(readOccupantValue: () => unknown): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-supply-navigation
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-keep-reader
    this.readOccupantValue = readOccupantValue;
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-keep-reader
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-rerecord-nested-on-supply
    const occupantValue = this.ownOccupantValue();
    for (const state of this.domains.values()) {
      this.recordNestedDomain(state, occupantValue);
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-rerecord-nested-on-supply
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-router-admission:p1:inst-admission-when-supply-navigation
  }

  // ------------------------------------------------------------------
  // Engine-provider read (FEATURE §1.5) — not a member of the abstract router
  // ------------------------------------------------------------------

  /**
   * The runtime's own entry address: the occupant value once validated in a
   * routed extension's runtime; `undefined` in the shell runtime, whose router
   * has never been supplied navigation. An extension runtime supplied navigation
   * without an occupant value has no access to the router, so this throws.
   */
  ownEntryAddress(): EntryAddress | undefined {
    if (this.readOccupantValue === undefined) {
      return undefined;
    }
    const occupantValue = this.ownOccupantValue();
    if (occupantValue === undefined) {
      throw new Error(`${PREFIX} this extension runtime has no occupant value, so it has no access to the router`);
    }
    return occupantValue;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** The runtime's own occupant value read through the kept reader, or `undefined` when there is none; never throws. */
  private ownOccupantValue(): EntryAddress | undefined {
    const value = this.readOccupantValue?.();
    return isOccupantValue(value) ? { domainKey: value.domainKey, extension: value.extension } : undefined;
  }

  /** Records the domain's key under `occupantValue` in the nested-domain record, removing it from the occupant value it is recorded under, if any. */
  private recordNestedDomain(state: RoutedDomain, occupantValue: EntryAddress | undefined): void {
    if (state.recordedUnder !== undefined) {
      this.nestedDomainKeys.remove(state.recordedUnder, state.domainKey);
    }
    state.recordedUnder = occupantValue;
    if (occupantValue !== undefined) {
      this.nestedDomainKeys.add(occupantValue, state.domainKey);
    }
  }

  private history(): NavigationHistory {
    if (this.cachedHistory === undefined) {
      const history = resolveNavigationHistory();
      // Subscribed before any observer of this copy, so a back or forward
      // step ends the page load's initial route before any domain dispatches for it.
      history.subscribe((notification) => {
        // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-when-initial-route-ends
        if (notification.kind === 'history') {
          // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-discards-initial-route
          this.pageLoads.of(history).discard();
          // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-discards-initial-route
          // A back or forward step before the enclosing entry is present supersedes every stale deferred write: the step's own write-back owns the URL now.
          // Cancelled here, before any observer runs, so a write-back the step itself defers is not cancelled with them.
          // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-defers-write
          for (const state of this.domains.values()) {
            this.cancelPendingWrite(state);
          }
          // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-defers-write
        }
        // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-when-initial-route-ends
      });
      this.cachedHistory = history;
    }
    return this.cachedHistory;
  }

  private pageLoad(): PageLoad {
    return this.pageLoads.of(this.history());
  }

  private signal(): RouteSignal {
    if (this.cachedSignal === undefined) {
      this.cachedSignal = createRouteSignal(this.history());
    }
    return this.cachedSignal;
  }

  /** Discards the page load's initial route; a realm with no navigation history has no page load to discard. */
  private discardInitialRoute(): void {
    let history: NavigationHistory;
    try {
      history = this.history();
    } catch (error) {
      if (error instanceof RoutingError && error.code === 'no-navigation-history-in-realm') {
        return;
      }
      throw error;
    }
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-discards-initial-route
    this.pageLoads.of(history).discard();
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-discards-initial-route
  }

  private releaseObserver(state: RoutedDomain): void {
    const release = state.release;
    if (release === undefined) return;
    state.release = undefined;
    release();
  }

  private extensionsSource(state: RoutedDomain): RegisteredExtensionsSource<string> {
    return {
      getRegistrations: () => [...state.extensions].map(([id, name]) => ({ extension: name, routeOwner: id })),
    };
  }

  /** The names of the given extension ids admitted in the domain, in the given order, without repeats. */
  private namesOf(state: RoutedDomain, extensionIds: readonly string[]): ExtensionToken[] {
    const names: ExtensionToken[] = [];
    for (const id of extensionIds) {
      const name = state.extensions.get(id);
      if (name !== undefined && !names.some((held) => namesEqual(held, name))) {
        names.push(name);
      }
    }
    return names;
  }

  private extensionIdOf(state: RoutedDomain, name: ExtensionToken): string | undefined {
    for (const [id, held] of state.extensions) {
      if (namesEqual(held, name)) return id;
    }
    return undefined;
  }

  private send(domainId: string, type: string, subject: string): void {
    if (this.executor === undefined) {
      throw new Error(`${PREFIX} the router sends a chain only once connect() has handed it an executor`);
    }
    this.executor.executeActionsChain({ action: { type, target: domainId, payload: { subject, history: 'none' } } });
  }

  private requireTypeSystem(): RouterTypeSystem {
    if (this.typeSystem === undefined) {
      throw new Error(`${PREFIX} the router sends a chain only once connect() has handed it a type system`);
    }
    return this.typeSystem;
  }

  /**
   * A domain's transition: for a page load (`initial`) or a back or forward
   * step (`history`), the `unmount_ext` and `mount_ext` chains, then the
   * page load's one clear or the write after a back or forward step; a
   * written navigation (`push`, `replace`) sends nothing.
   */
  private onTransition(state: RoutedDomain, observed: Transition<string>): void {
    // Taken on entry: the page load's clear below is a written navigation the
    // observer reports before this call returns, and that report must already
    // count as a later transition.
    const firstTransition = !state.initialObserved;
    state.initialObserved = true;
    let transition = observed;
    let clearAfterDispatch = false;
    if (observed.cause === 'initial') {
      const pageLoad = this.pageLoad();
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-page-load-dispatched
      // The first `initial` transition of the page load, in any router copy, takes the load's one clear.
      clearAfterDispatch = pageLoad.beginLoad(parseLocation(this.history()).entries);
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-page-load-dispatched
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-nested-starts-in-page-load
      if (!clearAfterDispatch && pageLoad.isKept()) {
        // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-resolves-nested-against-initial-route
        transition = this.fromInitialRoute(state, observed, pageLoad);
        // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-resolves-nested-against-initial-route
      }
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-nested-starts-in-page-load
    }
    const dispatching = transition.cause === 'initial' || transition.cause === 'history';
    try {
      if (dispatching) {
        this.dispatch(state, transition);
      }
    } finally {
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-syncs-url-after-dispatch
      if (clearAfterDispatch) {
        // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-clears-initial-route
        this.clearEntries();
        // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-clears-initial-route
      }
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-syncs-url-after-dispatch
    }
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-unresolved
    if (!firstTransition) {
      const unresolved = transition.diff.added.filter((name) =>
        transition.entries.some((entry) => namesEqual(entry.extension, name) && !entry.resolution.resolved),
      );
      if (unresolved.length > 0) {
        // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-consumer-fallback
        reportRoutingDefect(
          `routed domain "${state.domainId}" has no admitted extension for ${unresolved.map((name) => `"${name}"`).join(', ')}`,
        );
        // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-consumer-fallback
      }
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-unresolved
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-back-forward-dispatched
    if (transition.cause === 'history') {
      this.writeAfterUserChange(state, transition);
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-back-forward-dispatched
  }

  /** The chains of an `initial` or `history` transition: removals first, then arrivals in URL order, each its own chain. */
  private dispatch(state: RoutedDomain, transition: Transition<string>): void {
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-foreach-removed
    for (const name of transition.diff.removed) {
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-domain-declares-unmount
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-else-domain-declares-no-unmount
      if (!state.declaresUnmount) {
        // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-sends-no-unmount
        break;
        // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-sends-no-unmount
      }
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-else-domain-declares-no-unmount
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-sends-unmount-chain
      const departing = this.extensionIdOf(state, name);
      if (departing !== undefined) {
        this.send(state.domainId, this.requireTypeSystem().resolveUnmountExtActionId(), departing);
      }
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-sends-unmount-chain
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-domain-declares-unmount
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-foreach-removed
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-foreach-payload-changed
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-no-mount-action-payload
    // Only an arrival is mounted: an entry changed only in payload, or only reordered, sends no chain.
    const arrived = transition.diff.added;
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-no-mount-action-payload
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-foreach-payload-changed
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-foreach-added
    for (const entry of transition.entries) {
      if (entry.resolution.resolved && arrived.some((name) => namesEqual(name, entry.extension))) {
        // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-sends-mount-chain
        this.send(state.domainId, this.requireTypeSystem().resolveMountExtActionId(), entry.resolution.routeOwner);
        // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-sends-mount-chain
      }
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-foreach-added
  }

  /** The page load's one clear: every entry leaves the URL in one `replace`; the pathname, the hash and every foreign segment stay. */
  private clearEntries(): void {
    const history = this.history();
    const parsed = parseLocation(history);
    if (parsed.entries.length === 0) return;
    history.replace(
      serializeGrammar({
        shellSubroute: parsed.shellSubroute,
        hash: parsed.hash,
        entries: [],
        foreignSegments: parsed.foreignSegments,
      }),
    );
  }

  /** The domain's first resolution taken from the kept initial route, resolved against the extensions the domain knows. */
  private fromInitialRoute(state: RoutedDomain, observed: Transition<string>, pageLoad: PageLoad): Transition<string> {
    const entries: ResolvedEntry<string>[] = pageLoad.keptEntriesOf(state.domainKey).map((entry: Entry) => {
      const owner = this.extensionIdOf(state, entry.extension);
      return {
        extension: entry.extension,
        params: entry.params,
        resolution: owner === undefined ? { resolved: false } : { resolved: true, routeOwner: owner },
      };
    });
    return {
      domainKey: observed.domainKey,
      cause: 'initial',
      entries,
      diff: {
        added: entries.map((entry) => entry.extension),
        removed: [],
        payloadChanged: [],
        reordered: false,
        unresolved: entries.filter((entry) => !entry.resolution.resolved).map((entry) => entry.extension),
      },
    };
  }

  /** The write after dispatching for a back or forward step, always with `replace`. */
  private writeAfterUserChange(state: RoutedDomain, transition: Transition<string>): void {
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-drops-unresolved
    let target = transition.entries.filter((entry) => entry.resolution.resolved).map((entry) => entry.extension);
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-drops-unresolved
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-undeclared-unmount-domain-emptied
    if (!state.declaresUnmount && target.length === 0) {
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-writes-back-last-command
      target = this.namesOf(state, state.lastCommand);
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-writes-back-last-command
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-undeclared-unmount-domain-emptied
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-replaces-after-user-change
    this.writeEntries(state, target, 'replace');
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-replaces-after-user-change
  }

  /**
   * Makes the domain's URL entries show exactly `target`, with `verb`, in one
   * write composed against the live URL (FEATURE §2, flow steps 7.3 to 7.6).
   */
  private writeEntries(state: RoutedDomain, target: ExtensionToken[], verb: HistoryVerb): void {
    const delta = this.compose(state, target);
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-command-equals-url
    if (delta === undefined) {
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-no-write-when-equal
      this.cancelPendingWrite(state);
      return;
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-no-write-when-equal
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-command-equals-url
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-enclosing-entry-absent
    const enclosing = this.ownOccupantValue();
    if (enclosing !== undefined && !this.enclosingPresent(enclosing)) {
      // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-defers-write
      state.pendingTarget = target;
      state.pendingVerb = state.pendingVerb === 'replace' || verb === 'replace' ? 'replace' : 'push';
      if (state.pendingWrite === undefined) {
        state.pendingWrite = this.history().subscribe(() => {
          // A back or forward step cancels the pending write before any observer runs (see history()), so only an arrival reaches here.
          if (!this.enclosingPresent(enclosing)) return;
          const pendingTarget = state.pendingTarget;
          const pendingVerb = state.pendingVerb ?? verb;
          this.cancelPendingWrite(state);
          const pendingDelta = this.compose(state, pendingTarget);
          if (pendingDelta !== undefined) {
            this.backProject(state, pendingDelta, pendingVerb);
          }
        });
      }
      return;
      // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-defers-write
    }
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-if-enclosing-entry-absent
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-else-enclosing-entry-present
    this.cancelPendingWrite(state);
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-writes-command
    this.backProject(state, delta, verb);
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-writes-command
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-else-enclosing-entry-present
  }

  /** One back-projection call for the domain; marks each written extension in the page load. */
  private backProject(state: RoutedDomain, delta: BackProjectionDelta, verb: HistoryVerb): void {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-consumer-calls-helper
    this.signal().backProjectEntries(state.domainKey, delta, verb);
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-consumer-calls-helper
    const pageLoad = this.pageLoad();
    for (const entry of [...(delta.added ?? []), ...(delta.replaced ?? []).map((pair) => pair.entry)]) {
      pageLoad.markWritten(state.domainKey, entry.extension);
    }
  }

  /**
   * The delta that makes the domain's live entries show exactly `target`, or
   * `undefined` when they already do. Exactly one dropped and one new name is
   * a `replaced` operation; otherwise the dropped names are removed and the
   * new ones appended in `target` order. Kept entries are left unnamed, so
   * they keep their position and parameters. Every domain nested beneath a
   * dropped extension, transitively, is named in `clearedDomainKeys`.
   */
  private compose(state: RoutedDomain, target: readonly ExtensionToken[]): BackProjectionDelta | undefined {
    // @cpt-begin:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-composes-command-write
    const live = this.liveNamesOf(state.domainKey);
    const dropped = live.filter(
      (name, index) => !target.some((kept) => namesEqual(kept, name)) && live.findIndex((other) => namesEqual(other, name)) === index,
    );
    const added = target.filter((name) => !live.some((held) => namesEqual(held, name)));
    if (dropped.length === 0 && added.length === 0) return undefined;
    const clearedDomainKeys = this.nestedDomainKeysBeneath(state.domainKey, dropped);
    const pageLoad = this.pageLoad();
    const initialParams = (name: ExtensionToken) => pageLoad.unwrittenParamsOf(state.domainKey, name) ?? [];
    if (dropped.length === 1 && added.length === 1) {
      return {
        replaced: [{ oldExtension: dropped[0], entry: { extension: added[0], params: initialParams(added[0]) } }],
        clearedDomainKeys,
      };
    }
    return {
      added: added.map((extension) => ({ extension, params: initialParams(extension) })),
      removed: dropped,
      clearedDomainKeys,
    };
    // @cpt-end:cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount:p1:inst-router-composes-command-write
  }

  /**
   * Every domain key nested beneath the dropped extensions of the domain
   * `domainKey`, to any depth: the keys recorded under each dropped
   * extension's occupant value, then the keys recorded under every occupant
   * value of each collected key, and so on. A key collected once is never
   * collected again, so the walk ends.
   */
  private nestedDomainKeysBeneath(domainKey: DomainKey, dropped: readonly ExtensionToken[]): DomainKey[] {
    const collected: DomainKey[] = [];
    const frontier: DomainKey[] = [];
    const collect = (key: DomainKey): void => {
      if (collected.some((held) => namesEqual(held, key))) return;
      collected.push(key);
      frontier.push(key);
    };
    for (const extension of dropped) {
      this.nestedDomainKeys.keysOf({ domainKey, extension }).forEach(collect);
    }
    for (let key = frontier.pop(); key !== undefined; key = frontier.pop()) {
      this.nestedDomainKeys.keysUnder(key).forEach(collect);
    }
    return collected;
  }

  private cancelPendingWrite(state: RoutedDomain): void {
    state.pendingWrite?.();
    state.pendingWrite = undefined;
    state.pendingTarget = [];
    state.pendingVerb = undefined;
  }

  /** The names the live URL carries under `domainKey`, read afresh on every call. */
  private liveNamesOf(domainKey: DomainKey): ExtensionToken[] {
    return parseLocation(this.history())
      .entries.filter((entry) => namesEqual(entry.domainKey, domainKey))
      .map((entry) => entry.extension);
  }

  /** Whether the URL carries the entry of the extension that hosts this runtime's domains. */
  private enclosingPresent(enclosing: EntryAddress): boolean {
    return parseLocation(this.history()).entries.some(
      (entry) => namesEqual(entry.domainKey, enclosing.domainKey) && namesEqual(entry.extension, enclosing.extension),
    );
  }
}

/** The ready FrontX router of this runtime, built when the package is evaluated. */
export const router = new FrontXRouter();
