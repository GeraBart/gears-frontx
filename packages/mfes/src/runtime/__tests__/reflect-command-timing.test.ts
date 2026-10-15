/**
 * Timing, chain independence and events outside an action execution for URL
 * commands (`reflect`), in every strategy, through a real `DefaultMfeRegistry`
 * and a recording `RouterPort` double.
 *
 * Every test that issues commands ends by asserting the complete list of
 * commands the router received (`expectCommands` in the harness).
 *
 * Pins `cpt-frontx-algo-extension-domain-governance-mount-execution`:
 * `inst-me-cmd-accept` (synchronous within the delivering call),
 * `inst-me-cmd-settle-async` (no settle command inside a synchronous
 * dispatch loop), `inst-me-cmd-accept-none`, `inst-me-cmd-chain-independent`, `inst-me-cmd-no-memory`,
 * `inst-me-cmd-wrapper`, `inst-me-no-command-outside-action`,
 * `inst-me-no-command-nested`, `inst-me-no-command-standalone`, and
 * `cpt-frontx-dod-extension-domain-governance-url-commands`;
 * `cpt-frontx-algo-extension-domain-governance-slot-detach`:
 * `inst-sd-no-command`;
 * `cpt-frontx-algo-mfe-registry-router-admission`:
 * `inst-algo-ra-cleanup-no-command`;
 * `cpt-frontx-algo-mfe-host-communication-history-intent`:
 * `inst-hi-selects-acceptance-verb`, `inst-hi-admit-strict`,
 * `inst-hi-not-to-router`.
 */
import { mountedIn } from './helpers/mounted-in';
import { afterEach, describe, it, expect } from 'vitest';
import type { Extension } from '../../types';
import { MfeHandler, type MfeEntryLifecycle } from '../../handler/MfeHandler';
import type { ChildMfeBridge } from '../../handler/ChildMfeBridge';
import { MfeBridgeFactoryDefault } from '../../bridge/MfeBridgeFactoryDefault';
import {
  ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT, REJECTED_HISTORY, createPlugin, createReflectRouter, dispatch,
  expectCommands, mountSettled, setup,
  type Command, type Fixture, type SetupOptions, type Strategy,
} from './helpers/reflect-harness';

const strategies: Strategy[] = ['exclusive', 'optional', 'concurrent'];
const fixtures: Fixture[] = [];

async function make(strategy: Strategy, domainId: string, ids: string[], options: SetupOptions = {}): Promise<Fixture> {
  const f = await setup(strategy, domainId, ids, options);
  fixtures.push(f);
  return f;
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.registry.dispose();
});

describe.each(strategies)('[%s] timing of commands', (strategy) => {
  it('the acceptance command is recorded synchronously when the delivering call returns, for a fresh and for an already-mounted request', async () => {
    // inst-me-cmd-accept
    const d = `d-sync-${strategy}`;
    const f = await make(strategy, d, ['A']);
    f.handler.holdMount('A');

    const fresh = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push']]);
    f.handler.releaseMount('A');
    expect(await fresh).toBe('next');
    await expectCommands(f, [[d, ['A'], 'push'], [d, ['A'], 'replace']]);
    f.rr.reset();

    const already = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'replace' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'replace']]);
    expect(await already).toBe('next');
    await expectCommands(f, [[d, ['A'], 'replace'], [d, ['A'], 'replace']]);
  });

  it('no settle command lands inside a synchronous loop dispatching several none chains, a synchronously refused one included', async () => {
    // inst-me-cmd-settle-async, inst-me-cmd-accept-none
    const d = `d-loop-${strategy}`;
    let inLoop = false;
    const duringLoop: Command[] = [];
    const rr = createReflectRouter((command) => { if (inLoop) duringLoop.push(command); });
    const f = await make(strategy, d, ['A', 'B'], { rr });
    await mountSettled(f, 'A');

    const outcomes: Array<Promise<'next' | 'fallback'>> = [];
    inLoop = true;
    outcomes.push(dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }));
    outcomes.push(dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'ghost', history: 'none' }));
    outcomes.push(dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'none' }));
    inLoop = false;

    expect(duringLoop).toEqual([]);
    expect(await Promise.all(outcomes)).toEqual(['next', 'fallback', 'next']);
    const projection = strategy === 'concurrent' ? ['A', 'B'] : ['B'];
    await expectCommands(f, [[d, projection, 'replace'], [d, projection, 'replace'], [d, projection, 'replace']]);
  });

  it.each(['push', 'none'] as const)('intent %s: every command is exactly [domain id, extension ids, verb]; the intent never reaches the router', async (intent) => {
    // inst-hi-not-to-router, inst-hi-selects-acceptance-verb, inst-me-cmd-wrapper, inst-me-cmd-accept-none
    const d = `d-shape-${strategy}-${intent}`;
    const f = await make(strategy, d, ['A']);

    expect(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: intent })).toBe('next');
    const expected: Command[] = intent === 'push'
      ? [[d, ['A'], 'push'], [d, ['A'], 'replace']]
      : [[d, ['A'], 'replace']];
    await expectCommands(f, expected);

    const reflect = f.rr.router.reflect as unknown as { mock: { calls: unknown[][] } };
    expect(reflect.mock.calls).toEqual([...expected, [d, ['A'], 'replace']]);
  });

  it('an action failing admission takes its fallback, issues no command, and keeps its history intent unchanged', async () => {
    // inst-hi-admit-strict, inst-me-cmd-wrapper (a refused action never reaches the wrapper)
    const d = `d-admission-${strategy}`;
    const f = await make(strategy, d, ['A'], { plugin: createPlugin({ rejectHistory: true }) });
    const payload = { subject: 'A', history: REJECTED_HISTORY as unknown as 'push' };

    expect(await dispatch(f.registry, d, ACTION_MOUNT_EXT, payload)).toBe('fallback');
    expect(payload.history).toBe(REJECTED_HISTORY);
    expect(mountedIn(f.registry, d)).toEqual([]);
    await expectCommands(f, []);
  });

  it('the runtime keeps no memory of what it commanded: a settle command is issued although the projection is unchanged', async () => {
    // inst-me-cmd-no-memory
    const d = `d-memory-${strategy}`;
    const f = await make(strategy, d, ['A']);
    await mountSettled(f, 'A');

    expect(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' })).toBe('next');
    await f.rr.whenCalls(1);
    expect(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' })).toBe('next');
    await expectCommands(f, [[d, ['A'], 'replace'], [d, ['A'], 'replace']]);
  });
});

describe.each(strategies)('[%s] chain independence', (strategy) => {
  async function scenario(f: Fixture): Promise<{ outcomes: Array<'next' | 'fallback'>; mounted: readonly string[] }> {
    const d = f.domainId;
    f.handler.failMount('B');
    const outcomes: Array<'next' | 'fallback'> = [];
    outcomes.push(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' }));
    outcomes.push(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }));
    outcomes.push(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'ghost', history: 'replace' }));
    if (strategy !== 'exclusive') {
      outcomes.push(await dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'none' }));
    }
    return { outcomes, mounted: mountedIn(f.registry, d) };
  }

  it('outcome and next/fallback execution are identical with a router double and with no router, and no chain waits on a command', async () => {
    // inst-me-cmd-chain-independent
    const withRouter = await make(strategy, `d-ci-router-${strategy}`, ['A', 'B']);
    const withoutRouter = await make(strategy, `d-ci-none-${strategy}`, ['A', 'B'], { router: null });
    // A router whose commands return pending promises: nothing in a chain may wait on them.
    const pendingReturns = createReflectRouter();
    (pendingReturns.router as unknown as { reflect: () => Promise<never> }).reflect = () => new Promise<never>(() => {});
    const neverSettling = await make(strategy, `d-ci-pending-${strategy}`, ['A', 'B'], { router: pendingReturns.router });

    const expected = await scenario(withoutRouter);
    expect(await scenario(withRouter)).toEqual(expected);
    expect(await scenario(neverSettling)).toEqual(expected);
    expect(withRouter.rr.calls.length).toBeGreaterThan(0);
  });

  it('a registry with no router runs every request, unmounts included, and succeeds', async () => {
    // inst-me-no-command-standalone
    const d = `d-norouter-${strategy}`;
    const f = await make(strategy, d, ['A'], { router: null });
    expect(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' })).toBe('next');
    expect(mountedIn(f.registry, d)).toEqual(['A']);
    if (strategy !== 'exclusive') {
      expect(await dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' })).toBe('next');
      expect(mountedIn(f.registry, d)).toEqual([]);
    }
  });
});

describe.each(strategies)('[%s] events outside an action execution', (strategy) => {
  it.each(['slot detach', 'unregisterExtension', 'unregisterDomain', 'dispose'] as const)('%s of a mounted extension issues no command and dispatches no unmount_ext; the release notifications still reach the router', async (event) => {
    // inst-me-no-command-outside-action, inst-sd-no-command, inst-algo-ra-cleanup-no-command
    const d = `d-outside-${strategy}-${event.replace(/\s/g, '-')}`;
    const f = await make(strategy, d, ['A']);
    await mountSettled(f, 'A');

    if (event === 'slot detach') {
      await f.registry.getMounter(d).detach();
      expect(f.rr.released).toEqual([]);
      await expectCommands(f, []);
    } else if (event === 'unregisterExtension') {
      await f.registry.unregisterExtension('A');
      expect(f.rr.released).toEqual(['releaseExtension:A']);
      await expectCommands(f, []);
    } else if (event === 'unregisterDomain') {
      await f.registry.unregisterDomain(d);
      expect(f.rr.released).toContain('releaseExtension:A');
      expect(f.rr.released.at(-1)).toBe(`releaseDomain:${d}`);
      expect(f.rr.calls).toEqual([]);
    } else {
      await f.registry.dispose();
      expect(f.rr.released).toContain('releaseExtension:A');
      expect(f.rr.released).toContain(`releaseDomain:${d}`);
      expect(f.rr.calls).toEqual([]);
    }
    expect(f.unmountActions).toEqual([]);
  });
});

const HOST_ENTRY = 'mock.entry.v1~nested-host.v1';
const NESTED_DOMAIN = 'd-nested-inner';

/** An extension hosting a nested registry with its own router double; its unmount detaches the nested slot. */
class NestedHostHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();
  nested: Fixture | undefined;

  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return {
      mount: async () => { this.nested = await setup('optional', NESTED_DOMAIN, ['N']); },
      unmount: async () => { await this.nested!.registry.getMounter(NESTED_DOMAIN).detach(); },
    };
  }
}

describe.each(strategies)('[%s] nested host replacement', (strategy) => {
  it('the parent registry commands only the incoming occupancy; the nested registry records no command and dispatches no unmount_ext for its released occupants', async () => {
    // inst-me-no-command-nested, inst-sd-no-command
    const d = `d-nested-${strategy}`;
    const host = new NestedHostHandler(HOST_ENTRY);
    const f = await make(strategy, d, ['B'], { extraEntries: [{ entryId: HOST_ENTRY, handler: host }] });
    await f.registry.registerExtension({ id: 'H', domain: d, entry: HOST_ENTRY } as Extension);
    await mountSettled(f, 'H');
    const nested = host.nested!;
    fixtures.push(nested);
    await mountSettled(nested, 'N');
    expect(mountedIn(nested.registry, NESTED_DOMAIN)).toEqual(['N']);

    if (strategy === 'concurrent') {
      expect(await dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'H', history: 'push' })).toBe('next');
      await expectCommands(f, [[d, [], 'push'], [d, [], 'replace']]);
      expect(f.unmountActions).toEqual(['H']);
    } else {
      expect(await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' })).toBe('next');
      await expectCommands(f, [[d, ['B'], 'push'], [d, ['B'], 'replace']]);
      expect(f.unmountActions).toEqual([]);
    }

    expect(mountedIn(nested.registry, NESTED_DOMAIN)).toEqual([]);
    expect(nested.rr.calls).toEqual([]);
    expect(nested.unmountActions).toEqual([]);
  });
});
