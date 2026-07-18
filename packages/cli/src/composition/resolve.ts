// @cpt-algo:cpt-frontx-algo-composed-provenance-recursive-resolution:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-composition-delivered:p1
import { readManifestFromContent } from '../manifest/validate-contract';
import type { InventoryEntry } from '../inventory/types';
import type { ReadContentItemsFn } from '../scaffold/types';
import type { CollisionRecord, CompositionFileEntry, CompositionSetResult } from './types';

// @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-accept-manifest
/**
 * Recursively resolves a composed template tree into a flat file map.
 *
 * Content items are read directly from each template's resolved on-disk
 * installed content path (via the injected `readContentFn` seam) — the
 * manifest carries no content (cpt-frontx-algo-cli-scaffolding-uniform-apply
 * inst-ua-read-content).
 *
 * Nearest-declaration-wins semantics: a file at shallower depth overrides one
 * deeper in the tree. Files at equal depth but declared by different parents
 * are unresolvable collisions — the entire resolution aborts.
 *
 * DFS with path-based cycle detection: visitedPath tracks the identities on
 * the current stack, not all visited nodes — a diamond pattern (A→B, A→C, B→D,
 * C→D) is NOT a cycle and resolves through collision rules instead.
 */
export async function resolveComposition(
  entry: InventoryEntry,
  currentIdentity: string,
  visitedPath: Set<string>,
  depth: number,
  declaringParent: string | null,
  lookupFn: (name: string) => InventoryEntry | undefined,
  readContentFn: ReadContentItemsFn,
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

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-init-accumulator
  // Seed with own content items — read directly from the installed content
  // path (never from the manifest) — depth-stamped and declared by this template.
  const ownItems = await readContentFn(entry);
  const accumulator = new Map<string, CompositionFileEntry>();
  for (const item of ownItems) {
    accumulator.set(item.path, {
      path: item.path,
      content: item.content,
      depth,
      declaringParent,
    });
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-init-accumulator

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-empty
  if (compositions.length === 0) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-leaf
    return { ok: true, files: accumulator };
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-leaf
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-empty

  const collisions: CollisionRecord[] = [];

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
      currentIdentity,
      lookupFn,
      readContentFn,
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
    for (const [filePath, incoming] of childResult.files) {
      const existing = accumulator.get(filePath);

      if (!existing) {
        // No conflict — just add.
        accumulator.set(filePath, incoming);
        continue;
      }

      if (existing.depth < incoming.depth) {
        // Existing is shallower — keep it silently.
        continue;
      }

      if (existing.depth > incoming.depth) {
        // Incoming is shallower — replace silently.
        accumulator.set(filePath, incoming);
        continue;
      }

      // Same depth: check declaring parent
      if (existing.declaringParent === incoming.declaringParent) {
        // Same parent, first-declared wins — keep existing silently.
        continue;
      }

      // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-unresolvable-collision
      // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-record-collision
      collisions.push({
        path: filePath,
        existingParent: existing.declaringParent,
        newParent: incoming.declaringParent,
        depth: existing.depth,
      });
      // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-record-collision
      // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-unresolvable-collision
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-merge-with-collision-rule
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-foreach-ref

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-any-collisions
  if (collisions.length > 0) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-collision-report
    return { ok: false, reason: 'collision', collisions };
    // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-collision-report
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-check-any-collisions

  // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-resolved
  return { ok: true, files: accumulator };
  // @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-return-resolved
}
