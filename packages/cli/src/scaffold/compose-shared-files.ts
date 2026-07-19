import type { OwnershipBoundary } from '../manifest/types';
import type { StagedAssembly, WriteFileFn } from './types';

// Region-addressing schema owned by `cpt-frontx-feature-template-manifest`: a
// `region-union` shared-file entry's owned region is delimited on disk by a
// matched begin/end sentinel-marker pair embedding the owning template's
// identity and the region key — a comment-style marker line pair of the
// shape `frontx:region <identity>:<key>` … `frontx:endregion <identity>:<key>`.
const REGION_BEGIN_PREFIX = 'frontx:region';
const REGION_END_PREFIX = 'frontx:endregion';

// A single template's declared claim on one target repository file path,
// carrying the identity, declared merge strategy, and owned region keys
// needed to resolve write ownership. `mergeStrategy` mirrors
// `SharedFileEntry.mergeStrategy` (a closed set already validated upstream by
// the manifest contract) — kept as `string` here rather than narrowed via a
// cast.
interface PathContribution {
  templateName: string;
  mergeStrategy: string;
  ownedRegions: string[];
  content: string;
}

// One contributing template's extracted region-union content for a shared
// path — the sentinel markers are preserved in `markerBlock` so a later
// boundary-scoped upgrade, and the pt.2 disjoint-union composition (out of
// scope here), can re-locate it.
export interface ExtractedRegion {
  templateName: string;
  regionKey: string;
  markerBlock: string;
}

// Part 1 outcome: either the collision-cleared, extracted per-path region set
// staged for the pt.2 span-overlap check + composition (not implemented
// here), or one of the two materialization-invariant refusals — both of which
// name a condition the pre-flight conflict check
// (`cpt-frontx-algo-cli-scaffolding-conflict-check`) should already have
// refused, so reaching either here is a bug in that earlier gate rather than
// a normal refusal path.
export type ComposeSharedFilesResult =
  | { ok: true; multiContributorGroups: Map<string, ExtractedRegion[]> }
  | { ok: false; reason: 'exclusive-contested'; path: string; contestants: string[]; message: string }
  | { ok: false; reason: 'key-collision'; path: string; regionKey: string; contestants: string[]; message: string };

// Resolves a single content item's declared ownership on its own path — a
// whole-file `exclusive` claim when no shared-file entry declares the path
// (it is written whole by its template because it falls under a declared
// exclusive subtree), or the declared merge strategy + owned region keys
// when a shared-file entry declares it.
function resolvePathContribution(
  templateName: string,
  path: string,
  content: string,
  boundaries: OwnershipBoundary,
): PathContribution {
  const sharedEntry = boundaries.sharedFiles.find((entry) => entry.path === path);
  if (!sharedEntry) {
    return { templateName, mergeStrategy: 'exclusive', ownedRegions: [], content };
  }
  return { templateName, mergeStrategy: sharedEntry.mergeStrategy, ownedRegions: sharedEntry.ownedRegions, content };
}

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-group-by-path
/**
 * Groups the staged assembly's contributions by target repository file path,
 * carrying each contributing template's identity, declared merge strategy,
 * and owned region keys.
 */
export function groupContributionsByPath(assembly: StagedAssembly): Map<string, PathContribution[]> {
  const grouped = new Map<string, PathContribution[]>();
  for (const contribution of assembly.contributions) {
    for (const file of contribution.files) {
      const entry = resolvePathContribution(
        contribution.templateName,
        file.path,
        file.content,
        contribution.ownershipBoundaries,
      );
      const existing = grouped.get(file.path);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(file.path, [entry]);
      }
    }
  }
  return grouped;
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-group-by-path

// Locates and extracts one template's owned region from its installed
// content by matching the begin/end sentinel-marker pair keyed by that
// template's identity and the declared region key. Returns the region text
// INCLUSIVE of its marker lines, undefined if the pair cannot be located —
// pre-publish manifest validation guarantees well-formed declared keys, not
// that the markers exist on disk, so a caller-side treatment of a missing
// pair is left to the pt.2 phase that consumes this extraction.
function extractOwnedRegion(content: string, templateName: string, regionKey: string): string | undefined {
  const lines = content.split('\n');
  const beginMarker = `${REGION_BEGIN_PREFIX} ${templateName}:${regionKey}`;
  const endMarker = `${REGION_END_PREFIX} ${templateName}:${regionKey}`;
  const beginIndex = lines.findIndex((line) => line.includes(beginMarker));
  if (beginIndex === -1) return undefined;
  const endIndex = lines.findIndex((line, index) => index > beginIndex && line.includes(endMarker));
  if (endIndex === -1) return undefined;
  return lines.slice(beginIndex, endIndex + 1).join('\n');
}

// @cpt-algo:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1
/**
 * Part 1 of the compose-shared-files algorithm. Groups the conflict-cleared
 * staged assembly's contributions by target repository file path, writes the
 * whole-file single-owner paths directly, and — for every path with any
 * `region-union` contribution — guards the two materialization-invariant
 * collisions (a contested `exclusive` path, or two contributors resolving
 * the same declared region key) that the pre-flight conflict check
 * (`cpt-frontx-algo-cli-scaffolding-conflict-check`) should already have
 * refused, before extracting each contributor's owned region by its
 * identity-and-region-key sentinel markers.
 *
 * Part 2 — span-overlap detection, disjoint-union composition, and writing
 * the composed file — is a separate, later phase; this function returns the
 * extracted, collision-cleared per-path region set for that phase to consume.
 */
export async function composeSharedFiles(
  assembly: StagedAssembly,
  targetDir: string,
  writeFileFn: WriteFileFn,
): Promise<ComposeSharedFilesResult> {
  const grouped = groupContributionsByPath(assembly);
  const multiContributorGroups = new Map<string, ExtractedRegion[]>();

  for (const [path, entries] of grouped) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-single
    // A target file path owned whole by exactly one template — an exclusive
    // subtree or a whole-file `exclusive` claim (both resolve to
    // mergeStrategy 'exclusive' above).
    if (entries.length === 1 && entries[0].mergeStrategy === 'exclusive') {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-single
      await writeFileFn(`${targetDir}/${path}`, entries[0].content);
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-single
      continue;
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-single

    const hasRegionUnionContribution = entries.some((entry) => entry.mergeStrategy === 'region-union');
    // A contested exclusive-only path (no region-union contributor at all)
    // is out of this algorithm's scope — the pre-flight conflict check's
    // exclusive-clash rule already prevents it from reaching materialization.
    if (!hasRegionUnionContribution) continue;

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-multi
    // Any target file path with a region-union contribution — one
    // contributor or many.
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-exclusive-contested
    const exclusiveContested = entries.length > 1 && entries.some((entry) => entry.mergeStrategy === 'exclusive');
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-exclusive-contested
    if (exclusiveContested) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-exclusive-invariant
      return {
        ok: false,
        reason: 'exclusive-contested',
        path,
        contestants: entries.map((entry) => entry.templateName),
        message:
          `Materialization invariant violated — path "${path}" has a contested exclusive claim; ` +
          'the pre-flight conflict check should have refused this assembly before any file was written.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-exclusive-invariant
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-extract-regions
    const extracted: ExtractedRegion[] = [];
    for (const entry of entries) {
      if (entry.mergeStrategy !== 'region-union') continue;
      for (const regionKey of entry.ownedRegions) {
        const markerBlock = extractOwnedRegion(entry.content, entry.templateName, regionKey);
        if (markerBlock === undefined) continue;
        extracted.push({ templateName: entry.templateName, regionKey, markerBlock });
      }
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-extract-regions

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-key-collision
    const ownersByRegionKey = new Map<string, string[]>();
    for (const region of extracted) {
      const owners = ownersByRegionKey.get(region.regionKey);
      if (owners) {
        owners.push(region.templateName);
      } else {
        ownersByRegionKey.set(region.regionKey, [region.templateName]);
      }
    }
    const collidedRegionKey = [...ownersByRegionKey.entries()].find(([, owners]) => owners.length > 1);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-key-collision
    if (collidedRegionKey) {
      const [regionKey, owners] = collidedRegionKey;
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-key-invariant
      return {
        ok: false,
        reason: 'key-collision',
        path,
        regionKey,
        contestants: owners,
        message:
          `Materialization invariant violated — path "${path}" has two contributors resolving region key ` +
          `"${regionKey}" (${owners.join(', ')}); the pre-flight conflict check should have refused this assembly.`,
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-key-invariant
    }

    // Staged for the pt.2 phase: span-overlap detection, disjoint-union
    // composition, and writing the composed file (out of scope here).
    multiContributorGroups.set(path, extracted);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-multi
  }

  return { ok: true, multiContributorGroups };
}
