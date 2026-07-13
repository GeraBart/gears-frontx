// @cpt-state:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1
import { validateExtensionEntry } from './contract.js';
import { AiExtensionLifecycleState, type AiExtensionEntry, type LifecycleResult, type StructuralError } from './types.js';

/**
 * FROM BUNDLED TO DISCOVERED WHEN the installed template's AI-extension bundle
 * is scanned and an entry is located for a named typed slot in the closed-set
 * contract (cpt-frontx-state-template-ai-extensions-extension-lifecycle).
 */
// @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-bundled-to-discovered
export function transitionBundledToDiscovered(
  raw: unknown,
): { state: typeof AiExtensionLifecycleState.DISCOVERED; raw: unknown } {
  return { state: AiExtensionLifecycleState.DISCOVERED, raw };
}
// @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-bundled-to-discovered

/**
 * FROM DISCOVERED TO VALIDATED WHEN the entry's structural shape is confirmed
 * to conform, or TO REJECTED WHEN the entry is malformed / missing a required
 * element for its slot. A REJECTED transition reports a structural error.
 */
export function transitionFromDiscovered(
  raw: unknown,
): { state: typeof AiExtensionLifecycleState.VALIDATED; entry: AiExtensionEntry } | { state: typeof AiExtensionLifecycleState.REJECTED; error: StructuralError } {
  const result = validateExtensionEntry(raw);

  if (result.ok) {
    // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-validated
    return { state: AiExtensionLifecycleState.VALIDATED, entry: result.entry };
    // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-validated
  }

  // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-rejected
  // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-action-report-rejection
  return { state: AiExtensionLifecycleState.REJECTED, error: result.error };
  // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-action-report-rejection
  // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-rejected
}

/**
 * FROM VALIDATED TO ACTIVATED WHEN the composed capability set is committed
 * to the AI agent's visible surface after explicit precedence resolution.
 * Composition/commit itself is `scanAndComposeExtensions`; this transition
 * marks a VALIDATED entry as having reached ACTIVATED once composed.
 */
// @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-validated-to-activated
export function transitionValidatedToActivated(entry: AiExtensionEntry): { state: typeof AiExtensionLifecycleState.ACTIVATED; entry: AiExtensionEntry } {
  return { state: AiExtensionLifecycleState.ACTIVATED, entry };
}
// @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-validated-to-activated

/**
 * Drives one raw bundle entry through the full lifecycle: BUNDLED ->
 * DISCOVERED -> VALIDATED -> ACTIVATED, or BUNDLED -> DISCOVERED -> REJECTED.
 * A REJECTED entry never reaches ACTIVATED.
 */
export function runExtensionLifecycle(raw: unknown): LifecycleResult {
  const discovered = transitionBundledToDiscovered(raw);
  const validatedOrRejected = transitionFromDiscovered(discovered.raw);

  if (validatedOrRejected.state === AiExtensionLifecycleState.REJECTED) {
    return { state: AiExtensionLifecycleState.REJECTED, error: validatedOrRejected.error };
  }

  const activated = transitionValidatedToActivated(validatedOrRejected.entry);
  return { state: AiExtensionLifecycleState.ACTIVATED, entry: activated.entry };
}
