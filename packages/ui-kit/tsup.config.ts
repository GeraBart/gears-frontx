import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Listed for the jsx-runtime subpath, which is not a package.json entry
  // tsup would pick up on its own. Everything else stays external without
  // being named here: tsup externalizes package.json `dependencies` and
  // `peerDependencies` by default, so `@base-ui/react` and CVA are import
  // statements in dist/index.js, not inlined code — the only thing this
  // build inlines is the CSS-module class maps (see the loader override
  // below). Don't describe the output as bundling its dependencies; it
  // never has, and toast.md's context-sharing note depends on that being
  // stated correctly.
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  // tsup has no CSS Modules support of its own: its postcss plugin re-emits
  // every .css with `loader['.css'] ?? 'css'`, which yields an empty class map.
  // Overriding the loader to esbuild's native 'local-css' turns every
  // JS-imported stylesheet into a CSS module (hashed names + exported map).
  // Convention this relies on: JS imports only *.module.css files; global CSS
  // (theme.css) is copied in onSuccess, not imported.
  loader: {
    '.css': 'local-css',
  },
  // Design tokens are plain CSS (not a module) and must survive as a separate
  // consumer-importable file — tsup only emits CSS that JS imports. The
  // per-component usage docs ship under dist/docs/ so agents can read them
  // from node_modules via llms.txt.
  onSuccess: 'cp src/styles/theme.css dist/theme.css && mkdir -p dist/docs && cp src/components/*/*.md dist/docs/',
});
