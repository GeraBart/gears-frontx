/**
 * Mount-Ext Prologue
 *
 * The strategy-agnostic guard that runs before every `mount_ext` action
 * handler a domain registers, regardless of which `MountStrategy` the domain
 * composed. The registry decorates a domain's collected `mount_ext` handler
 * with `MountExtActionHandler` before persisting it to the mediator
 * (`DefaultMfeRegistry.registerDomain`), so eligibility, the already-mounted
 * short-circuit, in-progress-mount joining, and in-progress-unmount waiting
 * all run above every strategy — before any container creation, eviction, or
 * strategy body executes.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

import { ActionHandler } from '../mediator/ActionHandler';
import { DomainOccupancyCoordinator } from './DomainOccupancyCoordinator';

/**
 * Resolves the domain an extension is admitted to. None of these ports are
 * strategy-specific: every domain, whichever strategy it composed, is
 * decorated against the same port shapes.
 */
export interface ExtensionAdmissionReader {
  /**
   * @param extensionId - ID of the extension to resolve.
   * @returns The domain the extension is admitted to, or `undefined` if the
   *   extension is not registered anywhere.
   */
  domainOf(extensionId: string): string | undefined;
}

/**
 * Reads whether an extension is currently in a domain's mount set.
 */
export interface MountedExtensionReader {
  /**
   * @param extensionId - ID of the extension to check.
   * @returns Whether the extension is currently in the addressed domain's
   *   mount set.
   */
  isMounted(extensionId: string): boolean;
}

/**
 * Reads the in-flight unmount settlement for an extension in a domain, if
 * one is running.
 */
export interface UnmountInFlightReader {
  /**
   * @param extensionId - ID of the extension to check.
   * @returns The in-flight unmount settlement promise for the extension in
   *   this domain, or `undefined` if none is running.
   */
  inFlight(extensionId: string): Promise<void> | undefined;
}

/**
 * Decorates a domain's collected `mount_ext` handler with the
 * strategy-agnostic mount-execution prologue: eligibility, the
 * already-mounted short-circuit, in-progress-mount joining, and
 * in-progress-unmount waiting.
 *
 * `DefaultMfeRegistry.registerDomain` constructs one instance per
 * `mount_ext`-derived action type a domain registers, all sharing the SAME
 * `DomainOccupancyCoordinator` for that domain
 * (`inst-me-join-in-progress-mount`, `inst-me-no-rerun-eviction`).
 */
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
// @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
export class MountExtActionHandler extends ActionHandler {
  /**
   * @param inner - The handler the domain factory registered for
   *   `mount_ext` (or a type derived from it) — ultimately a bound
   *   `strategy.mount(...)` call.
   * @param domainId - The domain this `mount_ext` handler was registered
   *   for.
   * @param admissionReader - Resolves the domain an extension is admitted
   *   to.
   * @param mountedReader - Reads whether an extension is currently in the
   *   addressed domain's mount set.
   * @param unmountInFlightReader - Reads the in-flight unmount settlement
   *   for an extension in this domain, if one is running.
   * @param coordinator - The SAME coordinator instance for every
   *   `mount_ext`-derived action type this domain registers — the registry
   *   constructs one per domain and passes it to every handler it
   *   decorates for that domain, so same-extension joining and
   *   cross-extension ordering hold across derived action types, not only
   *   within a single decorated handler.
   */
  constructor(
    private readonly inner: ActionHandler,
    private readonly domainId: string,
    private readonly admissionReader: ExtensionAdmissionReader,
    private readonly mountedReader: MountedExtensionReader,
    private readonly unmountInFlightReader: UnmountInFlightReader,
    private readonly coordinator: DomainOccupancyCoordinator
  ) {
    super();
  }

  async handleAction(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    const subject = (payload as { subject?: unknown } | undefined)?.subject;
    if (typeof subject !== 'string') {
      // A malformed payload is not this prologue's concern — let the
      // wrapped handler's own validation (or the mediator's admission
      // check upstream of it) report the failure exactly as it would
      // without this decorator in place.
      return this.inner.handleAction(actionTypeId, payload);
    }
    const extensionId = subject;

    // inst-me-eligibility-check
    if (this.admissionReader.domainOf(extensionId) !== this.domainId) {
      throw new Error(
        `mount_ext: extension '${extensionId}' is not admitted to domain '${this.domainId}'.`
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
      const inFlightUnmount = this.unmountInFlightReader.inFlight(extensionId);
      if (inFlightUnmount) {
        try {
          await inFlightUnmount;
        } catch (unmountError) {
          // inst-me-fail-after-unmount-failure
          const failure = new Error(
            `mount_ext: extension '${extensionId}' could not be mounted in domain ` +
            `'${this.domainId}' because the in-progress unmount it was waiting on failed.`
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
      if (this.mountedReader.isMounted(extensionId)) {
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
      const inFlightMount = this.coordinator.getInFlightMount(extensionId);
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
    await this.coordinator.runFreshMount(extensionId, () => this.inner.handleAction(actionTypeId, payload));
  }
}
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
// @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
