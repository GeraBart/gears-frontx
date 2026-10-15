import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDomain,
  cleanupRouters,
  connectedRouter,
  entriesOf,
  MOUNT_ID,
  mountChain,
  newPage,
  segments,
  spyWrites,
  unmountChain,
  userNavigates,
} from './harness.js';

// FEATURE route-ownership-signal §2 flow steps 3-6 and 8, §1.4 Binding
// obligation points 2 and 9, DESIGN §2.3 O6: a page load (`initial`) and a back
// or forward step (`history`) become `mount_ext` and `unmount_ext` chains sent
// through the connected executor; a written navigation sends nothing.

afterEach(cleanupRouters);

const EXTENSIONS = { extA: 'alpha', extB: 'beta', extC: 'gamma', extD: 'delta' };

describe('chains for a page load or a back or forward step', () => {
  it('sends one bare mount chain per resolving entry at a page load, in URL order, with the ids the type system names', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=beta&${route}=alpha`);

    router.startDomain(domainId);

    expect(sent.chains).toEqual([mountChain(domainId, 'extB'), mountChain(domainId, 'extA')]);
    expect(sent.chains[0].action.type).toBe('test.mount');
    expect(Object.keys(sent.chains[0])).toEqual(['action']);
    expect(Object.keys(sent.chains[0].action).sort()).toEqual(['payload', 'target', 'type']);
    expect(sent.chains[0].action.payload).toStrictEqual({ subject: 'extB', history: 'none' });
  });

  it('sends its chains through the executor handed to connect, and no other', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=alpha`);

    router.startDomain(domainId);

    expect(sent.chains).toHaveLength(1);
  });

  it('sends mounts in URL order for a back step too', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=beta&${route}=alpha`);

    expect(sent.chains).toEqual([mountChain(domainId, 'extB'), mountChain(domainId, 'extA')]);
  });

  it('sends removals before mounts, each its own bare chain, one back step removing two and adding two', async () => {
    const page = newPage(`/en`);
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=alpha&${route}=beta`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA', 'extB'], 'replace');
    sent.chains.length = 0;

    await userNavigates(page, `/en?${route}=gamma&${route}=delta`);

    expect(sent.chains).toHaveLength(4);
    expect(sent.chains.slice(0, 2).map((c) => c.action.type)).toEqual(['test.unmount', 'test.unmount']);
    expect(sent.chains.slice(0, 2)).toEqual(
      expect.arrayContaining([unmountChain(domainId, 'extA'), unmountChain(domainId, 'extB')]),
    );
    expect(sent.chains.slice(2)).toEqual([mountChain(domainId, 'extC'), mountChain(domainId, 'extD')]);
  });

  it('sends the unmount for an extension it never saw mount: it reads no mounted set', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=alpha`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    sent.chains.length = 0;

    await userNavigates(page, `/en`);

    expect(sent.chains).toEqual([unmountChain(domainId, 'extA')]);
  });

  it('sends an unmount only to a domain that declares unmount: a domain without it gets the arriving mount and no unmount', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    page.history.replace(`/en?${route}=alpha`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    sent.chains.length = 0;

    await userNavigates(page, `/en?${route}=beta`);

    expect(sent.chains).toEqual([mountChain(domainId, 'extB')]);
  });

  it('sends a domain without unmount no chain at all when a back step removes its only entry', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    page.history.replace(`/en?${route}=alpha`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    sent.chains.length = 0;

    await userNavigates(page, `/en`);

    expect(sent.chains).toEqual([]);
  });

  it('sends no chain for a mount of an entry that changed only in payload, and none for a reorder alone', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=alpha&${route}=beta`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA', 'extB'], 'replace');
    sent.chains.length = 0;

    await userNavigates(page, `/en?${route}=alpha;tab=2&${route}=beta`);
    await userNavigates(page, `/en?${route}=beta&${route}=alpha;tab=2`);

    expect(sent.chains).toEqual([]);
  });

  it('sends no chain for a change under a foreign domain key or in the hash', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);

    await userNavigates(page, `/en?foreign=thing#frag`);

    expect(sent.chains).toEqual([]);
  });

  it('sends no mount for an entry that resolves to no registered extension', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=unknown-token&${route}=alpha`);

    expect(sent.chains).toEqual([mountChain(domainId, 'extA')]);
  });

  it('sends nothing for a written navigation: a push, a replace, and the router own write for a command', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);

    page.history.push(`/en?${route}=alpha`);
    page.history.replace(`/en?${route}=beta`);
    router.reflect(domainId, ['extC'], 'push');
    router.reflect(domainId, ['extD'], 'replace');

    expect(sent.chains).toEqual([]);
  });

  it('never carries a fallback or a next on a chain', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=alpha`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    await userNavigates(page, `/en?${route}=beta`);

    for (const chain of sent.chains) {
      expect(Object.keys(chain)).toEqual(['action']);
      expect(chain.action.type === MOUNT_ID || chain.action.type === 'test.unmount').toBe(true);
    }
  });

  it('dispatches a nested domain first resolution as an initial transition when its observer starts', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const outer = addDomain(router, { hostExt: 'widgets-host' });
    const inner = addDomain(router, { widgetExt: 'widget-alpha' });
    page.history.replace(`/en?${outer.route}=widgets-host&${inner.route}=widget-alpha`);

    router.startDomain(outer.domainId);
    expect(sent.chains).toEqual([mountChain(outer.domainId, 'hostExt')]);

    router.startDomain(inner.domainId);
    expect(sent.chains).toEqual([mountChain(outer.domainId, 'hostExt'), mountChain(inner.domainId, 'widgetExt')]);
  });
});

describe('the write after a back or forward step', () => {
  it('drops an entry that does not resolve with one replace, and sends no chain for it', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);
    const writes = spyWrites(page);

    await userNavigates(page, `/en?${route}=unknown-token&plain`);

    expect(sent.chains).toEqual([]);
    expect(writes.replace).toHaveBeenCalledTimes(1);
    expect(writes.push).not.toHaveBeenCalled();
    expect(segments(page)).toEqual(['plain']);
  });

  it('keeps the rest of the address when it drops an unresolved entry beside a resolved one', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=alpha&${route}=unknown-token`);

    expect(entriesOf(page, route)).toEqual(['alpha']);
  });

  it('writes nothing when every entry resolves', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);
    const writes = spyWrites(page);

    await userNavigates(page, `/en?${route}=alpha&${route}=beta`);

    expect(writes.replace).not.toHaveBeenCalled();
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('restores the last command for a domain without unmount that a back step leaves empty: no chain, the last commanded extension written back with replace', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    page.history.replace(`/en?${route}=alpha`);
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    sent.chains.length = 0;
    const writes = spyWrites(page);

    await userNavigates(page, `/en?${route}=unknown-token`);

    expect(sent.chains).toEqual([]);
    expect(entriesOf(page, route)).toEqual(['alpha']);
    expect(writes.replace).toHaveBeenCalledTimes(1);
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('restores only the extensions of the last command, not an earlier one', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    router.reflect(domainId, ['extB'], 'replace');

    await userNavigates(page, `/en`);

    expect(entriesOf(page, route)).toEqual(['beta']);
  });

  it('writes back nothing when no command was received yet', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=unknown-token`);

    expect(entriesOf(page, route)).toEqual([]);
  });

  it('drops an extension from the last-command record when the extension is released', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    router.startDomain(domainId);
    router.reflect(domainId, ['extA', 'extB'], 'replace');
    router.releaseExtension('extA');

    await userNavigates(page, `/en`);

    expect(entriesOf(page, route)).toEqual(['beta']);
  });

  it('drops the last-command record when the domain stops: a later start restores nothing', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');
    router.stopDomain(domainId);
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=unknown-token`);

    expect(entriesOf(page, route)).toEqual([]);
  });

  it('keeps the last command received before the observer exists as the record the first write-back uses', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: false });
    router.reflect(domainId, ['extB'], 'replace');
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=unknown-token`);

    expect(entriesOf(page, route)).toEqual(['beta']);
  });

  it('never writes back for a domain that declares unmount: a back step that empties it leaves it empty', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS, { declaresUnmount: true });
    router.startDomain(domainId);
    router.reflect(domainId, ['extA'], 'replace');

    await userNavigates(page, `/en`);

    expect(entriesOf(page, route)).toEqual([]);
  });
});

describe('an unresolved entry is logged only after the domain first transition', () => {
  const logged = () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => error.mock.calls.length + warn.mock.calls.length;
  };

  it('logs nothing for the address as found when the observer starts', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    page.history.replace(`/en?${route}=unknown-token`);
    const count = logged();

    router.startDomain(domainId);

    expect(count()).toBe(0);
  });

  it('logs an unresolved entry that a later back step brings', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    router.startDomain(domainId);
    const count = logged();

    await userNavigates(page, `/en?${route}=unknown-token`);

    expect(count()).toBeGreaterThan(0);
  });
});
