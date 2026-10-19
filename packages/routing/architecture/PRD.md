---
description: Product requirements for the routing package, the navigation library through which a composed application and its microfrontends share one navigation history and keep URL and screen in agreement.
---

# PRD — Routing (`@gears-frontx/routing`)


<!-- toc -->

- [1. Overview](#1-overview)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Background / Problem Statement](#12-background--problem-statement)
  - [1.3 Goals (Business Outcomes)](#13-goals-business-outcomes)
  - [1.4 Glossary](#14-glossary)
- [2. Actors](#2-actors)
  - [2.1 Human Actors](#21-human-actors)
  - [2.2 System Actors](#22-system-actors)
- [3. Operational Concept & Environment](#3-operational-concept--environment)
  - [3.1 Module-Specific Environment Constraints](#31-module-specific-environment-constraints)
- [4. Scope](#4-scope)
  - [4.1 In Scope](#41-in-scope)
  - [4.2 Out of Scope](#42-out-of-scope)
- [5. Functional Requirements](#5-functional-requirements)
  - [5.1 Navigation Coordination](#51-navigation-coordination)
  - [5.2 Concurrent Occupant Projection](#52-concurrent-occupant-projection)
- [6. Non-Functional Requirements](#6-non-functional-requirements)
  - [6.1 NFR Inclusions](#61-nfr-inclusions)
  - [6.2 NFR Exclusions](#62-nfr-exclusions)
- [7. Public Library Interfaces](#7-public-library-interfaces)
  - [7.1 Public API Surface](#71-public-api-surface)
  - [7.2 External Integration Contracts](#72-external-integration-contracts)
- [8. Use Cases](#8-use-cases)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Dependencies](#10-dependencies)
- [11. Assumptions](#11-assumptions)
- [12. Risks](#12-risks)

<!-- /toc -->

## 1. Overview

### 1.1 Purpose

`@gears-frontx/routing` is the ecosystem's navigation library: the published library through which a composed application and its independently bundled microfrontends share one browser navigation history and keep the URL and the screen a user is looking at in agreement. It exposes a framework-agnostic navigation substrate carrying that shared history and the URL grammar codec, a route ownership signal that names which declared extension or extensions own a domain's entries at any depth of a composed application's own nesting of extension domains, and an engine-provider port so a concrete routing engine can be swapped inside a single microfrontend's own territory without touching the substrate, the host, or any sibling microfrontend. It also provides the FrontX router, which keeps the URL and the mounted extensions in agreement for every routed domain. This library carries no dependency on any concrete router engine itself; a separately published engine-provider package satisfies the port, and the ecosystem provides a default implementation of it. This PRD owns the library's requirements; ecosystem-level requirements are owned by the [root PRD](../../../architecture/PRD.md).

### 1.2 Background / Problem Statement

A composed application is many independently bundled units running in one browser tab, each capable of owning some slice of the URL — and those units nest: a unit that owns one slice may itself contain further units, each owning its own slice beneath it, to whatever depth the composed application actually has. Left alone, each unit would create its own navigation history, so a programmatic navigation issued by one unit produces no change the others observe, and back/forward, deep links, and reloads stop agreeing with what is actually mounted at any depth. The Routing library gives every unit in the realm one navigation history, which FrontX alone reads and writes, one uniform URL grammar every domain is addressed through regardless of depth or occupant count, and a signal — reported independently at every depth of that nesting, through each domain's own dedicated entries in the query string — of when the URL's resolved owner or owners change, from which the FrontX router keeps the mounted screen and the URL as two views of the same fact rather than two independent ones that can drift.

### 1.3 Goals (Business Outcomes)

- **Single navigation history across independently bundled units** — Target: exactly one navigation-history instance per realm, shared by every runtime in it — the shell's and every independently bundled microfrontend's — and reached only by FrontX itself, never by shell or microfrontend code; Timeframe: first platform release.
- **A user's change to the URL sets which unit(s) occupy a routable placement, and otherwise the URL follows what is actually mounted** — Target: a cold load, a reload, and a back/forward step all resolve the same mounted occupant(s) from the URL through the same resolution path, and after every other change the URL shows the occupant(s) the application's executed actions mounted, as the runtime commands it; Timeframe: first platform release.
- **Router engine swappable within one microfrontend's own territory** — Target: replacing the engine used by one microfrontend changes no file outside that microfrontend's own route tree, search-parameter handling, and its own imports of its provider package; Timeframe: first platform release.
- **Composition does not force every microfrontend onto one router-engine version** — Target: the navigation substrate itself declares no dependency on a concrete router engine; Timeframe: first platform release.

### 1.4 Glossary

This PRD uses the ecosystem's shared vocabulary: *application* means what the root glossary defines ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)), and *microfrontend*, *extension*, and *extension domain* mean what the runtime's glossary defines ([mfes PRD §1.4](../../mfes/architecture/PRD.md#14-glossary)). The terms below are this library's own; the full grammar they summarize is normatively stated in this package's navigation-substrate FEATURE, chosen by this package's own Domain Occupancy Addressing Granularity decision record, and [DESIGN §1.1, URL Grammar](./DESIGN.md#1-architecture-overview) summarizes it rather than restating it.

| Term | Definition |
|------|------------|
| navigation substrate | The framework-agnostic core owning the single shared navigation history, the URL grammar codec, and the name-validity and name-equality predicates that codec and every registration-time check of a route or extension token are checked against; it depends on no router engine and no UI framework. Entry resolution itself is not this core's own algorithm — it is the route ownership signal's own primitive, built on this core's codec and predicate rather than re-implementing either. |
| engine provider | A separately published package that binds the navigation substrate's shared history to a concrete router engine so the engine can drive rendering and matching, by satisfying this library's engine-provider port. Not owned by this library: an engine provider's own requirements, behavior, and package boundary are owned by that provider's own PRD and DESIGN — the ecosystem's own default engine provider satisfies this same port. |
| FrontX router | FrontX's own router, which this library provides: one per runtime, which no shell or MFE code calls or affects. For every routed domain it keeps the URL and the mounted extensions in agreement: it rejects an invalid or duplicate route, turns a user's change to the URL into requests to mount and unmount extensions, and writes into the URL what the runtime decides each domain shows; each runtime reaches only its own subroute. |
| zone | The territory an extension owns once mounted into an extension domain; a zone may itself contain further extension domains, so a composed application is a tree of domains and the zones their occupants open, to whatever depth the application actually composes. |
| level | One extension domain's own position in that tree, and the point at which this library resolves and reports ownership: resolution and observation both run against one domain at a time, never against the whole URL in one step, using only that domain's own domain key and that domain's own registered routable extensions. |
| shell's subroute (the pathname) | Everything in the URL between the first `/` and `?`: the shell's private subroute. The shell reads and changes it, and nothing outside it. It carries no occupancy, which lives only in the query string under domain keys; this library never interprets it and copies it verbatim on every write. A shell's subroute that names nothing is `/`; a nested domain's own state never continues it. A URL where no domain projects any entry at all is the shell's subroute alone, with no trailing `?` — for example `/en` — and is itself a valid, fully resolved state, not a partial or broken one: every projected domain is simply empty. |
| domain key | The value every one of a domain's own entries shares as their query-string key: the domain's own declared route, a single `name` at any depth, never built from any enclosing domain's key. A root domain's route is chosen by the host; a nested domain's route is chosen by whatever declares that domain inside an extension's own zone. A domain's route is declared once, at that domain's registration, and is unique among the routed domains live in the page at once: the FrontX router checks it when the registration is made and rejects a duplicate. |
| entry | One `domain-key=extension;param;param=value;...` construct in the query string, contributed once per occupant of a domain: a domain with N occupants contributes N entries sharing its own domain key. Written by this package from the fact of occupancy; the parameters after the extension are the occupant's own. |
| entry address | The domain's route and the extension's route that together name the one entry an occupant owns — `{domainKey, extension}` — which the FrontX router in that occupant's own runtime takes from the occupant's occupant value, or absent in the shell runtime, which has no occupant value. This is the value the engine-provider port hands a conforming provider as its own construction input (§7; DESIGN, Engine-provider port); it is not itself an entry's own payload. |
| occupant value | The private, opaque value the FrontX router assigns to an extension when it mounts into a routed domain, built from the domain's route and the extension's route alone, with no ancestor. Only FrontX itself exchanges it: no interface FrontX hands to shell, MFE or host code exposes it, no FrontX code passes it to them, and no extension reads another's. The extension's own runtime builds that extension's navigation from it, over the extension's own subroute and nothing else. |
| payload | The parameters an entry carries beyond the fact of occupancy — encoded as ordered `key=value` pairs joined by matrix-style `;` separators — the occupant's own, never interpreted by this library's own resolution. |
| extension token | The `name`-alphabet value an entry's own extension segment carries: a caller-supplied identity value that must satisfy this package's own `name` lexical rule, normalized by stripping one leading `/` before that check. This glossary does not fix where that value originates; a composed deployment typically sources it from the extension registration's own declared routable identity, a field the `mfes` package's own contract declares, not one this glossary defines. A registration that carries no route is not routed and is never projected; a route that does not reduce to a valid `name` after normalization is rejected by the FrontX router at registration. |
| route owner | The identity of whichever extension currently occupies one entry — identically the entry's own extension token, paired with the fact of that occupancy; supplied by the FrontX router as part of that domain's own registered-extensions source. Two mounts of the identical underlying extension are two distinct route owners, each its own independently registered extension token, never one route owner declaring two entries. |
| occupant | Every route owner this PRD already defines is also an occupant: an occupant is a route owner that additionally carries its own payload, addressable independently once more than one occupant exists in the same domain at once (§5.2). |
| occupancy strategy | The rule that governs how many occupants a domain may hold mounted at once: exactly one, for every domain this PRD describes outside §5.2, or several concurrently, for a domain a concurrent occupancy strategy governs (§5.2). |
| route ownership signal | The observable signal this library publishes, independently at every domain, when that domain's own resolved entries change — an owner appearing, disappearing, its own payload changing, or the entry order changing — together with the URL back-projection helper, the one path through which the FrontX router puts into the URL what the runtime commands for a domain; when a command removes or replaces an occupant, the entries of the domains nested in that occupant's zone leave the URL in the same change. Keeping the URL and the mounted route owners in agreement, at any level, is not the signal's own guarantee; it is the FrontX router's, together with the runtime's, built on top of this signal (§11): the runtime decides what each part shows, the router writes it. |

## 2. Actors

### 2.1 Human Actors

#### Application Developer

**ID**: `cpt-frontx-routing-actor-application-developer`

**Role**: Composes the host application: declares each extension domain the host projects together with that domain's own route, writes no FrontX-router code, and reads and changes only the shell's own subroute (the pathname), through the engine-provider package's extension router and navigation facade. The FrontX router, not the application developer, reaches the navigation substrate and creates each domain's observer with that domain's registered extensions, at the host's own domains and at every domain nested beneath them; each microfrontend renders the engine-provider package's extension router from its own route tree, over its own subroute. Fills the root PRD's Project Developer role (`cpt-frontx-actor-project-developer`) at the navigation surface.
**Needs**: One navigation history shared by every runtime in the page and kept by FrontX alone, one uniform grammar for binding a domain's entries to whichever units currently occupy it at any domain level, no obligation to standardize every microfrontend on one router-engine version, and — for a domain whose own occupancy strategy admits more than one occupant at once — every concurrently mounted occupant staying independently addressable in the URL.

#### Microfrontend Developer

**ID**: `cpt-frontx-routing-actor-microfrontend-developer`

**Role**: Declares a microfrontend's own route tree, from which that microfrontend's router is built over the microfrontend's own subroute and nothing else. The extension declares its own route in its own registered declaration, not in this library's own contract; the FrontX router assigns the extension its occupant value the moment it mounts, at any depth, and the microfrontend never sees that value. Fills the root PRD's Project Developer role (`cpt-frontx-actor-project-developer`) at a microfrontend's own routing.
**Needs**: Freedom to choose or swap the router engine inside the microfrontend's own subroute, reading and changing only that subroute, and — when the same microfrontend entry is mounted more than once in one domain at once — each of those instances, and its own live payload, staying independently addressable rather than conflated with the other.

### 2.2 System Actors

#### Router Engine

**ID**: `cpt-frontx-routing-actor-router-engine`

**Role**: The pluggable, replaceable engine an engine-provider package binds the shared navigation history to, through this library's engine-provider port. Treated as opaque and substitutable by the navigation substrate and by every microfrontend other than the one that chose it; this library carries no concrete engine dependency of its own and no opinion on which engine a provider package chooses.

#### FrontX Router

**ID**: `cpt-frontx-routing-actor-frontx-router`

**Role**: FrontX's own router, provided by this library, one per runtime; no shell or MFE code calls it or can affect it, and it depends on nothing of the runtime. It admits the routed domains and extensions the runtime registers, rejecting an invalid or duplicate route; it turns a user's change to the URL — a page load or a back or forward step — into requests to mount and unmount extensions, sent as actions chains, never mounting anything directly and never seeing how a request is delivered, executed or concluded; and it writes into the URL what the runtime decides each domain shows. It is available whenever a composed application runs with routing.

## 3. Operational Concept & Environment

In a composed application each runtime's FrontX router follows the entries of every routed domain in the one realm-shared navigation history, and every microfrontend's router reads its own entry from that same history. Every navigation — a link click, a back/forward step, a cold load, a reload, an imperative call — is read from or written to the one shared history, and the route ownership signal reports the resulting ownership transition at each domain to the FrontX router. The navigation substrate and the route ownership signal publish facts. The FrontX router sends the actions chains for a user's change to the URL — a cold load, a reload, an address the user enters, or a back/forward step — each asking the runtime to mount or unmount an extension, and none of them adding a history entry; a navigation written through the history layer, a link click or an imperative call, sends none. During a page load it sends those chains from the initial route and then clears the URL's entries, so the URL is filled again only as a result of their execution; the initial route stays in effect for a domain, root or nested, that begins routing while the initial route is kept, until the user's first navigation after the load (a push the application requests, which adds a history entry, or a back or forward step). It writes into the URL what the runtime commands for each domain. The runtime alone decides what each domain shows and executes the chains (see this package's own Mount Trigger Ownership decision record for the shape of the signal and the helper). The same recurs one domain level deeper whenever a mounted extension's own zone contains a further domain: once that domain exists, the FrontX router follows its entries too, and they resolve exactly as a root domain's do.

Every runtime runs the same routing code. In an extension's runtime, the FrontX router supplies the occupant its entry address — the domain's own route and the occupant's own extension token. The shell runtime is the runtime whose FrontX router was never supplied navigation (navigation is supplied only in an extension's runtime), and its private subroute is the shell's subroute (the pathname). When navigation was supplied but the FrontX router has no occupant value (an extension with no route of its own or of its domain, or a failed occupant-value exchange), that extension has no access to the router: reading its entry address refuses, so its extension router and navigation facade refuse too. An extension must build its registry within its mount window: an extension runtime that builds no registry, or builds it outside the mount window, never adopts its inbound bridge and is never supplied navigation, which is a defect of the MFE entry and lies outside the private-subroute guarantee.

### 3.1 Module-Specific Environment Constraints

- Requires a browser environment with a navigation-history API for the substrate's own realm-shared instance.
- Requires a single JavaScript realm shared by the host and every independently bundled microfrontend: the navigation substrate's single-shared-history guarantee is a realm-scoped property, not a per-bundle one.
- The router engine is never a dependency of the navigation substrate itself: every engine-specific dependency is confined to whichever separately published engine-provider package implements this library's engine-provider port (`cpt-frontx-routing-fr-engine-provider-port`).
- A standalone package (no intra-ecosystem dependency) by construction: the binding to route owners is expressed only through the registrations the runtime tells the FrontX router, and the binding to mounting only through the actions chains the FrontX router sends — never through an import of the runtime that manages either one.
- Third-party code on the page may call the browser's own navigation-history API directly, bypassing the shared navigation history. This is an environmental condition the library does not prevent, not a supported way to navigate: a call that bypasses the shared instance leaves its `location` stale and its fan-out silent for that change (see DESIGN §4 failure modes).
- **Shell's subroute and locale**: the shell's subroute (the pathname), including an active locale it carries (for example a leading `/en`), belongs to the shell alone: the shell reads and changes it, and nothing outside it, through the navigation facade, and the navigation substrate and the URL back-projection helper copy it forward verbatim and never interpret it. Every occupant's own entries live in the query string under their own domain keys, never inside the shell's subroute, so a change to the shell's subroute leaves them intact. A change to the URL made outside the shared history is the same unsupported, environment-level condition the bullet above already documents for any third-party bypass of the shared instance: this library makes no promise about what an occupant observes when the URL changes through a channel it does not read.
- **URL length budget**: the composed URL — the shell's subroute and every domain's own entries together — SHOULD stay under 2000 characters, the widely cited de facto ceiling for compatibility across browsers and the proxies and load balancers many deployments sit behind, rather than any single browser's own documented limit. This budget is guidance for the shell and every occupant to keep in mind as they decide how much they put into their own subroutes, not a limit the URL back-projection helper enforces: the helper imposes no length limit of its own and performs no truncation, and writes exactly the URL the FrontX router's back-projection call asked for. Staying under the budget, and deciding what to do when a composed URL would exceed it, is the responsibility of the shell and of every occupant, each for its own subroute.
- **Reload and server-side rewrite**: a full reload and a server-side rewrite that lands the browser on the shell's own entry point **MUST** resolve to the identical mounted state a client-side navigation to that same URL would have produced — every occupant's own state reconstructs from the URL alone, through the same per-domain resolution path an ordinary navigation uses (`cpt-frontx-routing-fr-route-ownership-signal`); a cold mount is not a degraded case this library resolves differently from any other. Producing that URL in the first place — rendering the mounted screens on the server, or generating the rewritten URL itself — is out of scope for this library (§4.2): the guarantee here is that whatever URL the browser ends up presenting on that first paint resolves exactly as it would on any later navigation, not that this library renders anything for that first response.

## 4. Scope

### 4.1 In Scope

- A single, realm-shared navigation history with fan-out subscription: one real subscription to the browser's navigation history, redistributed to every listener.
- Imperative navigation outside the UI tree, for FrontX's own callers: `push`, `replace`, `go`, `location`, `subscribe` against the shared history.
- The URL grammar — one uniform entry construct addressing every domain at any depth and any occupant count — and the engine-provider port a separately published provider package implements against it.
- The route ownership signal: resolving, at each domain, the entries carrying that domain's own domain key to that domain's own declared route owners, reporting every ownership-relevant change at that level to the FrontX router, and the one path through which the FrontX router writes what the runtime commands — the FrontX router, together with the runtime, keeps the URL and the mounted route owners in agreement, built on this signal (§11): the runtime decides what each part shows, the router writes it.
- Concurrent occupant projection and per-occupant addressable parameters: for a domain whose own occupancy strategy admits more than one occupant mounted side by side at once, projecting every concurrently mounted occupant into the URL and keeping each one's own parameters independently addressable and resolvable back to the specific occupant that produced them (§5.2).
- The FrontX router: admitting routed registrations, sending the mount and unmount actions of a user's change to the URL, and writing the runtime's commands into the URL, for every routed domain (§2.2).
- The channel boundary: this library owns the URL channel only, among the ecosystem's host–microfrontend communication channels.

### 4.2 Out of Scope

- Addressed action dispatch and shared-property broadcast between microfrontends and the host — owned by the runtime that provides those channels ([mfes PRD](../../mfes/architecture/PRD.md)); this library neither duplicates nor mediates either one.
- Microfrontend loading, admission, placement, and isolation — owned by the runtime ([mfes PRD](../../mfes/architecture/PRD.md)).
- The registry of route owners, the execution of a mount, and any reconciliation between a competing pair of mounts — owned by the runtime, which the FrontX router reaches only by sending mount and unmount requests as actions chains, at every domain level; this library imports nothing of the runtime.
- Any router-engine implementation, and any provider-side concern — router construction for a microfrontend's own routing code — all owned entirely by whichever separately published engine-provider package a microfrontend depends on, including the ecosystem's own default engine-provider package.

## 5. Functional Requirements

### 5.1 Navigation Coordination

#### Single navigation substrate shared across independently bundled units

- [x] `p1` - **ID**: `cpt-frontx-routing-fr-single-navigation-substrate`

The system **MUST** expose exactly one navigation-history instance per realm, shared by every runtime in it — the shell's and every independently bundled microfrontend's — and reached only by FrontX itself, the FrontX router and the engine-provider package, and **MUST** fan out one underlying browser-history subscription to every listener that subscribes to it.

**Rationale**: Independently bundled units cannot share a compile-time singleton; a realm-shared instance is what keeps `push`/`replace`/`go` and back/forward consistent for every unit without requiring them to coordinate with each other directly.

**Actors**: `cpt-frontx-routing-actor-frontx-router`, `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

#### Engine provider port

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-engine-provider-port`

The system **MUST** expose the shared navigation history to a router engine only through a pluggable engine-provider port, satisfied by a separately published provider package, and **MUST** let a microfrontend replace its provider package with a different one without changing the navigation substrate, the URL grammar, the host, or any sibling microfrontend. The port describes only what a provider **MUST** accept from the substrate — the shared `NavigationHistory` instance, the entry address the FrontX router supplied for this occupant (its own domain key and extension token), or its absence in the shell runtime, and an opaque route tree — and that a provider is responsible for producing a constructed router from them, which is then rendered for that occupant; it names no concrete engine.

**Rationale**: Concrete router engines evolve independently of the substrate; confining engine choice to a swappable, separately published provider package is what keeps that evolution from reaching outside the microfrontend that made the choice, and what keeps the substrate itself free of any concrete engine dependency.

**Actors**: `cpt-frontx-routing-actor-microfrontend-developer`

#### Route ownership signal

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-route-ownership-signal`

The system **MUST** resolve, at each domain independently, every entry currently carrying that domain's own domain key — the domain's own declared route, at any depth, never a segment of the shell's subroute — to that domain's own declared route owner by matching the entry's own extension token against the domain's own registered routable extensions, and **MUST** publish an observable signal, per domain, reporting every ownership-relevant transition at that domain to the FrontX router, which supplies that domain's set of declared registered extensions as a plain argument: an owner appearing, disappearing, its own payload changing, or the entry order changing. The system **MUST** also make the URL show what the runtime commands for each domain: a write for one domain **MUST NOT** discard any sibling domain's own entries already in the URL, and a nested domain's entries leave the URL together with the host extension that held them. Keeping the URL and the mounted route owners in agreement, at any level, is the guarantee of this library's FrontX router together with the runtime, built on top of this signal and the URL back-projection helper — not a guarantee the signal or the helper makes on its own (§11): the runtime decides what each part shows, the router writes it.

**Rationale**: Treating a user's change to the URL — a page load or a back/forward step — as the input the FrontX router turns into actions chains at every domain, not only the outermost one, while otherwise the runtime's commands decide and the URL follows the actual mounted state, and publishing each domain's resolution as an observable signal per domain rather than orchestrating mounting itself, is what lets a deep link into a nested domain, a reload, and a back/forward step all resolve to the same declared owner an ordinary click-driven navigation would reach, one domain at a time, as each domain comes to exist. Because the route ownership signal never sees the tree of domains, it publishes no signal asserting that a deep address resolved end to end; only each domain's own local transition, which the FrontX router composes across domains into whatever end-to-end fact it needs. The registry of route owners stays with the runtime. Giving every domain its own dedicated entries under its own domain key, rather than sharing any single URL segment with a sibling domain, is what lets any number of domains — and, within one domain, any number of occupants — project into the URL at once without one ever displacing another's own address.

**Actors**: `cpt-frontx-routing-actor-frontx-router`, `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

#### Imperative navigation outside the UI tree

- [x] `p2` - **ID**: `cpt-frontx-routing-fr-imperative-navigation`

The system **MUST** expose `push`, `replace`, `go`, `location`, and `subscribe` against the shared navigation history to FrontX itself — the FrontX router and the engine-provider package — for use outside any UI component tree. Shell and microfrontend code **MUST NOT** reach it: each reaches only its own subroute, an extension its own entry and the shell its subroute (the pathname), through the engine-provider package's navigation facade.

**Rationale**: Not every FrontX caller that needs to read or change the URL is a rendered component: the FrontX router runs with no UI tree at all, and needs the same navigation surface without a mounted router to reach it.

**Actors**: `cpt-frontx-routing-actor-frontx-router`

#### FrontX router — Navigation Coordination

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-frontx-router`

The system **MUST** provide FrontX's own router, one per runtime, which keeps the URL and the mounted extensions in agreement for every domain that declares a route; no shell or MFE code constructs it, calls it or affects it. It **MUST** reject an invalid or duplicate route at registration. An extension without a route of its own or of its domain, or whose occupant-value exchange failed, **MUST** have no access to the router. It **MUST** turn a user's change to the URL — a page load or a back or forward step — into requests to mount and unmount extensions, sent as actions chains, and **MUST NOT** send any for a navigation written through the history layer. It **MUST** write into the URL what the runtime commands for each routed domain, the runtime alone deciding what each domain shows. During a page load it **MUST** use the initial route to send those requests, then clear the URL's entries, so that the URL is filled again only as a result of their execution: `?screen=profile&sidebar=hello-world`, with no sidebar extension domain implemented, ends as `?screen=profile`. The initial route **MUST** stay in effect for a domain, root or nested, whose observer starts while the initial route is kept, until the user's first navigation after the load (a push the application requests, which adds a history entry, or a back or forward step).

**Rationale**: The URL is used to try to set the application's state, but in the end it must always show the actual state. Routing is FrontX's own responsibility, so neither shell nor MFE code may have code for it or any ability to affect it.

**Actors**: `cpt-frontx-routing-actor-frontx-router`, `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

### 5.2 Concurrent Occupant Projection

A domain's own occupancy strategy may hold more than one occupant mounted side by side at once rather than exactly one — for example two occupants of the same kind mounted concurrently (two instances of the same extension, each with its own live parameters) alongside a third occupant of a different kind, all within the same domain. The worked case evaluated against this pair of requirements is three peer root domains, none nested inside another: a `screen` domain holding a single occupant, addressed by the same construct as every other domain in the tree; a `sheet` domain governed by a concurrent occupancy strategy that holds two occupants concurrently; and a `widgets` domain, also governed by a concurrent occupancy strategy, that holds three occupants concurrently — two of them separate instances of the very same microfrontend entry, each with its own live parameter value, alongside a third occupant of a different kind. What must hold true for this tree: every one of the `widgets` domain's three concurrent occupants, and both of the `sheet` domain's occupants, is projected into the URL; each occupant — including each of the two same-entry instances — stays independently addressable; and each same-entry instance's own live parameter value resolves back to that specific instance and never to the other, so neither instance's parameter is ever conflated with or overwritten by the other's. This PRD requires only that such a domain's concurrent occupants each get projected and each stay independently addressable, including the two same-entry instances remaining individually resolvable; the exact grammar by which a domain's own contribution to the URL is assembled is DESIGN's own concern, stated normatively in this package's own URL Grammar (DESIGN §1.1).

The tree this requirement is evaluated against, in outline — three peer root domains, none nested inside another:

```
screen domain (1 occupant)
sheet domain, concurrent occupancy (2 occupants)
widgets domain, concurrent occupancy (3 occupants: two same-entry instances + one of a different kind)
```

Concretely, using this package's own grammar, one instance of this tree resolves to:

```
/en?screen=dashboard;orientation=left
   &sheet=tenant-details;tenantId=456
   &sheet=user-contacts;contactId=123;view=active
   &widgets=line-a;range=7d
   &widgets=line-b;range=30d
   &widgets=pie;metric=revenue
```

`sheet` and `widgets` are peer root domains, exactly like `screen`, not nested inside it or each other: `sheet` holds two occupants, and `widgets` holds three, two of them (`line-a`, `line-b`) separate instances of the identical microfrontend entry, each with its own `range` value resolving back to that instance alone. An implementation **MUST** reproduce this example as one of its own acceptance scenarios.

This worked scenario is evaluated as a structural invariant on a fixed tree — every occupant projected and addressable — rather than as a sequence of steps with branching alternatives; a formal Use Case (§8), built around a main flow and alternative flows, would add flow-structure this requirement does not have without adding a fact this PRD does not already state, so this outline stands in place of one.

#### Concurrent occupant projection

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-concurrent-occupant-projection`

For a domain whose own occupancy strategy admits more than one occupant mounted side by side at once, the system **MUST** project every one of those concurrently mounted occupants into the URL as its own entry sharing that domain's own domain key, and **MUST** resolve and report each one's own transition through the route ownership signal independently of the others, at the same domain. This requirement extends, and does not weaken, the existing per-domain-key extension-token uniqueness guarantee (§11) for a domain whose own occupancy strategy admits only one occupant at a time.

**Rationale**: For a single-occupant domain the route ownership signal reports one resolved owner; a domain governed by a concurrent occupancy strategy has, by construction, more than one. Leaving such a domain unprojected means every one of its concurrent occupants — that they are mounted at all, and each one's own live parameters — has no representation in the URL at all, defeating the goal that the URL follows what is actually mounted (§1.3) for exactly the domains where it is admitted to matter most.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

#### Per-occupant addressable parameters

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-per-occupant-addressable-parameters`

For a domain projected under `cpt-frontx-routing-fr-concurrent-occupant-projection`, the system **MUST** keep each concurrently mounted occupant's own parameters addressable and resolvable back to the specific occupant that produced them, by carrying them inside that occupant's own entry as matrix-style `;key=value` pairs, without requiring every occupant's own parameters to share one flat query-string namespace in which two occupants' own parameter names could collide.

**Rationale**: A flat query string gives every occupant of a domain the same namespace for its own parameters; two occupants that each name their own parameter identically — including, most plainly, two occupants that are both instances of the same underlying extension and therefore name their own parameter the same way by construction, not by coincidence — would otherwise silently collide or overwrite one another rather than each staying independently addressable and bookmarkable.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

#### Standalone Package Boundary

- [ ] `p1` - **ID**: `cpt-frontx-routing-nfr-standalone`

The system **MUST** import no other package in this ecosystem, and **MUST NOT** itself invoke a mounting operation: a mount is reached only through an actions chain the FrontX router sends.

**Threshold**: Zero intra-ecosystem edges in the package manifest, and zero intra-ecosystem edges in the import graph, both verified mechanically by the boundary guards.

**Rationale**: With zero intra-ecosystem edges, the FrontX router reaches the runtime only through the actions-chain executor and type system it declares.

#### Agnostic Navigation Core

- [x] `p1` - **ID**: `cpt-frontx-routing-nfr-agnostic-core`

The navigation substrate **MUST** carry no dependency on any router engine or UI framework whatsoever; every dependency on a concrete engine **MUST** live in a separately published engine-provider package that implements the engine-provider port, never inside this package.

**Threshold**: This package's own module carries zero import of any router engine or of a UI-framework rendering primitive; checked mechanically by the boundary guards as a package-boundary property — no engine or UI-framework package can appear in this package's manifest or import graph at all, not merely inside a designated internal component.

**Rationale**: Keeping the substrate free of engine or framework knowledge is what lets one microfrontend's routing table change engines, or lets the default engine-provider package itself be replaced ecosystem-wide, without the substrate, the host, or any other microfrontend noticing. Making this a package boundary rather than an intra-package convention is what turns "confined to one component" into "absent from this package's own dependency graph, mechanically checkable without inspecting which module inside the package a given import lives in."

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions (safety, privacy, accessibility, internationalization, inclusivity, regulatory compliance) apply here for the same reasons stated there. The categories this PRD does not address are dispositioned as follows:

- **Security (authentication, authorization, audit, data classification)** — Not applicable because this library authenticates no one, holds no credential and records nothing for audit. What each microfrontend may read and change of the URL — its own subroute only — is a functional requirement, stated by the actors and requirements above.
- **Safety** — Not applicable because this library is a pure information system with no physical interaction.
- **Performance (response time, throughput, capacity)** — Not applicable because this library sets no latency or throughput target of its own; the only size guidance it states is the URL length budget (§3.1).
- **Reliability (availability, recovery)** — Not applicable because this library runs inside the page and has no service of its own to keep available; after a reload, the state is rebuilt from the URL through the same path as any other navigation (§3.1).
- **Usability (accessibility, internationalization, offline use, inclusivity)** — Not applicable because this library renders no user interface; the locale carried in the shell's subroute (the pathname) belongs to the shell (§3.1).
- **Compliance (regulatory, industry standards, legal)** — Not applicable because this library handles no regulated or personal data.
- **Data (ownership, quality, lifecycle)** — Not applicable because this library stores no data; the shared navigation history lives in memory for the page's lifetime.
- **Maintainability (code quality, documentation, technical debt)** — Not applicable because this library sets no maintainability target of its own; its package boundary is held by the standalone and agnostic-core requirements (§6.1).
- **Operations (deployment, monitoring, support)** — Not applicable because this library is a published package with no deployed service of its own to run, monitor or support.

## 7. Public Library Interfaces

### 7.1 Public API Surface

The package's public surface is specified by this package's [DESIGN](./DESIGN.md) §3.3 and by its FEATUREs.

### 7.2 External Integration Contracts

None owned here. The package is distributed under the root PRD's package-registry distribution contract (`cpt-frontx-contract-package-registry-distribution`). The execution of a mount is the runtime's own contract, which the FrontX router reaches only through the actions chains it sends; the interface through which the runtime calls the FrontX router is the runtime's own contract, to which the FrontX router conforms.

## 8. Use Cases

#### Deep link resolves to a not-yet-mounted extension's screen, level by level

- [ ] `p2` - **ID**: `cpt-frontx-routing-usecase-deep-link-to-microfrontend-screen`

**Actor**: `cpt-frontx-routing-actor-frontx-router`

**Preconditions**:
- The FrontX router has reached the navigation substrate and created the route ownership signal's observer for each of the host's root domains, supplying each domain's own registered extensions.
- A URL naming a route owner several domains deep is opened cold, reloaded, or reached by back/forward, and none of the extensions along that path are yet mounted.

**Main Flow**:
1. A root domain's observer reads every entry carrying that domain's own key, resolves each one to a declared route owner by matching its extension token against that domain's registered extensions, and reports the owner appearing (`cpt-frontx-routing-fr-route-ownership-signal`); the observer supplies only those entries and that domain's declared registered extensions to the resolution primitive itself, never performing the matching directly.
2. The FrontX router sends a mount action for that route owner as an actions chain, and the runtime mounts it. A page load clears the URL's entries once its chains are sent, and the URL is filled again by what the runtime commands as those chains execute, with no history entry; a domain, root or nested, whose observer starts while the initial route is kept resolves against that initial route, not the cleared URL; the initial route ends at the user's first navigation after the load (a push the application requests or a back or forward step). After a back/forward step the URL already carries the state, so no history entry is written either.
3. Once mounted, that extension's own zone may itself contain a further domain; for each such domain that comes to exist, the FrontX router creates its observer, and the entries carrying that domain's own key — its own declared route — resolve against that domain's own registered extensions, exactly as a root domain's did; while the initial route is kept, those entries are the ones the initial route carried, not the cleared URL's, and the initial route ends at the user's first navigation after the load (a push the application requests or a back or forward step).
4. This repeats one domain level deeper each time a resolved owner's own zone contains a further domain that has come to exist, until every domain along the URL's path has resolved, or until a domain resolves to no owner.
5. At every domain, once its own owner is mounted, that extension's own engine-provider package reads the current location from the shared history at start and reads its own entry's own payload as its own route and search — a guarantee the engine provider, not this library, makes about its own construction (owned by that provider's own PRD).

**Postconditions**:
- Each mounted extension and the entry its own domain resolved agree without a blank screen, because each freshly mounted router reads the current location when it is built rather than starting from a blank route. After a back/forward step that location already carries the extension's entry; after a page load the entry is back in the URL once the FrontX router first writes the extension, with the parameters the initial route carried. This library never asserts that every domain along the path resolved together as one event — only that each domain resolved from the URL the user arrived at: a domain, root or nested, whose observer starts while the initial route is kept resolved against the initial route, not the cleared URL.

**Alternative Flows**:
- **No declared owner matches an entry at a domain**: that domain's own observer reports the entry as unresolved; the FrontX router sends no mount for it; after a page load, the URL shows only what the application mounted, so the entry is absent from it, and after a back or forward step the FrontX router drops the entry from the URL; nothing mounts, and nothing is mounted beneath it. A domain several steps deeper along the same URL reporting nothing is indistinguishable, at any shallower domain's own observer, from that deeper domain's own wave simply not having arrived yet, since no domain's own signal ever asserts that an address resolved beyond that domain's own entries.
- **A back/forward step drops or changes a mounted owner's entry at some domain**: that domain's own observer reports the change, and the FrontX router sends one unmount action for each token that left and one mount action for each token that arrived, through the runtime, carrying the history intent `none`; when a back/forward step would leave a part of the page that cannot be emptied with nothing in it (including an address that names something no longer available), that part keeps what it shows and the URL is corrected to match. A navigation issued while several domains are still resolving is safe: the resolution restarts as a fresh wave from the outermost domain, every stale nested domain leaves together with the occupant whose zone contained it, as part of that occupant's own action, and no domain ever holds onto state of its own — every domain always reads the shared history's current location.

## 9. Acceptance Criteria

- [x] A single navigation-history instance answers `push`/`replace`/`go`/`location`/`subscribe` for every runtime in the realm — the shell's and every independently bundled microfrontend's — reached only by the FrontX router and the engine-provider package, and every one of those five members is callable by such a caller with no mounted router or UI-framework component tree in its call path — verifiable via `cpt-frontx-routing-fr-single-navigation-substrate` and `cpt-frontx-routing-fr-imperative-navigation`.
- [ ] Replacing the engine-provider package used by one microfrontend changes no file outside that microfrontend's own route tree, search-parameter handling, and its own imports of its provider package — verifiable via `cpt-frontx-routing-fr-engine-provider-port`.
- [ ] A cold load, a reload, and a back/forward step all resolve the same declared route owner from a domain's own entries through the same resolution path, at every domain the FrontX router holds an observer for, reported to the FrontX router as an observable transition — verifiable via `cpt-frontx-routing-fr-route-ownership-signal`.
- [ ] The FrontX router rejects an invalid or duplicate route at registration, and writes into the URL what the runtime commands for each domain. During a page load the FrontX router uses the initial route to send the requests it implies and then clears the URL's entries, so the URL is filled again only as their execution writes it: `?screen=profile&sidebar=hello-world`, with no sidebar extension domain implemented, ends as `?screen=profile`; the initial route stays in effect for a domain, root or nested, whose observer starts while the initial route is kept, until the user's first navigation after the load (a push the application requests, which adds a history entry, or a back or forward step); a navigation written through the history layer — an extension or the shell changing its own subroute, or the FrontX router's own write — sends no request — verifiable via `cpt-frontx-routing-fr-frontx-router`.
- [ ] An extension without a route of its own or of its domain, or whose occupant-value exchange failed, has no access to the router: reading its entry address refuses, so its extension router and navigation facade refuse too — verifiable via `cpt-frontx-routing-fr-frontx-router`.
- [ ] For a domain whose own occupancy strategy admits more than one occupant at once, every concurrently mounted occupant is projected into the URL and its own transition is reported independently through the route ownership signal — verifiable via `cpt-frontx-routing-fr-concurrent-occupant-projection`.
- [ ] Each concurrently mounted occupant's own parameters resolve back to the specific occupant that produced them, with no collision between two occupants' own parameter names — verifiable via `cpt-frontx-routing-fr-per-occupant-addressable-parameters`.
- [ ] The following two examples resolve, round-trip, and are restorable from a cold load exactly as pictured; an implementation **MUST** reproduce both as its own acceptance scenarios.

  **Reference link** — a `screen` domain holding one occupant with its own parameter, a `sheet` domain holding two occupants at once (one of them with two parameters), and a `widgets` domain holding three occupants at once, two of them separate instances of the identical microfrontend entry:

  ```
  /en?screen=dashboard;orientation=left
     &sheet=tenant-details;tenantId=456
     &sheet=user-contacts;contactId=123;view=active
     &widgets=line-a;range=7d
     &widgets=line-b;range=30d
     &widgets=pie;metric=revenue
  ```

  **Console layout** — a Tenants screen showing tenant `ABC`, its own `tabs` domain nested inside that screen's own zone on the Contacts tab, and a create-contact modal in the console's own root `modal` domain:

  ```
  /en?screen=tenants;tenantId=ABC
     &tabs=contacts
     &modal=create-contact
  ```

  `tabs` is the route the `tenants` extension's zone declares for its nested tabs domain; it restates no ancestor, and it leaves the URL together with the `tenants` extension whose zone contains it. `modal` is the console's own root domain. Both routes are unique among the domains live in the page at this moment, which is all uniqueness requires.
- [ ] The package declares no intra-ecosystem dependency, and its navigation substrate carries no import of any router engine or a UI framework — verifiable via the boundary guards.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| Browser navigation-history API | The primitive the substrate's own realm-shared history implementation is built on. | p1 |

## 11. Assumptions

- The host and every independently bundled microfrontend composed into one application share a single JavaScript realm; the navigation substrate's sharing boundary is the realm.
- The FrontX router follows each root domain's entries, against that domain's own registered extensions, before any deep link into any domain's screen is resolved; it does the same for a nested domain once that domain begins to exist, and a domain, root or nested, that begins routing while the initial route is kept resolves against the initial route, not the cleared URL; the initial route ends at the user's first navigation after the load (a push the application requests or a back or forward step).
- Which extension registrations are routable at all, and under which extension token, is decided by the runtime's own registration contract, not by this library: an extension's own declared route-identity value — a field the `mfes` package's own contract declares, not one this library's own schema defines — normalized by stripping one leading `/`, is what this library reads as that extension's own extension token; a registration that supplies none is not routed and is never projected, and one whose normalized value is not a valid `name` is rejected by the FrontX router at registration.
- A same-domain conflict — two route owners registering the identical extension token at the same domain — is caught by the FrontX router when the runtime presents the registration to it, not by this library; extension-token equality for this purpose is decided by this library's own name-equality predicate, used by the FrontX router so that it applies the same rule the library itself uses to resolve either token at navigation time. Nesting a further domain inside one route owner's own zone is not a same-domain conflict: it is a separate domain, one level deeper, with its own route, its own independent set of route owners, and its own independent conflict check.
- This check compares distinct registrations against one another, so it catches two separately registered route owners that declare the same extension token — including two mounts of the identical underlying extension, since each mount is its own distinct route owner with its own independently declared token, never one route owner or one registration shared between them. There is no case this check cannot see: a same-entry mount declaring the same token as another occupant is caught exactly as any other pair of route owners declaring the same token is.
- A domain's own route is the single choice of whatever declares that domain — the host for a root domain, and the declaration of that nested domain's instance for a domain nested in an extension's zone: the `route` field on the domain's own registration, owned by the `mfes` runtime. The FrontX router checks it against the `name` alphabet, and for uniqueness among the routed domains live in the page, when the runtime presents the registration, and rejects a route that fails either check. This library treats the route as a plain argument the FrontX router supplies, never as a value it derives.
- A route owner's own extension token is one `name`-alphabet value: the registered-extensions source the FrontX router supplies for a domain is a set of route owners, but no identity appears in it against two different tokens. The same underlying extension mounted more than once — to present the same UI at more than one place — is a distinct route owner at each mount, each with its own independently declared token, never one route owner declaring several.
- This guarantee disambiguates identity-to-token mapping only; it does not by itself bound how many declared tokens' own route owners one domain may report as concurrently resolved at once. A domain whose own occupancy strategy admits only one occupant at a time still has exactly one resolved owner per token, as this bullet states; a domain whose own occupancy strategy admits several occupants side by side reports each concurrently resolved owner independently, without weakening this same per-token guarantee for any one of them (`cpt-frontx-routing-fr-concurrent-occupant-projection`, §5.2).
- A microfrontend declares the routes in its own routing table relative to its own subroute, never as an absolute location carrying the shell's subroute or another domain's own entries; it reads and changes only its own subroute and sees nothing outside it.
- Entry order in the query string is preserved on read and on write and carries no meaning this library assigns; a domain that needs an order of its own (a stack of sheets, a widget layout) reads it from the ordered entry list this library hands it, rather than from any semantics this library attaches to position.
- The FrontX router, together with the runtime, keeps the URL and the mounted route owners in agreement at every domain, on top of the route ownership signal and the URL back-projection helper (`cpt-frontx-routing-fr-route-ownership-signal`, `cpt-frontx-routing-fr-frontx-router`). The navigation substrate and the route ownership signal publish the facts that agreement acts on. The FrontX router sends the actions chains for a user's change to the URL — a cold load, a reload, an address the user enters, or a back/forward step — never mounting or unmounting directly, and none of those chains adds a history entry; it also writes into the URL what the runtime commands for each domain. The runtime alone decides what each domain shows and executes the chains. This holds at the outermost domain and at any domain nested beneath it — a domain several levels deep is kept in agreement exactly as the outermost one is, never by a lesser or different rule. That every occupancy change, restoration included, is an executed action is decided outside this library, by the runtime's own occupancy rule; this package's own Mount Trigger Ownership decision record shapes the signal and the helper under that rule.
- More than one route-ownership-signal observer may exist in the same realm at once — one per routed domain the FrontX router observes — with no conflict between them: each observer is independent, reads its own registered-extensions source, resolves against its own domain key's own entries, and reports its own transitions against the one shared navigation history every observer in the realm reads. Resolving a URL several domains deep is therefore not one event but a wave of independent, per-domain resolutions: each domain's own observer resolves and reports the moment that domain begins to exist — against the initial route, not the cleared URL, when it is a domain, root or nested, whose observer starts while the initial route is kept — the route ownership signal never sees the tree of domains and so publishes no signal asserting that an address resolved end to end, while a domain several steps deeper reporting nothing yet is indistinguishable, at any shallower domain, from that deeper domain's own wave simply not having arrived — until the deeper domain itself begins to exist and reports its own first resolution. This wave describes one domain's own multiplicity across depth; several occupants sharing the same domain at the same depth is a distinct multiplicity, addressed by this library's own concurrent-occupant requirements rather than by this bullet (§5.2).
- **Same-entry mounts are ordinary distinct route owners, not a shared-registration gap**: `cpt-frontx-routing-fr-concurrent-occupant-projection` (§5.2) requires two concurrently mounted instances of the identical underlying extension to stay independently addressable within one domain. This already holds by construction: an extension is an instance, and each mount is its own separately registered route owner with its own independently declared extension token — never one route owner or one registration two mounts share. Two same-entry mounts that happened to declare the same token would therefore be caught by the ordinary registration-time conflict check, above, exactly as any other pair of route owners declaring the same token is; there is no special same-entry case, no missing discriminator to mint, and no gap for another package's requirements to close.
- **Decided at provider level, outside this PRD — an occupant's own internal routing state alongside domain-occupancy addressing**: this PRD requires each concurrently mounted occupant of a domain to stay independently addressable, with its own parameters resolving back to it alone (§5.2). How an occupant's own internal navigation state — whatever screen or view that occupant itself is currently showing inside its own zone — coexists with that addressing, once the occupant is one of several mounted side by side rather than a domain's sole occupant, is not decided by this PRD: the ecosystem's own default engine provider reserves the payload parameter `route` for that purpose, a convention that provider adopts, not a rule this package or this PRD imposes (DESIGN §1.1, Navigation Substrate).

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Two independently bundled copies of this package end up with two separate history instances instead of one shared instance. | Programmatic navigation in one copy produces no change the other observes, so routers drift out of agreement with each other and with the URL. | The navigation substrate is reached through a single realm-shared instance rather than a per-bundle one, by construction, for every copy built against the same `NavigationHistory` contract version. This prevention holds within one contract version only: a copy built against a different version resolves under its own versioned key and constructs its own instance, so a cross-version mismatch yields one instance per version rather than a single shared one. |
| A replacement router engine's history adapter does not fully satisfy the shared history's contract. | The microfrontend that adopted it may navigate correctly in isolation while disagreeing with the rest of the realm. | The engine-provider port states the history contract the substrate expects; the engine-behind-port constraint keeps every other unit unaffected by the substitution either way. |
| A bookmark or deep link carries an entry whose extension token matches no registration the domain knows, or that was created under a different registration set. | The domain that would have resolved it reports the entry as unresolved rather than restoring the state the user expected; nothing in this library distinguishes "stale" from "not yet registered." | Reported as unresolved; after a page load the URL shows only what the application mounted, and after a back/forward step the FrontX router drops the entry from the URL, so the URL stays in sync with what is mounted (DESIGN §1.1, URL Grammar). |
| A payload value's own party builds its own query-string handling on `URLSearchParams` instead of this library's own codec. | `URLSearchParams` encodes `;` and `=` itself, so a value written through it would double-encode this grammar's own delimiters and corrupt neighbouring entries. | The grammar codec this package publishes is its own parser and serializer, never an adapter over `URLSearchParams`; every party reading or writing a payload value goes through this package's own API instead. |
