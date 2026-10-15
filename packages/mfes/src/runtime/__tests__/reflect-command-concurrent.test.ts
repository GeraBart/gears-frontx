/**
 * URL commands (`reflect`) from the wrappers around a Concurrent domain's
 * handlers, through a real `DefaultMfeRegistry`, the shipped
 * `ConcurrentMountStrategy`, and a recording `RouterPort` double.
 *
 * Every test ends by asserting the complete list of commands the router
 * received (`expectCommands` in the harness).
 *
 * Pins `cpt-frontx-algo-extension-domain-governance-mount-execution`:
 * `inst-me-cmd-concurrent-accept`, `inst-me-cmd-concurrent-record`,
 * `inst-me-cmd-record-set`, `inst-me-cmd-record-clear`,
 * `inst-me-cmd-projection-concurrent`, `inst-me-cmd-projection-order`,
 * `inst-me-cmd-accept`, `inst-me-cmd-accept-none`, `inst-me-cmd-accept-refused`,
 * `inst-me-cmd-settle`, `inst-me-cmd-settle-unexecuted`,
 * `inst-me-join-in-progress-mount`, `inst-me-already-mounted-complete`,
 * `inst-me-await-unmount-settle`, `inst-me-fail-after-unmount-failure`,
 * `inst-um-await-mount-settle`, `inst-um-after-mount-failure`,
 * `inst-me-no-command-outside-action` (a slot detach leaves no stale record), and
 * `cpt-frontx-dod-extension-domain-governance-url-commands`.
 */
import { mountedIn } from './helpers/mounted-in';
import { afterEach, describe, it, expect } from 'vitest';
import {
  ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT, dispatch, expectCommands, mountSettled, replaceNamingOneOf, setup,
  type Command, type Fixture,
} from './helpers/reflect-harness';

const fixtures: Fixture[] = [];

async function make(domainId: string, ids: string[]): Promise<Fixture> {
  const f = await setup('concurrent', domainId, ids);
  fixtures.push(f);
  return f;
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.registry.dispose();
});

describe('Concurrent domain commands', () => {
  it('projection order: A, B mounted; mount C accepted, then mount A accepted: commands name [A, B, C] with no duplicate', async () => {
    // inst-me-cmd-projection-order, inst-me-cmd-projection-concurrent, inst-me-cmd-concurrent-record
    const d = 'd-cc-order';
    const f = await make(d, ['A', 'B', 'C']);
    await mountSettled(f, 'A');
    await mountSettled(f, 'B');
    f.handler.holdMount('C');

    const doneC = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'C', history: 'push' });
    await f.handler.mountStarted('C');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A', 'B', 'C'], 'push'], [d, ['A', 'B', 'C'], 'push']]);

    f.handler.releaseMount('C');
    expect(await doneC).toBe('next');
    expect(await doneA).toBe('next');
    await expectCommands(f, [
      [d, ['A', 'B', 'C'], 'push'], [d, ['A', 'B', 'C'], 'push'],
      [d, ['A', 'B', 'C'], 'replace'], [d, ['A', 'B', 'C'], 'replace'],
    ]);
  });

  it.each(['push', 'none'] as const)('an unmount of A carrying %s, accepted while a mount of A is in flight: its acceptance command per intent names [], and the in-flight mount\'s settle command omits A', async (intent) => {
    // inst-me-cmd-accept, inst-me-cmd-accept-none, inst-me-cmd-record-set, inst-me-cmd-concurrent-accept, inst-um-await-mount-settle
    const d = `d-cc-unmount-${intent}`;
    const f = await make(d, ['A']);
    f.handler.holdMount('A');

    const doneM = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    expect(f.rr.calls).toEqual([[d, ['A'], 'push']]);
    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: intent });
    expect(f.rr.calls).toEqual(intent === 'push' ? [[d, ['A'], 'push'], [d, [], 'push']] : [[d, ['A'], 'push']]);

    f.handler.releaseMount('A');
    expect(await doneM).toBe('next');
    expect(await doneU).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'],
      ...(intent === 'push' ? [[d, [], 'push'] as Command] : []),
      [d, [], 'replace'], [d, [], 'replace'],
    ]);
    expect(mountedIn(f.registry, d)).toEqual([]);
  });

  it('an already-mounted mount of A sets and clears its own record; an unmount of A accepted after it is not cleared by that settle, so commands omit A until the unmount settles', async () => {
    // inst-me-cmd-record-set, inst-me-cmd-record-clear, inst-me-already-mounted-complete
    const d = 'd-cc-short-circuit';
    const f = await make(d, ['A']);
    await mountSettled(f, 'A');
    f.handler.holdUnmount('A');

    const doneM = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, [], 'push']]);

    expect(await doneM).toBe('next');
    await f.rr.whenCalls(3);
    expect(f.rr.calls[2]).toEqual([d, [], 'replace']);
    expect(mountedIn(f.registry, d)).toEqual(['A']);

    f.handler.releaseUnmount('A');
    expect(await doneU).toBe('next');
    await expectCommands(f, [[d, ['A'], 'push'], [d, [], 'push'], [d, [], 'replace'], [d, [], 'replace']]);
    expect(mountedIn(f.registry, d)).toEqual([]);
  });

  it('a mount of A accepted while an unmount of A has not settled: commands name A, including the unmount\'s own settle command', async () => {
    // inst-me-cmd-record-set, inst-me-cmd-record-clear (a later record stays in place)
    const d = 'd-cc-mount-after-unmount';
    const f = await make(d, ['A']);
    await mountSettled(f, 'A');
    f.handler.holdUnmount('A');

    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    const doneM = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, [], 'push'], [d, ['A'], 'push']]);

    f.handler.releaseUnmount('A');
    expect(await doneU).toBe('next');
    expect(await doneM).toBe('next');
    await expectCommands(f, [
      [d, [], 'push'], [d, ['A'], 'push'], [d, ['A'], 'replace'], [d, ['A'], 'replace'],
    ]);
  });

  it('an explicit unmount of mounted A with push: acceptance and settle commands both name []', async () => {
    // inst-me-cmd-concurrent-accept, inst-me-cmd-projection-concurrent, inst-me-cmd-settle
    const d = 'd-cc-unmount-mounted';
    const f = await make(d, ['A']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, [], 'push']]);
    expect(await done).toBe('next');
    await expectCommands(f, [[d, [], 'push'], [d, [], 'replace']]);
    expect(mountedIn(f.registry, d)).toEqual([]);
  });

  it('start/join: a joined mount issues its own acceptance and its own settle command', async () => {
    // inst-me-join-in-progress-mount, inst-me-cmd-concurrent-accept, inst-me-cmd-settle
    const d = 'd-cc-join';
    const f = await make(d, ['A']);
    f.handler.holdMount('A');

    const done1 = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const done2 = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'replace' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, ['A'], 'replace']]);

    f.handler.releaseMount('A');
    expect(await Promise.all([done1, done2])).toEqual(['next', 'next']);
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, ['A'], 'replace'], [d, ['A'], 'replace'], [d, ['A'], 'replace'],
    ]);
  });

  it('a mount refused at once (extension not admitted): no acceptance command, one settle command naming the mount set', async () => {
    // inst-me-cmd-accept-refused, inst-me-cmd-settle
    const d = 'd-cc-refused';
    const f = await make(d, ['A']);
    await mountSettled(f, 'A');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'ghost', history: 'push' });
    expect(f.rr.calls).toEqual([]);
    expect(await done).toBe('fallback');
    await expectCommands(f, [[d, ['A'], 'replace']]);
  });

  it('a failed fresh mount of B: the acceptance command names the mount set with B, the settle command names the mount set without it', async () => {
    // inst-me-cmd-projection-concurrent, inst-me-cmd-record-clear, inst-me-cmd-settle
    const d = 'd-cc-fresh-fail';
    const f = await make(d, ['A', 'B']);
    await mountSettled(f, 'A');
    f.handler.failMount('B');

    const done = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A', 'B'], 'push']]);
    expect(await done).toBe('fallback');
    await expectCommands(f, [[d, ['A', 'B'], 'push'], [d, ['A'], 'replace']]);
  });

  it('an unmount whose awaited mount failed completes without change and issues its settle command: one settle command per request', async () => {
    // inst-um-after-mount-failure, inst-me-cmd-settle-unexecuted, inst-me-cmd-record-clear
    const d = 'd-cc-unmount-after-failed-mount';
    const f = await make(d, ['A']);
    f.handler.holdMount('A');
    f.handler.failMount('A');

    const doneM = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.mountStarted('A');
    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, ['A'], 'push'], [d, [], 'push']]);

    f.handler.releaseMount('A');
    expect(await doneM).toBe('fallback');
    expect(await doneU).toBe('next');
    await expectCommands(f, [
      [d, ['A'], 'push'], [d, [], 'push'], [d, [], 'replace'], [d, [], 'replace'],
    ]);
    expect(mountedIn(f.registry, d)).toEqual([]);
  });

  it('a mount of A that waited on an unmount of A which failed takes its fallback: acceptance commands per request, one settle command per request', async () => {
    // inst-me-await-unmount-settle, inst-me-fail-after-unmount-failure, inst-me-cmd-settle-unexecuted
    const d = 'd-cc-mount-after-failed-unmount';
    const f = await make(d, ['A']);
    await mountSettled(f, 'A');
    f.handler.holdUnmount('A');
    f.handler.failUnmount('A');

    const doneU = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'push' });
    await f.handler.unmountStarted('A');
    const doneM = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' });
    expect(f.rr.calls).toEqual([[d, [], 'push'], [d, ['A'], 'push']]);

    f.handler.releaseUnmount('A');
    expect(await doneU).toBe('fallback');
    expect(await doneM).toBe('fallback');
    // The two settlements are ordered by the FEATURE only as far as the mount
    // waiting on the unmount; each settle command names the mount set and the
    // record then held, so either projection is one the FEATURE allows.
    const either = replaceNamingOneOf(d, [[], ['A']]);
    await expectCommands(f, [[d, [], 'push'], [d, ['A'], 'push'], either, either]);
    expect(mountedIn(f.registry, d)).toEqual([]);
  });

  it('an extension that leaves the mount set by a slot detach after its request settled is not named by the next command: its record was cleared at its own settle', async () => {
    // inst-me-cmd-record-clear, inst-me-cmd-projection-concurrent, inst-me-no-command-outside-action
    const d = 'd-cc-record-cleared';
    const f = await make(d, ['A']);
    await mountSettled(f, 'A');

    await f.registry.getMounter(d).detach();
    expect(mountedIn(f.registry, d)).toEqual([]);
    expect(f.rr.calls).toEqual([]);

    await expectCommands(f, []);
  });
});
