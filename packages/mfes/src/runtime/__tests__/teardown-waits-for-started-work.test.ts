/**
 * Teardown never interrupts work that has started: domain unregistration and
 * registry disposal wait for the running occupancy-queue entry and for every
 * Concurrent `mount_ext` / `unmount_ext` execution in flight; each settles with
 * its own outcome, and extensions are released only afterwards.
 *
 * Pins `cpt-frontx-algo-extension-domain-governance-mount-execution`:
 * `inst-me-concurrent-domain-unregister`, `inst-me-registry-dispose-wait`,
 * `inst-me-queue-running-never-interrupted`, `inst-me-queue-domain-unregister`;
 * and the acceptance criteria "Concurrent unregister" and "Registry dispose" of
 * `cpt-frontx-dod-extension-domain-governance-url-commands`.
 *
 * A request arriving once the teardown has begun is refused at once
 * (`inst-me-cmd-accept-refused`): it takes its own `fallback`, issues no
 * acceptance command and exactly one settle command, and its lifecycle mount is
 * never entered.
 *
 * "Teardown has not started while the work runs" is proved by ordering, never by
 * a check made a moment after the work started: every step lands in one event
 * list, and the order is asserted once everything has settled.
 *
 * Unregistration cases observe the chain through probe actions in a probe
 * domain that stays registered. Dispose tears every domain of the registry down,
 * so its cases assert the started work's own outcome (the lifecycle mount
 * completes), not a continuation targeting the disposed registry; the pending
 * entry's fallback is observed while the teardown is still held back.
 */
import { afterEach, describe, it, expect } from 'vitest';
import {
  ACTION_MOUNT_EXT, ACTION_UNMOUNT_EXT, BARRIER_SUBJECT, addProbeDomain, dispatch, domainFactory, makeDomain,
  makeExtension, mountSettled, setup,
  type Fixture, type Strategy,
} from './helpers/reflect-harness';

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    // A failing test can leave a gate closed; dispose waits for started work.
    f.handler.releaseAll();
    await f.registry.dispose();
  }
});

/** Records the router's release notifications into the handler's event list. */
function recordReleases(f: Fixture): void {
  const router = f.rr.router as unknown as Record<string, (id: string) => void>;
  const releaseExtension = router.releaseExtension!;
  const releaseDomain = router.releaseDomain!;
  router.releaseExtension = (id) => { f.handler.events.push(`releaseExtension:${id}`); releaseExtension(id); };
  router.releaseDomain = (id) => { f.handler.events.push(`releaseDomain:${id}`); releaseDomain(id); };
}

function expectOrder(events: string[], ...labels: string[]): void {
  const indexes = labels.map((label) => events.indexOf(label));
  expect(indexes.every((i) => i >= 0), `every event happened: ${JSON.stringify(events)}`).toBe(true);
  expect(indexes, JSON.stringify(events)).toEqual([...indexes].sort((a, b) => a - b));
}

/** Adds a further domain of the strategy holding the given extensions to the fixture's registry. */
async function addDomain(f: Fixture, strategy: Strategy, domainId: string, ids: string[]): Promise<void> {
  f.registry.registerDomain(
    makeDomain(domainId, strategy !== 'exclusive'),
    domainFactory(strategy, f.registry, domainId, strategy !== 'exclusive')
  );
  for (const id of ids) await f.registry.registerExtension(makeExtension(id, domainId));
  f.registry.getMounter(domainId).attach(document.createElement('div'));
}

/**
 * Asserts the refusal of a request that arrived in `domainId` during a teardown,
 * from the commands the router received since the last `reset()`: the request
 * issued no acceptance command and exactly one settle `replace`. A trailing
 * refused request on the same domain issues one settle command after every
 * earlier request's own settlement, so a late extra command from the first
 * request shows up as a third command.
 */
async function expectRefusedWithOneSettle(f: Fixture, domainId: string, outcome: 'next' | 'fallback'): Promise<void> {
  expect(outcome).toBe('fallback');
  const barrier = await dispatch(f.registry, domainId, ACTION_MOUNT_EXT, { subject: BARRIER_SUBJECT, history: 'none' });
  expect(barrier).toBe('fallback');
  await f.rr.whenCalls(2);
  expect(f.rr.calls.map((c) => [c[0], c[2]])).toEqual([[domainId, 'replace'], [domainId, 'replace']]);
}

async function make(strategy: 'concurrent' | 'optional' | 'exclusive', domainId: string, ids: string[]): Promise<Fixture> {
  const f = await setup(strategy, domainId, ids);
  fixtures.push(f);
  return f;
}

describe('concurrent domain unregistration', () => {
  it('waits for a mount in flight: A is not released and the unregistration does not resolve until the mount settles; the chain takes next', async () => {
    // inst-me-concurrent-domain-unregister
    const d = 'd-unreg-mount';
    const probes = `${d}-probes`;
    const f = await make('concurrent', d, ['A']);
    addProbeDomain(f.registry, probes);
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
    await f.handler.mountStarted('A');
    recordReleases(f);
    f.handler.holdUnmount('A');

    const unregistered = f.registry.unregisterDomain(d).then(() => { f.handler.events.push('unregistered'); });
    // The drain's lifecycle unmount is entered only once the mount has settled:
    // the entry is recorded after the release, never before.
    const drainEntered = f.handler.unmountStarted('A').then(() => { f.handler.releaseUnmount('A'); });

    f.handler.events.push('mount-released:A');
    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    await drainEntered;
    await unregistered;
    expectOrder(
      f.handler.events,
      'mount-released:A', 'mount-completed:A', 'unmount-entered:A', 'releaseExtension:A', `releaseDomain:${d}`, 'unregistered'
    );
  });

  it('refuses a mount arriving during the unregistration: fallback, no acceptance command, one settle command, never mounted', async () => {
    // inst-me-concurrent-domain-unregister, inst-me-cmd-accept-refused
    const d = 'd-unreg-arrival';
    const probes = `${d}-probes`;
    const f = await make('concurrent', d, ['A', 'B']);
    addProbeDomain(f.registry, probes);
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
    await f.handler.mountStarted('A');
    f.rr.reset();

    const unregistered = f.registry.unregisterDomain(d);
    const doneB = await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { probeDomainId: probes });
    await expectRefusedWithOneSettle(f, d, doneB);

    f.handler.releaseMount('A');
    expect(await doneA).toBe('next');
    await unregistered;
    expect(f.handler.mountEntries('B')).toBe(0);
    expect(f.handler.mountEntries('A')).toBe(1);
  });

  it('waits for an unmount in flight: the unmount completes with its own outcome before the teardown completes', async () => {
    // inst-me-concurrent-domain-unregister
    const d = 'd-unreg-unmount';
    const probes = `${d}-probes`;
    const f = await make('concurrent', d, ['A']);
    addProbeDomain(f.registry, probes);
    await mountSettled(f, 'A');
    f.handler.holdUnmount('A');
    const order: string[] = [];
    const doneUnmount = dispatch(f.registry, d, ACTION_UNMOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes })
      .then((outcome) => { order.push(`unmount:${outcome}`); return outcome; });
    await f.handler.unmountStarted('A');
    recordReleases(f);

    const unregistered = f.registry.unregisterDomain(d).then(() => { order.push('unregistered'); f.handler.events.push('unregistered'); });

    f.handler.events.push('unmount-released:A');
    f.handler.releaseUnmount('A');
    expect(await doneUnmount).toBe('next');
    await unregistered;
    expect(order).toEqual(['unmount:next', 'unregistered']);
    expectOrder(f.handler.events, 'unmount-entered:A', 'unmount-released:A', 'releaseExtension:A', 'unregistered');
  });
});

describe('registry dispose', () => {
  for (const strategy of ['optional', 'exclusive'] as const) {
    it(`${strategy}: a running queue entry finishes with its own outcome, a pending entry takes its fallback, and the returned promise resolves after teardown`, async () => {
      // inst-me-registry-dispose-wait, inst-me-queue-running-never-interrupted, inst-me-queue-domain-unregister
      const d = `d-dispose-queue-${strategy}`;
      const probes = `${d}-probes`;
      const f = await make(strategy, d, ['A', 'B']);
      addProbeDomain(f.registry, probes);
      f.handler.holdMount('A');
      const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
      await f.handler.mountStarted('A');
      const doneB = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'none' }, { probeDomainId: probes });

      recordReleases(f);

      const p = f.registry.dispose();
      expect(p instanceof Promise).toBe(true);
      expect(await doneB).toBe('fallback');

      f.handler.events.push('mount-released:A');
      f.handler.releaseMount('A');
      await f.handler.mountCompleted('A');
      await p;
      void doneA;
      expectOrder(f.handler.events, 'mount-released:A', 'mount-completed:A', 'releaseExtension:A');
      expect(f.rr.released).toContain(`releaseDomain:${d}`);
    });
  }

  it('concurrent: a mount in flight completes with its own outcome and the returned promise resolves after teardown', async () => {
    // inst-me-registry-dispose-wait, inst-me-concurrent-domain-unregister
    const d = 'd-dispose-concurrent';
    const probes = `${d}-probes`;
    const f = await make('concurrent', d, ['A']);
    addProbeDomain(f.registry, probes);
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
    await f.handler.mountStarted('A');

    recordReleases(f);

    const p = f.registry.dispose();
    expect(p instanceof Promise).toBe(true);

    f.handler.events.push('mount-released:A');
    f.handler.releaseMount('A');
    await f.handler.mountCompleted('A');
    await p;
    void doneA;
    expectOrder(f.handler.events, 'mount-released:A', 'mount-completed:A', 'releaseExtension:A');
    expect(f.rr.released).toContain(`releaseDomain:${d}`);
  });

  it('with nothing in flight the returned promise resolves and the extensions are released', async () => {
    // inst-me-registry-dispose-wait
    const d = 'd-dispose-idle';
    const f = await make('concurrent', d, ['A']);
    await mountSettled(f, 'A');

    await f.registry.dispose();
    expect(f.rr.released).toContain('releaseExtension:A');
    expect(f.rr.released).toContain(`releaseDomain:${d}`);
  });
});

describe('arrival during registry disposal', () => {
  for (const strategy of ['concurrent', 'optional', 'exclusive'] as const) {
    it(`${strategy}: a request arriving while the started work runs is refused, never mounted; dispose resolves after the work settled and teardown ran`, async () => {
      // inst-me-registry-dispose-wait, inst-me-cmd-accept-refused
      const d = `d-dispose-arrival-${strategy}`;
      const probes = `${d}-probes`;
      const f = await make(strategy, d, ['A', 'B']);
      addProbeDomain(f.registry, probes);
      f.handler.holdMount('A');
      const doneA = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
      await f.handler.mountStarted('A');
      recordReleases(f);
      f.rr.reset();

      const p = f.registry.dispose();
      const doneB = await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { probeDomainId: probes });
      await expectRefusedWithOneSettle(f, d, doneB);

      f.handler.events.push('mount-released:A');
      f.handler.releaseMount('A');
      await p;
      void doneA;
      expect(f.handler.mountEntries('B')).toBe(0);
      expectOrder(f.handler.events, 'mount-released:A', 'mount-completed:A', 'releaseExtension:A');
    });
  }

  for (const strategy of ['concurrent', 'optional', 'exclusive'] as const) {
    it(`an idle ${strategy} domain refuses a request arriving while another domain's mount is held; dispose waits for that mount`, async () => {
      // inst-me-registry-dispose-wait, inst-me-cmd-accept-refused
      const d1 = `d-dispose-arrival-d1-${strategy}`;
      const d2 = `d-dispose-arrival-d2-${strategy}`;
      const probes = `${d1}-probes`;
      const f = await make(strategy, d1, ['B']);
      await addDomain(f, 'concurrent', d2, ['A']);
      addProbeDomain(f.registry, probes);
      f.handler.holdMount('A');
      const doneA = dispatch(f.registry, d2, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
      await f.handler.mountStarted('A');
      recordReleases(f);
      f.rr.reset();

      const p = f.registry.dispose();
      const doneB = await dispatch(f.registry, d1, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { probeDomainId: probes });
      await expectRefusedWithOneSettle(f, d1, doneB);

      f.handler.events.push('mount-released:A');
      f.handler.releaseMount('A');
      await p;
      void doneA;
      expect(f.handler.mountEntries('B')).toBe(0);
      expectOrder(f.handler.events, 'mount-released:A', 'mount-completed:A', 'releaseExtension:A');
    });
  }
});

describe('failed unregistration while disposal began', () => {
  it('a domain whose unregistration failed stays closed to new requests because disposal began', async () => {
    // inst-me-registry-dispose-wait, inst-me-queue-domain-unregister, inst-me-cmd-accept-refused
    const dA = 'd-failed-unreg-optional';
    const dB = 'd-failed-unreg-concurrent';
    const probes = `${dA}-probes`;
    const f = await make('optional', dA, ['A']);
    await addDomain(f, 'concurrent', dB, ['C']);
    addProbeDomain(f.registry, probes);
    await mountSettled(f, 'A');
    f.handler.holdMount('C');
    const doneC = dispatch(f.registry, dB, ACTION_MOUNT_EXT, { subject: 'C', history: 'none' }, { probeDomainId: probes });
    await f.handler.mountStarted('C');

    // The drain fails: the lifecycle unmount of A, held until disposal began, throws.
    f.handler.holdUnmount('A');
    f.handler.failUnmount('A');
    const unregistration = f.registry.unregisterDomain(dA).then(() => 'resolved', () => 'rejected');
    await f.handler.unmountStarted('A');
    const p = f.registry.dispose();
    f.handler.releaseUnmount('A');
    expect(await unregistration).toBe('rejected');

    const doneA2 = await dispatch(f.registry, dA, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' }, { probeDomainId: probes });
    expect(doneA2).toBe('fallback');
    expect(f.handler.mountEntries('A')).toBe(1);

    f.handler.releaseMount('C');
    await p;
    void doneC;
  });
});

describe('overlapping unregistrations', () => {
  for (const strategy of ['optional', 'concurrent'] as const) {
    it(`${strategy}: with two unregistrations pending and the first failing, a request arriving before the second completes is refused and takes fallback`, async () => {
      // Overlapping unregistrations AC; inst-me-queue-domain-unregister, inst-me-concurrent-domain-unregister, inst-me-cmd-accept-refused
      const d = `d-overlap-${strategy}`;
      const probes = `${d}-probes`;
      const f = await make(strategy, d, ['A', 'B']);
      addProbeDomain(f.registry, probes);
      await mountSettled(f, 'A');

      f.handler.holdUnmount('A');
      f.handler.failUnmount('A');
      const p1 = f.registry.unregisterDomain(d);
      const p2 = f.registry.unregisterDomain(d);
      const p2Outcome = p2.then(() => 'resolved', () => 'rejected');
      await f.handler.unmountStarted('A');

      // The first unregistration fails; the arrival is dispatched in its rejection
      // handler, before the second unregistration has begun its own drain.
      let arrival!: Promise<'next' | 'fallback'>;
      const p1Rejected = p1.then(() => 'resolved', () => {
        f.handler.holdUnmount('A');
        arrival = dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'push' }, { probeDomainId: probes });
        return 'rejected';
      });
      f.handler.releaseUnmount('A');
      expect(await p1Rejected).toBe('rejected');

      expect(await arrival).toBe('fallback');
      expect(f.handler.mountEntries('B')).toBe(0);

      f.handler.releaseAll();
      await p2Outcome;
    });
  }
});

describe('registering a domain once disposal began', () => {
  it('is refused and no mount in the refused domain can run; dispose resolves after the held mount is released', async () => {
    // Registry dispose AC; inst-me-registry-dispose-wait
    const d1 = 'd-dispose-register-d1';
    const d2 = 'd-dispose-register-d2';
    const probes = `${d1}-probes`;
    const f = await make('concurrent', d1, ['A']);
    addProbeDomain(f.registry, probes);
    f.handler.holdMount('A');
    const doneA = dispatch(f.registry, d1, ACTION_MOUNT_EXT, { subject: 'A', history: 'none' }, { probeDomainId: probes });
    await f.handler.mountStarted('A');

    const p = f.registry.dispose();
    expect(() => {
      f.registry.registerDomain(makeDomain(d2, true), domainFactory('concurrent', f.registry, d2));
    }).toThrow();
    await expect(f.registry.registerExtension(makeExtension('X', d2))).rejects.toThrow();
    expect(f.handler.mountEntries('X')).toBe(0);

    f.handler.releaseMount('A');
    await p;
    void doneA;
    expect(f.handler.mountEntries('X')).toBe(0);
  });
});
