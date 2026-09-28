/**
 * Unit tests for `DomainOccupancyCoordinator.runFreshMount`'s in-flight
 * map cleanup ordering — the placeholder entry for an extension id must be
 * removed BEFORE the placeholder settles for its caller, so a caller that
 * retries synchronously from inside its own fulfillment or rejection
 * handler starts fresh work rather than joining the already-settled entry.
 */
import { describe, it, expect } from 'vitest';
import { DomainOccupancyCoordinator } from '../domain-occupancy-coordinator';

describe('DomainOccupancyCoordinator.runFreshMount', () => {
  it('a retry from inside the rejection handler of the returned promise starts fresh work instead of joining the rejected entry', async () => {
    const coordinator = new DomainOccupancyCoordinator(true);
    let calls = 0;
    const task = (): Promise<void> => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
    };

    const result = coordinator
      .runFreshMount('ext-1', task)
      .catch(() => coordinator.runFreshMount('ext-1', task));

    await expect(result).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('a synchronous follow-up call from inside the fulfillment handler of the returned promise starts fresh work', async () => {
    const coordinator = new DomainOccupancyCoordinator(true);
    let calls = 0;
    const task = async (): Promise<void> => {
      calls += 1;
    };

    const result = coordinator
      .runFreshMount('ext-1', task)
      .then(() => coordinator.runFreshMount('ext-1', task));

    await result;
    expect(calls).toBe(2);
  });

  it('getInFlightMount no longer reports the settled entry once release()-style retry has run', async () => {
    const coordinator = new DomainOccupancyCoordinator(false);
    let calls = 0;
    const task = (): Promise<void> => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
    };

    await coordinator.runFreshMount('ext-1', task).catch(() => coordinator.runFreshMount('ext-1', task));

    expect(coordinator.getInFlightMount('ext-1')).toBeUndefined();
    expect(calls).toBe(2);
  });
});
