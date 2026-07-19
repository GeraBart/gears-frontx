// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
/**
 * Wires the injectable `ExtensionDiscoveryHook` to a FILESYSTEM-backed scan
 * of the installed template's `.frontx/ai/` bundle, per the
 * template-ai-extensions FEATURE's §1.5 AI-Extension Bundle Convention.
 *
 * The CLI has ZERO compile-time dependency on the AI Tooling Framework's
 * kit package (CLI-1 spirit): `FsExtensionDiscovery` is a small structural
 * interface the CLI defines for itself, exactly like `FetchFn` is defined
 * for the resolver. Whoever composes the CLI with the kit at the
 * application level supplies a `FsExtensionDiscovery`-shaped object backed
 * by the kit's real `discoverAndActivateFromInstalledTemplateFs` — no import
 * of the kit package is required here or in `commands/install.ts`.
 */
import type { DiscoveryHookContext, DiscoveryHookResult, ExtensionDiscoveryHook } from './types';

/**
 * Structural shape of a filesystem-backed AI-extension discovery scan.
 * `contentRoot` is the installed template's on-disk content root; the
 * implementation is expected to scan `contentRoot/.frontx/ai/` per §1.5 and
 * report how many structural errors it found.
 */
export interface FsExtensionDiscovery {
  discover(contentRoot: string): Promise<{ errorCount: number }> | { errorCount: number };
}

/**
 * Builds an `ExtensionDiscoveryHook` that resolves the installed template's
 * on-disk content root via `resolveContentRoot`, then delegates the actual
 * `.frontx/ai/` scan to the injected `discovery` implementation.
 */
export function createFsBackedDiscoveryHook(
  resolveContentRoot: (context: DiscoveryHookContext) => string,
  discovery: FsExtensionDiscovery,
): ExtensionDiscoveryHook {
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  return async (context: DiscoveryHookContext): Promise<DiscoveryHookResult> => {
    const contentRoot = resolveContentRoot(context);
    const { errorCount } = await discovery.discover(contentRoot);
    return { triggered: true, errorCount };
  };
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
}
