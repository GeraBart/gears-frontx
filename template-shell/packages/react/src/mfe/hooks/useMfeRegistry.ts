/**
 * useMfeRegistry Hook - Shared MfeRegistry access guard
 *
 * Resolves the MFE-enabled registry off the FrontX app instance and throws a
 * descriptive error when the `microfrontends()` plugin was not installed.
 * Extracted so every registry-consuming hook shares one guard implementation
 * instead of hand-rolling the same `if (!app.mfeRegistry)` check.
 *
 * React Layer: L3
 */

import { useFrontX } from '../../FrontXContext';
import type { MfeRegistry } from '@gears-frontx/framework';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for accessing the MFE-enabled registry off the current FrontX app.
 *
 * Throws if the app was built without the `microfrontends()` plugin. The
 * `callerName` argument is included in the thrown message so a developer
 * still learns which hook failed, even though the guard itself is shared.
 *
 * @param callerName - Name of the calling hook, used in the error message
 * @returns The MFE-enabled registry
 *
 * @example
 * ```ts
 * export function useDomainExtensions(domainId: string): Extension[] {
 *   const registry = useMfeRegistry('useDomainExtensions');
 *   // ...
 * }
 * ```
 */
export function useMfeRegistry(callerName: string): MfeRegistry {
  const app = useFrontX();
  const registry = app.mfeRegistry;

  if (!registry) {
    throw new Error(
      `${callerName} requires the microfrontends plugin. ` +
      'Add microfrontends() to your Gears FrontX app configuration.'
    );
  }

  return registry;
}
