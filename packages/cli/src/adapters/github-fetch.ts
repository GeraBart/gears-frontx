// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import os from 'node:os';
import path from 'node:path';
import type { FetchFn } from '../resolver/types';

// Real network `FetchFn` implementation — the source-registry actor
// (`cpt-frontx-actor-github`) this package fetches template content from at
// install (`inst-resolve-fetch`) and bounded local-update
// (`inst-bupd-fetch`) time. Given the fetch address the pure-logic resolver
// already built (`resolveToInventory`'s `buildFetchUrl`,
// `cpt-frontx-algo-template-resolution-resolve-to-inventory` inst-resolve-addr),
// this adapter performs the actual HTTP GET against the GitHub source
// registry and returns the response body as the opaque content string the
// `FetchFn` seam contract already defines (`packages/cli/src/resolver/types.ts`)
// — no change to that seam's signature is required. Pure-logic core
// (`resolver/resolve.ts`, `inventory/TemplateInventory.ts`) is untouched;
// this file is the IO-only realization plugged in behind the same
// injected seam.
export interface GithubFetchOptions {
  /** Optional bearer token for authenticated requests against private repos / higher rate limits. */
  token?: string;
  /** Injectable fetch implementation — defaults to the platform global `fetch`. Enables deterministic tests. */
  fetchImpl?: typeof fetch;
  /** Extra headers merged into every request (e.g. Accept override). */
  headers?: Record<string, string>;
}

export function createGithubFetchFn(options: GithubFetchOptions = {}): FetchFn {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function githubFetch(url: string): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent': '@gears-frontx/cli',
      Accept: 'application/vnd.github+json',
      ...options.headers,
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    // @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch
    // @cpt-begin:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(
        `GitHub fetch failed for "${url}": ${response.status} ${response.statusText}`,
      );
    }
    return await response.text();
    // @cpt-end:cpt-frontx-algo-template-resolution-bounded-update:p1:inst-bupd-fetch
    // @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-fetch
  };
}

// Inventory-root path resolution — the local inventory store root
// (`cpt-frontx-adr-template-acquisition-and-location`) that
// `resolveInstalledContentPath` (`fs-installed-content-path.ts`) resolves
// every installed template's on-disk path relative to. Not itself a
// CDSL-designated instruction (like `resolveInstalledContentPath`, it carries
// no @cpt-begin/@cpt-end marker of its own), but the IO-only decision this
// phase must supply: where the tracked local inventory lives on disk.
//
// Precedence: an explicit `FRONTX_INVENTORY_ROOT` override — resolved against
// `cwd` when given as a relative path — takes precedence over the default
// per-user home-directory location (`~/.frontx/inventory`), so a developer or
// CI job can redirect the inventory into a project-local or ephemeral
// directory without changing any calling code.
export interface ResolveInventoryRootOptions {
  cwd?: string;
  env?: Partial<Record<string, string | undefined>>;
}

export function resolveInventoryRoot(options: ResolveInventoryRootOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.FRONTX_INVENTORY_ROOT;
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(options.cwd ?? process.cwd(), override);
  }
  return path.join(os.homedir(), '.frontx', 'inventory');
}
