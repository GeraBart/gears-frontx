/**
 * Concurrent Occupancy Record
 *
 * Per extension, the latest accepted request of a Concurrent domain that has
 * not yet settled, holding that request's identity and its operation. The
 * domain's URL commands read it to project the domain's occupancy
 * (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-cmd-concurrent-record`). One instance per Concurrent domain,
 * shared by the domain's `mount_ext` and `unmount_ext` handlers through its
 * `ConcurrentMountJoiner`.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2

import type { OccupancyOperation } from './OccupancyEntry';

/**
 * @internal
 */
export class ConcurrentOccupancyRecord {
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-concurrent-record
  private readonly byExtension = new Map<string, { request: object; operation: OccupancyOperation }>();
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-concurrent-record

  /**
   * Sets the record of `extensionId` at the acceptance of `request`,
   * replacing any earlier record for that extension; the record takes its
   * place after every record accepted earlier.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-set
  set(extensionId: string, request: object, operation: OccupancyOperation): void {
    this.byExtension.delete(extensionId);
    this.byExtension.set(extensionId, { request, operation });
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-set

  /**
   * Clears the record of `extensionId` only while it still holds `request`;
   * a request that settles after a later request for the same extension was
   * accepted leaves the later request's record in place.
   */
  // @cpt-begin:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-clear
  clear(extensionId: string, request: object): void {
    if (this.byExtension.get(extensionId)?.request === request) {
      this.byExtension.delete(extensionId);
    }
  }
  // @cpt-end:cpt-frontx-algo-extension-domain-governance-mount-execution:p2:inst-me-cmd-record-clear

  /** The records, each as its extension and operation, in acceptance order. */
  entries(): Array<{ extensionId: string; operation: OccupancyOperation }> {
    return Array.from(this.byExtension, ([extensionId, { operation }]) => ({ extensionId, operation }));
  }
}
