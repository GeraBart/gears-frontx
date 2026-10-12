/**
 * Concurrent Mount Joiner
 *
 * Joins concurrent fresh mounts of the SAME extension in a Concurrent domain
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-join-in-progress-mount`). A Concurrent domain never evicts a
 * sibling, so different extensions' fresh mounts there run independently —
 * this joiner applies no cross-extension ordering and keeps no occupancy
 * queue. It also carries the domain's `ConcurrentOccupancyRecord`.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

import { ConcurrentOccupancyRecord } from './ConcurrentOccupancyRecord';
import { StartedWorkTracker } from './StartedWorkTracker';

/**
 * @internal
 */
export class ConcurrentMountJoiner {
  private readonly inFlightByExtension = new Map<string, Promise<void>>();

  /**
   * The domain's per-extension record of the latest accepted request that has
   * not yet settled, shared by its `mount_ext` and `unmount_ext` handlers.
   */
  readonly record = new ConcurrentOccupancyRecord();

  private readonly started = new StartedWorkTracker();

  /** Set by `close()`: the suffix every later request's failure message carries. */
  private closedReasonSuffix: string | undefined;

  /** Registers one request (its handling and settle command) as in flight until it settles. */
  track(work: Promise<void>): void {
    this.started.track(work);
  }

  /**
   * Resolves once every request in flight — has settled. Never rejects and never interrupts a request
   * (`inst-me-concurrent-domain-unregister`).
   */
  whenAllSettled(): Promise<void> {
    return this.started.whenAllSettled();
  }

  /**
   * Closes the domain's Concurrent path: the domain is being unregistered or
   * its registry disposed, and every request arriving from now on is refused
   * at once (`inst-me-concurrent-domain-unregister`).
   *
   * @param reasonSuffix - Appended to the failure message of each refused request.
   */
  close(reasonSuffix: string): void {
    this.closedReasonSuffix = reasonSuffix;
  }

  /** The suffix `close()` was given, or `undefined` while open. */
  closedReason(): string | undefined {
    return this.closedReasonSuffix;
  }

  /** Reopens a closed path, so requests arriving after this call are admitted again. */
  reopen(): void {
    this.closedReasonSuffix = undefined;
  }

  /**
   * The in-flight fresh-mount placeholder for `extensionId`, if this joiner
   * has one running, or `undefined`.
   */
  inFlight(extensionId: string): Promise<void> | undefined {
    return this.inFlightByExtension.get(extensionId);
  }

  /**
   * Run a fresh physical mount for `extensionId` by invoking `task` exactly
   * once. A second call for the SAME extension id while the first is still
   * running joins the first's placeholder instead of invoking `task` again.
   *
   * A placeholder settlement is published BEFORE `task` is invoked — not
   * after — so a call that re-enters this method for the SAME extension id
   * synchronously (from `task`'s own synchronous prefix) finds the entry
   * already in flight and joins it instead of starting a second physical
   * mount.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
  run(extensionId: string, task: () => Promise<void>): Promise<void> {
    const existing = this.inFlightByExtension.get(extensionId);
    if (existing) {
      return existing;
    }

    let settle!: () => void;
    let reject!: (error: unknown) => void;
    const placeholder = new Promise<void>((resolve, rej) => {
      settle = resolve;
      reject = rej;
    });
    this.inFlightByExtension.set(extensionId, placeholder);

    // Identity-checked cleanup: only THIS call's own placeholder is ever
    // removed, so a caller retrying for the SAME extension id synchronously,
    // once this placeholder has already settled, finds the map cleared and
    // starts a fresh mount instead.
    const cleanup = (): void => {
      if (this.inFlightByExtension.get(extensionId) === placeholder) {
        this.inFlightByExtension.delete(extensionId);
      }
    };

    try {
      task().then(
        () => { cleanup(); settle(); },
        (error) => { cleanup(); reject(error); }
      );
    } catch (error) {
      cleanup();
      reject(error);
    }

    return placeholder;
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-join-in-progress-mount
}
