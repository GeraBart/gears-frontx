/**
 * Started Work Tracker
 *
 * The set of one domain's `mount_ext` / `unmount_ext` requests that reached a
 * wrapper and have not yet settled — the handling together with its settle
 * command. Domain unregistration and registry disposal wait on it
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-concurrent-domain-unregister`, `inst-me-registry-dispose-wait`).
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

/**
 * @internal
 */
export class StartedWorkTracker {
  private readonly executions = new Set<Promise<void>>();

  /**
   * Registers one request as in flight until `work` settles, with either
   * outcome. The tracker waits on a derived promise that never rejects; `work`
   * itself is left to its own consumers, so a rejection of it surfaces as an
   * unhandled rejection and is not hidden here.
   */
  track(work: Promise<void>): void {
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    this.executions.add(done);
    const finish = (): void => {
      this.executions.delete(done);
      release();
    };
    work.then(finish, (error: unknown) => {
      finish();
      throw error;
    });
  }

  /**
   * Resolves once every request in flight has settled. The tracker has no
   * close: a request that arrives after its domain closes is refused by
   * `DomainOccupancyCoordinator.close()` / `ConcurrentMountJoiner.close()`,
   * and is still tracked until its settle command is issued, which follows at
   * once, so it does not extend teardown's wait. Never rejects and never
   * interrupts a request.
   */
  async whenAllSettled(): Promise<void> {
    while (this.executions.size > 0) {
      await Promise.all(Array.from(this.executions));
    }
  }
}
