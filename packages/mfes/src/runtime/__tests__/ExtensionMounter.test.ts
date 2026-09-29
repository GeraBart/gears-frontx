import { describe, it, expect, vi } from 'vitest';
import { DefaultExtensionMounter } from '../DefaultExtensionMounter';
import { ExtensionMounter } from '../ExtensionMounter';
import { MountManager } from '../mount-manager';
import { ConcurrentMountStrategy } from '../mount-strategies';
import type { ActionPayload, ContainerHooks } from '../mount-strategy';
import type { ParentMfeBridge } from '../../handler/types';

// ─── Fakes ───────────────────────────────────────────────────────────────────

class FakeMountManager extends MountManager {
  readonly mountCalls: Array<{ extensionId: string; container: Element }> = [];
  readonly unmountCalls: string[] = [];
  unmountError: Error | undefined;
  readonly unmountErrors = new Map<string, Error>();

  async loadExtension(_extensionId: string): Promise<void> {}
  async preloadExtension(_extensionId: string): Promise<void> {}

  async mountExtension(extensionId: string, container: Element): Promise<ParentMfeBridge> {
    this.mountCalls.push({ extensionId, container });
    return { instanceId: extensionId, dispose: () => {} };
  }

  async unmountExtension(extensionId: string): Promise<void> {
    this.unmountCalls.push(extensionId);
    const error = this.unmountErrors.get(extensionId) ?? this.unmountError;
    if (error) {
      throw error;
    }
  }

  releaseExtension(_extensionId: string): void {}

  setTheme(_cssVars: Record<string, string>): void {}
}

class TrackingContainerHooks implements ContainerHooks {
  readonly created = new Map<string, Element>();
  readonly destroyed: Array<{ extensionId: string; container: Element | undefined }> = [];

  create(extensionId: string): Element {
    const container = document.createElement('div');
    this.created.set(extensionId, container);
    return container;
  }

  destroy(extensionId: string, container?: Element): void {
    this.destroyed.push({ extensionId, container });
    if (!container || this.created.get(extensionId) === container) {
      this.created.delete(extensionId);
    }
  }
}

/** A pre-container-identity hook implementation kept compatible by the API. */
class IdKeyedContainerHooks implements ContainerHooks {
  readonly created = new Map<string, Element>();

  create(extensionId: string): Element {
    const container = document.createElement('div');
    this.created.set(extensionId, container);
    return container;
  }

  destroy(extensionId: string): void {
    this.created.delete(extensionId);
  }
}

function payload(subject: string): ActionPayload {
  return { subject };
}

// ─── Helper factory ───────────────────────────────────────────────────────────

function makeFixture(overrides?: { mountManager?: MountManager }) {
  const DOMAIN = 'test-domain';
  const mountManager = overrides?.mountManager ?? new FakeMountManager();
  const mounted: string[] = [];
  const addMountedExtension = vi.fn((domainId: string, extensionId: string) => {
    if (domainId === DOMAIN) mounted.push(extensionId);
  });
  const removeMountedExtension = vi.fn((domainId: string, extensionId: string) => {
    if (domainId !== DOMAIN) return;
    const index = mounted.indexOf(extensionId);
    if (index !== -1) mounted.splice(index, 1);
  });
  const getMountedExtensions = (_domainId: string): readonly string[] => mounted;
  const mounter = new DefaultExtensionMounter(
    DOMAIN,
    mountManager,
    addMountedExtension,
    removeMountedExtension,
    getMountedExtensions
  );

  const root = document.createElement('div');
  document.body.appendChild(root);

  return { DOMAIN, mounter, mountManager, addMountedExtension, removeMountedExtension, mounted, root };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DefaultExtensionMounter', () => {
  describe('mount', () => {
    it('appends container under attached root and calls addMountedExtension callback', async () => {
      const { mounter, DOMAIN, root, addMountedExtension } = makeFixture();
      mounter.attach(root);

      const container = document.createElement('div');
      // Use a mount manager that uses the supplied container
      await mounter.mount('ext-1', container);

      expect(root.contains(container)).toBe(true);
      expect(addMountedExtension).toHaveBeenCalledWith(DOMAIN, 'ext-1');
    });

    it('throws when no root attached', async () => {
      const { mounter } = makeFixture();
      // Deliberately NOT calling attach

      await expect(mounter.mount('ext-1', document.createElement('div')))
        .rejects.toThrow(/no root attached/);
    });

    it('rolls back DOM, bookkeeping, and guest lifecycle when mount-set registration fails', async () => {
      const mountManager = new FakeMountManager();
      const registrationError = new Error('mount-set update failed');
      const removeMountedExtension = vi.fn();
      const mounter = new DefaultExtensionMounter(
        'test-domain',
        mountManager,
        () => {
          throw registrationError;
        },
        removeMountedExtension,
        () => []
      );
      const root = document.createElement('div');
      const container = document.createElement('div');
      mounter.attach(root);

      await expect(mounter.mount('ext-1', container)).rejects.toBe(registrationError);

      expect(root.contains(container)).toBe(false);
      expect(removeMountedExtension).toHaveBeenCalledWith('test-domain', 'ext-1');
      expect(mountManager.unmountCalls).toEqual(['ext-1']);
    });
  });

  describe('unmount', () => {
    it('removes container from root and calls removeMountedExtension', async () => {
      const { mounter, DOMAIN, root, removeMountedExtension } = makeFixture();
      mounter.attach(root);
      const container = document.createElement('div');
      await mounter.mount('ext-1', container);

      await mounter.unmount('ext-1');

      expect(root.contains(container)).toBe(false);
      expect(removeMountedExtension).toHaveBeenCalledWith(DOMAIN, 'ext-1');
    });

    it('idempotent: unmounting unknown id does not throw', async () => {
      const { mounter, root } = makeFixture();
      mounter.attach(root);

      await expect(mounter.unmount('non-existent')).resolves.not.toThrow();
    });

    it('clears the container and mount-set when extension teardown rejects', async () => {
      const mountManager = new FakeMountManager();
      const { mounter, DOMAIN, root, removeMountedExtension, mounted } = makeFixture({ mountManager });
      mounter.attach(root);
      const container = document.createElement('div');
      await mounter.mount('ext-1', container);
      const unmountError = new Error('extension teardown failed');
      mountManager.unmountError = unmountError;

      await expect(mounter.unmount('ext-1')).rejects.toBe(unmountError);

      expect(root.contains(container)).toBe(false);
      expect(removeMountedExtension).toHaveBeenCalledWith(DOMAIN, 'ext-1');
      expect(mounted).toEqual([]);

      const remountContainer = document.createElement('div');
      await expect(mounter.mount('ext-1', remountContainer)).resolves.not.toThrow();
      expect(root.contains(remountContainer)).toBe(true);
      expect(mounted).toEqual(['ext-1']);
    });

    it('waits for an in-flight mount before tearing the extension down', async () => {
      const { mounter, root, mounted, mountManager } = makeFixture();
      mounter.attach(root);
      const container = document.createElement('div');

      const mounting = mounter.mount('ext-1', container);
      const unmounting = mounter.unmount('ext-1');

      await expect(mounting).resolves.toBeUndefined();
      await expect(unmounting).resolves.toBeUndefined();
      expect(root.contains(container)).toBe(false);
      expect(mounted).toEqual([]);
      expect((mountManager as FakeMountManager).unmountCalls).toEqual(['ext-1']);
    });
  });

  describe('detach', () => {
    it('mass-unmounts every currently-mounted extension', async () => {
      const mountManager = new FakeMountManager();
      const DOMAIN = 'det-domain';
      const mounted = ['ext-a', 'ext-b'];
      const getMountedExtensions = (_domainId: string): readonly string[] => [...mounted];
      const addMountedExtension = vi.fn();
      const removeMountedExtension = vi.fn();
      const mounter = new DefaultExtensionMounter(
        DOMAIN,
        mountManager,
        addMountedExtension,
        removeMountedExtension,
        getMountedExtensions
      );
      const root = document.createElement('div');
      mounter.attach(root);

      await mounter.detach();

      // Both extensions were passed to mountManager.unmountExtension
      expect(mountManager.unmountCalls).toContain('ext-a');
      expect(mountManager.unmountCalls).toContain('ext-b');
    });

    it('tears down occupants in mount-set order while still completing every teardown', async () => {
      class SequentialUnmountManager extends FakeMountManager {
        private releaseFirstUnmount: (() => void) | undefined;
        private readonly firstUnmountGate = new Promise<void>((resolve) => {
          this.releaseFirstUnmount = resolve;
        });
        private signalFirstUnmount: (() => void) | undefined;
        readonly firstUnmountStarted = new Promise<void>((resolve) => {
          this.signalFirstUnmount = resolve;
        });

        override async unmountExtension(extensionId: string): Promise<void> {
          this.unmountCalls.push(extensionId);
          if (extensionId === 'ext-a') {
            this.signalFirstUnmount?.();
            await this.firstUnmountGate;
          }
        }

        finishFirstUnmount(): void {
          this.releaseFirstUnmount?.();
        }
      }

      const mountManager = new SequentialUnmountManager();
      const { mounter, root } = makeFixture({ mountManager });
      mounter.attach(root);
      await mounter.mount('ext-a', document.createElement('div'));
      await mounter.mount('ext-b', document.createElement('div'));

      const detaching = mounter.detach();
      await mountManager.firstUnmountStarted;
      expect(mountManager.unmountCalls).toEqual(['ext-a']);

      mountManager.finishFirstUnmount();
      await expect(detaching).resolves.toBeUndefined();
      expect(mountManager.unmountCalls).toEqual(['ext-a', 'ext-b']);
    });

    it('allows a later occupant to remount while an earlier detach teardown is pending', async () => {
      class DeferredFirstUnmountManager extends FakeMountManager {
        private releaseFirstUnmount: (() => void) | undefined;
        private readonly firstUnmountGate = new Promise<void>((resolve) => {
          this.releaseFirstUnmount = resolve;
        });
        private signalFirstUnmount: (() => void) | undefined;
        readonly firstUnmountStarted = new Promise<void>((resolve) => {
          this.signalFirstUnmount = resolve;
        });

        override async unmountExtension(extensionId: string): Promise<void> {
          this.unmountCalls.push(extensionId);
          if (extensionId === 'ext-a') {
            this.signalFirstUnmount?.();
            await this.firstUnmountGate;
          }
        }

        finishFirstUnmount(): void {
          this.releaseFirstUnmount?.();
        }
      }

      const mountManager = new DeferredFirstUnmountManager();
      const { mounter, root: oldRoot, mounted } = makeFixture({ mountManager });
      const hooks = new TrackingContainerHooks();
      const strategy = new ConcurrentMountStrategy(mounter, hooks);
      mounter.attach(oldRoot);
      await strategy.mount(payload('ext-a'));
      await strategy.mount(payload('ext-b'));

      const detaching = mounter.detach();
      await mountManager.firstUnmountStarted;
      const freshRoot = document.createElement('div');
      mounter.attach(freshRoot);
      await strategy.mount(payload('ext-b'));

      mountManager.finishFirstUnmount();
      await expect(detaching).resolves.toBeUndefined();

      const freshContainer = hooks.created.get('ext-b');
      expect(freshContainer).toBeDefined();
      expect(freshRoot.contains(freshContainer!)).toBe(true);
      expect(mounted).toEqual(['ext-b']);
    });

    it('can attach again with a fresh root after detach', async () => {
      const { mounter } = makeFixture();
      const root1 = document.createElement('div');
      mounter.attach(root1);
      await mounter.detach();

      const root2 = document.createElement('div');
      // Should not throw
      mounter.attach(root2);

      // mount after re-attach should succeed
      await expect(mounter.mount('ext-x', document.createElement('div'))).resolves.not.toThrow();
    });

    it('fences an immediate detach before a fulfilled mount continuation can append an occupant', async () => {
      const { mounter, root, mounted, mountManager } = makeFixture();
      mounter.attach(root);
      const container = document.createElement('div');

      const mounting = mounter.mount('ext-1', container);
      const detaching = mounter.detach();

      await expect(detaching).resolves.toBeUndefined();
      await expect(mounting).rejects.toThrow(/root was detached during mounting/);
      expect(root.contains(container)).toBe(false);
      expect(mounted).toEqual([]);
      expect((mountManager as FakeMountManager).unmountCalls).toEqual(['ext-1']);
    });

    it('does not migrate an in-flight mount into a root attached after detach', async () => {
      const { mounter, root, mounted } = makeFixture();
      mounter.attach(root);
      const container = document.createElement('div');

      const mounting = mounter.mount('ext-1', container);
      const detaching = mounter.detach();
      const replacementRoot = document.createElement('div');
      mounter.attach(replacementRoot);

      await expect(detaching).resolves.toBeUndefined();
      await expect(mounting).rejects.toThrow(/root was detached during mounting/);
      expect(root.contains(container)).toBe(false);
      expect(replacementRoot.contains(container)).toBe(false);
      expect(mounted).toEqual([]);
    });

    it('preserves a stale-mount compensation failure as the detached error cause', async () => {
      const { mounter, root, mountManager } = makeFixture();
      const compensationError = new Error('compensation failed');
      mounter.attach(root);
      (mountManager as FakeMountManager).unmountError = compensationError;

      const mounting = mounter.mount('ext-1', document.createElement('div'));
      const detaching = mounter.detach();

      await expect(detaching).resolves.toBeUndefined();
      await expect(mounting).rejects.toMatchObject({
        message: expect.stringMatching(/root was detached during mounting/),
        cause: compensationError,
      });
    });

    it('attempts every occupant and clears bookkeeping when one teardown rejects', async () => {
      const mountManager = new FakeMountManager();
      const { mounter, root, mounted } = makeFixture({ mountManager });
      mounter.attach(root);
      const containerA = document.createElement('div');
      const containerB = document.createElement('div');
      await mounter.mount('ext-a', containerA);
      await mounter.mount('ext-b', containerB);
      const unmountError = new Error('extension teardown failed');
      mountManager.unmountErrors.set('ext-a', unmountError);

      await expect(mounter.detach()).rejects.toBe(unmountError);

      expect(mountManager.unmountCalls).toEqual(expect.arrayContaining(['ext-a', 'ext-b']));
      expect(root.contains(containerA)).toBe(false);
      expect(root.contains(containerB)).toBe(false);
      expect(mounted).toEqual([]);
      await expect(mounter.mount('ext-c', document.createElement('div'))).rejects.toThrow(/no root attached/);
    });

    it('releases strategy-owned container state during slot-style detach while preserving the lifecycle error', async () => {
      const mountManager = new FakeMountManager();
      const { mounter, root } = makeFixture({ mountManager });
      const hooks = new TrackingContainerHooks();
      const strategy = new ConcurrentMountStrategy(mounter, hooks);
      mounter.attach(root);
      await strategy.mount(payload('ext-1'));
      const container = hooks.created.get('ext-1');
      const lifecycleError = new Error('extension teardown failed');
      mountManager.unmountError = lifecycleError;

      await expect(mounter.detach()).rejects.toBe(lifecycleError);

      expect(hooks.destroyed).toEqual([
        { extensionId: 'ext-1', container },
      ]);
      expect(hooks.created).toEqual(new Map());
      expect((strategy as unknown as { cleanupByExtension: Map<string, () => void> }).cleanupByExtension)
        .toEqual(new Map());
    });

    it('does not let a delayed detach teardown remove a container remounted into a new root', async () => {
      class DeferredUnmountManager extends FakeMountManager {
        private releaseUnmount: (() => void) | undefined;
        private readonly unmountGate = new Promise<void>((resolve) => {
          this.releaseUnmount = resolve;
        });
        private signalUnmountStarted: (() => void) | undefined;
        readonly unmountStarted = new Promise<void>((resolve) => {
          this.signalUnmountStarted = resolve;
        });

        override async unmountExtension(extensionId: string): Promise<void> {
          this.unmountCalls.push(extensionId);
          this.signalUnmountStarted?.();
          await this.unmountGate;
        }

        finishUnmount(): void {
          this.releaseUnmount?.();
        }
      }

      const mountManager = new DeferredUnmountManager();
      const { mounter, root: oldRoot, mounted } = makeFixture({ mountManager });
      mounter.attach(oldRoot);
      const oldContainer = document.createElement('div');
      await mounter.mount('ext-1', oldContainer);

      const detaching = mounter.detach();
      await mountManager.unmountStarted;
      const freshRoot = document.createElement('div');
      mounter.attach(freshRoot);
      const freshContainer = document.createElement('div');
      const remounting = mounter.mount('ext-1', freshContainer);

      mountManager.finishUnmount();
      await expect(detaching).resolves.toBeUndefined();
      await expect(remounting).resolves.toBeUndefined();

      expect(oldRoot.contains(oldContainer)).toBe(false);
      expect(freshRoot.contains(freshContainer)).toBe(true);
      expect(mounted).toEqual(['ext-1']);
    });
  });

  describe('in-flight mount dedup keyed on (extensionId, container)', () => {
    /** Mount manager whose `mountExtension` doesn't resolve until `release()` is called. */
    class DeferredMountManager extends MountManager {
      mountCallCount = 0;
      private release: (() => void) | undefined;
      private readonly gate = new Promise<void>((resolve) => {
        this.release = resolve;
      });

      async loadExtension(_extensionId: string): Promise<void> {}
      async preloadExtension(_extensionId: string): Promise<void> {}

      async mountExtension(extensionId: string, _container: Element): Promise<ParentMfeBridge> {
        this.mountCallCount += 1;
        await this.gate;
        return { instanceId: extensionId, dispose: () => {} };
      }

      async unmountExtension(_extensionId: string): Promise<void> {}
      releaseExtension(_extensionId: string): void {}
      setTheme(_cssVars: Record<string, string>): void {}

      settle(): void {
        this.release?.();
      }
    }

    it('same container: two overlapping mount() calls share the one in-flight mount', async () => {
      const mountManager = new DeferredMountManager();
      const { mounter, root } = makeFixture({ mountManager });
      mounter.attach(root);

      const container = document.createElement('div');
      const first = mounter.mount('ext-1', container);
      const second = mounter.mount('ext-1', container);

      mountManager.settle();
      await expect(first).resolves.not.toThrow();
      await expect(second).resolves.not.toThrow();

      expect(mountManager.mountCallCount).toBe(1);
    });

    it('different containers: the second overlapping mount() call throws a hard invariant error', async () => {
      const mountManager = new DeferredMountManager();
      const { mounter, root } = makeFixture({ mountManager });
      mounter.attach(root);

      const containerA = document.createElement('div');
      const containerB = document.createElement('div');
      const first = mounter.mount('ext-1', containerA);

      await expect(mounter.mount('ext-1', containerB)).rejects.toThrow(/ext-1/);

      mountManager.settle();
      await expect(first).resolves.not.toThrow();
    });

    it('waits for stale cleanup before creating a replacement hook resource', async () => {
      const mountManager = new DeferredMountManager();
      const { mounter, root: oldRoot, mounted } = makeFixture({ mountManager });
      const hooks = new IdKeyedContainerHooks();
      const strategy = new ConcurrentMountStrategy(mounter, hooks);
      mounter.attach(oldRoot);

      const staleMount = strategy.mount(payload('ext-1'));
      void mounter.detach();
      const freshRoot = document.createElement('div');
      mounter.attach(freshRoot);
      const freshMount = strategy.mount(payload('ext-1'));

      mountManager.settle();

      await expect(staleMount).rejects.toThrow(/root was detached during mounting/);
      await expect(freshMount).resolves.toBeUndefined();
      expect(mountManager.mountCallCount).toBe(2);
      const freshContainer = hooks.created.get('ext-1');
      expect(freshContainer).toBeDefined();
      expect(freshRoot.contains(freshContainer!)).toBe(true);
      expect(mounted).toEqual(['ext-1']);
    });
  });

  describe('abstract contract', () => {
    it('getMounted is not exposed on the ExtensionMounter abstract class', () => {
      const { mounter } = makeFixture();
      // The abstract base ExtensionMounter defines only attach, detach, mount, unmount.
      const base = mounter as ExtensionMounter;
      expect('getMounted' in base).toBe(false);
    });
  });
});
