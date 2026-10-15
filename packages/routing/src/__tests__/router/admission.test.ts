import { afterEach, describe, expect, it } from 'vitest';
import { addDomain, cleanupRouters, connectedRouter, entriesOf, freshRoute, mountChain, newPage, userNavigates } from './harness.js';

// FEATURE route-ownership-signal §3, Router Admission And Lifecycle
// (`cpt-frontx-algo-routing-route-ownership-signal-router-admission`), §1.5
// Router members, DESIGN §2.3 O1, O3a, O3b, and the DoD "Router Admission".

afterEach(cleanupRouters);

describe('registerDomain — admission of a routed domain', () => {
  it.each(['Bad', '1x', 'a b', 'a.b', ''])('rejects the invalid route %j with a throw', async (route) => {
    const { router } = await connectedRouter();
    expect(() => router.registerDomain(`id-${freshRoute()}`, route, true)).toThrow();
  });

  it('never partly admits a rejected domain: nothing is assigned for it, and the same id can register with a valid route afterwards', async () => {
    const { router } = await connectedRouter();
    const domainId = `id-${freshRoute()}`;
    expect(() => router.registerDomain(domainId, 'Bad', true)).toThrow();
    router.registerExtension('extA', domainId, 'alpha');
    expect(router.assignOccupantValue(domainId, 'extA')).toBeUndefined();

    const route = freshRoute();
    router.registerDomain(domainId, route, true);
    router.registerExtension('extA', domainId, 'alpha');
    expect(router.assignOccupantValue(domainId, 'extA')).toEqual({ domainKey: route, extension: 'alpha' });
    router.releaseDomain(domainId);
  });

  it('rejects a route another routed domain live in the page already holds', async () => {
    const { router } = await connectedRouter();
    const { route } = addDomain(router, {});
    expect(() => router.registerDomain(`id-other-${route}`, route, true)).toThrow();
  });

  it('rejects a second registration of the same domain id with its held route: a held route is a duplicate', async () => {
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: 'alpha' });

    expect(() => router.registerDomain(domainId, route, false)).toThrow();
    expect(router.assignOccupantValue(domainId, 'extA')).toEqual({ domainKey: route, extension: 'alpha' });
  });

  it('holds routes page-wide: a router instance of another runtime is refused a route the first instance holds', async () => {
    const first = await connectedRouter();
    const { route } = addDomain(first.router, {});
    const second = await connectedRouter();

    expect(() => second.router.registerDomain(`id-second-${route}`, route, true)).toThrow();
  });

  it('frees the route on releaseDomain, so another domain may take it', async () => {
    const first = await connectedRouter();
    const { route, domainId } = addDomain(first.router, {});
    first.router.releaseDomain(domainId);
    const second = await connectedRouter();

    expect(() => addDomain(second.router, {}, { route })).not.toThrow();
  });

  it('refuses a registered duplicate even when the first holder has not started observing', async () => {
    const { router } = await connectedRouter();
    const route = freshRoute();
    router.registerDomain('id-one', route, false);
    expect(() => router.registerDomain('id-two', route, false)).toThrow();
    router.releaseDomain('id-one');
  });
});

describe('registerExtension — admission of an extension in a routed domain', () => {
  it('ignores an extension of a domain it did not admit, even when the extension route is invalid', async () => {
    const { router } = await connectedRouter();
    expect(() => router.registerExtension('extA', 'unknown-domain', 'Not A Name')).not.toThrow();
    expect(router.assignOccupantValue('unknown-domain', 'extA')).toBeUndefined();
  });

  it('ignores an extension of a domain whose registration was rejected', async () => {
    const { router } = await connectedRouter();
    expect(() => router.registerDomain('id-rejected', 'Bad', true)).toThrow();
    expect(() => router.registerExtension('extA', 'id-rejected', 'alpha')).not.toThrow();
    expect(router.assignOccupantValue('id-rejected', 'extA')).toBeUndefined();
  });

  it.each(['Not A Name', '', '/', '9lives', 'a_b'])('rejects the route %j, which reduces to no valid name, with a throw', async (extensionRoute) => {
    const { router } = await connectedRouter();
    const { domainId } = addDomain(router, {});
    expect(() => router.registerExtension('extA', domainId, extensionRoute)).toThrow();
    expect(router.assignOccupantValue(domainId, 'extA')).toBeUndefined();
  });

  it('derives the name by stripping one leading slash from the route', async () => {
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: '/alpha' });
    expect(router.assignOccupantValue(domainId, 'extA')).toEqual({ domainKey: route, extension: 'alpha' });
  });

  it('rejects a second extension whose name equals one already admitted in the same domain', async () => {
    const { router } = await connectedRouter();
    const { domainId } = addDomain(router, { extA: 'alpha' });
    expect(() => router.registerExtension('extB', domainId, 'alpha')).toThrow();
    expect(router.assignOccupantValue(domainId, 'extB')).toBeUndefined();
  });

  it('allows the same name in two different domains', async () => {
    const { router } = await connectedRouter();
    const first = addDomain(router, { extA: 'alpha' });
    expect(() => addDomain(router, { extB: 'alpha' })).not.toThrow();
    expect(router.assignOccupantValue(first.domainId, 'extA')?.extension).toBe('alpha');
  });

  it('frees the name on releaseExtension, so another extension may take it', async () => {
    const { router } = await connectedRouter();
    const { domainId } = addDomain(router, { extA: 'alpha' });
    router.releaseExtension('extA');
    expect(() => router.registerExtension('extB', domainId, 'alpha')).not.toThrow();
  });
});

describe('assignOccupantValue — the value an extension carries at mount', () => {
  it('returns the domain route and the extension name, with no ancestor', async () => {
    const { router } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: 'alpha' });
    expect(router.assignOccupantValue(domainId, 'extA')).toStrictEqual({ domainKey: route, extension: 'alpha' });
  });

  it('returns undefined for a domain that was not admitted', async () => {
    const { router } = await connectedRouter();
    expect(router.assignOccupantValue('no-such-domain', 'extA')).toBeUndefined();
  });

  it('returns undefined for an extension that was not admitted in that domain', async () => {
    const { router } = await connectedRouter();
    const first = addDomain(router, { extA: 'alpha' });
    const second = addDomain(router, { extB: 'beta' });
    expect(router.assignOccupantValue(first.domainId, 'no-such-extension')).toBeUndefined();
    expect(router.assignOccupantValue(first.domainId, 'extB')).toBeUndefined();
    expect(router.assignOccupantValue(second.domainId, 'extA')).toBeUndefined();
  });

  it('returns undefined once the domain or the extension is released', async () => {
    const { router } = await connectedRouter();
    const { domainId } = addDomain(router, { extA: 'alpha', extB: 'beta' });
    router.releaseExtension('extA');
    expect(router.assignOccupantValue(domainId, 'extA')).toBeUndefined();
    router.releaseDomain(domainId);
    expect(router.assignOccupantValue(domainId, 'extB')).toBeUndefined();
  });
});

describe('ownEntryAddress — the runtime entry address (inst-admission-keep-reader)', () => {
  it('returns the runtime own occupant value, once validated, in a routed extension runtime', async () => {
    const { router } = await connectedRouter();
    router.supplyNavigation(() => ({ domainKey: 'screen', extension: 'tenants' }));
    expect(router.ownEntryAddress()).toEqual({ domainKey: 'screen', extension: 'tenants' });
  });

  it('returns undefined in the shell runtime, whose router was never supplied navigation', async () => {
    const { router } = await connectedRouter();
    expect(router.ownEntryAddress()).toBeUndefined();
  });

  it('throws in an extension runtime supplied navigation whose reader yields no value', async () => {
    const { router } = await connectedRouter();
    router.supplyNavigation(() => undefined);
    expect(() => router.ownEntryAddress()).toThrow();
  });

  it('throws when the reader yields a value that is no occupant value', async () => {
    const { router } = await connectedRouter();
    router.supplyNavigation(() => ({ domainKey: 'screen' }));
    expect(() => router.ownEntryAddress()).toThrow();
  });

  it('never throws from registerDomain because of a missing occupant value: the router reads its own value, not ownEntryAddress', async () => {
    const { router } = await connectedRouter();
    router.supplyNavigation(() => undefined);
    expect(() => addDomain(router, { extA: 'alpha' })).not.toThrow();
    expect(() => router.ownEntryAddress()).toThrow();
  });
});

describe('startDomain and stopDomain — the domain observer', () => {
  it('startDomain starts the observer: the address the page carries resolves at once and a later back step is observed', async () => {
    const page = newPage('/en?x=y');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: 'alpha', extB: 'beta' });
    page.history.replace(`/en?${route}=alpha`);

    router.startDomain(domainId);
    expect(sent.chains).toEqual([mountChain(domainId, 'extA')]);

    await userNavigates(page, `/en?${route}=alpha&${route}=beta`);
    expect(sent.chains).toEqual([
      mountChain(domainId, 'extA'),
      mountChain(domainId, 'extA'),
      mountChain(domainId, 'extB'),
    ]);
  });

  it('a second startDomain reuses the running observer: one back step produces one mount chain, not two', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: 'alpha' });
    router.startDomain(domainId);
    router.startDomain(domainId);

    await userNavigates(page, `/en?${route}=alpha`);

    expect(sent.chains).toEqual([mountChain(domainId, 'extA')]);
  });

  it('stopDomain stops the observer: a later back step sends nothing', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: 'alpha' });
    router.startDomain(domainId);
    router.stopDomain(domainId);

    await userNavigates(page, `/en?${route}=alpha`);

    expect(sent.chains).toEqual([]);
    expect(entriesOf(page, route)).toEqual(['alpha']);
  });

  it('startDomain and stopDomain for a domain that was not admitted do nothing and do not throw', async () => {
    newPage('/en');
    const { router, sent } = await connectedRouter();
    expect(() => router.startDomain('no-such-domain')).not.toThrow();
    expect(() => router.stopDomain('no-such-domain')).not.toThrow();
    expect(sent.chains).toEqual([]);
  });

  it('releaseDomain stops the domain observer', async () => {
    const page = newPage('/en');
    const { router, sent } = await connectedRouter();
    const { domainId, route } = addDomain(router, { extA: 'alpha' });
    router.startDomain(domainId);
    router.releaseDomain(domainId);

    await userNavigates(page, `/en?${route}=alpha`);

    expect(sent.chains).toEqual([]);
  });
});
