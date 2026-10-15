/**
 * Realm-shared router state (DESIGN §3.1, "Realm-shared router state";
 * FEATURE route-ownership-signal §1.4, Binding obligation, points 3 and 9).
 *
 * Every FrontX router in the page shares three facts, even though each
 * runtime evaluates its own copy of this package: the routes the routed
 * domains live in the page hold, the nested-domain record, and the page load
 * with its kept initial route. Each sits in its own version-namespaced
 * `Symbol.for` slot on the realm's global object, as a private internal
 * singleton of this package.
 *
 * Slot protocol, shared by the three: the published value is a frozen holder
 * of closures over a private collection, tagged with its protocol version
 * `v`, and defined as a non-writable, non-configurable property, so no
 * same-realm script can replace the holder or reach a collection to edit. A
 * copy recognizes a holder structurally (its `v` and the type of each
 * member), never by class identity. A copy that finds a value it does not
 * recognize under its key reports it and backs away: it keeps a private
 * holder of its own and publishes nothing.
 *
 * @packageDocumentation
 */
import { reportRoutingDefect } from '../diagnostics.js';
import { namesEqual } from '../grammar/name.js';
import type { DomainKey, Entry, EntryAddress, ExtensionToken, Param } from '../types/index.js';

/** The protocol version every slot below publishes and recognizes. */
const SLOT_VERSION = 1 as const;

const ROUTED_DOMAIN_ROUTES_KEY = Symbol.for('@gears-frontx/routing/routed-domain-routes/v1');
const NESTED_DOMAIN_KEYS_KEY = Symbol.for('@gears-frontx/routing/nested-domain-keys/v1');
const PAGE_LOAD_KEY = Symbol.for('@gears-frontx/routing/page-load/v1');

type Realm = Record<symbol, unknown>;

function hasFunctions(value: object, names: readonly string[]): boolean {
  return names.every((name) => typeof (value as Record<string, unknown>)[name] === 'function');
}

/**
 * Resolves the holder under `key`: the one already published there when it is
 * recognized; otherwise a fresh one, published when the slot is empty and
 * kept private when the slot holds something unrecognized.
 */
function resolveSlot<T extends { readonly v: typeof SLOT_VERSION }>(
  key: symbol,
  members: readonly string[],
  create: () => T,
): T {
  const realm = globalThis as unknown as Realm;
  const existing = realm[key];
  if (
    typeof existing === 'object' &&
    existing !== null &&
    (existing as { v?: unknown }).v === SLOT_VERSION &&
    hasFunctions(existing, members)
  ) {
    return existing as T;
  }
  const holder = create();
  if (existing !== undefined) {
    reportRoutingDefect(`the realm slot ${String(key)} holds a value this copy does not recognize; this copy keeps its own`);
    return holder;
  }
  Object.defineProperty(realm, key, { value: holder, writable: false, configurable: false, enumerable: false });
  return holder;
}

// ---------------------------------------------------------------------------
// Routed-domain routes (DESIGN §2.3, O1)
// ---------------------------------------------------------------------------

/** Who holds a route: the domain's id and the identity of the router instance that admitted it. */
export interface RouteHolder {
  readonly domainId: string;
  readonly ownerId: symbol;
}

/** The routes the routed domains live in the page hold, compared with the name-equality predicate. */
export interface RoutedDomainRoutes {
  readonly v: typeof SLOT_VERSION;
  /** The holder of a route equal to `route`, if any. */
  holderOf(route: string): RouteHolder | undefined;
  /** Records `holder` as holding `route`. */
  hold(route: string, holder: RouteHolder): void;
  /** Frees `route` only while the router instance `ownerId` holds it. */
  release(route: string, ownerId: symbol): void;
}

function createRoutedDomainRoutes(): RoutedDomainRoutes {
  const holders = new Map<string, RouteHolder>();
  const heldRoute = (route: string): string | undefined =>
    [...holders.keys()].find((candidate) => namesEqual(candidate, route));
  return Object.freeze({
    v: SLOT_VERSION,
    holderOf: (route: string) => {
      const held = heldRoute(route);
      return held === undefined ? undefined : holders.get(held);
    },
    hold: (route: string, holder: RouteHolder) => {
      holders.set(heldRoute(route) ?? route, holder);
    },
    release: (route: string, ownerId: symbol) => {
      const held = heldRoute(route);
      if (held !== undefined && holders.get(held)?.ownerId === ownerId) {
        holders.delete(held);
      }
    },
  });
}

export function sharedRoutedDomainRoutes(): RoutedDomainRoutes {
  return resolveSlot(ROUTED_DOMAIN_ROUTES_KEY, ['holderOf', 'hold', 'release'], createRoutedDomainRoutes);
}

// ---------------------------------------------------------------------------
// Nested-domain record (DESIGN §2.3, O7)
// ---------------------------------------------------------------------------

/**
 * The keys of the routed domains each extension runtime registered, recorded
 * under that runtime's own occupant value.
 */
export interface NestedDomainKeys {
  readonly v: typeof SLOT_VERSION;
  add(owner: EntryAddress, domainKey: DomainKey): void;
  remove(owner: EntryAddress, domainKey: DomainKey): void;
  /** The keys recorded under exactly the occupant value `owner`. */
  keysOf(owner: EntryAddress): DomainKey[];
  /** The keys recorded under every occupant value whose domain key is `domainKey`, whichever extension it names. */
  keysUnder(domainKey: DomainKey): DomainKey[];
}

function createNestedDomainKeys(): NestedDomainKeys {
  const records: Array<{ readonly owner: EntryAddress; readonly keys: Set<DomainKey> }> = [];
  const recordOf = (owner: EntryAddress) =>
    records.find(
      (record) => namesEqual(record.owner.domainKey, owner.domainKey) && namesEqual(record.owner.extension, owner.extension),
    );
  return Object.freeze({
    v: SLOT_VERSION,
    add: (owner: EntryAddress, domainKey: DomainKey) => {
      const record = recordOf(owner);
      if (record === undefined) {
        records.push({ owner: { domainKey: owner.domainKey, extension: owner.extension }, keys: new Set([domainKey]) });
        return;
      }
      record.keys.add(domainKey);
    },
    remove: (owner: EntryAddress, domainKey: DomainKey) => {
      const record = recordOf(owner);
      if (record === undefined) return;
      record.keys.delete(domainKey);
      if (record.keys.size === 0) records.splice(records.indexOf(record), 1);
    },
    keysOf: (owner: EntryAddress) => [...(recordOf(owner)?.keys ?? [])],
    keysUnder: (domainKey: DomainKey) =>
      records.filter((record) => namesEqual(record.owner.domainKey, domainKey)).flatMap((record) => [...record.keys]),
  });
}

export function sharedNestedDomainKeys(): NestedDomainKeys {
  return resolveSlot(NESTED_DOMAIN_KEYS_KEY, ['add', 'remove', 'keysOf', 'keysUnder'], createNestedDomainKeys);
}

// ---------------------------------------------------------------------------
// Page load (DESIGN §2.3, O6; FEATURE §1.4, Binding obligation, point 9)
// ---------------------------------------------------------------------------

/** One page load: its once-per-load clear and its kept initial route. */
export interface PageLoad {
  /** Marks the load's clear as taken and keeps `entries` as its initial route; returns whether this call is the first of the load. */
  beginLoad(entries: readonly Entry[]): boolean;
  /** Whether the initial route is kept. */
  isKept(): boolean;
  /** The kept initial route's entries under one domain key. */
  keptEntriesOf(domainKey: DomainKey): Entry[];
  /** The parameters the kept initial route carries for an extension not written yet; `undefined` when there are none to carry. */
  unwrittenParamsOf(domainKey: DomainKey, extension: ExtensionToken): readonly Param[] | undefined;
  /** Marks the extension's entry as written, so its initial-route parameters are not carried. */
  markWritten(domainKey: DomainKey, extension: ExtensionToken): void;
  /** Discards the kept initial route; a discard before the load begins ends the load, so it keeps none. */
  discard(): void;
}

/** The page load of each navigation history: a page load belongs to the page's one history. */
export interface PageLoads {
  readonly v: typeof SLOT_VERSION;
  of(history: object): PageLoad;
}

function createPageLoad(): PageLoad {
  let cleared = false;
  let ended = false;
  let kept: Entry[] | undefined;
  const written: EntryAddress[] = [];
  const sameAddress = (a: EntryAddress, domainKey: DomainKey, extension: ExtensionToken) =>
    namesEqual(a.domainKey, domainKey) && namesEqual(a.extension, extension);
  return Object.freeze({
    beginLoad: (entries: readonly Entry[]) => {
      if (cleared) return false;
      cleared = true;
      kept = ended ? undefined : [...entries];
      return true;
    },
    isKept: () => kept !== undefined,
    keptEntriesOf: (domainKey: DomainKey) => (kept ?? []).filter((entry) => namesEqual(entry.domainKey, domainKey)),
    unwrittenParamsOf: (domainKey: DomainKey, extension: ExtensionToken) => {
      if (written.some((address) => sameAddress(address, domainKey, extension))) return undefined;
      const entry = (kept ?? []).find((candidate) => sameAddress(candidate, domainKey, extension));
      return entry !== undefined && entry.params.length > 0 ? entry.params : undefined;
    },
    markWritten: (domainKey: DomainKey, extension: ExtensionToken) => {
      if (kept !== undefined) written.push({ domainKey, extension });
    },
    discard: () => {
      kept = undefined;
      if (!cleared) ended = true;
    },
  });
}

function createPageLoads(): PageLoads {
  const byHistory = new WeakMap<object, PageLoad>();
  return Object.freeze({
    v: SLOT_VERSION,
    of: (history: object) => {
      let load = byHistory.get(history);
      if (load === undefined) {
        load = createPageLoad();
        byHistory.set(history, load);
      }
      return load;
    },
  });
}

export function sharedPageLoads(): PageLoads {
  return resolveSlot(PAGE_LOAD_KEY, ['of'], createPageLoads);
}
