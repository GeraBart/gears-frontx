/**
 * URL commands (`reflect`) from the wrappers around an Exclusive or Optional
 * domain's handlers, driven through a real `DefaultMfeRegistry`, the shipped
 * strategies, and a recording `RouterPort` double.
 *
 * Every test ends by asserting the complete list of commands the router
 * received (`expectCommands` in the harness): it waits for the expected total,
 * then dispatches a trailing refused `none` request whose own settle command
 * must be the last one.
 *
 * Pins `cpt-frontx-algo-extension-domain-governance-mount-execution`:
 * `inst-me-cmd-wrapper`, `inst-me-cmd-accept`, `inst-me-cmd-accept-none`,
 * `inst-me-cmd-accept-refused`, `inst-me-cmd-settle`,
 * `inst-me-cmd-settlement-own-handling`, `inst-me-cmd-settle-async`,
 * `inst-me-cmd-projection-queue`, `inst-me-cmd-queue-read`,
 * `inst-me-cmd-settle-unexecuted`, `inst-me-already-mounted-complete`,
 * `inst-me-queue-join-pending`,
 * `inst-me-queue-replace-pending`, `inst-me-queue-pending-timeout`,
 * `inst-me-queue-domain-unregister`, `inst-me-queue-eligibility-at-turn`,
 * `inst-me-queue-running-never-interrupted`, `inst-me-optional-displace`,
 * `inst-me-exclusive-evict`, `inst-me-no-command-nested` (displacement and
 * eviction issue no command of their own), `inst-me-no-command-outside-action`,
 * `inst-um-queue-unmount-at-turn`,
 * `inst-um-queue-absent-noop`, `inst-sc-exclusive-row` (no `unmount_ext` in an
 * Exclusive domain), and
 * `cpt-frontx-dod-extension-domain-governance-url-commands`;
 * `cpt-frontx-algo-mfe-host-communication-history-intent`:
 * `inst-hi-selects-acceptance-verb`.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT, addProbeDomain, dispatch, expectCommands, mountSettled, setup,
  type Fixture, type Strategy,
} from './helpers/reflect-harness';

const queueStrategies: Strategy[] = ['exclusive', 'optional'];
const fixtures: Fixture[] = [];

async function make(strategy: Strategy, domainId: string, ids: string[]): Promise<Fixture> {
  const f = await setup(strategy, domainId, ids);
  fixtures.push(f);
  return f;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const f of fixtures.splice(0)) await f.registry.dispose();
});

describe.each(queueStrategies)('[%s] acceptance and settle commands of a mount', (strategy) => {
  it.each([
    ['push', 'push'],
    ['replace', 'replace'],
    [undefined, 'push'],
  ] as const)('intent %s: acceptance command (%s) names [A] before the mount finishes, then the settle command (replace) names [A]', async (intent, verb) => {
    // inst-me-cmd-accept, inst-hi-selects-acceptance-verb, inst-me-cmd-settle
    const d = `d-accept-${strategy}-${String(intent)}`;
    const f = await make(strategy, d, ['A']);
    f.handler.holdMount('A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', ...(intent ? { history: intent } : {}) });
    expect(f.rr.calls).toEqual([[d, ['A'], verb]]);
    await f.handler.mountStarted('A');
    expect(f.rr.calls).toEqual([[d, ['A'], verb]]);

    f.handler.releaseMount('A');
    expect(await done).toBe('next');
    await expectCommands(f, [[d, ['A'], verb], [d, ['A'], 'replace']]);
  });

  it('intent none: no acceptance command, but a settle command naming [A]', async () => {
    // inst-me-cmd-accept-none, inst-me-cmd-settle
    const d = `d-none-${strategy}`;
    const f = await make(strategy, d, ['A']);
    f.handler.holdMount('A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' });
    await f.handler.mountStarted('A');
    expect(f.rr.calls).toEqual([]);

    f.handler.releaseMount('A');
    expect(await done).toBe('next');
    await expectCommands(f, [[d, ['A'], 'replace']]);
  });

  it.each(['push', 'replace', 'none'] as const)('already mounted with an empty queue, intent %s: acceptance per intent and settle, both naming [A]', async (intent) => {
    // inst-me-already-mounted-complete, inst-me-cmd-accept, inst-me-cmd-settle-unexecuted
    const d = `d-already-${strategy}-${intent}`;
    const f = await make(strategy, d, ['A']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: intent });
    expect(f.rr.calls).toEqual(intent === 'none' ? [] : [[d, ['A'], intent]]);
    expect(await done).toBe('next');
    await expectCommands(f, [
      ...(intent === 'none' ? [] : [[d, ['A'], intent] as [string, string[], 'push' | 'replace']]),
      [d, ['A'], 'replace'],
    ]);
  });

  it('a mount refused at once (extension not admitted): no acceptance command, one settle command, issued after the call returns', async () => {
    // inst-me-cmd-accept-refused, inst-me-cmd-settle, inst-me-cmd-settle-async
    const d = `d-refused-${strategy}`;
    const f = await make(strategy, d, ['A']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'ghost', history: 'push' });
    expect(f.rr.calls).toEqual([]);
    expect(await done).toBe('fallback');
    await expectCommands(f, [[d, ['A'], 'replace']]);
  });

  it('a mount of B accepted behind a running mount of A: the commands once B is accepted, and A\'s settle command, name [B] alone', async () => {
    // inst-me-cmd-projection-queue, inst-me-cmd-queue-read, inst-me-cmd-settle
    const d = `d-behind-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    f.handler.holdMount('A');

    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['B'], 'push']]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    expect(await doneB).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['B'], 'push'],
      [d, ['B'], 'replace'], [d, ['B'], 'replace'],
    ]);
  });

  it('replace-pending: B pending, C arrives: B\'s caller fails, its settle command names [C]; C\'s acceptance names [C]', async () => {
    // inst-me-queue-replace-pending, inst-me-cmd-settle, inst-me-cmd-settle-unexecuted
    const d = `d-replace-pending-${strategy}`;
    const f = await make(strategy, d, ['A', 'B', 'C']);
    f.handler.holdMount('A');

    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    const doneC = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'C', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['C'], 'push']]);

    expect(await doneB).toBe('fallback');
    await f.rr.whenCalls(4);
    expect(f.rr.calls).toEqual([
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['C'], 'push'], [d, ['C'], 'replace'],
    ]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    expect(await doneC).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['C'], 'push'],
      [d, ['C'], 'replace'], [d, ['C'], 'replace'], [d, ['C'], 'replace'],
    ]);
  });

  it('join: two callers of the same pending B each issue their own acceptance and their own settle command', async () => {
    // inst-me-queue-join-pending, inst-me-cmd-settle, inst-me-cmd-settle-unexecuted
    const d = `d-join-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    f.handler.holdMount('A');

    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneB1 = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    const doneB2 = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['B'], 'push']]);

    f.handler.releaseMount('A');
    expect(await Promise.all([doneA, doneB1, doneB2])).toEqual(['next', 'next', 'next']);
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['B'], 'push'],
      [d, ['B'], 'replace'], [d, ['B'], 'replace'], [d, ['B'], 'replace'],
    ]);
  });

  it('two joined callers, one caller\'s own timer fires while pending: that caller fails alone and its settle command still names [B]', async () => {
    // inst-me-queue-pending-timeout, inst-me-cmd-settle
    const d = `d-join-timer-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    vi.useFakeTimers();
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');

    const doneB1 = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { timeout: 100 });
    const doneB2 = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    await vi.advanceTimersByTimeAsync(100);

    expect(await doneB1).toBe('fallback');
    await f.rr.whenCalls(4);
    expect(f.rr.calls).toEqual([
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['B'], 'push'], [d, ['B'], 'replace'],
    ]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    expect(await doneB2).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['B'], 'push'],
      [d, ['B'], 'replace'], [d, ['B'], 'replace'], [d, ['B'], 'replace'],
    ]);
  });

  it('a lone pending request whose own timer fires: it fails alone, never starts, and issues one settle command naming the running entry', async () => {
    // inst-me-queue-pending-timeout, inst-me-cmd-settle, inst-me-cmd-settle-unexecuted
    const d = `d-lone-timer-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    vi.useFakeTimers();
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');

    const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { timeout: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await doneB).toBe('fallback');
    await f.rr.whenCalls(3);
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['A'], 'replace']]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['A'], 'replace'], [d, ['A'], 'replace'],
    ]);
    expect(f.registry.getMountedExtensions(d)).toEqual(['A']);
  });

  it('a caller whose entry is running when the mediator\'s per-action bound fires still has its settle command issued when the wrapper\'s handling settles', async () => {
    // inst-me-cmd-settlement-own-handling, inst-me-queue-running-never-interrupted
    const d = `d-bound-${strategy}`;
    const f = await make(strategy, d, ['A']);
    f.handler.holdMount('A');
    vi.useFakeTimers();

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' }, { timeout: 100 });
    await f.handler.mountStarted('A');
    await vi.advanceTimersByTimeAsync(100);
    expect(await done).toBe('fallback');
    expect(f.rr.calls).toEqual([[d, ['A'], 'push']]);

    f.handler.releaseMount('A');
    await expectCommands(f, [[d, ['A'], 'push'], [d, ['A'], 'replace']]);
  });

  it('a request arriving once its domain\'s unregistration has begun: no acceptance command, it takes its fallback, and exactly one settle command is issued', async () => {
    // inst-me-cmd-accept-refused, inst-me-queue-domain-unregister, inst-me-cmd-settle
    const d = `d-unregister-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    await mountSettled(f, 'A');
    f.handler.holdUnmount('A');

    // Unregistration unmounts A and holds that teardown open; once the teardown
    // has started, the domain is closed to new requests.
    const unregistered = f.registry.unregisterDomain(d);
    await f.handler.unmountStarted('A');

    const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([]);
    expect(await doneB).toBe('fallback');
    await f.rr.whenCalls(1);
    expect(f.rr.calls).toHaveLength(1);
    expect(f.rr.calls[0][0]).toBe(d);
    expect(f.rr.calls[0][2]).toBe('replace');

    f.handler.releaseUnmount('A');
    await unregistered;
    expect(f.rr.calls).toHaveLength(1);
  });

  it('a pending request failed by its domain\'s unregistration: its fallback runs and it issues exactly one settle command beyond its own acceptance; the running request completes with its own outcome and then is released', async () => {
    // inst-me-queue-domain-unregister, inst-me-queue-running-never-interrupted, inst-me-cmd-settle (a request, not an outside event), inst-me-no-command-outside-action
    const d = `d-unregister-pending-${strategy}`;
    const probes = `${d}-probes`;
    const f = await make(strategy, d, ['A', 'B']);
    addProbeDomain(f.registry, probes);
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' }, { probeDomainId: probes });
    await f.handler.mountStarted('A');
    const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { probeDomainId: probes });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['B'], 'push']]);

    const unregistered = f.registry.unregisterDomain(d);
    expect(await doneB).toBe('fallback');
    await f.rr.whenCalls(3);
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['A'], 'replace']]);
    // The running mount is not interrupted: A is not released while it runs.
    expect(f.rr.released).toEqual([]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    await unregistered;
    await f.rr.whenCalls(4);
    expect(f.rr.calls).toEqual([
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['A'], 'replace'], [d, ['A'], 'replace'],
    ]);
    expect(f.rr.released).toContain('releaseExtension:A');
    expect(f.rr.released).toContain(`releaseDomain:${d}`);
  });

  it('a request whose subject is not a string issues no acceptance command and still issues its settle command', async () => {
    // inst-me-cmd-settle, inst-me-cmd-accept
    const d = `d-nonstring-${strategy}`;
    const f = await make(strategy, d, ['A']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 7 as unknown as string, history: 'push' });
    expect(f.rr.calls).toEqual([]);
    await done;
    await f.rr.whenCalls(1);
    expect(f.rr.calls).toEqual([[d, [...f.registry.getMountedExtensions(d)], 'replace']]);
  });

  it('a burst A, B, C, D: B and C take their fallbacks, every one of the four requests issues one settle command, and D is the sole occupant', async () => {
    // inst-me-queue-replace-pending, inst-me-cmd-settle, inst-me-cmd-projection-queue
    const d = `d-burst-${strategy}`;
    const f = await make(strategy, d, ['A', 'B', 'C', 'D']);
    f.handler.holdMount('A');

    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    const doneC = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'C', history: 'push' });
    const doneD = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'D', history: 'push' });
    expect(f.rr.calls).toEqual([
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['C'], 'push'], [d, ['D'], 'push'],
    ]);

    expect(await doneB).toBe('fallback');
    expect(await doneC).toBe('fallback');
    await f.rr.whenCalls(6);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    expect(await doneD).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['B'], 'push'], [d, ['C'], 'push'], [d, ['D'], 'push'],
      [d, ['D'], 'replace'], [d, ['D'], 'replace'], [d, ['D'], 'replace'], [d, ['D'], 'replace'],
    ]);
    expect(f.registry.getMountedExtensions(d)).toEqual(['D']);
  });

  it('a successful displacement (Optional) / eviction (Exclusive) of A by a mount of B issues its acceptance and settle commands naming [B] and no command naming both', async () => {
    // inst-me-optional-displace, inst-me-exclusive-evict, inst-me-no-command-nested, inst-me-cmd-projection-queue
    const d = `d-displace-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['B'], 'push']]);
    expect(await done).toBe('next');
    await expectCommands(f, [[d, ['B'], 'push'], [d, ['B'], 'replace']]);
    expect(f.rr.calls.every(([, ids]) => ids.length <= 1)).toBe(true);
    expect(f.registry.getMountedExtensions(d)).toEqual(['B']);
  });

  it('a mount of B that displaces/evicts A and then fails issues a settle command naming no extension', async () => {
    // inst-me-cmd-settle (settle computed after the entry left the queue), inst-me-cmd-projection-queue
    const d = `d-evict-fail-${strategy}`;
    const f = await make(strategy, d, ['A', 'B']);
    await mountSettled(f, 'A');
    f.handler.failMount('B');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['B'], 'push']]);
    expect(await done).toBe('fallback');
    await expectCommands(f, [[d, ['B'], 'push'], [d, [], 'replace']]);
  });
});

describe('Exclusive domain: no unmount_ext', () => {
  it('an unmount_ext dispatched to an Exclusive domain finds no handler and takes its fallback; no command is issued and the occupant stays mounted', async () => {
    // inst-sc-exclusive-row, inst-me-cmd-wrapper (no unmount_ext wrapper to command from)
    const d = 'd-exclusive-no-unmount';
    const f = await make('exclusive', d, ['A']);
    await mountSettled(f, 'A');

    expect(await dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' })).toBe('fallback');
    expect(f.rr.calls).toEqual([]);
    expect(f.registry.getMountedExtensions(d)).toEqual(['A']);
  });
});

describe('Optional domain: unmount commands', () => {
  it('an explicit unmount of mounted A with push: acceptance and settle commands both name []', async () => {
    // inst-um-queue-unmount-at-turn, inst-me-cmd-accept, inst-me-cmd-settle, inst-me-cmd-projection-queue
    const d = 'd-opt-unmount-mounted';
    const f = await make('optional', d, ['A']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, [], 'push']]);
    expect(await done).toBe('next');
    await expectCommands(f, [[d, [], 'push'], [d, [], 'replace']]);
    expect(f.registry.getMountedExtensions(d)).toEqual([]);
  });

  it('a mount of A running, then an unmount of A accepted: the commands issued once the unmount is accepted name []', async () => {
    // inst-me-cmd-projection-queue (an unmount of X removes X), inst-me-cmd-settle
    const d = 'd-opt-unmount-behind';
    const f = await make('optional', d, ['A']);
    f.handler.holdMount('A');

    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, [], 'push']]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    expect(await doneU).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, [], 'push'], [d, [], 'replace'], [d, [], 'replace'],
    ]);
  });

  it('an unmount of an admitted subject that is absent at its turn, queued behind a mount of another extension, succeeds without change and issues its settle command', async () => {
    // inst-um-queue-absent-noop, inst-me-cmd-settle-unexecuted, inst-me-cmd-projection-queue
    const d = 'd-opt-unmount-absent';
    const f = await make('optional', d, ['A', 'B']);
    f.handler.holdMount('A');

    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['A'], 'push']]);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    expect(await doneU).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['A'], 'push'], [d, ['A'], 'replace'], [d, ['A'], 'replace'],
    ]);
    expect(f.registry.getMountedExtensions(d)).toEqual(['A']);
  });

  it.each(['push', 'none'] as const)('an unmount (%s) naming a non-admitted subject is placed, gets its acceptance per intent, fails at its turn, and issues its settle command', async (intent) => {
    // inst-me-queue-eligibility-at-turn, inst-me-cmd-accept, inst-me-cmd-settle
    const d = `d-opt-unmount-ghost-${intent}`;
    const f = await make('optional', d, []);

    const done = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'ghost', history: intent });
    expect(f.rr.calls).toEqual(intent === 'none' ? [] : [[d, [], 'push']]);
    expect(await done).toBe('fallback');
    await expectCommands(f, [
      ...(intent === 'none' ? [] : [[d, [], 'push'] as [string, string[], 'push' | 'replace']]),
      [d, [], 'replace'],
    ]);
  });
});
