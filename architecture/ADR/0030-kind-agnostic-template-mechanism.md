---
status: proposed
date: 2026-07-16
---

# Whether the Platform Fixes a Template Taxonomy or Stays Kind-Agnostic

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Kind-agnostic mechanism](#kind-agnostic-mechanism)
  - [A fixed two-kind taxonomy](#a-fixed-two-kind-taxonomy)
  - [An open, extensible kind registry](#an-open-extensible-kind-registry)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-kind-agnostic-template-mechanism`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) installs, applies, and assembles templates it does not own, and a repository is assembled from one or more independently-applied templates (`cpt-frontx-fr-cli-composed-template-resolution`, `cpt-frontx-fr-cli-seed-repository`, `cpt-frontx-fr-cli-add-template-to-repository`). A prior design classified every template into one of a fixed set of kinds and organized the tooling around that classification. The question this decision settles is whether the platform fixes a taxonomy of template kinds that the mechanism branches on, or whether the assembly, resolution, and upgrade mechanism treats every template the same regardless of what it produces.

## Decision Drivers

* **Open-ended composition** — a repository is assembled from shells, microfrontends, libraries, configs, and combinations that no fixed taxonomy anticipates; the mechanism must admit any template a developer can author without the platform enumerating a kind for it first.
* **One mechanism, not per-kind branches** — install, apply, assemble, conflict-check, and upgrade should be one code path over any template; branching the mechanism by kind multiplies the surface and couples the tool to a closed vocabulary.
* **Templates describe themselves** — what a template produces and the ground it claims are properties the template declares (its manifest and ownership boundaries), so the tool needs no kind label to operate on it.
* **Evolvability without a vocabulary change** — introducing a new sort of template must not require a platform release that widens a fixed enumeration, so the contract and the tool stay stable as the ecosystem's templates diversify.
* **Composition expressed by reference, not by kind** — a template that arranges others (a preset) does so by referencing them, an explicit relationship, rather than by a kind that the tool special-cases.

## Considered Options

* **Kind-agnostic mechanism** — the platform fixes no taxonomy of template kinds; every template declares what it produces and the boundaries of what it owns, and the install/apply/assemble/conflict-check/upgrade mechanism operates identically over any template. Composition is expressed by one template referencing others (a preset), not by a kind label the tool branches on.
* **A fixed two-kind taxonomy** — the platform enumerates exactly two template kinds (a repository-seeding kind and a unit-contributing kind), each template declares its kind in a required field, and the tooling is organized around that distinction.
* **An open, extensible kind registry** — the platform ships a set of kinds but lets templates register new kinds, so the taxonomy grows without a platform release while the mechanism still branches on a kind value.

## Decision Outcome

Chosen option: **Kind-agnostic mechanism**, because it is the only option that admits open-ended composition through a single mechanism while letting templates describe themselves. Every template declares what it produces and the boundaries of what it owns; the CLI installs, applies, assembles, conflict-checks, and upgrades any template through one path that never branches on a kind. A template that arranges others is a **preset**: it references the templates to apply together (`cpt-frontx-adr-template-manifest-contract`), and reference — not a kind — is how composition is expressed and resolved (`cpt-frontx-adr-composed-template-resolution`). Conflicts between what independently-applied templates claim are arbitrated by their declared ownership boundaries (`cpt-frontx-adr-template-ownership-boundary-declaration`, `cpt-frontx-adr-assembly-conflict-prevention`), a mechanism that is likewise kind-agnostic.

The fixed-two-kind taxonomy is rejected because a closed enumeration cannot anticipate the shells, libraries, configs, and combinations a developer assembles, so it forces every new sort of template through a widening of the vocabulary and a per-kind branch in the tool; it also invites conflating a kind with the output it produces. The extensible-kind-registry option removes the closed-vocabulary limit but keeps the mechanism branching on a kind value and adds a registry to steward, paying the cost of a taxonomy without the benefit of a closed one — when the self-describing manifest and ownership boundaries already carry everything the mechanism needs.

The scope of this decision is that the platform fixes no template taxonomy and the mechanism is kind-agnostic. It does not decide the manifest's shape (`cpt-frontx-adr-template-manifest-contract`), how boundaries are declared (`cpt-frontx-adr-template-ownership-boundary-declaration`), or how a preset's references resolve (`cpt-frontx-adr-composed-template-resolution`).

### Consequences

* Good, because any template a developer can author is admitted without the platform first enumerating a kind for it, so composition is open-ended.
* Good, because install, apply, assemble, conflict-check, and upgrade are one mechanism over every template rather than per-kind branches, keeping the tool surface small.
* Good, because a template describes itself through its manifest and ownership boundaries, so the tool needs no kind label to operate on it.
* Good, because a new sort of template requires no widening of a fixed vocabulary and no platform release to admit it.
* Bad, because without a declared kind the tool cannot offer kind-specific affordances or validation shortcuts; any such behavior must be derived from what a template declares, not from a label.
* Bad, because a preset expresses composition by reference, so a malformed or cyclic reference must be detected by resolution rather than ruled out by a kind constraint.

### Confirmation

Compliance is confirmed by design and code review plus a continuous-integration check on the CLI package: the manifest contract carries no `kind` field, the install/apply/assemble/upgrade code path contains no branch on a template-kind value, and a fixture assembles a repository from templates of visibly different sorts (a seeding template, a unit-contributing template, a config template) through the identical mechanism. A second check asserts a preset resolves its referenced templates by reference and that no kind value gates that resolution.

## Pros and Cons of the Options

### Kind-agnostic mechanism

The platform fixes no taxonomy; templates self-describe, and one mechanism operates over any template, with composition expressed by reference.

* Good, because composition is open-ended and admits any authored template.
* Good, because the mechanism is one path, not per-kind branches.
* Good, because templates need no platform-blessed kind to be operated on.
* Neutral, because it relies on the manifest and ownership-boundary contracts to carry the self-description the mechanism reads.
* Bad, because kind-specific affordances are unavailable and cyclic references must be caught by resolution.

### A fixed two-kind taxonomy

The platform enumerates two kinds; each template declares one, and the tool is organized around the distinction.

* Good, because two kinds make a familiar seed-versus-contribute distinction explicit in the surface.
* Good, because a closed set is simple to validate against.
* Bad, because a closed enumeration cannot anticipate the range of templates a repository is assembled from, forcing new sorts through a vocabulary change.
* Bad, because a kind value invites conflating a template with the output it produces and branches the mechanism by kind.

### An open, extensible kind registry

The platform ships kinds but lets templates register new ones; the mechanism still branches on a kind value.

* Good, because the taxonomy can grow without a platform release.
* Bad, because the mechanism still branches on a kind, keeping the per-kind surface.
* Bad, because a registry of kinds is itself a contract to steward, paying a taxonomy's cost without a closed set's benefit.

## More Information

The self-describing manifest this decision relies on is decided in `cpt-frontx-adr-template-manifest-contract`; the ownership-boundary declaration that lets independently-applied templates be arbitrated is decided in `cpt-frontx-adr-template-ownership-boundary-declaration`; preset reference resolution is decided in `cpt-frontx-adr-composed-template-resolution`. These are non-binding pointers to related decisions and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because a taxonomy decision binds no latency or throughput budget. **SEC** — Not applicable, because it introduces no secret material or authentication surface. **REL** — Not applicable, because no service-availability target attaches to a local mechanism. **DATA** — Not applicable, because this decision fixes no schema; the manifest schema is owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership`. **INT** — addressed: removing a kind field from the manifest keeps the published contract self-describing without a classification vocabulary. **OPS** — Not applicable, because no operational procedure attaches to the mechanism. **MAINT** — addressed directly: one mechanism over any template reduces the surface and removes a vocabulary to steward. **COMPL** — Not applicable. **UX** — addressed implicitly: a developer assembles any template through one predictable set of commands. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-composed-template-resolution` — Establishes that multi-template assembly and preset resolution operate over any template without a kind classification, so composition is expressed by reference rather than by kind.
* `cpt-frontx-contract-template-manifest` — Fixes that the manifest carries no kind field; a template is self-describing through what it produces and the boundaries it declares.
* `cpt-frontx-component-cli` — The CLI component operates one kind-agnostic mechanism over every template; this decision constrains it to hold no branch on a template kind.
