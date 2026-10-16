// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowHistoryAdapter } from '../../history/adapter.js';

// nav FEATURE (navigation-substrate) §3, Fan-Out Subscription Dispatch,
// `inst-write-own-origin`: a path whose pathname begins with `//` is written
// as a location of the page's own origin, never read as another host. jsdom
// enforces the same-origin rule on `pushState`/`replaceState`, so a
// protocol-relative write throws here exactly as a browser refuses it.

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('createWindowHistoryAdapter — own-origin writes', () => {
  it('a path with a single leading / is written unchanged', () => {
    const adapter = createWindowHistoryAdapter();
    const spy = vi.spyOn(window.history, 'pushState');

    adapter.pushState('/fr?screen=a', { position: 1 });

    expect(spy).toHaveBeenCalledWith({ position: 1 }, '', '/fr?screen=a');
    expect(window.location.pathname).toBe('/fr');
    spy.mockRestore();
  });

  it('pushState keeps a pathname beginning with // exactly as serialized', () => {
    const adapter = createWindowHistoryAdapter();

    expect(() => adapter.pushState('//foo?screen=a#h', { position: 1 })).not.toThrow();

    expect(window.location.origin).toBe('http://localhost:3000');
    expect(window.location.pathname).toBe('//foo');
    expect(window.location.search).toBe('?screen=a');
    expect(window.location.hash).toBe('#h');
  });

  it('replaceState keeps a pathname beginning with // exactly as serialized', () => {
    const adapter = createWindowHistoryAdapter();

    expect(() => adapter.replaceState('//foo/bar', { position: 0 })).not.toThrow();

    expect(window.location.pathname).toBe('//foo/bar');
    expect(adapter.getLocation().path).toBe('//foo/bar');
  });
});
