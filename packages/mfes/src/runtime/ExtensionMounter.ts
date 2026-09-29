/**
 * ExtensionMounter - Abstract per-domain mount facade
 *
 * The per-domain mount facade. One instance is constructed by the registry for
 * each registered domain and exposed to the domain implementation through
 * `DomainContext.mounter`. The React slot accesses the mounter via
 * `registry.getMounter(domainId)` to call `attach`/`detach`.
 *
 * The mounter does NOT own mount-set state — the registry does. The mounter
 * does NOT expose `getMounted()`; strategies and consumers read mount-set
 * state via `registry.getMountedExtensions(domainId)`.
 *
 * @packageDocumentation
 */
// @cpt-FEATURE:cpt-frontx-feature-mfe-registry:p2

/**
 * Abstract per-domain mount facade.
 *
 * Encapsulates root attachment, per-extension mount/unmount, and mass-unmount
 * on detach. Strategies capture this instance privately at construction time;
 * the captured reference survives `DomainContext` invalidation because it is
 * stored directly on the strategy's class field, not accessed through `ctx`.
 *
 * The React `ExtensionDomainSlot` component calls:
 * - `attach(element)` from its ref-attach callback
 * - `detach()` from its ref-detach / cleanup callback
 */
export abstract class ExtensionMounter {
  /**
   * Register `root` as the DOM root under which the mounter places per-extension
   * containers. Called by `ExtensionDomainSlot` from its ref-attach callback.
   *
   * Idempotent when called with the same root. Replaces the prior root when
   * called with a different element — subsequent `mount` calls target the new root.
   *
   * @param root - The host DOM element that serves as the mount root for this domain.
   */
  abstract attach(root: Element): void;

  /**
   * Release the attached root and mass-unmount every currently-mounted extension
   * in the domain.
   *
   * Attempts `mounter.unmount(extId)` for every extension in the registry's
   * mount-set, so cleanup of one failed extension cannot prevent cleanup of
   * its siblings. After detach, the mounter has no root; subsequent `mount`
   * calls will throw until `attach` is called again. A single teardown error is
   * rethrown unchanged; multiple failures are reported as one error with an
   * `errors` array containing every teardown failure. A mount already in
   * flight when detach begins is fenced from attaching to this root and
   * compensates its own guest lifecycle; `detach()` does not wait for that
   * compensation.
   *
   * Called by `ExtensionDomainSlot` from its cleanup callback.
   */
  abstract detach(): Promise<void>;

  /**
   * Append `container` under the attached root and update the registry's
   * mount-set to include `extensionId`. `onTeardown`, when supplied, is
   * registered for this exact container and must run exactly once when its
   * mount fails or when the mounter releases it through `unmount()` or
   * `detach()`. This lets domain-owned `ContainerHooks` clean up resources
   * without giving the mounter knowledge of their implementation.
   * Shipped strategies coalesce overlapping mounts for one extension before
   * creating a container. A custom strategy that permits overlapping mounts
   * of the same extension must use identity-aware cleanup; a legacy hook keyed
   * only by extension ID cannot distinguish the rejected container safely.
   *
   * The parameter remains optional only for source compatibility with legacy
   * custom mounters. A custom mounter used with a strategy that supplies it
   * must honour this cleanup contract on every teardown path, including slot
   * detach; otherwise that custom mounter owns the resulting resource cleanup.
   *
   * @param extensionId - ID of the extension being mounted.
   * @param container - Unattached host element provided by `ContainerHooks.create`.
   * @param onTeardown - Domain-owned cleanup for this exact container.
   * @throws Error if no root has been attached via `attach()`.
   */
  abstract mount(extensionId: string, container: Element, onTeardown?: () => void): Promise<void>;

  /**
   * Wait until an older root epoch has finished releasing an extension's
   * container. Shipped strategies call this before `ContainerHooks.create()`
   * so legacy hooks keyed only by extension id cannot have fresh state removed
   * by stale cleanup. A custom mounter that supports root replacement should
   * override this method with its own equivalent barrier; the default no-op is
   * suitable only when it has no stale-root lifecycle state.
   */
  getStaleContainerRelease(_extensionId: string): Promise<void> | undefined {
    return undefined;
  }

  /**
   * Detach the per-extension container from the attached root and update
   * the registry's mount-set to remove `extensionId`.
   *
   * @param extensionId - ID of the extension being unmounted.
   */
  abstract unmount(extensionId: string): Promise<void>;
}
