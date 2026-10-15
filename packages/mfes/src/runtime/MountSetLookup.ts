/**
 * Mount-set lookup
 *
 * Runtime-private association between a domain's `ExtensionMounter` and the
 * read of that domain's current mount set. The built-in Optional and
 * Exclusive strategies resolve their own domain's mount set through their own
 * mounter with `MountSetLookup.of(mounter)`. Not part of the public API: not
 * re-exported from `src/index.ts`.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-FEATURE:cpt-frontx-feature-mfe-registry:p2
// @cpt-dod:cpt-frontx-dod-mfe-registry-registry-contract:p1

import type { ExtensionMounter } from './ExtensionMounter';

const readersByMounter = new WeakMap<ExtensionMounter, () => readonly string[]>();

export class MountSetLookup {
  private constructor() {}

  /** Associates `mounter` with the read of its domain's mount set. */
  static register(mounter: ExtensionMounter, read: () => readonly string[]): void {
    readersByMounter.set(mounter, read);
  }

  /**
   * @returns The insertion-ordered ids of the extensions currently mounted in
   *   the domain `mounter` belongs to.
   * @throws {Error} if the runtime never registered `mounter`.
   */
  static of(mounter: ExtensionMounter): readonly string[] {
    const read = readersByMounter.get(mounter);
    if (!read) {
      throw new Error('MountSetLookup: the mounter was never registered by the runtime.');
    }
    return read();
  }
}
