// Stub — implementation in resolve.ts

export interface CompositionFileEntry {
  path: string;
  content: string;
  depth: number;
  declaringParent: string | null;
}

export interface CollisionRecord {
  path: string;
  existingParent: string | null;
  newParent: string | null;
  depth: number;
}

export type CompositionSetResult =
  | { ok: true; files: Map<string, CompositionFileEntry> }
  | { ok: false; reason: 'collision'; collisions: CollisionRecord[] }
  | { ok: false; reason: 'cycle'; path: string[] }
  | { ok: false; reason: 'resolve-error'; ref: string; message: string };
