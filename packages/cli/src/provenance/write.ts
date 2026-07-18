// @cpt-algo:cpt-frontx-algo-composed-provenance-provenance-write:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1
import { provenancePath } from './contract';
import type { ProvenanceRecord, ProvenanceWriteFn } from './types';

export type WriteProvenanceResult =
  | { ok: true; location: string }
  | { ok: false; message: string };

// @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-accept-provenance-inputs
/**
 * Writes ONE in-repository provenance record PER applied template — a SET of
 * records, never a single whole-repository origin record
 * (cpt-frontx-contract-project-provenance). Accepts either a single applied
 * template or the full set — callers with exactly one applied template may
 * pass it directly; it is normalized into the set this algorithm iterates.
 */
export async function writeProvenance(
  applied: ProvenanceRecord | ProvenanceRecord[],
  projectRoot: string,
  writeFn: ProvenanceWriteFn,
): Promise<WriteProvenanceResult> {
  const appliedTemplates = Array.isArray(applied) ? applied : [applied];
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-accept-provenance-inputs

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-determine-storage-location
  const location = provenancePath(projectRoot);
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-determine-storage-location

  const records: ProvenanceRecord[] = [];

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-foreach-applied
  for (const template of appliedTemplates) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-construct-provenance
    const record: ProvenanceRecord = {
      templateIdentity: template.templateIdentity,
      scaffoldedFromVersion: template.scaffoldedFromVersion,
      sourceSpec: template.sourceSpec,
      occupiedOwnershipBoundary: template.occupiedOwnershipBoundary ?? '.',
    };
    records.push(record);
    // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-construct-provenance

    // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-write-record
    try {
      // Re-write the durable, human-readable provenance SET after each
      // constructed record so the store never contains a partial template's
      // record without the ones already accumulated before it.
      await writeFn(location, JSON.stringify(records, null, 2));
    } catch (err) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-check-write-fail
      // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-write-error
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Failed to write provenance record for "${template.templateIdentity}": ${message}`,
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-write-error
      // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-check-write-fail
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-write-record
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-foreach-applied

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-provenance-location
  return { ok: true, location };
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-provenance-location
}
