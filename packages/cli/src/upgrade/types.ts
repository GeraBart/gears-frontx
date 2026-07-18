// @cpt-dod:cpt-frontx-dod-upgrade-changeset-computation:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-apply:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-rollback:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-single-engine:p1
import type { ProvenanceRecord } from '../provenance/types';
import type { InventoryEntry } from '../inventory/types';

export type { ProvenanceRecord };

export type ChangeKind = 'add' | 'modify' | 'remove';

// @cpt-begin:cpt-frontx-dod-upgrade-changeset-computation:p1:inst-change-set-types
export interface CleanEntry {
  kind: ChangeKind;
  path: string;
  content?: string; // undefined for 'remove'
}

export interface ConflictEntry {
  path: string;
  templateKind: ChangeKind;
  templateContent?: string;
  localContent: string; // current developer-modified content
}

export interface ChangeSet {
  templateIdentity: string;
  baselineVersion: string;
  targetVersion: string;
  clean: CleanEntry[];
  conflicts: ConflictEntry[];
}
// @cpt-end:cpt-frontx-dod-upgrade-changeset-computation:p1:inst-change-set-types

// @cpt-begin:cpt-frontx-dod-upgrade-changeset-rollback:p1:inst-snapshot-type
// Absolute file path → original content (null = file did not exist pre-upgrade)
export interface ProjectSnapshot {
  files: Map<string, string | null>;
}
// @cpt-end:cpt-frontx-dod-upgrade-changeset-rollback:p1:inst-snapshot-type

// Injected dependency types — no direct filesystem access in core logic
export type ReadProvenanceFn = (projectRoot: string) => Promise<ProvenanceRecord | null>;
export type VersionedLookupFn = (name: string, version: string) => InventoryEntry | undefined;
export type ReadProjectFileFn = (absolutePath: string) => Promise<string | null>;
export type WriteProjectFileFn = (absolutePath: string, content: string) => Promise<void>;
export type RemoveProjectFileFn = (absolutePath: string) => Promise<void>;
export type WriteProvenanceFn = (absolutePath: string, content: string) => Promise<void>;
export type PresentAndGetApprovalFn = (changeSet: ChangeSet) => Promise<'approved' | 'declined'>;
