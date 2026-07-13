// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
import { validateExtensionEntry } from './contract.js';
import { scanAndComposeExtensions, type BaseCapabilities } from './scan.js';
import type { AiExtensionBundle, ScanAndActivateResult, StructuralError } from './types.js';

export interface PrePublishValidationResult {
  ok: boolean;
  errors: StructuralError[];
}

/**
 * Bundle-and-publish leg (Template Developer): validates every declared
 * extension entry against the closed-set contract before the template may be
 * published. A non-conforming entry blocks publication with a reported
 * structural error.
 */
export function validateBundleForPublish(bundle: AiExtensionBundle): PrePublishValidationResult {
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-declare-extensions
  const declaredEntries = bundle;
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-declare-extensions

  const errors: StructuralError[] = [];

  for (const raw of declaredEntries) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-contract-shape
    const result = validateExtensionEntry(raw);
    if (!result.ok) {
      // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-prepublish-error
      errors.push(result.error);
      // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-prepublish-error
    }
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-contract-shape
  }

  if (errors.length > 0) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-prepublish-fail
    return { ok: false, errors };
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-prepublish-fail
  }

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-confirm-contract-conformance
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-publish-template
  return { ok: true, errors: [] };
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-publish-template
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-confirm-contract-conformance
}

/**
 * Install-discover-activate leg (Project Developer): invoked once the CLI
 * signals that an installed template is present (cross-pillar edge F16 <- F10).
 * Runs the contract scan and composes the discovered conforming extensions
 * with the base kit's capability set into the agent-visible activation
 * result.
 */
export function discoverAndActivateForInstalledTemplate(
  bundle: AiExtensionBundle,
  baseCapabilities: BaseCapabilities,
  installOrder: number,
): ScanAndActivateResult {
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-install-template
  // Installation itself is performed by the CLI's template-resolution path
  // (cpt-frontx-feature-template-resolution); this function runs once the CLI
  // signals that an installed template is present.
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-install-template

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-each-slot
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-slot-entries
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-slot-conformance
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-record-structural-error
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-add-to-discovered
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-compose-under-precedence
  const result = scanAndComposeExtensions(bundle, baseCapabilities, installOrder);
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-compose-under-precedence
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-add-to-discovered
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-record-structural-error
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-slot-conformance
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-slot-entries
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-each-slot
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-errors
  if (result.errors.length > 0) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-errors
    // Structural errors are surfaced to the Project Developer via `result.errors`;
    // no errored entry is present in `result.composed` (excluded in the scan).
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-errors
  }
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-errors

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-activate-capabilities
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-activated
  return result;
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-activated
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-activate-capabilities
}
