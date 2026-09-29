import { describe, it, expect, beforeEach } from 'vitest';
import { ActionTimeoutResolver } from '../ActionTimeoutResolver';
import { ChainEnvelopeValidator } from '../ChainEnvelopeValidator';
import { InvalidDomainDefaultTimeoutError } from '../InvalidDomainDefaultTimeoutError';

let resolver: ActionTimeoutResolver;
let validator: ChainEnvelopeValidator;

beforeEach(() => {
  validator = new ChainEnvelopeValidator();
  resolver = new ActionTimeoutResolver(validator);
});

describe('ActionTimeoutResolver.resolve', () => {
  it('returns a declared timeout as-is even when a domain is given', () => {
    const domain = { id: 'domain-1', defaultActionTimeout: 5000 };
    const declaredTimeout = 1000;

    const result = resolver.resolve(declaredTimeout, domain, 'target-1');

    expect(result).toBe(1000);
  });

  it('returns the domain defaultActionTimeout when no declared timeout is present', () => {
    const domain = { id: 'domain-1', defaultActionTimeout: 5000 };

    const result = resolver.resolve(undefined, domain, 'target-1');

    expect(result).toBe(5000);
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'throws InvalidDomainDefaultTimeoutError when domain defaultActionTimeout is invalid: %p',
    (invalidValue) => {
      const domain = { id: 'domain-1', defaultActionTimeout: invalidValue };

      expect(() => resolver.resolve(undefined, domain, 'target-1')).toThrow(
        InvalidDomainDefaultTimeoutError
      );

      try {
        resolver.resolve(undefined, domain, 'target-1');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidDomainDefaultTimeoutError);
        expect((error as InvalidDomainDefaultTimeoutError).message).toContain('domain-1');
      }
    }
  );

  it('throws an Error containing "Cannot resolve timeout" and the target id when no domain and no declared timeout', () => {
    expect(() => resolver.resolve(undefined, undefined, 'target-123')).toThrow(
      /Cannot resolve timeout.*target-123/
    );
  });
});
