import { readManifestFromContent } from '../manifest/validate-contract';
import { writeProvenance } from '../provenance/write';
import type { ProvenanceRecord, ProvenanceWriteFn } from '../provenance/types';
import type { InventoryEntry } from '../inventory/types';
import type { OccupiedBoundaryEntry } from './state';
import type { StagedAssembly, WriteFileFn } from './types';

// Injected reader for a target repository's existing provenance records —
// empty for a seed (the target is empty by definition) or the repository's
// current records for an add (cpt-frontx-flow-cli-scaffolding-add-template).
export type ReadProvenanceRecordsFn = (targetDir: string) => Promise<ProvenanceRecord[]>;

// Derives the ownership boundaries already occupied by a repository's
// previously-applied templates by cross-referencing each existing provenance
// record's template identity against the local inventory — the boundaries
// cpt-frontx-flow-cli-scaffolding-add-template submits to the pre-flight
// conflict check TOGETHER WITH the newly staged assembly.
export function occupiedBoundariesFromProvenance(
  records: ProvenanceRecord[],
  lookupFn: (name: string) => InventoryEntry | undefined,
): OccupiedBoundaryEntry[] {
  const occupied: OccupiedBoundaryEntry[] = [];
  for (const record of records) {
    const entry = lookupFn(record.templateIdentity);
    if (!entry) continue;
    const manifestResult = readManifestFromContent(entry.content);
    if (!manifestResult.ok) continue;
    occupied.push({ templateName: record.templateIdentity, boundary: manifestResult.manifest.ownershipBoundaries });
  }
  return occupied;
}

export type MaterializeResult = { ok: true } | { ok: false; message: string };

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-boundary-declared-assembly:p1
/**
 * Realizes the boundary-declared-assembly DoD. The staged assembly already
 * carries, per applied template, ownership boundaries read from its manifest
 * and content items read from its installed content path scoped to those
 * declared boundaries — never from the manifest — via the P14 uniform-apply
 * path (cpt-frontx-algo-cli-scaffolding-uniform-apply). This function writes
 * that staged content into `targetDir`, then writes one provenance record PER
 * applied template — appended to any records the target already holds
 * (add-template) rather than overwriting them; a seed always starts from an
 * empty `existingProvenance` set.
 */
export async function materializeAssembly(
  assembly: StagedAssembly,
  targetDir: string,
  existingProvenance: ProvenanceRecord[],
  lookupFn: (name: string) => InventoryEntry | undefined,
  writeFileFn: WriteFileFn,
  provenanceWriteFn: ProvenanceWriteFn,
): Promise<MaterializeResult> {
  for (const contribution of assembly.contributions) {
    for (const file of contribution.files) {
      await writeFileFn(`${targetDir}/${file.path}`, file.content);
    }
  }

  const newRecords: ProvenanceRecord[] = assembly.contributions.map((contribution) => {
    const entry = lookupFn(contribution.templateName);
    const manifestResult = entry ? readManifestFromContent(entry.content) : undefined;
    return {
      templateIdentity: contribution.templateName,
      scaffoldedFromVersion: manifestResult && manifestResult.ok ? manifestResult.manifest.version : '',
      sourceSpec: entry?.source ?? '',
    };
  });

  const result = await writeProvenance([...existingProvenance, ...newRecords], targetDir, provenanceWriteFn);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true };
}
