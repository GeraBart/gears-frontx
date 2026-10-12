/**
 * Domain Reflect Commands
 *
 * The URL commands a domain's `mount_ext` and `unmount_ext` handler wrappers
 * issue to the injected router (`RouterPort.reflect`): one at a request's
 * acceptance, per its history intent, and one `replace` command once the
 * wrapper's own handling of the request settles. Each command names the
 * domain's id, the domain's projected occupancy computed at the moment of the
 * command, and a verb; the runtime keeps no memory of earlier commands
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-cmd-wrapper`, `inst-me-cmd-no-memory`).
 *
 * A registry built with no router has no commands to issue: every method
 * here then does nothing.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2
// @cpt-dod:cpt-frontx-dod-extension-domain-governance-url-commands:p1

import type { HistoryIntent } from '../types';
import type { RouterPort } from '../router/RouterPort';
import type { ConcurrentMountJoiner } from './ConcurrentMountJoiner';
import type { DomainOccupancyCoordinator } from './DomainOccupancyCoordinator';
import type { OccupancyOperation } from './OccupancyEntry';

/**
 * One request that reached a wrapper. Its identity keys the Concurrent
 * record, so a request clears only the record it set.
 *
 * @internal
 */
export interface ReflectRequest {
  readonly operation: OccupancyOperation;
  readonly subject: string;
  /** The request's history intent, absent when its payload carries none. */
  readonly history: HistoryIntent | undefined;
}

type QueueEntries = ReturnType<DomainOccupancyCoordinator['readEntries']>;

/**
 * @internal
 */
export class DomainReflectCommands {
  /**
   * @param domainId - The domain the wrappers belong to.
   * @param router - The injected router, or `undefined` for a standalone
   *   registry.
   * @param readMountSet - Reads the domain's current mount set, in mount-set
   *   order.
   * @param queue - The domain's occupancy queue (Optional/Exclusive), or
   *   `undefined` for a Concurrent domain.
   * @param concurrentJoiner - The domain's Concurrent joiner, carrying its
   *   per-extension record, or `undefined` for an Optional/Exclusive domain.
   */
  constructor(
    private readonly domainId: string,
    private readonly router: RouterPort | undefined,
    private readonly readMountSet: () => readonly string[],
    private readonly queue: DomainOccupancyCoordinator | undefined,
    private readonly concurrentJoiner: ConcurrentMountJoiner | undefined
  ) {}

  /** Describes a request that reached the wrapper. */
  request(operation: OccupancyOperation, subject: string, payload: Record<string, unknown> | undefined): ReflectRequest {
    return { operation, subject, history: (payload as { history?: HistoryIntent } | undefined)?.history };
  }

  /**
   * The acceptance of `request`: in a Concurrent domain the request's record
   * is set first, for every history intent, and then a command with the verb
   * the intent selects is issued synchronously; the caller invokes this
   * method within the call that delivered the request.
   *
   * @param queueEntries - For an Optional or Exclusive domain, the queue as it
   *   will be with the request placed, so the command can be issued before the
   *   request is placed; absent, the queue is read as it is.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept
  accept(request: ReflectRequest, queueEntries?: QueueEntries): void {
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-command-standalone
    if (!this.router) {
      return;
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-no-command-standalone
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-set
    this.concurrentJoiner?.record.set(request.subject, request, request.operation);
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-set
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-history-intent:p1:inst-hi-selects-acceptance-verb
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept-none
    if (request.history === 'none') {
      return;
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept-none
    this.command(request.history === 'replace' ? 'replace' : 'push', queueEntries);
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-history-intent:p1:inst-hi-selects-acceptance-verb
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-accept

  /**
   * Issues the settle command for `request` once the wrapper's own handling
   * of it settles, whatever the outcome. It awaits `handling` from a call
   * separate from the one that handles the request, so the command runs in
   * a later turn than the request's delivery. The returned promise resolves
   * once the settle command has been issued; the caller
   * does not await it for the request's outcome — that and its chain's
   * continuation come from `handling` alone — and tracks it so teardown waits
   * for the settle command. A throw from the router's `reflect` is not hidden:
   * the returned promise rejects with it and, unhandled, it surfaces as an
   * unhandled rejection; the request's own outcome is unchanged. A request without a string
   * subject (`request` undefined) set no Concurrent record and has no
   * acceptance command; it is settled the same way.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settle-async
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settlement-own-handling
  settleAfter(request: ReflectRequest | undefined, handling: Promise<void>): Promise<void> {
    return this.awaitThenSettle(request, handling);
  }

  private async awaitThenSettle(request: ReflectRequest | undefined, handling: Promise<void>): Promise<void> {
    try {
      await handling;
    } catch {
      // The outcome belongs to the request's own caller; this continuation
      // only waits for the settlement.
    }
    if (this.router) {
      this.settle(request);
    }
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settlement-own-handling
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settle-async

  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settle
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settle-unexecuted
  private settle(request: ReflectRequest | undefined): void {
    // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-clear
    if (request) {
      this.concurrentJoiner?.record.clear(request.subject, request);
    }
    // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-clear
    this.command('replace');
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settle-unexecuted
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-settle

  /**
   * One command: the domain's id, its projected occupancy computed now, and
   * the verb. Nothing of the request's action reaches the router.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-wrapper
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-history-intent:p1:inst-hi-not-to-router
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-no-memory
  private command(verb: 'push' | 'replace', queueEntries?: QueueEntries): void {
    this.router!.reflect(this.domainId, this.project(queueEntries), verb);
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-no-memory
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-history-intent:p1:inst-hi-not-to-router
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-wrapper

  /**
   * The domain's projected occupancy: what it will hold once every request
   * it has accepted completes as requested, computed afresh from the mount
   * set and the occupancy queue or the Concurrent record.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection
  private project(queueEntries?: QueueEntries): string[] {
    let occupancy = [...this.readMountSet()];
    if (this.queue) {
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection-queue
      const { running, pending } = queueEntries ?? this.queue.readEntries();
      for (const entry of [running, pending]) {
        if (entry === undefined) {
          continue;
        }
        occupancy = entry.operation === 'mount'
          ? [entry.subject]
          : occupancy.filter((id) => id !== entry.subject);
      }
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection-queue
    } else if (this.concurrentJoiner) {
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection-concurrent
      // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection-order
      // The mount set keeps its own order; each extension a record adds
      // follows it in acceptance order, and a mount of an extension already
      // in the list leaves it in place.
      for (const { extensionId, operation } of this.concurrentJoiner.record.entries()) {
        if (operation === 'unmount') {
          occupancy = occupancy.filter((id) => id !== extensionId);
        } else if (!occupancy.includes(extensionId)) {
          occupancy.push(extensionId);
        }
      }
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection-order
      // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection-concurrent
    }
    return occupancy;
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-projection
}
