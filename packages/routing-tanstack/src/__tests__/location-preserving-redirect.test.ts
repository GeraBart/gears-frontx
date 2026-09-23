import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import type { RouterHistory } from '@tanstack/react-router';
import { adaptComposedHistory } from '../composed-history-source.js';
import { locationPreservingRedirect } from '../location-preserving-redirect.js';
import { resetRealm } from './helpers/index.js';

const ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };

/** A minimal stand-in carrying only the one member this helper reads
 * (`history.location.search`) — every scenario below is about that raw
 * string's own content, not about how a real `RouterHistory` arrived at
 * it, so a full `adaptComposedHistory` round trip would only re-encode a
 * malformed pair away before this helper ever saw it (§3's own guard runs
 * on write, not on this raw read). */
function historyWithSearch(search: string): RouterHistory {
  return { location: { pathname: '/', search, hash: '', href: `/${search}`, state: {} } } as unknown as RouterHistory;
}

describe('locationPreservingRedirect', () => {
  it('carries the current virtual location search forward onto the target path', () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/settings/profile', { readPageHash: () => '' });

    expect(result.options.to).toBe('/settings/profile');
    expect(result.options.search).toEqual({ orientation: 'left' });
  });

  it('carries the page own current hash forward onto the target path', () => {
    resetRealm('/en?screen=dashboard;route=settings/general');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/settings/profile', { readPageHash: () => 'section-2' });

    expect(result.options.hash).toBe('section-2');
  });

  it('drops nothing from a search carrying several parameters', () => {
    resetRealm('/en?screen=dashboard;route=settings/general;a=1;b=2');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/other', { readPageHash: () => '' });

    expect(result.options.search).toEqual({ a: '1', b: '2' });
  });

  it('carries an empty search and empty hash forward when neither is present', () => {
    resetRealm('/en?screen=dashboard;route=settings/general');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/other', { readPageHash: () => '' });

    expect(result.options.search).toEqual({});
    expect(result.options.hash).toBe('');
  });

  it('falls back to the raw text for a lone percent sign instead of throwing', () => {
    const result = locationPreservingRedirect(historyWithSearch('?a=%'), '/target', { readPageHash: () => '' });

    expect(result.options.search).toEqual({ a: '%' });
  });

  it('falls back to the raw text for a literal percent sign inside an otherwise well-formed search', () => {
    const result = locationPreservingRedirect(historyWithSearch('?a=100%&b=2'), '/target', { readPageHash: () => '' });

    expect(result.options.search).toEqual({ a: '100%', b: '2' });
  });

  it('still decodes a validly percent-encoded value unchanged', () => {
    const result = locationPreservingRedirect(historyWithSearch('?a=%20b&c=%E2%9C%93'), '/target', { readPageHash: () => '' });

    expect(result.options.search).toEqual({ a: ' b', c: '✓' });
  });
});
