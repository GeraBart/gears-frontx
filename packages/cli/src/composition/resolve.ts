// @cpt-algo:cpt-frontx-algo-composed-provenance-recursive-resolution:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-composition-delivered:p1
import { readManifestFromContent } from '../manifest/validate-contract';
import type { InventoryEntry } from '../inventory/types';
import type { CompositionEntry, CompositionSetResult } from './types';

// @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-accept-manifest
/**
 * Recursively resolves a composed template tree into a per-template
 * composition set — one entry per distinct template encountered, each
 * carrying its identity, installed content path, and declared ownership
 * boundaries.
 *
 * Same-target-path collisions between distinct templates are NOT arbitrated
 * here: per the A2 reframe, collision arbitration was relocated OUT of this
 * recursive resolution and INTO the pre-flight ownership-boundary conflict
 * check (cpt-frontx-algo-cli-scaffolding-conflict-check), which is the sole
 * authority for boundary-collision arbitration
 * (cpt-frontx-adr-composed-template-resolution,
 * cpt-frontx-adr-assembly-conflict-prevention). This function hands over an
 * unarbitrated per-template set.
 *
 * DFS with path-based cycle detection: visitedPath tracks the identities on
 * the current stack, not all visited nodes — a diamond pattern (A→B, A→C, B→D,
 * C→D) is NOT a cycle; D is simply deduplicated by identity in the
 * accumulated set.
 */
export async function resolveComposition(
  entry: InventoryEntry,
  currentIdentity: string,
  visitedPath: Set<string>,
  depth: number,
  lookupFn: (name: string) => InventoryEntry | undefined,
): Promise<CompositionSetResult> {
// @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-accept-manifest

  const manifestResult = readManifestFromContent(entry.content);
  if (!manifestResult.ok) {
    return {
      ok: false,
      reason: 'resolve-error',
      ref: currentIdentity,
      message: `Cannot read manifest for "${currentIdentity}": ${manifestResult.message}`,
    };
  }
  const manifest = manifestResult.manifest;

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-cycle
  if (visitedPath.has(currentIdentity)) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-cycle-error
    return {
      ok: false,
      reason: 'cycle',
      // Reconstruct the cycle path for diagnostics — currentIdentity closes the loop
      path: [...visitedPath, currentIdentity],
    };
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-cycle-error
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-cycle

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-add-visited
  // Build a new Set so sibling branches don't contaminate each other's visited path.
  // Each DFS branch gets its own stack snapshot.
  const ownVisited = new Set(visitedPath);
  ownVisited.add(currentIdentity);
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-add-visited

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-read-composition-list
  // The set of templates this one references (a preset applies together). Each
  // entry carries a well-formed reference (`ref`) and the location it is applied at.
  const compositions = manifest.referencedTemplates ?? [];
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-read-composition-list

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-empty
  if (compositions.length === 0) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-leaf
    // A single entry for the current template — its identity, installed
    // content path, and declared ownership boundaries — as this node's sole
    // contribution to the per-template composition set.
    const leafTemplates = new Map<string, CompositionEntry>();
    leafTemplates.set(currentIdentity, {
      identity: currentIdentity,
      installedContentPath: entry,
      ownershipBoundaries: manifest.ownershipBoundaries,
    });
    return { ok: true, templates: leafTemplates };
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-leaf
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-empty

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-init-accumulator
  // Seed with an entry for the current template itself — its identity, its
  // installed content path, and its declared ownership boundaries (read from
  // its manifest).
  const accumulator = new Map<string, CompositionEntry>();
  accumulator.set(currentIdentity, {
    identity: currentIdentity,
    installedContentPath: entry,
    ownershipBoundaries: manifest.ownershipBoundaries,
  });
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-init-accumulator

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-foreach-ref
  for (const compositionRef of compositions) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-resolve-ref
    const childEntry = lookupFn(compositionRef.ref);
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-resolve-ref

    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-resolve-fail
    if (!childEntry) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-resolve-error
      return {
        ok: false,
        reason: 'resolve-error',
        ref: compositionRef.ref,
        message: `Composed template "${compositionRef.ref}" not found in inventory.`,
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-resolve-error
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-resolve-fail

    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-recurse
    const childResult = await resolveComposition(
      childEntry,
      compositionRef.ref,
      ownVisited,
      depth + 1,
      lookupFn,
    );
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-recurse

    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-recursion-error
    if (!childResult.ok) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-propagate-error
      return childResult;
      // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-propagate-error
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-recursion-error

    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-merge-with-collision-rule
    // Add every entry of the recursed per-template composition set into the
    // accumulating set, keyed by template identity — one entry per distinct
    // template regardless of whether its declared ownership boundaries
    // overlap another entry's; no target-path comparison, precedence, or
    // merge is applied at this step. Arbitration of any same-target-path
    // overlap is owned entirely by the pre-flight ownership-boundary conflict
    // check, not here.
    for (const [identity, childCompositionEntry] of childResult.templates) {
      accumulator.set(identity, childCompositionEntry);
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-merge-with-collision-rule
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-foreach-ref

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-resolved
  // The fully accumulated per-template composition set — every distinct
  // template encountered during resolution, each with its identity, installed
  // content path, and declared ownership boundaries, unarbitrated for
  // same-target-path overlaps — for the pre-flight ownership-boundary
  // conflict check to evaluate.
  return { ok: true, templates: accumulator };
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-resolved
}
