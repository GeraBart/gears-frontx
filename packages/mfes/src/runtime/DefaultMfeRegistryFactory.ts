/**
 * DefaultMfeRegistryFactory - Concrete Factory Implementation
 *
 * Factory-with-cache implementation for creating MfeRegistry instances.
 * This class is NOT exported from the public barrel - it's an internal
 * implementation detail.
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-flow:cpt-frontx-flow-mfe-registry-factory-build:p1
// @cpt-state:cpt-frontx-state-mfe-registry-factory-cache:p1

import { MfeRegistryFactory } from '../registry/MfeRegistryFactory';
import type { MfeRegistry } from '../registry/MfeRegistry';
import type { MfeRegistryConfig } from './config';
import { DefaultMfeRegistry } from './DefaultMfeRegistry';

/**
 * Concrete factory that implements factory-with-cache pattern.
 *
 * After the first build() call, the instance is cached and returned
 * on subsequent calls. If a different config is provided after the
 * first build, an error is thrown (config mismatch detection).
 *
 * This is the ONLY code (besides test files) that imports DefaultMfeRegistry.
 *
 * @internal - Not exported from public barrel
 */
export class DefaultMfeRegistryFactory extends MfeRegistryFactory {
  private instance: MfeRegistry | null = null;
  private cachedConfig: MfeRegistryConfig | null = null;

  /**
   * Build a MfeRegistry instance with the provided configuration.
   *
   * On first call: creates a new DefaultMfeRegistry, caches it, returns it.
   * On subsequent calls: validates config matches cached config, returns cached instance.
   *
   * @param config - Registry configuration (must include typeSystem)
   * @returns The MfeRegistry singleton instance
   * @throws Error if called with different config after first build
   */
  // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-01
  build(config: MfeRegistryConfig): MfeRegistry {
  // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-01
    // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02
    if (this.instance) {
      // The plugin identity, not its shape, is what the cached registry closed
      // over: every handler, mediator and domain it built asks that instance
      // for type resolution, so a second plugin cannot be adopted afterwards.
      if (this.cachedConfig && config.typeSystem !== this.cachedConfig.typeSystem) {
        // @cpt-begin:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-02a
        throw new Error(
          'MfeRegistry already built with a different TypeSystemPlugin. ' +
          'Cannot rebuild with a different configuration. ' +
          `Expected: ${this.cachedConfig.typeSystem.name}, ` +
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
    this.cachedConfig = config;
    this.instance = new DefaultMfeRegistry(config);
    return this.instance;
    // @cpt-end:cpt-frontx-state-mfe-registry-factory-cache:p1:inst-state-fc-01
    // @cpt-end:cpt-frontx-flow-mfe-registry-factory-build:p1:inst-flow-fb-03
  }
}
