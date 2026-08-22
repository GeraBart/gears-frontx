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
import type { ContainerHooks } from './mount-strategy';

/**
 * @internal
 */
export class DefaultExtensionMounter extends ExtensionMounter {
  private attachedRoot: Element | null = null;

  // Tracks the per-extension containers so detach can remove them from root.
  private readonly containers = new Map<string, Element>();

  /**
   * The in-flight `mount()` promise for an extension currently being mounted,
   * keyed by extension id. A second concurrent `mount()` call for the same
   * extension id awaits the first's promise instead of running the mount
   * pipeline (and appending a second, duplicate container) a second time.
   */
  private readonly inFlightMountsByExtension = new Map<string, Promise<void>>();

  constructor(
    private readonly domainId: string,
    private readonly mountManager: MountManager,
    private readonly addMountedExtension: (domainId: string, extensionId: string) => void,
    private readonly removeMountedExtension: (domainId: string, extensionId: string) => void,
    private readonly getMountedExtensions: (domainId: string) => readonly string[],
    // hooks is used in detach() to destroy containers for each extension
    private readonly hooks: ContainerHooks
  ) {
    super();
  }

  attach(root: Element): void {
    this.attachedRoot = root;
  }

  async detach(): Promise<void> {
    // Mass-unmount every currently-mounted extension so the registry and
    // any framework slice stay consistent.
    const mounted = Array.from(this.getMountedExtensions(this.domainId));
    for (const extId of mounted) {
      await this.mountManager.unmountExtension(extId);
      this.hooks.destroy(extId);
      this.containers.delete(extId);
    }
    this.attachedRoot = null;
  }

  async mount(extensionId: string, container: Element): Promise<void> {
    if (!this.attachedRoot) {
      throw new Error(
        `ExtensionMounter.mount: no root attached for domain '${this.domainId}'. ` +
        'Call attach(element) before mounting extensions.'
      );
    }

    const inFlight = this.inFlightMountsByExtension.get(extensionId);
    if (inFlight) {
      return inFlight;
    }

    const mountWork = (async (): Promise<void> => {
      await this.mountManager.mountExtension(extensionId, container);

      // Append the container under the attached root and record it.
      // Capture the root after the await completes and check it explicitly,
      // since a concurrent detach() call could have cleared it during the await.
      const root = this.attachedRoot;
      if (!root) {
        throw new Error(
          `ExtensionMounter.mount: domain '${this.domainId}' root was detached ` +
          `during mounting of extension '${extensionId}'. The domain's root element ` +
          'must remain attached for the entire duration of the mount operation.'
        );
      }

      root.appendChild(container);
      this.containers.set(extensionId, container);

      this.addMountedExtension(this.domainId, extensionId);
    })();

    this.inFlightMountsByExtension.set(extensionId, mountWork);
    try {
      await mountWork;
    } finally {
      this.inFlightMountsByExtension.delete(extensionId);
    }
  }

  async unmount(extensionId: string): Promise<void> {
    await this.mountManager.unmountExtension(extensionId);

    // Remove the container from the attached root if still present.
    const container = this.containers.get(extensionId);
    if (container && this.attachedRoot) {
      if (this.attachedRoot.contains(container)) {
        this.attachedRoot.removeChild(container);
      }
    }
    this.containers.delete(extensionId);

    this.removeMountedExtension(this.domainId, extensionId);
  }
}
