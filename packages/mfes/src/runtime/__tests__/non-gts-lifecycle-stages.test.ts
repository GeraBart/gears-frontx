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
 * something else still fails: every stage runs through DefaultMfeRegistry's
 * real lifecycle pipeline, the entity declares a hook bound to each fake stage
 * id, and DefaultLifecycleManager executes a hook only when `hook.stage`
 * equals the dispatched id — so the hook's action chain firing IS the id
 * assertion. init/destroyed are declared on the domain, activated/deactivated
 * on an extension driven through the domain's mounter.
 */
// @cpt-algo:cpt-frontx-algo-type-substrate-port-type-of-resolution:p2
import { describe, it, expect, vi } from 'vitest';
// @internal — colocated test, direct relative import is permitted.
import { DefaultMfeRegistry } from '../DefaultMfeRegistry';
import type { TypeSystemPlugin } from '../../type-substrate';
import type { ActionsChain, Extension, ExtensionDomain, MfeEntry } from '../../types';
import {
  MfeHandler,
  type ChildMfeBridge,
  type MfeEntryLifecycle,
} from '../../handler/types';
import { MfeBridgeFactoryDefault } from '../../handler/mfe-bridge-factory-default';
import { ExtensionDomainImplementation } from '../ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../ExtensionDomainImplementationFactory';
import type { DomainContext } from '../DomainContext';
import { ConcurrentMountStrategy } from '../mount-strategies';
import type { ContainerHooks } from '../mount-strategy';
import { ActionHandler } from '../../mediator/types';

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
// Dispatched by every lifecycle hook below. Its handler records the stage that
// triggered it, turning "which id did the runtime fire" into an observable
// effect rather than a spy call count.
const FAKE_ACTION_STAGE_PROBE = 'cti.example.action~stage_probe.v1~';

const ENTRY_BASE_ID = 'cti.example.entry~';
const ENTRY_ID = `${ENTRY_BASE_ID}widget.v1`;
const EXTENSION_ID = 'cti.example.extension~widget.v1';

function createNonGtsPlugin(): TypeSystemPlugin {
  // The entry lives in the plugin rather than in an earlier registration,
  // which is how `DefaultExtensionManager.resolveEntry` finds it for a first
  // extension.
  const registered = new Map<string, unknown>([[ENTRY_ID, makeEntry()]]);

  return {
    name: 'NonGtsPlugin',
    version: '1.0.0',
    registerSchema(): void {},
    getSchema(typeId: string): unknown {
      return registered.get(typeId);
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
    extensionsLifecycleStages: [FAKE_STAGE_ACTIVATED, FAKE_STAGE_DEACTIVATED],
  };
}

function makeEntry(): MfeEntry {
  return {
    id: ENTRY_ID,
    requiredProperties: [],
    actions: [],
    domainActions: [],
  };
}

function makeExtension(): Extension {
  return {
    id: EXTENSION_ID,
    domain: DOMAIN_ID,
    entry: ENTRY_ID,
    // Hooks target the domain rather than the extension: an extension target
    // only resolves once the mounted MFE registers a handler of its own, and
    // the stub lifecycle below registers none.
    lifecycle: [
      { stage: FAKE_STAGE_ACTIVATED, actions_chain: stageProbeChain(FAKE_STAGE_ACTIVATED) },
      { stage: FAKE_STAGE_DEACTIVATED, actions_chain: stageProbeChain(FAKE_STAGE_DEACTIVATED) },
    ],
  } as Extension;
}

/**
 * Handler whose load resolves immediately to an inert lifecycle. The mount
 * path only needs a lifecycle object to call; what this test observes is the
 * stage ids the registry fires around that call, so no module loading,
 * manifest or blob chain is involved.
 */
class StubHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();

  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return { mount: () => {}, unmount: () => {} };
  }
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

// ─── Extension lifecycle: activated and deactivated stages ────────────────

describe('non-GTS consumer: mount lifecycle resolves activated/deactivated stages through the plugin', () => {
  /**
   * Register the domain and one extension, then mount it through the domain's
   * mounter — the same route the React slot takes. Returns the probe log with
   * the domain's own init entry already dropped, so what remains is what the
   * extension's hooks recorded.
   */
  async function mountExtensionThroughRegistry(
    plugin: TypeSystemPlugin
  ): Promise<{ registry: DefaultMfeRegistry; stageProbeLog: string[] }> {
    const stageProbeLog: string[] = [];
    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new StubHandler(ENTRY_BASE_ID)],
    });

    registry.registerDomain(makeDomain(), new ConcurrentDomainFactory(stageProbeLog));
    await vi.waitFor(() => expect(stageProbeLog).toEqual([FAKE_STAGE_INIT]));
    stageProbeLog.length = 0;

    await registry.registerExtension(makeExtension());

    const mounter = registry.getMounter(DOMAIN_ID);
    mounter.attach(document.createElement('div'));
    await mounter.mount(EXTENSION_ID, document.createElement('div'));

    return { registry, stageProbeLog };
  }

  // inst-resolve-lifecycle-stage-activated
  it('runs the extension hook bound to the activated stage id the plugin resolved once the extension has mounted', async () => {
    const plugin = createNonGtsPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');

    const { stageProbeLog } = await mountExtensionThroughRegistry(plugin);

    expect(stageProbeLog).toEqual([FAKE_STAGE_ACTIVATED]);
    expect(activatedSpy).toHaveBeenCalledWith();
  });

  // inst-resolve-lifecycle-stage-deactivated
  it('runs the extension hook bound to the deactivated stage id the plugin resolved when the extension unmounts', async () => {
    const plugin = createNonGtsPlugin();
    const deactivatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageDeactivatedId');

    const { registry, stageProbeLog } = await mountExtensionThroughRegistry(plugin);
    stageProbeLog.length = 0;

    await registry.getMounter(DOMAIN_ID).unmount(EXTENSION_ID);

    expect(stageProbeLog).toEqual([FAKE_STAGE_DEACTIVATED]);
    expect(deactivatedSpy).toHaveBeenCalledWith();
  });
});
