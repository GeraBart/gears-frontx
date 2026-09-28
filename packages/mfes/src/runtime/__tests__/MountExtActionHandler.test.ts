/**
 * Unit tests for `MountExtActionHandler` — the strategy-agnostic mount-ext
 * prologue (`cpt-frontx-algo-extension-domain-governance-mount-execution`
 * prologue instructions).
 *
 * These tests exercise the decorator directly against a fake `inner` handler
 * and fake collaborators, isolated from the real strategy/MountManager
 * pipeline (covered separately by
 * `mount-ext-prologue-integration.test.ts`), so each prologue rule can be
 * pinned deterministically with explicit settlement signals — no sleeps, no
 * polling, no `vi.waitFor`, no bare microtask flush.
 */
import { describe, it, expect } from 'vitest';
import { MountExtActionHandler } from '../MountExtActionHandler';
import type {
  ExtensionAdmissionReader,
  MountedExtensionReader,
  UnmountInFlightReader,
} from '../MountExtActionHandler';
import { DomainOccupancyCoordinator } from '../DomainOccupancyCoordinator';
import { ActionHandler } from '../../mediator/ActionHandler';

const DOMAIN_ID = 'domain-under-test';

/** A controlled deferred — the only kind of "wait" these tests use. */
function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Builds the three reader ports from plain functions, for test brevity. */
function makeReaders(overrides: {
  domainOf: (extensionId: string) => string | undefined;
  isMounted: (extensionId: string) => boolean;
  inFlight: (extensionId: string) => Promise<void> | undefined;
}): [ExtensionAdmissionReader, MountedExtensionReader, UnmountInFlightReader] {
  return [
    { domainOf: overrides.domainOf },
    { isMounted: overrides.isMounted },
    { inFlight: overrides.inFlight },
  ];
}

describe('MountExtActionHandler', () => {
  it('inst-me-eligibility-check: fails a mount request for an extension not admitted to the addressed domain', async () => {
    let innerCalls = 0;
    const inner = ActionHandler.fromFunction(async () => { innerCalls += 1; });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => 'some-other-domain',
      isMounted: () => false,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    await expect(
      wrapped.handleAction('mount_ext', { subject: 'ext-a' })
    ).rejects.toThrow(/not admitted/);
    expect(innerCalls).toBe(0);
  });

  it('inst-me-eligibility-check: fails a mount request for an extension registered nowhere', async () => {
    let innerCalls = 0;
    const inner = ActionHandler.fromFunction(async () => { innerCalls += 1; });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => undefined,
      isMounted: () => false,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    await expect(
      wrapped.handleAction('mount_ext', { subject: 'ghost' })
    ).rejects.toThrow(/not admitted/);
    expect(innerCalls).toBe(0);
  });

  it('inst-me-already-mounted-complete: completes successfully immediately, without invoking the strategy (inner handler) at all', async () => {
    let innerCalls = 0;
    const inner = ActionHandler.fromFunction(async () => { innerCalls += 1; });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => true,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    await expect(wrapped.handleAction('mount_ext', { subject: 'ext-a' })).resolves.toBeUndefined();
    expect(innerCalls).toBe(0);
  });

  it('inst-me-join-in-progress-mount: a second concurrent request for the same extension joins the first physical mount instead of starting a second one', async () => {
    let innerCalls = 0;
    const gate = createDeferred<void>();
    const inner = ActionHandler.fromFunction(async () => {
      innerCalls += 1;
      await gate.promise;
    });
    let mounted = false;
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => mounted,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    const first = wrapped.handleAction('mount_ext', { subject: 'ext-a' });
    const second = wrapped.handleAction('mount_ext', { subject: 'ext-a' });

    // Both requests are pending on the SAME physical mount — only one call
    // to `inner` was made for both.
    expect(innerCalls).toBe(1);

    gate.resolve();
    mounted = true;
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(innerCalls).toBe(1);
  });

  it('inst-me-join-in-progress-mount: when the joined physical mount fails, the joining request fails with the same cause', async () => {
    let innerCalls = 0;
    const gate = createDeferred<void>();
    const cause = new Error('physical mount failed');
    const inner = ActionHandler.fromFunction(async () => {
      innerCalls += 1;
      await gate.promise;
      throw cause;
    });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => false,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    const first = wrapped.handleAction('mount_ext', { subject: 'ext-a' });
    const second = wrapped.handleAction('mount_ext', { subject: 'ext-a' });
    expect(innerCalls).toBe(1);

    gate.resolve();

    let firstError: unknown;
    let secondError: unknown;
    await first.catch((e) => { firstError = e; });
    await second.catch((e) => { secondError = e; });

    expect(firstError).toBe(cause);
    expect(secondError).toBe(cause);
  });

  it('inst-me-await-unmount-settle / inst-me-fresh-mount-after-unmount: waits for an in-progress unmount to settle, then proceeds with a fresh mount', async () => {
    let innerCalls = 0;
    const unmountGate = createDeferred<void>();
    const inner = ActionHandler.fromFunction(async () => { innerCalls += 1; });
    let unmountInFlight: Promise<void> | undefined = unmountGate.promise;
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => false,
      inFlight: () => unmountInFlight,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    const mountCall = wrapped.handleAction('mount_ext', { subject: 'ext-a' });

    // Strategy body must not run while the unmount is still in flight: the
    // decorator's synchronous portion runs up to (and yields at) `await
    // inFlightUnmount` before this line is reached, so `innerCalls` is
    // checked without waiting on anything.
    expect(innerCalls).toBe(0);

    unmountInFlight = undefined;
    unmountGate.resolve();

    await expect(mountCall).resolves.toBeUndefined();
    expect(innerCalls).toBe(1);
  });

  it('inst-me-fail-after-unmount-failure: fails the mount request when the awaited unmount itself failed', async () => {
    let innerCalls = 0;
    const unmountGate = createDeferred<void>();
    const inner = ActionHandler.fromFunction(async () => { innerCalls += 1; });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => false,
      inFlight: () => unmountGate.promise,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    const mountCall = wrapped.handleAction('mount_ext', { subject: 'ext-a' });
    unmountGate.reject(new Error('unmount failed'));

    await expect(mountCall).rejects.toThrow(/could not be mounted/);
    // The strategy body never ran — a failed unmount fails the mount
    // request outright rather than attempting a fresh mount.
    expect(innerCalls).toBe(0);
  });

  it('falls through to the inner handler untouched when the payload carries no string subject', async () => {
    let innerCalls = 0;
    const inner = ActionHandler.fromFunction(async () => { innerCalls += 1; });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => undefined,
      isMounted: () => false,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(true)
    );

    await wrapped.handleAction('mount_ext', {});
    expect(innerCalls).toBe(1);
  });

  it('two independently constructed mount_ext-derived handlers sharing one coordinator join the same in-flight mount for the same extension', async () => {
    let innerCalls = 0;
    const gate = createDeferred<void>();
    const inner = ActionHandler.fromFunction(async () => {
      innerCalls += 1;
      await gate.promise;
    });
    // ONE coordinator, shared the way `DefaultMfeRegistry.registerDomain`
    // shares it across every mount_ext-derived action type it constructs a
    // handler for, so two independently constructed derived handlers see
    // each other's in-flight mount rather than each tracking it separately.
    const coordinator = new DomainOccupancyCoordinator(false);
    let mounted = false;
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => mounted,
      inFlight: () => undefined,
    });
    // Two SEPARATE handler instances — as if two different mount_ext-derived
    // action types had each been decorated independently by the registry.
    const wrappedA = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      coordinator
    );
    const wrappedB = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      coordinator
    );

    const first = wrappedA.handleAction('mount_ext.derived-a', { subject: 'ext-a' });
    const second = wrappedB.handleAction('mount_ext.derived-b', { subject: 'ext-a' });

    // Both requests, through two different derived action types, are
    // pending on the SAME physical mount.
    expect(innerCalls).toBe(1);

    gate.resolve();
    mounted = true;
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(innerCalls).toBe(1);
  });

  it('inst-me-join-in-progress-mount: a synchronous re-entrant mount request for the SAME extension — dispatched from inside the physical mount\'s own synchronous prefix, before its first await — joins the same physical mount instead of starting a second one', async () => {
    let innerCalls = 0;
    let mounted = false;
    const gate = createDeferred<void>();
    const wrappedRef: { current?: ActionHandler } = {};
    const inner = ActionHandler.fromFunction(async (actionTypeId, payload) => {
      innerCalls += 1;
      if (innerCalls === 1) {
        // Synchronous re-entrant dispatch, before this call's own first
        // `await` below — models a container hook (`hooks.create`) or a
        // lifecycle mount callback that itself dispatches `mount_ext` again
        // for the SAME extension synchronously, from within the physical
        // mount it is part of.
        void wrappedRef.current!.handleAction(actionTypeId, payload);
      }
      await gate.promise;
    });
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => mounted,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      new DomainOccupancyCoordinator(false)
    );
    wrappedRef.current = wrapped;

    const first = wrapped.handleAction('mount_ext', { subject: 'ext-a' });

    // The re-entrant call, dispatched synchronously from inside `inner`'s
    // own synchronous prefix, must have joined the SAME physical mount —
    // not started a second one.
    expect(innerCalls).toBe(1);

    gate.resolve();
    mounted = true;
    await expect(first).resolves.toBeUndefined();
    expect(innerCalls).toBe(1);
  });

  it('a fresh mount for a DIFFERENT extension in a domain built with cross-extension ordering waits for the previous fresh mount to settle before it observes occupancy', async () => {
    // Models an Optional/Exclusive-shaped strategy body: read the current
    // sole occupant synchronously, evict it if it differs from the incoming
    // subject, then mount the incoming subject — each step separated by a
    // real async yield, so an unserialized handler would let two different
    // extensions' bodies interleave and both end up mounted.
    const occupancy: { current: string[] } = { current: [] };
    const events: string[] = [];
    const inner = ActionHandler.fromFunction(async (_actionTypeId, payload) => {
      const subject = (payload as { subject: string }).subject;
      const priorOccupant = occupancy.current[0];
      if (priorOccupant !== undefined && priorOccupant !== subject) {
        await Promise.resolve();
        occupancy.current = occupancy.current.filter((id) => id !== priorOccupant);
        events.push(`evict:${priorOccupant}`);
      }
      await Promise.resolve();
      occupancy.current = [...occupancy.current, subject];
      events.push(`mount:${subject}`);
    });
    // `serializeAcrossExtensions: true` — the ordering an Optional/Exclusive
    // domain's coordinator is built with.
    const coordinator = new DomainOccupancyCoordinator(true);
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: (extensionId) => occupancy.current.includes(extensionId),
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      coordinator
    );

    // Dispatched back to back, neither awaited before the other starts.
    const first = wrapped.handleAction('mount_ext', { subject: 'ext-a' });
    const second = wrapped.handleAction('mount_ext', { subject: 'ext-b' });

    await Promise.all([first, second]);

    // Exactly one occupant — the extension dispatched SECOND, since the
    // coordinator orders different-extension fresh mounts in arrival order.
    expect(occupancy.current).toEqual(['ext-b']);
    expect(events).toEqual(['mount:ext-a', 'evict:ext-a', 'mount:ext-b']);
  });

  it('a mount handler that throws synchronously (before its own first await) rejects the request rather than hanging, and a retry for the same extension succeeds', async () => {
    let callCount = 0;
    // NOT declared `async` — `ActionHandler.fromFunction`'s own
    // `handleAction` is a plain (non-async) passthrough, so a handler that
    // throws before returning anything throws SYNCHRONOUSLY out of
    // `handleAction`, exactly like a real domain `deactivated` hook or
    // lifecycle callback that throws before its own first `await`.
    const inner = ActionHandler.fromFunction((_actionTypeId, _payload): Promise<void> => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('synchronous mount failure');
      }
      return Promise.resolve();
    });
    // `serializeAcrossExtensions: false` — an idle, non-serialized
    // coordinator, the Concurrent-domain shape where `chainOntoTail` invokes
    // `task` directly rather than via a `.then()` callback that would
    // itself convert a synchronous throw into a rejection.
    const coordinator = new DomainOccupancyCoordinator(false);
    const [admissionReader, mountedReader, unmountInFlightReader] = makeReaders({
      domainOf: () => DOMAIN_ID,
      isMounted: () => false,
      inFlight: () => undefined,
    });
    const wrapped = new MountExtActionHandler(
      inner,
      DOMAIN_ID,
      admissionReader,
      mountedReader,
      unmountInFlightReader,
      coordinator
    );

    await expect(
      wrapped.handleAction('mount_ext', { subject: 'ext-a' })
    ).rejects.toThrow('synchronous mount failure');

    // The retry must actually settle (not hang forever on a placeholder
    // the first request's synchronous throw left pending) — and it
    // succeeds, proving the failed placeholder was rejected and its
    // identity-checked cleanup ran.
    await expect(
      wrapped.handleAction('mount_ext', { subject: 'ext-a' })
    ).resolves.toBeUndefined();
    expect(callCount).toBe(2);
  });
});
