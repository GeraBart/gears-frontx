/**
 * Mount-Ext Prologue
 *
 * The strategy-agnostic guard that runs before every `mount_ext` action
 * handler a domain registers, regardless of which `MountStrategy` the domain
 * composed. The registry decorates a domain's collected `mount_ext` handler
 * with `MountExtActionHandler` before persisting it to the mediator
 * (`DefaultMfeRegistry.registerDomain`), so eligibility, the already-mounted
 * short-circuit, in-progress-mount joining, in-progress-unmount waiting, and
 * — for Optional and Exclusive domains — the occupancy queue, all run above
 * every strategy, before any container creation, eviction, or strategy body
 * executes.
 *
 * A Concurrent domain keeps no occupancy queue: same-extension joining runs
 * through a `ConcurrentMountJoiner` instead, and different extensions' fresh
 * mounts there are independent. An Optional or Exclusive domain's fresh
 * mounts, joins, and replacements are all ordered through the domain's own
 * `DomainOccupancyCoordinator`.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

import type { ActionHandler } from '../mediator/ActionHandler';
import { DeclaredTimeoutActionHandler } from '../mediator/DeclaredTimeoutActionHandler';
import type { ActionTimeoutResolver } from '../mediator/ActionTimeoutResolver';
import type { DomainOccupancyCoordinator } from './DomainOccupancyCoordinator';
import type { ConcurrentMountJoiner } from './ConcurrentMountJoiner';

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
 * strategy-agnostic mount-execution prologue.
 *
 * `DefaultMfeRegistry.registerDomain` constructs one instance per
 * `mount_ext`-derived action type a domain registers. A Concurrent domain is
 * given `concurrentJoiner` (and no `queue`); an Optional or Exclusive domain
 * is given `queue` (and no `concurrentJoiner`) — the SAME instance for every
 * `mount_ext`- and `unmount_ext`-derived action type the domain registers.
 */
export class MountExtActionHandler extends DeclaredTimeoutActionHandler {
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
   *   for an extension in this domain, if one is running (Concurrent path).
   * @param actionTimeoutResolver - The shared timeout rule, used to resolve
   *   a caller's own timer value for the occupancy queue.
   * @param domainReader - Reads this domain's declaration (for its
   *   `defaultActionTimeout`), or `undefined` if the domain is no longer
   *   registered.
   * @param queue - This domain's occupancy queue (Optional/Exclusive), or
   *   `undefined` for a Concurrent domain.
   * @param concurrentJoiner - This domain's same-extension mount joiner
   *   (Concurrent), or `undefined` for an Optional/Exclusive domain.
   */
  constructor(
    private readonly inner: ActionHandler,
    private readonly domainId: string,
    private readonly admissionReader: ExtensionAdmissionReader,
    private readonly mountedReader: MountedExtensionReader,
    private readonly unmountInFlightReader: UnmountInFlightReader,
    private readonly actionTimeoutResolver: ActionTimeoutResolver,
    private readonly domainReader: () => { id: string; defaultActionTimeout: number } | undefined,
    private readonly queue: DomainOccupancyCoordinator | undefined,
    private readonly concurrentJoiner: ConcurrentMountJoiner | undefined
  ) {
    super();
  }

  async handleActionWithDeclaredTimeout(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined,
    declaredTimeout: number | undefined
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

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
    if (this.admissionReader.domainOf(extensionId) !== this.domainId) {
      throw new Error(
        `mount_ext: extension '${extensionId}' is not admitted to domain '${this.domainId}'.`
      );
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check

    if (!this.queue) {
      return this.handleConcurrentMount(actionTypeId, payload, extensionId);
    }

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-occupancy-queue
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
    // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
    // While the domain is being unregistered the queue is closed, so the
    // request goes to `submit` and fails at once
    // (`inst-me-queue-domain-unregister`).
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
    // A mount-set record for `extensionId` is stale while a slot detach's own
    // unmount of it is still in flight — the record disappears once that
    // unmount settles, so this short-circuit must not complete on it; the
    // request falls through to the queue instead, where its turn awaits the
    // same settlement (`inst-me-queue-await-unmount-at-turn`).
    const unmountInFlight = this.unmountInFlightReader.inFlight(extensionId);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
    if (
      this.mountedReader.isMounted(extensionId) &&
      this.queue.isEmpty() &&
      !this.queue.isClosed() &&
      !unmountInFlight
    ) {
      return;
    }
    // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-caller-timer
    const timeoutMs = this.actionTimeoutResolver.resolve(declaredTimeout, this.domainReader(), this.domainId);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-caller-timer

    await this.queue.submit('mount', extensionId, timeoutMs, () =>
      this.runMountAtTurn(extensionId, actionTypeId, payload)
    );
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-occupancy-queue
  }

  /**
   * Evaluated against the domain's mount set present the moment this
   * entry starts running (`inst-me-queue-evaluate-at-turn`). Reached only
   * for a fresh mount started as the running entry — an already-mounted, a
   * joined, or a still-occupant-at-turn request never runs the strategy
   * (`inst-me-no-rerun-eviction`).
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-evaluate-at-turn
  private async runMountAtTurn(
    extensionId: string,
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-await-unmount-at-turn
    // The entry never succeeds on the strength of a mount-set record a
    // settling slot-detach unmount removes: any such unmount in flight for
    // this extension is awaited first, before eligibility or occupancy is
    // read, re-consulting it after each settlement in case another one
    // started in the meantime.
    for (
      let inFlightUnmount = this.unmountInFlightReader.inFlight(extensionId);
      inFlightUnmount;
      inFlightUnmount = this.unmountInFlightReader.inFlight(extensionId)
    ) {
      try {
        // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
        await inFlightUnmount;
        // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
      } catch (unmountError) {
        // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
        throw this.mapUnmountFailure(extensionId, unmountError);
        // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
      }
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-await-unmount-at-turn

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-eligibility-at-turn
    if (this.admissionReader.domainOf(extensionId) !== this.domainId) {
      throw new Error(
        `mount_ext: extension '${extensionId}' is no longer admitted to domain '${this.domainId}'.`
      );
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-eligibility-at-turn

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-sole-occupant-at-turn
    // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
    if (this.mountedReader.isMounted(extensionId)) {
      return;
    }
    // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-sole-occupant-at-turn

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-fresh-mount-at-turn
    return this.inner.handleAction(actionTypeId, payload);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-fresh-mount-at-turn
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-evaluate-at-turn
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-rerun-eviction

  /**
   * The Concurrent-domain mount path: no occupancy queue — same-extension
   * joining runs through `concurrentJoiner`; different extensions' fresh
   * mounts are independent.
   */
  private async handleConcurrentMount(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined,
    extensionId: string
  ): Promise<void> {
    // The whole wait-then-mount attempt runs INSIDE the joiner's task, so
    // this request's own placeholder is published in the joiner before it
    // ever waits on an in-progress unmount — a second request for the same
    // extension arriving while this one still waits joins THIS attempt
    // instead of coalescing onto the unmount directly.
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
    await this.concurrentJoiner!.run(extensionId, async () => {
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
      // Re-entered after an in-progress unmount settles, to re-evaluate
      // eligibility and occupancy from the top.
      for (;;) {
        // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check
        if (this.admissionReader.domainOf(extensionId) !== this.domainId) {
          throw new Error(
            `mount_ext: extension '${extensionId}' is not admitted to domain '${this.domainId}'.`
          );
        }
        // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-eligibility-check

        const inFlightUnmount = this.unmountInFlightReader.inFlight(extensionId);
        if (inFlightUnmount) {
          try {
            await inFlightUnmount;
          } catch (unmountError) {
            throw this.mapUnmountFailure(extensionId, unmountError);
          }
          continue;
        }

        // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete
        // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
        if (this.mountedReader.isMounted(extensionId)) {
          return;
        }
        // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t9
        // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-already-mounted-complete

        break;
      }

      return this.inner.handleAction(actionTypeId, payload);
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fail-after-unmount-failure
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-fresh-mount-after-unmount
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-await-unmount-settle
    });
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
  }

  /**
   * Maps a failure from an awaited in-progress unmount into the mount
   * request's own failure, shared by the Concurrent path and the occupancy
   * queue's at-turn wait.
   *
   * @param extensionId - ID of the extension whose mount was waiting on the
   *   unmount.
   * @param unmountError - The error the awaited unmount rejected with.
   * @returns The error to throw for this mount request, carrying
   *   `unmountError` as its `cause`.
   */
  private mapUnmountFailure(extensionId: string, unmountError: unknown): Error {
    const failure = new Error(
      `mount_ext: extension '${extensionId}' could not be mounted in domain ` +
      `'${this.domainId}' because the in-progress unmount it was waiting on failed.`
    );
    (failure as Error & { cause?: unknown }).cause = unmountError;
    return failure;
  }
}
