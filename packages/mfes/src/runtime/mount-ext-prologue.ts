/**
 * Mount-Ext Prologue
 *
 * The strategy-agnostic guard that runs before every `mount_ext` action
 * handler a domain registers, regardless of which `MountStrategy` the domain
 * composed. The registry wraps a domain's collected `mount_ext` handler with
 * `wrapMountExtHandler` before persisting it to the mediator
 * (`DefaultMfeRegistry.registerDomain`), so eligibility, the already-mounted
 * short-circuit, in-progress-mount joining, and in-progress-unmount waiting
 * all run above every strategy — before any container creation, eviction, or
 * strategy body executes.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

import { ActionHandler } from '../mediator/types';
import { DomainOccupancyCoordinator } from './domain-occupancy-coordinator';

/**
 * Collaborators the prologue needs, supplied by the registry at domain
 * registration time. None of these are strategy-specific: every domain,
 * whichever strategy it composed, is wrapped with the same dependencies
 * shape.
 */
export interface MountExtPrologueDeps {
  /** The domain this `mount_ext` handler was registered for. */
  readonly domainId: string;
  /** Resolve the domain the extension is admitted to, or `undefined` if the extension is not registered anywhere. */
  readonly getExtensionDomain: (extensionId: string) => string | undefined;
  /** Whether the extension is currently in the addressed domain's mount set. */
  readonly isMounted: (extensionId: string) => boolean;
  /** The in-flight unmount settlement promise for the extension in this domain, if one is running. */
  readonly getUnmountInFlight: (extensionId: string) => Promise<void> | undefined;
  /**
   * The SAME coordinator instance for every `mount_ext`-derived action type
   * this domain registers — the registry constructs one per domain and
   * passes it to every `wrapMountExtHandler` call for that domain, so
   * same-extension joining and cross-extension ordering hold across derived
   * action types, not only within a single wrapped handler.
   */
  readonly coordinator: DomainOccupancyCoordinator;
}

/**
 * Wrap a domain's collected `mount_ext` handler with the strategy-agnostic
 * mount-execution prologue.
 *
 * @param inner - The handler the domain factory registered for `mount_ext`
 *   (or a type derived from it) — ultimately a bound `strategy.mount(...)` call.
 * @param deps - Collaborators the prologue reads to decide eligibility,
 *   occupancy, and in-flight state.
 */
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
export function wrapMountExtHandler(inner: ActionHandler, deps: MountExtPrologueDeps): ActionHandler {
  return ActionHandler.fromFunction(async (actionTypeId, payload) => {
    const subject = (payload as { subject?: unknown } | undefined)?.subject;
    if (typeof subject !== 'string') {
      // A malformed payload is not this prologue's concern — let the
      // wrapped handler's own validation (or the mediator's admission
      // check upstream of it) report the failure exactly as it would
      // without this wrapper in place.
      return inner.handleAction(actionTypeId, payload);
    }
    const extensionId = subject;

    // inst-me-eligibility-check
    if (deps.getExtensionDomain(extensionId) !== deps.domainId) {
      throw new Error(
        `mount_ext: extension '${extensionId}' is not admitted to domain '${deps.domainId}'.`
      );
    }

    // Re-entered after an in-progress unmount settles
    // (inst-me-await-unmount-settle) to re-evaluate occupancy from the top.
    for (;;) {
      // inst-me-await-unmount-settle: checked FIRST in each pass, ahead of
      // the already-mounted read below — while an unmount is genuinely in
      // flight, the domain's raw mount-set can still show the extension as
      // mounted for a few more microtask turns (the removal happens inside
      // that same unmount's own continuation). Reading "already mounted" at
      // that instant would report success for a mount that never actually
      // ran, only for the concurrent unmount to remove the extension moments
      // later. This request therefore neither completes successfully nor
      // joins that unmount (inst-me-already-mounted-complete /
      // inst-me-join-in-progress-mount do not apply to it): it waits for the
      // unmount to settle, then re-evaluates from the top of this loop.
      const inFlightUnmount = deps.getUnmountInFlight(extensionId);
      if (inFlightUnmount) {
        try {
          await inFlightUnmount;
        } catch (unmountError) {
          // inst-me-fail-after-unmount-failure
          const failure = new Error(
            `mount_ext: extension '${extensionId}' could not be mounted in domain ` +
            `'${deps.domainId}' because the in-progress unmount it was waiting on failed.`
          );
          (failure as Error & { cause?: unknown }).cause = unmountError;
          throw failure;
        }
        continue;
      }

      // inst-me-already-mounted-complete — checked by the extension's
      // identity before any container creation, eviction, or strategy runs.
      // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
      // This request shares whatever ADMITTED -> MOUNTED transition the
      // physical mount already committed (`inst-adm-t5`/`inst-adm-t8`) and
      // whatever `activated` trigger accompanied it — it produces neither a
      // transition nor an `activated` trigger of its own.
      if (deps.isMounted(extensionId)) {
        return;
      }
      // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9

      // inst-me-join-in-progress-mount
      // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
      // This request settles with the underlying physical mount's own
      // outcome — its ADMITTED -> MOUNTED or ADMITTED -> REJECTED transition
      // and, on success, its single `activated` trigger — and produces no
      // additional transition or trigger of its own. The coordinator is
      // shared across every `mount_ext`-derived action type this domain
      // registers, so this join holds regardless of which derived action
      // type the in-progress mount was started through.
      const inFlightMount = deps.coordinator.getInFlightMount(extensionId);
      if (inFlightMount) {
        return inFlightMount;
      }
      // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9

      break;
    }

    // inst-me-fresh-mount-after-unmount / inst-me-no-rerun-eviction: this
    // point is reached only for a fresh mount — the extension is neither
    // already mounted nor being mounted or unmounted by another request —
    // so `inner` (the strategy's own mount body, eviction included where the
    // strategy performs it) runs exactly once for this physical mount. The
    // coordinator orders this fresh mount against any other extension's
    // fresh mount already running in this domain (where the domain's
    // strategy requires that ordering), so a strategy that reads the mount
    // set and evicts a sibling never observes a set another concurrent
    // fresh mount is still mutating.
    await deps.coordinator.runFreshMount(extensionId, () => inner.handleAction(actionTypeId, payload));
  });
}
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction

/**
 * Wrap a domain's collected `unmount_ext` handler so its occupancy mutation
 * is ordered on the SAME per-domain coordinator a fresh mount's own
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
 * degrades to invoking `inner` immediately, so wrapping every domain's
 * `unmount_ext` handler uniformly here changes nothing for Concurrent
 * domains — the ordering below runs uniformly regardless, but this is where
 * the Unmount Ordering prologue (`inst-um-await-mount-settle`) is applied,
 * so it holds for a Concurrent domain exactly as it does for a serialized
 * one.
 *
 * @param inner - The handler the domain factory registered for
 *   `unmount_ext` (or a type derived from it) — ultimately a bound
 *   `strategy.unmount(...)` call.
 * @param deps - The same per-domain coordinator `wrapMountExtHandler` was
 *   given for this domain's `mount_ext`-derived handlers.
 */
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-await-mount-settle
export function wrapUnmountExtHandler(
  inner: ActionHandler,
  deps: { readonly coordinator: DomainOccupancyCoordinator }
): ActionHandler {
  return ActionHandler.fromFunction(async (actionTypeId, payload) => {
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
      // `wrapMountExtHandler` above: the coordinator is the SAME instance
      // for every `mount_ext`-derived action type this domain registers, so
      // this observes a fresh mount started through any of them.
      const inFlightMount = deps.coordinator.getInFlightMount(subject);
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
    return deps.coordinator.runOrderedMutation(() => inner.handleAction(actionTypeId, payload));
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-success
  });
}
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-await-mount-settle
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
