import { describe, expect, it } from 'vitest';
import { buildSearchString, decodeComponentOrRaw, parseSearchString } from '../search-codec.js';

describe('decodeComponentOrRaw', () => {
  it('decodes a validly percent-encoded value', () => {
    expect(decodeComponentOrRaw('a%20b')).toBe('a b');
  });

  it('falls back to the raw text on a malformed percent-escape rather than throwing', () => {
    expect(decodeComponentOrRaw('%')).toBe('%');
    expect(decodeComponentOrRaw('100%')).toBe('100%');
  });
});

describe('parseSearchString', () => {
  it('splits and decodes every pair, tolerating a malformed one among well-formed ones', () => {
    expect(parseSearchString('?a=100%&b=2')).toEqual([
      { name: 'a', value: '100%' },
      { name: 'b', value: '2' },
    ]);
  });

  it('treats a pair with no `=` as an empty value, decoded the same way', () => {
    expect(parseSearchString('?%zz=1')).toEqual([{ name: '%zz', value: '1' }]);
  });
});

describe('buildSearchString', () => {
  it('percent-encodes every name and value, including one that was kept raw on a prior parse', () => {
    expect(buildSearchString([{ name: 'a', value: '100%' }])).toBe('?a=100%25');
  });
});
