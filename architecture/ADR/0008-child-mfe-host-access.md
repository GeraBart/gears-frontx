---
status: accepted
date: 2026-06-05
---

# Child MFE Access to the Host


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Narrow capability bridge delegating to the registry](#narrow-capability-bridge-delegating-to-the-registry)
  - [Direct registry reference](#direct-registry-reference)
  - [Message-passing protocol only](#message-passing-protocol-only)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-child-mfe-host-access`
## Context and Problem Statement

A child microfrontend runs isolated from the host yet must still interact with it: execute actions chains, read and subscribe to shared properties, and register handlers for actions targeted at itself. A child may itself be a host to further-nested microfrontends, so the same bridge relationship recurs at every level of nesting. Handing the child a reference to the host runtime would couple child code to runtime internals and widen the surface a child can reach. What should the host give a child so the child gains exactly the capabilities it needs to participate — and nothing more — while the host retains a matching handle to manage and dispose the child instance, at any nesting depth?

## Decision Drivers

* Minimal capability surface — a child receives only the operations it needs to participate; the runtime's internals stay encapsulated behind that surface.
* Reachability across nesting levels without widening the surface — the same narrow four-method bridge must remain sufficient no matter how many hosting levels separate a child from the shell; any additional cross-runtime bookkeeping this requires must be internal to the bridge/registry, not a new public method.
* Stable child-facing contract — the capabilities a child depends on must not change when runtime internals change (anchors `cpt-frontx-interface-mfe-runtime`).
* Delegation, not duplication — bridge operations route to the single runtime authority (the registry and its mediator) rather than re-implementing coordination inside the bridge.
* Symmetric parent handle — the host needs a matching narrow handle to identify a child instance and tear it down deterministically.
* Enforceable boundary — the rule that child code depends only on the capability surface, never on concrete runtime internals, must be expressible as a continuous-integration check.

## Considered Options

* **Narrow capability bridge delegating to the registry** — the child receives an abstract bridge exposing exactly the capability methods it needs (`executeActionsChain`, `subscribeToProperty`, `getProperty`, `registerActionHandler`), each delegating to the registry and its mediator; the host holds a matching narrow parent handle (instance identity plus disposal).
* **Direct registry reference** — the host hands the child a reference to the runtime registry object itself.
* **Message-passing protocol only** — child and host communicate solely through serialized messages over a transport, with no typed capability object given to the child.

## Decision Outcome

Chosen option: **narrow capability bridge delegating to the registry**, because it is the only option that gives a child exactly the participation capabilities it needs while keeping runtime internals encapsulated and the child-facing contract stable. The abstract child bridge exposes only `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler`; each method delegates to the registry and its mediator rather than carrying coordination logic of its own. The host holds a matching abstract parent handle exposing only the child's instance identity and `dispose()`, giving the host deterministic control over the child's lifecycle. The bridge thereby exposes only a narrow capability surface, and the concrete implementation's transport and wiring internals remain encapsulated behind the abstract contract.

The registry's own inbound bridge — the bridge its host extension received when it was mounted — is what lets registration reach beyond the immediate parent–child pair: it is the channel a registry uses both to propagate a forwarding advertisement upward when it admits a domain or extension, and to escalate a chain upward when its own resolution finds no handler (both decided in `cpt-frontx-adr-action-dispatch-and-chaining`). This inbound bridge is registry-internal plumbing, not part of the child-facing capability surface — it does not add a fifth method, and it is never handed to child code. The child-facing bridge therefore remains exactly the four capability methods regardless of how many nesting levels separate a child from the shell: registration propagation and upward escalation are automatic behavior triggered by domain and extension admission and by disposal, requiring no explicit registration call, no additional bridge method, and no action by the microfrontend author. This narrows, rather than widens, the bridge's manual cross-runtime-forwarding responsibility — what would otherwise require an explicit child-domain-registration step on the public surface instead becomes internal registry behavior — so automatic reachability across nesting is compliant with, not in tension with, the minimal-capability-surface driver.

Because the host extension that a nested registry links to may hold its own independently loaded copy of this package (`cpt-frontx-adr-mfe-load-isolation`), the registry cannot identify itself to the parent, nor the parent to it, through any shared class or module state — only the bridge object itself, and a realm-global rendezvous for the moment of adoption, cross that boundary reliably (mechanism decided in `cpt-frontx-adr-action-dispatch-and-chaining`). This is why a nested registry's lifetime is expected to track its host extension's mount lifetime: constructed no later than synchronously within that extension's own `mount` call, and left to the parent registry to unlink — not dispose — on that extension's unmount, mount failure, or disposal. The parent owns the link; the microfrontend author still owns the registry object and decides when to `dispose()` it.

### Consequences

* Good, because a child depends only on a small, stable capability surface, so runtime internals can change without breaking child code.
* Good, because the bridge exposes only a narrow capability surface; the concrete implementation's transport and wiring internals remain encapsulated.
* Good, because each capability delegates to the single runtime authority, so behavior stays consistent with host-side dispatch and no coordination logic is duplicated in the bridge.
* Good, because the symmetric parent handle gives the host deterministic identity and disposal control over each child instance.
* Bad, because every capability a child may legitimately need must be deliberately added to the abstract surface, so extending child capability is an explicit contract change rather than incidental access.
* Bad, because the delegation indirection means a child cannot reach a runtime capability that the bridge does not expose, even when convenient.
* Good, because reachability across nesting levels is an automatic consequence of admission — already governed by the domain- and extension-admission decisions — rather than a second, separate act a microfrontend author must invoke; admission remains the sole enforceable gate for what becomes reachable, so there is no weaker second gate introduced by nesting.
* Good, because the child-facing bridge stays at exactly four methods no matter how deep the nesting, since the inbound bridge that carries propagation and escalation is registry-internal and never exposed to child code.
* Good, because the parent owning link revocation, rather than depending on the microfrontend author to dispose their own registry on unmount, means a registry that outlives its host's unmount degrades safely to unlinked rather than leaving stale state in every ancestor.
* Bad, because a nested registry's automatic linking is scoped to its host extension's own mount lifetime — a registry built and reused across remounts, or constructed asynchronously after `mount` has already returned, is not automatically re-linked and stays degraded to root-registry behavior until rebuilt inside a fresh mount call.

### Confirmation

Architecture review confirms that the abstract child bridge exposes exactly the four capability methods and that the abstract parent handle exposes only instance identity and `dispose()`. A continuous-integration check (an import-boundary grep) confirms that child-facing code depends only on the abstract bridge — never on a concrete bridge implementation or on the registry directly — and that each capability method delegates to the registry or its mediator rather than implementing coordination inline.

## Pros and Cons of the Options

### Narrow capability bridge delegating to the registry

The child holds an abstract bridge of exactly the capabilities it needs; each delegates to the registry and mediator. The host holds a matching narrow parent handle.

* Good, because the child-facing surface is minimal and stable while runtime internals stay encapsulated.
* Good, because delegation keeps child-initiated behavior consistent with host-side dispatch.
* Good, because the parent handle gives deterministic lifecycle control.
* Neutral, because it requires an abstract contract on both the child and parent sides plus wiring that injects the delegation callbacks.
* Bad, because extending what a child can do is an explicit contract change.

### Direct registry reference

The host gives the child the registry object directly.

* Good, because the child can reach any runtime capability without a mediating contract.
* Bad, because the child couples to runtime internals, so internal changes ripple into child code and the reachable surface is unbounded.
* Bad, because there is no narrow, enforceable boundary between participation capability and runtime internals.

### Message-passing protocol only

Child and host exchange serialized messages over a transport, with no typed capability object.

* Good, because it imposes a hard process-style boundary and avoids sharing any object across the divide.
* Bad, because every capability must be re-expressed as ad hoc message conventions, losing the typed, discoverable contract a capability object provides.
* Bad, because request/response capabilities like reading a property synchronously become awkward round-trips, complicating ordinary child participation.

## More Information

The present concrete instantiation is the abstract `ChildMfeBridge` (`packages/mfes/src/handler/types.ts`), which exposes `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler`; its concrete implementation `ChildMfeBridgeImpl` (`packages/mfes/src/bridge/ChildMfeBridge.ts`) delegates `executeActionsChain` to an injected registry callback and `registerActionHandler` to a mediator-registration callback, while its transport and wiring methods are not part of the abstract surface. The matching abstract `ParentMfeBridge` (`packages/mfes/src/handler/types.ts`) exposes only `instanceId` and `dispose()`. Forwarding of actions to a child's own domains is carried by the mediator's catch-all tier through `ChildDomainForwardingHandler` (`packages/mfes/src/bridge/ChildDomainForwardingHandler.ts`), and the routing that tier participates in — including registration propagation and upward escalation through the registry's own inbound bridge — is decided in `cpt-frontx-adr-action-dispatch-and-chaining`.

**Scope of impact.** Applies to the capability surface a child microfrontend receives and the parent handle the host retains, at any nesting depth. It does not decide how a bundle is loaded or isolated, nor how the mediator routes, propagates, or escalates actions internally (decided in `cpt-frontx-adr-action-dispatch-and-chaining`).

**Review trigger.** Revisit if a child requires a participation capability that cannot be expressed as a delegating method on the bridge, or if the host needs richer lifecycle control than instance identity and disposal.

**Checklist applicability.**

* ARCH — applicable and addressed above (a boundary decision affecting every child microfrontend and the host, and hard to reverse once children depend on the capability surface).
* ARCH-ADR-008 (supersession) — Not applicable because this is a new, standalone decision that supersedes no prior record.
* INT — applicable: the bridge is the child-facing half of the host↔MFE communication contract; its breaking-change policy is governed by `cpt-frontx-interface-mfe-runtime`.
* PERF — Not applicable because this is a surface-shape decision, not a runtime-performance decision.
* SEC — Not applicable because, while the narrow surface constrains what a child can reach, this decision introduces no secret, credential, or authorization mechanism of its own.
* REL — Not applicable because it governs the capability surface, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-host-communication` — the capability bridge is how a child microfrontend communicates with the host and reacts to host state, through a narrow delegating surface; the requirement is unqualified as to how many hosting levels separate a microfrontend from the host, and its own assumptions already anticipate multiple registry instances coexisting, so the bridge's reachability guarantee holds regardless of nesting depth.
* `cpt-frontx-interface-mfe-runtime` — the child bridge and parent handle are part of the runtime's public surface and are governed by its breaking-change policy.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the parent–child communication boundary of the MFE Runtime component.
* `cpt-frontx-principle-agnostic-core` — the bridge carries only opaque type and property identifiers, holding no type-format knowledge of its own.
