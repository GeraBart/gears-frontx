/**
 * Builds the source text for a per-load `__frontx_lazy` loader stub module,
 * and names the URL schemes the trust kernel treats as inline content.
 *
 * Held in its own module, separate from `mf-dynamic-module-ops.ts` and
 * `MfeHandlerMF.ts`: both `importBlobModule`'s own runtime guard and the
 * generated stub's own scheme guard read the SAME scheme list from
 * {@link LazyLoaderStubBuilder.inlineContentSchemes} rather than each
 * hardcoding `'blob:'`/`'data:'` independently, so the two guards cannot
 * drift apart the way two hand-copied literals could.
 *
 * Stateless — every method is a pure function of its arguments — but
 * exposed as instance methods behind an object each consumer holds, rather
 * than a static-only namespace: a substitutable collaborator, not a bag of
 * global functions. `MfeHandlerMF` holds one such instance as a private
 * field, defaulted internally so its own public constructor stays
 * unchanged. The audited trust kernel (`mf-dynamic-module-ops.ts`, plain
 * exported functions rather than a class) constructs its own instance
 * locally, inside the one function that needs it, rather than holding it
 * as module-level state — that file's own invariant permits only pure
 * function declarations at the top level.
 *
 * @packageDocumentation
 * @internal
 */
export class LazyLoaderStubBuilder {
  /**
   * The URL schemes the trust kernel treats as inline content — never
   * network-addressed, so importing one carries no cross-origin/user-input
   * risk. `importBlobModule`'s own runtime guard and the scheme guard
   * {@link LazyLoaderStubBuilder.build} generates into the lazy-loader stub
   * both read THIS list rather than each hardcoding `'blob:'`/`'data:'`
   * independently, so the two guards cannot drift apart the way two
   * hand-copied literals could: adding, removing, or renaming a scheme here
   * changes both checks at once instead of requiring a second edit someone
   * could forget.
   *
   * @safety-reviewed 2026-09-22
   * @why Returns a fresh array of two hardcoded string literals on every
   *      call — no interpolation, no external input, nothing that could vary
   *      at runtime or be influenced by a caller. This method performs no
   *      dynamic-code admission itself; it exists only so the two real
   *      guards share one source of truth instead of duplicating this list
   *      by hand.
   */
  inlineContentSchemes(): readonly string[] {
    return ['blob:', 'data:'];
  }

  /**
   * Build the source text for a per-load `__frontx_lazy` loader stub module.
   * The stub is a tiny ESM module, blob-URL'd by the caller, that re-exports a
   * `__frontx_lazy` function closed over `loaderId`; vendor chunks transformed
   * by the ADR-0022 build plugin import this binding to resolve lazy chunks
   * through the host-side {@link LazyLoaderRegistry} without threading the
   * resolver id through every call site.
   *
   * This text contains the substring `import(u)`, but only as characters
   * inside a string this method returns — it is never parsed as source by
   * this file, so it is not itself a dynamic-`import()` call site here. It
   * becomes one only once the caller blob-URLs it and passes that URL to
   * `importBlobModule` (`mf-dynamic-module-ops.ts`), which is the trust
   * kernel's sole real import() call site — keeping stub-source generation
   * here (rather than at the call site in `MfeHandlerMF`) is what keeps that
   * "sole site" claim true: the only place in this codebase that ever
   * writes the literal text `import(` into dynamically-evaluated source is
   * that file.
   *
   * @safety-reviewed 2026-09-22
   * @why `loaderId` is embedded only after `JSON.stringify`, which escapes
   *      every character that could break out of the string-literal position
   *      it is interpolated into — the same escaping argument
   *      `bareSpecifierPattern` makes for RegExp construction, applied here to
   *      string-literal construction instead. `loaderId` itself is minted by
   *      `LazyLoaderRegistry.register` (an in-process counter-backed id), not
   *      user input. The `u` the stub resolves at runtime is never embedded in
   *      this text — it is fetched at call time from
   *      `globalThis.__FRONTX_LAZY__.resolve`. The generated stub does not
   *      merely trust that resolver to return inline content: the guard
   *      condition below is GENERATED from
   *      {@link LazyLoaderStubBuilder.inlineContentSchemes} (the same list
   *      `importBlobModule` reads its own guard from), one
   *      `u.startsWith(...)` clause per scheme, rather than hand-writing
   *      `'blob:'`/`'data:'` a second time — so the two guards cannot drift
   *      apart the way two independently maintained literals could; a change
   *      to the shared list changes both checks in the same edit. A resolver
   *      defect that ever returned a non-inline-content URL (e.g. an
   *      `http:`/`file:` path) fails this generated check with a `TypeError`
   *      instead of the stub silently importing it.
   * @inputs `loaderId` is an id minted by `LazyLoaderRegistry.register` — an
   *         in-process identifier, not user input. The generated stub's `u` is
   *         runtime-guarded against the same scheme list `importBlobModule`
   *         guards `blobUrl` against.
   */
  // @cpt-algo:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1
  build(loaderId: string): string {
    // @cpt-begin:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-build-stub-source
    const schemeCheck = this.inlineContentSchemes()
      .map((scheme) => `u.startsWith(${JSON.stringify(scheme)})`)
      .join('||');
    return (
      `const __id=${JSON.stringify(loaderId)};\n` +
      `export const __frontx_lazy=async(p)=>{` +
      `const u=await globalThis.__FRONTX_LAZY__.resolve(__id,p);` +
      `if(!(${schemeCheck}))throw new TypeError('__frontx_lazy resolved a non-inline-content URL: '+u);` +
      `return import(u);` +
      `};\n`
    );
    // @cpt-end:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-build-stub-source
  }
}
