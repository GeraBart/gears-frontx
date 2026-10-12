/**
 * The router port has exactly seven members, the runtime contacts the router
 * only through them, and an Exclusive domain that declares `unmount_ext` is
 * rejected.
 *
 * Pins `cpt-frontx-dod-mfe-host-communication-router-port-contract`,
 * `cpt-frontx-algo-extension-domain-governance-strategy-cardinality`
 * (`inst-sc-exclusive-row`, `inst-sc-forbidden-check-loop`,
 * `inst-sc-forbidden-declared`, `inst-sc-forbidden-fail`).
 */
import { afterEach, describe, it, expect, expectTypeOf } from 'vitest';
import { DefaultMfeRegistry } from '../DefaultMfeRegistry';
import type { RouterPort } from '../../router/RouterPort';
import {
  ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT, ENTRY_ID, ControlledHandler, createPlugin,
  dispatch, domainFactory, makeDomain, setup,
} from './helpers/reflect-harness';

const registries: DefaultMfeRegistry[] = [];
afterEach(async () => { for (const r of registries.splice(0)) await r.dispose(); });

type RouterMember =
  | 'registerDomain' | 'registerExtension' | 'releaseDomain' | 'releaseExtension'
  | 'assignOccupantValue' | 'reflect' | 'supplyNavigation';
const ROUTER_MEMBERS: RouterMember[] = [
  'registerDomain', 'registerExtension', 'releaseDomain', 'releaseExtension',
  'assignOccupantValue', 'reflect', 'supplyNavigation',
];

describe('router port surface', () => {
  it('RouterPort has exactly the seven members, and `reflect` has the URL-command signature (type level)', () => {
    // cpt-frontx-dod-mfe-host-communication-router-port-contract
    expectTypeOf<keyof RouterPort>().toEqualTypeOf<RouterMember>();
    expectTypeOf<RouterPort['reflect']>().toEqualTypeOf<(domainId: string, extensionIds: string[], verb: 'push' | 'replace') => void>();
  });

  it('through mount, unregisterExtension, unregisterDomain and dispose the runtime touches only the seven members, and reaches `reflect`', async () => {
    // cpt-frontx-dod-mfe-host-communication-router-port-contract
    const touched = new Set<string>();
    const router = new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        touched.add(String(prop));
        return () => undefined;
      },
    }) as unknown as RouterPort;

    const f = await setup('optional', 'd-contract-port', ['A', 'B'], { router });
    expect(await dispatch(f.registry, 'd-contract-port', ACTION_MOUNT_EXT, { subject: 'A', history: 'push' })).toBe('next');
    await f.registry.unregisterExtension('B');
    await f.registry.unregisterDomain('d-contract-port');
    await f.registry.dispose();

    expect([...touched].filter((member) => !ROUTER_MEMBERS.includes(member as RouterMember))).toEqual([]);
    for (const member of ['registerDomain', 'registerExtension', 'assignOccupantValue', 'reflect', 'releaseExtension', 'releaseDomain']) {
      expect(touched.has(member)).toBe(true);
    }
  });
});

describe('Exclusive domain cardinality', () => {
  it('a domain composed with ExclusiveMountStrategy that declares unmount_ext is rejected, naming unmount_ext', () => {
    // inst-sc-exclusive-row, inst-sc-forbidden-check-loop, inst-sc-forbidden-declared, inst-sc-forbidden-fail
    // The domain registers an unmount_ext handler too, so the forbidden-action rule, not the missing-handler rule, rejects it.
    const plugin = createPlugin();
    plugin.registerSchema({ $id: ENTRY_ID } as never);
    const registry = new DefaultMfeRegistry({ typeSystem: plugin, mfeHandlers: [new ControlledHandler(ENTRY_ID)] });
    registries.push(registry);

    expect(() =>
      registry.registerDomain(makeDomain('d-exclusive-with-unmount', true), domainFactory('exclusive', registry, 'd-exclusive-with-unmount', true))
    ).toThrow(ACTION_UNMOUNT_EXT);
  });

  it('a domain composed with ExclusiveMountStrategy that declares mount_ext without unmount_ext is accepted', () => {
    // inst-sc-exclusive-row
    const plugin = createPlugin();
    plugin.registerSchema({ $id: ENTRY_ID } as never);
    const registry = new DefaultMfeRegistry({ typeSystem: plugin, mfeHandlers: [new ControlledHandler(ENTRY_ID)] });
    registries.push(registry);

    expect(() =>
      registry.registerDomain(makeDomain('d-exclusive-plain', false), domainFactory('exclusive', registry, 'd-exclusive-plain'))
    ).not.toThrow();
  });
});
