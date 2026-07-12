// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1

// @cpt-begin:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1:inst-accept-provenance-inputs
export interface ProvenanceRecord {
  templateIdentity: string;
  scaffoldedFromVersion: string;
  sourceSpec: string;
}
// @cpt-end:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1:inst-accept-provenance-inputs

// Injected write function for provenance — same shape as WriteFileFn for symmetry
export type ProvenanceWriteFn = (path: string, content: string) => Promise<void>;
