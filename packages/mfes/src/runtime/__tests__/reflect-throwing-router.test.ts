/**
 * A router whose `reflect` throws is a broken router: the throw is not hidden,
 * but it never leaves inconsistent state. A request's outcome and its entry's
 * execution always agree.
 *
 * Pins `cpt-frontx-algo-extension-domain-governance-mount-execution`:
 * `inst-me-cmd-accept` (acceptance command; a throw fails the request before its
 * entry can run), `inst-me-cmd-settle` (settle command; a throw does not change
 * the request's own outcome and surfaces as an unhandled rejection), and
 * `inst-me-cmd-chain-independent` (the outcome is decided by the request's own
 * execution).
 *
 * Unhandled rejections are captured per test: the runner's own listeners are
 * detached for the test and restored afterwards, so the expected errors never
 * reach the run as errors.
 */
import { mountedIn } from './helpers/mounted-in';
import { afterEach, describe, it, expect, onTestFinished } from 'vitest';
import {
  ACTION_MOUNT_EXT, addProbeDomain, createDeferred, createReflectRouter, dispatch, setup,
  type Command, type Fixture, type Strategy,
} from './helpers/reflect-harness';

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.handler.releaseAll();
    await f.registry.dispose();
  }
});

interface Captured {
  errors: unknown[];
  /** Resolves when the first unhandled rejection has been captured. */
  firstRejection: Promise<void>;
}

function captureUnhandledRejections(): Captured {
  const previous = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  const errors: unknown[] = [];
  let signalFirst!: () => void;
  const firstRejection = new Promise<void>((resolve) => { signalFirst = resolve; });
  const listener = (reason: unknown): void => {
    errors.push(reason);
    signalFirst();
  };
  process.on('unhandledRejection', listener);
  onTestFinished(() => {
    process.removeListener('unhandledRejection', listener);
    for (const l of previous) process.on('unhandledRejection', l);
  });
  return { errors, firstRejection };
}

const throwing = (verb: Command[2]) => (command: Command): void => {
  if (command[2] === verb) throw new Error(`reflect refused ${verb}`);
};

async function make(strategy: Strategy, domainId: string, ids: string[], onReflect: (c: Command) => void): Promise<Fixture> {
  const rr = createReflectRouter(onReflect);
  const f = await setup(strategy, domainId, ids, { rr });
  fixtures.push(f);
  return f;
}

describe('a throwing acceptance command', () => {
  for (const strategy of ['optional', 'exclusive', 'concurrent'] as const) {
    it(`${strategy}: the request fails and takes fallback, and its entry never runs`, async () => {
      // inst-me-cmd-accept, inst-me-cmd-chain-independent
      const d = `d-throw-accept-${strategy}`;
      const probes = `${d}-probes`;
      const f = await make(strategy, d, ['A', 'B'], throwing('push'));
      addProbeDomain(f.registry, probes);

      const outcome = await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' }, { probeDomainId: probes });
      expect(outcome).toBe('fallback');

      const trailing = await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'B', history: 'none' }, { probeDomainId: probes });
      expect(trailing).toBe('next');

      expect(f.handler.mountEntries('A')).toBe(0);
      expect(mountedIn(f.registry, d)).not.toContain('A');
    });
  }
});

describe('a throwing settle command', () => {
  for (const strategy of ['optional', 'exclusive', 'concurrent'] as const) {
    it(`${strategy}: the request's outcome is unchanged and the throw surfaces as one unhandled rejection`, async () => {
      // inst-me-cmd-settle, inst-me-cmd-chain-independent
      const captured = captureUnhandledRejections();
      const d = `d-throw-settle-${strategy}`;
      const probes = `${d}-probes`;
      const settleReached = createDeferred();
      const onReflect = throwing('replace');
      const f = await make(strategy, d, ['A'], (command) => {
        if (command[2] === 'replace') settleReached.resolve();
        onReflect(command);
      });
      addProbeDomain(f.registry, probes);

      const outcome = await dispatch(f.registry, d, ACTION_MOUNT_EXT, { subject: 'A', history: 'push' }, { probeDomainId: probes });
      expect(outcome).toBe('next');
      await settleReached.promise;
      await captured.firstRejection;

      expect(f.handler.mountEntries('A')).toBe(1);
      expect(captured.errors).toHaveLength(1);
      expect((captured.errors[0] as Error).message).toBe('reflect refused replace');
    });
  }
});
