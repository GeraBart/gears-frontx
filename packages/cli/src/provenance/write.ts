// @cpt-algo:cpt-frontx-algo-composed-provenance-provenance-write:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1
import { provenancePath } from './contract';
import type { ProvenanceRecord, ProvenanceWriteFn } from './types';

export type WriteProvenanceResult =
  | { ok: true; location: string }
  | { ok: false; message: string };

// @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-accept-provenance-inputs
export async function writeProvenance(
  record: ProvenanceRecord,
  projectRoot: string,
  writeFn: ProvenanceWriteFn,
): Promise<WriteProvenanceResult> {
// @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-accept-provenance-inputs

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-construct-provenance
  const serialized = JSON.stringify(record, null, 2);
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-construct-provenance

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-determine-storage-location
  const location = provenancePath(projectRoot);
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-determine-storage-location

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-write-record
  try {
    await writeFn(location, serialized);
  } catch (err) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-check-write-fail
    // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-write-error
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to write provenance record: ${message}` };
    // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-write-error
    // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-check-write-fail
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-write-record

  // @cpt-begin:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-provenance-location
  return { ok: true, location };
  // @cpt-end:cpt-frontx-algo-composed-provenance-provenance-write:p1:inst-return-provenance-location
}
