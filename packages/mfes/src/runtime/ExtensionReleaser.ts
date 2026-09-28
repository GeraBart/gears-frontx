import type { ExtensionMounter } from './ExtensionMounter';

interface ReleaseState {
  readonly promise: Promise<void>;
  readonly setDestroy: (destroy: () => void) => void;
}

/**
 * Owns the "unmount, then destroy exactly once" coalescing for ONE
 * `ExtensionMounter` instance. Constructed and looked up exclusively through
 * `ExtensionReleaserProvider.for(mounter)`, which guarantees a mounter is
 * ever given at most one releaser.
 *
 * Not exported outside this module: strategies and `DefaultExtensionMounter`
 * reach an instance only through `ExtensionReleaserProvider.for(...)`, never
 * by constructing one directly.
 */
export class ExtensionReleaser {
  /**
   * The settlement of a release started for a given extension id on this
   * releaser's mounter, together with the callback that lets a call joining
   * that SAME release before it settles contribute its own `destroy`.
   */
  private readonly releasesInFlight = new Map<string, ReleaseState>();

  constructor(private readonly mounter: ExtensionMounter) {}

  /**
   * Unmount `extensionId` on this releaser's mounter via `mounter.unmount()`
   * and then invoke `destroy` exactly once — coalescing every concurrent
   * `release` call for the SAME extension id onto ONE shared "unmount then
   * destroy once" operation.
   *
   * A call joining an already-in-flight release (whether it was started by
   * another call WITH a `destroy` or WITHOUT one — `detach()`'s own
   * mass-release supplies none, deliberately, so it never claims the destroy
   * slot ahead of a genuine one) contributes its own `destroy` if none has
   * been chosen yet. Once one caller's `destroy` is chosen it is never
   * replaced, so it — and only it — runs exactly once, when the shared
   * physical `unmount()` settles.
   *
   * @param extensionId - ID of the extension being released.
   * @param destroy - This caller's container-release callback for
   *   `extensionId`, if it has one. Optional so a caller with no
   *   container-level cleanup of its own (`detach()`) can still join or
   *   start the shared release without claiming the destroy slot.
   */
  release(extensionId: string, destroy?: () => void): Promise<void> {
    const existing = this.releasesInFlight.get(extensionId);
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

    this.releasesInFlight.set(extensionId, { promise: work, setDestroy });
    // Identity-checked cleanup: remove only THIS call's own entry — and,
    // critically, do so BEFORE `work` settles for its callers below, so a
    // caller's own rejection (or fulfillment) handler that immediately
    // retries `release` for the SAME extension id synchronously never joins
    // this now-settled entry; it finds the map already cleared and starts
    // fresh instead.
    const cleanup = (): void => {
      if (this.releasesInFlight.get(extensionId)?.promise === work) {
        this.releasesInFlight.delete(extensionId);
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
      this.mounter.unmount(extensionId).then(
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
