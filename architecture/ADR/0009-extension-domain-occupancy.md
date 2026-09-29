---
status: accepted
date: 2026-06-05
---

# Extension-Domain Occupancy


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Composable named mount strategies plus a cardinality matrix](#composable-named-mount-strategies-plus-a-cardinality-matrix)
  - [A single configurable strategy with occupancy flags](#a-single-configurable-strategy-with-occupancy-flags)
  - [Free-form per-domain mount handlers, no cardinality enforcement](#free-form-per-domain-mount-handlers-no-cardinality-enforcement)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-extension-domain-occupancy`
## Context and Problem Statement

An extension domain is a governed placement slot into which microfrontends are mounted, and different domains need fundamentally different occupancy semantics: some hold many occupants side by side, some hold at most one with an explicit way to empty the slot, and some hold exactly one that is swapped pre-emptively with no explicit teardown. The runtime must let a domain author pick the occupancy semantics for a domain while guaranteeing the domain's declared lifecycle actions are consistent with the chosen semantics. How should the runtime model occupancy so that a domain author selects a well-defined behavior and the runtime rejects domains whose declared actions are incompatible with that behavior? Within one Exclusive or Optional domain, requests that change occupancy can also arrive faster than a mount completes (rapid navigation issues one mount after another), so the runtime must also decide which of those requests run and in what order.

## Decision Drivers

* Distinct, well-defined occupancy semantics — many-occupant, zero-or-one, and pre-emptive-single must each be a first-class, named behavior rather than ad hoc per-domain code.
* Author selection at composition time — a domain author selects occupancy when building the domain implementation, keeping placement policy with the domain that owns it.
* Action–behavior consistency — a domain's declared lifecycle actions must match the occupancy behavior it selects, so an unmount-less behavior cannot advertise an unmount action and a many-occupant behavior cannot omit one.
* Fail-at-admission, not at runtime — an inconsistent domain must be rejected when it is registered, not discovered when a user triggers an action.
* Enforceable as a continuous-integration check — the consistency rule must be expressible as an automated invariant, not a convention.
* Substrate neutrality — occupancy semantics must carry no solution-specific domain vocabulary (anchors `cpt-frontx-constraint-mfes-no-layout-domain-values`).
* Bounded, latest-wins ordering — in a domain that holds at most one occupant, a burst of requests must end with the latest request, must never interrupt a mount already under way, and must not physically mount every intermediate request in turn.
* One timeout rule — a queued request is bounded by the same per-action timeout rule every action uses, and the queue changes nothing the actions-chains mediator decides (`cpt-frontx-adr-action-dispatch-and-chaining`).

## Considered Options

* **Composable named mount strategies plus a cardinality matrix** — the runtime ships a small set of named strategy classes (a concurrent many-occupant strategy, an optional zero-or-one strategy, and an exclusive pre-emptive-single strategy); a domain author composes the chosen strategy inside the domain implementation factory; at registration the runtime looks up the strategy's required/forbidden action row and rejects a domain whose declared actions do not match.
* **A single configurable strategy with occupancy flags** — one strategy class parameterized by booleans (allow-multiple, allow-explicit-unmount) instead of distinct classes, with the same actions validated against the flag combination.
* **Free-form per-domain mount handlers, no cardinality enforcement** — each domain supplies its own mount/unmount handlers directly, with no shared strategy abstraction and no admission-time check that declared actions match occupancy intent.

## Decision Outcome

Chosen option: **composable named mount strategies plus a cardinality matrix**, because it is the only option that makes each occupancy behavior a first-class, named, reusable unit while guaranteeing — at admission — that a domain's declared actions are consistent with the behavior it selected. The runtime exposes three distinct strategy classes: a concurrent strategy where occupants mount side by side, an optional strategy where mounting displaces a prior occupant and an explicit unmount empties the slot, and an exclusive strategy where mounting pre-emptively evicts any other occupant and no explicit unmount path exists. A domain author composes the chosen strategy inside the domain implementation factory. When the domain is registered, the runtime identifies the strategy and consults a cardinality matrix that defines, per strategy, which lifecycle actions the domain's declaration must include and which it must exclude; a domain whose declared actions do not satisfy that row is rejected at registration. The matrix governs only the named strategies and rejects any unrecognized strategy, keeping the occupancy model closed and well-defined.

**Occupancy queue in Exclusive and Optional domains.** An Exclusive or Optional domain orders the requests that change its occupancy through a queue of two slots: the running entry and one pending entry. The queue is internal to the domain's own mount action and, in an Optional domain, its own unmount action; it adds no public surface. An entry is one operation (a mount, or an explicit unmount) on one subject, meaning the extension it acts on, together with every request that joined it. Each request belongs to its own chain, which goes on with its `next` action when the request succeeds and with its `fallback` action when the request fails. A request joins an entry only when it has the same operation and the same subject; a mount of A never joins an unmount of A. A request matching the pending entry joins it. A mount of A matching the running mount of A joins the running entry, and any different pending entry is replaced as described below. Any other request is placed by how many slots are held:

* Queue empty — the request enters and starts.
* Only the running entry held — the request becomes the pending entry.
* Both slots held — the request replaces the pending entry. The replaced entry never starts, and every request in it, joined requests included, fails and takes its own chain's `fallback`. Diagnostics may name this failure class "superseded"; outcomes stay boolean (success or failure).

The running entry is never replaced or interrupted. When it finishes, each of its requests settles with the entry's outcome, so the mediator continues that request's chain with its own `next` on success or its own `fallback` on failure; the entry leaves the queue and the pending entry starts. A mount of an already-mounted extension completes at once only while the queue is empty and the domain is not being unregistered. While the queue holds an entry, it takes a slot like any request and, at its turn, succeeds without change if the extension is still the occupant. In an Optional domain an explicit unmount takes part in the same two slots. An unmount queued behind a mount of the same subject that failed succeeds without change, and an unmount whose subject is absent at its turn succeeds without change. Unregistering the domain follows the ordinary unregistration of a domain and closes its queue. The pending entry never starts, and every request in it fails and takes its own `fallback`. The running entry is not interrupted, and when it finishes, nothing is promoted. Once the unregistration begins, every request accepted while it is in progress fails at once without entering the queue and takes its own `fallback`, including a mount of a subject that is still mounted. Concurrent domains keep no queue: each request there follows the Concurrent strategy on its own.

For rapid navigation this means: with A running, requests for B, C and D arriving in turn leave B replaced by C and C replaced by D. A finishes, D starts, and the domain ends holding D. Only A and D are ever mounted.

**Queue timeout.** When the domain accepts a request, it starts a timer for that request. The timer's value comes from the one timeout rule every action uses: the action's declared timeout, otherwise the domain's default action timeout. The actions-chains mediator (the runtime part that runs each chain action by action) and the domain queue use that single rule definition. If the timer fires while the request is still pending and has not started, the request leaves the queue, never runs, fails, and takes its own `fallback`. Each request has its own timer; an entry with several requests leaves the queue only when its last request has left. A started request is never interrupted by its timer. `cpt-frontx-adr-action-dispatch-and-chaining` holds as decided: the mediator's own per-action bound still settles each attempt and never cancels a handler. Removing a pending request is the domain's own implementation acting on work it has not started, not a cancellation by the mediator.

Which channel may originate a change to that occupancy is decided here on the same reasoning, because it is the write authority over the model this record owns. Once an application has booted, a mount or unmount not yet represented in any history entry originates exclusively through the runtime's actions-chains mediator (`cpt-frontx-adr-action-dispatch-and-chaining`); a navigation act never originates one. This is binding, and it obliges three things. First, an occupancy originated after boot is reflected back into the address bar, so every state the address bar can later return to is one this record's own mount mechanism already authorized. Second, a navigation reaching a state a history entry already represents is a restoration rather than an origination: each affected domain re-resolves and its consumer reconciles its occupants against a decision the mediator already made, which is replay of that one channel rather than a second one. Third, where such a navigation reaches a projected state no live consumer recognizes, a consumer may treat it as an origination request only by re-dispatching that state through the actions-chains channel, never by mounting directly off the observed navigation signal. The URL projection of domain occupancy noted under More Information is therefore the address bar's reflection of this mechanism, never a second channel deciding it. The rules that carry these obligations are owned by the member that publishes the navigation signal, not by this record: O5 and O6 in [packages/routing/architecture/DESIGN.md](../../packages/routing/architecture/DESIGN.md) §2.3.

### Consequences

* Good, because each occupancy behavior is a named, reusable unit a domain author selects deliberately, rather than re-implemented per domain.
* Good, because an inconsistent domain (for example a pre-emptive-single domain that advertises an explicit unmount, or a many-occupant domain that omits one) is rejected when it is registered, before any user can trigger an inconsistent action.
* Good, because the consistency rule is a deterministic lookup against a fixed matrix, so it is enforceable as an automated invariant.
* Good, because the strategies and matrix carry no solution-specific domain names, keeping placement vocabulary out of the runtime.
* Good, because occupancy has exactly one writer for the whole ecosystem: a navigation act can restore an occupancy this mechanism already authorized, but can never invent one it did not.
* Good, because a cold load, a reload, and a back or forward step still resolve from the address bar without that resolution becoming a second occupancy-decision channel.
* Good, because a burst of requests in a single-occupant domain ends with the latest request, and at most two mounts run: the one already under way and the last one.
* Good, because the queue never holds more than two entries, so ordering and joining need nothing beyond the two slots.
* Good, because a queued request is bounded by the same timeout rule as every action, and the mediator's decision stays as it is.
* Bad, because the occupancy model is closed: a genuinely new occupancy behavior requires adding a strategy and a matrix row rather than configuring an existing one.
* Bad, because a domain author must understand which strategy implies which required and forbidden actions, so the matrix's rules must be documented and discoverable.
* Bad, because three distinct answers exist to "why is this occupant here" — cold-load resolution from the address bar, restoration of a state already authorized, and post-boot origination through the mediator — and a maintainer must know which one applies to a given transition.
* Bad, because reflecting an originated occupancy back into the address bar becomes load-bearing rather than an occasional convenience: an occupancy the address bar never carried is one no later restoring navigation can replay.
* Bad, because a replaced request fails although nothing went wrong with it; a chain author must treat that `fallback` as "a newer request won", not as an error to report.
* Bad, because a request that joins or waits behind the running entry can wait as long as the running entry takes; the mediator may settle its attempt as failed at its bound while the domain still completes the entry later.

### Confirmation

Architecture review confirms that each shipped strategy is a distinct named class and that the cardinality matrix defines a required/forbidden lifecycle-action row per strategy and rejects unrecognized strategies. An automated check exercises domain registration: a domain composed with each strategy and a matching action declaration is admitted, and a domain whose declaration breaks the strategy's row (a missing required action or a present forbidden action) is rejected at registration time. The grounding mechanism is the strategy set in `packages/mfes/src/runtime/ConcurrentMountStrategy.ts`, `packages/mfes/src/runtime/OptionalMountStrategy.ts`, and `packages/mfes/src/runtime/ExclusiveMountStrategy.ts`, and the registration-time matrix check `crossValidateHandlers` in `packages/mfes/src/runtime/DefaultMfeRegistry.ts`.

Architecture review confirms, for the origination rule, that no consumer wires a navigation-derived ownership report directly to a mount call for a state no history entry already represents, and that every post-boot origination traces instead to an actions-chains dispatch whose result is reflected back into the address bar. Reconciling occupants in response to a restoring navigation is held to no such rule and is expected, because the state such a report describes was authorized by this mechanism when the entry was first projected. Where a report describes a projected state no live consumer recognizes, review confirms the consumer reaches a mount only by re-dispatching that state through actions-chains.

For the occupancy queue, an automated check exercises an Exclusive and an Optional domain. A burst A, B, C, D ends with D mounted, only A and D are physically mounted, and the requests for B and C take their fallbacks. A pending request whose timer fires takes its fallback and never starts. A request with the same operation and subject joins its entry, and a mount never joins an unmount. Unregistering the domain fails the pending entry and leaves the running entry to finish, and nothing is promoted when it finishes. A request accepted while the unregistration is in progress, including a mount of a subject that is still mounted, fails at once without entering the queue and takes its fallback. A Concurrent domain keeps its per-extension behavior.

## Pros and Cons of the Options

### Composable named mount strategies plus a cardinality matrix

The runtime ships distinct named strategy classes; the domain author composes one; a matrix validates the domain's declared actions against the strategy at registration.

* Good, because occupancy semantics are first-class, named, and reusable.
* Good, because action–behavior consistency is guaranteed at admission rather than at action time.
* Good, because the matrix is a deterministic, automatable invariant.
* Neutral, because it requires a small, fixed catalog of strategies plus a maintained matrix row per strategy.
* Bad, because adding a new occupancy behavior means adding a class and a matrix row rather than flipping a flag.

### A single configurable strategy with occupancy flags

One strategy class parameterized by occupancy flags rather than distinct classes.

* Good, because there is one class to learn and the occupancy space is expressed compactly.
* Neutral, because the same matrix-style action validation can still run against flag combinations.
* Bad, because flag combinations admit nonsensical or untested permutations, weakening the guarantee that every supported behavior is well-defined.
* Bad, because behavior is selected by parameters rather than by a named, self-documenting type, making intent at the call site harder to read.

### Free-form per-domain mount handlers, no cardinality enforcement

Each domain supplies mount/unmount handlers directly with no shared abstraction or admission-time consistency check.

* Good, because it imposes no catalog and lets a domain do anything its author writes.
* Bad, because occupancy behavior is duplicated and inconsistent across domains, with no shared, named guarantee.
* Bad, because an action declaration inconsistent with the intended occupancy is not caught at admission and surfaces only when a user triggers the action.

## More Information

The present concrete instantiation ships three strategy classes — `ConcurrentMountStrategy`, `OptionalMountStrategy`, and `ExclusiveMountStrategy` — in `packages/mfes/src/runtime/ConcurrentMountStrategy.ts`, `packages/mfes/src/runtime/OptionalMountStrategy.ts`, and `packages/mfes/src/runtime/ExclusiveMountStrategy.ts` respectively, composed by a domain inside its `ExtensionDomainImplementationFactory.build(ctx)`. The cardinality matrix is applied by `crossValidateHandlers` in `packages/mfes/src/runtime/DefaultMfeRegistry.ts`: the concurrent and optional strategies require both a mount and an unmount lifecycle action in the domain's declaration, the exclusive strategy requires a mount action and forbids an explicit unmount action, and any unrecognized strategy is rejected. The specific class names and the present matrix rows are descriptive of the current instantiation and non-binding; the durable decision is the strategy-plus-matrix model.

**Occupancy ordering alternatives.** Three other ways to order occupancy requests were not chosen. An unbounded first-in, first-out queue runs every request in order, so a burst mounts each intermediate extension in turn and the domain passes through occupants nobody asked for last; deciding joins across many entries also needs per-subject tracking. Cancelling the running request in favor of the newest reaches the latest request soonest, but it interrupts a physical mount midway and makes the domain cancel work that the mediator deliberately never cancels. A single slot that refuses requests while busy is the simplest, but it drops the latest request, which is the one the user wants.

**Scope of impact.** Applies to how an extension domain's occupancy behavior is selected and how its declared lifecycle actions are validated at registration. It does not decide how an extension's entry is matched for compatibility with a domain (decided in `cpt-frontx-adr-domain-extension-compatibility`), nor how a microfrontend bundle is loaded or isolated (decided in `cpt-frontx-adr-mfe-load-isolation`). It also decides how an Exclusive or Optional domain orders the requests that change its occupancy. It additionally governs which channel may originate a change to that occupancy once an application has booted; it does not decide the actions-chains dispatch and chaining mechanism itself (decided in `cpt-frontx-adr-action-dispatch-and-chaining`), nor the URL grammar an occupancy projects into, which the navigation substrate's own architecture tree owns ([packages/routing/architecture/DESIGN.md](../../packages/routing/architecture/DESIGN.md)).

**Review trigger.** Revisit if an extension domain requires an occupancy behavior that none of the named strategies expresses, or if the action–behavior consistency rule needs to vary by domain beyond a fixed per-strategy matrix row. Revisit the origination rule if a requirement emerges for a consumer to reach a mount directly off an observed navigation signal rather than by re-dispatching through actions-chains, which would re-admit navigation as a second occupancy-decision channel. Revisit the queue if a domain needs every request of a burst to run, or needs a running mount to be interrupted.

**URL projection of domain occupancy (present detail, non-binding).** The query string carries one entry per mounted extension, written as `domain=extension;param=value`; a domain holding several extensions at once repeats its own key, once per extension; a domain nested inside another extension's own zone gets a dotted key built from that enclosing entry. The shell alone owns the path. The concrete grammar — token alphabet, escaping, ordering, and the signal a consuming domain reads its own entries from — is recorded by the routing package's own architecture decision on addressing, not restated here. This decision continues to own the mount strategies and the cardinality matrix.

**Checklist applicability.**

* ARCH — applicable and addressed above (a runtime placement decision affecting every extension domain and the microfrontends that occupy it, and hard to reverse once domains depend on the strategy catalog).
* ARCH-ADR-008 (supersession) — Not applicable because this decision replaces no other record.
* SEC — Not applicable because occupancy selection and cardinality validation introduce no secret, credential, authorization, or admission-trust mechanism; arbitrary-code admission and isolation are decided in `cpt-frontx-adr-mfe-load-isolation`.
* PERF — applicable in one narrow respect: under a burst of requests the queue bounds the physical mounts to the running one and the last one.
* REL — applicable in one narrow respect: every queued request settles, by running, by being replaced, by its own timer, or by domain unregistration, and each failure takes its own `fallback`; the running entry is never interrupted.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: the origination rule fixes which of the ecosystem's two coordination channels — the address bar or the actions-chains mediator — a consumer integrates against when it changes occupancy after boot, and is therefore part of what a consumer must conform to. A chain author also integrates against the replacement failure, which the chain answers with its `fallback`.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-multi-occupant-domain` — mount strategies are how a domain declares whether it permits multiple occupants, and the cardinality matrix admits or rejects domains accordingly.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the extension-domain occupancy and admission behavior of the MFE Runtime component, including how an Exclusive or Optional domain orders the requests that change its occupancy through its two-slot queue.
* `cpt-frontx-constraint-mfes-no-layout-domain-values` — the strategies and matrix carry no specific domain values, leaving which domains exist and what they are named to the application.
* `cpt-frontx-principle-agnostic-core` — occupancy semantics are expressed as substrate-level strategies that hold no solution-specific vocabulary.
