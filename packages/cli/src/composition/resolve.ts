// @cpt-algo:cpt-frontx-algo-composed-provenance-recursive-resolution:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-composition-delivered:p1
import type { TemplateManifest } from '../manifest/types.js';
import { readManifestFromContent } from '../manifest/validate-contract.js';
import type { InventoryEntry } from '../inventory/types.js';
import type { CollisionRecord, CompositionFileEntry, CompositionSetResult } from './types.js';

// @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-accept-manifest
/**
 * Recursively resolves a composed template tree into a flat file map.
 *
 * Nearest-declaration-wins semantics: a file at shallower depth overrides one
 * deeper in the tree. Files at equal depth but declared by different parents
 * are unresolvable collisions — the entire resolution aborts.
 *
 * DFS with path-based cycle detection: visitedPath tracks the identities on
 * the current stack, not all visited nodes — a diamond pattern (A→B, A→C, B→D,
 * C→D) is NOT a cycle and resolves through collision rules instead.
 */
export function resolveComposition(
  manifest: TemplateManifest,
  currentIdentity: string,
  visitedPath: Set<string>,
  depth: number,
  declaringParent: string | null,
  lookupFn: (name: string) => InventoryEntry | undefined,
): CompositionSetResult {
// @cpt-end:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-accept-manifest

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
  // Seed with own files — these are depth-stamped and declared by this template.
  const accumulator = new Map<string, CompositionFileEntry>();
  for (const file of manifest.files ?? []) {
    accumulator.set(file.path, {
      path: file.path,
      content: file.content,
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

    const childManifestResult = readManifestFromContent(childEntry.content);
    if (!childManifestResult.ok) {
      return {
        ok: false,
        reason: 'resolve-error',
        ref: compositionRef.ref,
        message: `Cannot read manifest for "${compositionRef.ref}": ${childManifestResult.message}`,
      };
    }

    // @cpt-begin:cpt-frontx-algo-composed-provenance-recursive-resolution:p1:inst-recurse
    const childResult = resolveComposition(
      childManifestResult.manifest,
      compositionRef.ref,
      ownVisited,
      depth + 1,
      currentIdentity,
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
