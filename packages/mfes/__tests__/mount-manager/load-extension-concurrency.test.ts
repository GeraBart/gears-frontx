/**
 * `DefaultMountManager.loadExtension` concurrency.
 *
 * Two concurrent mounts of the same never-mounted extension both observe
 * `mountState !== 'mounted'` and both call `loadExtension` before either has
 * finished loading (`default-mount-manager.ts`'s own `mountExtension`, line
 * ~200, awaits `loadExtension` unconditionally when `loadState !== 'loaded'`
 * -- it is not serialized the way the public `load_ext` action is via
 * `OperationSerializer`). Before the fix, the second concurrent caller's
 * `loadExtension` call returned immediately on seeing `loadState ===
 * 'loading'`, instead of awaiting the in-flight load -- letting the second
 * `mountExtension` proceed to mount before the handler's `load()` had
 * actually cached a lifecycle, which could throw "loadExtension should have
 * cached the lifecycle" or otherwise observe a half-loaded extension.
 *
 * Domain/action ids here are a mock notation, never the real GTS strings --
 * MFES-1 forbids `@gears-frontx/mfes` from carrying a type-format literal.
 */
import { describe, it, expect, vi } from 'vitest';
import { DefaultMfeRegistry } from '../../src/runtime/DefaultMfeRegistry';
import type { TypeSystemPlugin } from '../../src/type-substrate';
import type { Extension, ExtensionDomain, MfeEntry } from '../../src/types';
import { MfeHandler, ChildMfeBridge, type MfeEntryLifecycle } from '../../src/handler/types';
import { MfeBridgeFactoryDefault } from '../../src/handler/mfe-bridge-factory-default';
import { ExtensionDomainImplementation } from '../../src/runtime/ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../../src/runtime/ExtensionDomainImplementationFactory';
import type { DomainContext } from '../../src/runtime/DomainContext';
import { ConcurrentMountStrategy } from '../../src/runtime/mount-strategies';
import type { ContainerHooks, ActionPayload } from '../../src/runtime/mount-strategy';
import { ActionHandler } from '../../src/mediator/types';

const LOAD_EXT = 'mock.action.v1~load_ext.v1~';
const MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const DOMAIN = 'domain.host.v1';
const EXT = 'ext.slow-load.v1';
const ENTRY = 'entry.slow-load.v1';

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

class NoopHooks implements ContainerHooks {
  create(_extensionId: string): Element {
    return document.createElement('div');
  }
  destroy(_extensionId: string): void {}
}

function makeDomain(id: string): ExtensionDomain {
  return {
    id,
    actions: [LOAD_EXT, MOUNT_EXT, UNMOUNT_EXT],
    extensionsActions: [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
    extensionsTypeId: '',
  } as unknown as ExtensionDomain;
}

class GenericDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext) {
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
  }

  protected getMountStrategies() {
    return [this.strategy];
  }
}

class GenericDomainFactory extends ExtensionDomainImplementationFactory {
  build(ctx: DomainContext): GenericDomainImpl {
    return new GenericDomainImpl(ctx);
  }
}

function makeExtension(id: string, domain: string, entry: string): Extension {
  return { id, domain, entry, lifecycle: [] } as Extension;
}

function makeEntry(id: string): MfeEntry {
  return { id, requiredProperties: [], actions: [], domainActions: [] };
}

describe('DefaultMountManager.loadExtension concurrency', () => {
  it('calls the handler load() exactly once when two mounts race for the same never-mounted extension', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let loadCallCount = 0;
    let resolveLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    class SlowLoadHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        loadCallCount += 1;
        // Block here until the test explicitly releases it, so both
        // concurrent `mountExtension` calls are guaranteed to observe
        // `loadState === 'loading'` before either finishes.
        await loadGate;
        return {
          mount: () => {},
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SlowLoadHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    // Fire two concurrent mounts of the SAME extension before releasing the
    // load gate -- both must see the extension as not-yet-loaded and call
    // into `loadExtension`.
    const mountA = mounter.mount(EXT, document.createElement('div'));
    const mountB = mounter.mount(EXT, document.createElement('div'));

    // Give both calls a microtask/macrotask turn to reach `loadExtension`
    // and observe `loadState` before the handler's `load()` settles.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    resolveLoad();

    await expect(Promise.all([mountA, mountB])).resolves.toBeDefined();

    expect(loadCallCount).toBe(1);
  });

  it('resolves the second concurrent caller only after the load actually completes, with no premature resolution', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let loaded = false;
    let resolveLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    class SlowLoadHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        await loadGate;
        loaded = true;
        return {
          mount: () => {},
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SlowLoadHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    const mountA = mounter.mount(EXT, document.createElement('div'));
    await Promise.resolve();

    const secondCallerObservedLoadedBeforeSettling = { value: false };
    const mountB = mounter.mount(EXT, document.createElement('div')).then(() => {
      secondCallerObservedLoadedBeforeSettling.value = loaded;
    });

    // Neither mount may settle while the load gate is still closed.
    let settledEarly = false;
    void Promise.all([mountA, mountB]).then(() => {
      settledEarly = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settledEarly).toBe(false);

    resolveLoad();
    await Promise.all([mountA, mountB]);

    expect(secondCallerObservedLoadedBeforeSettling.value).toBe(true);
  });
});
