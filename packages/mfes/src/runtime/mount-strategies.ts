/**
 * Mount Strategy Implementations
 *
 * Three shipped concrete strategy classes that domain authors compose inside
 * their `ExtensionDomainImplementationFactory.build(ctx)` implementation.
 *
 * Selection guide:
 * - `ConcurrentMountStrategy` — multiple extensions mount simultaneously (e.g., widgets)
 * - `OptionalMountStrategy` — zero-or-one mount with explicit unmount (sidebar, popup, overlay)
 * - `ExclusiveMountStrategy` — pre-emptive single-mount, no explicit unmount (screen domain)
 *
 * @packageDocumentation
 */
// @cpt-FEATURE:cpt-frontx-feature-mfe-registry:p2
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2
// @cpt-dod:cpt-frontx-dod-extension-domain-governance-default-deny:p1

import { MountStrategy, type ActionPayload, type ContainerHooks } from './mount-strategy';
import type { ExtensionMounter } from './ExtensionMounter';
import type { MfeRegistry } from '../registry/MfeRegistry';

function createContainerCleanup(
  hooks: ContainerHooks,
  extensionId: string,
  container: Element,
  onReleased: (cleanup: () => void) => void
): () => void {
  let released = false;
  const cleanup = () => {
    if (released) {
      return;
    }
    released = true;
    try {
      hooks.destroy(extensionId, container);
    } finally {
      onReleased(cleanup);
    }
  };
  return cleanup;
}

/**
 * Append-mount semantics — multiple extensions may be mounted concurrently.
 *
 * Each mount appends a new container under the domain root. Each unmount
 * removes only the named extension. Suitable for widget-style domains where
 * multiple extensions coexist.
 *
 * Cardinality matrix: REQUIRES `mount_ext` AND `unmount_ext` in `declaration.actions`.
 */
export class ConcurrentMountStrategy extends MountStrategy {
  private readonly cleanupByExtension = new Map<string, () => void>();

  constructor(
    private readonly mounter: ExtensionMounter,
    private readonly hooks: ContainerHooks
  ) {
    super();
  }

  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-match-strategy
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-concurrent
  async mount(payload: ActionPayload): Promise<void> {
    const extensionId = payload.subject;
    const staleContainerRelease = this.mounter.getStaleContainerRelease(extensionId);
    if (staleContainerRelease) {
      await staleContainerRelease;
    }
    await this.coalesceMount(extensionId, async () => {
      const container = this.hooks.create(extensionId);
      const cleanup = createContainerCleanup(this.hooks, extensionId, container, (releasedCleanup) => {
        if (this.cleanupByExtension.get(extensionId) === releasedCleanup) {
          this.cleanupByExtension.delete(extensionId);
          this.releaseMount(extensionId);
        }
      });
      this.cleanupByExtension.set(extensionId, cleanup);
      try {
        await this.mounter.mount(extensionId, container, cleanup);
      } catch (error) {
        this.releaseContainer(extensionId, cleanup);
        throw error;
      }
      return true;
    });
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-return
    // (implicit return — mount completed)
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-return
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-concurrent
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-match-strategy

  override async unmount(payload: ActionPayload): Promise<void> {
    const cleanup = this.cleanupByExtension.get(payload.subject);
    try {
      await this.mounter.unmount(payload.subject);
    } finally {
      this.releaseContainer(payload.subject, cleanup);
    }
  }

  private releaseContainer(extensionId: string, cleanup = this.cleanupByExtension.get(extensionId)): void {
    cleanup?.();
    if (this.cleanupByExtension.get(extensionId) === cleanup) {
      this.cleanupByExtension.delete(extensionId);
      this.releaseMount(extensionId);
    }
  }
}

/**
 * Zero-or-one mount with explicit unmount support.
 *
 * Mounting while another extension is already mounted displaces the prior
 * extension before mounting the new one. Explicit unmount empties the slot.
 * Suitable for sidebar, popup, overlay domains.
 *
 * Reads the canonical mount-set from the registry
 * (`registry.getMountedExtensions(domainId)`) — the registry owns mount-set
 * state, not the mounter.
 *
 * Cardinality matrix: REQUIRES `mount_ext` AND `unmount_ext` in `declaration.actions`.
 */
export class OptionalMountStrategy extends MountStrategy {
  private readonly cleanupByExtension = new Map<string, () => void>();

  constructor(
    private readonly mounter: ExtensionMounter,
    private readonly hooks: ContainerHooks,
    private readonly registry: MfeRegistry,
    private readonly domainId: string
  ) {
    super();
  }

  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-optional-displace
  async mount(payload: ActionPayload): Promise<void> {
    const subject = payload.subject;
    const staleContainerRelease = this.mounter.getStaleContainerRelease(subject);
    if (staleContainerRelease) {
      await staleContainerRelease;
    }
    await this.coalesceMount(subject, async () => {
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-get-mounted
      let mounted = this.registry.getMountedExtensions(this.domainId);
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-get-mounted

      if (mounted.length === 1 && mounted[0] !== subject) {
        const previousExtensionId = mounted[0];
        const stalePreviousRelease = this.mounter.getStaleContainerRelease(previousExtensionId);
        if (stalePreviousRelease) {
          await stalePreviousRelease;
          mounted = this.registry.getMountedExtensions(this.domainId);
        }
        if (mounted.length === 1 && mounted[0] !== subject) {
          const cleanup = this.cleanupByExtension.get(previousExtensionId);
          try {
            await this.mounter.unmount(previousExtensionId);
          } finally {
            this.releaseContainer(previousExtensionId, cleanup);
          }
          mounted = this.registry.getMountedExtensions(this.domainId);
        }
      }

      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-optional-idempotent
      if (mounted.includes(subject)) {
        return false;
      }
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-optional-idempotent

      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-optional-mount
      const container = this.hooks.create(subject);
      const cleanup = createContainerCleanup(this.hooks, subject, container, (releasedCleanup) => {
        if (this.cleanupByExtension.get(subject) === releasedCleanup) {
          this.cleanupByExtension.delete(subject);
          this.releaseMount(subject);
        }
      });
      this.cleanupByExtension.set(subject, cleanup);
      try {
        await this.mounter.mount(subject, container, cleanup);
      } catch (error) {
        this.releaseContainer(subject, cleanup);
        throw error;
      }
      return true;
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-optional-mount
    });
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-optional-displace

  override async unmount(payload: ActionPayload): Promise<void> {
    const subject = payload.subject;
    const mounted = this.registry.getMountedExtensions(this.domainId);

    if (!mounted.includes(subject)) {
      return;
    }

    const cleanup = this.cleanupByExtension.get(subject);
    try {
      await this.mounter.unmount(subject);
    } finally {
      this.releaseContainer(subject, cleanup);
    }
  }

  private releaseContainer(extensionId: string, cleanup = this.cleanupByExtension.get(extensionId)): void {
    cleanup?.();
    if (this.cleanupByExtension.get(extensionId) === cleanup) {
      this.cleanupByExtension.delete(extensionId);
      this.releaseMount(extensionId);
    }
  }
}

/**
 * Pre-emptive single-mount with no public unmount path.
 *
 * Mounting always evicts any other extension currently mounted in the domain
 * before mounting the new one. No `unmount` action is declared on the domain;
 * `ExclusiveMountStrategy` does NOT implement the optional `unmount` method.
 *
 * The strict cardinality matrix in
 * `cpt-frontx-algo-mfe-registry-cross-validate-handlers` rejects any
 * domain backed by this strategy that lists `unmount_ext` in
 * `declaration.actions`.
 *
 * Suitable for screen-domain-style use cases where exactly one extension is
 * ever active and navigation triggers a swap.
 *
 * Cardinality matrix: REQUIRES `mount_ext`, FORBIDS `unmount_ext` in `declaration.actions`.
 */
export class ExclusiveMountStrategy extends MountStrategy {
  private readonly cleanupByExtension = new Map<string, () => void>();

  constructor(
    private readonly mounter: ExtensionMounter,
    private readonly hooks: ContainerHooks,
    private readonly registry: MfeRegistry,
    private readonly domainId: string
  ) {
    super();
  }

  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-exclusive-evict
  async mount(payload: ActionPayload): Promise<void> {
    const subject = payload.subject;
    const staleContainerRelease = this.mounter.getStaleContainerRelease(subject);
    if (staleContainerRelease) {
      await staleContainerRelease;
    }
    await this.coalesceMount(subject, async () => {
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-get-mounted
      let mounted = this.registry.getMountedExtensions(this.domainId);
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-get-mounted

      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-exclusive-idempotent
      if (mounted.length === 1 && mounted[0] === subject) {
        return false;
      }
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-exclusive-idempotent

      for (const siblingId of mounted) {
        if (siblingId !== subject) {
          const staleSiblingRelease = this.mounter.getStaleContainerRelease(siblingId);
          if (staleSiblingRelease) {
            await staleSiblingRelease;
            mounted = this.registry.getMountedExtensions(this.domainId);
          }
          if (!mounted.includes(siblingId)) {
            continue;
          }
          const cleanup = this.cleanupByExtension.get(siblingId);
          try {
            await this.mounter.unmount(siblingId);
          } finally {
            this.releaseContainer(siblingId, cleanup);
          }
        }
      }
      mounted = this.registry.getMountedExtensions(this.domainId);
      if (mounted.length === 1 && mounted[0] === subject) {
        return false;
      }

      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-exclusive-mount
      const container = this.hooks.create(subject);
      const cleanup = createContainerCleanup(this.hooks, subject, container, (releasedCleanup) => {
        if (this.cleanupByExtension.get(subject) === releasedCleanup) {
          this.cleanupByExtension.delete(subject);
          this.releaseMount(subject);
        }
      });
      this.cleanupByExtension.set(subject, cleanup);
      try {
        await this.mounter.mount(subject, container, cleanup);
      } catch (error) {
        this.releaseContainer(subject, cleanup);
        throw error;
      }
      return true;
    });
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-exclusive-mount
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-exclusive-evict

  // ExclusiveMountStrategy intentionally does NOT implement the optional
  // `unmount` method declared on the MountStrategy base class. Eviction
  // happens only as a side effect of mounting a different extension.

  private releaseContainer(extensionId: string, cleanup = this.cleanupByExtension.get(extensionId)): void {
    cleanup?.();
    if (this.cleanupByExtension.get(extensionId) === cleanup) {
      this.cleanupByExtension.delete(extensionId);
      this.releaseMount(extensionId);
    }
  }
}
