import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { navigation } from '../index.js';
import { resetRealm, entry, type FakeHistoryAdapter } from './helpers/index.js';
import { composedUrl, DASHBOARD_ENTRY, SIDEBAR_ENTRY } from './helpers/composed-url.js';

const { ownEntryAddress } = vi.hoisted(() => ({ ownEntryAddress: vi.fn() }));

vi.mock('@gears-frontx/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/routing')>()),
  router: { ownEntryAddress },
}));

const OWN: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };
const ENTRIES = [DASHBOARD_ENTRY, SIDEBAR_ENTRY];
const COMPOSED_URL = composedUrl('/en', ENTRIES);

function dashboardAt(route: string, ...rest: { name: string; value: string }[]) {
  return entry('screen', 'dashboard', [{ name: 'route', value: route }, ...rest]);
}

let adapter: FakeHistoryAdapter;

describe('navigation() in a routed extension', () => {
  beforeEach(() => {
    adapter = resetRealm(COMPOSED_URL);
    ownEntryAddress.mockReset().mockReturnValue(OWN);
  });

  it('location() reads the own entry as {pathname, search}', () => {
    expect(navigation().location()).toEqual({ pathname: '/settings/general', search: '?orientation=left' });
  });

  it('navigate(path) writes only the own entry', () => {
    navigation().navigate('/settings/profile?orientation=right');
    expect(adapter.lastWrite).toBe(
      composedUrl('/en', [dashboardAt('settings/profile', { name: 'orientation', value: 'right' }), SIDEBAR_ENTRY]),
    );
    expect(navigation().location()).toEqual({ pathname: '/settings/profile', search: '?orientation=right' });
  });

  it('replace(path) writes the own entry with the replace verb', () => {
    const replace = vi.spyOn(resolveNavigationHistory(), 'replace');
    const push = vi.spyOn(resolveNavigationHistory(), 'push');
    navigation().replace('/settings/profile');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(navigation().location().pathname).toBe('/settings/profile');
  });

  it('location() reads fresh state on every call, including an external write', () => {
    const facade = navigation();
    expect(facade.location().pathname).toBe('/settings/general');
    resolveNavigationHistory().push(composedUrl('/en', [dashboardAt('elsewhere'), SIDEBAR_ENTRY]));
    expect(facade.location().pathname).toBe('/elsewhere');
  });

  it('exposes exactly navigate, replace and location', () => {
    expect(Object.keys(navigation()).sort()).toEqual(['location', 'navigate', 'replace']);
  });

  it('refuses every member once the router has no occupant value for the extension', () => {
    const facade = navigation();
    ownEntryAddress.mockImplementation(() => {
      throw new Error('no access to the router');
    });
    expect(() => facade.navigate('/a')).toThrow('no access to the router');
    expect(() => facade.replace('/a')).toThrow('no access to the router');
    expect(() => facade.location()).toThrow('no access to the router');
  });

  it('drops a hash passed in the path and keeps the current page hash verbatim', () => {
    const profile = [dashboardAt('settings/profile'), SIDEBAR_ENTRY];
    adapter = resetRealm(composedUrl('/en', ENTRIES, 'page'));
    navigation().navigate('/settings/profile#frag');
    expect(adapter.lastWrite).toBe(composedUrl('/en', profile, 'page'));
    expect(adapter.lastWrite).not.toContain('frag');
    adapter = resetRealm(composedUrl('/en', ENTRIES, 'page'));
    navigation().replace('/settings/profile#frag');
    expect(adapter.lastWrite).toBe(composedUrl('/en', profile, 'page'));
    expect(adapter.lastWrite).not.toContain('frag');
  });

  it('writes no hash when the page has none, even if one is passed', () => {
    navigation().navigate('/settings/profile#frag');
    expect(adapter.lastWrite).not.toContain('#');
  });
});

describe('navigation() in the shell runtime', () => {
  beforeEach(() => {
    adapter = resetRealm(COMPOSED_URL);
    ownEntryAddress.mockReset().mockReturnValue(undefined);
  });

  it('location() covers the pathname only, with an empty search', () => {
    expect(navigation().location()).toEqual({ pathname: '/en', search: '' });
  });

  it('navigate and replace write the pathname and leave the query string untouched', () => {
    navigation().navigate('/fr');
    expect(adapter.lastWrite).toBe(composedUrl('/fr', ENTRIES));
    navigation().replace('/de');
    expect(adapter.lastWrite).toBe(composedUrl('/de', ENTRIES));
  });

  it('drops a hash passed in the path and keeps the current page hash verbatim', () => {
    adapter = resetRealm(composedUrl('/en', ENTRIES, 'page'));
    navigation().navigate('/fr#frag');
    expect(adapter.lastWrite).toBe(composedUrl('/fr', ENTRIES, 'page'));
    expect(adapter.lastWrite).not.toContain('frag');
  });

  it('writes no hash when the page has none, even if one is passed', () => {
    navigation().navigate('/fr#frag');
    expect(adapter.lastWrite).toBe(composedUrl('/fr', ENTRIES));
  });
});

describe('navigation() in an extension runtime with no access to the router', () => {
  it('refuses', () => {
    resetRealm(COMPOSED_URL);
    ownEntryAddress.mockReset().mockImplementation(() => {
      throw new Error('no access to the router');
    });
    expect(() => navigation().location()).toThrow('no access to the router');
    expect(() => navigation().navigate('/a')).toThrow('no access to the router');
    expect(() => navigation().replace('/a')).toThrow('no access to the router');
  });
});
