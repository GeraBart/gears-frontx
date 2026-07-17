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

// F16 cross-pillar edge (F16 <- F10): install-time extension discovery hook
export type { DiscoveryHookContext, DiscoveryHookResult, ExtensionDiscoveryHook } from './discovery/types.js';

export { listCommand } from './commands/list.js';
export type { ListEntry } from './commands/list.js';

export { updateLocalCommand } from './commands/update-local.js';
export type { UpdateLocalResult } from './commands/update-local.js';

export { validateManifestContract, readManifestFromContent } from './manifest/validate-contract.js';
export { validateCommand } from './commands/validate.js';
export type {
  TemplateManifest,
  TemplateFile,
  OwnershipBoundary,
  SharedFileEntry,
  ReferencedTemplate,
  ManifestViolation,
  ManifestValidationResult,
  ManifestValidationState,
  ReadFileFn,
} from './manifest/types.js';
export type { ReadManifestResult } from './manifest/validate-contract.js';
export type { ValidateCommandResult } from './commands/validate.js';
export { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from './manifest/types.js';

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
// There is exactly ONE engine. Direct CLI invocation uses these canonical
// modules internally. F17 AI-driven orchestration does NOT import these
// modules or take a compile-time package dependency on this package for its
// engine access — it reaches this same engine only through the `frontx
// upgrade` command/invocation surface (`upgradeCommand`, ./commands/upgrade.js),
// per DESIGN §3.4 ("orchestrates ... through its command surface ... NOT by
// linking its engine").
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

// F14 command/invocation surface — the ONLY integration path F17 (and any
// other external artifact) should use to drive the change-set engine.
export { upgradeCommand } from './commands/upgrade.js';
export type { UpgradeCommandResult } from './commands/upgrade.js';
