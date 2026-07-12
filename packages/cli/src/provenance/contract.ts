// @cpt-algo:cpt-frontx-algo-composed-provenance-provenance-write:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-provenance-at-scaffold:p1

// Provenance storage path relative to project root — cpt-frontx-contract-project-provenance
export const PROVENANCE_RELATIVE_PATH = '.frontx/provenance.json' as const;

export function provenancePath(projectRoot: string): string {
  return `${projectRoot}/${PROVENANCE_RELATIVE_PATH}`;
}
