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
import type { FrontXApp, MfeRegistry } from '@gears-frontx/framework';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for accessing the MFE-enabled registry off the current FrontX app.
 *
 * Throws if the app was built without the `microfrontends()` plugin. The
 * optional `callerName` argument is included in the thrown message so a
 * developer still learns which hook failed, even though the guard itself is
 * shared. It defaults to this hook's own name for direct consumers.
 *
 * @param callerName - Name of the calling hook, used in the error message
 * @returns The MFE-enabled registry
 *
 * @example
 * ```ts
 * const registry = useMfeRegistry();
 * ```
 */
export function useMfeRegistry(callerName: string = 'useMfeRegistry'): MfeRegistry {
  const app = useFrontX();

  return resolveMfeRegistry(app, callerName);
}

/**
 * Non-hook form of the guard, for callers that already hold the app instance
 * (e.g. hooks that need `app.store` as well) and must not read the context twice.
 *
 * @param app - The FrontX app instance to resolve the registry from
 * @param callerName - Name of the calling hook, used in the error message
 * @returns The MFE-enabled registry
 */
export function resolveMfeRegistry(app: FrontXApp, callerName: string): MfeRegistry {
  const registry = app.mfeRegistry;

  if (!registry) {
    throw new Error(
      `${callerName} requires the microfrontends plugin. ` +
      'Add microfrontends() to your Gears FrontX app configuration.'
    );
  }

  return registry;
}
