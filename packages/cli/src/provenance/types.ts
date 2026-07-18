// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1

// @cpt-begin:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1:inst-accept-provenance-inputs
export interface ProvenanceRecord {
  templateIdentity: string;
  scaffoldedFromVersion: string;
  sourceSpec: string;
  /**
   * The ownership boundary this template occupied within the composed
   * project (cpt-frontx-contract-project-provenance). Optional at the input
   * boundary so callers that have not yet resolved a boundary can omit it;
   * `writeProvenance` always fills a concrete value on the written record.
   */
  occupiedOwnershipBoundary?: string;
}
// @cpt-end:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1:inst-accept-provenance-inputs

// Injected write function for provenance — same shape as WriteFileFn for symmetry
export type ProvenanceWriteFn = (path: string, content: string) => Promise<void>;
