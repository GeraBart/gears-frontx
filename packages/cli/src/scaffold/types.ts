import type { OwnershipBoundary, TemplateFile } from '../manifest/types.js';

// Injected write function — caller supplies; no direct filesystem access in core logic.
export type WriteFileFn = (destPath: string, content: string) => Promise<void>;

// Injected conflict check — returns true when the target directory has conflicting content.
// Used by the composed-provenance (F13) scaffolder; unrelated to the kindless
// assembly-op's boundary-intersection conflict verdict (cpt-frontx-state-cli-scaffolding-assembly-op).
export type ConflictCheckFn = (targetDir: string) => Promise<boolean>;

// A single applied template's contribution to a staged assembly — the content
// items it delivers plus the ownership boundaries it declares, tagged with its
// identity (cpt-frontx-algo-cli-scaffolding-uniform-apply inst-ua-stage-contribution).
export interface ContributionEntry {
  templateName: string;
  files: TemplateFile[];
  ownershipBoundaries: OwnershipBoundary;
}

// The staged assembly produced by the uniform apply path — carries every
// applied template's contribution and declared boundaries, ready for the
// pre-flight conflict check (P29) to evaluate.
export interface StagedAssembly {
  contributions: ContributionEntry[];
}
