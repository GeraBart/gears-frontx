/**
 * A real `DefaultMfeRegistry` hosting one Optional or Exclusive domain whose
 * strategy is built the way a domain author builds it: `new XMountStrategy(ctx.mounter, hooks)`.
 * The strategy is returned so a test can drive it directly, bypassing the
 * occupancy queue; the domain's mount set is observed with `mountedIn`.
 */
import { DefaultMfeRegistry } from '../../DefaultMfeRegistry';
import { ExtensionDomainImplementation } from '../../ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../../ExtensionDomainImplementationFactory';
import type { DomainContext } from '../../DomainContext';
import { OptionalMountStrategy } from '../../OptionalMountStrategy';
import { ExclusiveMountStrategy } from '../../ExclusiveMountStrategy';
import type { MountStrategy } from '../../MountStrategy';
import { ActionHandler } from '../../../mediator/ActionHandler';
import { FakeContainerHooks } from './FakeContainerHooks';
import {
  ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT, ENTRY_ID, ControlledHandler, createPlugin, makeDomain, makeExtension,
  registerEntrySchema,
} from './reflect-harness';

export interface StrategyDomain {
  registry: DefaultMfeRegistry;
  handler: ControlledHandler;
  hooks: FakeContainerHooks;
  strategy: MountStrategy;
  domainId: string;
}

class StrategyDomainImpl extends ExtensionDomainImplementation {
  constructor(ctx: DomainContext, private readonly strategy: MountStrategy, declaresUnmount: boolean) {
    super();
    ctx.registerHandler(ACTION_MOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as { subject: string })));
    if (declaresUnmount) {
      ctx.registerHandler(ACTION_UNMOUNT_EXT, ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as { subject: string })));
    }
  }
  protected getMountStrategies(): MountStrategy[] { return [this.strategy]; }
}

export async function strategyDomain(
  kind: 'optional' | 'exclusive',
  domainId: string,
  extensionIds: string[]
): Promise<StrategyDomain> {
  const plugin = createPlugin();
  registerEntrySchema(plugin);
  const handler = new ControlledHandler(ENTRY_ID);
  const registry = new DefaultMfeRegistry({ typeSystem: plugin, mfeHandlers: [handler] });
  const hooks = new FakeContainerHooks();
  let built: MountStrategy | undefined;
  registry.registerDomain(
    makeDomain(domainId, kind === 'optional'),
    new (class extends ExtensionDomainImplementationFactory {
      build(ctx: DomainContext): StrategyDomainImpl {
        built = kind === 'optional'
          ? new OptionalMountStrategy(ctx.mounter, hooks)
          : new ExclusiveMountStrategy(ctx.mounter, hooks);
        return new StrategyDomainImpl(ctx, built, kind === 'optional');
      }
    })()
  );
  for (const id of extensionIds) await registry.registerExtension(makeExtension(id, domainId));
  registry.getMounter(domainId).attach(document.createElement('div'));
  return { registry, handler, hooks, strategy: built!, domainId };
}
