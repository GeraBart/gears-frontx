// @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-list-inventory:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-bounded-local-update:p1

// @cpt-begin:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-resolved
export enum InventoryState {
  UNRESOLVED = 'UNRESOLVED',
  RESOLVED = 'RESOLVED',
  INSTALLED = 'INSTALLED',
  UPDATED = 'UPDATED',
}
// @cpt-end:cpt-frontx-state-template-resolution-inventory-lifecycle:p1:inst-state-to-resolved

export interface InventoryEntry {
  name: string;
  source: string;
  ref: string;
  status: InventoryState;
  content: string;
}

export interface InventoryError {
  message: string;
}

export type InventoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InventoryError };

// Port contracts the CONTENT store and metadata INDEX satisfy — the injection
// site `TemplateInventory` depends on these shapes, not on the concrete
// in-memory `InventoryStore`/`InventoryIndex` classes, so a real fs-backed
// adapter (packages/cli/src/adapters/fs-*.ts) can be substituted without any
// change to flow orchestration (Dependency Inversion; adapters implement the
// port, IO stays out of pure logic).
export interface ContentStorePort {
  write(name: string, content: string): void;
  replace(name: string, content: string): void;
  read(name: string): string | undefined;
  has(name: string): boolean;
}

export interface InventoryIndexPort {
  record(entry: InventoryEntry): void;
  lookup(name: string): InventoryEntry | undefined;
  update(name: string, patch: Partial<InventoryEntry>): void;
  all(): InventoryEntry[];
  getState(name: string): InventoryState;
  toJSON(): string;
}
