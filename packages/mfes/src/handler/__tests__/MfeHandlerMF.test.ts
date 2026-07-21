/**
 * MfeHandlerMF — publicPath resolution guard tests.
 *
 * Covers the "auto" / "auto/" placeholder guard added at
 * @cpt-begin/@cpt-end markers in MfeHandlerMF.ts's
 * `assertResolvedPublicPath`. Module Federation emits `publicPath: "auto"`
 * for any remote whose vite.config.ts does not set an explicit publicPath —
 * that literal string must never reach the fetch layer as a base URL (see
 * MfeHandlerMF.ts header comment: "No remoteEntry.js parsing is required" —
 * this handler has no channel to recover the real origin at runtime, so an
 * unresolved "auto" must fail loudly rather than silently building a bogus
 * same-origin relative URL).
 */
import { describe, expect, it, vi } from 'vitest';
import { MfeHandlerMF } from '../MfeHandlerMF';
import { MfeLoadError } from '../../errors';
import type { MfeEntryMF } from '../../types/mfe-entry-mf';
import type { MfManifest } from '../../manifest/mf-manifest';

function buildManifest(publicPath: string): MfManifest {
  return {
    id: 'gts.frontx.mfes.mfe.mf_manifest.v1~test.manifest.v1',
    name: 'testMfe',
    metaData: {
      name: 'testMfe',
      type: 'app',
      buildInfo: { buildVersion: '1.0.0', buildName: 'testMfe' },
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
      globalName: 'testMfe',
      publicPath,
    },
    shared: [],
  };
}

function buildEntry(manifest: MfManifest): MfeEntryMF {
  return {
    id: 'gts.frontx.mfes.mfe.entry.v1~test.entry.v1',
    requiredProperties: [],
    actions: [],
    domainActions: [],
    manifest,
    exposedModule: './lifecycle',
    exposeAssets: {
      js: { sync: ['assets/lifecycle.js'], async: [] },
      css: { sync: [], async: [] },
    },
  };
}

describe('MfeHandlerMF — unresolved publicPath placeholder guard', () => {
  it.each(['auto', 'auto/'])(
    'rejects manifest.metaData.publicPath === %j with a diagnostic MfeLoadError',
    async (placeholder) => {
      // retries: 0 — the guard's rejection is deterministic and must not be
      // masked by RetryHandler's exponential-backoff retries (default 2
      // retries would add seconds of real delay per assertion here).
      const handler = new MfeHandlerMF('gts.frontx.mfes.mfe.entry.v1~', { retries: 0 });
      const entry = buildEntry(buildManifest(placeholder));

      // Fetch must never be reached — the guard fires before any network
      // access derived from the unresolved baseUrl.
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(
        handler.load(entry, `extension-${placeholder}`)
      ).rejects.toThrow(MfeLoadError);
      await expect(
        handler.load(entry, `extension-${placeholder}-msg`)
      ).rejects.toThrow(/unresolved Module Federation placeholder "auto/);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    }
  );

  it('does not reject a concrete resolved publicPath at the guard step', async () => {
    const handler = new MfeHandlerMF('gts.frontx.mfes.mfe.entry.v1~', { retries: 0 });
    const entry = buildEntry(buildManifest('http://localhost:3099/'));

    // A concrete publicPath passes the guard and proceeds to fetch the
    // (nonexistent, in this unit test) chunk — asserting on the failure
    // mode confirms the guard did NOT reject it as an "auto" placeholder.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('network error for test'));

    await expect(handler.load(entry, 'extension-concrete')).rejects.toThrow(
      MfeLoadError
    );
    await expect(handler.load(entry, 'extension-concrete-2')).rejects.not.toThrow(
      /unresolved Module Federation placeholder/
    );
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3099/assets/lifecycle.js');

    fetchSpy.mockRestore();
  });
});
