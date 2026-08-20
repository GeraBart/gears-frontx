/**
 * Cross-nesting reachability: registration propagation, escalation, and retraction.
 *
 * Builds a real 3-level `DefaultMfeRegistry` composition — shell -> child
 * registry (constructed synchronously inside its own hosting extension's
 * `mount()`, hosting its own domain) -> grandchild registry (constructed the
 * same way, one level deeper) — entirely through the public mount path
 * (`registerDomain` / `registerExtension` / `ExtensionMounter.mount`), the
 * same route the React slot takes. No new public method or config field is
 * used anywhere: the shell never learns of the grandchild directly, and
 * nesting composes purely through ambient mount-context bridge discovery
 * (`inst-adopt-ambient-bridge`) plus automatic registration propagation
 * (`cpt-frontx-algo-mfe-host-communication-registration-propagation`).
 *
 * Domain/action ids here are a mock notation, never the real GTS strings —
 * MFES-1 forbids `@gears-frontx/mfes` from carrying a type-format literal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @internal — colocated-style direct import, consistent with the rest of
// this package's DefaultMfeRegistry test suite.
import { DefaultMfeRegistry } from '../../src/runtime/DefaultMfeRegistry';
import type { TypeSystemPlugin } from '../../src/type-substrate';
import type { ActionsChain, Extension, ExtensionDomain, MfeEntry } from '../../src/types';
import {
  MfeHandler,
  ChildMfeBridge,
  ParentMfeBridge,
  type MfeEntryLifecycle,
} from '../../src/handler/types';
import { MfeBridgeFactoryDefault } from '../../src/handler/mfe-bridge-factory-default';
import { ExtensionDomainImplementation } from '../../src/runtime/ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../../src/runtime/ExtensionDomainImplementationFactory';
import type { DomainContext } from '../../src/runtime/DomainContext';
import { ConcurrentMountStrategy } from '../../src/runtime/mount-strategies';
import type { ContainerHooks, ActionPayload } from '../../src/runtime/mount-strategy';
import { ActionHandler } from '../../src/mediator/types';

// ─── Mock-notation well-known action ids ───────────────────────────────────

const LOAD_EXT = 'mock.action.v1~load_ext.v1~';
const MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const ACTION_ROOT = 'mock.action.v1~action_root.v1~';
const ACTION_LEAF = 'mock.action.v1~action_leaf.v1~';
const ACTION_HANG = 'mock.action.v1~action_hang.v1~';
const ACTION_COLLIDE = 'mock.action.v1~action_collide.v1~';
const ACTION_UNRESOLVABLE = 'mock.action.v1~action_unresolvable.v1~';
const ACTION_ASYNC = 'mock.action.v1~action_async.v1~';

function createMockPlugin(entries: Map<string, MfeEntry>): TypeSystemPlugin {
  return {
    name: 'MockPlugin',
    version: '1.0.0',
    registerSchema(): void {},
    getSchema(typeId: string): unknown {
      return entries.get(typeId);
    },
    register(): void {},
    isTypeOf(typeId: string, baseTypeId: string): boolean {
      return typeId === baseTypeId || typeId.startsWith(baseTypeId);
    },
    validateInstance() {
      return { valid: true, errors: [] };
    },
    resolveLoadExtActionId(): string {
      return LOAD_EXT;
    },
    resolveMountExtActionId(): string {
      return MOUNT_EXT;
    },
    resolveUnmountExtActionId(): string {
      return UNMOUNT_EXT;
    },
    resolveLifecycleStageInitId(): string {
      return 'mock.stage.v1~init.v1';
    },
    resolveLifecycleStageActivatedId(): string {
      return 'mock.stage.v1~activated.v1';
    },
    resolveLifecycleStageDeactivatedId(): string {
      return 'mock.stage.v1~deactivated.v1';
    },
    resolveLifecycleStageDestroyedId(): string {
      return 'mock.stage.v1~destroyed.v1';
    },
  };
}

// ─── Domain plumbing ─────────────────────────────────────────────────────

class NoopHooks implements ContainerHooks {
  create(_extensionId: string): Element {
    return document.createElement('div');
  }
  destroy(_extensionId: string): void {}
}

function makeDomain(id: string, extraActions: string[] = []): ExtensionDomain {
  return {
    id,
    actions: [LOAD_EXT, MOUNT_EXT, UNMOUNT_EXT, ...extraActions],
    extensionsActions: [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
    extensionsTypeId: '',
  } as unknown as ExtensionDomain;
}

/** A ConcurrentMountStrategy-backed domain that can also register extra action handlers. */
class GenericDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext, extraHandlers: ReadonlyArray<[string, ActionHandler]>) {
    super();
    const hooks = new NoopHooks();
    this.strategy = new ConcurrentMountStrategy(ctx.mounter, hooks);
    ctx.registerHandler(
      MOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as ActionPayload))
    );
    ctx.registerHandler(
      UNMOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as ActionPayload))
    );
    for (const [actionType, handler] of extraHandlers) {
      ctx.registerHandler(actionType, handler);
    }
  }

  protected getMountStrategies() {
    return [this.strategy];
  }
}

class GenericDomainFactory extends ExtensionDomainImplementationFactory {
  constructor(private readonly extraHandlers: ReadonlyArray<[string, ActionHandler]> = []) {
    super();
  }

  build(ctx: DomainContext): GenericDomainImpl {
    return new GenericDomainImpl(ctx, this.extraHandlers);
  }
}

function makeEntry(id: string): MfeEntry {
  return { id, requiredProperties: [], actions: [], domainActions: [] };
}

function makeExtension(id: string, domain: string, entry: string): Extension {
  return { id, domain, entry, lifecycle: [] } as Extension;
}

/** An MfeHandler whose `load()` resolves to a lifecycle with an injectable, synchronous `mount()`. */
class InjectableMountHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();

  constructor(
    entryBaseTypeId: string,
    private readonly onMount: (bridge: ChildMfeBridge) => void
  ) {
    super(entryBaseTypeId);
  }

  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return {
      mount: (_container, bridge) => {
        // Synchronous body: anything constructed here — in particular a
        // further `DefaultMfeRegistry` — falls inside the ambient
        // mounting-bridge window (`inst-track-mounting-bridge`).
        this.onMount(bridge);
      },
      unmount: () => {},
    };
  }
}

function actionChain(type: string, target: string): ActionsChain {
  return { action: { type, target, payload: {} } };
}

// ─── Topology ───────────────────────────────────────────────────────────────
//
// shell (registry0, domain D0) -> child-ext -> registry1 (domains D1, COLLIDE)
//   -> grandchild-ext -> registry2 (domain D2)
// shell also hosts sibling-ext -> registry1b (domain COLLIDE), an
// independent subtree whose advertisement for COLLIDE collides with
// registry1's.

const D0 = 'domain.shell.v1';
const D1 = 'domain.child.v1';
const D2 = 'domain.grandchild.v1';
const COLLIDE = 'domain.collide.v1';
const CHILD_EXT = 'ext.child.v1';
const GRANDCHILD_EXT = 'ext.grandchild.v1';
const SIBLING_EXT = 'ext.sibling.v1';
const CHILD_ENTRY = 'entry.child.v1';
const GRANDCHILD_ENTRY = 'entry.grandchild.v1';
const SIBLING_ENTRY = 'entry.sibling.v1';

interface Topology {
  registry0: DefaultMfeRegistry;
  registry1: DefaultMfeRegistry;
  registry2: DefaultMfeRegistry;
  registry1b: DefaultMfeRegistry;
  rootCounter: { count: number };
  leafCounter: { count: number };
  collideCounterA: { count: number };
  collideCounterB: { count: number };
  errorSpy: ReturnType<typeof vi.spyOn>;
}

async function buildTopology(): Promise<Topology> {
  const entries = new Map<string, MfeEntry>([
    [CHILD_ENTRY, makeEntry(CHILD_ENTRY)],
    [GRANDCHILD_ENTRY, makeEntry(GRANDCHILD_ENTRY)],
    [SIBLING_ENTRY, makeEntry(SIBLING_ENTRY)],
  ]);
  const plugin = createMockPlugin(entries);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const rootCounter = { count: 0 };
  const leafCounter = { count: 0 };
  const collideCounterA = { count: 0 };
  const collideCounterB = { count: 0 };

  let registry1!: DefaultMfeRegistry;
  let registry2!: DefaultMfeRegistry;
  let registry1b!: DefaultMfeRegistry;

  const childHandler = new InjectableMountHandler(CHILD_ENTRY, () => {
    // Synchronously construct the child registry inside child-ext's own
    // mount() body — this is the entire "adopt the ambient bridge" contract.
    registry1 = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [
        new InjectableMountHandler(GRANDCHILD_ENTRY, () => {
          registry2 = new DefaultMfeRegistry({ typeSystem: plugin });
          registry2.registerDomain(
            makeDomain(D2, [ACTION_LEAF, ACTION_HANG]),
            new GenericDomainFactory([
              [ACTION_LEAF, ActionHandler.fromFunction(async () => { leafCounter.count += 1; })],
              // Never settles on its own — used to exercise forced rejection
              // of an in-flight forwarded action on retraction.
              [ACTION_HANG, ActionHandler.fromFunction(() => new Promise<void>(() => {}))],
            ])
          );
        }),
      ],
    });
    registry1.registerDomain(makeDomain(D1), new GenericDomainFactory());
    registry1.registerDomain(
      makeDomain(COLLIDE, [ACTION_COLLIDE]),
      new GenericDomainFactory([
        [ACTION_COLLIDE, ActionHandler.fromFunction(async () => { collideCounterA.count += 1; })],
      ])
    );
  });

  const siblingHandler = new InjectableMountHandler(SIBLING_ENTRY, () => {
    registry1b = new DefaultMfeRegistry({ typeSystem: plugin });
    registry1b.registerDomain(
      makeDomain(COLLIDE, [ACTION_COLLIDE]),
      new GenericDomainFactory([
        [ACTION_COLLIDE, ActionHandler.fromFunction(async () => { collideCounterB.count += 1; })],
      ])
    );
  });

  const registry0 = new DefaultMfeRegistry({
    typeSystem: plugin,
    mfeHandlers: [childHandler, siblingHandler],
  });

  registry0.registerDomain(
    makeDomain(D0, [ACTION_ROOT]),
    new GenericDomainFactory([
      [ACTION_ROOT, ActionHandler.fromFunction(async () => { rootCounter.count += 1; })],
    ])
  );

  // ── Level 1: mount child-ext -> constructs registry1, advertises D1 + COLLIDE (first) ──
  await registry0.registerExtension(makeExtension(CHILD_EXT, D0, CHILD_ENTRY));
  const mounter0 = registry0.getMounter(D0);
  mounter0.attach(document.createElement('div'));
  await mounter0.mount(CHILD_EXT, document.createElement('div'));

  // ── Level 2: mount grandchild-ext inside registry1 -> constructs registry2, advertises D2 ──
  await registry1.registerExtension(makeExtension(GRANDCHILD_EXT, D1, GRANDCHILD_ENTRY));
  const mounter1 = registry1.getMounter(D1);
  mounter1.attach(document.createElement('div'));
  await mounter1.mount(GRANDCHILD_EXT, document.createElement('div'));

  // ── Independent sibling subtree: mounts alongside child-ext, collides on COLLIDE ──
  await registry0.registerExtension(makeExtension(SIBLING_EXT, D0, SIBLING_ENTRY));
  await mounter0.mount(SIBLING_EXT, document.createElement('div'));

  return {
    registry0,
    registry1,
    registry2,
    registry1b,
    rootCounter,
    leafCounter,
    collideCounterA,
    collideCounterB,
    errorSpy,
  };
}

describe('Cross-nesting reachability: registration propagation, escalation, retraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(a) shell-to-grandchild dispatch succeeds via propagated forwarding entries', async () => {
    const { registry0, leafCounter } = await buildTopology();

    await registry0.executeActionsChain(actionChain(ACTION_LEAF, D2));

    expect(leafCounter.count).toBe(1);
  });

  it('(b) grandchild-to-shell dispatch succeeds via escalation', async () => {
    const { registry2, rootCounter } = await buildTopology();

    await registry2.executeActionsChain(actionChain(ACTION_ROOT, D0));

    expect(rootCounter.count).toBe(1);
  });

  it('(c) a target-id collision between two independent subtrees is rejected: the ancestor keeps routing to the first-registered target', async () => {
    const { registry0, registry1b, collideCounterA, collideCounterB, errorSpy } =
      await buildTopology();

    // The collision was logged during topology construction (sibling-ext's
    // mount, which advertises COLLIDE second).
    expect(registry1b).toBeDefined();
    const collisionLog = errorSpy.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('Advertisement collision')
    );
    expect(collisionLog).toBeDefined();

    // Shell keeps routing COLLIDE to the FIRST-registered target (registry1) —
    // registry1b's own local domain of the same id is never reachable
    // through the shell.
    await registry0.executeActionsChain(actionChain(ACTION_COLLIDE, COLLIDE));
    expect(collideCounterA.count).toBe(1);
    expect(collideCounterB.count).toBe(0);
  });

  it('(d) disposing the child subtree retracts its advertisements from the shell and rejects an in-flight forwarded action for its targets', async () => {
    const { registry0, registry1, errorSpy } = await buildTopology();

    // Dispatch a forwarded action to a handler that never settles on its own,
    // then dispose registry1 (the child subtree that advertised D2's parent,
    // and re-propagated D2 up to the shell) WITHOUT awaiting the dispatch
    // first. The forwarding-entry route's `registerInFlight` callback is
    // wired synchronously before any bridge hop truly suspends, so the
    // dispatch is already tracked as in-flight by the time `dispose()` runs.
    const dispatchPromise = registry0.executeActionsChain(actionChain(ACTION_HANG, D2));
    registry1.dispose();

    // Forced rejection on retraction is what lets this resolve at all —
    // the handler itself never settles, so without `inst-reject-inflight-retracted`
    // this `await` would hang until the test framework's own timeout.
    await dispatchPromise;

    // The forced rejection is what settled it, not a coincidental
    // "no handler" failure racing ahead of the real dispatch.
    const retractionLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => String(arg).includes('was retracted while an action was in flight'))
    );
    expect(retractionLogged).toBe(true);

    // Retraction removed the shell's forwarding entry for D2 entirely — a
    // further dispatch now fails with a missing-handler error, proving the
    // advertisement was actually retracted (not merely that the first
    // dispatch happened to fail).
    errorSpy.mockClear();
    await registry0.executeActionsChain(actionChain(ACTION_LEAF, D2));
    expect(errorSpy).toHaveBeenCalled();
    const failureLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => String(arg).includes('Actions chain failed') || String(arg).includes('No handler found'))
    );
    expect(failureLogged).toBe(true);
  });

  it('(e) the child-facing bridge surfaces are unchanged: ChildMfeBridge has exactly 4 methods, ParentMfeBridge exactly 2 members', () => {
    // Exact key-set equality (not mere assignability) at compile time: if a
    // member is ever added to or removed from either abstract class, one of
    // these two type assignments fails to typecheck (`npm run type-check:test`,
    // CI-gated), catching MFES-6 surface growth that a runtime check alone
    // (abstract methods have no runtime footprint — see below) cannot.
    type Equals<X, Y> =
      (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

    type ChildMfeBridgeKeys = keyof ChildMfeBridge;
    type ExpectedChildKeys =
      | 'domainId'
      | 'instanceId'
      | 'executeActionsChain'
      | 'subscribeToProperty'
      | 'getProperty'
      | 'registerActionHandler';
    const _childKeysExact: Equals<ChildMfeBridgeKeys, ExpectedChildKeys> = true;

    type ParentMfeBridgeKeys = keyof ParentMfeBridge;
    type ExpectedParentKeys = 'instanceId' | 'dispose';
    const _parentKeysExact: Equals<ParentMfeBridgeKeys, ExpectedParentKeys> = true;

    void _childKeysExact;
    void _parentKeysExact;

    // Runtime companion: abstract methods without a body compile to NO
    // prototype entry at all (only 'constructor' survives), so the abstract
    // classes' prototypes carry zero method implementations of their own —
    // confirming nothing was ever demoted from abstract to a concrete
    // default on either class.
    expect(Object.getOwnPropertyNames(ChildMfeBridge.prototype)).toEqual(['constructor']);
    expect(Object.getOwnPropertyNames(ParentMfeBridge.prototype)).toEqual(['constructor']);
  });

  it('(f) arrival-edge exclusion actually changes the outcome: registry1 never ping-pongs an escalated-from-registry2 dispatch back down through the same bridge', async () => {
    const { registry2, errorSpy } = await buildTopology();

    // registry2 does not declare ACTION_UNRESOLVABLE anywhere (D2's own
    // handlers only cover ACTION_LEAF/ACTION_HANG, plus the infra actions),
    // so registry2 cannot resolve it locally and must escalate. Spy on
    // registry2's own public `executeActionsChain` — the entry point
    // `sendDown` uses to route a forwarding-entry dispatch back down to it —
    // to prove registry1 never reaches for that forwarding entry at all.
    // (The one, and only, expected invocation is this test's own dispatch
    // below; a second invocation would mean registry1 ping-ponged the chain
    // straight back down through the same bridge it arrived on.)
    const registry2ExecuteSpy = vi.spyOn(registry2, 'executeActionsChain');
    errorSpy.mockClear();

    // Dispatched FROM registry2 itself, targeting D2 (registry2's own local
    // domain): registry2 must escalate to registry1, tagging its own inbound
    // bridge as the arrival edge. registry1 legitimately holds a forwarding
    // entry for D2 pointing back down through that exact same bridge
    // (recorded when registry2 originally advertised D2 upward in
    // `buildTopology`) — without arrival-edge exclusion, registry1 would
    // resolve that forwarding entry and ping-pong the chain right back down
    // to registry2 via `sendDown`, re-invoking `registry2.executeActionsChain`.
    // The public `executeActionsChain` swallows the `ChainResult` and only
    // logs failures (`[MfeRegistry] Actions chain failed: ...`), so the
    // outcome is observed the same way test (d) observes it: via the logged
    // error message.
    await registry2.executeActionsChain(actionChain(ACTION_UNRESOLVABLE, D2));

    // The chain must have continued escalating past registry1 instead —
    // there is no handler for ACTION_UNRESOLVABLE anywhere up to the shell,
    // so it ends non-completed with a missing-handler error.
    const failureLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) =>
        String(arg).includes(
          `No handler found for target '${D2}' and action type '${ACTION_UNRESOLVABLE}'`
        )
      )
    );
    expect(failureLogged).toBe(true);

    // registry2's own dispatch entry point was invoked exactly once — this
    // test's own call. If registry1 had ping-ponged the chain back down
    // through the excluded forwarding entry, `sendDown` would have re-invoked
    // it a second time.
    expect(registry2ExecuteSpy).toHaveBeenCalledTimes(1);
  });

  it('(g) an async mount() still closes the ambient window at its synchronous prefix: a registry built there before the first await still adopts the correct inbound bridge', async () => {
    const ASYNC_ENTRY = 'entry.async-child.v1';
    const ASYNC_EXT = 'ext.async-child.v1';
    const D_ASYNC = 'domain.async-child.v1';

    const entries = new Map<string, MfeEntry>([[ASYNC_ENTRY, makeEntry(ASYNC_ENTRY)]]);
    const plugin = createMockPlugin(entries);
    const counter = { count: 0 };

    let asyncChildRegistry!: DefaultMfeRegistry;

    /** Same ambient-adoption contract as `InjectableMountHandler`, but `mount()`
     * is itself `async` and awaits past its own synchronous prefix — proving
     * the ambient window closes at the synchronous prefix's end (when the
     * call returns its pending promise), not at the promise's eventual
     * settlement. */
    class AsyncInjectableMountHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor(
        entryBaseTypeId: string,
        private readonly onMount: (bridge: ChildMfeBridge) => void
      ) {
        super(entryBaseTypeId);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        return {
          mount: async (_container, bridge) => {
            // Synchronous prefix of this async function body: still inside
            // the ambient mounting-bridge window, exactly like a sync mount().
            this.onMount(bridge);
            // Yield past the point where `pushAmbientMountingBridge`'s window
            // already closed (immediately after this call synchronously
            // returned its pending promise to `DefaultMountManager`).
            await Promise.resolve();
          },
          unmount: async () => {},
        };
      }
    }

    const asyncHandler = new AsyncInjectableMountHandler(ASYNC_ENTRY, (bridge) => {
      void bridge;
      asyncChildRegistry = new DefaultMfeRegistry({ typeSystem: plugin });
      asyncChildRegistry.registerDomain(
        makeDomain(D_ASYNC, [ACTION_ASYNC]),
        new GenericDomainFactory([
          [ACTION_ASYNC, ActionHandler.fromFunction(async () => { counter.count += 1; })],
        ])
      );
    });

    const registry0 = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [asyncHandler],
    });
    registry0.registerDomain(makeDomain(D0), new GenericDomainFactory());

    await registry0.registerExtension(makeExtension(ASYNC_EXT, D0, ASYNC_ENTRY));
    const mounter0 = registry0.getMounter(D0);
    mounter0.attach(document.createElement('div'));
    // `mount()`'s own synchronous prefix — where `onMount` constructs
    // `asyncChildRegistry` and calls `registerDomain` (which propagates the
    // domain's advertisement upward synchronously, per
    // `inst-compose-advertisement`) — runs before `mount()`'s own first
    // `await`, still inside the ambient mounting-bridge window. Awaiting the
    // extension's own `load()` (also async) first is required before that
    // synchronous prefix runs at all, so the earliest externally-observable
    // checkpoint is after the whole mount settles.
    await mounter0.mount(ASYNC_EXT, document.createElement('div'));

    expect(asyncChildRegistry).toBeDefined();

    // Reachability proves the ambient window closed correctly and
    // `asyncChildRegistry` adopted the right inbound bridge: if it hadn't
    // (e.g. adopted no bridge, or the wrong one), this dispatch from the
    // shell down into `asyncChildRegistry`'s own domain would fail to
    // resolve a handler.
    await registry0.executeActionsChain(actionChain(ACTION_ASYNC, D_ASYNC));
    expect(counter.count).toBe(1);
  });

  it('(h) unmounting the child extension retracts registry1\'s advertisements from the shell even though registry1 is never disposed', async () => {
    const { registry0, errorSpy } = await buildTopology();

    // Unmount child-ext directly through the shell's own mounter, WITHOUT
    // ever calling registry1.dispose() — proving retraction is triggered
    // by the PARENT (registry0) on the host extension's own unmount, per
    // `inst-retract-advertisements`, not by the disposing side.
    const mounter0 = registry0.getMounter(D0);
    await mounter0.unmount(CHILD_EXT);

    // D1 and D2 (re-propagated through registry1) are both gone from the
    // shell's forwarding entries — dispatching to either now fails.
    errorSpy.mockClear();
    await registry0.executeActionsChain(actionChain(ACTION_LEAF, D2));
    const d2FailureLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => String(arg).includes('Actions chain failed') || String(arg).includes('No handler found'))
    );
    expect(d2FailureLogged).toBe(true);
  });

  it('(i) a mount failure retracts whatever a nested registry advertised before the failure, so the shell has no leaked forwarding entry', async () => {
    const FAIL_ENTRY = 'entry.fail-child.v1';
    const FAIL_EXT = 'ext.fail-child.v1';
    const D_FAIL = 'domain.fail-child.v1';
    const ACTION_FAIL_LEAF = 'mock.action.v1~action_fail_leaf.v1~';

    const entries = new Map<string, MfeEntry>([[FAIL_ENTRY, makeEntry(FAIL_ENTRY)]]);
    const plugin = createMockPlugin(entries);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leafCounter = { count: 0 };

    let registryFail: DefaultMfeRegistry | undefined;

    class FailingMountHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        return {
          mount: (_container, bridge) => {
            void bridge;
            // Synchronously construct a nested registry and admit a domain
            // — advertising D_FAIL upward — THEN throw, simulating a mount
            // that fails after partially wiring itself up.
            registryFail = new DefaultMfeRegistry({ typeSystem: plugin });
            registryFail.registerDomain(
              makeDomain(D_FAIL, [ACTION_FAIL_LEAF]),
              new GenericDomainFactory([
                [ACTION_FAIL_LEAF, ActionHandler.fromFunction(async () => { leafCounter.count += 1; })],
              ])
            );
            throw new Error('mount failed after advertising D_FAIL');
          },
          unmount: () => {},
        };
      }
    }

    const registry0 = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new FailingMountHandler(FAIL_ENTRY)],
    });
    registry0.registerDomain(makeDomain(D0), new GenericDomainFactory());

    await registry0.registerExtension(makeExtension(FAIL_EXT, D0, FAIL_ENTRY));
    const mounter0 = registry0.getMounter(D0);
    mounter0.attach(document.createElement('div'));

    await expect(mounter0.mount(FAIL_EXT, document.createElement('div'))).rejects.toThrow(
      'mount failed after advertising D_FAIL'
    );
    expect(registryFail).toBeDefined();

    // The mount-failure path must have retracted D_FAIL's advertisement —
    // previously this path leaked, leaving the shell holding a forwarding
    // entry for a target whose host extension never finished mounting.
    errorSpy.mockClear();
    await registry0.executeActionsChain(actionChain(ACTION_FAIL_LEAF, D_FAIL));
    const failureLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => String(arg).includes('Actions chain failed') || String(arg).includes('No handler found'))
    );
    expect(failureLogged).toBe(true);
    expect(leafCounter.count).toBe(0);

    vi.restoreAllMocks();
  });

  it('(j) a nested registry an author reuses (not rebuilds) across a remount stays degraded to root-registry behavior — no automatic re-link (`inst-nested-registry-lifetime-scope`)', async () => {
    const REUSE_ENTRY = 'entry.reuse-child.v1';
    const REUSE_EXT = 'ext.reuse-child.v1';
    const D_REUSE = 'domain.reuse-child.v1';
    const ACTION_REUSE_LEAF = 'mock.action.v1~action_reuse_leaf.v1~';

    const entries = new Map<string, MfeEntry>([[REUSE_ENTRY, makeEntry(REUSE_ENTRY)]]);
    const plugin = createMockPlugin(entries);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reuseCounter = { count: 0 };

    // Constructed exactly once, the very first time `mount()` runs — never
    // rebuilt on a later remount. This is the documented limitation under
    // test: an author who holds on to a nested registry across an
    // unmount/remount cycle, rather than constructing a fresh one inside
    // each `mount()` call, does not get it automatically re-linked.
    let reusedRegistry: DefaultMfeRegistry | undefined;

    const reuseHandler = new InjectableMountHandler(REUSE_ENTRY, () => {
      if (!reusedRegistry) {
        // First mount: constructed synchronously inside mount()'s own body,
        // so it legitimately adopts the ambient bridge (`inst-adopt-ambient-bridge`).
        reusedRegistry = new DefaultMfeRegistry({ typeSystem: plugin });
        reusedRegistry.registerDomain(
          makeDomain(D_REUSE, [ACTION_REUSE_LEAF]),
          new GenericDomainFactory([
            [ACTION_REUSE_LEAF, ActionHandler.fromFunction(async () => { reuseCounter.count += 1; })],
          ])
        );
      }
      // Remount: the author reuses the SAME registry instance instead of
      // rebuilding it — no new `DefaultMfeRegistry` is constructed here, so
      // no further ambient-bridge adoption ever happens for it.
    });

    const registry0 = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [reuseHandler],
    });
    registry0.registerDomain(makeDomain(D0), new GenericDomainFactory());

    await registry0.registerExtension(makeExtension(REUSE_EXT, D0, REUSE_ENTRY));
    const mounter0 = registry0.getMounter(D0);
    mounter0.attach(document.createElement('div'));

    // ── First mount: reusedRegistry is freshly constructed and properly
    // linked — the shell can reach its domain. ──
    await mounter0.mount(REUSE_EXT, document.createElement('div'));
    expect(reusedRegistry).toBeDefined();

    await registry0.executeActionsChain(actionChain(ACTION_REUSE_LEAF, D_REUSE));
    expect(reuseCounter.count).toBe(1);

    // ── Unmount: the parent (registry0) revokes the stale link and deletes
    // its forwarding entry for D_REUSE — regardless of whether reusedRegistry
    // itself ever disposes (`inst-retract-advertisements`). ──
    await mounter0.unmount(REUSE_EXT);

    // ── Remount: reuseHandler's mount() body reuses `reusedRegistry` as-is;
    // no new registry is constructed, so no new adoption call is made and
    // `reusedRegistry` is never re-linked to registry0. ──
    await mounter0.mount(REUSE_EXT, document.createElement('div'));

    // The shell no longer has a route to D_REUSE: the domain was never
    // re-advertised (nothing re-registers it, and the reused registry holds
    // no working link back up), so dispatching from the shell fails to
    // resolve rather than silently or incorrectly reaching the reused
    // registry's still-live local handler.
    errorSpy.mockClear();
    await registry0.executeActionsChain(actionChain(ACTION_REUSE_LEAF, D_REUSE));
    const degradedFailureLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => String(arg).includes('Actions chain failed') || String(arg).includes('No handler found'))
    );
    expect(degradedFailureLogged).toBe(true);
    expect(reuseCounter.count).toBe(1); // unchanged — the shell dispatch never reached it

    // The reused registry's own domain is still perfectly functional when
    // dispatched to directly — proving it degraded to root-registry
    // behavior (usable on its own, just unreachable from its former
    // ancestor) rather than having silently broken outright.
    await reusedRegistry!.executeActionsChain(actionChain(ACTION_REUSE_LEAF, D_REUSE));
    expect(reuseCounter.count).toBe(2);

    vi.restoreAllMocks();
  });
});
