// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
import { EXTENSION_CATEGORIES } from './types.js';
import type {
  AiExtensionBundle,
  AiExtensionEntry,
  CapabilityContribution,
  ComposedCapabilitySet,
  ExtensionCategory,
  LifecycleResult,
  ScanAndActivateResult,
  StructuralError,
} from './types.js';
import { AiExtensionLifecycleState } from './types.js';
import { isExtensionCategory, validateExtensionEntry } from './contract.js';

/** Base kit capabilities, keyed by the named typed slot they contribute to. */
export type BaseCapabilities = Map<ExtensionCategory, AiExtensionEntry[]>;

function declaredCategoryOf(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return undefined;
  return (raw as Record<string, unknown>).category;
}

// @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-each-entry
function runEntryThroughScan(
  raw: unknown,
  discovered: Map<ExtensionCategory, AiExtensionEntry[]>,
  errors: StructuralError[],
  lifecycleResults: LifecycleResult[],
): void {
  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-entry-shape
  const result = validateExtensionEntry(raw);
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-entry-shape

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-malformed
  if (!result.ok) {
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-append-error
    errors.push(result.error);
    lifecycleResults.push({ state: AiExtensionLifecycleState.REJECTED, error: result.error });
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-append-error
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-skip-malformed
    return;
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-skip-malformed
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-malformed

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-add-conforming
  const slotBucket = discovered.get(result.entry.category);
  if (slotBucket) slotBucket.push(result.entry);
  lifecycleResults.push({ state: AiExtensionLifecycleState.ACTIVATED, entry: result.entry });
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-add-conforming
}
// @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-each-entry

/**
 * Discovery scan + precedence composition (cpt-frontx-algo-template-ai-extensions-contract-scan-activate).
 *
 * Scans `bundle` for entries conforming to the closed-set extension contract,
 * records a structural error for any non-conforming entry (including entries
 * naming a category outside the closed set), and composes the conforming
 * entries with `baseCapabilities` under the explicit precedence rule:
 * template-contributed entries supersede base-kit entries for the same named
 * slot; `installOrder` breaks ties across multiple installed templates
 * (higher installOrder wins for the same slot+id).
 */
export function scanAndComposeExtensions(
  bundle: AiExtensionBundle,
  baseCapabilities: BaseCapabilities,
  installOrder: number,
): ScanAndActivateResult {
  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-contract
  const slots = EXTENSION_CATEGORIES;
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-contract

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle
  const declaredEntries = bundle;
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-discovered-map
  const discovered = new Map<ExtensionCategory, AiExtensionEntry[]>();
  for (const slot of slots) discovered.set(slot, []);
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-discovered-map

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-error-list
  const errors: StructuralError[] = [];
  const lifecycleResults: LifecycleResult[] = [];
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-error-list

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-iterate-slots
  for (const slot of slots) {
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-identify-slot-entries
    const slotEntries = declaredEntries.filter((raw) => declaredCategoryOf(raw) === slot);
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-identify-slot-entries

    for (const raw of slotEntries) {
      runEntryThroughScan(raw, discovered, errors, lifecycleResults);
    }
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-iterate-slots

  // Entries whose declared category is outside the closed set entirely are
  // not identified by any slot's loop above and would otherwise be silently
  // dropped; they are still non-conforming entries and must be reported.
  for (const raw of declaredEntries) {
    const declared = declaredCategoryOf(raw);
    if (declared !== undefined && !isExtensionCategory(declared)) {
      runEntryThroughScan(raw, discovered, errors, lifecycleResults);
    }
  }

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-error-list
  if (errors.length > 0) {
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-surface-errors
    // Errors are surfaced via the returned `errors` list; callers report them
    // to the Project Developer. Errored entries are excluded from `discovered`
    // above (inst-skip-malformed) and therefore never reach composition.
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-surface-errors
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-error-list

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-compose-precedence
  const composed: ComposedCapabilitySet = new Map();
  for (const slot of slots) {
    const bySlotId = new Map<string, CapabilityContribution>();

    for (const baseEntry of baseCapabilities.get(slot) ?? []) {
      bySlotId.set(baseEntry.id, { entry: baseEntry, source: 'base', installOrder: -1 });
    }

    for (const templateEntry of discovered.get(slot) ?? []) {
      const existing = bySlotId.get(templateEntry.id);
      if (!existing || existing.source === 'base' || installOrder >= existing.installOrder) {
        bySlotId.set(templateEntry.id, { entry: templateEntry, source: 'template', installOrder });
      }
    }

    composed.set(slot, bySlotId);
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-compose-precedence

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-return-result
  return { composed, errors, lifecycleResults };
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-return-result
}
