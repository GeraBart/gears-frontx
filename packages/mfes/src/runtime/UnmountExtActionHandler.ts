/**
 * Unmount-Ext Prologue
 *
 * The strategy-agnostic guard that runs before every `unmount_ext` action
 * handler a domain registers. In a Concurrent domain this waits for an
 * in-progress mount of the same extension to settle before proceeding
 * (`inst-um-await-mount-settle`); in an Optional domain an explicit unmount
 * takes part in the SAME two-slot occupancy queue a fresh mount does
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-occupancy-queue`). An Exclusive domain declares no `unmount_ext`
 * (`cpt-frontx-algo-extension-domain-governance-strategy-cardinality`
 * `inst-sc-exclusive-row`), so it registers no handler for it and no instance
 * of this class exists there.
 *
 * This class does NOT implement any of the `MountExtActionHandler`
 * prologue's own instructions (`inst-me-eligibility-check`,
 * `inst-me-already-mounted-complete`, `inst-me-join-in-progress-mount`,
 * `inst-me-await-unmount-settle`, `inst-me-fresh-mount-after-unmount`,
 * `inst-me-fail-after-unmount-failure`) — those are realized there, on the
 * `mount_ext` side, not here.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2
// @cpt-dod:cpt-frontx-dod-extension-domain-governance-url-commands:p1

import { ActionHandler } from '../mediator/ActionHandler';
import { DeclaredTimeoutActionHandler } from '../mediator/DeclaredTimeoutActionHandler';
import { ActionTimeoutResolver } from '../mediator/ActionTimeoutResolver';
import { DomainOccupancyCoordinator } from './DomainOccupancyCoordinator';
import { ConcurrentMountJoiner } from './ConcurrentMountJoiner';
import type { ExtensionAdmissionReader, MountedExtensionReader } from './MountExtActionHandler';
import type { RouterPort } from '../router/RouterPort';
import { DomainReflectCommands, type ReflectRequest } from './DomainReflectCommands';

/**
 * Decorates a domain's collected `unmount_ext` handler.
 *
 * A Concurrent domain is given `concurrentJoiner` (and no `queue`); an
 * Optional domain is given `queue` (and no `concurrentJoiner`) — the SAME
 * instance `MountExtActionHandler` was given for this domain's
 * `mount_ext` handler.
 */
export class UnmountExtActionHandler extends DeclaredTimeoutActionHandler {
  /**
   * @param inner - The handler the domain factory registered for
   *   `unmount_ext` — ultimately a bound
   *   `strategy.unmount(...)` call.
   * @param domainId - The domain this `unmount_ext` handler was registered
   *   for.
   * @param admissionReader - Resolves the domain an extension is admitted
   *   to.
   * @param mountedReader - Reads whether an extension is currently in the
   *   addressed domain's mount set.
   * @param actionTimeoutResolver - The shared timeout rule.
   * @param domainReader - Reads this domain's declaration (for its
   *   `defaultActionTimeout`).
   * @param queue - This domain's occupancy queue (Optional), or `undefined`
   *   for a Concurrent domain.
   * @param concurrentJoiner - This domain's same-extension mount joiner
   *   (Concurrent), used to await an in-flight mount of the same subject, or
   *   `undefined` for an Optional domain.
   * @param router - The injected router, or `undefined` for a standalone
   *   registry.
   * @param readMountSet - Reads the domain's current mount set, which the
   *   domain's URL commands project from.
   */
  constructor(
    private readonly inner: ActionHandler,
    private readonly domainId: string,
    private readonly admissionReader: ExtensionAdmissionReader,
    private readonly mountedReader: MountedExtensionReader,
    private readonly actionTimeoutResolver: ActionTimeoutResolver,
    private readonly domainReader: () => { id: string; defaultActionTimeout: number } | undefined,
    private readonly queue: DomainOccupancyCoordinator | undefined,
    private readonly concurrentJoiner: ConcurrentMountJoiner | undefined,
    router: RouterPort | undefined,
    readMountSet: () => readonly string[]
  ) {
    super();
    this.commands = new DomainReflectCommands(domainId, router, readMountSet, queue, concurrentJoiner);
  }

  /** The domain's URL commands, issued from this wrapper at acceptance and at settle. */
  private readonly commands: DomainReflectCommands;

  handleActionWithDeclaredTimeout(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined,
    declaredTimeout: number | undefined
  ): Promise<void> {
    const subject = (payload as { subject?: unknown } | undefined)?.subject;
    if (typeof subject !== 'string') {
      // A malformed payload has no projection change: no acceptance
      // command, but the request is settled like any other.
      const handling = this.handleUnaddressed(actionTypeId, payload);
      this.startedWork().track(this.commands.settleAfter(undefined, handling));
      return handling;
    }
    // The request's outcome and its chain's continuation come from its own
    // handling alone; the settle command follows that handling in a separate
    // asynchronous call and is never awaited by the promise returned here.
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-chain-independent
    const request = this.commands.request('unmount', subject, payload);
    const handling = this.handleRequest(request, actionTypeId, payload, declaredTimeout);
    this.startedWork().track(this.commands.settleAfter(request, handling));
    return handling;
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-chain-independent
  }

  /** The tracker of this domain's started work: its queue or its Concurrent joiner. */
  private startedWork(): DomainOccupancyCoordinator | ConcurrentMountJoiner {
    return (this.queue ?? this.concurrentJoiner)!;
  }

  /**
   * Handling of a request without a string subject. An `async` method, so a
   * synchronous throw from the wrapped handler becomes a rejection.
   */
  private async handleUnaddressed(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    // A closed domain refuses every request, this one included.
    const closedReason = this.queue?.closedReason() ?? this.concurrentJoiner?.closedReason();
    if (closedReason !== undefined) {
      throw new Error(`unmount_ext: request in domain '${this.domainId}' ${closedReason}`);
    }
    return this.inner.handleAction(actionTypeId, payload);
  }

  /**
   * The request's own handling. An `async` method, so a synchronous throw
   * becomes a rejected promise before the caller awaits it.
   */
  private async handleRequest(
    request: ReflectRequest,
    actionTypeId: string,
    payload: Record<string, unknown> | undefined,
    declaredTimeout: number | undefined
  ): Promise<void> {
    const extensionId = request.subject;

    if (!this.queue) {
      return this.handleConcurrentUnmount(request, actionTypeId, payload);
    }

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-caller-timer
    const timeoutMs = this.actionTimeoutResolver.resolve(declaredTimeout, this.domainReader(), this.domainId);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-caller-timer

    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept-refused
    // A request arriving while its domain is being unregistered fails at once
    // without being placed: it issues no acceptance command.
    // The acceptance command is issued first, with the queue as it will be
    // once the request is placed: a throw from the router fails the request
    // before anything is queued.
    if (!this.queue.isClosed()) {
      this.commands.accept(request, this.queue.readEntriesAfterPlacing('unmount', extensionId));
    }
    const placement = this.queue.submit('unmount', extensionId, timeoutMs, () =>
      this.runUnmountAtTurn(extensionId, actionTypeId, payload)
    );
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept-refused
    await placement;
  }

  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-evaluate-at-turn
  private async runUnmountAtTurn(
    extensionId: string,
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-eligibility-at-turn
    if (this.admissionReader.domainOf(extensionId) !== this.domainId) {
      throw new Error(
        `unmount_ext: extension '${extensionId}' is no longer admitted to domain '${this.domainId}'.`
      );
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-eligibility-at-turn

    if (this.mountedReader.isMounted(extensionId)) {
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-queue-unmount-at-turn
      return this.inner.handleAction(actionTypeId, payload);
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-queue-unmount-at-turn
    }
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-queue-absent-noop
    return;
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-queue-absent-noop
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-queue-evaluate-at-turn

  /**
   * The Concurrent-domain unmount path — waits for an in-progress mount of
   * the same extension to settle before proceeding.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-await-mount-settle
  private async handleConcurrentUnmount(
    request: ReflectRequest,
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    const extensionId = request.subject;
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept-refused
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-concurrent-domain-unregister
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-registry-dispose-wait
    // A request arriving while its Concurrent domain is being unregistered,
    // or its registry disposed, is refused at once: no acceptance command and
    // no unmount; its settle command follows its own failure.
    const closedReason = this.concurrentJoiner!.closedReason();
    if (closedReason !== undefined) {
      throw new Error(`unmount_ext: request for '${extensionId}' in domain '${this.domainId}' ${closedReason}`);
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-registry-dispose-wait
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-concurrent-domain-unregister
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept-refused
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-concurrent-accept
    // The request is accepted when it is handed to the Concurrent unmount
    // path, before it waits on any mount in progress.
    this.commands.accept(request);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-concurrent-accept
    const inFlightMount = this.concurrentJoiner?.inFlight(extensionId);
    if (inFlightMount) {
      try {
        await inFlightMount;
      } catch {
        // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-failure
        // The awaited mount failed, so the extension never became mounted —
        // this unmount request completes successfully without invoking
        // `inner` at all.
        return;
        // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-failure
      }
      // inst-um-after-mount-success falls through to the ordinary unmount
      // below: the awaited mount has already settled to mounted.
    }
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-success
    return this.inner.handleAction(actionTypeId, payload);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-after-mount-success
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-um-await-mount-settle
}
