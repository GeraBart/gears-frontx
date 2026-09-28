import { describe, it, expect, vi, afterEach } from 'vitest';
import { DispatchCorrelationIdGenerator } from '../DispatchCorrelationIdGenerator';

describe('DispatchCorrelationIdGenerator', () => {
  it('mints structurally well-formed, monotonically distinct ids within one instance', () => {
    const generator = new DispatchCorrelationIdGenerator();

    const first = generator.next();
    const second = generator.next();

    expect(first).toMatch(/^dispatch-.+-1$/);
    expect(second).toMatch(/^dispatch-.+-2$/);
    expect(first).not.toEqual(second);
  });

  it(
    'two instances constructed in the SAME module copy (e.g. one per registry, for a shell ' +
      'and a nested host registry both running in-process) produce distinct correlation ids ' +
      'for their own first dispatch',
    () => {
      const registryOneGenerator = new DispatchCorrelationIdGenerator();
      const registryTwoGenerator = new DispatchCorrelationIdGenerator();

      const firstFromRegistryOne = registryOneGenerator.next();
      const firstFromRegistryTwo = registryTwoGenerator.next();

      expect(firstFromRegistryOne).not.toEqual(firstFromRegistryTwo);
    }
  );

  describe('with crypto.getRandomValues but without crypto.randomUUID', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('two instances mint distinct 16-byte hex namespaces from crypto.getRandomValues', () => {
      const realCrypto = globalThis.crypto;
      const getRandomValues = vi.fn((array: Uint8Array) => realCrypto.getRandomValues(array));
      vi.stubGlobal('crypto', { getRandomValues });
      const mathRandom = vi.spyOn(Math, 'random');

      const registryOneGenerator = new DispatchCorrelationIdGenerator();
      const registryTwoGenerator = new DispatchCorrelationIdGenerator();

      const firstFromRegistryOne = registryOneGenerator.next();
      const firstFromRegistryTwo = registryTwoGenerator.next();

      expect(firstFromRegistryOne).toMatch(/^dispatch-[0-9a-f]{32}-1$/);
      expect(firstFromRegistryTwo).toMatch(/^dispatch-[0-9a-f]{32}-1$/);
      expect(firstFromRegistryOne).not.toEqual(firstFromRegistryTwo);
      expect(getRandomValues).toHaveBeenCalledTimes(2);
      expect(mathRandom).not.toHaveBeenCalled();
    });
  });

  describe('without crypto.randomUUID or crypto.getRandomValues', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it(
      'two instances constructed in the SAME module copy mint distinct namespaces even when ' +
        'the timestamp and random parts coincide',
      () => {
        vi.stubGlobal('crypto', {});
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const registryOneGenerator = new DispatchCorrelationIdGenerator();
        const registryTwoGenerator = new DispatchCorrelationIdGenerator();

        const firstFromRegistryOne = registryOneGenerator.next();
        const firstFromRegistryTwo = registryTwoGenerator.next();

        expect(firstFromRegistryOne).toMatch(/^dispatch-.+-1$/);
        expect(firstFromRegistryTwo).toMatch(/^dispatch-.+-1$/);
        expect(firstFromRegistryOne).not.toEqual(firstFromRegistryTwo);
      }
    );
  });
});
