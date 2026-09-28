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
   * The settlement of a release this base class itself started for an
   * extension id, together with the callback that lets a call joining that
   * SAME release before it settles contribute its own `destroy` — used by
   * `release()` below. Kept on the base class (not `DefaultExtensionMounter`
   * or any other subclass) so the exactly-once guarantee it provides holds
   * for ANY concrete `unmount()` implementation, including a third-party
   * one that does no coalescing of its own.
   */
  private readonly releasesInFlightByExtension = new Map<
    string,
    { readonly promise: Promise<void>; readonly setDestroy: (destroy: () => void) => void }
  >();

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

  /**
   * Unmount `extensionId` via `unmount()` above and then invoke `destroy`
   * exactly once — coalescing every concurrent `release()` call for the
   * SAME extension id onto ONE shared "unmount then destroy once"
   * operation, so an explicit unmount and a strategy's own eviction or
   * displacement of the same extension that overlap release its container
   * exactly once between them, whichever supplies a `destroy`.
   *
   * Every shipped mount strategy and `DefaultExtensionMounter.detach()`'s
   * own mass-release call this instead of `unmount()` directly, so the
   * guarantee holds independent of which concrete `unmount()`
   * implementation is plugged in — it is provided here, once, on the base
   * class, never re-implemented per subclass.
   *
   * A call joining an already-in-flight release (whether it was started by
   * another call WITH a `destroy` or WITHOUT one — `detach()`'s own
   * mass-release supplies none, deliberately, so it never claims the
   * destroy slot ahead of a genuine one) contributes its own `destroy` if
   * none has been chosen yet. Once one caller's `destroy` is chosen it is
   * never replaced, so it — and only it — runs exactly once, when the
   * shared physical `unmount()` settles.
   *
   * @param extensionId - ID of the extension being released.
   * @param destroy - This caller's container-release callback for
   *   `extensionId`, if it has one. Optional so a caller with no
   *   container-level cleanup of its own (`detach()`) can still join or
   *   start the shared release without claiming the destroy slot.
   */
  release(extensionId: string, destroy?: () => void): Promise<void> {
    const existing = this.releasesInFlightByExtension.get(extensionId);
    if (existing) {
      if (destroy) {
        existing.setDestroy(destroy);
      }
      return existing.promise;
    }

    let chosenDestroy: (() => void) | undefined = destroy;
    const setDestroy = (candidate: () => void): void => {
      if (!chosenDestroy) {
        chosenDestroy = candidate;
      }
    };

    let settleWork!: () => void;
    let rejectWork!: (error: unknown) => void;
    const work = new Promise<void>((resolve, reject) => {
      settleWork = resolve;
      rejectWork = reject;
    });

    this.releasesInFlightByExtension.set(extensionId, { promise: work, setDestroy });
    // Identity-checked cleanup: remove only THIS call's own entry — and,
    // critically, do so BEFORE `work` settles for its callers below, so a
    // caller's own rejection (or fulfillment) handler that immediately
    // retries `release` for the SAME extension id synchronously never joins
    // this now-settled entry; it finds the map already cleared and starts
    // fresh instead.
    const cleanup = (): void => {
      if (this.releasesInFlightByExtension.get(extensionId)?.promise === work) {
        this.releasesInFlightByExtension.delete(extensionId);
      }
    };

    // The entry above is published BEFORE `unmount` is invoked, so a call
    // that re-enters `release` for the SAME extension id synchronously
    // (from `unmount`'s own synchronous prefix, e.g. a lifecycle callback
    // that calls back into this mounter before `unmount` itself resolves)
    // finds the entry already in flight and joins it instead of starting a
    // second physical unmount. A synchronous throw from `unmount` is caught
    // here and turned into a rejection of the published entry, instead of
    // throwing out of this call and leaving a joiner waiting forever.
    //
    // `chosenDestroy`, `cleanup`, and settlement all run inside the SAME
    // fulfillment reaction to `unmount`'s promise — not split across two
    // chained `.then()` calls — so there is no microtask gap in which a
    // joiner arriving between reading `chosenDestroy` and running
    // `cleanup`/settlement could still install a `destroy` that this
    // reaction has already finished reading and will never call again.
    // A throw from `chosenDestroy` is caught here and routed through the
    // SAME `cleanup()` then `rejectWork()` path as a failing `unmount`,
    // instead of landing on a further, unguarded `.then()`.
    try {
      this.unmount(extensionId).then(
        () => {
          try {
            chosenDestroy?.();
            cleanup();
            settleWork();
          } catch (error) {
            cleanup();
            rejectWork(error);
          }
        },
        (error) => {
          cleanup();
          rejectWork(error);
        }
      );
    } catch (error) {
      cleanup();
      rejectWork(error);
    }

    return work;
  }
}
