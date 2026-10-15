import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  resolveNavigationHistory,
  type DomainKey,
  type EntryAddress,
  type ExtensionToken,
  type HistoryVerb,
} from '@gears-frontx/routing';
import { adaptComposedHistory, createComposedVirtualLocationSource } from '../composed-history-source.js';
import { attachAdaptedHistory } from '../history-adaptation.js';
import { resetRealm } from './helpers/index.js';

const SHEET_ENTRY_ADDRESS: EntryAddress = { domainKey: 'sheet' as DomainKey, extension: 'tenant-details' as ExtensionToken };
const URL = '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=456';

describe('createComposedVirtualLocationSource', () => {
  it('reads the addressed occupant own params, ignoring every other entry', () => {
    resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);
    expect(source.readParams()).toEqual([
      { name: 'route', value: 'contacts' },
      { name: 'tenantId', value: '456' },
    ]);
  });

  it('reports undefined when the addressed entry is not present in the URL', () => {
    resetRealm('/en?screen=dashboard;route=settings/general');
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);
    expect(source.readParams()).toBeUndefined();
  });

  it('writes back the full new parameter list for the addressed occupant only, via one call', () => {
    const adapter = resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999',
    );
  });

  it('drops a parameter the new search no longer carries, since payloadChanged replaces the whole list', () => {
    const adapter = resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '', 'replace');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts',
    );
  });

  // Once this occupant's own entry is no longer in the URL, a write
  // through this source has nothing of its own left to write to (FEATURE
  // §3, step 8.1 — "no write-back runs, because there is no longer an
  // entry of this occupant's own to write to"). Without this guard,
  // `backProjectEntries` still issues one no-op-content write (the
  // unchanged URL, since there is no matching entry to change), which is a
  // spurious history entry and a spurious fan-out round for every other
  // subscriber.
  it('issues no write at all once this occupant own entry is absent from the URL', () => {
    const adapter = resetRealm('/en?screen=dashboard;route=settings/general');
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push');

    expect(adapter.lastWrite).toBeUndefined();
  });
});

// The page hash belongs to no runtime (FEATURE (engine-provider) §3, History
// Adaptation, `inst-expose-direct-members`, `inst-derive-create-href`). A
// write leaves the current page hash in place through the core's
// back-projection helper, which copies it unchanged; `createHref` returns no
// hash; no source member takes a hash.
describe('composed hash on write/createHref', () => {
  it('keeps the current page hash verbatim on write', () => {
    const adapter = resetRealm(`${URL}#current`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999#current',
    );
  });

  it('writes no hash when the page carries none', () => {
    const adapter = resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'replace');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999',
    );
  });

  it('createHref carries no hash, even when the page has one', () => {
    resetRealm(`${URL}#current`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    expect(source.createHref('/contacts', '?tenantId=999')).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999',
    );
  });

  it('takes no hash: neither write nor createHref accepts one', () => {
    const adapter = resetRealm(`${URL}#current`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);
    expectTypeOf(source.write).parameters.toEqualTypeOf<[string, string, HistoryVerb]>();
    expectTypeOf(source.createHref).parameters.toEqualTypeOf<[string, string]>();

    (source.write as (...args: unknown[]) => void)('/contacts', '?tenantId=999', 'push', 'new');
    const href = (source.createHref as (...args: unknown[]) => string)('/contacts', '?tenantId=999', 'new');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999#current',
    );
    expect(href).not.toContain('#');
  });
});

// Missing-tests audit: "two routers over one shared history (both receive
// the change, exactly once each)" — two independently constructed
// `RouterHistory` objects, each addressed at a different occupant, both
// wired to the identical realm-shared `NavigationHistory`.
describe('two routers over one shared history', () => {
  it('a push by one runtime notifies both (the position moved); a replace notifies only the runtime whose own subroute changed', () => {
    resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();
    const dashboardHistory = adaptComposedHistory(navigationHistory, {
      domainKey: 'screen' as DomainKey,
      extension: 'dashboard' as ExtensionToken,
    });
    const sheetHistory = adaptComposedHistory(navigationHistory, SHEET_ENTRY_ADDRESS);
    // An adapted history observes the shared history only once something
    // attaches it; outside a mounted `EngineProvider` that is the caller's
    // own act.
    attachAdaptedHistory(dashboardHistory);
    attachAdaptedHistory(sheetHistory);

    const dashboardReceived: unknown[] = [];
    const sheetReceived: unknown[] = [];
    dashboardHistory.subscribe((args) => dashboardReceived.push(args));
    sheetHistory.subscribe((args) => sheetReceived.push(args));

    // A write through the sheet occupant's own history reaches the shared
    // `NavigationHistory` and moves the history position, so both runtimes'
    // engines are told (their index and `canGoBack` follow it).
    sheetHistory.push('/contacts?tenantId=999');

    expect(dashboardReceived).toHaveLength(1);
    expect(sheetReceived).toHaveLength(1);
    expect(sheetHistory.location.search).toBe('?tenantId=999');

    // A replace leaves the position unchanged: the dashboard occupant's own
    // subroute is the same, so only the sheet's own subscriber is invoked.
    sheetHistory.replace('/contacts?tenantId=111');

    expect(dashboardReceived).toHaveLength(1);
    expect(sheetReceived).toHaveLength(2);
    // The dashboard occupant's own entry is untouched by the sheet's own write.
    expect(dashboardHistory.location.pathname).toBe('/settings/general');
  });
});
