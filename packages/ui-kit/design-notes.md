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

## Architecture

- Component stack: **React 19 + Base UI (`@base-ui/react`) + CSS Modules + CVA**.
- Build: **tsup** (`cjs`+`esm`+dts), matching the sibling ecosystem packages.
  Key constraint: tsup has no CSS Modules support of its own — the esbuild
  `local-css` loader override in `tsup.config.ts` provides it, relying on the
  convention that JS imports only `*.module.css` (see the comment there).
- CSS pipeline: per-component `*.module.css`; the bundler inlines hashed
  class-name maps into JS and extracts all CSS into `dist/index.css`
  (`./styles.css` export). Design tokens are a plain-CSS file
  (`./theme.css` export). A consumer imports both once. No PostCSS/Tailwind
  requirements on either side.
- Theme: semantic CSS variables (colors, radii), light/dark via `data-theme` /
  `prefers-color-scheme`; neutral shadcn-style visual base. Component CSS
  consumes only these variables — the theme file is the single seam between
  kit styles and consumer brand.
- Publishing: version-gated like every ecosystem package. `private: true`
  remains in place until both the MVP component set lands and #495 approves
  the package's architecture ownership, traceability, and version policy. The
  required CDSL artifacts must then replace the temporary `artifacts.toml`
  ignore. Only after all of those gates pass is flipping `private` the release
  act.

## Component set (MVP, 29 components)

| Group    | Components |
|----------|------------|
| Forms    | `button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `label`, `field`, `toggle`, `toggle-group` |
| Overlays | `dialog`, `dropdown-menu`, `tooltip`, `toast`, `popover`, `sheet`, `preview-card` |
| Structure| `card`, `tabs`, `badge`, `separator`, `skeleton`, `alert`, `avatar`, `collapsible`, `empty`, `spinner` |
| Data     | `table` (primitive markup) |

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
defines. Still planned: three composition recipes (CRUD page, settings form,
confirmation dialog). The components they compose now all exist, so what is
left is writing them.

## Testing and acceptance

- Unit tests are written along with components: render + interaction smoke per
  component (vitest + jsdom + testing-library, versions pinned by the root
  test-dependency gate).
- Kitchen-sink demo app (planned, `packages/ui-kit-example-web` following the
  telemetry example pattern): every component in every state; live smoke and
  the agent playground.
- Acceptance: (1) `scripts/verify-consumer.sh` packs the package, installs the
  tarball into a clean Vite project, builds a page and asserts tokens, styles,
  and class maps in the bundle; (2) an agent assembles a CRUD screen from kit
  components from a single prompt using the bundled docs.

## Risks

1. The kit dictates React for consumers — acceptable for ecosystem templates.
2. Fork is the only deep-customization path — accepted; the standard optimizes
   for consistency across templates.
3. Authored styles replace curated styles — the largest share of MVP effort and
   where visual bugs will live; the kitchen-sink demo exists to catch them.

## Delivery plan

1. Package skeleton + proven tsup/CSS Modules pipeline + Button.
2. Tokens polish + first component batch (forms) on `@base-ui/react`.
3. Remaining components — done, the 19-component MVP set exists.
4. The ten `insight-front` gap components. Before the release step, not after:
   they are part of the MVP set the `private` gate names, and the kitchen-sink
   app and composition recipes should cover the whole set once rather than be
   extended right after publication.
5. AI docs + kitchen-sink example app; satisfy the #495 publication gates,
   remove the temporary artifact ignore, then flip `private` and publish.
