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

// A single repository file materialized by the algorithm — either a
// whole-file single-owner write or the composed disjoint-region union.
export interface MaterializedFile {
  path: string;
  content: string;
}

// The algorithm's outcome: the full set of materialized repository files
// (`inst-cs-return-materialized`), or one of three refusals — the two
// declared-level materialization invariants (both of which name a condition
// the pre-flight conflict check, `cpt-frontx-algo-cli-scaffolding-conflict-check`,
// should already have refused, so reaching either here is a bug in that
// earlier gate rather than a normal refusal path), or the content-level
// span-overlap conflict that only materialization can observe.
export type ComposeSharedFilesResult =
  | { ok: true; files: MaterializedFile[] }
  | { ok: false; reason: 'exclusive-contested'; path: string; contestants: string[]; message: string }
  | { ok: false; reason: 'key-collision'; path: string; regionKey: string; contestants: string[]; message: string }
  | {
      ok: false;
      reason: 'span-overlap';
      path: string;
      contestants: string[];
      regionKeys: string[];
      message: string;
    };

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

// The actual on-disk line-index span of one located marker pair — the
// content-level position that pt.2's span-overlap check (inst-cs-if-span-overlap)
// compares across regions; a declared region key alone (checked by pt.1's
// inst-cs-if-key-collision) cannot reveal this.
interface RegionSpan {
  beginIndex: number;
  endIndex: number;
}

// Locates one template's owned region on disk by matching the begin/end
// sentinel-marker pair keyed by that template's identity and the declared
// region key. Returns undefined if the pair cannot be located — pre-publish
// manifest validation guarantees well-formed declared keys, not that the
// markers exist on disk.
function locateRegionSpan(content: string, templateName: string, regionKey: string): RegionSpan | undefined {
  const lines = content.split('\n');
  const beginMarker = `${REGION_BEGIN_PREFIX} ${templateName}:${regionKey}`;
  const endMarker = `${REGION_END_PREFIX} ${templateName}:${regionKey}`;
  const beginIndex = lines.findIndex((line) => line.includes(beginMarker));
  if (beginIndex === -1) return undefined;
  const endIndex = lines.findIndex((line, index) => index > beginIndex && line.includes(endMarker));
  if (endIndex === -1) return undefined;
  return { beginIndex, endIndex };
}

// Locates and extracts one template's owned region from its installed
// content by matching the begin/end sentinel-marker pair keyed by that
// template's identity and the declared region key. Returns the region text
// INCLUSIVE of its marker lines, undefined if the pair cannot be located.
function extractOwnedRegion(content: string, templateName: string, regionKey: string): string | undefined {
  const span = locateRegionSpan(content, templateName, regionKey);
  if (!span) return undefined;
  const lines = content.split('\n');
  return lines.slice(span.beginIndex, span.endIndex + 1).join('\n');
}

// @cpt-algo:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1
/**
 * Groups the conflict-cleared staged assembly's contributions by target
 * repository file path, writes the whole-file single-owner paths directly,
 * and — for every path with any `region-union` contribution — guards the two
 * declared-level materialization invariants (a contested `exclusive` path, or
 * two contributors resolving the same declared region key) that the
 * pre-flight conflict check (`cpt-frontx-algo-cli-scaffolding-conflict-check`)
 * should already have refused, before extracting each contributor's owned
 * region by its identity-and-region-key sentinel markers, refusing the
 * assembly if any two extracted regions' actual on-disk marker spans
 * overlap — the content-level check only materialization can observe —
 * composing the collision-free set as a deterministic disjoint union with
 * markers preserved, and writing the composed file. Returns every
 * materialized repository file.
 */
export async function composeSharedFiles(
  assembly: StagedAssembly,
  targetDir: string,
  writeFileFn: WriteFileFn,
): Promise<ComposeSharedFilesResult> {
  const grouped = groupContributionsByPath(assembly);
  const materializedFiles: MaterializedFile[] = [];

  for (const [path, entries] of grouped) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-single
    // A target file path owned whole by exactly one template — an exclusive
    // subtree or a whole-file `exclusive` claim (both resolve to
    // mergeStrategy 'exclusive' above).
    if (entries.length === 1 && entries[0].mergeStrategy === 'exclusive') {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-single
      await writeFileFn(`${targetDir}/${path}`, entries[0].content);
      materializedFiles.push({ path, content: entries[0].content });
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

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-span-overlap
    // Re-locates each extracted region's actual on-disk line-index span (not
    // carried by `ExtractedRegion` — pt.1 only needed the marker text) to
    // detect an overlap that neither manifest validation (well-formed keys
    // only) nor the pre-flight conflict check (declared keys only) can see.
    // A line-index span is only meaningful relative to the buffer it was
    // located in, so two regions are only compared when they were located in
    // the SAME on-disk buffer — trivially true for a single template's own
    // multiple keys (self-overlap), and true for two different templates only
    // when both ship byte-identical content for the shared path (the
    // canonical-shared-file convention `cpt-frontx-feature-template-manifest`
    // expects a region-union path to follow), which is what makes
    // cross-template overlap detectable at all.
    const contentByTemplate = new Map(entries.map((entry) => [entry.templateName, entry.content]));
    const spans = extracted.map((region) => {
      const content = contentByTemplate.get(region.templateName);
      const span = content ? locateRegionSpan(content, region.templateName, region.regionKey) : undefined;
      return { region, content, span };
    });
    let overlappingPair: [ExtractedRegion, ExtractedRegion] | undefined;
    for (let i = 0; i < spans.length && !overlappingPair; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i];
        const b = spans[j];
        if (!a.span || !b.span || a.content !== b.content) continue;
        if (a.span.beginIndex <= b.span.endIndex && b.span.beginIndex <= a.span.endIndex) {
          overlappingPair = [a.region, b.region];
          break;
        }
      }
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-span-overlap
    if (overlappingPair) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-span-overlap
      const [regionA, regionB] = overlappingPair;
      return {
        ok: false,
        reason: 'span-overlap',
        path,
        contestants: [regionA.templateName, regionB.templateName],
        regionKeys: [regionA.regionKey, regionB.regionKey],
        message:
          `Materialization conflict — path "${path}" has overlapping on-disk marker spans between ` +
          `${regionA.templateName}:${regionA.regionKey} and ${regionB.templateName}:${regionB.regionKey}; ` +
          'refusing the assembly and writing no file.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-span-overlap
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-compose-union
    // Deterministic order — by owning template identity, then region key —
    // so re-materializing the same collision-free assembly always produces
    // byte-identical output.
    const orderedRegions = [...extracted].sort((a, b) =>
      a.templateName === b.templateName
        ? a.regionKey.localeCompare(b.regionKey)
        : a.templateName.localeCompare(b.templateName),
    );
    const composedContent = orderedRegions.map((region) => region.markerBlock).join('\n');
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-compose-union

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-composed
    await writeFileFn(`${targetDir}/${path}`, composedContent);
    materializedFiles.push({ path, content: composedContent });
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-composed
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-multi
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-materialized
  return { ok: true, files: materializedFiles };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-materialized
}
