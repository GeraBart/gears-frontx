import fs from 'node:fs';
import path from 'node:path';
import nodeExternals from 'rollup-plugin-node-externals';
import type { Plugin, PluginOption, UserConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { libInjectCss } from 'vite-plugin-lib-inject-css';

/**
 * Vite library-mode build: one entry per component (globbed from
 * src/components/*'/public.ts) plus the src/index.ts barrel, each emitting
 * its own JS chunk and — via libInjectCss — its own CSS. This is what lets a
 * consumer's bundler drop both the JS and the CSS of any component it never
 * imports, including through the barrel (see src/index.ts's comment). Modeled
 * on Constructor's internal react-kit (scripts/buildPlugin.ts there); see
 * design-notes.md's Architecture section for what carries over and what
 * doesn't.
 */
export function buildPlugin(): PluginOption[] {
  return [
    // Externalizes `dependencies`/`peerDependencies` (@base-ui/react, CVA,
    // react, react-dom, and subpaths like react/jsx-runtime) instead of
    // tsup's hand-maintained `external` array — anything not declared as a
    // dependency gets inlined, anything declared stays an import statement.
    nodeExternals(),
    // Vite's lib mode emits each entry's CSS as a plain asset but does not
    // wire it back into that entry's JS — there's no HTML entry to do it via
    // <link>, unlike a normal app build. This plugin rewrites each chunk to
    // `import './chunk.css'` when Vite extracted CSS from that chunk's
    // module graph, which is what makes per-entry (not per-package) CSS
    // possible at all.
    libInjectCss(),
    buildEntries(),
    dts({
      outDir: 'dist',
      entryRoot: 'src',
      // tsconfig.json already excludes *.test.ts(x) and sets rootDir/outDir/
      // declaration for this package (see tsconfig.json) — no separate build
      // tsconfig needed, unlike react-kit's tsconfig.build.json, because this
      // package has no dev-server/Storybook config sharing tsconfig.json
      // with incompatible settings.
      tsconfigPath: 'tsconfig.json',
      // *.test.*/*.spec.* keep test files themselves out of dist/; separately,
      // __test-utils__ (vitest setup, not a build entry, not test-file-named)
      // isn't caught by that pattern and shipped in the tarball until this was
      // added — glob it out explicitly rather than letting the exclude list's
      // apparent coverage stay incomplete.
      exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/__test-utils__/**'],
      afterBuild,
    }),
  ];

  /**
   * vite-plugin-dts mirrors source layout under dist/ (a component's types
   * land at dist/components/<name>/public.d.ts, next to where its .tsx
   * source lived). The `./*` wildcard export needs a flat dist/<name>.d.ts
   * per component, matching the flat dist/<name>.js chunk emitted for that
   * same entry — write that one-line re-export shim here, the same trick
   * react-kit's buildPlugin.ts uses for its own (deeper) entries/ layout.
   */
  function afterBuild(emittedFiles: Map<string, string>) {
    const distDir = path.resolve('dist');

    for (const filename of Array.from(emittedFiles.keys())) {
      if (!filename.endsWith('/public.d.ts')) {
        continue;
      }

      const entryPath = path.relative(distDir, filename);
      // Explicit .js extension: this specifier lands verbatim in a shipped
      // .d.ts, and moduleResolution: "nodenext" (unlike our own "bundler")
      // rejects an extensionless relative specifier in ESM declarations —
      // every symbol goes invisible under nodenext without it. See the same
      // note on src/index.ts, which needed the identical fix.
      const content = `export * from './${entryPath.replace(/\.d\.ts$/, '.js')}'`;
      const entryName = entryPath.replace(/^components\//, '').replace(/\/public\.d\.ts$/, '');

      fs.writeFileSync(path.resolve(distDir, `${entryName}.d.ts`), content, 'utf-8');
    }
  }

  function buildEntries(): Plugin {
    return {
      name: 'ui-kit-build-entries',
      apply: 'build',
      config() {
        return getBuildConfig();
      },
      closeBundle(error) {
        if (error) {
          return;
        }

        // Design tokens are plain CSS (not a module) and must ship as a
        // separate, consumer-importable file — Vite's lib build only emits
        // CSS that JS actually imports, and theme.css is deliberately never
        // imported by JS (see design-notes.md's Architecture section). The
        // per-component usage docs ship under dist/docs/ so agents can read
        // them from node_modules via llms.txt.
        fs.copyFileSync('src/styles/theme.css', 'dist/theme.css');
        fs.mkdirSync('dist/docs', { recursive: true });
        for (const file of fs.globSync('src/components/*/*.md')) {
          fs.copyFileSync(file, path.join('dist/docs', path.basename(file)));
        }
      },
    };
  }

  function getBuildConfig(): UserConfig {
    const entries = fs
      .globSync('src/components/*/public.ts')
      .map((file) => [path.basename(path.dirname(file)), file]);

    return {
      build: {
        sourcemap: true,
        lib: {
          entry: {
            index: 'src/index.ts',
            ...Object.fromEntries(entries),
          },
          formats: ['es'],
        },
        rollupOptions: {
          // Only CSS is presumed to have side effects. This is NOT what
          // splits components into their own chunks — that comes from
          // having one lib.entry per component regardless of this option;
          // measured directly (build with this option removed): Rollup
          // still emits one physical chunk per component, just behind an
          // extra 2-line re-export shim (dist/button.js becomes
          // `export { B as Button } from "./chunks/button.js"` instead of
          // containing Button's code itself), and the consumer-facing
          // bundle is unchanged. What this option actually buys: it
          // flattens that indirection away, so a component's code lands
          // directly in dist/<name>.js — which is what the `./*` export and
          // verify-consumer.sh's hashed-class probes (which grep
          // dist/<name>.js directly, not a chunks/ subpath) depend on. See
          // package.json's `sideEffects` for the shipped-side counterpart of
          // the same CSS-only-side-effects policy.
          treeshake: {
            moduleSideEffects: (id) => id.endsWith('.css'),
          },
          output: {
            chunkFileNames: 'chunks/[name].js',
            assetFileNames: 'chunks/[name].[hash][extname]',
          },
        },
      },
    };
  }
}
