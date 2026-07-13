// @cpt-dod:cpt-frontx-dod-template-ai-extensions-contract-conformance:p1
import { EXTENSION_CATEGORIES, type AiExtensionEntry, type ExtensionCategory, type StructuralError } from './types.js';

/** Type guard: is this string one of the closed-set extension categories? */
export function isExtensionCategory(value: unknown): value is ExtensionCategory {
  return typeof value === 'string' && (EXTENSION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Validate a single raw bundle entry's structural shape against the closed-set
 * contract. Returns the conforming entry, or a StructuralError describing why
 * the entry is malformed / names a category outside the closed set.
 */
export function validateExtensionEntry(
  raw: unknown,
): { ok: true; entry: AiExtensionEntry } | { ok: false; error: StructuralError } {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { slot: 'unknown', entryId: 'unknown', message: 'extension entry must be an object' },
    };
  }

  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' && e.id.trim() ? e.id : 'unknown';
  const category = e.category;

  if (!isExtensionCategory(category)) {
    return {
      ok: false,
      error: {
        slot: typeof category === 'string' ? category : 'unknown',
        entryId: id,
        message: `extension category "${String(category)}" is outside the closed set (${EXTENSION_CATEGORIES.join(', ')})`,
      },
    };
  }

  const path = e.path;
  if (typeof id !== 'string' || id === 'unknown' || typeof path !== 'string' || !path.trim()) {
    return {
      ok: false,
      error: {
        slot: category,
        entryId: id,
        message: `extension entry for slot "${category}" is missing a required structural element (id, path)`,
      },
    };
  }

  return { ok: true, entry: { id, category, path } };
}
