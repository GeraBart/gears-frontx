/**
 * Factory cache is keyed by the plugin, not by the config object.
 *
 * The config a caller hands to `build` stays the caller's object, so it can
 * carry a different `typeSystem` on a later call without a new object ever
 * being created. A factory that remembered the config rather than the plugin
 * would then compare the mutated object against itself, find no mismatch, and
 * return a registry whose handlers, mediator and domains all still ask the
 * original plugin - the exact divergence the cache exists to refuse.
 */
// @cpt-flow:cpt-frontx-flow-mfe-registry-factory-build:p1
// @cpt-state:cpt-frontx-state-mfe-registry-factory-cache:p1
import { describe, it, expect } from 'vitest';
// @internal - colocated test, direct relative import is permitted.
import { createMfeRegistryFactory } from '../DefaultMfeRegistryFactory';
import type { MfeRegistryConfig } from '../config';
import type { TypeSystemPlugin } from '../../type-substrate';

function createFakePlugin(name: string): TypeSystemPlugin {
  return {
    name,
    version: '1.0.0',
    registerSchema(): void {},
    getSchema(): unknown {
      return undefined;
    },
    register(): void {},
    isTypeOf(typeId: string, baseTypeId: string): boolean {
      return typeId === baseTypeId || typeId.startsWith(baseTypeId);
    },
    validateInstance() {
      return { valid: true, errors: [] };
    },
    resolveLoadExtActionId: () => 'mock.action.v1~load_ext.v1~',
    resolveMountExtActionId: () => 'mock.action.v1~mount_ext.v1~',
    resolveUnmountExtActionId: () => 'mock.action.v1~unmount_ext.v1~',
    resolveLifecycleStageInitId: () => 'mock.stage.v1~init.v1',
    resolveLifecycleStageActivatedId: () => 'mock.stage.v1~activated.v1',
    resolveLifecycleStageDeactivatedId: () => 'mock.stage.v1~deactivated.v1',
    resolveLifecycleStageDestroyedId: () => 'mock.stage.v1~destroyed.v1',
  };
}

describe('DefaultMfeRegistryFactory cache', () => {
  it('returns the cached registry for the same plugin regardless of config identity', () => {
    const plugin = createFakePlugin('FirstPlugin');
    // Two distinct config objects carrying one plugin: passing the same object
    // twice would pass even against a cache keyed by config identity, so the
    // second call has to arrive in a config the factory has never seen.
    const first: MfeRegistryConfig = { typeSystem: plugin };
    const second: MfeRegistryConfig = { typeSystem: plugin };
    const factory = createMfeRegistryFactory();

    const registry = factory.build(first);

    expect(factory.build(second)).toBe(registry);
    expect(factory.build(first)).toBe(registry);
  });

  it('refuses the rebuild when the caller mutates typeSystem on the config it already built with', () => {
    const first = createFakePlugin('FirstPlugin');
    const second = createFakePlugin('SecondPlugin');
    const config: MfeRegistryConfig = { typeSystem: first };
    const factory = createMfeRegistryFactory();

    const registry = factory.build(config);

    config.typeSystem = second;

    expect(() => factory.build(config)).toThrow(/FirstPlugin/);
    // The registry handed out before the mutation keeps answering through the
    // plugin it closed over: refusing the rebuild is only half the guarantee.
    expect(registry.typeSystem).toBe(first);
  });
});
