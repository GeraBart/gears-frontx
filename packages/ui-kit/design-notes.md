# UI Kit — Design

Status: in development (MVP)
Repo-doc only, not published with the package. Backing CDSL artifacts (PRD
requirement, DESIGN component, FEATURE) are planned; until they land the
package is covered by an `[[ignore]]` entry in `.cf-studio/config/artifacts.toml`
(same interim state as `@gears-frontx/telemetry`).

> **History.** The kit was designed and prototyped in the now-retired gears-web
> repository (issue gears-web#7): first as a shadcn-style source registry, then
> as an npm package, with the styling stack settled by the architects as
> **CSS Modules instead of Tailwind** and **Base UI instead of Radix**. The
> tsup + CSS Modules pipeline and the Button prototype were proven there and
> moved here as gears-web was decommissioned. Where published runtime libraries
> live in the FrontX architecture is tracked by #495.

## Problem

Front-end templates in the Constructor Fabric ecosystem — from which FrontX and
Studio assemble interfaces — each build their UI layer from scratch. There is no
standard component base for templates, and nothing AI agents can rely on to
generate screens consistently.

## Goals

- A curated set of React components covering a typical admin application.
- The **standard component base for FrontX templates**: one version everywhere,
  fixes and design updates propagate via a dependency bump.
- Self-contained styling: the package ships its own compiled CSS; consumers
  need no CSS framework, preprocessor, or build plugins.
- AI-ready: agents generate screens from the kit using its bundled docs.
- Curate, don't write: behavior comes from Base UI (headless, tested upstream);
  styles are authored as CSS Modules, translated from shadcn/ui's design.

## Non-goals (MVP)

- White-label theming APIs. Basic branding = overriding CSS-variable tokens;
  deep customization = fork the kit or build the template on another kit.
- Framework-agnostic components (React is a hard requirement).
- `data-table`, date-picker, charts, page layout templates, form validation
  integration (RHF/zod), i18n helpers, Storybook.

`insight-front` uses shadcn's `calendar`, `chart` and `sidebar`, and the kit
will not cover them — a known gap, not an oversight. `calendar` (date-picker)
needs `react-day-picker` + `date-fns` and `chart` (charts) needs `recharts`, so
both fall to the architecture's "behavior from Base UI, no extra runtime deps"
rule. `sidebar` (page layout templates) adds no dependencies but is a large
composite over `sheet`, `button`, `input`, `separator`, `skeleton` and
`tooltip` plus a mobile-detection hook: app layout, not a base component.

The F-mockups draw larger blocks too — Sidebar Navigation, Top Bar / Page
Header, an App Shell, a Data Table with toolbar, bulk-selection bar and row
states, and the Studio AI cards. Those frames are titled "MVP Building
blocks / shadcn compositions" in the design file itself: compositions over
kit primitives, not kit components. They stay with consumers/templates, and
the kit's contribution is composition recipes (see AI layer) — which keeps
the `sidebar` / `data-table` exclusions above intact.

## Architecture

- Component stack: **React 19 + Base UI (`@base-ui/react`) + CSS Modules + CVA**.
- Build: **Vite library mode**, ESM only (no CJS build). One entry per
  component — `src/components/<name>/public.ts`, globbed — plus the
  `src/index.ts` barrel, mirroring Constructor's internal react-kit
  (`scripts/buildPlugin.ts` there) rather than tsup's single-entry bundle.
  Per-entry splitting is what makes the kit tree-shakeable at both the JS and
  CSS level, *including through the barrel*: each entry compiles to its own
  `dist/<name>.js` + `dist/<name>.d.ts` (`vite-plugin-dts`, with a small
  `afterBuild` hook writing the flat `dist/<name>.d.ts` a consumer's `./*`
  subpath import resolves to — see `scripts/buildPlugin.ts`) and its own CSS
  chunk (`vite-plugin-lib-inject-css`); `dist/index.js` only re-exports those
  already-separate files, so a consumer's bundler can drop the ones it never
  imports rather than receiving one bundle with everything inlined.
  `rollup-plugin-node-externals` externalizes `dependencies`/
  `peerDependencies` (`@base-ui/react`, CVA, react, react-dom and subpaths
  like `react/jsx-runtime`) in place of tsup's hand-maintained `external`
  array. CSS Modules support is native to Vite — the esbuild `local-css`
  loader override tsup needed (and the fragile convention its comment
  documented, that JS may only import `*.module.css`) is gone.
- CSS pipeline: per-component `*.module.css`, each compiled to its own CSS
  chunk and auto-imported by that component's JS chunk
  (`vite-plugin-lib-inject-css`) — no combined stylesheet, no `./styles.css`
  export; importing a component's JS is what pulls in its CSS. Design tokens
  remain a plain-CSS file (`./theme.css` export), hand-copied into `dist/` at
  build, unchanged: Vite's lib build only emits CSS reachable from a JS
  import, and theme.css is deliberately never imported by JS. A consumer
  imports `theme.css` once; component CSS then arrives for free with each
  component import. No PostCSS/Tailwind requirements on either side.
- Theme: semantic CSS variables (colors, spacing, radii, control metrics),
  light/dark via `data-theme` / `prefers-color-scheme`; shadcn-style token
  structure carrying the Studio palette from the F-mockups Figma file
  (variable collection "Studio / shadcn"). Component CSS
  consumes only these variables — the theme file is the single seam between
  kit styles and consumer brand. The theme file also paints the page surface
  itself (`body`/`[data-theme]` background and color, plus `color-scheme`),
  not just the tokens: a bare consumer page goes correctly dark under
  `prefers-color-scheme` with no attribute and no CSS of its own.
- Publishing: version-gated like every ecosystem package. `private: true`
  remains in place until both the MVP component set lands and #495 approves
  the package's architecture ownership, traceability, and version policy. The
  required CDSL artifacts must then replace the temporary `artifacts.toml`
  ignore. Only after all of those gates pass is flipping `private` the release
  act.

## Component set (MVP, 31 components)

19 built, 12 planned — the ⏳-marked entries are the `insight-front` gap set
plus the two the F-mockups added (`pagination`, `breadcrumb`), delivery-plan
step 5 (see below), not yet in the package.

| Group    | Components |
|----------|------------|
| Forms    | `button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `label`, `field`, ⏳ `toggle`, ⏳ `toggle-group` |
| Overlays | `dialog`, `dropdown-menu`, `tooltip`, `toast`, ⏳ `popover`, ⏳ `sheet`, ⏳ `preview-card` |
| Structure| `card`, `tabs`, `badge`, `separator`, `skeleton`, ⏳ `alert`, ⏳ `avatar`, ⏳ `breadcrumb`, ⏳ `collapsible`, ⏳ `empty`, ⏳ `spinner` |
| Data     | `table` (primitive markup), ⏳ `pagination` |

Behavior and accessibility come from Base UI primitives; variant logic is CVA;
styles are CSS Modules translated from shadcn/ui's Tailwind design (MIT,
attribution in this package's NOTICE). Wrapping conventions follow Constructor's
internal react-kit (gitlab.constr.dev/frontend/react-kit): per-component
directories, colocated tests and docs, `render`-prop polymorphism. A composite
`data-table` is deliberately deferred.

Ten entries — `toggle`, `toggle-group` (Forms), `popover`, `sheet`,
`preview-card` (Overlays), `alert`, `avatar`, `collapsible`, `empty`, `spinner`
(Structure) — come from the kit's first consumer, `insight-front`
(`constructorfabric/insight-front`): of the shadcn/Base UI components that team
uses today, these are the ones the kit lacked. `toggle` and `toggle-group` wrap
`@base-ui/react/toggle` and `/toggle-group`; `avatar` and `collapsible` have
Base UI primitives too. `alert`, `empty` and `spinner` are pure styling with no
primitive, like `card`, `badge` and `skeleton`. All three new overlays portal
their popup, so each needs the same `container` escape hatch the existing
overlays document. Two names diverge from their sources and will confuse the
next reader: shadcn's registry calls `preview-card` `hover-card`, and `sheet`
maps onto Base UI's `drawer` primitive.

`pagination` and `breadcrumb` come from the F-mockups instead: the mockups'
component mapping pairs pagination with the table (Toolbar · Row ·
Pagination) and places breadcrumb inside the Top Bar composition. Both are
pure markup/styling with no Base UI primitive, like `card` and `badge`;
shadcn ships both, so the usual translation path applies.

`toast` is built on Base UI's own Toast primitive (`@base-ui/react/toast`),
not sonner: base-vega ships a `sonner.json` variant too, but that pulls in
`sonner` + `next-themes` as extra runtime dependencies, breaking the kit's
"behavior from Base UI, no extra runtime deps" architecture for the sake of
one component. Base UI's Toast keeps sonner's call-anywhere ergonomics
(`toast.add({...})` from any file, no JSX composed at the call site) via its
own manager object, without the extra dependencies.

## AI layer

Shipped in the package so agents read it from `node_modules`: `llms.txt` at
the package root (entry point: setup rules + component index) and a short
usage doc per component (when to use, kit-level props, examples,
anti-patterns) colocated as `src/components/<name>/<name>.md` and copied to
`dist/docs/` at build. A unit test enforces that every component has a doc,
is indexed in `llms.txt`, and documents every variant/size its CSS module
defines. Still planned: composition recipes — the original trio (CRUD page,
settings form, confirmation dialog) plus the F-mockups' building blocks
(app shell with sidebar navigation, data-table page with toolbar and
bulk-selection bar). The trio's components all exist, so writing those is
unblocked; the mockup-block recipes additionally wait on step-5 components
(`pagination`, `breadcrumb`, `avatar`).

## Testing and acceptance

- Unit tests are written along with components: render + interaction smoke per
  component (vitest + jsdom + testing-library, versions pinned by the root
  test-dependency gate).
- Kitchen-sink demo app: started as `demo/` inside the package (`npm run
  demo`) — the same in-package pattern the telemetry demo actually uses,
  superseding the separate `packages/ui-kit-example-web` package an earlier
  revision of this plan named. All 19 components plus the full token set
  (color swatches, radius/spacing scales) on one page with an
  auto/light/dark switch; consumes the package by name, so it exercises the
  built artifact, not src. Grow it to every component in every state as the
  set lands; it doubles as the agent playground.
- Acceptance: (1) `scripts/verify-consumer.sh` packs the package, installs the
  tarball into a clean Vite project, builds a page that imports a single
  component (`Button`) and asserts tokens, that component's styles and class
  map are present in the bundle — *and*, the proof the repackaging exists
  for, that a component never imported (`Table`, `Dialog` — both have large,
  distinctive CSS) is absent from both the JS and CSS output; (2) an agent
  assembles a CRUD screen from kit components from a single prompt using the
  bundled docs.

## Risks

1. The kit dictates React for consumers — acceptable for ecosystem templates.
2. Fork is the only deep-customization path — accepted; the standard optimizes
   for consistency across templates.
3. Authored styles replace curated styles — the largest share of MVP effort and
   where visual bugs will live; the kitchen-sink demo exists to catch them.

## Delivery plan

Oldest first; steps 1–3 are done, 4 is in progress, 5–6 remain. Completed
steps are a log, not a description of the current build (see Architecture
for that; the tsup pipeline step 1 names was later replaced by Vite, per
Architecture's build bullet).

1. Package skeleton + proven tsup/CSS Modules pipeline (later replaced by
   Vite; see Architecture) + Button.
2. Tokens polish + first component batch (forms) on `@base-ui/react`.
3. Remaining components — done, the 19-component MVP set exists.
4. **Studio reskin (in progress).** The design source moved from shadcn's
   neutral defaults to the Studio design: the F-mockups Figma file, page
   `00 · Foundations`, tokens from its "Studio / shadcn" variable
   collection. Done: theme.css carries the palette and the new token groups
   (see Architecture's theme bullet). Remaining — adapt the existing 19
   components to the mockups' component specs:
   - Badge: status intents (`success`/`warning`/`info`/`danger`/`muted`)
     in pill and dot forms — the mockups say "semantic intent only", which
     retires the shadcn-inherited variant list;
   - Button: `loading` state; the icon-button size×variant matrix (the
     single `size="icon"` today vs sm/md/lg × primary/secondary drawn);
   - Tabs: restyle to the mockups' trackless Kind=tab look (the spec's
     Kind=segment turned out to be the planned `toggle-group`'s styling —
     the design file's own component description says "shadcn Tabs and
     Toggle Group segment states" — so no segment variant on Tabs);
   - Field/Input/Select: `search` and `filter` field types;
   - Table: density (compact/default) and the primitive-styling share of
     row/table states (selected/stale/restricted, loading/empty/error) —
     data-table *logic* stays out, per Non-goals;
   - component CSS moves onto the new metric tokens (control heights, icon
     sizes, spacing) where hardcoded px stands today.
   Blocked on design answers: control heights (the mockups' token spec says
   32/40/44 while the drawn buttons measure 32/36/40), and the eight token
   values marked `derived:` in theme.css.
5. The twelve gap components, mockups-first: `popover`, `alert`, `avatar`,
   `empty` are in both the mockups and the `insight-front` set and go first;
   `pagination` and `breadcrumb` are the mockups-only additions;
   `toggle`, `toggle-group`, `sheet`, `preview-card`, `collapsible`,
   `spinner` close the `insight-front` list. Before the release step, not
   after: they are part of the MVP set the `private` gate names, and the
   kitchen-sink app and composition recipes should cover the whole set once
   rather than be extended right after publication.
6. Composition recipes (incl. the mockup building blocks) + kitchen-sink to
   full coverage; satisfy the #495 publication gates, remove the temporary
   artifact ignore, then flip `private` and publish.
