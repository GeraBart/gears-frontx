/**
 * DefaultExtensionMounter - Concrete per-domain mount facade
 *
 * Composes `MountManager` (MFE load/mount/unmount primitives) and an
 * `ExtensionManager` reference (for mount-set bookkeeping) to implement the
 * per-domain `ExtensionMounter` contract.
 *
 * One instance is constructed by the registry per registered domain inside
 * `registerDomain` and exposed to the domain implementation via
 * `DomainContext.mounter`. The React `ExtensionDomainSlot` accesses this
 * instance via `registry.getMounter(domainId)`.
 *
 * @packageDocumentation
 * @internal
 */

import { ExtensionMounter } from './ExtensionMounter';
import type { MountManager } from './mount-manager';

type NativeAggregateError = Error & { errors: Iterable<unknown> };

const NativeAggregateError = (globalThis as unknown as {
  AggregateError: new (errors: Iterable<unknown>, message?: string) => NativeAggregateError;
}).AggregateError;

function createTeardownFailuresError(failures: readonly unknown[]): NativeAggregateError {
  return new NativeAggregateError(
    failures,
    `ExtensionMounter.detach: ${failures.length} extension teardowns failed`
  );
}

/**
 * @internal
 */
export class DefaultExtensionMounter extends ExtensionMounter {
  private attachedRoot: Element | null = null;
  private lifecycleEpoch = 0;

  // Tracks the per-extension containers and their domain-owned cleanup so the
  // mounter can release both its DOM and strategy-owned resources on every
  // teardown path, including slot detach.
  private readonly containers = new Map<string, {
    container: Element;
    onTeardown: () => void;
    epoch: number;
  }>();

  /**
   * The in-flight `mount()` call for an extension currently being mounted,
   * keyed by extension id, together with the container that call was given.
   * A second concurrent `mount()` call for the same extension id and epoch
   * awaits the first only when it has the same container. A request from a
   * later root epoch waits for the stale mount's compensation, then starts
   * with its own container.
   *
   * `container` is never supplied by an external caller or action payload —
   * every mount strategy creates it internally via `this.hooks.create(extensionId)`
   * before calling `mounter.mount(extensionId, container)`. So a second
   * concurrent call for the same extension id with a DIFFERENT container can
   * only mean a bug in the calling strategy's own internal state management
   * (e.g. it created a container twice for what it thought were two mounts
   * of the same extension). That remains an internal-invariant violation —
   * see the hard invariant check in `mount()` below.
   */
  private readonly inFlightMountsByExtension = new Map<
    string,
    { promise: Promise<void>; container: Element; epoch: number }
  >();

  // A detach can begin teardown without awaiting it (as React slot cleanup
  // does). A later root must not mount the same extension until that old
  // teardown has released its own container and mount-set record.
  private readonly inFlightUnmountsByExtension = new Map<string, Promise<void>>();

  constructor(
    private readonly domainId: string,
    private readonly mountManager: MountManager,
    private readonly addMountedExtension: (domainId: string, extensionId: string) => void,
    private readonly removeMountedExtension: (domainId: string, extensionId: string) => void,
    private readonly getMountedExtensions: (domainId: string) => readonly string[]
  ) {
    super();
  }

  attach(root: Element): void {
    if (this.attachedRoot === root) {
      return;
    }

    this.attachedRoot = root;
    this.lifecycleEpoch += 1;
  }

  async detach(): Promise<void> {
    // Fence every in-flight mount before taking the snapshot below. A mount
    // continuation resumes after its loader promise and reads `attachedRoot`
    // before it appends its container or records mount-set state; clearing the
    // root synchronously makes that continuation fail instead of becoming an
    // occupant that this detach did not see.
    this.attachedRoot = null;
    this.lifecycleEpoch += 1;

    // Mass-unmount every currently-mounted extension so the registry and
    // any framework slice stay consistent.
    const mounted = Array.from(this.getMountedExtensions(this.domainId));
    const containersAtDetachStart = new Map(
      mounted.map((extensionId) => [extensionId, this.containers.get(extensionId)])
    );
    const failures: unknown[] = [];
    for (const extensionId of mounted) {
      const mountedContainer = containersAtDetachStart.get(extensionId);
      if (mountedContainer && this.containers.get(extensionId) !== mountedContainer) {
        continue;
      }
      try {
        await this.unmount(extensionId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw createTeardownFailuresError(failures);
    }
  }

  override getStaleContainerRelease(extensionId: string): Promise<void> | undefined {
    const inFlightUnmount = this.inFlightUnmountsByExtension.get(extensionId);
    if (inFlightUnmount) {
      return inFlightUnmount.catch(() => undefined);
    }

    const inFlightMount = this.inFlightMountsByExtension.get(extensionId);
    if (inFlightMount && inFlightMount.epoch !== this.lifecycleEpoch) {
      return inFlightMount.promise.catch(() => undefined);
    }

    const mountedContainer = this.containers.get(extensionId);
    if (mountedContainer && mountedContainer.epoch !== this.lifecycleEpoch) {
      return this.unmount(extensionId).catch(() => undefined);
    }

    return undefined;
  }

  async mount(extensionId: string, container: Element, onTeardown: () => void = () => {}): Promise<void> {
    if (!this.attachedRoot) {
      this.releaseFailedMount(onTeardown);
      throw new Error(
        `ExtensionMounter.mount: no root attached for domain '${this.domainId}'. ` +
        'Call attach(element) before mounting extensions.'
      );
    }
    const mountEpoch = this.lifecycleEpoch;

    const inFlightUnmount = this.inFlightUnmountsByExtension.get(extensionId);
    if (inFlightUnmount) {
      await inFlightUnmount.catch(() => undefined);
      return this.mount(extensionId, container, onTeardown);
    }

    const inFlight = this.inFlightMountsByExtension.get(extensionId);
    if (inFlight) {
      if (inFlight.epoch !== mountEpoch) {
        // React may detach a slot fire-and-forget, attach a replacement root,
        // and have URL observation request the same extension before the old
        // lifecycle settles. The old epoch owns a different container and
        // must compensate first; then this epoch may mount its own container.
        // Its stale error is meaningful only to the old request, not this one.
        await inFlight.promise.catch(() => undefined);
        return this.mount(extensionId, container, onTeardown);
      }

      if (inFlight.container !== container) {
        // Impossible in correct code: no caller of `mount()` ever supplies a
        // container from outside this mounter's own strategy — it is always
        // freshly created via `hooks.create(extensionId)` immediately before
        // this call. Two different containers for the same extension id
        // while a mount is in flight means the calling strategy's own state
        // tracking is broken (e.g. it invoked `mount()` twice for what it
        // believed were two distinct mounts of the same extension). This is
        // a hard internal-invariant violation, not a race to handle
        // gracefully. Its just-created container still receives teardown.
        this.releaseFailedMount(onTeardown);
        throw new Error(
          `ExtensionMounter.mount: internal invariant violated for extension ` +
          `'${extensionId}' in domain '${this.domainId}' — a mount is already ` +
          'in flight for this extension with a DIFFERENT container. This ' +
          'indicates a bug in the calling mount strategy, not a legitimate ' +
          'concurrent-mount scenario.'
        );
      }
      return inFlight.promise;
    }

    const mountedContainer = this.containers.get(extensionId);
    if (mountedContainer && mountedContainer.epoch !== mountEpoch) {
      await this.unmount(extensionId).catch(() => undefined);
      return this.mount(extensionId, container, onTeardown);
    }

    const mountWork = (async (): Promise<void> => {
      let lifecycleMounted = false;
      let lifecycleCompensated = false;
      let appended = false;
      let mountSetRegistrationAttempted = false;
      try {
        await this.mountManager.mountExtension(extensionId, container);
        lifecycleMounted = true;

        // Append the container under the attached root and record it.
        // Capture the root after the await completes and check it explicitly,
        // since a concurrent detach() call could have cleared it during the await.
        const root = this.attachedRoot;
        if (!root || this.lifecycleEpoch !== mountEpoch) {
          // `mountExtension()` has already activated the lifecycle and recorded
          // its own mounted state. Compensate before rejecting this stale host
          // lifecycle, otherwise a later mount would receive that cached bridge
          // without invoking the lifecycle again. The detached-lifecycle error
          // stays primary even if compensation itself rejects.
          let compensationError: unknown;
          let hasCompensationError = false;
          try {
            await this.mountManager.unmountExtension(extensionId);
          } catch (error) {
            compensationError = error;
            hasCompensationError = true;
          } finally {
            lifecycleCompensated = true;
          }
          const detachedRootError = new Error(
            `ExtensionMounter.mount: domain '${this.domainId}' root was detached ` +
            `during mounting of extension '${extensionId}'. The domain's root element ` +
            'must remain attached for the entire duration of the mount operation.'
          );
          if (hasCompensationError) {
            (detachedRootError as Error & { cause?: unknown }).cause = compensationError;
          }
          throw detachedRootError;
        }

        root.appendChild(container);
        appended = true;
        this.containers.set(extensionId, { container, onTeardown, epoch: mountEpoch });

        mountSetRegistrationAttempted = true;
        this.addMountedExtension(this.domainId, extensionId);
      } catch (error) {
        const mountedContainer = this.containers.get(extensionId);
        if (mountedContainer?.container === container) {
          this.containers.delete(extensionId);
        }
        if (appended && container.parentNode) {
          container.parentNode.removeChild(container);
        }
        if (mountSetRegistrationAttempted) {
          try {
            this.removeMountedExtension(this.domainId, extensionId);
          } catch {
            // The original mount failure stays primary.
          }
        }
        if (lifecycleMounted && !lifecycleCompensated) {
          try {
            await this.mountManager.unmountExtension(extensionId);
          } catch {
            // The original mount failure stays primary.
          }
        }
        this.releaseFailedMount(onTeardown);
        throw error;
      }
    })();

    const trackedMount = mountWork.finally(() => {
      if (this.inFlightMountsByExtension.get(extensionId)?.promise === trackedMount) {
        this.inFlightMountsByExtension.delete(extensionId);
      }
    });
    this.inFlightMountsByExtension.set(extensionId, {
      promise: trackedMount,
      container,
      epoch: mountEpoch,
    });
    return trackedMount;
  }

  async unmount(extensionId: string): Promise<void> {
    const inFlightUnmount = this.inFlightUnmountsByExtension.get(extensionId);
    if (inFlightUnmount) {
      return inFlightUnmount;
    }

    const inFlightMount = this.inFlightMountsByExtension.get(extensionId);
    if (inFlightMount) {
      await inFlightMount.promise.catch(() => undefined);
      return this.unmount(extensionId);
    }

    // Capture the exact record before awaiting the lower lifecycle. A new root
    // waits on this teardown barrier, and this cleanup must never touch a
    // record from a later mount epoch.
    const mountedContainer = this.containers.get(extensionId);
    const unmountWork = (async (): Promise<void> => {
      let lifecycleError: unknown;
      let hasLifecycleError = false;
      try {
        await this.mountManager.unmountExtension(extensionId);
      } catch (error) {
        lifecycleError = error;
        hasLifecycleError = true;
      } finally {
        // A failed extension teardown cannot leave this host's mount-set stale:
        // the caller may destroy its root immediately and later remount the
        // extension into a fresh host. Preserve the lifecycle error while
        // always releasing the local container and registry bookkeeping.
        if (mountedContainer?.container.parentNode) {
          mountedContainer.container.parentNode.removeChild(mountedContainer.container);
        }

        if (this.containers.get(extensionId) === mountedContainer) {
          this.containers.delete(extensionId);
          this.removeMountedExtension(this.domainId, extensionId);
        }

        try {
          mountedContainer?.onTeardown();
        } catch (error) {
          if (!hasLifecycleError) {
            lifecycleError = error;
            hasLifecycleError = true;
          }
        }
      }

      if (hasLifecycleError) {
        throw lifecycleError;
      }
    })();
    const trackedUnmount = unmountWork.finally(() => {
      if (this.inFlightUnmountsByExtension.get(extensionId) === trackedUnmount) {
        this.inFlightUnmountsByExtension.delete(extensionId);
      }
    });
    this.inFlightUnmountsByExtension.set(extensionId, trackedUnmount);
    return trackedUnmount;
  }

  private releaseFailedMount(onTeardown: () => void): void {
    try {
      onTeardown();
    } catch {
      // A lifecycle failure remains primary. Hook cleanup errors are surfaced
      // only when teardown had no lifecycle error (see unmount()).
    }
  }
}
