---
status: accepted
date: 2026-08-27
decision-makers: German Bartenev
---

# Occupant Reference Boundary

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Opaque Occupant port, adapted by a separate glue layer](#opaque-occupant-port-adapted-by-a-separate-glue-layer)
  - [Direct import of the concrete extension type](#direct-import-of-the-concrete-extension-type)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-occupant-reference-boundary`

## Context and Problem Statement

Route Ownership Signal (`cpt-frontx-feature-routing-route-ownership-signal`) resolves a domain level's local URL remainder to a route owner, and reports that resolution to the consumer holding that level. That route owner is, in this ecosystem, ultimately an `mfes` runtime `Extension` — the concrete registration type carrying `id`, `domain`, `entry`, and, for a screen, a `presentation.route` (`packages/mfes/src/types/index.ts`). How should the routing core name and carry that identity through resolution and reporting without itself depending on the concrete extension type the `mfes` runtime defines?

## Decision Drivers

* Standalone package boundary — `@gears-frontx/routing` imports no other ecosystem package and calls no consumer of its own (`cpt-frontx-routing-nfr-standalone`), enforced mechanically by the `arch:edges`/`arch:deps` boundary guards, not merely by convention.
* Agnostic core — the navigation substrate and the route ownership signal built on it carry no dependency on a concrete router engine or UI framework, and by the same reasoning carry no dependency on a concrete extension-registration format either (`cpt-frontx-routing-nfr-agnostic-core`).
* Precedent consistency — this package already treats its router-engine dependency the same way: `NavigationHistory` (`location`, `subscribe`, `push`, `replace`, `go`) is an opaque port a separately published engine-provider package (`@gears-frontx/routing-tanstack`) implements, never a concrete engine import inside the core (`cpt-frontx-adr-core-package-boundaries`).
* Standalone deployment — a microfrontend served on its own, with no `mfes` runtime present at all, still needs the route ownership signal to resolve against something; a hard dependency on the concrete `Extension` type would tie that resolution to a runtime that standalone deployment does not have.

## Considered Options

* **Opaque Occupant port, adapted by a separate glue layer** — the routing core resolves against an abstract `Occupant`: a stable identity plus an opaque parameter bag, with no knowledge of `mfes`'s `Extension` shape; a glue/adapter layer, architecturally the same role `routing-tanstack`'s Engine Provider already plays for the router engine, maps concrete `Extension` registrations into that port.
* **Direct import of the concrete extension type** — the routing core imports `@gears-frontx/mfes` and resolves directly against `Extension`/`ScreenExtension`, skipping an adapter layer.

## Decision Outcome

Chosen option: **opaque Occupant port, adapted by a separate glue layer**, because it is the only option consistent with this package's own CI-enforced boundary properties and with the precedent it already set for its router-engine dependency. `cpt-frontx-routing-nfr-standalone` requires zero intra-ecosystem edges in this package's manifest and import graph, checked mechanically by the boundary guards; importing `@gears-frontx/mfes` directly would add exactly the edge that requirement forbids. `cpt-frontx-routing-nfr-agnostic-core` requires the package to carry no dependency on a concrete router engine or UI framework "whatsoever" — the same rationale extends to a concrete extension-registration format, since binding route resolution to one runtime's own registration shape would reintroduce, for extension identity, precisely the coupling the engine-provider port already exists to avoid for router engines. The routing DESIGN already names the shape this decision follows: `NavigationHistory` is "deliberately narrower than what any concrete engine's own history contract typically requires," carried as a port the substrate declares and a separately published provider satisfies (`packages/routing/architecture/DESIGN.md` §1.1). An Occupant port is the same pattern applied to the other side of the resolution: a stable identity and an opaque parameter bag are all the route ownership signal needs to report a transition; everything else about what that identity names — that it is an `mfes` `Extension`, which domain it targets, which entry it mounts — is exactly the kind of runtime-specific knowledge `cpt-frontx-routing-principle-publishes-not-orchestrates` already keeps out of this package.

### Consequences

* Good, because the package keeps its zero-intra-ecosystem-edge property, verifiable by the same `arch:edges`/`arch:deps` guards that already check it today.
* Good, because a standalone deployment — no `mfes` runtime present — still resolves through the same Occupant port; nothing about it presupposes the runtime exists.
* Good, because a future second host runtime, or a second type-system provider for extensions, needs only its own glue layer against the same port, not a change to the routing core.
* Bad, because every consumer bridging `mfes` extensions into route ownership carries one more layer than a direct import would: the glue that maps `Extension` registrations into `Occupant` pairs.
* Bad, because a mismatch between an `Occupant`'s opaque parameter bag and what a concrete `Extension` actually carries is caught only where the glue layer maps one into the other, not by a compiler-checked import of the concrete type inside the routing core itself.

### Confirmation

Confirmed the same way this package's existing standalone and agnostic-core properties are confirmed: the boundary guards (`arch:edges`, `arch:deps`) report zero intra-ecosystem edges in this package's manifest and import graph, and a design/code review of the Occupant port's own shape confirms it carries no field, literal, or import that names `@gears-frontx/mfes` or any other concrete extension-registration format.

## Pros and Cons of the Options

### Opaque Occupant port, adapted by a separate glue layer

The routing core declares `Occupant` as a stable identity plus an opaque parameter bag; a glue layer external to this package maps concrete `mfes` `Extension` registrations into that shape, the same role the Engine Provider already plays for `NavigationHistory`.

* Good, because it preserves the zero-intra-ecosystem-edge property the package already claims and that CI already enforces.
* Good, because it is architecturally consistent with the one precedent this package already set for an external dependency (the engine-provider port), rather than introducing a second, differently-shaped rule for extension identity.
* Neutral, because it requires a glue layer to exist somewhere, symmetric to the engine-provider package this design already requires for the router engine.
* Bad, because a resolution bug at the Occupant/Extension seam surfaces one layer away from where the concrete extension is declared, in the glue rather than in the routing core.

### Direct import of the concrete extension type

The routing core imports `@gears-frontx/mfes` and resolves against `Extension`/`ScreenExtension` directly, with no intermediate abstraction.

* Good, because there is one fewer layer between a declared route owner and the code that resolves it, and no separate mapping to keep in sync.
* Bad, because it adds an intra-ecosystem edge this package's own NFR (`cpt-frontx-routing-nfr-standalone`) forbids, breaking a property the boundary guards already check today.
* Bad, because it ties route resolution to one runtime's own extension-registration format, contradicting the agnostic-core property (`cpt-frontx-routing-nfr-agnostic-core`) and the precedent already set for the router engine.
* Bad, because a standalone deployment with no `mfes` runtime present would still carry the import, even though nothing in that deployment mode uses it.

## More Information

Diagram note: this decision is a single binary comparison — the chosen Occupant-port abstraction against the one rejected alternative of a direct concrete import — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs only how the routing core (`@gears-frontx/routing`) names and carries route-owner identity through resolution and reporting. It does not decide how a concrete glue layer maps `mfes` `Extension` registrations into the Occupant port — that mapping is the glue layer's own concern, outside this package's boundary — nor does it revisit the engine-provider port this ADR draws its precedent from (`cpt-frontx-routing-fr-engine-provider-port`).

**Review trigger.** Revisit if a requirement emerges for the routing core itself to interpret a field of the concrete extension registration (rather than treating the whole parameter bag as opaque), which would undercut the rationale for keeping the port abstract.

**Checklist applicability.**

* ARCH — applicable and addressed above (an architecturally significant, hard-to-reverse boundary decision affecting every consumer that bridges extension registrations into route ownership).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern; it only shapes what identity shape crosses a package boundary.
* PERF — Not applicable because an opaque identity-plus-parameter-bag port carries no different runtime cost than a concrete-type import at the volumes this package operates at.
* REL — Not applicable because it governs a compile-time/import-graph boundary, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: the Occupant port is itself an integration contract between the routing core and whatever glue layer bridges a concrete runtime's extensions into it; its shape is owned by this package going forward, and a breaking change to it is scoped the same way `cpt-frontx-routing-fr-engine-provider-port` already scopes a breaking change to `NavigationHistory`.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: the port keeps the routing core's own blast radius bounded to this package when the concrete extension-registration format changes, at the cost of the extra glue layer noted above.

## Traceability

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-nfr-standalone` — the Occupant port is what lets route resolution avoid the intra-ecosystem edge this NFR forbids.
* `cpt-frontx-routing-nfr-agnostic-core` — extends this package's existing engine-agnosticism to extension-registration-format agnosticism.
* `cpt-frontx-routing-fr-route-ownership-signal` — the signal reports Occupant identity, not concrete `Extension` identity, at every domain level and axis.
* `cpt-frontx-routing-fr-engine-provider-port` — the precedent this decision follows: an opaque port satisfied by an external adapter, rather than a concrete dependency inside the core.
* `cpt-frontx-component-routing-navigation-substrate` — the component whose resolution primitive this decision keeps free of any concrete extension-registration import.
