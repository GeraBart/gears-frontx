import { afterEach, describe, it, expect } from 'vitest';
import { ExclusiveMountStrategy } from '../ExclusiveMountStrategy';
import { makePayload } from './helpers/make-payload';
import { FakeMounter } from './helpers/FakeMounter';
import { FakeContainerHooks } from './helpers/FakeContainerHooks';
import { mountedIn } from './helpers/mounted-in';
import { strategyDomain, type StrategyDomain } from './helpers/strategy-domain';

// ─── ExclusiveMountStrategy ──────────────────────────────────────────────────
//
// Constructed as `new ExclusiveMountStrategy(mounter, hooks)`; the strategy reads
// its domain's mount set through its own mounter. Driven directly, bypassing
// the occupancy queue.

describe('ExclusiveMountStrategy', () => {
  const DOMAIN = 'excl-domain';
  const opened: StrategyDomain[] = [];

  async function open(): Promise<StrategyDomain> {
    const d = await strategyDomain('exclusive', DOMAIN, ['ext-a', 'ext-b', 'ext-c']);
    opened.push(d);
    return d;
  }

  afterEach(async () => {
    for (const d of opened.splice(0)) await d.registry.dispose();
  });

  it('returns without action on a direct mount of the sole already-mounted subject (already-mounted handling is normally done by the mount-ext prologue)', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));

    // Through the mediator, the registry's mount-ext prologue
    // (`MountExtActionHandler`) short-circuits an already-mounted request
    // before this strategy body ever runs. A direct call bypasses that
    // prologue, so this defensive check returns successfully without
    // mounting 'ext-a' a second time, rather than throwing.
    await expect(d.strategy.mount(makePayload('ext-a'))).resolves.toBeUndefined();

    expect(d.hooks.created).toEqual(['ext-a']);
    expect(d.hooks.destroyed).toEqual([]);
    expect(mountedIn(d.registry, DOMAIN)).toEqual(['ext-a']);
  });

  it('a replacing mount evicts the occupant and mounts the new extension', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));

    await d.strategy.mount(makePayload('ext-b'));

    expect(mountedIn(d.registry, DOMAIN)).toEqual(['ext-b']);
    expect(d.hooks.destroyed).toEqual(['ext-a']);
    expect(d.hooks.created).toEqual(['ext-a', 'ext-b']);
  });

  it('a mount evicts every other member of the mount set', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));
    // A second member placed straight through the domain's mounter, as a mount that bypassed the strategy would.
    await d.registry.getMounter(DOMAIN).mount('ext-b', document.createElement('div'));
    expect(mountedIn(d.registry, DOMAIN)).toEqual(['ext-a', 'ext-b']);

    await d.strategy.mount(makePayload('ext-c'));

    expect(mountedIn(d.registry, DOMAIN)).toEqual(['ext-c']);
    expect(d.hooks.destroyed).toContain('ext-a');
  });

  it('exposes no unmount member', async () => {
    const d = await open();
    expect('unmount' in d.strategy).toBe(false);
  });

  it('a strategy built with a mounter the runtime never registered throws when it reads the mount set', async () => {
    const mounter = new FakeMounter();
    const hooks = new FakeContainerHooks();
    const strategy = new ExclusiveMountStrategy(mounter, hooks);

    await expect(strategy.mount(makePayload('ext-a'))).rejects.toThrow(/never registered/);

    expect(mounter.mountCalls).toHaveLength(0);
    expect(hooks.created).toHaveLength(0);
  });
});
