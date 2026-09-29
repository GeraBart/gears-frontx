# Feature: Host-MFE Communication: Mediator & Bridge


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Dispatch Actions Chain to MFE Target](#dispatch-actions-chain-to-mfe-target)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Mediator Keyed Dispatch and Recursive Chain Execution](#mediator-keyed-dispatch-and-recursive-chain-execution)
  - [Registration Propagation, Escalation, and Retraction](#registration-propagation-escalation-and-retraction)
  - [Bridge Delegation to Registry](#bridge-delegation-to-registry)
- [4. States (CDSL)](#4-states-cdsl)
  - [Action State Machine](#action-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Mediator Keyed Dispatch and Recursive Chain Execution](#mediator-keyed-dispatch-and-recursive-chain-execution-1)
  - [Narrow Capability Bridge With Delegating Methods](#narrow-capability-bridge-with-delegating-methods)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-mfe-host-communication`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-mfe-host-communication`

### 1.1 Overview

The host runtime routes actions to microfrontend targets through an actions-chains mediator keyed by target identifier and action type, and that routing reaches any target regardless of how many nesting levels separate sender and target: each registry automatically propagates its admitted targets to its ancestors and escalates an unresolved dispatch to its own parent, so the mediator chain composes transitively up to the shell. A narrow parent–child capability bridge gives child microfrontends exactly the participation capabilities they need, delegating each to the registry and its mediator, while the property channel carries no solution-specific vocabulary. `executeActionsChain` on either surface takes only the chain and returns nothing awaitable: the runtime executes each action and then its `next` or `fallback` recursively. Where a target lives in another runtime, the current runtime hands the sub-chain over and nothing comes back.

### 1.2 Purpose

This feature details the host–MFE dispatch mechanism and the child-facing bridge surface that together realize `cpt-frontx-fr-mfe-host-communication`, including the registration-propagation and escalation mechanism that makes dispatch reach a target at any nesting depth without widening the bridge surface. Action admission is delegated to the injected type-system provider rather than embedded format knowledge, and runs at the registry that executes the action, where the target lives, applying `cpt-frontx-principle-agnostic-core`. The dispatch semantics detailed here — recursive execution, a per-action timeout, and hand-over of a sub-chain to the runtime where its target lives — are what `cpt-frontx-constraint-mfes-recursive-chain-execution` (MFES-8) rests on.

**Requirements**: `cpt-frontx-fr-mfe-host-communication`

**Principles**: `cpt-frontx-principle-agnostic-core`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Dispatches action chains to registered microfrontend targets through the host runtime |

### 1.4 References

- **PRD**: [PRD.md](../../../../../architecture/PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADRs**: `cpt-frontx-adr-action-dispatch-and-chaining`, `cpt-frontx-adr-child-mfe-host-access`
- **Dependencies**: `cpt-frontx-feature-mfe-registry`

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-usecase-add-microfrontend-to-project`

### Dispatch Actions Chain to MFE Target

- [x] `p1` - **ID**: `cpt-frontx-flow-mfe-host-communication-dispatch-chain`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer dispatches an actions chain; the call returns nothing to await; the runtime executes the action through the registered handler and then executes the `next` chain, if present
- Developer dispatches an actions chain whose target lives in another runtime; the runtime hands the sub-chain to the runtime where the target lives, which executes it the same way; nothing comes back

**Error Scenarios**:
- No handler is registered for the target and action type after exhausting the keyed, hierarchy-derived, catch-all, downward forwarding-entry, and (when the registry is not the shell) upward escalation tiers; the runtime executes the chain's `fallback`, if present; otherwise the chain ends
- The handler throws or rejects, or its per-action timeout expires; the runtime executes the chain's `fallback`, if present; otherwise the chain ends
- The far side of a hop refuses the hand-over — the bridge is inactive or disposed, no receiver is wired, the receiving copy does not recognize the envelope's version, or the receiving registry is disposed; the delivering runtime executes the chain's `fallback`, if present, and the refusal leaves no side effect at the far side
- The far side of a hop accepts the hand-over and the action then fails there; the far side executes the chain's `fallback`, if present, and nothing comes back
- Target entry does not declare the dispatched action type; the declaration check fails, the action fails, and the chain's `fallback` executes, if present
- The target extension is registered but not currently mounted; the hand-over through its inactive bridge is refused, and the delivering runtime executes the chain's `fallback`, if present

**Steps**:
1. [x] - `p1` - Developer assembles an actions chain out of nodes that each carry an action identifying the target and action type and may declare that action's own timeout, linked by the `next` and `fallback` continuations the chain declares - `inst-assemble-chain`
2. [x] - `p1` - Developer hands the assembled chain to the host runtime's `executeActionsChain`, which takes only the chain and returns nothing awaitable - `inst-invoke-execute`
3. [x] - `p1` - Runtime delegates action admission to the type-system provider of the registry that executes the action, where the target lives, which validates the action against its registered schema; an admission failure is a failure of the action, so the runtime executes the chain's `fallback`, if present - `inst-admit-action`
4. [x] - `p1` - Runtime checks that the target entry declares the action type in its receivable-action set; infrastructure lifecycle actions are exempt - `inst-decl-check`
5. [x] - `p1` - **IF** the target entry exists and does not declare the action type - `inst-decl-fail-check`
   1. [x] - `p1` - The action fails; the runtime executes the chain's `fallback`, if present - `inst-decl-fail-return`
6. [x] - `p1` - Runtime resolves the handler for the `(target, action type)` pair; on no specific match, falls back to a hierarchy-derived match, then the per-target catch-all handler, then to a downward forwarding entry recorded through registration propagation from a descendant registry, then, if the registry is not the shell, to an upward escalation route reached through its inbound bridge - `inst-resolve-handler`
7. [x] - `p1` - **IF** no specific handler, catch-all handler, forwarding entry, or escalation handler exists for the target - `inst-no-handler-check`
   1. [x] - `p1` - The action fails; the runtime executes the chain's `fallback`, if present - `inst-no-handler-fallback`
   2. [x] - `p1` - **IF** no `fallback` is present - `inst-no-handler-no-fallback`
      1. [x] - `p1` - The chain ends - `inst-no-handler-return`
8. [x] - `p1` - **IF** the resolved route crosses to the runtime where the target lives - `inst-flow-cross-hop-check`
   1. [x] - `p1` - Runtime hands the sub-chain — the action with its `next` and `fallback` — over across the hop - `inst-flow-hand-over`
   2. [x] - `p1` - **IF** the far side refuses the hand-over — the bridge is inactive or disposed, no receiver is wired, the receiving copy does not recognize the envelope's version, or the receiving registry is disposed - `inst-flow-delivery-refused`
      1. [x] - `p1` - The action fails; the runtime executes the chain's `fallback`, if present; the refusal leaves no side effect at the far side - `inst-flow-refused-fallback`
   3. [x] - `p1` - **IF** the far side accepts the hand-over - `inst-flow-delivery-accepted`
      1. [x] - `p1` - The receiving runtime executes the sub-chain the same way, from admission; nothing comes back - `inst-flow-accepted-continues`
9. [x] - `p1` - Runtime invokes the resolved handler within the per-action timeout: the action's declared timeout, otherwise the domain's default action timeout - `inst-invoke-handler`
10. [x] - `p1` - **IF** handler execution succeeds - `inst-success-check`
    1. [x] - `p1` - **IF** the chain has a `next` chain - `inst-check-next`
       1. [x] - `p1` - Runtime executes the `next` chain recursively, routed from this runtime through its own resolution tiers, repeating from admission - `inst-recurse-next`
    2. [x] - `p1` - **IF** no `next` chain is present - `inst-no-next`
       1. [x] - `p1` - The chain ends - `inst-return-completed`
11. [x] - `p1` - **IF** the handler throws or rejects, or the per-action timeout expires - `inst-fail-check`
    1. [x] - `p1` - **IF** the chain has a `fallback` chain - `inst-check-fallback`
       1. [x] - `p1` - Runtime executes the `fallback` chain recursively, routed from this runtime through its own resolution tiers, repeating from admission - `inst-recurse-fallback`
    2. [x] - `p1` - **IF** no `fallback` chain is present - `inst-no-fallback`
       1. [x] - `p1` - The chain ends; nothing is recorded or reported - `inst-return-failed`

## 3. Processes / Business Logic (CDSL)

### Mediator Keyed Dispatch and Recursive Chain Execution

- [x] `p2` - **ID**: `cpt-frontx-algo-mfe-host-communication-mediator-dispatch`

**Input**: An actions chain whose nodes may each declare that action's own timeout — handed to `executeActionsChain`, or handed over across a hop by another runtime

**Output**: Nothing. The runtime executes the action and then the selected branch; nothing is returned, recorded, or reported. For a target in another runtime, the sub-chain is handed to that runtime

**Steps**:
1. [x] - `p1` - `executeActionsChain` returns nothing awaitable; execution proceeds by the steps below - `inst-accept-yields-nothing`
2. [x] - `p1` - **IF** this registry receives a sub-chain handed over across a hop - `inst-receive-hand-over`
   1. [x] - `p1` - **IF** the envelope carries a version this copy does not recognize, or this registry is disposed - `inst-receive-refusal-check`
      1. [x] - `p1` - Refuse the hand-over; the refusal has no side effect here - `inst-receive-refuse`
   2. [x] - `p1` - Otherwise accept the hand-over and execute the sub-chain from admission (step 3) after the hand-over call returns. Every later failure is handled here by executing the `fallback`; nothing surfaces back through the hand-over call - `inst-receive-transfer`
3. [x] - `p1` - Delegate action admission to this registry's type-system provider, where the target lives; an admission failure is a failure of the action (step 12) - `inst-delegate-admit`
4. [x] - `p1` - Look up the handler for the `(targetId, actionTypeId)` pair in the keyed handler registry - `inst-keyed-lookup`
5. [x] - `p1` - **IF** no keyed handler is found for the pair - `inst-no-keyed`
   1. [x] - `p1` - Match the dispatched action type against each registered key through the type system's derivation check, in either direction, and use the first matching handler - `inst-hierarchy-lookup`
   2. [x] - `p1` - Look up the per-target catch-all handler; the catch-all tier enables forwarding to child domains whose action vocabulary is not enumerated in the parent - `inst-catchall-lookup`
   3. [x] - `p1` - **IF** no hierarchy-derived or catch-all handler matches, look up a downward forwarding entry for the target identifier, recorded through registration propagation from a descendant registry — the same distinct cross-hop route shape as the escalation tier below, not a plain `ActionHandler`, since it hands the sub-chain across the hop to the registry where the target lives, which executes it, and nothing comes back; exclude any forwarding entry whose bridge equals the tagged arrival edge of the action being routed, if it carries one - `inst-forwarding-entry-lookup`
   4. [x] - `p1` - **IF** no forwarding entry resolves and the registry holds an inbound bridge (that is, the registry is not the shell), resolve the escalation tier: the cross-hop route the parent registry minted once for that extension when it first linked its bridge (`inst-mint-escalation-on-link`), reached through the bridge itself — distinct in shape from a plain `ActionHandler`, since it hands the sub-chain across the hop to the parent registry, which executes the action or routes it onward. This runtime hands the sub-chain over through that route (`inst-hand-over-node`), and nothing comes back - `inst-escalation-lookup`
      1. [x] - `p1` - That parent-minted handler tags the action being routed with this inbound bridge as its arrival edge before handing its sub-chain to the parent registry's mediator, so the parent's forwarding-entry resolution never re-routes that action back onto this same edge; the `next` or `fallback` executed after the action is routed from the runtime that executed the action and is not subject to that exclusion - `inst-tag-arrival-edge`
6. [x] - `p1` - **IF** neither a keyed, hierarchy-derived, catch-all, forwarding-entry, nor escalation handler exists for the target - `inst-no-handler`
   1. [x] - `p1` - The action fails with a missing-handler error (step 12) - `inst-throw-no-handler`
7. [x] - `p1` - Resolve the per-action timeout through the shared `ActionTimeoutResolver`: the action's declared timeout, otherwise the domain's default action timeout - `inst-resolve-timeout`
8. [x] - `p1` - **IF** the resolved route crosses to another runtime — a downward forwarding entry, the escalation tier, or the catch-all tier whose child domain lives in another runtime — hand over the sub-chain in the cross-hop envelope, which carries a version and the sub-chain: the action with its `next` and `fallback` - `inst-hand-over-node`
   1. [x] - `p1` - Delivery is synchronous and binary: the hand-over call either refuses or accepts, and never both - `inst-delivery-binary`
   2. [x] - `p1` - **IF** the hand-over is refused — the bridge it travels through is inactive or disposed, a revoked link included, no receiver is wired on the far side, the receiving copy does not recognize the envelope's version, or the receiving registry is disposed - `inst-delivery-refused`
      1. [x] - `p1` - The action fails; this runtime executes the chain's `fallback` per step 12; the refusal leaves no side effect at the far side - `inst-refused-delivery-fallback`
   3. [x] - `p1` - **IF** the hand-over is accepted - `inst-delivery-accepted`
      1. [x] - `p1` - This runtime is done with the sub-chain when the call returns, and nothing comes back; the receiving registry executes it (`inst-receive-transfer`) - `inst-hand-over-done`
9. [x] - `p1` - Invoke the resolved handler within the per-action timeout bound - `inst-invoke-within-timeout`
10. [x] - `p1` - The runtime that executed the action executes the selected branch recursively from itself, routed through its own resolution tiers. The arrival-edge exclusion governs re-routing of the action, not the branch that follows, so a branch whose target lies back across the edge the action arrived on travels back across that edge - `inst-dispatch-continuation`
11. [x] - `p1` - **IF** handler execution succeeds - `inst-success`
    1. [x] - `p1` - **IF** the chain has a `next` - `inst-has-next`
       1. [x] - `p1` - Execute `next` recursively - `inst-recurse-success`
    2. [x] - `p1` - **IF** no `next` is present - `inst-chain-done`
       1. [x] - `p1` - The chain ends - `inst-return-done`
12. [x] - `p1` - **IF** the action fails — the handler throws or rejects, the per-action timeout expires, no handler exists for the target, admission or the declaration check fails, or the hand-over is refused - `inst-failure`
    1. [x] - `p1` - **IF** the chain has a `fallback` - `inst-has-fallback`
       1. [x] - `p1` - Execute `fallback` recursively - `inst-recurse-fallback-algo`
    2. [x] - `p1` - **IF** no `fallback` is present - `inst-no-fallback-algo`
       1. [x] - `p1` - The chain ends; nothing is recorded or reported - `inst-end-at-node`

### Registration Propagation, Escalation, and Retraction

- [ ] `p2` - **ID**: `cpt-frontx-algo-mfe-host-communication-registration-propagation`

**Input**: A domain-or-extension admission event carrying a target identifier and its declared action-type id set, at a registry that may or may not hold an inbound bridge; an unmount or mount-failure event for a host extension; a permanent-unregistration event for a host extension, or a disposal event for a registry; a registry-construction event that may occur while a mount is in progress, possibly against an independently loaded copy of this package from the extension's own mount host

**Output**: A newly constructed registry automatically holds the inbound bridge of the extension currently being mounted, if any and if resolvable, without any explicit action by the microfrontend author; every ancestor registry up to and including the shell holds a forwarding entry for the admitted target, or the advertisement was rejected by a collision guard and logged; on the host extension's unmount or mount failure the parent deactivates that extension's bridge, keeping every advertisement propagated through it recorded while refusing each hand-over that would travel through it; on the host extension's permanent unregistration or the registry's own disposal, every advertisement propagated through that link is retracted by the parent and the link is revoked, so later deliveries to its targets find no route; in either case a sub-chain a far side accepted before the deactivation or retraction keeps executing there

**Steps**:
1. [ ] - `p1` - While a mount is invoking an extension's lifecycle `mount(shadowRoot, childBridge, mountContext)` synchronously, the runtime records `childBridge` — the extension's own persistent bridge, created on its first mount and reactivated for this one rather than freshly constructed per mount — as the currently-mounting bridge through a realm-global, version-namespaced rendezvous point — not an ES-module-scoped variable, because the mounting extension and a registry it constructs may each hold their own independently loaded copy of this package — scoped to exactly that synchronous invocation; the same rendezvous entry also collects the link callback published by each registry that adopts that bridge during the window (step 2.2 — ordinarily exactly one), which the runtime takes off the entry as the window closes and retains against the host extension as its own private state, superseded when a later mount produces its own adoption and released at that extension's permanent unregistration, so the parent can reach an already-constructed registry for as long as that registry's adoption stands; nothing remains at the rendezvous itself once the window closes - `inst-track-mounting-bridge`
2. [ ] - `p1` - **IF** a registry is constructed while the rendezvous point holds a currently-mounting bridge tagged with a protocol version this copy recognizes (that is, the extension's own code builds a further `MfeRegistry` synchronously during its `mount` call) - `inst-adopt-ambient-bridge`
   1. [ ] - `p1` - The newly constructed registry automatically adopts that bridge as its own inbound bridge, with no configuration or method call required from the microfrontend author - `inst-inbound-bridge-auto-adopt`
   2. [ ] - `p1` - The adopting registry publishes, into the same rendezvous entry, a link callback the runtime retains against that host extension — the only channel through which the parent can reach an already-constructed registry to supersede or release its adoption, carrying no importable symbol - `inst-publish-relink-callback`
3. [ ] - `p1` - **IF** no registry is constructed while the rendezvous point holds a currently-mounting bridge (the extension does not build its own nested registry synchronously within `mount`, or is not itself a host), or the rendezvous entry found carries a protocol version this copy does not recognize - `inst-no-ambient-bridge`
   1. [ ] - `p1` - The constructed registry holds no inbound bridge and behaves as a root/shell registry for propagation and escalation purposes; when a mounted extension exists elsewhere on the page and this registry still resolved no bridge, or an unrecognized protocol version was found, log a diagnostic rather than degrading silently - `inst-registry-is-root`
4. [ ] - `p1` - The link the parent registry mints for a host extension — minted once, at that extension's first mount, and carried by that extension's persistent bridge for its whole registration lifetime — carries the escalation route and the arrival-edge tagging applied to a chain escalating through it; a nested registry reaches both through the link it adopted at construction (step 2) and never by the child's own registry testing the bridge's concrete class identity, since the two sides may not share a class definition. Escalation resolves against the link held at dispatch time, so a registry that spans any number of its host extension's mount cycles escalates through the one route and arrival-edge tagging the parent minted for that extension - `inst-mint-escalation-on-link`
5. [ ] - `p1` - A registry that adopts the link — the first registry to adopt it, or one adopting on a later mount and thereby superseding the previous adopter (step 10.1) — advertises through it every target it currently holds: each domain and extension admitted to it, and every forwarding entry it holds on behalf of its own descendants - `inst-relink-repropagate`
   1. [ ] - `p1` - Where that adoption supersedes an earlier one, the superseded registry discards its record of what the link had accepted from it, so nothing it propagated is counted against the adoption that replaced it, and the adopting registry establishes downward chain delivery through the link and escalates thereafter through the route it carries (step 4) - `inst-relink-downward-delivery`
6. [ ] - `p1` - On admission of a domain or extension, the registry composes a forwarding advertisement consisting of the target identifier and its declared action-type id set, treated as opaque identifiers - `inst-compose-advertisement`
7. [ ] - `p1` - **IF** the registry holds an inbound bridge (that is, the registry is not the shell) - `inst-has-inbound-bridge`
   1. [ ] - `p1` - Propagate the advertisement upward through the inbound bridge to the immediate parent registry's mediator - `inst-propagate-upward`
8. [ ] - `p1` - **IF** the receiving ancestor already holds a local or forwarding entry for the advertised target identifier - `inst-collision-check`
   1. [ ] - `p1` - **IF** the entry the ancestor already holds for that target identifier was recorded for the SAME edge this advertisement arrived on - accept the re-statement without rejecting it, logging a diagnostic, or altering the entry: admission through a still-live link is idempotent, since the entry the advertisement would record is the entry already present, so any repeated statement of a target over a link that is still live — one arriving before the parent revokes that edge, or one of several registries sharing a single mount's link re-stating a target the ancestor already holds for it — resolves to a no-op rather than a collision (see `cpt-frontx-adr-action-dispatch-and-chaining` for rationale) - `inst-readvertise-same-edge`
   2. [ ] - `p1` - **IF** the entry belongs to a different edge - reject the advertisement, do not propagate it further, and log a diagnostic - `inst-collision-reject`
9. [ ] - `p1` - **IF** the receiving ancestor holds no entry for the advertised target identifier - `inst-no-collision`
   1. [ ] - `p1` - Record a downward forwarding entry for the target identifier, pointing back through the bridge the advertisement arrived on - `inst-record-forwarding-entry`
   2. [ ] - `p1` - **IF** the ancestor itself holds an inbound bridge (that is, the ancestor is not the shell) - `inst-ancestor-has-inbound-bridge`
      1. [ ] - `p1` - Re-propagate the advertisement upward to the ancestor's own parent registry, composing the transitive chain of forwarding entries up to and including the shell - `inst-repropagate-upward`
10. [ ] - `p1` - On the permanent unregistration of the host extension a registry's inbound bridge belongs to, or on the disposal of the parent registry that minted the link, the parent registry — not the disposing side — revokes that link, deletes every forwarding entry it holds keyed to that specific bridge, releases the bridge pair and the adopter state it retained for that extension, and re-propagates the retraction to its own ancestors. An unmount or a mount failure is not such an event: there the parent deactivates that extension's bridge instead, keeping every forwarding entry recorded through it while refusing each hand-over that would travel through it, so the delivering runtime executes the `fallback` and the next mount finds the routing already established still in place. A sub-chain a far side accepted before the retraction or deactivation keeps executing there - `inst-retract-advertisements`
    1. [ ] - `p1` - The parent notifies every adopter it retained for that host extension to unlink — on the permanent release above, and equally when a later mount of that same extension produces its own fresh adoption, which supersedes the earlier one; each notified registry drops the link, tears down its downward chain-delivery subscription, and clears its own record of what it had propagated - `inst-unlink-on-retraction`
    2. [ ] - `p1` - A link revoked at permanent release refuses all further `propagateAdvertisement`, `retractAdvertisement`, and `escalate` calls, rejecting each explicitly so the caller's own fallback branch runs rather than the call appearing to succeed, so a reference to it retained beyond revocation — by any copy of the runtime — can never resurrect routing to an extension that is no longer registered - `inst-revoked-link-inert`
11. [ ] - `p1` - On a registry's own disposal, it symmetrically retracts every advertisement it had itself propagated through its own inbound bridge, recursively for the whole disposing subtree - `inst-retract-own-advertisements`
12. [ ] - `p1` - A nested registry is linked for as long as its host extension is registered, across any number of mount cycles, because the link outlives every individual mount: a registry the author reuses across a remount keeps the link it already adopted and needs nothing from the parent, and a registry the author rebuilds inside a fresh `mount` call adopts that same still-live link through step 2, superseding its predecessor's adoption — so both patterns are equally supported and neither requires any action from the microfrontend author. The only registry that can never be linked is one whose construction never occurred inside any mount window at all — built at module-evaluation time, or asynchronously after `mount` already returned; it behaves as a root registry (step 3) with a logged diagnostic. The factory-with-cache pattern means a registry built at module-evaluation time — rather than deferred until `mount()` — permanently consumes the one build-slot cache entry for that configuration, precluding any later mount of that extension from linking correctly; a nested host MUST therefore defer its first registry `build()` call until inside its own `mount()` lifecycle method - `inst-nested-registry-lifetime-scope`

### Bridge Delegation to Registry

- [ ] `p2` - **ID**: `cpt-frontx-algo-mfe-host-communication-bridge-delegation`

**Input**: A child bridge instance wired with injected registry and mediator callbacks; a request from the child to execute an actions chain, register an action handler, or register a child domain; a mount, unmount, mount-failure, or unregistration event for the extension the bridge belongs to

**Output**: Execution delegated to the host registry or mediator while the bridge is active; nothing handed over while the bridge is disposed, inactive, or not wired to a dispatch callback; where the bridge is the route a sub-chain is handed over through, a hand-over the bridge refuses while it is inactive, disposed, or has no receiver wired, after which the delivering runtime executes the `fallback`; no coordination logic inside the bridge itself

**Steps**:
1. [ ] - `p1` - **IF** the child requests to execute an actions chain - `inst-child-exec-chain`
   1. [x] - `p1` - Child bridge hands the chain to the injected `executeActionsChain` registry callback without coordination logic and returns nothing; while the bridge is disposed, inactive, or not wired to a dispatch callback, it hands nothing over - `inst-fwd-exec-chain`
2. [ ] - `p1` - **IF** the child registers an action handler for a specific action type - `inst-child-reg-handler`
   1. [x] - `p1` - Child bridge invokes the injected mediator-registration callback with the action type identifier and handler instance, keyed to the extension's own GTS identifier; the registration survives the bridge's deactivation and is released only at that extension's permanent unregistration. The bridge wraps the registered handler in an internal activity gate, so an invocation arriving while the bridge is inactive never reaches the handler - `inst-fwd-reg-handler`
3. [ ] - `p1` - **IF** the child registers a child domain for cross-runtime action forwarding - `inst-child-reg-domain`
   1. [x] - `p1` - Child bridge invokes the injected child-domain-registration callback with the domain identifier - `inst-fwd-reg-domain`
   2. [x] - `p1` - Parent runtime registers a catch-all forwarding handler in the mediator, keyed to the child domain identifier - `inst-register-catchall`
   3. [x] - `p1` - That catch-all forwarding entry is the cross-hop route shape: it hands the sub-chain addressed to the child domain through the bridge transport to the child runtime's registry, under the same hand-over rules as every other hop (`inst-hand-over-node`), so the child registry executes the action and then the selected branch from itself - `inst-catchall-forward`
4. [x] - `p1` - **IF** the parent runtime sends an action chain to the child's domain - `inst-parent-send-chain`
   1. [x] - `p1` - Parent bridge delivers the chain to the child bridge's registered actions-chain handler - `inst-deliver-to-child`
   2. [x] - `p1` - Child bridge passes the handed-over sub-chain to its registered receiver, which accepts or refuses it (`inst-receive-hand-over`); with no receiver registered, or with the bridge inactive, the bridge refuses the hand-over without invoking the receiver, leaving no side effect in the child runtime, and the delivering runtime executes the `fallback` - `inst-child-invoke`
5. [x] - `p1` - Parent bridge exposes `instanceId` and `dispose()` as its complete narrow public surface; `instanceId` holds the extension's own GTS identifier and is therefore stable across every mount of that extension rather than a per-mount token, and `dispose()` is permanent teardown — invoking child bridge cleanup and released state — performed only when that extension is unregistered, while an unmount performs an internal deactivation that appears on no surface - `inst-parent-handle`
6. [x] - `p1` - The registry's inbound bridge — the child bridge its own host extension received at mount and holds for its whole registration lifetime — carries registration-propagation advertisements and upward escalation as internal registry plumbing, through the link the parent attaches to that bridge. The link adds no member to the abstract `ChildMfeBridge` contract or to `ParentMfeBridge`; it is nonetheless reachable by code holding that bridge, the child's own code included, since the child holds the bridge, and the version tag and the synchronous mount window guard only against accidental misattribution — the security analysis of `cpt-frontx-adr-action-dispatch-and-chaining` records that reachability as an accepted limitation. The abstract `ChildMfeBridge` contract is the type the host hands to `mount`, and the one this feature means wherever it says "the child-facing bridge surface". That abstract surface stays exactly the four capability methods `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler`, alongside exactly two readonly identity properties, `extDomainId` and `extensionId`, regardless of nesting depth. The concrete implementation carries further public members that are not on it — its transport, activity-state, and wiring internals, and the explicit `registerChildDomain`/`unregisterChildDomain` entry points of step 3, reachable only by a caller that narrows to the concrete type and never required of a microfrontend author, since propagation is automatic - `inst-inbound-bridge-internal`
7. [x] - `p1` - One parent–child bridge pair is created per extension, at that extension's first mount, and the very same child bridge object is handed to `mount` on every subsequent mount of that extension; `extensionId` carries the extension's own GTS identifier and `extDomainId` the GTS identifier of the domain it is mounted into, both fixed for the pair's whole life. The pair is released only when that extension is permanently unregistered - `inst-bridge-lifetime`
8. [x] - `p1` - On the extension's unmount or a failed mount the parent deactivates the bridge rather than destroying it: every hand-over through an inactive bridge is refused, so the delivering runtime executes the `fallback`, and a chain the child hands to an inactive bridge is not handed over. A sub-chain the far side accepted before the deactivation carries on there; property updates are recorded against the bridge but not dispatched to its subscribers while it is inactive. The next mount reactivates that same bridge and delivery through it resumes - `inst-bridge-deactivation`
9. [x] - `p1` - Action-handler registrations and property subscriptions made through the bridge survive its deactivation and are live again the moment it is reactivated, so an MFE that registers once at its first mount keeps participating across remounts without registering again; an MFE that wants the opposite unregisters its handlers, unsubscribes its properties, and clears its own state from its `unmount()` hook - `inst-registration-survives-remount`

## 4. States (CDSL)

### Action State Machine

- [x] `p2` - **ID**: `cpt-frontx-state-mfe-host-communication-action-lifecycle`

**States**: PENDING, DISPATCHED, SUCCEEDED, FAILED, FALLBACK

**Initial State**: PENDING

**Transitions**:
1. [x] - `p1` - **FROM** PENDING **TO** DISPATCHED **WHEN** a handler is resolved and the action is invoked within its timeout bound - `inst-t-pending-dispatched`
2. [x] - `p1` - **FROM** DISPATCHED **TO** SUCCEEDED **WHEN** handler execution completes without error - `inst-t-dispatched-succeeded`
3. [x] - `p1` - **FROM** DISPATCHED **TO** FAILED **WHEN** the handler throws or rejects, or the per-action timeout expires - `inst-t-dispatched-failed`
   **Actions**:
   - [x] - `p1` - **IF** the chain declares a `fallback` continuation - `inst-failed-check-fallback`
     - [x] - `p1` - Transition the action to FALLBACK and recurse into the fallback chain node - `inst-failed-to-fallback`
   - [x] - `p1` - **IF** no `fallback` is declared - `inst-failed-no-fallback`
     - [x] - `p1` - The chain ends; nothing is recorded or reported - `inst-failed-end-at-node`
4. [x] - `p1` - **FROM** FAILED **TO** FALLBACK **WHEN** the chain declares a fallback continuation that is recursively executed - `inst-t-failed-fallback`
5. [x] - `p1` - **FROM** SUCCEEDED **TO** DISPATCHED **WHEN** the chain declares a `next` continuation and the next action is dispatched - `inst-t-succeeded-dispatched`
6. [x] - `p1` - **FROM** PENDING **TO** FAILED **WHEN** no handler exists for the target, admission or the declaration check fails, or the hand-over is refused (`inst-failure`, `inst-delivery-refused`, `inst-refused-delivery-fallback`, `inst-flow-refused-fallback`) - `inst-t-pending-failed-refused`

## 5. Definitions of Done

### Mediator Keyed Dispatch and Recursive Chain Execution

- [ ] `p1` - **ID**: `cpt-frontx-dod-mfe-host-communication-mediator-dispatch`

The system **MUST** implement the actions-chains mediator with a keyed `(targetId, actionTypeId)` handler registry and a per-target catch-all tier. `executeActionsChain` **MUST** take only the chain and **MUST** return nothing awaitable. The runtime **MUST** execute a chain recursively: it executes the action, then executes `next` recursively, if present, where the action succeeded, and `fallback` recursively, if present, where the action failed; where the selected branch is absent the chain ends, and nothing is recorded or reported, satisfying `cpt-frontx-constraint-mfes-recursive-chain-execution` (MFES-8). An action fails where the handler throws or rejects, the per-action timeout expires, no handler exists for the target, admission or the declaration check fails, or a hand-over across a hop is refused. The per-action timeout **MUST** be resolved through the shared `ActionTimeoutResolver`: the action's declared timeout, otherwise the domain's default action timeout. Each action's handler **MUST** be resolved when that action executes. Action admission **MUST** run through the type-system provider of the registry that executes the action, where the target lives. The runtime **MUST NOT** process a chain ahead of time — no validation, pre-parsing, or cycle check — and **MUST NOT** track a chain's origin, status, or completion. Where a target lives in another runtime, the current runtime **MUST** hand over the sub-chain — the action with its `next` and `fallback` — in a cross-hop envelope that carries a version and the sub-chain, and nothing comes back. A hand-over **MUST** be refused where the bridge it travels through is inactive or disposed, a revoked link included, no receiver is wired on the far side, the receiving copy does not recognize the envelope's version, or the receiving registry is disposed; a refused hand-over is a failure of the action at the delivering runtime, which executes the chain's `fallback`, if present, and the refusal **MUST** leave no side effect at the far side. After the far side accepts, every failure **MUST** be handled there by executing the far side's `fallback`, and nothing comes back to the delivering runtime. Action admission is delegated to the injected type-system provider; the mediator carries no type-format knowledge. The property channel passed through the bridge surface carries no solution-specific identifiers, satisfying `cpt-frontx-constraint-mfes-no-solution-shared-properties` (MFES-2). The reachability guarantee behind this handler resolution MUST hold transitively across any nesting depth, not just at a single hop, and MUST hold when a nested registry is built against its own independently loaded copy of this package rather than sharing an evaluated module with its host: a registry constructed while an extension's `mount` call is synchronously in progress MUST automatically adopt that extension's bridge as its own inbound bridge, coordinated through a realm-global, version-namespaced rendezvous rather than shared module state, with no configuration or method call from the microfrontend author; a registry that resolves no bridge, or resolves a rendezvous entry tagged with an unrecognized protocol version, MUST behave as a root registry and MUST log a diagnostic rather than degrading silently; admitting a domain or extension MUST automatically propagate a forwarding advertisement through the registry's inbound bridge to every ancestor up to and including the shell, with a collision guard that MUST accept, without rejection and without a diagnostic, an advertisement re-stating an entry the ancestor already holds for the very edge that advertisement arrived on, and MUST reject and log one whose target identifier collides with an entry the ancestor holds locally or for a different edge; resolution MUST add a downward forwarding-entry tier and, when the registry holds an inbound bridge, a final upward-escalation tier reached through that bridge and carried by the link the parent registry minted once for that host extension rather than identified by the child testing the bridge's concrete class, both resolving — as the catch-all tier does where the child domain it matches lives in another runtime — to the cross-hop route shape rather than to a plain `ActionHandler`, both handing the sub-chain across as every hop does; an action forwarded or escalated across a bridge MUST be tagged with that arrival edge so forwarding-entry resolution never re-routes that same action onto that edge, while the `next` or `fallback` executed after the action, routed from the runtime that executed it, MUST NOT be excluded from it; and on a host extension's permanent unregistration or a registry's own disposal, the parent registry MUST retract every advertisement propagated through that link, so later deliveries to its targets find no route. A host extension's unmount or mount failure MUST NOT retract those advertisements: the parent MUST deactivate that extension's bridge instead, keeping every entry recorded through it while refusing each hand-over through it, so the delivering runtime executes the `fallback`. Retraction and deactivation MUST act on routes only: each stops new hand-overs through the route, and neither touches a sub-chain a far side already accepted, which keeps executing there. The link the parent mints for a host extension MUST be minted once, at that extension's first mount, and stay live across every subsequent mount, so a registry the author reuses across a remount keeps routing without any further act by the parent; a registry that adopts that link MUST propagate every target it currently holds, both its own admissions and the forwarding entries it holds on behalf of its own descendants, and MUST escalate thereafter through the escalation route and arrival-edge tagging that link carries, while a registry whose adoption a later mount supersedes MUST be unlinked and MUST clear its own record of what it had propagated; and a link revoked at permanent unregistration or disposal MUST be inert, refusing all further propagation, retraction, and escalation through it explicitly rather than silently, so no ancestor can ever acquire or retain a forwarding entry pointing at an extension that is no longer registered. This composition MUST introduce zero growth to the package's public surface, satisfying `cpt-frontx-constraint-mfes-cross-nesting-reachability` (MFES-6): no new capability method is added to `MfeRegistry` or any other exported type to support propagation, the collision guard, escalation, the hand-over across a hop, loop containment, deactivation, or retraction, and the rendezvous protocol carries no importable symbol.

**Implements**:
- `cpt-frontx-flow-mfe-host-communication-dispatch-chain`
- `cpt-frontx-algo-mfe-host-communication-mediator-dispatch`
- `cpt-frontx-algo-mfe-host-communication-registration-propagation`

**Constraints**: `cpt-frontx-constraint-mfes-no-solution-shared-properties`, `cpt-frontx-constraint-mfes-cross-nesting-reachability`, `cpt-frontx-constraint-mfes-recursive-chain-execution`

**Touches**:
- Entities: `Action`, `ActionsChain`
- Component: `cpt-frontx-component-mfe-runtime`

### Narrow Capability Bridge With Delegating Methods

- [ ] `p1` - **ID**: `cpt-frontx-dod-mfe-host-communication-bridge-delegation`

The system **MUST** provide an abstract child bridge contract exposing exactly four capability methods — `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler` — each delegating to the host registry or mediator without duplicating coordination logic, with `executeActionsChain` taking only the chain and returning nothing awaitable, alongside exactly two readonly identity properties, `extDomainId` carrying the GTS identifier of the domain the extension is mounted into and `extensionId` carrying the extension's own GTS identifier; and a matching parent bridge exposing only `instanceId`, likewise the extension's own GTS identifier, and `dispose()`. Both identity values MUST be stable for the extension's whole registration lifetime rather than tokens minted per mount. The bridge MUST NOT expose runtime internals, and the bridge's active/inactive state MUST stay a private implementation detail of the package, visible on no public surface. One bridge pair MUST be created per extension at its first mount and handed to every subsequent mount of that extension as the same object, released only at that extension's permanent unregistration, so handler registrations and property subscriptions made through it survive an unmount and are live again on the next mount unless the microfrontend's own `unmount()` hook withdraws them; a chain the child hands to a disposed, inactive, or unwired bridge MUST NOT be handed over; a hand-over through an inactive, disposed, or receiver-less bridge MUST be refused so the delivering runtime executes the `fallback`; and a sub-chain the far side accepted before the bridge went inactive MUST keep executing there. Child domain forwarding MUST use the catch-all handler tier in the parent mediator, forwarding actions through the bridge transport without the parent enumerating the child's action vocabulary. This four-method, two-property abstract child-facing surface — the type the host hands to `mount` — MUST remain unchanged regardless of nesting depth, while the concrete implementation's additional members, including the explicit child-domain registration entry points of the bridge-delegation algorithm's step 3, MUST stay off it, satisfying `cpt-frontx-constraint-mfes-cross-nesting-reachability` (MFES-6): the link on the registry's own inbound bridge that carries registration-propagation advertisements and upward escalation is internal registry plumbing, not a bridge method, though it remains reachable by code holding that bridge — the accepted limitation recorded in the security analysis of `cpt-frontx-adr-action-dispatch-and-chaining` — and propagation and escalation MUST be fully automatic internal registry behavior, triggered by admission, by adoption of the host extension's link, and by unregistration or disposal, requiring no explicit registration call and no action by the microfrontend author.

**Implements**:
- `cpt-frontx-flow-mfe-host-communication-dispatch-chain`
- `cpt-frontx-algo-mfe-host-communication-bridge-delegation`
- `cpt-frontx-algo-mfe-host-communication-registration-propagation`

**Constraints**: `cpt-frontx-constraint-mfes-no-solution-shared-properties`, `cpt-frontx-constraint-mfes-cross-nesting-reachability`

**Touches**:
- Entities: `Action`, `ActionsChain`
- Component: `cpt-frontx-component-mfe-runtime`

## 6. Acceptance Criteria

- [x] The actions-chains mediator resolves a handler by the `(targetId, actionTypeId)` pair and falls back to the per-target catch-all handler when no specific pair matches
- [x] When neither a keyed, hierarchy-derived, nor catch-all handler matches, resolution continues through a downward forwarding entry and, when the registry has an inbound bridge, a final upward-escalation handler, before treating the target as unresolved
- [x] The runtime executing each action executes `next` on success and `fallback` on failure, each recursively from the runtime that executed the action; the chain ends where the selected branch is absent, and nothing is recorded or reported
- [x] `executeActionsChain` on the registry facade and on the child bridge takes only the chain and returns nothing awaitable
- [x] A handler that throws or rejects, an expired per-action timeout, a missing handler, an admission or declaration failure, and a refused hand-over each lead to the chain's `fallback`
- [ ] Action admission runs through the type-system provider of the registry that executes the action, where the target lives, and an admission failure leads to the chain's `fallback`
- [x] Each action runs within its per-action timeout — its declared timeout, otherwise the domain's default action timeout — resolved through the shared `ActionTimeoutResolver`
- [ ] A chain is executed without prior validation, pre-parsing, or cycle check, and no origin, status, or completion of it is tracked
- [x] Action admission is delegated to the injected type-system provider; no type-format literals appear in the mediator
- [x] The child bridge surface is exactly the four capability methods `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler` plus exactly two readonly identity properties, `extDomainId` (the GTS identifier of the domain the extension is mounted into) and `extensionId` (the extension's own GTS identifier); the parent bridge surface is exactly `instanceId` and `dispose()`, unchanged regardless of nesting depth
- [x] Both child-bridge identity properties hold the extension's and its domain's own GTS identifiers and are stable for the extension's whole registration lifetime, and the bridge's active/inactive state appears on no public surface of the abstract `ChildMfeBridge`/`ParentMfeBridge` contracts; the concrete child-bridge implementation that holds that state is not exported from the package barrel, so the members through which it inspects that state reach no consumer
- [x] The property channel carries no solution-specific shared-property identifiers, satisfying `cpt-frontx-constraint-mfes-no-solution-shared-properties` (MFES-2)
- [x] Child domain forwarding uses the catch-all handler tier in the parent mediator, forwarding actions through the bridge transport without the parent enumerating the child's action vocabulary
- [ ] A registry constructed while an extension's `mount` call is synchronously in progress automatically adopts that extension's bridge as its own inbound bridge via a realm-global rendezvous, requiring no configuration or method call by the microfrontend author, and this holds even when the registry and its host extension are evaluating independently loaded copies of this package; a registry constructed outside any such window holds no inbound bridge and behaves as a root registry with no diagnostic logged (the normal path for every top-level/shell registry construction), while a registry resolving a rendezvous entry carrying an unrecognized protocol version, or a bridge with no link attached, likewise holds no inbound bridge but logs a diagnostic
- [x] Admitting a domain or extension automatically propagates a forwarding advertisement through each registry's inbound bridge, so that every ancestor up to and including the shell ends up holding a forwarding entry for the admitted target, without any explicit registration action by the microfrontend author
- [ ] An ancestor that already holds a local registration, or a forwarding entry recorded for a different edge, for an advertised target identifier rejects the colliding advertisement, logs a diagnostic, and does not propagate it further; an advertisement re-stating an entry that ancestor already holds for the very edge it arrived on is accepted as an idempotent no-op, neither rejected nor logged
- [x] A chain unresolved by the keyed, hierarchy-derived, local catch-all, and forwarding-entry tiers escalates upward through the registry's inbound bridge to the parent's mediator, except at the shell, which has no further ancestor to escalate to, using an escalation handler the parent registry minted once for that host extension rather than one the child identifies by testing the bridge's concrete class
- [x] A sub-chain whose target lives in another runtime — reached through a downward forwarding entry, the upward escalation tier, or child-domain forwarding — is handed over and nothing comes back; the receiving runtime executes it the same way, across one and several hops
- [ ] A hand-over across a hop is either refused or accepted, never both: it is refused where the bridge is inactive or disposed, no receiver is wired, the receiving copy does not recognize the envelope's version, or the receiving registry is disposed; the delivering runtime then executes the chain's `fallback`, and the refusal leaves no side effect at the far side
- [x] After the far side accepts a hand-over, every failure is handled by the receiving runtime's `fallback` and never by the delivering runtime's
- [x] An action is never re-routed onto the bridge edge it most recently arrived on, preventing an escalate-then-forward loop between the same two registries, while a continuation dispatched afresh from the runtime that executed the action is routed through that runtime's own tiers and, where its target lies back across that edge, travels back across it and reaches it
- [ ] A host extension's permanent unregistration, or a registry's own disposal, causes the parent registry to revoke that link and retract every forwarding advertisement propagated through it, regardless of whether the registry's own author disposes it, so later deliveries to its targets find no route; a sub-chain a far side accepted before the retraction keeps executing there
- [ ] A host extension's unmount or mount failure leaves every forwarding advertisement propagated through its link in place and deactivates its bridge instead; a hand-over through that inactive bridge is refused, so the delivering runtime executes the `fallback`, while a sub-chain the far side accepted before the deactivation is left executing there; the next mount reactivates the same bridge with its handler registrations and property subscriptions still live unless the microfrontend's own `unmount()` hook withdrew them
- [x] A registry an author reuses across a remount keeps the link it already adopted and continues to route with no further act by the parent; a registry the author rebuilds inside a fresh `mount` call adopts that same still-live link, supersedes its predecessor's adoption — which is unlinked and clears its own propagation record — and advertises every target it holds; both patterns route correctly, and no dispatch is ever delivered through a bridge whose extension is no longer registered
- [x] A link revoked at a host extension's permanent unregistration or a registry's disposal is inert: a registry that retained a reference to it can neither propagate nor escalate through it, each such call being rejected explicitly rather than silently ignored, so no ancestor can acquire a forwarding entry pointing at an extension that is no longer registered; `retractAdvertisement` is the one exception, an idempotent silent no-op on a revoked link, because the revoking parent has already performed that retraction itself
- [ ] Propagation, the collision guard, escalation, the hand-over across a hop, loop containment, deactivation, and retraction introduce no new capability method or exported type anywhere in the package's public surface, satisfying `cpt-frontx-constraint-mfes-cross-nesting-reachability` (MFES-6); the inbound-bridge rendezvous is verified, by a test exercising two independently loaded copies of this package rather than one shared module graph, to adopt correctly and never misattribute one extension's bridge to another's registry
