import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { adaptComposedHistory } from '../composed-history-source.js';
import { attachAdaptedHistory } from '../history-adaptation.js';
import { resetRealm } from './helpers/index.js';

const ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };
const URL = '/en?screen=dashboard;route=settings/general;orientation=left';

describe('teardown on unmount', () => {
  it('releases the internal callback from the shared NavigationHistory, so it stops receiving the fan-out', () => {
    resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    attachAdaptedHistory(history);

    let notified = 0;
    history.subscribe(() => {
      notified += 1;
    });

    navigationHistory.push('/en?screen=dashboard;route=settings/profile;orientation=left');
    expect(notified).toBe(1);

    history.destroy();

    navigationHistory.push('/en?screen=dashboard;route=settings/billing;orientation=left');
    expect(notified).toBe(1);
  });

  it('a second teardown call is a safe no-op', () => {
    resetRealm(URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);
    attachAdaptedHistory(history);

    expect(() => {
      history.destroy();
      history.destroy();
    }).not.toThrow();
  });
});
