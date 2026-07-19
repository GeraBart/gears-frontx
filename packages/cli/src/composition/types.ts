import type { InventoryEntry } from '../inventory/types';
import type { OwnershipBoundary } from '../manifest/types';

// A single distinct template encountered during composed-template resolution
// — the unarbitrated unit the pre-flight ownership-boundary conflict check
// (cpt-frontx-algo-cli-scaffolding-conflict-check) evaluates. Same-target-path
// collisions between two entries are NOT resolved here; recursive resolution
// hands the whole set over unmodified — arbitration is owned entirely by that
// check (cpt-frontx-adr-composed-template-resolution,
// cpt-frontx-adr-assembly-conflict-prevention).
export interface CompositionEntry {
  identity: string;
  installedContentPath: InventoryEntry; // the resolved on-disk template; content is read from here, never from the manifest
  ownershipBoundaries: OwnershipBoundary;
}

export type CompositionSetResult =
  | { ok: true; templates: Map<string, CompositionEntry> }
  | { ok: false; reason: 'cycle'; path: string[] }
  | { ok: false; reason: 'resolve-error'; ref: string; message: string };
