/**
 * Non-GTS consumer lifecycle stage resolution.
 *
 * Each of the four well-known lifecycle stages (init/activated/deactivated/
 * destroyed) must reach the runtime through `typeSystem.resolveLifecycleStage*Id()`,
 * never through a literal this package spells itself: a consumer whose stages
 * live outside the GTS namespace is otherwise silently unmatched.
 *
 * The fake plugin below answers in a notation that is deliberately NOT GTS, so
 * any runtime path still holding a `gts.frontx.mfes.lifecycle.stage...` literal
 * leaves the corresponding resolver spy uncalled and fails the assertion.
 *
 * Every case asserts the stage id the runtime actually dispatched, not merely
 * that the resolver ran, so a runtime that called the resolver and then fired
 * something else still fails:
 * - init/destroyed run through DefaultMfeRegistry's real domain-lifecycle
 *   pipeline. The domain declares a hook bound to each fake stage id, and
 *   DefaultLifecycleManager executes a hook only when `hook.stage` equals the
 *   dispatched id — so the hook's action chain firing IS the id assertion.
 * - activated/deactivated run through DefaultMountManager, whose
 *   `triggerLifecycle` collaborator is the dispatch boundary: the recorded
 *   stage ids are exactly what the registry's lifecycle manager would receive.
 *   Driving these from the registry instead needs a working MFE handler
 *   fixture, which is outside this change.
 */
// @cpt-algo:cpt-frontx-algo-type-substrate-port-type-of-resolution:p2
import { describe, it, expect, vi } from 'vitest';
// @internal — colocated test, direct relative import is permitted.
import { DefaultMfeRegistry } from '../DefaultMfeRegistry';
import { DefaultMountManager } from '../default-mount-manager';
import type { DefaultExtensionManager } from '../default-extension-manager';
import type { RuntimeBridgeFactory } from '../runtime-bridge-factory';
import { RuntimeCoordinator, type RuntimeConnection } from '../coordination/types';
import type { MfeRegistry } from '../../registry/MfeRegistry';
import type { TypeSystemPlugin } from '../../type-substrate';
import type { ActionsChain, ExtensionDomain } from '../../types';
import { ExtensionDomainImplementation } from '../ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../ExtensionDomainImplementationFactory';
import type { DomainContext } from '../DomainContext';
import { ConcurrentMountStrategy } from '../mount-strategies';
import type { ContainerHooks } from '../mount-strategy';
import { ActionHandler } from '../../mediator/types';

// The manager's config shape is declared inline on its constructor; deriving it
// keeps the stub builder below tied to the real type, so a newly required
// config field fails to compile here instead of passing as a shapeless double.
type MountManagerConfig = ConstructorParameters<typeof DefaultMountManager>[0];

// Fake non-GTS notation for the four lifecycle stages. Deliberately NOT in
// the GTS namespace - if the runtime resolved any stage through a literal
// instead of the plugin, the resolver spies would not fire.
const FAKE_STAGE_INIT = 'cti.example.lifecycle.stage~init';
const FAKE_STAGE_ACTIVATED = 'cti.example.lifecycle.stage~activated';
const FAKE_STAGE_DEACTIVATED = 'cti.example.lifecycle.stage~deactivated';
const FAKE_STAGE_DESTROYED = 'cti.example.lifecycle.stage~destroyed';
const FAKE_ACTION_LOAD_EXT = 'cti.example.action~load_ext.v1~';
const FAKE_ACTION_MOUNT_EXT = 'cti.example.action~mount_ext.v1~';
const FAKE_ACTION_UNMOUNT_EXT = 'cti.example.action~unmount_ext.v1~';
// Dispatched by the domain's init/destroyed hooks. Its handler records the
// stage that triggered it, turning "which id did the runtime fire" into an
// observable effect rather than a spy call count.
const FAKE_ACTION_STAGE_PROBE = 'cti.example.action~stage_probe.v1~';

function createNonGtsPlugin(): TypeSystemPlugin {
  return {
    name: 'NonGtsPlugin',
    version: '1.0.0',
    registerSchema(): void {},
    getSchema(): undefined {
      return undefined;
    },
    register(): void {},
    isTypeOf(typeId: string, baseTypeId: string): boolean {
      return typeId === baseTypeId || typeId.startsWith(baseTypeId);
    },
    validateInstance() {
      return { valid: true, errors: [] };
    },
    resolveLoadExtActionId(): string {
      return FAKE_ACTION_LOAD_EXT;
    },
    resolveMountExtActionId(): string {
      return FAKE_ACTION_MOUNT_EXT;
    },
    resolveUnmountExtActionId(): string {
      return FAKE_ACTION_UNMOUNT_EXT;
    },
    resolveLifecycleStageInitId(): string {
      return FAKE_STAGE_INIT;
    },
    resolveLifecycleStageActivatedId(): string {
      return FAKE_STAGE_ACTIVATED;
    },
    resolveLifecycleStageDeactivatedId(): string {
      return FAKE_STAGE_DEACTIVATED;
    },
    resolveLifecycleStageDestroyedId(): string {
      return FAKE_STAGE_DESTROYED;
    },
  };
}

// ─── Domain + factory fakes (real ExtensionDomainImplementation) ────────────

const DOMAIN_ID = 'cti.example.domain.concurrent.v1';

function stageProbeChain(stageId: string): ActionsChain {
  return {
    action: {
      type: FAKE_ACTION_STAGE_PROBE,
      target: DOMAIN_ID,
      payload: { subject: stageId },
    },
  };
}

function makeDomain(): ExtensionDomain {
  return {
    id: DOMAIN_ID,
    actions: [
      FAKE_ACTION_LOAD_EXT,
      FAKE_ACTION_MOUNT_EXT,
      FAKE_ACTION_UNMOUNT_EXT,
      FAKE_ACTION_STAGE_PROBE,
    ],
    extensionsActions: [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    // The declared stages and the hooks bound to them are what make the
    // dispatched id observable: DefaultLifecycleManager runs a hook only when
    // `hook.stage` equals the id it was handed, so a runtime firing a GTS
    // literal instead leaves the probe log empty.
    lifecycleStages: [FAKE_STAGE_INIT, FAKE_STAGE_DESTROYED],
    lifecycle: [
      { stage: FAKE_STAGE_INIT, actions_chain: stageProbeChain(FAKE_STAGE_INIT) },
      { stage: FAKE_STAGE_DESTROYED, actions_chain: stageProbeChain(FAKE_STAGE_DESTROYED) },
    ],
    extensionsLifecycleStages: [],
  };
}

class TestHooks implements ContainerHooks {
  create(_extensionId: string): Element {
    return document.createElement('div');
  }
  destroy(_extensionId: string): void {}
}

class ConcurrentDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext, stageProbeLog: string[]) {
    super();
    const hooks = new TestHooks();
    this.strategy = new ConcurrentMountStrategy(ctx.mounter, hooks);
    ctx.registerHandler(
      FAKE_ACTION_MOUNT_EXT,
      ActionHandler.fromFunction(() => this.strategy.mount({ subject: 'stub' }))
    );
    ctx.registerHandler(
      FAKE_ACTION_UNMOUNT_EXT,
      ActionHandler.fromFunction(() => this.strategy.unmount({ subject: 'stub' }))
    );
    ctx.registerHandler(
      FAKE_ACTION_STAGE_PROBE,
      ActionHandler.fromFunction(async (_actionTypeId, payload) => {
        const subject = payload?.subject;
        if (typeof subject === 'string') {
          stageProbeLog.push(subject);
        }
      })
    );
  }

  protected getMountStrategies() {
    return [this.strategy];
  }
}

class ConcurrentDomainFactory extends ExtensionDomainImplementationFactory {
  constructor(private readonly stageProbeLog: string[]) {
    super();
  }

  build(ctx: DomainContext): ConcurrentDomainImpl {
    return new ConcurrentDomainImpl(ctx, this.stageProbeLog);
  }
}

// ─── Domain lifecycle: init and destroyed stages ───────────────────────────

describe('non-GTS consumer: domain lifecycle resolves init/destroyed stages through the plugin', () => {
  // inst-resolve-lifecycle-stage-init
  it('runs the domain hook bound to the init stage id the plugin resolved when a domain is registered', async () => {
    const plugin = createNonGtsPlugin();
    const initSpy = vi.spyOn(plugin, 'resolveLifecycleStageInitId');
    const stageProbeLog: string[] = [];
    const registry = new DefaultMfeRegistry({ typeSystem: plugin });

    registry.registerDomain(makeDomain(), new ConcurrentDomainFactory(stageProbeLog));

    // Domain registration fires the init stage fire-and-forget, so the hook's
    // action chain settles on a later microtask than registerDomain's return.
    await vi.waitFor(() => expect(stageProbeLog).toEqual([FAKE_STAGE_INIT]));
    expect(initSpy).toHaveBeenCalledWith();
  });

  // inst-resolve-lifecycle-stage-destroyed
  it('runs the domain hook bound to the destroyed stage id the plugin resolved when a domain is unregistered', async () => {
    const plugin = createNonGtsPlugin();
    const destroyedSpy = vi.spyOn(plugin, 'resolveLifecycleStageDestroyedId');
    const stageProbeLog: string[] = [];
    const registry = new DefaultMfeRegistry({ typeSystem: plugin });

    registry.registerDomain(makeDomain(), new ConcurrentDomainFactory(stageProbeLog));
    await vi.waitFor(() => expect(stageProbeLog).toEqual([FAKE_STAGE_INIT]));

    // Constraint: unregisterDomain drops the domain's mediator handlers before
    // firing destroyed, so this hook's chain cannot reach the probe handler the
    // way init's does — it is logged as unhandled. The registry's chain executor
    // is the furthest observable point, and the chain it receives still carries
    // the stage id, so the assertion remains about the dispatched id.
    const chainSpy = vi.spyOn(registry, 'executeActionsChain');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await registry.unregisterDomain(DOMAIN_ID);

    expect(chainSpy).toHaveBeenCalledWith(stageProbeChain(FAKE_STAGE_DESTROYED));
    expect(destroyedSpy).toHaveBeenCalledWith();
    consoleError.mockRestore();
  });
});

// ─── MountManager: activated and deactivated stages ────────────────────────
//
// DefaultMountManager in isolation. The extensionManager and coordinator are
// stubbed to let mountExtension/unmountExtension reach the triggerLifecycle
// call without driving the full MFE load pipeline.
//
// Constraint: `triggerLifecycle` is the dispatch boundary — the registry wires
// it straight to DefaultLifecycleManager.triggerLifecycleStage — so recording
// its stageId argument asserts the id the runtime actually dispatched, not just
// that a resolver ran. Reaching the same point from the registry would need a
// working MFE handler fixture, which is outside this change.

class StubExtensionManager {
  // Persists across calls so DefaultMountManager's mount/unmount mutations
  // (extensionState.mountState = 'mounted' / 'unmounted') survive between
  // the mount and unmount invocations of getExtensionState().
  private readonly state = {
    extension: { domain: 'cti.example.domain.v1' },
    entry: { id: 'cti.example.entry.v1', domainActions: [] },
    loadState: 'loaded',
    mountState: 'unmounted',
    lifecycle: { mount: async () => {}, unmount: async () => {} },
    bridge: null as null | { dispose(): void },
    container: null as null | Element,
    shadowRoot: undefined as undefined | ShadowRoot,
    error: undefined as unknown,
  };

  getExtensionState() {
    return this.state;
  }
  getDomainState() {
    return {
      domain: { id: 'cti.example.domain.v1' },
      implementation: {},
    };
  }
}

class StubCoordinator extends RuntimeCoordinator {
  get(): RuntimeConnection | undefined {
    return undefined;
  }
  register(): void {}
  unregister(): void {}
}

class StubBridgeFactory {
  createBridge() {
    const bridge = {
      instanceId: 'stub',
      dispose() {},
      domainId: 'stub',
      executeActionsChain: async () => {},
      subscribeToProperty: () => () => {},
      getProperty: () => undefined,
      registerActionHandler: () => {},
    };
    return { parentBridge: bridge, childBridge: bridge };
  }
  disposeBridge() {}
}

// The three casts below are per-field and deliberate: DefaultExtensionManager,
// MfeRegistry and RuntimeBridgeFactory each carry a surface far wider than the
// mount/unmount paths touch, and implementing them in full would assert more
// about this test's fixtures than it verifies. The declared return type still
// holds every other field to the real config contract.
function buildStubMountManagerConfig(
  plugin: TypeSystemPlugin,
  triggeredStages: string[]
): MountManagerConfig {
  return {
    extensionManager: new StubExtensionManager() as unknown as DefaultExtensionManager,
    resolveHandler: () => undefined,
    coordinator: new StubCoordinator(),
    typeSystem: plugin,
    triggerLifecycle: async (_extId: string, stageId: string) => {
      triggeredStages.push(stageId);
    },
    executeActionsChain: async () => {},
    hostRuntime: {} as unknown as MfeRegistry,
    registerCatchAllActionHandler: () => {},
    unregisterCatchAllActionHandler: () => {},
    registerExtensionActionHandler: () => {},
    unregisterExtensionActionHandler: () => {},
    bridgeFactory: new StubBridgeFactory() as unknown as RuntimeBridgeFactory,
  };
}

describe('non-GTS consumer: mount lifecycle resolves activated/deactivated stages through the plugin', () => {
  // inst-resolve-lifecycle-stage-activated
  it('dispatches the activated stage id the plugin resolved when an extension mounts', async () => {
    const plugin = createNonGtsPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const triggeredStages: string[] = [];

    const manager = new DefaultMountManager(buildStubMountManagerConfig(plugin, triggeredStages));

    await manager.mountExtension('cti.example.extension.v1', document.createElement('div'));

    expect(activatedSpy).toHaveBeenCalledWith();
    expect(triggeredStages).toContain(FAKE_STAGE_ACTIVATED);
  });

  // inst-resolve-lifecycle-stage-deactivated
  it('dispatches the deactivated stage id the plugin resolved when an extension unmounts', async () => {
    const plugin = createNonGtsPlugin();
    const deactivatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageDeactivatedId');
    const triggeredStages: string[] = [];

    const manager = new DefaultMountManager(buildStubMountManagerConfig(plugin, triggeredStages));

    // Mount first so the extension's state flips to 'mounted' for the
    // unmount path's early-return guard.
    await manager.mountExtension('cti.example.extension.v1', document.createElement('div'));
    triggeredStages.length = 0;
    await manager.unmountExtension('cti.example.extension.v1');

    expect(deactivatedSpy).toHaveBeenCalledWith();
    expect(triggeredStages).toContain(FAKE_STAGE_DEACTIVATED);
  });
});
