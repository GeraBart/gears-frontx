import { describe, it, expect } from 'vitest';
import { ConcurrentMountStrategy } from '../ConcurrentMountStrategy';
import { ExtensionMounter } from '../ExtensionMounter';
import { DefaultExtensionMounter } from '../DefaultExtensionMounter';
import { MountManager } from '../MountManager';
import { ExtensionReleaserProvider } from '../ExtensionReleaserProvider';
import { makePayload } from './helpers/make-payload';
import { FakeContainerHooks } from './helpers/FakeContainerHooks';
import { mountedIn } from './helpers/mounted-in';
import { strategyDomain } from './helpers/strategy-domain';
import type { ParentMfeBridge } from '../../handler/ParentMfeBridge';

// ─── Exactly-once release for overlapping strategy releases ────────────────

describe('ExtensionReleaserProvider.for(mounter).release() — exactly-once for overlapping strategy releases of one extension', () => {
  it('two overlapping OptionalMountStrategy.unmount() calls for the same extension physically unmount once and destroy its container exactly once', async () => {
    const d = await strategyDomain('optional', 'old-sig-optional-domain', ['ext-a']);
    try {
      await d.strategy.mount(makePayload('ext-a'));

      d.handler.holdUnmount('ext-a');
      const first = d.strategy.unmount!(makePayload('ext-a'));
      const second = d.strategy.unmount!(makePayload('ext-a'));
      await d.handler.unmountStarted('ext-a');
      d.handler.releaseUnmount('ext-a');
      await Promise.all([first, second]);

      expect(d.handler.events.filter((e) => e === 'unmount-entered:ext-a')).toHaveLength(1);
      expect(d.hooks.destroyed).toEqual(['ext-a']);
      expect(mountedIn(d.registry, 'old-sig-optional-domain')).toEqual([]);
    } finally {
      await d.registry.dispose();
    }
  });

  it('two concurrent ExclusiveMountStrategy mounts of different extensions that each evict the same prior sibling physically unmount it once and destroy its container exactly once', async () => {
    const d = await strategyDomain('exclusive', 'old-sig-exclusive-domain', ['ext-a', 'ext-b', 'ext-c']);
    try {
      await d.strategy.mount(makePayload('ext-a'));

      d.handler.holdUnmount('ext-a');
      const first = d.strategy.mount(makePayload('ext-b'));
      const second = d.strategy.mount(makePayload('ext-c'));
      await d.handler.unmountStarted('ext-a');
      d.handler.releaseUnmount('ext-a');
      await Promise.all([first, second]);

      expect(d.handler.events.filter((e) => e === 'unmount-entered:ext-a')).toHaveLength(1);
      expect(d.hooks.destroyed).toEqual(['ext-a']);
    } finally {
      await d.registry.dispose();
    }
  });
});

// ─── release() publishes its in-flight entry before invoking unmount() ─────

/**
 * A mounter whose `unmount()` synchronously calls back into
 * `release()` for the SAME extension id, in its own synchronous
 * prefix — the window a `deactivated` lifecycle callback reached from
 * inside a physical unmount could reach back into the mounter through.
 */
class SyncReentrantFakeMounter extends ExtensionMounter {
  readonly unmountCalls: string[] = [];
  reentrantRelease: Promise<void> | undefined;
  onUnmount: ((extensionId: string) => void) | undefined;

  attach(_root: Element): void {}
  async detach(): Promise<void> {}
  async mount(_extensionId: string, _container: Element): Promise<void> {}

  async unmount(extensionId: string): Promise<void> {
    this.unmountCalls.push(extensionId);
    this.onUnmount?.(extensionId);
  }
}

/** A mounter whose `unmount()` throws synchronously instead of returning a rejected promise. */
class SyncThrowingUnmountMounter extends ExtensionMounter {
  unmountCallCount = 0;

  attach(_root: Element): void {}
  async detach(): Promise<void> {}
  async mount(_extensionId: string, _container: Element): Promise<void> {}

  unmount(_extensionId: string): Promise<void> {
    this.unmountCallCount += 1;
    throw new Error('sync unmount failure');
  }
}

describe('release() — in-flight entry published before unmount() is invoked', () => {
  it('a synchronous re-entrant release() call for the SAME extension id, made from inside unmount(), joins the one physical unmount and the registered destroy runs exactly once', async () => {
    const mounter = new SyncReentrantFakeMounter();
    const destroyedBy: string[] = [];
    const destroyA = (): void => { destroyedBy.push('A'); };

    mounter.onUnmount = (extensionId) => {
      mounter.reentrantRelease = ExtensionReleaserProvider.for(mounter).release(extensionId);
    };

    ExtensionReleaserProvider.for(mounter).registerDestroy('ext-1', destroyA);
    const first = ExtensionReleaserProvider.for(mounter).release('ext-1');
    await Promise.all([first, mounter.reentrantRelease]);

    expect(mounter.unmountCalls).toEqual(['ext-1']);
    expect(destroyedBy).toEqual(['A']);
  });

  it('a synchronously throwing unmount() rejects release(), and a later release() call for the same extension starts a fresh physical unmount', async () => {
    const mounter = new SyncThrowingUnmountMounter();

    await expect(ExtensionReleaserProvider.for(mounter).release('ext-1')).rejects.toThrow('sync unmount failure');
    expect(mounter.unmountCallCount).toBe(1);

    await expect(ExtensionReleaserProvider.for(mounter).release('ext-1')).rejects.toThrow('sync unmount failure');
    expect(mounter.unmountCallCount).toBe(2);
  });
});

// ─── inst-sd-destroy-container: destroy registered at mount runs on detach ─

/**
 * Minimal `MountManager` fake — mount/unmount are no-ops beyond recording,
 * so these tests exercise `DefaultExtensionMounter`'s real `mount`/`detach`
 * wiring together with a real strategy and real `ExtensionReleaser`.
 */
class FakeMountManagerForReleaser extends MountManager {
  async loadExtension(_extensionId: string): Promise<void> {}
  async preloadExtension(_extensionId: string): Promise<void> {}

  async mountExtension(extensionId: string, _container: Element): Promise<ParentMfeBridge> {
    return { instanceId: extensionId, dispose: () => {} };
  }

  async unmountExtension(_extensionId: string): Promise<void> {}

  releaseExtension(_extensionId: string): void {}

  setTheme(_cssVars: Record<string, string>): void {}
}

function makeDefaultMounterFixture(domainId: string) {
  const mountSet: string[] = [];
  const addMountedExtension = (_d: string, extensionId: string): void => {
    mountSet.push(extensionId);
  };
  const removeMountedExtension = (_d: string, extensionId: string): void => {
    const idx = mountSet.indexOf(extensionId);
    if (idx >= 0) {
      mountSet.splice(idx, 1);
    }
  };
  const getMountedExtensions = (_d: string): readonly string[] => mountSet;

  const mountManager = new FakeMountManagerForReleaser();
  const mounter = new DefaultExtensionMounter(
    domainId,
    mountManager,
    addMountedExtension,
    removeMountedExtension,
    getMountedExtensions
  );

  return { mounter, mountSet, getMountedExtensions };
}

describe('inst-sd-destroy-container: a slot detach runs the destroy registered for every occupant at its own mount', () => {
  it('DefaultExtensionMounter.detach() destroys the container of every extension mounted through ConcurrentMountStrategy', async () => {
    const DOMAIN = 'sd-destroy-domain';
    const { mounter, getMountedExtensions } = makeDefaultMounterFixture(DOMAIN);
    const hooks = new FakeContainerHooks();
    const strategy = new ConcurrentMountStrategy(mounter, hooks);

    const root = document.createElement('div');
    mounter.attach(root);

    await strategy.mount(makePayload('ext-a'));
    await strategy.mount(makePayload('ext-b'));

    await mounter.detach();

    expect(hooks.destroyed).toEqual(['ext-a', 'ext-b']);
    expect(getMountedExtensions(DOMAIN)).toEqual([]);
  });
});

// ─── inst-um-failure-container-destroyed: destroy still runs on a rejected unmount ─

/** A mounter whose `unmount()` always rejects. */
class RejectingUnmountMounter extends ExtensionMounter {
  attach(_root: Element): void {}
  async detach(): Promise<void> {}
  async mount(_extensionId: string, _container: Element): Promise<void> {}

  async unmount(_extensionId: string): Promise<void> {
    throw new Error('lifecycle unmount failed');
  }
}

describe('inst-um-failure-container-destroyed: the registered destroy still runs when unmount() rejects, and the unmount error stays primary', () => {
  it('ConcurrentMountStrategy.unmount() rejects with the unmount error, but the container is still destroyed', async () => {
    const mounter = new RejectingUnmountMounter();
    const hooks = new FakeContainerHooks();
    const strategy = new ConcurrentMountStrategy(mounter, hooks);

    await strategy.mount(makePayload('ext-a'));

    await expect(strategy.unmount!(makePayload('ext-a'))).rejects.toThrow('lifecycle unmount failed');
    expect(hooks.destroyed).toEqual(['ext-a']);
  });

  it('a registered destroy that itself throws during a rejected unmount does not override the unmount error', async () => {
    const mounter = new RejectingUnmountMounter();
    const releaser = ExtensionReleaserProvider.for(mounter);
    releaser.registerDestroy('ext-z', () => {
      throw new Error('destroy blew up');
    });

    await expect(releaser.release('ext-z')).rejects.toThrow('lifecycle unmount failed');
  });
});
