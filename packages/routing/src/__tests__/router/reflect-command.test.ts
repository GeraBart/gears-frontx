import { afterEach, describe, expect, it } from 'vitest';
import {
  addDomain,
  cleanupRouters,
  connectedRouter,
  entriesOf,
  freshRoute,
  newPage,
  spyWrites,
  type DomainRig,
  type RouterLike,
} from './harness.js';

// FEATURE route-ownership-signal §2 flow step 7, §1.4 Binding obligation points
// 3, 8 and 10, DESIGN §2.3 O5 and O7: the runtime's `reflect` command writes the
// extensions it names for a domain, with its verb, in one history write; a
// dropped host takes its nested domains with it; a write for a domain whose
// enclosing entry is absent waits.

afterEach(cleanupRouters);

const EXTENSIONS = { extA: 'alpha', extB: 'beta', extC: 'gamma' };

/** A started domain with the live URL set to `url` afterwards: a written navigation, so nothing is dispatched. */
async function startedAt(url: (route: string) => string, options: { declaresUnmount?: boolean } = {}) {
  const page = newPage('/en');
  const { router, sent } = await connectedRouter();
  const rig = addDomain(router, EXTENSIONS, options);
  router.startDomain(rig.domainId);
  page.history.replace(url(rig.route));
  return { page, sent, ...rig };
}

describe('reflect writes the commanded set with the commanded verb', () => {
  it('writes a push command with one push and no replace', async () => {
    const { page, router, domainId, route } = await startedAt(() => '/en');
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');

    expect(entriesOf(page, route)).toEqual(['alpha']);
    expect(writes.push).toHaveBeenCalledTimes(1);
    expect(writes.replace).not.toHaveBeenCalled();
  });

  it('writes a replace command with one replace and no push', async () => {
    const { page, router, domainId, route } = await startedAt(() => '/en');
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'replace');

    expect(entriesOf(page, route)).toEqual(['alpha']);
    expect(writes.replace).toHaveBeenCalledTimes(1);
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('writes the one new extension in the dropped one position when a command drops exactly one and names exactly one', async () => {
    const { page, router, domainId, route } = await startedAt((r) => `/en?${r}=alpha&${r}=beta`);
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA', 'extC'], 'push');

    expect(entriesOf(page, route)).toEqual(['alpha', 'gamma']);
    expect(writes.push).toHaveBeenCalledTimes(1);
  });

  it('takes the position of the single dropped entry when the dropped one comes first', async () => {
    const { page, router, domainId, route } = await startedAt((r) => `/en?${r}=alpha&${r}=beta`);

    router.reflect(domainId, ['extB', 'extC'], 'replace');

    expect(entriesOf(page, route)).toEqual(['gamma', 'beta']);
  });

  it('removes the dropped extensions and appends the new ones in the command order otherwise', async () => {
    const { page, router, domainId, route } = await startedAt((r) => `/en?${r}=alpha&${r}=beta`);

    router.reflect(domainId, ['extC'], 'replace');

    expect(entriesOf(page, route)).toEqual(['gamma']);
  });

  it('keeps the entries a command keeps in their position with their parameters, and appends a new one after every entry', async () => {
    const { page, router, domainId, route } = await startedAt((r) => `/en?${r}=alpha;tab=2&${r}=beta;x=1`);

    router.reflect(domainId, ['extA', 'extB', 'extC'], 'push');

    expect(entriesOf(page, route)).toEqual(['alpha;tab=2', 'beta;x=1', 'gamma']);
  });

  it('writes nothing when the result equals the live URL, whatever the verb or the order the command names', async () => {
    const { page, router, domainId } = await startedAt((r) => `/en?${r}=alpha&${r}=beta`);
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA', 'extB'], 'push');
    router.reflect(domainId, ['extB', 'extA'], 'replace');

    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).not.toHaveBeenCalled();
  });

  it('leaves the entries under other domain keys verbatim', async () => {
    const { page, router, domainId, route } = await startedAt((r) => `/en?other=thing;p=1&${r}=alpha`);

    router.reflect(domainId, ['extB'], 'replace');

    expect(entriesOf(page, 'other')).toEqual(['thing;p=1']);
    expect(entriesOf(page, route)).toEqual(['beta']);
  });

  it('writes nothing before the domain is started and nothing after it is stopped', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, EXTENSIONS);
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');
    router.startDomain(domainId);
    router.stopDomain(domainId);
    router.reflect(domainId, ['extB'], 'replace');

    expect(entriesOf(page, route)).toEqual([]);
    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).not.toHaveBeenCalled();
  });

  it('writes nothing and does not throw for a domain it does not know', async () => {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    const writes = spyWrites(page);

    expect(() => router.reflect('no-such-domain', ['extA'], 'push')).not.toThrow();
    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).not.toHaveBeenCalled();
  });

  it('writes nothing when an extension or a domain is released', async () => {
    const { page, router, domainId } = await startedAt((r) => `/en?${r}=alpha`);
    const writes = spyWrites(page);

    router.releaseExtension('extA');
    router.releaseDomain(domainId);

    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).not.toHaveBeenCalled();
  });
});

describe('a command that drops a host clears its nested domains in the same single write', () => {
  /**
   * A host domain in router `host`, with `hostx` and `other` extensions, and a
   * nested chain of routers each supplied the entry of the one before.
   */
  async function nesting(levels: number) {
    const page = newPage('/en');
    const host = await connectedRouter();
    const hostDomain = addDomain(host.router, { extHost: 'hostx', extOther: 'other' }, { declaresUnmount: true });
    host.router.startDomain(hostDomain.domainId);
    const nested: Array<{ router: RouterLike; rig: DomainRig; token: string }> = [];
    let enclosing = { domainKey: hostDomain.route, extension: 'hostx' };
    for (let level = 0; level < levels; level += 1) {
      const { router } = await connectedRouter();
      router.supplyNavigation(() => enclosing);
      const token = `tok${level}`;
      const rig = addDomain(router, { [`nested${level}`]: token }, { route: freshRoute('n') });
      nested.push({ router, rig, token });
      enclosing = { domainKey: rig.route, extension: token };
    }
    return { page, host, hostDomain, nested };
  }

  const liveUrl = (hostRoute: string, nested: Array<{ rig: DomainRig; token: string }>, hostToken = 'hostx') =>
    `/en?${hostRoute}=${hostToken}` + nested.map((n) => `&${n.rig.route}=${n.token}`).join('') + '&keep=1';

  it('clears the nested keys in the one write of a one-for-one replacement, under the command verb', async () => {
    const { page, host, hostDomain, nested } = await nesting(1);
    page.history.replace(liveUrl(hostDomain.route, nested));
    const writes = spyWrites(page);

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push');

    expect(entriesOf(page, hostDomain.route)).toEqual(['other']);
    expect(entriesOf(page, nested[0].rig.route)).toEqual([]);
    expect(entriesOf(page, 'keep')).toEqual(['1']);
    expect(writes.push).toHaveBeenCalledTimes(1);
    expect(writes.replace).not.toHaveBeenCalled();
  });

  it('clears the nested keys in the one write of a command that only removes the host', async () => {
    const { page, host, hostDomain, nested } = await nesting(1);
    page.history.replace(liveUrl(hostDomain.route, nested));
    const writes = spyWrites(page);

    host.router.reflect(hostDomain.domainId, [], 'replace');

    expect(entriesOf(page, hostDomain.route)).toEqual([]);
    expect(entriesOf(page, nested[0].rig.route)).toEqual([]);
    expect(writes.replace).toHaveBeenCalledTimes(1);
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('clears every level of a host, mid and leaf nesting transitively in that one write', async () => {
    const { page, host, hostDomain, nested } = await nesting(3);
    page.history.replace(liveUrl(hostDomain.route, nested));
    const writes = spyWrites(page);

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push');

    for (const { rig } of nested) {
      expect(entriesOf(page, rig.route)).toEqual([]);
    }
    expect(entriesOf(page, 'keep')).toEqual(['1']);
    expect(writes.push).toHaveBeenCalledTimes(1);
    expect(writes.replace).not.toHaveBeenCalled();
  });

  it('leaves the nested entries alone when a command keeps the host and adds another', async () => {
    const { page, host, hostDomain, nested } = await nesting(1);
    page.history.replace(liveUrl(hostDomain.route, nested));

    host.router.reflect(hostDomain.domainId, ['extHost', 'extOther'], 'push');

    expect(entriesOf(page, hostDomain.route)).toEqual(['hostx', 'other']);
    expect(entriesOf(page, nested[0].rig.route)).toEqual([nested[0].token]);
  });

  it('records a nested domain at supplyNavigation when the domain registered before its navigation was supplied', async () => {
    const page = newPage('/en');
    const host = await connectedRouter();
    const hostDomain = addDomain(host.router, { extHost: 'hostx', extOther: 'other' });
    host.router.startDomain(hostDomain.domainId);
    const { router } = await connectedRouter();
    const nestedDomain = addDomain(router, { nestedExt: 'wa' }, { route: freshRoute('n') });
    router.supplyNavigation(() => ({ domainKey: hostDomain.route, extension: 'hostx' }));
    page.history.replace(`/en?${hostDomain.route}=hostx&${nestedDomain.route}=wa`);

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push');

    expect(entriesOf(page, nestedDomain.route)).toEqual([]);
  });

  it('moves the record when navigation is supplied again with another occupant value: the previous occupant does not clear it', async () => {
    const page = newPage('/en');
    const host = await connectedRouter();
    const hostDomain = addDomain(host.router, { extHost: 'hostx', extOther: 'other' });
    host.router.startDomain(hostDomain.domainId);
    const { router } = await connectedRouter();
    router.supplyNavigation(() => ({ domainKey: hostDomain.route, extension: 'hostx' }));
    const nestedDomain = addDomain(router, { nestedExt: 'wa' }, { route: freshRoute('n') });
    router.supplyNavigation(() => ({ domainKey: hostDomain.route, extension: 'other' }));
    page.history.replace(`/en?${hostDomain.route}=hostx&${hostDomain.route}=other&${nestedDomain.route}=wa`);

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push'); // drops hostx
    expect(entriesOf(page, nestedDomain.route)).toEqual(['wa']);

    host.router.reflect(hostDomain.domainId, ['extHost'], 'push'); // drops other
    expect(entriesOf(page, nestedDomain.route)).toEqual([]);
  });

  it('records nothing when navigation is supplied with no occupant value, and registering a domain then does not throw', async () => {
    const page = newPage('/en');
    const host = await connectedRouter();
    const hostDomain = addDomain(host.router, { extHost: 'hostx', extOther: 'other' });
    host.router.startDomain(hostDomain.domainId);
    const { router } = await connectedRouter();
    router.supplyNavigation(() => undefined);
    const nestedDomain = addDomain(router, { nestedExt: 'wa' }, { route: freshRoute('n') });
    page.history.replace(`/en?${hostDomain.route}=hostx&${nestedDomain.route}=wa`);

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push');

    expect(entriesOf(page, nestedDomain.route)).toEqual(['wa']);
  });

  it('records nothing for a router whose navigation was never supplied', async () => {
    const page = newPage('/en');
    const host = await connectedRouter();
    const hostDomain = addDomain(host.router, { extHost: 'hostx', extOther: 'other' });
    host.router.startDomain(hostDomain.domainId);
    const { router } = await connectedRouter();
    const nestedDomain = addDomain(router, { nestedExt: 'wa' }, { route: freshRoute('n') });
    page.history.replace(`/en?${hostDomain.route}=hostx&${nestedDomain.route}=wa`);

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push');

    expect(entriesOf(page, nestedDomain.route)).toEqual(['wa']);
  });

  it('drops the nested key from the record when the nested domain is released', async () => {
    const { page, host, hostDomain, nested } = await nesting(1);
    nested[0].router.releaseDomain(nested[0].rig.domainId);
    page.history.replace(liveUrl(hostDomain.route, nested));

    host.router.reflect(hostDomain.domainId, ['extOther'], 'push');

    expect(entriesOf(page, nested[0].rig.route)).toEqual([nested[0].token]);
  });
});

describe('a command for a domain whose enclosing entry is absent is deferred', () => {
  async function nestedDomain() {
    const page = newPage('/en');
    const { router } = await connectedRouter();
    router.supplyNavigation(() => ({ domainKey: 'host', extension: 'hostx' }));
    const rig = addDomain(router, EXTENSIONS, { route: freshRoute('n') });
    router.startDomain(rig.domainId);
    return { page, ...rig };
  }

  it('writes nothing while the enclosing entry is absent, and issues the write once it is present', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');
    expect(entriesOf(page, route)).toEqual([]);
    expect(writes.push).not.toHaveBeenCalled();

    page.history.replace('/en?host=hostx');

    expect(entriesOf(page, route)).toEqual(['alpha']);
    expect(writes.push).toHaveBeenCalledTimes(1);
  });

  it('keeps a single deferred write: a later command takes the place of the pending one, and push stays push', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');
    router.reflect(domainId, ['extB'], 'push');
    page.history.replace('/en?host=hostx');

    expect(entriesOf(page, route)).toEqual(['beta']);
    expect(writes.push).toHaveBeenCalledTimes(1);
  });

  it('writes the one deferred write with replace if any command it combines carried replace', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');
    router.reflect(domainId, ['extB'], 'replace');
    router.reflect(domainId, ['extC'], 'push');
    page.history.replace('/en?host=hostx');

    expect(entriesOf(page, route)).toEqual(['gamma']);
    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).toHaveBeenCalledTimes(2); // the enclosing entry arriving, and the one deferred write
  });

  it('composes the write against the live URL when it is issued: an equal result writes nothing', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');
    page.history.replace(`/en?host=hostx&${route}=alpha`);

    expect(entriesOf(page, route)).toEqual(['alpha']);
    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).toHaveBeenCalledTimes(1); // the enclosing entry arriving
  });

  it('cancels the deferred write when the domain stops', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    router.reflect(domainId, ['extA'], 'push');
    router.stopDomain(domainId);
    const writes = spyWrites(page);

    page.history.replace('/en?host=hostx');

    expect(entriesOf(page, route)).toEqual([]);
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('cancels the deferred write when the domain is released', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    router.reflect(domainId, ['extA'], 'push');
    router.releaseDomain(domainId);
    const writes = spyWrites(page);

    page.history.replace('/en?host=hostx');

    expect(entriesOf(page, route)).toEqual([]);
    expect(writes.push).not.toHaveBeenCalled();
  });

  it('writes at once when the enclosing entry is already present', async () => {
    const { page, router, domainId, route } = await nestedDomain();
    page.history.replace('/en?host=hostx');
    const writes = spyWrites(page);

    router.reflect(domainId, ['extA'], 'push');

    expect(entriesOf(page, route)).toEqual(['alpha']);
    expect(writes.push).toHaveBeenCalledTimes(1);
  });
});
