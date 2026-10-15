import type { DefaultMfeRegistry } from '../../DefaultMfeRegistry';

interface ManagerAccess {
  extensionManager: { getMountedExtensions(domainId: string): readonly string[] };
}

/**
 * Test-only observation of a domain's mount set, in mount order, read from
 * the runtime's internal extension manager. The registry's developer-facing
 * surface offers no such read.
 */
export function mountedIn(registry: DefaultMfeRegistry, domainId: string): readonly string[] {
  return (registry as unknown as ManagerAccess).extensionManager.getMountedExtensions(domainId);
}
