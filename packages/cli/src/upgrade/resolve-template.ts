// Helper consumed by cpt-frontx-algo-upgrade-changeset-compute (inst-cmp-resolve-baseline,
// inst-cmp-resolve-target) — not itself a CDSL-designated instruction, so it carries no
// @cpt-begin/@cpt-end block marker of its own; the markers live at the call sites in
// compute.ts, wrapping the lines that invoke this helper.
import { parseSourceSpec } from '../spec-parser/parse';
import { resolveToInventory } from '../resolver/resolve';
import type { FetchFn } from '../resolver/types';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry } from '../inventory/types';

export type ResolveTemplateAtVersionResult =
  | { ok: true; entry: InventoryEntry }
  | { ok: false; message: string };

/**
 * Re-resolves a template's content AT A SPECIFIC VERSION through the ONE shared
 * resolver (cpt-frontx-feature-template-resolution: parseSourceSpec + resolveToInventory) —
 * by parsing the provenance record's re-resolvable source-spec and overriding its version
 * selector with the requested version before fetching. This is the ONLY path the upgrade
 * engine uses to obtain baseline or target content; it never reads from the single-entry
 * local inventory, which retains only one version per entry and cannot supply an older
 * baseline once a newer version has replaced it there.
 */
export async function resolveTemplateAtVersion(
  sourceSpec: string,
  version: string,
  fetchFn: FetchFn,
): Promise<ResolveTemplateAtVersionResult> {
  const parsed = parseSourceSpec(sourceSpec);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error.message };
  }

  const refAtVersion = { ...parsed.value, ref: version };
  const resolved = await resolveToInventory(refAtVersion, fetchFn);
  if (!resolved.ok) {
    return { ok: false, message: resolved.error.message };
  }

  const record = resolved.value;
  return {
    ok: true,
    entry: {
      name: record.name,
      source: record.source,
      ref: record.ref,
      status: InventoryState.RESOLVED,
      content: record.content,
    },
  };
}
