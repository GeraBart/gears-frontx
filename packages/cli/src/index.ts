// @cpt-component:cpt-frontx-component-cli:p1
// @cpt-constraint:cpt-frontx-constraint-cli-template-independence:p1
// Zero template content is bundled in this package.
// All template resolution happens at runtime via source-spec.

export { parseSourceSpec } from './spec-parser/parse.js';
export type { StructuredRef, ParseError, ParseResult } from './spec-parser/types.js';

export { resolveToInventory } from './resolver/resolve.js';
export type { FetchFn, InventoryReadyRecord, ResolutionError, ResolveResult } from './resolver/types.js';

export { TemplateInventory } from './inventory/TemplateInventory.js';
export { InventoryIndex } from './inventory/InventoryIndex.js';
export { InventoryStore } from './inventory/InventoryStore.js';
export { InventoryState } from './inventory/types.js';
export type { InventoryEntry, InventoryError, InventoryResult } from './inventory/types.js';

export { installCommand } from './commands/install.js';
export type { InstallCommandResult } from './commands/install.js';

export { listCommand } from './commands/list.js';
export type { ListEntry } from './commands/list.js';

export { updateLocalCommand } from './commands/update-local.js';
export type { UpdateLocalResult } from './commands/update-local.js';

export { validateManifestContract, readManifestFromContent } from './manifest/validate-contract.js';
export { validateCommand } from './commands/validate.js';
export type {
  TemplateManifest,
  TemplateFile,
  CompositionRef,
  ManifestViolation,
  ManifestValidationResult,
  ManifestValidationState,
  ReadFileFn,
} from './manifest/types.js';
export type { ReadManifestResult } from './manifest/validate-contract.js';
export type { ValidateCommandResult } from './commands/validate.js';
export { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION, RECOGNIZED_KINDS } from './manifest/types.js';

export { routeNamespaceCommand } from './namespaces/route.js';
export { NAMESPACE_REGISTRY } from './namespaces/types.js';
export type { Namespace, NamespaceRouteInput, NamespaceRouteResult } from './namespaces/types.js';

export { scaffoldProject } from './scaffold/project.js';
export { scaffoldMfe } from './scaffold/mfe.js';
export { scaffoldComposedProject } from './scaffold/composed.js';
export type { ComposedScaffoldResult } from './scaffold/composed.js';
export { ScaffoldState } from './scaffold/state.js';
export type { ScaffoldResult, WriteFileFn, ConflictCheckFn } from './scaffold/types.js';

export { resolveComposition } from './composition/resolve.js';
export { CompositionResolutionState } from './composition/state.js';
export type { CompositionFileEntry, CollisionRecord, CompositionSetResult } from './composition/types.js';

export { writeProvenance } from './provenance/write.js';
export type { WriteProvenanceResult } from './provenance/write.js';
export type { ProvenanceRecord, ProvenanceWriteFn } from './provenance/types.js';
export { PROVENANCE_RELATIVE_PATH, provenancePath } from './provenance/contract.js';

// F14 Upgrade Change-Set Engine (cpt-frontx-dod-upgrade-changeset-single-engine)
// Both direct CLI invocation and F17 AI-driven orchestration import from these canonical modules.
export { upgradeChangeSetReviewApproval } from './upgrade/flow.js';
export type { UpgradeFlowResult, UpgradeFlowDeps } from './upgrade/flow.js';
export { computeChangeSet } from './upgrade/compute.js';
export type { ComputeResult } from './upgrade/compute.js';
export { applyChangeSet } from './upgrade/apply.js';
export type { ApplyResult } from './upgrade/apply.js';
export { rollbackChangeSet } from './upgrade/rollback.js';
export type { RollbackResult } from './upgrade/rollback.js';
export { ChangeSetLifecycleState } from './upgrade/state.js';
export type {
  ChangeKind,
  CleanEntry,
  ConflictEntry,
  ChangeSet,
  ProjectSnapshot,
  ReadProvenanceFn,
  VersionedLookupFn,
  ReadProjectFileFn,
  WriteProjectFileFn,
  RemoveProjectFileFn,
  WriteProvenanceFn,
  PresentAndGetApprovalFn,
} from './upgrade/types.js';
