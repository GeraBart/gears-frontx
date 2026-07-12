/**
 * Domain-Specific Extension Validation via Derived Types
 *
 * Validates that an Extension's type conforms to its domain's extensionsTypeId
 * requirement. Extracted from @gears-frontx/screensets in Phase 7.
 *
 * @packageDocumentation
 */

import type { TypeSystemPlugin } from '../type-substrate';
import type { Extension } from '../types';
import type { ExtensionDomain } from '../types';
import { ExtensionTypeError } from '../errors';

export function validateExtensionType(
  plugin: TypeSystemPlugin,
  domain: ExtensionDomain,
  extension: Extension
): void {
  if (!domain.extensionsTypeId) {
    return;
  }
  if (!plugin.isTypeOf(extension.id, domain.extensionsTypeId)) {
    throw new ExtensionTypeError(extension.id, domain.extensionsTypeId);
  }
}
