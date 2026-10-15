import { afterEach, describe, expect, it } from 'vitest';
import {
  addDomain,
  cleanupRouters,
  connectedRouter,
  entriesOf,
  mountChain,
  newPage,
  newRouter,
  recordingExecutor,
  segments,
  spyWrites,
  typeSystem,
  userNavigates,
} from './harness.js';

// FEATURE route-ownership-signal §2 flow steps 4.3.2, 7.3, 8.1 and 9, §1.4
// Binding obligation points 9 and 10, DESIGN §2.3 O6: a page load sends its
// chains from the initial route and clears the URL entries once; the router
// keeps the initial route for first resolutions and first writes until the
// first push command or the next back or forward step.

afterEach(cleanupRouters);

describe('a page load clears the URL entries once, after its chains are sent', () => {
  it('sends the chains, then clears every entry with one replace and keeps the rest of the address', async () => {
    const page = newPage('/en');
    const router = await newRouter();
    const sent = recordingExecutor();
    const searchAtSend: string[] = [];
    router.connect(
      {
        executeActionsChain: (chain: (typeof sent.chains)[number]) => {
          searchAtSend.push(decodeURIComponent(page.history.location.search));
          sent.executor.executeActionsChain(chain);
        },
      },
      typeSystem,
    );
    const { domainId, route } = addDomain(router, { profileExt: 'profile' }, { declaresUnmount: false });
    page.history.replace(`/shell/area?${route}=profile&sidebar=hello-world&plain#frag`);
    const writes = spyWrites(page);

    router.startDomain(domainId);

    expect(sent.chains).toEqual([mountChain(domainId, 'profileExt')]);
    expect(searchAtSend).toHaveLength(1);
    expect(searchAtSend[0]).toContain(`${route}=profile`);
    expect(writes.replace).toHaveBeenCalledTimes(1);
    expect(writes.push).not.toHaveBeenCalled();
    expect(segments(page)).toEqual(['plain']);
    expect(page.history.location.path).toBe('/shell/area');
    expect(page.history.location.hash).toMatch(/frag$/);
  });

  it('writes only the settled screen afterwards: an entry no domain reads is absent after the load', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, { profileExt: 'profile' }, { declaresUnmount: false });
    page.history.replace(`/en?${route}=profile&sidebar=hello-world`);

    router.startDomain(domainId);
    router.reflect(domainId, ['profileExt'], 'replace');

    expect(segments(page)).toEqual([`${route}=profile`]);
  });

  it('sends no chain for an unknown screen, and the settle naming no extension leaves the screen part absent', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, { profileExt: 'profile' }, { declaresUnmount: false });
    page.history.replace(`/en?${route}=no-such`);
    const writes = spyWrites(page);

    router.startDomain(domainId);
    router.reflect(domainId, [], 'replace');

    expect(sent.chains).toEqual([]);
    expect(segments(page)).toEqual([]);
    expect(writes.replace).toHaveBeenCalledTimes(1);
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('clears even when a send throws', async () => {
    const page = newPage('/en');
    const router = await newRouter();
    router.connect(
      {
        executeActionsChain: () => {
          throw new Error('send failed');
        },
      },
      typeSystem,
    );
    const { domainId, route } = addDomain(router, { extA: 'alpha' });
    page.history.replace(`/en?${route}=alpha&plain`);

    try {
      router.startDomain(domainId);
    } catch {
      // whether the send failure reaches the caller is not under test
    }

    expect(segments(page)).toEqual(['plain']);
  });

  it('writes nothing for an address that carries no entry', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId } = addDomain(router, { extA: 'alpha' });
    page.history.replace('/shell?plain#h');
    const writes = spyWrites(page);

    router.startDomain(domainId);

    expect(writes.replace).not.toHaveBeenCalled();
    expect(writes.push).not.toHaveBeenCalled();
    expect(segments(page)).toEqual(['plain']);
  });

  it('clears once per load: a second root domain and a nested domain started afterwards clear nothing and resolve from the kept initial route', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const screen = addDomain(router, { hostExt: 'widgets-host' }, { declaresUnmount: false });
    const sidebar = addDomain(router, { navExt: 'main-nav' });
    const widgets = addDomain(router, { widgetExt: 'widget-alpha' });
    page.history.replace(
      `/en?${screen.route}=widgets-host&${sidebar.route}=main-nav&${widgets.route}=widget-alpha`,
    );
    const writes = spyWrites(page);

    router.startDomain(screen.domainId);
    expect(sent.chains).toEqual([mountChain(screen.domainId, 'hostExt')]);
    expect(segments(page)).toEqual([]);
    expect(writes.replace).toHaveBeenCalledTimes(1);

    router.startDomain(sidebar.domainId);
    expect(sent.chains).toEqual([mountChain(screen.domainId, 'hostExt'), mountChain(sidebar.domainId, 'navExt')]);
    expect(writes.replace).toHaveBeenCalledTimes(1);

    router.reflect(screen.domainId, ['hostExt'], 'replace');
    router.reflect(sidebar.domainId, ['navExt'], 'replace');
    expect(writes.replace).toHaveBeenCalledTimes(3);

    router.startDomain(widgets.domainId);
    expect(sent.chains).toContainEqual(mountChain(widgets.domainId, 'widgetExt'));
    expect(segments(page)).toEqual([`${screen.route}=widgets-host`, `${sidebar.route}=main-nav`]);
    expect(writes.replace).toHaveBeenCalledTimes(3);
    expect(writes.push).not.toHaveBeenCalled();
  });
});

describe('the kept initial route serves first resolutions and first writes', () => {
  it('resolves a nested domain started after the clear against the kept initial route, and its first write carries the entry parameters', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const screen = addDomain(router, { hostExt: 'widgets-host' }, { declaresUnmount: false });
    const widgets = addDomain(router, { widgetExt: 'widget-alpha' });
    page.history.replace(`/en?${screen.route}=widgets-host&${widgets.route}=widget-alpha;last-ping=X`);

    router.startDomain(screen.domainId);
    expect(sent.chains).toEqual([mountChain(screen.domainId, 'hostExt')]);
    expect(segments(page)).toEqual([]);
    router.reflect(screen.domainId, ['hostExt'], 'replace');
    expect(segments(page)).toEqual([`${screen.route}=widgets-host`]);

    sent.chains.length = 0;
    router.startDomain(widgets.domainId);

    expect(sent.chains).toEqual([mountChain(widgets.domainId, 'widgetExt')]);
    expect(entriesOf(page, widgets.route)).toEqual([]);

    router.reflect(widgets.domainId, ['widgetExt'], 'replace');

    expect(entriesOf(page, screen.route)).toEqual(['widgets-host']);
    expect(entriesOf(page, widgets.route)).toEqual(['widget-alpha;last-ping=X']);
  });

  it('carries the initial-route parameters on the first write of a named extension, and none on a later write of it', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, { profileExt: 'profile', settingsExt: 'settings' }, { declaresUnmount: false });
    page.history.replace(`/en?${route}=profile;tab=2`);

    router.startDomain(domainId);
    expect(entriesOf(page, route)).toEqual([]);

    router.reflect(domainId, ['profileExt'], 'replace');
    expect(entriesOf(page, route)).toEqual(['profile;tab=2']);

    router.reflect(domainId, ['settingsExt'], 'replace');
    router.reflect(domainId, ['profileExt'], 'replace');
    expect(entriesOf(page, route)).toEqual(['profile']);
  });

  it('carries no parameters on the first write of an extension the initial route did not name', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, { profileExt: 'profile', settingsExt: 'settings' }, { declaresUnmount: false });
    page.history.replace(`/en?${route}=profile;tab=2`);

    router.startDomain(domainId);
    router.reflect(domainId, ['settingsExt'], 'replace');

    expect(entriesOf(page, route)).toEqual(['settings']);
  });

  it('keeps the initial route while only the load chains and settle replaces have been received', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const screen = addDomain(router, { profileExt: 'profile' }, { declaresUnmount: false });
    const late = addDomain(router, { lateExt: 'late-one' });
    page.history.replace(`/en?${screen.route}=profile&${late.route}=late-one;p=1`);
    router.startDomain(screen.domainId);
    router.reflect(screen.domainId, ['profileExt'], 'replace');
    sent.chains.length = 0;

    router.startDomain(late.domainId);
    router.reflect(late.domainId, ['lateExt'], 'replace');

    expect(sent.chains).toEqual([mountChain(late.domainId, 'lateExt')]);
    expect(entriesOf(page, late.route)).toEqual(['late-one;p=1']);
  });
});

describe('the kept initial route ends at the first push command or at a back or forward step', () => {
  const setup = async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const screen = addDomain(router, { profileExt: 'profile', settingsExt: 'settings' }, { declaresUnmount: false });
    const late = addDomain(router, { lateOneExt: 'late-one', lateTwoExt: 'late-two' });
    page.history.replace(`/a?${screen.route}=profile;tab=2&${late.route}=late-one;p=1`);
    router.startDomain(screen.domainId);
    router.reflect(screen.domainId, ['profileExt'], 'replace');
    return { page, router, sent, screen, late };
  };

  it('ends at a push command: a domain that starts later resolves against the live URL, and the named extension write carries no initial-route parameters', async () => {
    const { page, router, sent, screen, late } = await setup();

    router.reflect(screen.domainId, ['settingsExt'], 'push');
    page.history.replace(`/a?${screen.route}=settings&${late.route}=late-two`);
    sent.chains.length = 0;
    router.startDomain(late.domainId);

    expect(sent.chains).toEqual([mountChain(late.domainId, 'lateTwoExt')]);
    router.reflect(screen.domainId, ['profileExt'], 'replace');
    expect(entriesOf(page, screen.route)).toEqual(['profile']);
  });

  it('ends at a push command for a domain the router does not know', async () => {
    const { page, router, sent, screen, late } = await setup();

    router.reflect('no-such-domain', [], 'push');
    page.history.replace(`/a?${screen.route}=profile&${late.route}=late-two`);
    sent.chains.length = 0;
    router.startDomain(late.domainId);

    expect(sent.chains).toEqual([mountChain(late.domainId, 'lateTwoExt')]);
  });

  it('does not end at a replace command', async () => {
    const { page, router, sent, screen, late } = await setup();

    router.reflect(screen.domainId, ['settingsExt'], 'replace');
    page.history.replace(`/a?${screen.route}=settings&${late.route}=late-two`);
    sent.chains.length = 0;
    router.startDomain(late.domainId);

    expect(sent.chains).toEqual([mountChain(late.domainId, 'lateOneExt')]);
  });

  it('ends at a back or forward step: a domain that starts later resolves against the live URL, and the named extension write carries no initial-route parameters', async () => {
    const { page, router, sent, screen, late } = await setup();

    await userNavigates(page, `/a?${screen.route}=settings&${late.route}=late-two`);
    sent.chains.length = 0;
    router.startDomain(late.domainId);

    expect(sent.chains).toEqual([mountChain(late.domainId, 'lateTwoExt')]);
    router.reflect(screen.domainId, ['profileExt'], 'replace');
    expect(entriesOf(page, screen.route)).toEqual(['profile']);
  });

  it('ends at a back or forward step that changes only the pathname, the hash or a foreign segment', async () => {
    const { page, router, sent, screen, late } = await setup();

    await userNavigates(page, `/b?${screen.route}=profile&${late.route}=late-two&foreign#h`);
    sent.chains.length = 0;
    router.startDomain(late.domainId);

    expect(sent.chains).toEqual([mountChain(late.domainId, 'lateTwoExt')]);
  });

  it('ends at a push command that arrives before the load begins: the first initial transition still dispatches and clears once, and keeps no initial route', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const screen = addDomain(router, { profileExt: 'profile' }, { declaresUnmount: false });
    const late = addDomain(router, { lateExt: 'late-one' });
    router.reflect('no-such-domain', [], 'push');
    page.history.replace(`/en?${screen.route}=profile;tab=2&${late.route}=late-one`);
    const writes = spyWrites(page);

    router.startDomain(screen.domainId);

    expect(sent.chains).toEqual([mountChain(screen.domainId, 'profileExt')]);
    expect(segments(page)).toEqual([]);
    expect(writes.replace).toHaveBeenCalledTimes(1);

    sent.chains.length = 0;
    router.startDomain(late.domainId);

    expect(sent.chains).toEqual([]);
    expect(writes.replace).toHaveBeenCalledTimes(1);

    router.reflect(screen.domainId, ['profileExt'], 'replace');
    expect(entriesOf(page, screen.route)).toEqual(['profile']);
  });
});

describe('the page load is shared by every router in the page', () => {
  it('lets the host router clear once, and a nested runtime router resolve its domain from the kept initial route with the entry parameters on its first write', async () => {
    const page = newPage('/en');
    const host = await connectedRouter();
    const screen = addDomain(host.router, { hostExt: 'widgets-host' }, { declaresUnmount: false });
    page.history.replace(`/en?${screen.route}=widgets-host&wid=widget-alpha;last-ping=X`);

    host.router.startDomain(screen.domainId);
    host.router.reflect(screen.domainId, ['hostExt'], 'replace');
    expect(segments(page)).toEqual([`${screen.route}=widgets-host`]);

    const nested = await connectedRouter();
    nested.router.supplyNavigation(() => ({ domainKey: screen.route, extension: 'widgets-host' }));
    const widgets = addDomain(nested.router, { widgetExt: 'widget-alpha' }, { route: 'wid' });
    const writes = spyWrites(page);

    nested.router.startDomain(widgets.domainId);

    expect(nested.sent.chains).toEqual([mountChain(widgets.domainId, 'widgetExt')]);
    expect(writes.replace).not.toHaveBeenCalled();

    nested.router.reflect(widgets.domainId, ['widgetExt'], 'replace');

    expect(entriesOf(page, 'wid')).toEqual(['widget-alpha;last-ping=X']);
  });
});
