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
import { describe, it, expect } from 'vitest';
import { DefaultMfeRegistry } from '../../src/runtime/DefaultMfeRegistry';
import type { DefaultMountManager } from '../../src/runtime/default-mount-manager';
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

  it('leaves no stale entry in the in-flight-load map when the handler throws synchronously before its first await', async () => {
    // Promise `.finally()` callbacks are always scheduled as a microtask
    // continuation, which is strictly ordered after the synchronous code that
    // attaches them, regardless of whether the underlying promise is already
    // settled (e.g., from a synchronous throw). The code constructs the async
    // IIFE's promise and chains `.finally()` to it on one line, then calls
    // `.set()` on the very next line. Since the `.finally()` callback is
    // guaranteed to be scheduled as a microtask strictly after this
    // synchronous code completes, the `.set()` call always finishes before
    // the `.delete()` inside `.finally()` ever runs -- even if the IIFE's
    // body throws synchronously on its very first tick. This guarantees no
    // stale entry is left in the map.
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    const failure = new Error('synchronous failure before first await');

    class SyncThrowHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      // Intentionally NOT an `async` method: this throws synchronously, so
      // no `await` is ever reached by the caller of `load()`.
      load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        throw failure;
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SyncThrowHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mountManager = (registry as unknown as { mountManager: DefaultMountManager }).mountManager;

    await expect(mountManager.loadExtension(EXT)).rejects.toBe(failure);

    const inFlight = (
      mountManager as unknown as { inFlightLoadsByExtension: Map<string, Promise<void>> }
    ).inFlightLoadsByExtension;
    expect(inFlight.has(EXT)).toBe(false);
  });

  it('rejects every concurrent loadExtension caller from the same failed attempt and leaves no stale in-flight entry behind', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let loadCallCount = 0;
    let resolveLoad!: () => void;
    let rejectLoad!: (error: unknown) => void;

    class FlakyThenSuccessfulHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        loadCallCount += 1;
        const attempt = loadCallCount;
        if (attempt === 1) {
          return new Promise<MfeEntryLifecycle<ChildMfeBridge>>((_resolve, reject) => {
            rejectLoad = reject;
          });
        }
        return new Promise<MfeEntryLifecycle<ChildMfeBridge>>((resolve) => {
          resolveLoad = () => resolve({ mount: () => {}, unmount: () => {} });
        });
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new FlakyThenSuccessfulHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    const mountA = mounter.mount(EXT, document.createElement('div'));
    const mountB = mounter.mount(EXT, document.createElement('div'));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failure = new Error('first load attempt failed');
    rejectLoad(failure);

    const [resultA, resultB] = await Promise.allSettled([mountA, mountB]);
    expect(resultA.status).toBe('rejected');
    expect(resultB.status).toBe('rejected');
    expect(loadCallCount).toBe(1);

    const raceTimeout = Symbol('timeout');
    const mountC = mounter.mount(EXT, document.createElement('div'));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCallCount).toBe(2);

    resolveLoad();
    const outcome = await Promise.race([
      mountC.then(() => 'resolved' as const),
      new Promise((resolve) => setTimeout(() => resolve(raceTimeout), 50)),
    ]);
    expect(outcome).toBe('resolved');
  });
});

describe('DefaultMountManager.mountExtension concurrency', () => {
  it('calls the extension lifecycle mount() exactly once when two mounts race for the same never-mounted extension', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let mountCallCount = 0;

    class CountingMountHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        return {
          mount: () => {
            mountCallCount += 1;
          },
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new CountingMountHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    const mountA = mounter.mount(EXT, document.createElement('div'));
    const mountB = mounter.mount(EXT, document.createElement('div'));

    await Promise.all([mountA, mountB]);

    expect(mountCallCount).toBe(1);
  });
});

describe('DefaultExtensionMounter.mount concurrency', () => {
  it('appends exactly one container under the attached root when two mounts race for the same never-mounted extension', async () => {
    // Reproduces the double-click-on-a-sidebar-item regression: the mount
    // strategy's idempotence guard reads `registry.getMountedExtensions`,
    // which is only updated by `addMountedExtension` AFTER a mount's `await`
    // resolves -- so a second concurrent `mount()` call for the same
    // extension (each with its OWN freshly-`hooks.create()`-d container, as a
    // real strategy would supply) races in before that update lands. Before
    // the fix, `DefaultExtensionMounter.mount()` unconditionally appended
    // whichever container ITS OWN call was holding and overwrote the
    // `containers` bookkeeping with it once `mountManager.mountExtension`
    // resolved -- for the second caller that clobbers the record of the
    // first (real, rendered) container, permanently orphaning it in the DOM.
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let resolveMount!: () => void;
    const mountGate = new Promise<void>((resolve) => {
      resolveMount = resolve;
    });

    class SlowMountHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        return {
          mount: async () => {
            // Block long enough for both concurrent `mount()` calls to reach
            // `DefaultExtensionMounter.mount()`'s append/bookkeeping step
            // before either resolves.
            await mountGate;
          },
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SlowMountHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    const root = document.createElement('div');
    mounter.attach(root);

    const containerA = document.createElement('div');
    containerA.dataset.marker = 'A';
    const containerB = document.createElement('div');
    containerB.dataset.marker = 'B';

    const mountA = mounter.mount(EXT, containerA);
    // Give the first call a turn to reach the strategy-equivalent point
    // (registered as `mounting` in the manager) before firing the second.
    await Promise.resolve();
    const mountB = mounter.mount(EXT, containerB);

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveMount();

    await Promise.all([mountA, mountB]);

    // Exactly one container was ever appended under the root -- the other
    // was discarded before ever reaching the DOM.
    expect(root.children.length).toBe(1);
    expect(root.contains(containerA)).toBe(true);
    expect(root.contains(containerB)).toBe(false);

    // The mounter's own container bookkeeping still points at the container
    // that actually got appended, not the discarded one.
    const containers = (
      mounter as unknown as { containers: Map<string, Element> }
    ).containers;
    expect(containers.get(EXT)).toBe(containerA);
  });
});
