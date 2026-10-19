---
status: accepted
date: 2026-10-06
decision-makers: Andrey Sysoev
description: Architecture decision to port AcvDataGrid onto the UI kit's own components and tokens rather than build a new data grid in the kit.
---

# Port AcvDataGrid into the Kit Rather Than Build a Data Grid Here

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Port `AcvDataGrid` onto the kit's components and tokens](#port-acvdatagrid-onto-the-kits-components-and-tokens)
  - [Build the feature set on `@tanstack/react-table`](#build-the-feature-set-on-tanstackreact-table)
  - [Adopt a third-party grid](#adopt-a-third-party-grid)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-ui-kit-adr-data-grid-port`

## Context and Problem Statement

The kit has two components for tabular data: `Table`, which is styled table markup, and `DataTable`, which sorts on the client, pages with Previous and Next, selects within one page and keeps all its state inside. Neither covers a real list screen in an admin or back-office application: data loaded page by page from a server, search, quick filters and an "All filters" panel, per-column filters, sorting, page sizes, row selection with bulk actions, row click and row actions, column visibility and pinning, a sticky header, tree rows, drag-and-drop, export, a cards view, and loading and empty states, with the user's choices remembered between visits. Constructor's internal React kit already ships all of this as `AcvDataGrid`, and teams moving off that kit onto this one have no counterpart for it. How should the kit get a data grid that covers a list screen?

## Decision Drivers

* **Teams moving off the internal kit run this grid in production.** Their screens should move with as few changes as possible. That includes the `load(context)` callback their data layers implement and the storage keys under which their users' choices are persisted.
* **Time to the whole feature set.** The list above is the feature set those screens use today. A grid that covers part of it does not let a team move.
* **The kit's own rules hold for every component.** Appearance comes from the kit's tokens only (`cpt-frontx-ui-kit-constraint-token-seam`). The package depends on no other ecosystem package (`cpt-frontx-ui-kit-constraint-ui-committed-member`), and as a public package it cannot depend on Constructor's private registry. A consumer pays only for what it imports (`cpt-frontx-ui-kit-nfr-selective-cost`). Every component ships its usage document (`cpt-frontx-ui-kit-fr-agent-documentation`).
* **Licensing.** The source belongs to Constructor Technology AG and is not open source. A public Apache-2.0 repository can take it only with the company's written approval.

## Considered Options

* **Port `AcvDataGrid` onto the kit's components and tokens** - take the grid's code, plugins and unit tests as they are, and replace every component and token it uses with the kit's own.
* **Build the feature set on `@tanstack/react-table`** - write a new grid on the table-model library `DataTable` already uses, either as a new component or by growing `DataTable`.
* **Adopt a third-party grid** - such as AG Grid or MUI X DataGrid, wrapped as a kit component.

## Decision Outcome

Chosen option: **Port `AcvDataGrid` onto the kit's components and tokens**, because it is the only option that gives migrating teams the behaviour they already run, with the same `load` contract and persisted state, and the whole feature set within a short series of pull requests. The kit's rules still hold, because what the port changes is what the grid is built from: every component it renders becomes the kit's own, and every value in its styles becomes a kit token.

The port follows four rules:

* **Behaviour matches the source, defects included.** A defect found while porting is recorded as a follow-up and fixed afterwards, not inside the port. Where a kit component behaves differently, or where review decides a defect must not ship, the pull request that makes the difference lists it as an accepted delta.
* **The kit is the visual reference.** The grid takes the kit's sizes, type and spacing. Visual differences from the source are expected and are not deltas.
* **The public API mirrors the source without the `Acv` prefix.** Component, plugin and prop names, the `load(context)` shape and the persisted storage keys stay the same. The exceptions are listed in the pull request that makes them. Among them: each plugin has its own import path, public CSS hooks are named after the component directory (`--data-grid-*`), and the date-range filter takes date-fns format tokens instead of dayjs ones.
* **Nothing private comes along.** Utilities the source takes from Constructor's private packages are written again inside the grid. The part of the source's tree that the tree filter needs is ported as private code inside the grid, not as a public tree component.

The ported grid replaces `DataTable`. When the last part of the grid has landed, `DataTable` and `@tanstack/react-table` are removed from the package.

The rebuild on `@tanstack/react-table` is rejected because it means writing and testing again what the source already has: 226 production files, about 14.8k lines, with about 11.3k lines of tests. Its behaviour would also drift from what teams run today. A controlled-state mode, and a table model under it, may still follow the port. A third-party grid is rejected for three reasons. Parts of the feature set are paid: tree data and Excel export are in AG Grid's commercial Enterprise edition and in MUI X's paid Pro and Premium plans. These grids render their own markup and styles, which would be themed onto the kit's tokens from outside rather than built from the kit's components. And their API differs from the source's, so migrating screens would be rewritten anyway.

Beyond the per-plugin entries and the state store the source's structure brings, this decision does not cover how the grid is packaged or which libraries it depends on. Those are in the package's DESIGN (`cpt-frontx-ui-kit-component-package-build`, §3.5).

### Consequences

* Good, because a migrating team keeps its `load` code and its users' saved choices. It changes its imports, any overrides of the renamed CSS hooks, and its date formats.
* Good, because the source's unit tests come with the code, so the source's behaviour is checked here, not only described.
* Good, because the grid is rebranded through the kit's tokens like any other component.
* Bad, because the source's known defects arrive with it. Among them: a late response can overwrite a newer one, sorted columns have no `aria-sort`, and a failed first load has no retry. Each is a follow-up rather than part of the port.
* Bad, because the grid is English-only. The source's translation catalogues are not ported, so a localized screen loses its translations until the kit has internationalisation.
* Bad, because the grid brings an internal structure the rest of the kit does not have: its own services, a plugin registry and a state store per grid instance. A kit developer has to learn it, and the state-store library's types appear in the package's published declarations.
* Bad, because some of the source's public types stay loosely typed, and some React hook lint rules stay disabled where they cannot follow the grid's component registry. Both are follow-ups.
* Bad, because the port is a one-time copy of a fixed commit of the source. Fixes made to the source afterwards do not arrive here, and fixes made here do not go back.
* Bad, because removing `DataTable` is a breaking change for anyone who uses it.
* Neutral, because the grid is not enrolled in component contracts while it is being ported. Enrollment is opt-in for every component (`cpt-frontx-ui-kit-principle-scoped-enforcement`).

### Confirmation

Each pull request of the series brings the source's unit tests for the parts it ports, including tests that pin the persisted storage keys, and lists in its description every accepted delta, every follow-up it found, and the source's layout tests it could not port to the unit runner. Review checks those lists against the code. The package's own checks hold the grid to the kit's rules, as they do for every component. The token-seam test covers the grid's stylesheets. The consumer acceptance run checks that importing the grid's core entry brings in none of the plugins it probes for, and that a plugin resolves from its own subpath. The documentation guard requires `data-grid.md` and its index entry. The last pull request of the series removes `DataTable` and `@tanstack/react-table`, and the package's build and checks pass without them.

## Pros and Cons of the Options

### Port `AcvDataGrid` onto the kit's components and tokens

Take the grid's code, plugins and unit tests as they are, and swap what it is built from.

* Good, because the behaviour is already proven in production.
* Good, because the `load` contract and the persisted storage keys stay the same, so migrating data layers and users' saved choices keep working.
* Good, because the source's unit tests come with it.
* Neutral, because the visuals change to the kit's, by design.
* Bad, because the source's defects come with it, and are fixed only after the port.
* Bad, because the grid's internal structure differs from the rest of the kit.
* Bad, because the source's translations do not come with it.

### Build the feature set on `@tanstack/react-table`

Write a new grid, or grow `DataTable`, on the table-model library the kit already depends on.

* Good, because the result would be designed to the kit's own patterns from the start.
* Good, because the table-model library is already a dependency.
* Bad, because reaching the source's feature set means writing and testing about 14.8k lines of behaviour again.
* Bad, because its behaviour would differ from what migrating teams run, so their screens would need to change.

### Adopt a third-party grid

Wrap an existing grid library, such as AG Grid or MUI X DataGrid, as a kit component.

* Good, because the feature set exists and is maintained by someone else.
* Bad, because tree data and Excel export, both in the feature set, are in their paid tiers.
* Bad, because they render their own markup and styles, themed onto the kit's tokens from outside rather than built from the kit's components.
* Bad, because they are large, against the kit's aim that a consumer pays only for what it imports.
* Bad, because their API differs from the source's, so migrating screens would need to change.

## More Information

The plan for the port, the component substitutions and the follow-up list are in [gears-frontx#655](https://github.com/constructorfabric/gears-frontx/issues/655). The source is taken from commit `b8a40e44` of Constructor's internal React kit. Constructor Technology AG approved the move of the source into this repository on 2026-10-06. The company's copyright is one line in the package's `NOTICE`, and the ported files carry no license headers.

This record was written on 2026-10-13, after the first two pull requests of the series had merged ([#658](https://github.com/constructorfabric/gears-frontx/pull/658) and [#667](https://github.com/constructorfabric/gears-frontx/pull/667)). The decision dates from 2026-10-06. The clause that lets review keep a defect from shipping is the rule as it was applied in #667.

Applicability of the remaining checklist categories:
- **PERF** - addressed by the plugin entries, which keep a page that does not import a plugin from paying for it.
- **SEC** - addressed by the parity rule: the grid persists what the source persisted, including search text, in the browser's storage by default or in the URL when the consumer chooses the router backend. The grid loads no data itself; it calls the consumer's `load`.
- **REL** - addressed by the accepted deltas: where a source defect could break the host page, such as an unusable stored value or blocked browser storage, review may keep it from shipping, and the pull request lists the change.
- **DATA** - addressed: the storage keys and the shape of what is stored under them are kept, and a change to how a stored value is read is listed as an accepted delta.
- **INT** - addressed: the `load(context)` contract and the storage keys are kept for the teams that integrate against them.
- **OPS** - not applicable.
- **MAINT** - addressed in the consequences: a second internal structure to learn, and a one-time copy.
- **COMPL** - addressed: the move is approved by the source's owner and its copyright is recorded in `NOTICE`.
- **UX** - addressed: the kit is the visual reference, and behaviour matches what users already know.
- **BIZ** - the driver, keeping migrating teams' screens and saved state working, is not a requirement in the package's PRD, which states no per-component requirements. It is tracked in #655.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-ui-kit-usecase-compose-screen` - a list screen can be composed from the kit.
* `cpt-frontx-ui-kit-fr-component-set` - the grid and each of its plugins are published behind the package barrel and their own subpaths.
* `cpt-frontx-ui-kit-fr-token-styling` - the ported styles are rewritten on the kit's tokens, with no new tokens added.
* `cpt-frontx-ui-kit-constraint-token-seam` - the grid's stylesheets read only the kit's vocabulary, its own `--data-grid-*` hooks and its private variables.
* `cpt-frontx-ui-kit-nfr-selective-cost` - each plugin is its own entry, so a page pays only for the plugins it imports.
* `cpt-frontx-ui-kit-fr-consumer-acceptance` - the consumer acceptance run checks that the core entry does not bring in the plugins.
* `cpt-frontx-ui-kit-fr-agent-documentation` - the grid ships its own usage document in place of the source's stories and specs.
* `cpt-frontx-ui-kit-constraint-ui-committed-member` - the source's private utilities are written again inside the grid, so the package gains no dependency on another ecosystem package or a private registry.
* `cpt-frontx-ui-kit-principle-scoped-enforcement` - the grid is not enrolled in component contracts during the port, as enrollment is opt-in.
* `cpt-frontx-ui-kit-component-component-surface` - the grid joins the component surface and replaces the data-table component in it.
