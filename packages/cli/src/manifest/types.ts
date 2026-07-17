// @cpt-algo:cpt-frontx-algo-template-manifest-validate-contract:p1
// @cpt-state:cpt-frontx-state-template-manifest-validation-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-single-description:p1

export const MANIFEST_FILENAME = 'frontx-template.json';
export const MANIFEST_SCHEMA_VERSION = '1.0';

// Single content item within a template — delivered at scaffold/assembly time.
export interface TemplateFile {
  path: string;    // relative path within the template
  content: string; // file content to write at destination
}

// Ownership category (3b): per shared file, the regions this template owns and
// the merge strategy applied when another template also writes it.
export interface SharedFileEntry {
  path: string;           // repository-relative path of the shared file
  mergeStrategy: string;  // declared merge strategy for this shared file
  ownedRegions: string[]; // the keys/regions this template owns within the file
}

// Ownership category (3): the ground a template owns — the exclusive subtrees it
// alone writes and, per shared file, the regions it owns with a declared merge.
export interface OwnershipBoundary {
  exclusiveSubtrees: string[];    // subtrees the template alone writes (repo-relative paths)
  sharedFiles: SharedFileEntry[]; // per-shared-file ownership declarations
}

// Referenced-templates category (4): a template a preset applies together, each
// with the target location it is applied at.
export interface ReferencedTemplate {
  ref: string;       // well-formed template reference (source-spec or registered name)
  appliedAt: string; // the target location the referenced template is applied at
}

// Single authoritative contract — cpt-frontx-contract-template-manifest.
// EXACTLY four declared categories: identity, version, ownership boundaries,
// referenced templates. The same shape is checked at pre-publish validation and
// consumed at install, apply, and assembly time — no per-command divergence.
export interface TemplateManifest {
  schemaVersion?: string;                     // optional; absent = '1.0'; enables forward-reading
  name: string;                               // (1) identity
  version: string;                            // (2) version — versioned shape
  ownershipBoundaries: OwnershipBoundary;     // (3) ownership boundaries
  referencedTemplates?: ReferencedTemplate[]; // (4) referenced templates (a preset applies together)
  files?: TemplateFile[];                     // content items delivered at scaffold/assembly time
}

export interface ManifestViolation {
  field: string;
  message: string;
}

export type ManifestValidationResult =
  | { status: 'VALIDATED'; violations: [] }
  | { status: 'REJECTED'; violations: ManifestViolation[] };

// State machine states — cpt-frontx-state-template-manifest-validation-lifecycle
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-validated
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-rejected
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-rejected-to-draft
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-validated-to-published
export type ManifestValidationState = 'DRAFT' | 'VALIDATED' | 'REJECTED' | 'PUBLISHED';
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-validated-to-published
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-rejected-to-draft
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-rejected
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-validated

// ReadFileFn — injected for testability (no fs calls in core logic)
export type ReadFileFn = (path: string) => Promise<string>;
