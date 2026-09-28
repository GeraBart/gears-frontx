/**
 * Domain Occupancy Coordinator
 *
 * One instance per registered domain, shared by every `mount_ext`-derived
 * action type the domain registers. `DefaultMfeRegistry.registerDomain`
 * constructs exactly one coordinator per domain and passes the SAME instance
 * into every `MountExtActionHandler` instance constructed for that domain
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-join-in-progress-mount`, `inst-me-no-rerun-eviction`), so a fresh
 * mount started through one derived action type is joined or ordered
 * against a fresh mount started through another exactly as it would be if
 * both were the same action type.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

/**
 * @internal
 */
export class DomainOccupancyCoordinator {
  /**
   * The settlement promise of the fresh physical mount this coordinator
   * itself started for an extension id, populated for the whole duration of
   * that mount. A second request for the SAME extension id joins this entry
   * (`inst-me-join-in-progress-mount`) instead of starting a second one,
   * regardless of which `mount_ext`-derived action type it arrived through.
   */
  private readonly inFlightMountsByExtension = new Map<string, Promise<void>>();

  /**
   * The domain-wide ordering tail, or `undefined` while the domain is idle
   * (no fresh mount requiring cross-extension ordering is currently
   * running). A fresh mount that must be ordered against other extensions'
   * fresh mounts (see `serializeAcrossExtensions`) chains onto this promise
   * when it is populated, then replaces it with its own settlement, so the
   * next such mount is evaluated only after this one completes — win or
   * lose. Left `undefined` (rather than a resolved promise every call would
   * still have to `.then()` off) so the FIRST fresh mount in an idle domain
   * invokes its task synchronously, exactly as an unordered one would.
   */
  private tail: Promise<void> | undefined;

  /**
   * @param serializeAcrossExtensions - Whether a fresh mount of one
   *   extension in this domain must wait for another extension's fresh
   *   mount in the SAME domain to settle before starting. Optional and
   *   Exclusive strategies read the domain's current mount set and may
   *   evict a sibling as part of mounting, so two different extensions'
   *   fresh mounts reading and acting on that set must never overlap — the
   *   later one is evaluated only after the earlier one's mutation (eviction
   *   included) has completed. A Concurrent domain never evicts a sibling —
   *   each extension's fresh mount neither reads nor mutates any other
   *   extension's occupancy — so different extensions' fresh mounts there
   *   are independent and are not ordered against one another.
   */
  constructor(private readonly serializeAcrossExtensions: boolean) {}

  /**
   * The in-flight fresh-mount promise for `extensionId`, if this coordinator
   * itself has one running, or `undefined`.
   */
  getInFlightMount(extensionId: string): Promise<void> | undefined {
    return this.inFlightMountsByExtension.get(extensionId);
  }

  /**
   * Run a fresh physical mount for `extensionId` by invoking `task` exactly
   * once. A second call for the SAME extension id while the first is still
   * running returns the first's promise instead of invoking `task` again.
   * When this coordinator was built with `serializeAcrossExtensions`, a call
   * for a DIFFERENT extension id waits for the previous fresh mount in this
   * domain to settle before `task` runs.
   *
   * A placeholder settlement is published in `inFlightMountsByExtension`
   * BEFORE `task` is invoked — not after — so a call that re-enters this
   * method for the SAME extension id synchronously (from `task`'s own
   * synchronous prefix, e.g. a container hook or a lifecycle mount callback
   * that dispatches `mount_ext` again before `task`'s first `await`) finds
   * the entry already in flight and joins it instead of starting a second
   * physical mount. The placeholder settles from `task`'s own outcome, once
   * `task` actually resolves or rejects.
   */
  runFreshMount(extensionId: string, task: () => Promise<void>): Promise<void> {
    const existing = this.inFlightMountsByExtension.get(extensionId);
    if (existing) {
      return existing;
    }

    let settlePlaceholder!: () => void;
    let rejectPlaceholder!: (error: unknown) => void;
    const placeholder = new Promise<void>((resolve, reject) => {
      settlePlaceholder = resolve;
      rejectPlaceholder = reject;
    });

    this.inFlightMountsByExtension.set(extensionId, placeholder);
    // Identity-checked cleanup: only THIS call's own placeholder is ever
    // removed — and it is removed BEFORE the placeholder settles for its
    // caller below, so a caller's own fulfillment or rejection handler that
    // immediately retries `runFreshMount` for the SAME extension id
    // synchronously never joins this now-settled placeholder; it finds the
    // map already cleared and starts a fresh mount instead.
    const cleanup = (): void => {
      if (this.inFlightMountsByExtension.get(extensionId) === placeholder) {
        this.inFlightMountsByExtension.delete(extensionId);
      }
    };

    // `task` runs only now, with the placeholder already published above —
    // any synchronous re-entrant call for `extensionId` task's own
    // synchronous prefix triggers observes and joins that placeholder. On
    // an idle (or non-serialized) coordinator, `chainOntoTail` invokes
    // `task` synchronously (not via a `.then()` callback), so a `task` that
    // THROWS synchronously — rather than returning a rejected promise —
    // throws out of this call instead of producing a settlement to chain
    // onto. Caught here and turned into a placeholder rejection, so the
    // published placeholder still settles and its identity-checked cleanup
    // above still runs, instead of leaving a joiner waiting forever.
    try {
      const settlement = this.chainOntoTail(task);
      settlement.then(
        () => {
          cleanup();
          settlePlaceholder();
        },
        (error) => {
          cleanup();
          rejectPlaceholder(error);
        }
      );
    } catch (error) {
      cleanup();
      rejectPlaceholder(error);
    }

    return placeholder;
  }

  /**
   * Run an occupancy mutation that is NOT itself a fresh mount of a
   * particular extension id — an explicit `unmount_ext` dispatch, whose
   * strategy body reads and mutates the SAME domain-wide mount set a fresh
   * mount's own eviction reads and mutates. Ordered against every other
   * ordered mutation (fresh mounts included) on this coordinator's shared
   * tail exactly like `runFreshMount`, so the two never interleave in a
   * domain built with `serializeAcrossExtensions` — realizing "occupancy
   * mutations within a domain are ordered" for the explicit-unmount path,
   * not only the fresh-mount path.
   *
   * A domain NOT built with `serializeAcrossExtensions` (Concurrent) never
   * evicts a sibling, so this degrades to invoking `task` immediately, with
   * no ordering applied — identical to an unwrapped call.
   */
  runOrderedMutation(task: () => Promise<void>): Promise<void> {
    // On an idle (or non-serialized) coordinator, `chainOntoTail` invokes
    // `task` synchronously — a `task` that throws synchronously would
    // otherwise throw out of this call itself instead of yielding the
    // rejected promise this method's signature promises its caller.
    try {
      return this.chainOntoTail(task);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Shared ordering primitive behind `runFreshMount` and
   * `runOrderedMutation`: when `serializeAcrossExtensions`, chain `task`
   * onto the domain's current ordering tail and replace the tail with this
   * call's own settlement; otherwise invoke `task` immediately.
   */
  private chainOntoTail(task: () => Promise<void>): Promise<void> {
    const previousTail = this.tail;
    const settlement = this.serializeAcrossExtensions && previousTail
      ? previousTail.catch(() => { /* an earlier mutation's failure never blocks the next one */ }).then(task)
      : task();

    if (this.serializeAcrossExtensions) {
      this.tail = settlement;
      settlement.catch(() => { /* tracked only for ordering, not surfaced from here */ }).finally(() => {
        // Only the domain's CURRENT tail returns it to idle — if a later
        // mutation has since chained onto (and replaced) it, this
        // settlement finishing must not clear that later one's ordering.
        if (this.tail === settlement) {
          this.tail = undefined;
        }
      });
    }

    return settlement;
  }
}
