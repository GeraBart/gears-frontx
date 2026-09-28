/**
 * End-to-end tests for the mount-ext prologue
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution` prologue
 * instructions) running through the real `DefaultMfeRegistry`, the real
 * `DefaultMountManager` pipeline, and each of the three shipped mount
 * strategies. Complements the isolated wrapper unit tests in
 * `MountExtActionHandler.test.ts`.
 *
 * Every case uses an explicit settlement signal — a controlled deferred the
 * test resolves itself from a domain-local probe handler bound to a chain's
 * `next` or `fallback`, or a real awaited registry/mounter call — never a
 * sleep, a poll, `vi.waitFor`, or a bare microtask flush.
 */
import { describe, it, expect, vi } from 'vitest';
import { DefaultMfeRegistry } from '../DefaultMfeRegistry';
import type { DefaultExtensionMounter } from '../DefaultExtensionMounter';
import type { MfeRegistryConfig } from '../config';
import type { TypeSystemPlugin } from '../../type-substrate';
import type { ExtensionDomain, Extension, MfeEntry } from '../../types';
import { MfeHandler, type MfeEntryLifecycle } from '../../handler/MfeHandler';
import type { ChildMfeBridge } from '../../handler/ChildMfeBridge';
import { MfeBridgeFactoryDefault } from '../../bridge/MfeBridgeFactoryDefault';
import { ExtensionDomainImplementation } from '../ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../ExtensionDomainImplementationFactory';
import type { DomainContext } from '../DomainContext';
import { ConcurrentMountStrategy } from '../ConcurrentMountStrategy';
import { OptionalMountStrategy } from '../OptionalMountStrategy';
import { ExclusiveMountStrategy } from '../ExclusiveMountStrategy';
import type { ContainerHooks, MountStrategy } from '../MountStrategy';
import { ActionHandler } from '../../mediator/ActionHandler';
import type { MfeRegistry } from '../../registry/MfeRegistry';
import type { DefaultActionsChainsMediator } from '../../mediator/DefaultActionsChainsMediator';

// ─── Mock type-system plugin (hierarchy-agnostic, own notation) ─────────────

const ACTION_LOAD_EXT = 'mock.action.v1~load_ext.v1~';
const ACTION_MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const ACTION_UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const STAGE_INIT = 'mock.stage.v1~init.v1';
const STAGE_ACTIVATED = 'mock.stage.v1~activated.v1';
const STAGE_DEACTIVATED = 'mock.stage.v1~deactivated.v1';
const STAGE_DESTROYED = 'mock.stage.v1~destroyed.v1';

const ENTRY_ID = 'mock.entry.v1~widget.v1';

interface MockSchema { $id?: string }

function createPlugin(): TypeSystemPlugin<MockSchema> {
  const schemas = new Map<string, MockSchema>();
  return {
    name: 'MockPlugin',
    version: '1.0.0',
    registerSchema(schema) { if (schema.$id) schemas.set(schema.$id, schema); },
    getSchema(typeId) { return schemas.get(typeId); },
    register() { /* accept everything */ },
    isTypeOf(typeId, baseTypeId) { return typeId === baseTypeId || typeId.startsWith(baseTypeId); },
    validateInstance() { return { valid: true, errors: [] }; },
    resolveLoadExtActionId: () => ACTION_LOAD_EXT,
    resolveMountExtActionId: () => ACTION_MOUNT_EXT,
    resolveUnmountExtActionId: () => ACTION_UNMOUNT_EXT,
    resolveLifecycleStageInitId: () => STAGE_INIT,
    resolveLifecycleStageActivatedId: () => STAGE_ACTIVATED,
    resolveLifecycleStageDeactivatedId: () => STAGE_DEACTIVATED,
    resolveLifecycleStageDestroyedId: () => STAGE_DESTROYED,
  };
}

/** getSchema needs the entry to satisfy `DefaultExtensionManager`'s `isMfeEntry` duck-typing. */
function registerEntrySchema(plugin: TypeSystemPlugin<MockSchema>): void {
  const entry: MfeEntry & MockSchema = {
    $id: ENTRY_ID,
    id: ENTRY_ID,
    requiredProperties: [],
    actions: [],
    domainActions: [],
  };
  plugin.registerSchema(entry as unknown as MockSchema);
}

class StubHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();
  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return { mount: () => {}, unmount: () => {} };
  }
}

/** A handler whose lifecycle's own `unmount` throws — makes a physical unmount fail deterministically. */
class ThrowingUnmountHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();
  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return {
      mount: () => {},
      unmount: () => { throw new Error('unmount failed'); },
    };
  }
}

/**
 * A handler whose lifecycle's own `mount` awaits an externally-controlled
 * gate before settling — makes a physical mount genuinely in progress for
 * as long as the test keeps the gate open, deterministically (no sleeps, no
 * polling). Optionally throws once the gate opens, to make the gated mount
 * fail instead of succeed.
 */
class GatedMountHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();
  /** Number of times this handler's lifecycle `unmount` has actually run — the physical-unmount count. */
  unmountCalls = 0;
  constructor(
    entryId: string,
    private readonly gate: Promise<void>,
    private readonly failAfterGate: boolean = false
  ) {
    super(entryId);
  }
  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return {
      mount: async () => {
        await this.gate;
        if (this.failAfterGate) {
          throw new Error('gated mount failed');
        }
      },
      unmount: () => { this.unmountCalls += 1; },
    };
  }
}

class TestHooks implements ContainerHooks {
  readonly created: string[] = [];
  readonly destroyed: string[] = [];
  create(extensionId: string): Element {
    this.created.push(extensionId);
    return document.createElement('div');
  }
  destroy(extensionId: string): void {
    this.destroyed.push(extensionId);
  }
}

/** A controlled deferred — the only kind of "wait" these tests use. */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeExtension(id: string, domain: string): Extension {
  return { id, domain, entry: ENTRY_ID } as Extension;
}

function makeDomain(id: string, requireUnmount: boolean): ExtensionDomain {
  return {
    id,
    actions: requireUnmount
      ? [ACTION_LOAD_EXT, ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT]
      : [ACTION_LOAD_EXT, ACTION_MOUNT_EXT],
    extensionsActions: [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
    extensionsTypeId: '',
  } as unknown as ExtensionDomain;
}

// ─── Domain implementations, one per strategy, each exposing its strategy + hooks for spying ──

class ConcurrentDomainImpl extends ExtensionDomainImplementation {
  constructor(ctx: DomainContext, readonly strategy: ConcurrentMountStrategy) {
    super();
    ctx.registerHandler(ACTION_MOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as { subject: string })));
    ctx.registerHandler(ACTION_UNMOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as { subject: string })));
  }
  protected getMountStrategies(): MountStrategy[] { return [this.strategy]; }
}

class ConcurrentDomainFactory extends ExtensionDomainImplementationFactory {
  readonly hooks = new TestHooks();
  strategy!: ConcurrentMountStrategy;
  build(ctx: DomainContext): ConcurrentDomainImpl {
    this.strategy = new ConcurrentMountStrategy(ctx.mounter, this.hooks);
    return new ConcurrentDomainImpl(ctx, this.strategy);
  }
}

class OptionalDomainImpl extends ExtensionDomainImplementation {
  constructor(ctx: DomainContext, readonly strategy: OptionalMountStrategy) {
    super();
    ctx.registerHandler(ACTION_MOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as { subject: string })));
    ctx.registerHandler(ACTION_UNMOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as { subject: string })));
  }
  protected getMountStrategies(): MountStrategy[] { return [this.strategy]; }
}

class OptionalDomainFactory extends ExtensionDomainImplementationFactory {
  readonly hooks = new TestHooks();
  strategy!: OptionalMountStrategy;
  constructor(private readonly reg: MfeRegistry, private readonly domainId: string) { super(); }
  build(ctx: DomainContext): OptionalDomainImpl {
    this.strategy = new OptionalMountStrategy(ctx.mounter, this.hooks, this.reg, this.domainId);
    return new OptionalDomainImpl(ctx, this.strategy);
  }
}

class ExclusiveDomainImpl extends ExtensionDomainImplementation {
  constructor(ctx: DomainContext, readonly strategy: ExclusiveMountStrategy) {
    super();
    ctx.registerHandler(ACTION_MOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as { subject: string })));
  }
  protected getMountStrategies(): MountStrategy[] { return [this.strategy]; }
}

class ExclusiveDomainFactory extends ExtensionDomainImplementationFactory {
  readonly hooks = new TestHooks();
  strategy!: ExclusiveMountStrategy;
  constructor(private readonly reg: MfeRegistry, private readonly domainId: string) { super(); }
  build(ctx: DomainContext): ExclusiveDomainImpl {
    this.strategy = new ExclusiveMountStrategy(ctx.mounter, this.hooks, this.reg, this.domainId);
    return new ExclusiveDomainImpl(ctx, this.strategy);
  }
}

type SpyableFactory = ConcurrentDomainFactory | OptionalDomainFactory | ExclusiveDomainFactory;

function freshRegistry(plugin: TypeSystemPlugin<MockSchema>, handler: MfeHandler = new StubHandler(ENTRY_ID)): DefaultMfeRegistry {
  registerEntrySchema(plugin);
  const config: MfeRegistryConfig = { typeSystem: plugin, mfeHandlers: [handler] };
  return new DefaultMfeRegistry(config);
}

/** Register a one-off domain-scoped probe action whose handler resolves the returned deferred. */
function wireProbe(registry: DefaultMfeRegistry, domainId: string, actionType: string): Promise<void> {
  const deferred = createDeferred();
  const mediator = (registry as unknown as { mediator: DefaultActionsChainsMediator }).mediator;
  mediator.registerHandler(domainId, actionType, ActionHandler.fromFunction(async () => { deferred.resolve(); }));
  return deferred.promise;
}

describe('mount-ext prologue — end to end', () => {
  it('(a) mount_ext of an already-mounted extension succeeds immediately, creates no container, evicts nothing, and does not re-trigger activated — for each strategy', async () => {
    for (const strategyName of ['concurrent', 'optional', 'exclusive'] as const) {
      const plugin = createPlugin();
      const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
      const domainId = `domain-already-mounted-${strategyName}`;
      const registry = freshRegistry(plugin);

      let factory: SpyableFactory;
      if (strategyName === 'concurrent') {
        factory = new ConcurrentDomainFactory();
      } else if (strategyName === 'optional') {
        factory = new OptionalDomainFactory(registry, domainId);
      } else {
        factory = new ExclusiveDomainFactory(registry, domainId);
      }
      registry.registerDomain(makeDomain(domainId, strategyName !== 'exclusive'), factory);

      await registry.registerExtension(makeExtension('ext-a', domainId));
      const mounter = registry.getMounter(domainId);
      mounter.attach(document.createElement('div'));

      // Pre-mount directly through the mounter (the real physical-mount
      // path), independent of the prologue, so the mount-set already shows
      // 'ext-a' as mounted before the mount_ext request under test.
      await mounter.mount('ext-a', document.createElement('div'));
      expect(registry.getMountedExtensions(domainId)).toContain('ext-a');

      const mountSpy = vi.spyOn(factory.strategy, 'mount');
      activatedSpy.mockClear();
      factory.hooks.created.length = 0;

      const nextFired = wireProbe(registry, domainId, 'already-mounted-next');
      registry.executeActionsChain({
        action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
        next: { action: { type: 'already-mounted-next', target: domainId, payload: {} } },
      });
      await nextFired;

      expect(mountSpy).not.toHaveBeenCalled();
      expect(factory.hooks.created).toHaveLength(0);
      expect(activatedSpy).not.toHaveBeenCalled();

      registry.dispose();
    }
  });

  it('(b) two concurrent mount_ext requests for the same extension share one physical mount, both settle successfully, and activated fires exactly once', async () => {
    const plugin = createPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const domainId = 'domain-join-success';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    registry.getMounter(domainId).attach(document.createElement('div'));

    const mountSpy = vi.spyOn(factory.strategy, 'mount');

    const firstFired = wireProbe(registry, domainId, 'join-probe-1');
    const secondFired = wireProbe(registry, domainId, 'join-probe-2');

    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'join-probe-1', target: domainId, payload: {} } },
    });
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'join-probe-2', target: domainId, payload: {} } },
    });

    await Promise.all([firstFired, secondFired]);

    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(activatedSpy).toHaveBeenCalledTimes(1);
    expect(registry.getMountedExtensions(domainId)).toContain('ext-a');

    registry.dispose();
  });

  it('(d) mount_ext naming a domain the extension is not admitted to fails, and the chain fallback runs', async () => {
    const plugin = createPlugin();
    const domainId = 'domain-eligible';
    const otherDomainId = 'domain-not-eligible';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    // A second, unrelated domain to dispatch against — 'ext-a' is registered
    // to `domainId`, never to `otherDomainId`.
    const otherFactory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(otherDomainId, true), otherFactory);
    await registry.registerExtension(makeExtension('ext-a', domainId));

    const fallbackFired = wireProbe(registry, otherDomainId, 'fallback-probe');

    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: otherDomainId, payload: { subject: 'ext-a' } },
      fallback: { action: { type: 'fallback-probe', target: otherDomainId, payload: {} } },
    });

    await fallbackFired;
    expect(registry.getMountedExtensions(otherDomainId)).not.toContain('ext-a');

    registry.dispose();
  });

  it('(c) a mount arriving during an in-progress unmount waits, then fresh-mounts, and activated fires again for the fresh mount', async () => {
    const plugin = createPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const domainId = 'domain-await-unmount';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));

    await mounter.mount('ext-a', document.createElement('div'));
    expect(activatedSpy).toHaveBeenCalledTimes(1);

    // Start (but do not await) an unmount so it is genuinely in flight when
    // the mount_ext request below arrives.
    const unmountPromise = mounter.unmount('ext-a');

    const mountFired = wireProbe(registry, domainId, 'mount-after-unmount-probe');
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'mount-after-unmount-probe', target: domainId, payload: {} } },
    });

    await unmountPromise;
    await mountFired;

    expect(registry.getMountedExtensions(domainId)).toContain('ext-a');
    expect(activatedSpy).toHaveBeenCalledTimes(2);

    registry.dispose();
  });

  it('(c) a failed in-progress unmount fails the waiting mount request', async () => {
    const plugin = createPlugin();
    const domainId = 'domain-failed-unmount';
    // `unmountExtension` calls the extension's own lifecycle `unmount`, so a
    // lifecycle whose `unmount` throws makes the in-progress unmount this
    // mount request waits on fail deterministically.
    const registry = freshRegistry(plugin, new ThrowingUnmountHandler(ENTRY_ID));
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));

    await mounter.mount('ext-a', document.createElement('div'));

    const unmountPromise = mounter.unmount('ext-a').catch(() => { /* asserted via the waiting mount's fallback below */ });

    const fallbackFired = wireProbe(registry, domainId, 'failed-unmount-fallback');
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      fallback: { action: { type: 'failed-unmount-fallback', target: domainId, payload: {} } },
    });

    await unmountPromise;
    await fallbackFired;

    registry.dispose();
  });

  it('(e) a chain whose mount_ext targets an already-mounted extension proceeds to its declared next', async () => {
    const plugin = createPlugin();
    const domainId = 'domain-next-on-already-mounted';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));
    await mounter.mount('ext-a', document.createElement('div'));

    const nextFired = wireProbe(registry, domainId, 'next-probe');

    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'next-probe', target: domainId, payload: {} } },
    });

    await nextFired;

    registry.dispose();
  });

  it('(f) two different extensions dispatched concurrently in an Optional/Exclusive domain end up with exactly one occupant — the last-dispatched one', async () => {
    for (const strategyName of ['optional', 'exclusive'] as const) {
      const plugin = createPlugin();
      const domainId = `domain-cross-ext-race-${strategyName}`;
      const registry = freshRegistry(plugin);
      const factory = strategyName === 'optional'
        ? new OptionalDomainFactory(registry, domainId)
        : new ExclusiveDomainFactory(registry, domainId);
      registry.registerDomain(makeDomain(domainId, strategyName === 'optional'), factory);
      await registry.registerExtension(makeExtension('ext-a', domainId));
      await registry.registerExtension(makeExtension('ext-b', domainId));
      registry.getMounter(domainId).attach(document.createElement('div'));

      const aFired = wireProbe(registry, domainId, 'race-probe-a');
      const bFired = wireProbe(registry, domainId, 'race-probe-b');

      // Dispatched back to back, neither awaited before the other starts —
      // genuinely concurrent from the mediator's point of view.
      registry.executeActionsChain({
        action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
        next: { action: { type: 'race-probe-a', target: domainId, payload: {} } },
      });
      registry.executeActionsChain({
        action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-b' } },
        next: { action: { type: 'race-probe-b', target: domainId, payload: {} } },
      });

      await Promise.all([aFired, bFired]);

      const mounted = registry.getMountedExtensions(domainId);
      expect(mounted).toHaveLength(1);
      // The per-domain coordinator orders different-extension fresh mounts
      // in dispatch order for strategies that read and mutate the mount set
      // (Optional/Exclusive), so the extension dispatched SECOND is the one
      // still occupying the domain once both requests have settled.
      expect(mounted).toEqual(['ext-b']);

      registry.dispose();
    }
  });

  it('(g) two mount_ext-derived action types requesting the same extension concurrently share one physical mount', async () => {
    // A domain that declares TWO concrete mount_ext action subtypes (both
    // typed as mount_ext by the plugin's prefix match), each independently
    // wrapped by the registry's prologue in `registerDomain` — proves the
    // two wrapped handlers share the SAME occupancy coordinator rather than
    // each tracking in-flight mounts on its own.
    const ACTION_MOUNT_EXT_DERIVED = `${ACTION_MOUNT_EXT}derived.v1~`;

    class TwoActionTypesDomainImpl extends ExtensionDomainImplementation {
      constructor(ctx: DomainContext, readonly strategy: ConcurrentMountStrategy) {
        super();
        const mountHandler = ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as { subject: string }));
        ctx.registerHandler(ACTION_MOUNT_EXT, mountHandler);
        ctx.registerHandler(ACTION_MOUNT_EXT_DERIVED, mountHandler);
        ctx.registerHandler(ACTION_UNMOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as { subject: string })));
      }
      protected getMountStrategies(): MountStrategy[] { return [this.strategy]; }
    }

    class TwoActionTypesDomainFactory extends ExtensionDomainImplementationFactory {
      readonly hooks = new TestHooks();
      strategy!: ConcurrentMountStrategy;
      build(ctx: DomainContext): TwoActionTypesDomainImpl {
        this.strategy = new ConcurrentMountStrategy(ctx.mounter, this.hooks);
        return new TwoActionTypesDomainImpl(ctx, this.strategy);
      }
    }

    const plugin = createPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const domainId = 'domain-derived-action-join';
    const registry = freshRegistry(plugin);
    const factory = new TwoActionTypesDomainFactory();
    registry.registerDomain(
      { ...makeDomain(domainId, true), actions: [ACTION_LOAD_EXT, ACTION_MOUNT_EXT, ACTION_MOUNT_EXT_DERIVED, ACTION_UNMOUNT_EXT] },
      factory
    );
    await registry.registerExtension(makeExtension('ext-a', domainId));
    registry.getMounter(domainId).attach(document.createElement('div'));

    const mountSpy = vi.spyOn(factory.strategy, 'mount');

    const firstFired = wireProbe(registry, domainId, 'derived-probe-1');
    const secondFired = wireProbe(registry, domainId, 'derived-probe-2');

    // Dispatched through two DIFFERENT mount_ext-derived action types, for
    // the same extension, neither awaited before the other starts.
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'derived-probe-1', target: domainId, payload: {} } },
    });
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT_DERIVED, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'derived-probe-2', target: domainId, payload: {} } },
    });

    await Promise.all([firstFired, secondFired]);

    expect(mountSpy).toHaveBeenCalledTimes(1);
    expect(activatedSpy).toHaveBeenCalledTimes(1);
    expect(registry.getMountedExtensions(domainId)).toContain('ext-a');

    registry.dispose();
  });

  it('(h) overlapping unmounts of the same extension physically unmount once, and a mount requested meanwhile waits for that settlement', async () => {
    const plugin = createPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const domainId = 'domain-overlapping-unmounts';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));
    await mounter.mount('ext-a', document.createElement('div'));
    expect(activatedSpy).toHaveBeenCalledTimes(1);

    // Two overlapping unmounts of the SAME extension, neither awaited
    // before the next starts.
    const firstUnmount = mounter.unmount('ext-a');
    const secondUnmount = mounter.unmount('ext-a');
    expect((mounter as DefaultExtensionMounter).getUnmountInFlight('ext-a')).toBeDefined();

    // A mount_ext request arriving while both unmounts are in flight must
    // wait for that settlement rather than racing it.
    const mountFired = wireProbe(registry, domainId, 'overlap-unmount-mount-probe');
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'overlap-unmount-mount-probe', target: domainId, payload: {} } },
    });

    await Promise.all([firstUnmount, secondUnmount]);
    await mountFired;

    expect(registry.getMountedExtensions(domainId)).toContain('ext-a');
    expect(activatedSpy).toHaveBeenCalledTimes(2);

    registry.dispose();
  });

  it('(i) detach() racing a mount — the mount waits for detach\'s unmount of the same extension', async () => {
    const plugin = createPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const domainId = 'domain-detach-races-mount';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));
    await mounter.mount('ext-a', document.createElement('div'));
    expect(activatedSpy).toHaveBeenCalledTimes(1);

    // Not awaited: detach() is in flight, tracking ext-a's unmount, when the
    // mount_ext request below arrives.
    const detachPromise = mounter.detach();
    expect((mounter as DefaultExtensionMounter).getUnmountInFlight('ext-a')).toBeDefined();

    const mountFired = wireProbe(registry, domainId, 'detach-race-mount-probe');
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'detach-race-mount-probe', target: domainId, payload: {} } },
    });

    await detachPromise;
    // Re-attach so the fresh mount that was waiting on detach's unmount has
    // a root to append its container to.
    mounter.attach(document.createElement('div'));
    await mountFired;

    expect(registry.getMountedExtensions(domainId)).toContain('ext-a');
    expect(activatedSpy).toHaveBeenCalledTimes(2);

    registry.dispose();
  });

  it('(j) an explicit unmount of the sole occupant racing a fresh mount of a different extension in an Optional domain destroys the displaced occupant\'s container exactly once, and both actions succeed', async () => {
    const plugin = createPlugin();
    const domainId = 'domain-explicit-unmount-races-mount';
    const registry = freshRegistry(plugin);
    const factory = new OptionalDomainFactory(registry, domainId);
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    await registry.registerExtension(makeExtension('ext-b', domainId));
    registry.getMounter(domainId).attach(document.createElement('div'));

    // Pre-mount 'ext-a' as the sole occupant before the race below.
    await registry.getMounter(domainId).mount('ext-a', document.createElement('div'));
    expect(registry.getMountedExtensions(domainId)).toEqual(['ext-a']);

    // A destroy hook that throws on a SECOND release of the same
    // extension's container — a duplicate destroy fails this test rather
    // than passing silently.
    const destroyCallCounts = new Map<string, number>();
    factory.hooks.destroy = (extensionId: string): void => {
      const count = (destroyCallCounts.get(extensionId) ?? 0) + 1;
      destroyCallCounts.set(extensionId, count);
      if (count > 1) {
        throw new Error(`duplicate destroy release for '${extensionId}'`);
      }
    };

    const unmountFired = wireProbe(registry, domainId, 'explicit-unmount-probe');
    const mountFired = wireProbe(registry, domainId, 'race-mount-probe');

    // An explicit unmount_ext of the sole occupant ('ext-a') and a fresh
    // mount_ext of a DIFFERENT extension ('ext-b') — which itself displaces
    // 'ext-a' as part of its own strategy body — dispatched back to back,
    // neither awaited before the other starts.
    registry.executeActionsChain({
      action: { type: ACTION_UNMOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'explicit-unmount-probe', target: domainId, payload: {} } },
    });
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-b' } },
      next: { action: { type: 'race-mount-probe', target: domainId, payload: {} } },
    });

    await Promise.all([unmountFired, mountFired]);

    expect(registry.getMountedExtensions(domainId)).toEqual(['ext-b']);
    expect(destroyCallCounts.get('ext-a')).toBe(1);

    registry.dispose();
  });

  it('(k) an explicit unmount_ext of an extension joining a detach() already tearing it down destroys its container exactly once, and detach still completes', async () => {
    const plugin = createPlugin();
    const domainId = 'domain-explicit-unmount-races-detach';
    const registry = freshRegistry(plugin);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));
    await mounter.mount('ext-a', document.createElement('div'));
    expect(registry.getMountedExtensions(domainId)).toEqual(['ext-a']);

    // A destroy hook that throws on a SECOND release of the same
    // extension's container — a duplicate release fails this test rather
    // than passing silently. `detach()`'s own release call supplies no
    // destroy of its own (see `DefaultExtensionMounter.detach()`), so
    // exactly one call to this hook — the joining strategy's — is the only
    // correct outcome; zero calls, which would mean the joining call's
    // destroy was lost, must not happen either.
    const destroyCallCounts = new Map<string, number>();
    factory.hooks.destroy = (extensionId: string): void => {
      const count = (destroyCallCounts.get(extensionId) ?? 0) + 1;
      destroyCallCounts.set(extensionId, count);
      if (count > 1) {
        throw new Error(`duplicate destroy release for '${extensionId}'`);
      }
    };

    // Not awaited: detach() is in flight, already tracking 'ext-a's
    // release, when the explicit unmount_ext dispatch below arrives for the
    // SAME extension.
    const detachPromise = mounter.detach();

    const unmountFired = wireProbe(registry, domainId, 'race-detach-unmount-probe');
    registry.executeActionsChain({
      action: { type: ACTION_UNMOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'race-detach-unmount-probe', target: domainId, payload: {} } },
    });

    await Promise.all([detachPromise, unmountFired]);

    // The joining strategy call's real destroy ran exactly once — not lost
    // to detach()'s own destroy-less release call, and not duplicated.
    expect(destroyCallCounts.get('ext-a')).toBe(1);
    expect(registry.getMountedExtensions(domainId)).toEqual([]);

    registry.dispose();
  });

  it('(l) inst-um-await-mount-settle/inst-um-after-mount-success: an unmount_ext arriving while the SAME extension\'s mount is in progress waits for it, then unmounts it, leaving it absent', async () => {
    const plugin = createPlugin();
    const activatedSpy = vi.spyOn(plugin, 'resolveLifecycleStageActivatedId');
    const domainId = 'domain-unmount-awaits-inflight-mount';
    // The gate the extension's own lifecycle `mount` awaits — kept pending
    // (not resolved) until the test has dispatched BOTH the mount_ext and
    // the unmount_ext below, so the two genuinely overlap.
    const gate = createDeferred();
    const handler = new GatedMountHandler(ENTRY_ID, gate.promise);
    const registry = freshRegistry(plugin, handler);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));

    // Signals the moment the strategy's physical mount has genuinely
    // started (the coordinator's in-flight-mount entry for 'ext-a' is
    // published strictly BEFORE this call, inside `runFreshMount`) — an
    // explicit settlement signal derived from real code running, not a
    // sleep, a poll, or a bare microtask flush.
    const mountStarted = createDeferred();
    const originalCreate = factory.hooks.create.bind(factory.hooks);
    factory.hooks.create = (extensionId: string): Element => {
      const el = originalCreate(extensionId);
      mountStarted.resolve();
      return el;
    };

    const mountFired = wireProbe(registry, domainId, 'inflight-mount-next');
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'inflight-mount-next', target: domainId, payload: {} } },
    });

    // Wait until the mount is genuinely in progress (container created,
    // coordinator in-flight entry published) before dispatching the
    // unmount below — the whole point of this test is that both requests
    // genuinely overlap.
    await mountStarted.promise;

    const unmountFired = wireProbe(registry, domainId, 'inflight-mount-unmount-next');
    registry.executeActionsChain({
      action: { type: ACTION_UNMOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'inflight-mount-unmount-next', target: domainId, payload: {} } },
    });

    // Release the gate the mount's own lifecycle `mount` is awaiting —
    // scheduled strictly AFTER the unmount dispatch above accepted and
    // reserved its own execution, so the unmount's prologue observes the
    // mount as still in flight before this settles it.
    gate.resolve();

    await Promise.all([mountFired, unmountFired]);

    // Exactly one physical mount, then exactly one physical unmount and one
    // destroy.
    expect(factory.hooks.created).toEqual(['ext-a']);
    expect(handler.unmountCalls).toBe(1);
    expect(factory.hooks.destroyed).toEqual(['ext-a']);
    // activated fired once (for the underlying physical mount only).
    expect(activatedSpy).toHaveBeenCalledTimes(1);
    // 'ext-a' is absent from the mount set — both actions succeeded (both
    // `next` probes above fired, not a `fallback`), and the extension ends
    // up unmounted. The unmount correctly waits for the in-progress mount to
    // settle (inst-um-await-mount-settle) before proceeding.
    expect(registry.getMountedExtensions(domainId)).toEqual([]);

    registry.dispose();
  });

  it('(l) inst-um-after-mount-failure: an unmount_ext arriving while the SAME extension\'s mount is in progress, and that mount fails, completes without action and runs no additional destroy', async () => {
    const plugin = createPlugin();
    const domainId = 'domain-unmount-awaits-failed-inflight-mount';
    const gate = createDeferred();
    // `failAfterGate: true` — the lifecycle `mount` throws once the gate
    // opens, making the in-progress mount this unmount waits on fail
    // deterministically.
    const handler = new GatedMountHandler(ENTRY_ID, gate.promise, true);
    const registry = freshRegistry(plugin, handler);
    const factory = new ConcurrentDomainFactory();
    registry.registerDomain(makeDomain(domainId, true), factory);
    await registry.registerExtension(makeExtension('ext-a', domainId));
    const mounter = registry.getMounter(domainId);
    mounter.attach(document.createElement('div'));

    const mountStarted = createDeferred();
    const originalCreate = factory.hooks.create.bind(factory.hooks);
    factory.hooks.create = (extensionId: string): Element => {
      const el = originalCreate(extensionId);
      mountStarted.resolve();
      return el;
    };

    const mountFailedFallback = wireProbe(registry, domainId, 'inflight-failed-mount-fallback');
    registry.executeActionsChain({
      action: { type: ACTION_MOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      fallback: { action: { type: 'inflight-failed-mount-fallback', target: domainId, payload: {} } },
    });

    await mountStarted.promise;

    const unmountFired = wireProbe(registry, domainId, 'inflight-failed-mount-unmount-next');
    registry.executeActionsChain({
      action: { type: ACTION_UNMOUNT_EXT, target: domainId, payload: { subject: 'ext-a' } },
      next: { action: { type: 'inflight-failed-mount-unmount-next', target: domainId, payload: {} } },
    });

    gate.resolve();

    await Promise.all([mountFailedFallback, unmountFired]);

    // The failed mount's OWN catch block destroys the container it created
    // (`ConcurrentMountStrategy.mount`'s `catch`) — that single destroy is
    // expected. The unmount request must not run a SECOND one: it never
    // invokes the strategy's `unmount` body at all once it learns the mount
    // it was waiting on failed.
    expect(factory.hooks.created).toEqual(['ext-a']);
    expect(factory.hooks.destroyed).toEqual(['ext-a']);
    expect(handler.unmountCalls).toBe(0);
    expect(registry.getMountedExtensions(domainId)).toEqual([]);

    registry.dispose();
  });
});
