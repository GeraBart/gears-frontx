---
status: accepted
date: 2026-08-27
decision-makers: German Bartenev
---

# Mount Trigger Ownership

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Actions-chains drives every post-boot mount; navigation drives only cold load](#actions-chains-drives-every-post-boot-mount-navigation-drives-only-cold-load)
  - [Navigation continues to drive mounting for every post-boot transition](#navigation-continues-to-drive-mounting-for-every-post-boot-transition)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-mount-trigger-ownership`

## Context and Problem Statement

`cpt-frontx-routing-principle-publishes-not-orchestrates` already states that Route Ownership Signal publishes ownership transitions and never orchestrates mounting itself, leaving mounting to whichever mount mechanism already holds the occupancy registry — the `mfes` runtime's mount strategies and `crossValidateHandlers` cardinality matrix (`cpt-frontx-adr-extension-domain-occupancy`). That leaves open a narrower question this record settles: after the application has booted, which channel is allowed to *drive* a mount at all — the URL, through navigation, or the runtime's own actions-chains mediator (`cpt-frontx-adr-action-dispatch-and-chaining`)? A `NavigationHistory` singleton is realm-global, and its `location`/subscriber notification exposes each subscriber the browser's full current URL — path, search, and hash together, not scoped to any one domain's own slice. If navigation continued to drive mounting after boot, that same realm-global visibility would let one runtime's mount react to another runtime's own URL segment, reintroducing cross-runtime coordination through the address bar that PR #585's own review history already flagged once: an earlier revision of this work had a routing feature orchestrate mounting through injected ports, and two review rounds put ten of their seventeen findings against it, because it was modelling domain occupancy the runtime already owns.

## Decision Drivers

* Publishes, does not orchestrate — the routing package's own design principle (`cpt-frontx-routing-principle-publishes-not-orchestrates`) already forbids this package from holding an occupancy model; whichever channel drives mounting post-boot must not force this package to hold one anyway just to keep the URL and the mounted set honest.
* Cross-runtime isolation despite a realm-global history — `NavigationHistory` is one realm-shared singleton (`cpt-frontx-routing-principle-single-history-authority`) whose fan-out and `location` are visible to every subscriber regardless of which runtime it belongs to; no runtime should need to read another runtime's own route segment to react correctly to its own domain's occupancy.
* Review-proven failure mode — an earlier revision of this same body of work already modelled domain occupancy through navigation-adjacent orchestration and drew ten of seventeen findings across two review rounds for exactly that reason (PR #585 description); the chosen mechanism must not reintroduce that shape.
* Deep-link and reload correctness — a cold load or reload has no actions-chains history to replay, so the URL must still be authoritative at that one moment, even though it is not the driver afterward.

## Considered Options

* **Actions-chains drives every post-boot mount; navigation drives only cold load** — mounting via navigation happens only for the initial/cold load; every mount and unmount after that is triggered exclusively through the actions-chains channel, and the URL back-projection helper reflects the resulting state into the address bar afterward. Route is a byproduct of action-chain execution post-boot, never its driver.
* **Navigation continues to drive mounting for every post-boot transition** — every mount and unmount, cold or not, is triggered by a navigation event that Route Ownership Signal reports, with the consumer's mount mechanism reacting to that report at every domain level for the application's whole lifetime.

## Decision Outcome

Chosen option: **actions-chains drives every post-boot mount; navigation drives only cold load**, because it is the only option that keeps the URL from becoming a cross-runtime control channel while still resolving correctly on cold load and reload. Making navigation the post-boot driver would mean every mount decision, at every domain level in every runtime, has to react to the one realm-global `NavigationHistory` fan-out — the same singleton every other runtime's own levels also subscribe to (`cpt-frontx-routing-principle-single-history-authority`) — which is precisely the shape that drew ten of PR #585's own seventeen review findings when an earlier revision tried it through injected ports instead. Routing this package already owns exactly one channel among the ecosystem's three host–microfrontend channels — the URL (`packages/routing/architecture/DESIGN.md` §1.1, "Channel boundary") — while addressed action dispatch is owned by the runtime's actions-chains mediator (`cpt-frontx-adr-action-dispatch-and-chaining`). Keeping the URL a pure *reflection* of mount state post-boot, rather than its driver, is what keeps this package's one owned channel from doubling as an implicit second occupancy-orchestration mechanism running alongside the one the runtime already owns (`cpt-frontx-routing-principle-publishes-not-orchestrates`, `cpt-frontx-adr-extension-domain-occupancy`). Because no runtime needs to read another runtime's own route segment to react to it once actions-chains is the sole post-boot driver — each runtime's mounts are driven by the chains addressed to it, not by watching the shared history for someone else's segment — cross-runtime route isolation holds despite the singleton's own full-URL visibility to every subscriber.

### Consequences

* Good, because no runtime needs to inspect another runtime's own slice of the URL to react correctly to its own occupancy, even though `NavigationHistory`'s fan-out technically exposes the whole current URL to every subscriber.
* Good, because the routing package's one owned channel (the URL) stays a reflection of mount state, never a second orchestration channel running alongside the runtime's actions-chains mediator, avoiding the exact review failure mode PR #585 already surfaced once.
* Good, because cold load and reload still resolve correctly: navigation-driven resolution at observer creation, not post-boot navigation, is what a deep link and a reload actually need.
* Bad, because two distinct triggers now exist for "why is this mounted" — cold-load navigation and post-boot action chains — and a maintainer must know which one applies to a given transition rather than treating navigation as the single uniform driver.
* Bad, because the URL back-projection helper becomes load-bearing for every post-boot mount, not an occasional convenience: every actions-chains-driven mount must call it, or the address bar silently drifts from what is actually mounted.

### Confirmation

Architecture and code review confirm that no consumer wires Route Ownership Signal's post-boot transition report directly to a mount call; every post-boot mount traces to an actions-chains dispatch instead, with the URL back-projection helper invoked afterward. The cold-load path is confirmed by `cpt-frontx-routing-seq-deep-link-cold-mount`, whose own diagram already shows resolution running once at observer creation from an already-current location, with no post-boot navigation branch feeding a mount call.

## Pros and Cons of the Options

### Actions-chains drives every post-boot mount; navigation drives only cold load

Cold load and reload resolve from the URL at observer creation; every subsequent mount and unmount is triggered by the runtime's actions-chains mediator, with the URL back-projection helper reflecting the result afterward.

* Good, because it keeps route resolution's realm-global visibility from becoming a cross-runtime coordination surface post-boot.
* Good, because it does not reintroduce the specific occupancy-modelling shape two prior review rounds already rejected in this same work.
* Neutral, because it requires every consumer to remember to call the back-projection helper after an actions-chains-driven mount, rather than getting URL reflection for free from navigation.
* Bad, because "what drives this mount" now depends on whether the application has finished booting, an extra fact a maintainer must track.

### Navigation continues to drive mounting for every post-boot transition

Route Ownership Signal's report, at every domain level, is what triggers the consumer's mount mechanism for the application's whole lifetime, cold load included.

* Good, because there is exactly one driver to reason about for the whole lifecycle, with no cold-load/post-boot split.
* Bad, because it makes the URL a de facto cross-runtime control channel: every runtime's mount decision reacts to the one realm-global `NavigationHistory` fan-out every other runtime also subscribes to.
* Bad, because it is the shape an earlier revision of this same work already tried through injected ports, drawing ten of seventeen review findings for modelling domain occupancy the runtime already owns.
* Bad, because it duplicates, inside this package's own consumer wiring, an occupancy-orchestration responsibility `cpt-frontx-routing-principle-publishes-not-orchestrates` already assigns entirely to the runtime.

## More Information

Diagram note: this decision is a single binary comparison — actions-chains as the sole post-boot driver against the one rejected alternative of navigation continuing to drive every post-boot mount — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs which channel is permitted to drive a mount or unmount after the application has booted. It does not decide the mount strategies or cardinality matrix themselves (owned by `cpt-frontx-adr-extension-domain-occupancy`) or the actions-chains dispatch and chaining mechanism itself (owned by `cpt-frontx-adr-action-dispatch-and-chaining`); it decides only that the latter, not navigation, is the post-boot trigger the former reacts to.

**Review trigger.** Revisit if a requirement emerges for a post-boot deep link (a URL change not produced by this package's own back-projection helper) to mount something directly, which would require re-admitting navigation as a post-boot driver and re-examining the cross-runtime visibility concern this decision resolves.

**Checklist applicability.**

* ARCH — applicable and addressed above (a coordination-pattern decision affecting every consumer that mounts extensions after boot, already proven hard to get right by two prior review rounds on this same work).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern.
* PERF — Not applicable because the choice of driver is a correctness/coupling decision, not a throughput or latency target.
* REL — Not applicable because it governs coordination shape, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: this decision fixes which of the ecosystem's two coordination channels (URL vs. actions-chains) a consumer integrates against for post-boot mounting, and is therefore part of what a consumer must conform to.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: keeping the URL a pure reflection bounds the blast radius of a future occupancy-model change to the runtime's actions-chains mediator, never to this package.

## Traceability

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-principle-publishes-not-orchestrates` — this decision is what keeps the routing package from becoming a second occupancy-orchestration channel once actions-chains, not navigation, drives post-boot mounting.
* `cpt-frontx-routing-principle-single-history-authority` — names the realm-global visibility this decision's cross-runtime isolation argument depends on.
* `cpt-frontx-routing-fr-route-ownership-signal` — the signal this decision restricts to cold-load/reload resolution and to reflecting, rather than driving, every post-boot mount.
* `cpt-frontx-routing-seq-deep-link-cold-mount` — the sequence whose cold-load resolution this decision leaves unchanged as the one navigation-driven path.
* `cpt-frontx-adr-action-dispatch-and-chaining` — the mechanism this decision names as the sole post-boot mounting driver.
* `cpt-frontx-adr-extension-domain-occupancy` — the occupancy model this decision keeps exclusively in the runtime's own mount mechanism, never duplicated by navigation-driven mounting.
