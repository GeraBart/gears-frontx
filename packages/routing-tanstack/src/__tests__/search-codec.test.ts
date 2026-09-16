import { describe, expect, it } from 'vitest';
import { buildSearchString, decodeComponentOrRaw, parseSearchString } from '../search-codec.js';
import { locationPreservingRedirect } from '../location-preserving-redirect.js';
import { projectVirtualLocationToParams } from '../virtual-location.js';
import type { RouterHistory } from '@tanstack/react-router';

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

// Both call sites this module exists to unify — the redirect helper's own
// search-to-record conversion and the virtual-location codec's own
// search-to-params conversion — must agree on a search string neither of
// them, before this module existed, could parse without one risking a
// throw the other already guarded against.
describe('shared decode rule — both call sites agree', () => {
  it('agree on a search string carrying a malformed percent-escape', () => {
    const search = '?a=100%&b=2';

    const fromVirtualLocation = projectVirtualLocationToParams('/x', search).filter((param) => param.name !== 'route');

    const fakeHistory = {
      location: { pathname: '/', search, hash: '', href: `/${search}`, state: {} },
    } as unknown as RouterHistory;
    const fromRedirect = locationPreservingRedirect(fakeHistory, '/target', { readPageHash: () => '' }).options.search;

    expect(fromVirtualLocation).toEqual([
      { name: 'a', value: '100%' },
      { name: 'b', value: '2' },
    ]);
    expect(fromRedirect).toEqual({ a: '100%', b: '2' });
  });
});
