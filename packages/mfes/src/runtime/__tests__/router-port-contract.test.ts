/**
 * The abstract router and the runtime's calls to it
 * (`cpt-frontx-dod-mfe-host-communication-router-port-contract`,
 * `cpt-frontx-algo-mfe-registry-router-admission` `inst-algo-ra-connect`,
 * `cpt-frontx-algo-extension-domain-governance-slot-attach` `inst-sa-start-domain`,
 * `cpt-frontx-algo-extension-domain-governance-slot-detach` `inst-sd-stop-domain`,
 * `cpt-frontx-algo-mfe-host-communication-occupant-value-rendezvous`).
 *
 * Covers: the package entry exports `RouterPort` as a runtime abstract class
 * with exactly ten members and `HistoryIntent` as a type; the registry's
 * `connect` call; admission of only routed declarations with ids, routes and
 * one boolean; `startDomain` at attach and `stopDomain` first in detach;
 * `assignOccupantValue` by ids; and that this package imports neither router
 * package.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it, expect, expectTypeOf, vi } from 'vitest';
import { RouterPort } from '../../index';
import type { HistoryIntent } from '../../index';
import type { ActionsChain } from '../../types';
import type { TypeSystemPlugin } from '../../type-substrate';
import { DefaultMfeRegistry } from '../DefaultMfeRegistry';
import { ActionHandler } from '../../mediator/ActionHandler';
import type { DefaultActionsChainsMediator } from '../../mediator/DefaultActionsChainsMediator';
import {
  ENTRY_ID, ACTION_UNMOUNT_EXT, ControlledHandler, createDeferred, createPlugin, domainFactory,
  addProbeDomain, makeDomain, makeExtension, registerEntrySchema, setup, type MockSchema, type Strategy,
} from './helpers/reflect-harness';
import { mountedIn } from './helpers/mounted-in';

const SRC_ROOT = join(__dirname, '..', '..');
const INDEX_SOURCE = readFileSync(join(SRC_ROOT, 'index.ts'), 'utf8');

type Executor = { executeActionsChain(chain: ActionsChain): void };

/** A router double logging every call, in order, as `[member, ...arguments]`. */
function createRecorder(behaviour: Partial<Record<string, (...args: unknown[]) => unknown>> = {}) {
  const log: unknown[][] = [];
  const record = (member: string) => (...args: unknown[]) => {
    log.push([member, ...args]);
    return behaviour[member]?.(...args);
  };
  const router = {
    connect: record('connect'),
    registerDomain: record('registerDomain'),
    registerExtension: record('registerExtension'),
    releaseDomain: record('releaseDomain'),
    releaseExtension: record('releaseExtension'),
    assignOccupantValue: record('assignOccupantValue'),
    supplyNavigation: record('supplyNavigation'),
    startDomain: record('startDomain'),
    stopDomain: record('stopDomain'),
    reflect: record('reflect'),
  } as unknown as RouterPort;
  return {
    router,
    log,
    calls: (member: string) => log.filter((entry) => entry[0] === member),
    members: () => log.map((entry) => entry[0]),
  };
}

const registries: DefaultMfeRegistry[] = [];
afterEach(async () => { for (const r of registries.splice(0)) await r.dispose(); });

function build(router: RouterPort | undefined, plugin: TypeSystemPlugin<MockSchema> = createPlugin()): DefaultMfeRegistry {
  registerEntrySchema(plugin);
  const registry = new DefaultMfeRegistry({ typeSystem: plugin, mfeHandlers: [new ControlledHandler(ENTRY_ID)], router });
  registries.push(registry);
  return registry;
}

describe('the abstract router at the package entry', () => {
  it('RouterPort is a runtime value: an abstract class carrying no implemented member and no field', () => {
    expect(typeof RouterPort).toBe('function');
    expect(Object.getOwnPropertyNames(RouterPort.prototype)).toEqual(['constructor']);
  });

  it('an instance has exactly the ten members with the normative signatures (type level)', () => {
    expectTypeOf<keyof RouterPort>().toEqualTypeOf<
      'connect' | 'registerDomain' | 'registerExtension' | 'releaseDomain' | 'releaseExtension'
      | 'assignOccupantValue' | 'supplyNavigation' | 'startDomain' | 'stopDomain' | 'reflect'
    >();
    expectTypeOf<RouterPort['connect']>().parameters.toEqualTypeOf<[Executor, TypeSystemPlugin]>();
    expectTypeOf<RouterPort['registerDomain']>().toEqualTypeOf<(domainId: string, route: string, declaresUnmount: boolean) => void>();
    expectTypeOf<RouterPort['registerExtension']>().toEqualTypeOf<(extensionId: string, domainId: string, route: string) => void>();
    expectTypeOf<RouterPort['releaseDomain']>().toEqualTypeOf<(domainId: string) => void>();
    expectTypeOf<RouterPort['releaseExtension']>().toEqualTypeOf<(extensionId: string) => void>();
    expectTypeOf<RouterPort['assignOccupantValue']>().toEqualTypeOf<(domainId: string, extensionId: string) => unknown>();
    expectTypeOf<RouterPort['supplyNavigation']>().toEqualTypeOf<(readOccupantValue: () => unknown) => void>();
    expectTypeOf<RouterPort['startDomain']>().toEqualTypeOf<(domainId: string) => void>();
    expectTypeOf<RouterPort['stopDomain']>().toEqualTypeOf<(domainId: string) => void>();
    expectTypeOf<RouterPort['reflect']>().toEqualTypeOf<(domainId: string, extensionIds: string[], verb: 'push' | 'replace') => void>();
  });

  it('exports HistoryIntent as a type and no OccupantValueAssignment', () => {
    expectTypeOf<HistoryIntent>().toEqualTypeOf<'none' | 'replace' | 'push'>();
    expect(INDEX_SOURCE).toMatch(/\bHistoryIntent\b/);
    expect(INDEX_SOURCE).not.toMatch(/OccupantValueAssignment/);
    expect(readFileSync(join(SRC_ROOT, 'router', 'RouterPort.ts'), 'utf8')).not.toMatch(/OccupantValueAssignment/);
  });
});

describe('import graph', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
    });
  }

  it('nothing under src imports @gears-frontx/routing or @gears-frontx/routing-tanstack', () => {
    const files = sources(SRC_ROOT);
    expect(files.length).toBeGreaterThan(50);
    const importOfRouter = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@gears-frontx\/routing(?:-tanstack)?(?:\/[^'"]*)?['"]/;
    const offenders = files.filter((file) => importOfRouter.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('connect', () => {
  it('is called exactly once, in the constructor, with an executor and the registry\'s own type system, before any registration', async () => {
    // inst-algo-ra-connect
    const rec = createRecorder();
    const plugin = createPlugin();

    const registry = build(rec.router, plugin);

    expect(rec.log).toHaveLength(1);
    const [member, executor, typeSystem] = rec.log[0]!;
    expect(member).toBe('connect');
    expect(typeSystem).toBe(plugin);
    expect(typeof (executor as Executor).executeActionsChain).toBe('function');

    registry.registerDomain(makeDomain('d-connect', true), domainFactory('concurrent', true));
    await registry.registerExtension(makeExtension('e-connect', 'd-connect'));
    await registry.unregisterExtension('e-connect');
    await registry.unregisterDomain('d-connect');
    await registry.dispose();

    expect(rec.members()[0]).toBe('connect');
    expect(rec.calls('connect')).toHaveLength(1);
  });

  it('the executor executes each chain it is given through the registry\'s own executeActionsChain', async () => {
    const rec = createRecorder();
    const registry = build(rec.router);
    const executor = rec.calls('connect')[0]![1] as Executor;
    const probeDomain = 'd-executor-probe';
    addProbeDomain(registry, probeDomain);
    const reached = createDeferred();
    const payloads: unknown[] = [];
    const mediator = (registry as unknown as { mediator: DefaultActionsChainsMediator }).mediator;
    mediator.registerHandler(probeDomain, 'probe.action', ActionHandler.fromFunction(async (_type, payload) => {
      payloads.push(payload);
      reached.resolve();
    }));

    executor.executeActionsChain({ action: { type: 'probe.action', target: probeDomain, payload: { n: 1 } } });
    await reached.promise;

    expect(payloads).toEqual([{ n: 1 }]);
  });

  it('a registry built with no router makes no router call and still works', async () => {
    const registry = build(undefined);

    registry.registerDomain(makeDomain('d-no-router', true), domainFactory('concurrent', true));
    await registry.registerExtension(makeExtension('e-no-router', 'd-no-router'));

    expect(registry.getExtension('e-no-router')).toBeDefined();
  });
});

describe('registration with the router', () => {
  it('only a declaration carrying route is registered, as ids, routes and one boolean', async () => {
    // inst-algo-ra-no-routing-grammar
    const rec = createRecorder();
    const registry = build(rec.router);
    const { route: _domainRoute, ...unroutedDomain } = makeDomain('d-unrouted', true) as unknown as Record<string, unknown>;
    const { route: _extensionRoute, ...unroutedExtension } = makeExtension('e-unrouted', 'd-routed') as unknown as Record<string, unknown>;

    registry.registerDomain({ ...makeDomain('d-routed', true), route: 'screens' }, domainFactory('concurrent', true));
    registry.registerDomain(unroutedDomain as never, domainFactory('concurrent', true));
    await registry.registerExtension({ ...makeExtension('e-routed', 'd-routed'), route: 'home' });
    await registry.registerExtension(unroutedExtension as never);

    expect(rec.calls('registerDomain')).toEqual([['registerDomain', 'd-routed', 'screens', true]]);
    expect(rec.calls('registerExtension')).toEqual([['registerExtension', 'e-routed', 'd-routed', 'home']]);
  });

  it.each<[Strategy, boolean]>([['concurrent', true], ['optional', true], ['exclusive', false]])(
    'declaresUnmount for a %s domain is %s: whether its actions list the unmount action id',
    (strategy, declaresUnmount) => {
      const rec = createRecorder();
      const registry = build(rec.router);

      registry.registerDomain(makeDomain(`d-${strategy}`, declaresUnmount), domainFactory(strategy, declaresUnmount));

      expect(rec.calls('registerDomain')).toEqual([['registerDomain', `d-${strategy}`, `d-${strategy}`, declaresUnmount]]);
    }
  );

  it('declaresUnmount compares the domain\'s actions with the unmount id the registry\'s type system resolves', () => {
    const rec = createRecorder();
    const plugin = createPlugin();
    plugin.resolveUnmountExtActionId = () => 'mock.action.v1~another_unmount.v1~';
    const registry = build(rec.router, plugin);

    // This domain lists ACTION_UNMOUNT_EXT, which is not the id this type system resolves.
    const base = makeDomain('d-other-id', false);
    registry.registerDomain({ ...base, actions: [...base.actions, ACTION_UNMOUNT_EXT] }, domainFactory('exclusive', true));

    expect(rec.calls('registerDomain')).toEqual([['registerDomain', 'd-other-id', 'd-other-id', false]]);
  });

  it('a router that rejects a routed registration leaves nothing admitted and receives no release for it', async () => {
    const rec = createRecorder({
      registerDomain: (domainId) => { if (domainId === 'd-refused') throw new Error('refused domain'); },
      registerExtension: (extensionId) => { if (extensionId === 'e-refused') throw new Error('refused extension'); },
    });
    const registry = build(rec.router);

    expect(() => registry.registerDomain(makeDomain('d-refused', true), domainFactory('concurrent', true))).toThrow('refused domain');
    registry.registerDomain(makeDomain('d-ok', true), domainFactory('concurrent', true));
    await expect(registry.registerExtension(makeExtension('e-refused', 'd-ok'))).rejects.toThrow('refused extension');
    expect(registry.getDomain('d-refused')).toBeUndefined();
    expect(registry.getExtension('e-refused')).toBeUndefined();

    await registry.dispose();

    expect(rec.calls('releaseDomain')).toEqual([['releaseDomain', 'd-ok']]);
    expect(rec.calls('releaseExtension')).toEqual([]);
  });

  it('releases are issued for what was admitted, with ids only', async () => {
    const rec = createRecorder();
    const registry = build(rec.router);
    registry.registerDomain(makeDomain('d-rel', true), domainFactory('concurrent', true));
    await registry.registerExtension(makeExtension('e-rel', 'd-rel'));

    await registry.unregisterDomain('d-rel');

    expect(rec.calls('releaseExtension')).toEqual([['releaseExtension', 'e-rel']]);
    expect(rec.calls('releaseDomain')).toEqual([['releaseDomain', 'd-rel']]);
  });

  it('no member is handed an object: its arguments are strings and booleans only, apart from connect, supplyNavigation and the reflect id list', async () => {
    const rec = createRecorder();
    const f = await setup('optional', 'd-scalars', ['A'], { router: rec.router });
    await f.registry.getMounter('d-scalars').mount('A', document.createElement('div'));
    await f.registry.getMounter('d-scalars').detach();
    await f.registry.unregisterDomain('d-scalars');

    const scalar = rec.log.filter(([member]) => member !== 'connect' && member !== 'supplyNavigation' && member !== 'reflect');
    expect(scalar.length).toBeGreaterThan(4);
    for (const [, ...args] of scalar) {
      for (const arg of args) expect(['string', 'boolean']).toContain(typeof arg);
    }
  });
});

describe('startDomain and stopDomain', () => {
  it('startDomain is called once per domain at attach, with the id, after the root is attached', async () => {
    // inst-sa-start-domain
    let mountAtStart: Promise<void> | undefined;
    const rec = createRecorder({
      startDomain: (domainId) => {
        mountAtStart = registry.getMounter(domainId as string).mount('absent', document.createElement('div'));
      },
    });
    const registry = build(rec.router);
    registry.registerDomain(makeDomain('d-start', true), domainFactory('concurrent', true));
    expect(rec.calls('startDomain')).toEqual([]);

    registry.getMounter('d-start').attach(document.createElement('div'));

    expect(rec.calls('startDomain')).toEqual([['startDomain', 'd-start']]);
    // A mount attempted from inside startDomain finds the root attached, so it fails for another reason.
    await expect(mountAtStart).rejects.not.toThrow(/no root attached/);
  });

  it('stopDomain is the first statement of detach: synchronous, before the root clears and before any unmount', async () => {
    // inst-sd-stop-domain
    const seen: string[] = [];
    const probes: Array<Promise<void>> = [];
    const rec = createRecorder({
      stopDomain: (domainId) => {
        seen.push(`mounted:${[...mountedIn(f.registry, domainId as string)].join(',')}`);
        seen.push(`unmounts-entered:${f.handler.events.filter((e) => e.startsWith('unmount-entered')).length}`);
        probes.push(f.registry.getMounter(domainId as string).mount('absent', document.createElement('div')));
      },
    });
    const f = await setup('concurrent', 'd-stop', ['A'], { router: rec.router });
    await f.registry.getMounter('d-stop').mount('A', document.createElement('div'));
    expect(rec.calls('stopDomain')).toEqual([]);

    const detaching = f.registry.getMounter('d-stop').detach();

    // Already called when detach() returned its promise: nothing was awaited.
    expect(rec.calls('stopDomain')).toEqual([['stopDomain', 'd-stop']]);
    await detaching;
    expect(seen).toEqual(['mounted:A', 'unmounts-entered:0']);
    // The root was still attached when stopDomain ran.
    await expect(probes[0]).rejects.not.toThrow(/no root attached/);
    expect(f.handler.events).toContain('unmount-entered:A');
  });

  it('a stopDomain that throws is logged and never interrupts the detach: the root clears and every extension unmounts', async () => {
    // inst-sd-stop-domain-failure
    const failure = new Error('router down');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rec = createRecorder({ stopDomain: () => { throw failure; } });
      const f = await setup('concurrent', 'd-stop-throws', ['A'], { router: rec.router });
      await f.registry.getMounter('d-stop-throws').mount('A', document.createElement('div'));

      await expect(f.registry.getMounter('d-stop-throws').detach()).resolves.toBeUndefined();

      expect(mountedIn(f.registry, 'd-stop-throws')).toEqual([]);
      expect(f.handler.events).toContain('unmount-entered:A');
      await expect(f.registry.getMounter('d-stop-throws').mount('absent', document.createElement('div')))
        .rejects.toThrow(/no root attached/);
      expect(errorLog).toHaveBeenCalledWith("[DefaultExtensionMounter] stopDomain failed for 'd-stop-throws':", failure);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('a registry built with no router attaches and detaches normally', async () => {
    const f = await setup('concurrent', 'd-no-router', ['A'], { router: null });
    await f.registry.getMounter('d-no-router').mount('A', document.createElement('div'));

    await f.registry.getMounter('d-no-router').detach();

    expect(mountedIn(f.registry, 'd-no-router')).toEqual([]);
  });
});

describe('assignOccupantValue', () => {
  it('is called at every mount with the domain id and the extension id only, before the lifecycle mount runs', async () => {
    const entriesAtAssign: number[] = [];
    const rec = createRecorder({
      assignOccupantValue: (_domainId, extensionId) => {
        entriesAtAssign.push(f.handler.mountEntries(extensionId as string));
        return undefined;
      },
    });
    const f = await setup('concurrent', 'd-assign', ['A'], { router: rec.router });
    const mounter = f.registry.getMounter('d-assign');

    await mounter.mount('A', document.createElement('div'));
    await f.registry.unregisterExtension('A');
    await f.registry.registerExtension(makeExtension('A', 'd-assign'));
    await mounter.mount('A', document.createElement('div'));

    expect(rec.calls('assignOccupantValue')).toEqual([
      ['assignOccupantValue', 'd-assign', 'A'],
      ['assignOccupantValue', 'd-assign', 'A'],
    ]);
    expect(entriesAtAssign).toEqual([0, 1]);
  });
});
