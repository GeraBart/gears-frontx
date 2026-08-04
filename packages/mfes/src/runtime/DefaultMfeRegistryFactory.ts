/**
 * DefaultMfeRegistryFactory - Concrete Factory Implementation
 *
 * Factory-with-cache implementation for creating MfeRegistry instances.
 * The class is NOT exported from the public barrel: each instance owns the
 * registry it cached and the plugin that registry closed over, so a consumer
 * able to construct its own instance could hand out a second registry bound
 * to a different plugin - exactly the divergence the cache exists to refuse.
 * `createMfeRegistryFactory` is the one creation path out of this module; the
 * composition root that calls it owns the single factory an application uses.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-flow:cpt-frontx-flow-mfe-registry-factory-build:p1
// @cpt-state:cpt-frontx-state-mfe-registry-factory-cache:p1

import { MfeRegistryFactory } from '../registry/MfeRegistryFactory';
import type { MfeRegistry } from '../registry/MfeRegistry';
import type { MfeRegistryConfig } from './config';
import type { TypeSystemPlugin } from '../type-substrate';
import { DefaultMfeRegistry } from './DefaultMfeRegistry';

/**
 * Concrete factory that implements factory-with-cache pattern.
 *
 * After the first build() call, the instance is cached and returned
 * on subsequent calls. A later call naming a different `TypeSystemPlugin`
 * than the first is refused rather than served the mismatched instance.
 *
 * This is the ONLY code (besides test files) that imports DefaultMfeRegistry.
 *
 * @internal - reachable only through createMfeRegistryFactory
 */
export class DefaultMfeRegistryFactory extends MfeRegistryFactory {
  private instance: MfeRegistry | null = null;
  // A snapshot of the plugin, not the config object it arrived in: the caller
  // keeps a reference to that object and may reassign `typeSystem` on it, which
  // would leave the mismatch check below comparing the new plugin against
  // itself and handing back a registry bound to the old one.
  private cachedTypeSystem: TypeSystemPlugin | null = null;

  /**
   * Build a MfeRegistry instance with the provided configuration.
   *
   * On first call: creates a new DefaultMfeRegistry, caches it alongside the
   * plugin it was bound to, returns it.
   * On subsequent calls: validates the supplied plugin is the one the cached
   * registry was built with, returns cached instance.
   *
   * @param config - Registry configuration (must include typeSystem)
   * @returns The MfeRegistry singleton instance
   * @throws Error if called with a different plugin after first build
   */
  // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-01
  build(config: MfeRegistryConfig): MfeRegistry {
  // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-01
    // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02
    if (this.instance) {
      // The plugin identity, not its shape, is what the cached registry closed
      // over: every handler, mediator and domain it built asks that instance
      // for type resolution, so a second plugin cannot be adopted afterwards.
      if (this.cachedTypeSystem && config.typeSystem !== this.cachedTypeSystem) {
        // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02a
        throw new Error(
          'MfeRegistry already built with a different TypeSystemPlugin. ' +
          'Cannot rebuild with a different configuration. ' +
          `Expected: ${this.cachedTypeSystem.name}, ` +
          `Got: ${config.typeSystem.name}`
        );
        // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02a
      }
      // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02

      // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02b
      // @cpt-begin:cpt-frontx-state-mfe-registry-factory-cache:p1:inst-state-fc-02
      return this.instance;
      // @cpt-end:cpt-frontx-state-mfe-registry-factory-cache:p1:inst-state-fc-02
      // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02b
    }

    // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-03
    // @cpt-begin:cpt-frontx-state-mfe-registry-factory-cache:p1:inst-state-fc-01
    this.cachedTypeSystem = config.typeSystem;
    this.instance = new DefaultMfeRegistry(config);
    return this.instance;
    // @cpt-end:cpt-frontx-state-mfe-registry-factory-cache:p1:inst-state-fc-01
    // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-03
  }
}

/**
 * Create a MfeRegistryFactory for a composition root to own.
 *
 * The declared return type is the abstract contract, which keeps the concrete
 * class off the package's public surface and leaves the implementation behind
 * it substitutable. Each call returns a factory with its own empty cache, so
 * an application creates one and shares it; tests get isolation by creating
 * their own rather than by resetting shared state.
 *
 * @returns A factory whose first build() fixes the registry and its plugin
 */
// @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-create
export function createMfeRegistryFactory(): MfeRegistryFactory {
  return new DefaultMfeRegistryFactory();
}
// @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-create
