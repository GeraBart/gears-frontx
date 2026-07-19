// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
/**
 * Filesystem realization of the AI-extension discovery scan, reading the
 * on-disk bundle convention fixed by the template-ai-extensions FEATURE's
 * §1.5 AI-Extension Bundle Convention: a per-template id-scoped bundle root
 * `.frontx/ai/<template-identity>/`, its own anchor
 * `.frontx/ai/<template-identity>/extension.json` (bundle identity +
 * contract version + the `{id, category, path}` entry list), and the four
 * closed-set slot subdirs (`skills/`, `workflows/`, `guidelines/`,
 * `reference-artifacts/`) scoped to that bundle root. Any number of
 * co-applied templates' bundles co-locate under `.frontx/ai/` as disjoint
 * id-scoped subtrees, each discovered independently.
 *
 * Pure over an injected `BundleFsReader` (mirrors `ResourceBodyReader`'s DI
 * shape) so the algorithm is testable without touching real disk; production
 * usage supplies `createFsBundleReader()` from `fs-bundle-reader.ts`.
 */
import type { AiExtensionBundle, ExtensionCategory, StructuralError } from './types.js';

/** Injectable filesystem access for the AI-extension bundle scan. */
export interface BundleFsReader {
  /** Reads a file's UTF-8 content; `undefined` if missing/unreadable. */
  readFile(path: string): string | undefined;
  /** Lists immediate child names of a directory; `undefined` if missing/not a directory. */
  listDir(path: string): string[] | undefined;
}

/** Maps each closed-set category to its on-disk slot subdirectory name. */
export const SLOT_DIR_NAMES: Record<ExtensionCategory, string> = {
  skills: 'skills',
  workflows: 'workflows',
  guidelines: 'guidelines',
  reference_artifacts: 'reference-artifacts',
};

const KNOWN_SLOT_DIRS = new Set(Object.values(SLOT_DIR_NAMES));

/** Discovery result for ONE id-scoped bundle root `.frontx/ai/<template-identity>/`. */
export interface DiscoveredBundle {
  /** The `<template-identity>` path segment this bundle root was discovered under. */
  identity: string;
  /** Conforming raw entries, ready to feed into `scanAndComposeExtensions`. */
  bundle: AiExtensionBundle;
  /** Structural errors found at the fs level, scoped to this bundle root. */
  structuralErrors: StructuralError[];
}

function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
}

function isSlotCategory(value: unknown): value is ExtensionCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SLOT_DIR_NAMES, value);
}

/**
 * Validates one declared entry's ON-DISK shape against its slot's required
 * layout. Distinct from `validateExtensionEntry` (field-shape only) — this
 * additionally confirms the entry's declared `path` resolves to real,
 * conforming content under the bundle root.
 */
function validateOnDiskShape(
  raw: unknown,
  bundleRoot: string,
  reader: BundleFsReader,
): { ok: true } | { ok: false; error: StructuralError } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { slot: 'unknown', entryId: 'unknown', message: 'declared AI-extension entry must be an object' } };
  }

  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' && e.id.trim() ? e.id : 'unknown';
  const category = e.category;
  const path = e.path;

  if (!isSlotCategory(category)) {
    return {
      ok: false,
      error: {
        slot: typeof category === 'string' ? category : 'unknown',
        entryId: id,
        message: `entry "${id}" declares category "${String(category)}" outside the closed set (${Object.keys(SLOT_DIR_NAMES).join(', ')})`,
      },
    };
  }

  if (typeof path !== 'string' || !path.trim()) {
    return { ok: false, error: { slot: category, entryId: id, message: `entry "${id}" is missing a required "path"` } };
  }

  if (category === 'skills') {
    const skillFile = joinPath(bundleRoot, path, 'SKILL.md');
    if (reader.readFile(skillFile) === undefined) {
      return { ok: false, error: { slot: category, entryId: id, message: `skill "${id}" is missing SKILL.md at "${skillFile}"` } };
    }
    return { ok: true };
  }

  const filePath = joinPath(bundleRoot, path);
  if (reader.readFile(filePath) === undefined) {
    return { ok: false, error: { slot: category, entryId: id, message: `${category} entry "${id}" content not found at "${filePath}"` } };
  }
  return { ok: true };
}

/**
 * Scans ONE id-scoped bundle root `.frontx/ai/<template-identity>/` for its
 * anchor `extension.json` and closed-set slot subdirs, per the FEATURE's
 * §1.5 on-disk convention, returning the conforming entries plus any
 * structural errors — scoped entirely to this bundle root so a malformed
 * bundle never affects a sibling bundle discovered under the same
 * `.frontx/ai/`.
 */
function discoverSingleBundle(identity: string, bundleRoot: string, reader: BundleFsReader): DiscoveredBundle {
  const anchorPath = joinPath(bundleRoot, 'extension.json');

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle
  const anchorRaw = reader.readFile(anchorPath);
  if (anchorRaw === undefined) {
    return {
      identity,
      bundle: [],
      structuralErrors: [{ slot: 'unknown', entryId: 'unknown', message: `missing AI-extension bundle anchor at "${anchorPath}"` }],
    };
  }

  let parsedAnchor: unknown;
  try {
    parsedAnchor = JSON.parse(anchorRaw);
  } catch {
    return {
      identity,
      bundle: [],
      structuralErrors: [{ slot: 'unknown', entryId: 'unknown', message: `AI-extension bundle anchor at "${anchorPath}" is not valid JSON` }],
    };
  }

  if (
    typeof parsedAnchor !== 'object' ||
    parsedAnchor === null ||
    typeof (parsedAnchor as Record<string, unknown>).id !== 'string' ||
    !(parsedAnchor as Record<string, unknown>).id
  ) {
    return {
      identity,
      bundle: [],
      structuralErrors: [
        { slot: 'unknown', entryId: 'unknown', message: `AI-extension bundle anchor at "${anchorPath}" is missing a bundle identity ("id")` },
      ],
    };
  }

  const declaredEntries = Array.isArray((parsedAnchor as Record<string, unknown>).entries)
    ? ((parsedAnchor as Record<string, unknown>).entries as unknown[])
    : [];
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle

  const structuralErrors: StructuralError[] = [];

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-identify-slot-entries
  const bundleRootDirs = reader.listDir(bundleRoot) ?? [];
  for (const name of bundleRootDirs) {
    if (!KNOWN_SLOT_DIRS.has(name)) {
      structuralErrors.push({
        slot: name,
        entryId: 'unknown',
        message: `"${name}" is a subdirectory of "${bundleRoot}" outside the closed-set AI-extension categories (${[...KNOWN_SLOT_DIRS].join(', ')})`,
      });
    }
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-identify-slot-entries

  const bundle: unknown[] = [];
  for (const raw of declaredEntries) {
    const shapeResult = validateOnDiskShape(raw, bundleRoot, reader);
    if (!shapeResult.ok) {
      structuralErrors.push(shapeResult.error);
      continue;
    }
    bundle.push(raw);
  }

  return { identity, bundle, structuralErrors };
}

/**
 * Scans the scaffolded project's `.frontx/ai/` for EACH per-template
 * id-scoped bundle root `.frontx/ai/<template-identity>/`, discovering every
 * co-located bundle independently, and returns the conforming entries plus
 * structural errors for each — ready to be fed into the EXISTING
 * `scanAndComposeExtensions` algorithm
 * (`cpt-frontx-algo-template-ai-extensions-contract-scan-activate`). Absent
 * `.frontx/ai/` (no templates applied yet) yields no discovered bundles,
 * which is not itself a structural error.
 */
export function discoverExtensionBundlesFromFs(contentRoot: string, reader: BundleFsReader): DiscoveredBundle[] {
  const aiRoot = joinPath(contentRoot, '.frontx', 'ai');

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  // Enumerate each per-template id-scoped bundle root under the scaffolded
  // project's `.frontx/ai/`; a bundle-root name that is not a real directory
  // simply is not returned by `listDir` and contributes nothing.
  const bundleIdentities = (reader.listDir(aiRoot) ?? []).slice().sort();
  return bundleIdentities.map((identity) => discoverSingleBundle(identity, joinPath(aiRoot, identity), reader));
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
}
