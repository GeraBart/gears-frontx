import { afterEach, describe, it, expect } from 'vitest';
import { OptionalMountStrategy } from '../OptionalMountStrategy';
import { makePayload } from './helpers/make-payload';
import { FakeMounter } from './helpers/FakeMounter';
import { FakeContainerHooks } from './helpers/FakeContainerHooks';
import { mountedIn } from './helpers/mounted-in';
import { strategyDomain, type StrategyDomain } from './helpers/strategy-domain';

// ─── OptionalMountStrategy ───────────────────────────────────────────────────
//
// Constructed as `new OptionalMountStrategy(mounter, hooks)`; the strategy reads
// its domain's mount set through its own mounter. Driven directly, bypassing
// the occupancy queue.

describe('OptionalMountStrategy', () => {
  const DOMAIN = 'test-domain';
  const opened: StrategyDomain[] = [];

  async function open(): Promise<StrategyDomain> {
    const d = await strategyDomain('optional', DOMAIN, ['ext-a', 'ext-b']);
    opened.push(d);
    return d;
  }

  afterEach(async () => {
    for (const d of opened.splice(0)) await d.registry.dispose();
  });

  it('returns without action on a direct mount of an already-mounted subject (already-mounted handling is normally done by the mount-ext prologue)', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));
    expect(d.hooks.created).toEqual(['ext-a']);

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

  it('mount displaces a different occupant before mounting the new one', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));

    await d.strategy.mount(makePayload('ext-b'));

    expect(mountedIn(d.registry, DOMAIN)).toEqual(['ext-b']);
    expect(d.hooks.destroyed).toEqual(['ext-a']);
    expect(d.hooks.created).toEqual(['ext-a', 'ext-b']);
  });

  it('unmount of a subject outside the mount set changes nothing', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));

    await d.strategy.unmount!(makePayload('ext-b'));

    expect(mountedIn(d.registry, DOMAIN)).toEqual(['ext-a']);
    expect(d.hooks.destroyed).toEqual([]);
  });

  it('unmount removes the named extension when it is in the mount set', async () => {
    const d = await open();
    await d.strategy.mount(makePayload('ext-a'));

    await d.strategy.unmount!(makePayload('ext-a'));

    expect(mountedIn(d.registry, DOMAIN)).toEqual([]);
    expect(d.hooks.destroyed).toEqual(['ext-a']);
  });

  it('a strategy built with a mounter the runtime never registered throws when it reads the mount set', async () => {
    const mounter = new FakeMounter();
    const hooks = new FakeContainerHooks();
    const strategy = new OptionalMountStrategy(mounter, hooks);

    await expect(strategy.mount(makePayload('ext-a'))).rejects.toThrow(/never registered/);

    expect(mounter.mountCalls).toHaveLength(0);
    expect(hooks.created).toHaveLength(0);
  });
});
