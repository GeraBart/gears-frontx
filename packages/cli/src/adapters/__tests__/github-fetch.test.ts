// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createGithubFetchFn, resolveInventoryRoot } from '../github-fetch';
import { parseSourceSpec } from '../../spec-parser/parse';
import { resolveToInventory } from '../../resolver/resolve';

describe('createGithubFetchFn', () => {
  // inst-resolve-fetch / inst-resolve-addr — real fetch against the source
  // registry (cpt-frontx-actor-github) at the resolved ref, end-to-end
  // through parseSourceSpec -> resolveToInventory -> the real FetchFn.
  it('(a) fetches template content from the source registry at the resolved ref — happy path', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('tarball-bytes-as-text', { status: 200, statusText: 'OK' }),
    ) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    const parsed = parseSourceSpec('github:acme/my-template@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory(parsed.value, fetchFn);

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.content).toBe('tarball-bytes-as-text');
      expect(resolved.value.name).toBe('my-template');
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/my-template/tarball/v1.0.0',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  // inst-resolve-fetch-fail / inst-bupd-fetch-fail — rejection/error case:
  // the source registry returns a non-OK status; the real FetchFn throws so
  // the resolver reports a resolution error and writes nothing.
  it('(b) rejects when the source registry responds with a non-OK status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not found', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;

    const fetchFn = createGithubFetchFn({ fetchImpl });

    await expect(fetchFn('https://api.github.com/repos/acme/missing/tarball/v1.0.0')).rejects.toThrow(
      /404/,
    );

    const parsed = parseSourceSpec('github:acme/missing@v1.0.0');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const resolved = await resolveToInventory(parsed.value, fetchFn);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.message).toContain('Failed to fetch template from registry');
    }
  });

  it('(c) attaches an Authorization header when a token is supplied', async () => {
    const fetchImpl = vi.fn(async () => new Response('content', { status: 200 })) as unknown as typeof fetch;
    const fetchFn = createGithubFetchFn({ fetchImpl, token: 'abc123' });

    await fetchFn('https://api.github.com/repos/acme/my-template/tarball/v1.0.0');

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc123' }) }),
    );
  });
});

describe('resolveInventoryRoot', () => {
  // Inventory-root path resolution — homedir default vs cwd-relative override.
  it('(a) defaults to ~/.frontx/inventory under the user home directory', () => {
    const result = resolveInventoryRoot({ env: {} });
    expect(result).toBe(path.join(os.homedir(), '.frontx', 'inventory'));
  });

  it('(b) resolves a relative FRONTX_INVENTORY_ROOT override against the given cwd', () => {
    const result = resolveInventoryRoot({
      cwd: '/workspace/project',
      env: { FRONTX_INVENTORY_ROOT: '.frontx-inventory' },
    });
    expect(result).toBe(path.resolve('/workspace/project', '.frontx-inventory'));
  });

  it('(c) uses an absolute FRONTX_INVENTORY_ROOT override verbatim, ignoring cwd', () => {
    const result = resolveInventoryRoot({
      cwd: '/workspace/project',
      env: { FRONTX_INVENTORY_ROOT: '/custom/inventory-root' },
    });
    expect(result).toBe('/custom/inventory-root');
  });
});
