import { ActionHandler } from '../mediator/ActionHandler';
import { DomainOccupancyCoordinator } from './DomainOccupancyCoordinator';

/**
 * Decorates a domain's collected `unmount_ext` handler so its occupancy
 * mutation is ordered on the SAME per-domain coordinator a fresh mount's own
 * eviction is ordered on
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-no-rerun-eviction`: "Occupancy mutations within a domain are
 * ordered..." applies to an explicit `unmount_ext` dispatch exactly as it
 * does to a fresh mount's own eviction — both read and mutate the same
 * domain-wide mount set). Without this, an explicit unmount of extension A
 * and a fresh mount of a different extension B that displaces/evicts A
 * could run their strategy bodies concurrently, each acting on a mount set
 * neither observed the other mutate.
 *
 * In a domain built WITHOUT `serializeAcrossExtensions` (Concurrent — no
 * strategy ever evicts a sibling), `coordinator.runOrderedMutation`
 * degrades to invoking `inner` immediately, so decorating every domain's
 * `unmount_ext` handler uniformly here changes nothing for Concurrent
 * domains — the ordering below runs uniformly regardless, but this is where
 * the Unmount Ordering prologue (`inst-um-await-mount-settle`) is applied,
 * so it holds for a Concurrent domain exactly as it does for a serialized
 * one.
 */
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-await-mount-settle
export class UnmountExtActionHandler extends ActionHandler {
  /**
   * @param inner - The handler the domain factory registered for
   *   `unmount_ext` (or a type derived from it) — ultimately a bound
   *   `strategy.unmount(...)` call.
   * @param coordinator - The same per-domain coordinator
   *   `MountExtActionHandler` was given for this domain's
   *   `mount_ext`-derived handlers.
   */
  constructor(
    private readonly inner: ActionHandler,
    private readonly coordinator: DomainOccupancyCoordinator
  ) {
    super();
  }

  async handleAction(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    const subject = (payload as { subject?: unknown } | undefined)?.subject;
    if (typeof subject === 'string') {
      // inst-um-await-mount-settle: checked BEFORE the unmount's own
      // occupancy mutation runs at all — while a fresh mount of the SAME
      // extension in this SAME domain is in progress, the strategy's
      // `unmount` body must never run concurrently with it (it would read
      // and mutate a mount set the in-progress mount has not finished
      // settling, and its container-release could race the mount's own
      // container creation). This is a point-in-time check, exactly like
      // the already-mounted / join-in-progress-mount checks in
      // `MountExtActionHandler` above: the coordinator is the SAME
      // instance for every `mount_ext`-derived action type this domain
      // registers, so this observes a fresh mount started through any of
      // them.
      const inFlightMount = this.coordinator.getInFlightMount(subject);
      if (inFlightMount) {
        try {
          await inFlightMount;
        } catch {
          // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-failure
          // The awaited mount failed, so the extension never became
          // mounted — this unmount request completes successfully without
          // invoking `inner` at all: no strategy body runs, no container is
          // released, and the mount set is left exactly as it already was
          // (the extension absent from it).
          return;
          // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-failure
        }
        // inst-um-after-mount-success falls through to the normal ordered
        // unmount below: by the time the coordinator's in-flight-mount
        // placeholder resolves, the physical mount it tracked has already
        // finished (`DomainOccupancyCoordinator.runFreshMount` settles the
        // placeholder only from `task`'s own outcome), so the extension is
        // already mounted and `DefaultMountManager.unmountExtension` runs
        // its real physical-unmount path rather than the no-op early
        // return it takes for any state other than 'mounted'.
      }
    }
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-success
    return this.coordinator.runOrderedMutation(() => this.inner.handleAction(actionTypeId, payload));
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-success
  }
}
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-await-mount-settle
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
