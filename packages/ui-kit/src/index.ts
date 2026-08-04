/**
 * @gears-frontx/ui-kit — standard component base for Constructor Fabric
 * templates.
 *
 * Styles ship separately: import '@gears-frontx/ui-kit/theme.css' (design
 * tokens) once in the consumer entry module. Component CSS ships alongside
 * each component's own chunk (see vite.config.ts / scripts/buildPlugin.ts)
 * and needs no separate import — importing a component pulls its styles in
 * with it.
 *
 * This barrel re-exports every component's public.ts rather than declaring
 * exports itself. Each public.ts is also its own build entry (globbed in
 * scripts/buildPlugin.ts), so `export * from './components/x/public'` here
 * re-exports an already-separate chunk instead of inlining one — that's what
 * keeps this barrel tree-shakeable: a consumer importing only `Button` gets
 * a thin dist/index.js that re-exports dist/button.js and 18 sibling chunks
 * it never touches, and their bundler can drop the ones it never imports.
 *
 * Relative specifiers below carry an explicit `.js` extension even though
 * the source files are `.ts` — required because this flows straight into
 * the emitted `dist/index.d.ts`, and a consumer building under
 * `moduleResolution: "nodenext"` rejects extensionless relative specifiers
 * in an ESM package's declarations (TS2305, every symbol invisible). The
 * `.js` specifier still resolves to the local `.ts` file under our own
 * `moduleResolution: "bundler"` (and under Vite/vitest, which special-case
 * a `.js` specifier resolving to a sibling `.ts`/`.tsx`) — it is not a
 * claim that a `.js` file exists here.
 */
export * from './components/badge/public.js';
export * from './components/button/public.js';
export * from './components/card/public.js';
export * from './components/checkbox/public.js';
export * from './components/dialog/public.js';
export * from './components/dropdown-menu/public.js';
export * from './components/field/public.js';
export * from './components/input/public.js';
export * from './components/label/public.js';
export * from './components/radio-group/public.js';
export * from './components/select/public.js';
export * from './components/separator/public.js';
export * from './components/skeleton/public.js';
export * from './components/switch/public.js';
export * from './components/table/public.js';
export * from './components/tabs/public.js';
export * from './components/textarea/public.js';
export * from './components/toast/public.js';
export * from './components/tooltip/public.js';
