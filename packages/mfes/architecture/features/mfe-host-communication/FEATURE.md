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
  - [Mediator Keyed Dispatch and In-Flight Tracking](#mediator-keyed-dispatch-and-in-flight-tracking)
  - [Narrow Capability Bridge With Delegating Methods](#narrow-capability-bridge-with-delegating-methods)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-mfe-host-communication`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-mfe-host-communication`

### 1.1 Overview

The host runtime routes actions to microfrontend targets through an actions-chains mediator keyed by target identifier and action type, and that routing reaches any target regardless of how many nesting levels separate sender and target: each registry automatically propagates its admitted targets to its ancestors and escalates an unresolved dispatch to its own parent, so the mediator chain composes transitively up to the shell. A narrow parent–child capability bridge gives child microfrontends exactly the participation capabilities they need, delegating each to the registry and its mediator, while the property channel carries no solution-specific vocabulary.

### 1.2 Purpose

This feature details the host–MFE dispatch mechanism and the child-facing bridge surface that together realize `cpt-frontx-fr-mfe-host-communication`, including the registration-propagation and escalation mechanism that makes dispatch reach a target at any nesting depth without widening the bridge surface. Action admission is delegated to the injected type-system provider rather than embedded format knowledge, applying `cpt-frontx-principle-agnostic-core`.

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

- [ ] `p1` - **ID**: `cpt-frontx-flow-mfe-host-communication-dispatch-chain`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer dispatches an action chain; the mediator routes it to the registered handler; the chain completes through the success continuation and returns a completed result with the execution path

**Error Scenarios**:
- No handler is registered for the target and action type after exhausting the keyed, hierarchy-derived, catch-all, downward forwarding-entry, and (when the registry is not the shell) upward escalation tiers; the mediator follows the fallback branch or returns a non-completed result
- Chain execution exceeds the configured timeout; the mediator returns a timed-out non-completed result
- Target entry does not declare the dispatched action type; the mediator rejects the action before handler resolution

**Steps**:
1. [ ] - `p1` - Developer assembles an actions chain with an action that identifies the target and action type - `inst-assemble-chain`
2. [x] - `p1` - Developer invokes `executeActionsChain` on the host runtime with the assembled chain and an optional timeout override - `inst-invoke-execute`
3. [ ] - `p1` - Runtime delegates action admission to the injected type-system provider, which validates the action against its registered schema - `inst-admit-action`
4. [x] - `p1` - Runtime checks that the target entry declares the action type in its receivable-action set; infrastructure lifecycle actions are exempt - `inst-decl-check`
5. [ ] - `p1` - **IF** the target entry exists and does not declare the action type - `inst-decl-fail-check`
   1. [ ] - `p1` - **RETURN** non-completed result with a declaration error - `inst-decl-fail-return`
6. [ ] - `p1` - Runtime resolves the handler for the `(target, action type)` pair; on no specific match, falls back to a hierarchy-derived match, then the per-target catch-all handler, then to a downward forwarding entry recorded through registration propagation from a descendant registry, then, if the registry is not the shell, to an upward escalation route reached through its inbound bridge - `inst-resolve-handler`
7. [ ] - `p1` - **IF** no specific handler, catch-all handler, forwarding entry, or escalation handler exists for the target - `inst-no-handler-check`
   1. [ ] - `p1` - Runtime follows the chain fallback branch if defined - `inst-no-handler-fallback`
   2. [ ] - `p1` - **IF** no fallback is defined - `inst-no-handler-no-fallback`
      1. [ ] - `p1` - **RETURN** non-completed result with a missing-handler error - `inst-no-handler-return`
8. [ ] - `p1` - Runtime registers the action dispatch as an in-flight operation for the target - `inst-register-inflight`
9. [ ] - `p1` - Runtime invokes the resolved handler within the per-action timeout bound - `inst-invoke-handler`
10. [ ] - `p1` - **IF** handler execution succeeds - `inst-success-check`
    1. [ ] - `p1` - Runtime records the action type in the execution path - `inst-success-record-path`
    2. [ ] - `p1` - **IF** the chain declares a `next` continuation - `inst-check-next`
       1. [ ] - `p1` - Runtime recurses into the next chain node and repeats from admission - `inst-recurse-next`
    3. [ ] - `p1` - **IF** no `next` continuation is declared - `inst-no-next`
       1. [ ] - `p1` - **RETURN** completed result with the accumulated execution path and elapsed time - `inst-return-completed`
11. [ ] - `p1` - **IF** handler execution fails or times out - `inst-fail-check`
    1. [ ] - `p1` - Runtime records the action type in the execution path - `inst-fail-record-path`
    2. [ ] - `p1` - **IF** the chain declares a `fallback` continuation - `inst-check-fallback`
       1. [ ] - `p1` - Runtime recurses into the fallback chain node and repeats from admission - `inst-recurse-fallback`
    3. [ ] - `p1` - **IF** no `fallback` continuation is declared - `inst-no-fallback`
       1. [ ] - `p1` - **RETURN** non-completed result propagating the error or timeout - `inst-return-failed`
12. [ ] - `p1` - Runtime removes the in-flight tracking entry for the target once the action promise settles - `inst-untrack-inflight`
13. [ ] - `p1` - **RETURN** final result with completion flag, execution path, and elapsed time - `inst-return-final`

## 3. Processes / Business Logic (CDSL)

### Mediator Keyed Dispatch and Recursive Chain Execution

- [ ] `p2` - **ID**: `cpt-frontx-algo-mfe-host-communication-mediator-dispatch`

**Input**: An actions chain with one action identifying target and action type, an optional chain timeout, and an execution path accumulator

**Output**: A chain result with completion flag, accumulated path, optional error, optional timeout flag, and elapsed time

**Steps**:
1. [x] - `p1` - Check whether the accumulated elapsed time exceeds the chain timeout; if exceeded, throw a chain-timeout error - `inst-check-chain-timeout`
2. [x] - `p1` - Delegate action admission to the injected type-system provider - `inst-delegate-admit`
3. [x] - `p1` - Look up the handler for the `(targetId, actionTypeId)` pair in the keyed handler registry - `inst-keyed-lookup`
4. [ ] - `p1` - **IF** no keyed handler is found for the pair - `inst-no-keyed`
   1. [x] - `p1` - Match the dispatched action type against each registered key through the type system's derivation check, in either direction, and use the first matching handler - `inst-hierarchy-lookup`
   2. [x] - `p1` - Look up the per-target catch-all handler; the catch-all tier enables forwarding to child domains whose action vocabulary is not enumerated in the parent - `inst-catchall-lookup`
   3. [x] - `p1` - **IF** no hierarchy-derived or catch-all handler matches, look up a downward forwarding entry — the same distinct cross-hop route shape as the escalation tier below, not a plain `ActionHandler` — for the target identifier, previously recorded through registration propagation from a descendant registry; exclude any forwarding entry whose bridge equals the chain's tagged arrival edge, if the chain carries one - `inst-forwarding-entry-lookup`
   4. [x] - `p1` - **IF** no forwarding entry resolves and the registry holds an inbound bridge (that is, the registry is not the shell), resolve the escalation tier: the cross-hop route the parent registry minted for that bridge at link time (`inst-mint-escalation-on-link`) — distinct in shape from a plain `ActionHandler`, since it carries the caller's remaining timeout budget across the hop and supports forced rejection on retraction — reached through the bridge itself - `inst-escalation-lookup`
      1. [x] - `p1` - That parent-minted handler tags the chain with this inbound bridge as its arrival edge for this dispatch before forwarding it to the parent registry's mediator, so the parent's forwarding-entry resolution never re-selects this same edge as the chain's next hop - `inst-tag-arrival-edge`
5. [x] - `p1` - **IF** neither a keyed, hierarchy-derived, catch-all, forwarding-entry, nor escalation handler exists for the target - `inst-no-handler`
   1. [x] - `p1` - Throw a missing-handler error that propagates to the chain fallback or outer result - `inst-throw-no-handler`
6. [x] - `p1` - Resolve the per-action timeout from the action's explicit timeout field or, if absent, from the domain's default action timeout - `inst-resolve-timeout`
7. [x] - `p1` - **IF** the resolved handler is the forwarding-entry or escalation handler, use as the per-action timeout bound the caller's remaining chain time budget, decremented by elapsed hop time, rather than resetting to the resolved default - `inst-cross-hop-timeout`
8. [x] - `p1` - Add the action dispatch to the in-flight tracking set for the target - `inst-add-inflight`
9. [x] - `p1` - Invoke the resolved handler within the per-action timeout bound - `inst-invoke-within-timeout`
10. [x] - `p1` - Remove the action from the in-flight tracking set once the promise settles - `inst-remove-inflight`
11. [x] - `p1` - **IF** handler execution succeeds - `inst-success`
    1. [x] - `p1` - Append the action type to the execution path - `inst-append-path-success`
    2. [x] - `p1` - **IF** the chain carries a `next` continuation - `inst-has-next`
       1. [x] - `p1` - Recurse into `next` with the updated path and remaining time budget - `inst-recurse-success`
    3. [x] - `p1` - **IF** no `next` continuation is declared - `inst-chain-done`
       1. [x] - `p1` - **RETURN** completed result - `inst-return-done`
12. [x] - `p1` - **IF** handler execution throws or times out - `inst-failure`
    1. [x] - `p1` - Append the action type to the execution path - `inst-append-path-failure`
    2. [x] - `p1` - **IF** the chain carries a `fallback` continuation - `inst-has-fallback`
       1. [x] - `p1` - Recurse into `fallback` with the updated path and remaining time budget - `inst-recurse-fallback-algo`
    3. [x] - `p1` - **IF** no `fallback` continuation is declared - `inst-no-fallback-algo`
       1. [x] - `p1` - Re-throw the error so the outer chain execution resolves it to a non-completed result - `inst-rethrow`

### Registration Propagation, Escalation, and Retraction

- [ ] `p2` - **ID**: `cpt-frontx-algo-mfe-host-communication-registration-propagation`

**Input**: A domain-or-extension admission event carrying a target identifier and its declared action-type id set, at a registry that may or may not hold an inbound bridge; an unmount, mount-failure, or disposal event for a host extension or registry; a registry-construction event that may occur while a mount is in progress, possibly against an independently loaded copy of this package from the extension's own mount host

**Output**: A newly constructed registry automatically holds the inbound bridge of the extension currently being mounted, if any and if resolvable, without any explicit action by the microfrontend author; every ancestor registry up to and including the shell holds a forwarding entry for the admitted target, or the advertisement was rejected by a collision guard and logged; on the host extension's unmount, mount failure, or the registry's own disposal, every advertisement propagated through that link is retracted by the parent and its in-flight forwarded actions are rejected

**Steps**:
1. [ ] - `p1` - While a mount is invoking an extension's lifecycle `mount(shadowRoot, childBridge, mountContext)` synchronously, the runtime records `childBridge` as the currently-mounting bridge through a realm-global, version-namespaced rendezvous point — not an ES-module-scoped variable, because the mounting extension and a registry it constructs may each hold their own independently loaded copy of this package — scoped to exactly that synchronous invocation; the same rendezvous entry also collects the re-link callback published by each registry that adopts that bridge during the window (step 2.2 — ordinarily exactly one), which the runtime takes off the entry as the window closes and retains against the host extension as its own private state, replacing whatever it retained for that extension from an earlier mount, so a later mount of that same extension can reach an already-constructed registry; nothing remains at the rendezvous itself once the window closes - `inst-track-mounting-bridge`
2. [ ] - `p1` - **IF** a registry is constructed while the rendezvous point holds a currently-mounting bridge tagged with a protocol version this copy recognizes (that is, the extension's own code builds a further `MfeRegistry` synchronously during its `mount` call) - `inst-adopt-ambient-bridge`
   1. [ ] - `p1` - The newly constructed registry automatically adopts that bridge as its own inbound bridge, with no configuration or method call required from the microfrontend author - `inst-inbound-bridge-auto-adopt`
   2. [ ] - `p1` - The adopting registry publishes, into the same rendezvous entry, a re-link callback the runtime retains against that host extension — the only channel through which a later mount of that extension can reach an already-constructed registry, carrying no importable symbol - `inst-publish-relink-callback`
3. [ ] - `p1` - **IF** no registry is constructed while the rendezvous point holds a currently-mounting bridge (the extension does not build its own nested registry synchronously within `mount`, or is not itself a host), or the rendezvous entry found carries a protocol version this copy does not recognize - `inst-no-ambient-bridge`
   1. [ ] - `p1` - The constructed registry holds no inbound bridge and behaves as a root/shell registry for propagation and escalation purposes; when a mounted extension exists elsewhere on the page and this registry still resolved no bridge, or an unrecognized protocol version was found, log a diagnostic rather than degrading silently - `inst-registry-is-root`
4. [ ] - `p1` - Every link the parent registry mints for a mount of a host extension carries, bound to that mount's specific bridge object, the escalation route and the arrival-edge tagging applied to a chain escalating through it; a nested registry reaches both through whichever link it currently holds — the one adopted at construction (step 2) or the one offered at re-link (step 5), which supplants it — and never by the child's own registry testing the bridge's concrete class identity, since the two sides may not share a class definition. Escalation resolves against the link held at dispatch time, so a re-linked registry escalates through the route and arrival-edge tagging the parent minted for the current mount, not a previous one - `inst-mint-escalation-on-link`
5. [ ] - `p1` - **IF** a mount's rendezvous window closes with no registry having freshly adopted the newly minted link (the host extension's own `mount()` body did not construct a new registry this time), the mount manager offers the newly minted link through the re-link callbacks it retained for that SAME host extension — the set published by the most recent mount of that extension that did produce an adoption, ordinarily exactly one, and never a callback published by any other extension's mount — and each such registry re-links, replacing whatever link it previously held - `inst-relink-on-remount`
   1. [ ] - `p1` - The re-linked registry re-advertises through the new link every target it currently holds: each domain and extension admitted to it, and every forwarding entry it holds on behalf of its own descendants. Because the parent already deleted every entry keyed to the previous edge when it revoked that link (step 10), these re-advertisements reach an ancestor holding no entry for their targets and are recorded afresh (step 9) - `inst-relink-repropagate`
   2. [ ] - `p1` - The re-linked registry re-establishes downward delivery on the new bridge, escalates thereafter through the route that new link carries (step 4), and discards its record of what the previous link had accepted - `inst-relink-downward-delivery`
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
10. [ ] - `p1` - On the unmount, mount failure, or disposal of the host extension a registry's inbound bridge belongs to, the parent registry — not the disposing side — revokes that link, deletes every forwarding entry it holds keyed to that specific bridge, and re-propagates the retraction to its own ancestors - `inst-retract-advertisements`
    1. [ ] - `p1` - The parent notifies every adopter it retained for that host extension to unlink; each notified registry drops the link, tears down its downward chain-delivery subscription, and clears its own record of what it had propagated - `inst-unlink-on-retraction`
    2. [ ] - `p1` - A revoked link refuses all further `propagateAdvertisement`, `retractAdvertisement`, and `escalate` calls, so a reference to it retained beyond retraction — by any copy of the runtime — can never resurrect routing over the disposed bridge - `inst-revoked-link-inert`
11. [ ] - `p1` - On a registry's own disposal, it symmetrically retracts every advertisement it had itself propagated through its own inbound bridge, recursively for the whole disposing subtree - `inst-retract-own-advertisements`
12. [ ] - `p1` - Reject any in-flight forwarded actions dispatched to the retracted targets, so that per-target in-flight tracking drains and a permanently pending action never blocks the unregistration - `inst-reject-inflight-retracted`
13. [ ] - `p1` - A nested registry is linked for as long as its host extension is mounted, across any number of mount cycles: a registry the author rebuilds inside each fresh `mount` call adopts the new link through step 2, and a registry the author reuses across a remount is re-linked through the re-offer step, so both patterns are equally supported and neither requires any action from the microfrontend author. The only registry that can never be linked is one whose construction never occurred inside any mount window at all — built at module-evaluation time, or asynchronously after `mount` already returned; it behaves as a root registry (step 3) with a logged diagnostic - `inst-nested-registry-lifetime-scope`

### Bridge Delegation to Registry

- [ ] `p2` - **ID**: `cpt-frontx-algo-mfe-host-communication-bridge-delegation`

**Input**: A child bridge instance wired with injected registry and mediator callbacks; a request from the child to execute an actions chain, register an action handler, or register a child domain

**Output**: Execution delegated to the host registry or mediator; no coordination logic inside the bridge itself

**Steps**:
1. [ ] - `p1` - **IF** the child requests to execute an actions chain - `inst-child-exec-chain`
   1. [x] - `p1` - Child bridge forwards the chain to the injected `executeActionsChain` registry callback without adding coordination logic - `inst-fwd-exec-chain`
2. [ ] - `p1` - **IF** the child registers an action handler for a specific action type - `inst-child-reg-handler`
   1. [x] - `p1` - Child bridge invokes the injected mediator-registration callback with the action type identifier and handler instance - `inst-fwd-reg-handler`
3. [ ] - `p1` - **IF** the child registers a child domain for cross-runtime action forwarding - `inst-child-reg-domain`
   1. [x] - `p1` - Child bridge invokes the injected child-domain-registration callback with the domain identifier - `inst-fwd-reg-domain`
   2. [x] - `p1` - Parent runtime registers a catch-all forwarding handler in the mediator, keyed to the child domain identifier - `inst-register-catchall`
   3. [x] - `p1` - The catch-all forwarding handler wraps any incoming action in an actions chain and delivers it through the bridge transport to the child runtime's mediator - `inst-catchall-forward`
4. [x] - `p1` - **IF** the parent runtime sends an action chain to the child's domain - `inst-parent-send-chain`
   1. [x] - `p1` - Parent bridge delivers the chain to the child bridge's registered actions-chain handler - `inst-deliver-to-child`
   2. [ ] - `p1` - Child bridge invokes its registered handler; if no handler is registered, throws a no-handler error - `inst-child-invoke`
5. [x] - `p1` - Parent bridge exposes `instanceId` and `dispose()` as its complete narrow public surface; disposal invokes child bridge cleanup - `inst-parent-handle`
6. [ ] - `p1` - The registry's inbound bridge — the bridge its own host extension received at mount time — carries registration-propagation advertisements and upward escalation as internal registry plumbing; it is registry-internal state, never handed to child code, and is not a fifth method on the child-facing bridge surface, which stays exactly `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler` regardless of nesting depth - `inst-inbound-bridge-internal`

## 4. States (CDSL)

### Action State Machine

- [ ] `p2` - **ID**: `cpt-frontx-state-mfe-host-communication-action-lifecycle`

**States**: PENDING, DISPATCHED, SUCCEEDED, FAILED, FALLBACK

**Initial State**: PENDING

**Transitions**:
1. [ ] - `p1` - **FROM** PENDING **TO** DISPATCHED **WHEN** a handler is resolved and the action is invoked within its timeout bound - `inst-t-pending-dispatched`
2. [ ] - `p1` - **FROM** DISPATCHED **TO** SUCCEEDED **WHEN** handler execution completes without error - `inst-t-dispatched-succeeded`
3. [ ] - `p1` - **FROM** DISPATCHED **TO** FAILED **WHEN** handler execution throws an error or the per-action timeout expires - `inst-t-dispatched-failed`
   **Actions**:
   - [ ] - `p1` - Runtime records the action type in the execution path - `inst-failed-record-path`
   - [ ] - `p1` - Runtime removes the in-flight tracking entry for the target - `inst-failed-untrack`
   - [ ] - `p1` - **IF** the chain declares a `fallback` continuation - `inst-failed-check-fallback`
     - [ ] - `p1` - Transition the action to FALLBACK and recurse into the fallback chain node - `inst-failed-to-fallback`
   - [ ] - `p1` - **IF** no `fallback` is declared - `inst-failed-no-fallback`
     - [ ] - `p1` - Propagate the error; the outer chain execution resolves to a non-completed result - `inst-failed-propagate`
4. [ ] - `p1` - **FROM** FAILED **TO** FALLBACK **WHEN** the chain declares a fallback continuation that is recursively executed - `inst-t-failed-fallback`
5. [ ] - `p1` - **FROM** SUCCEEDED **TO** DISPATCHED **WHEN** the chain declares a `next` continuation and the next action is dispatched - `inst-t-succeeded-dispatched`

## 5. Definitions of Done

### Mediator Keyed Dispatch and In-Flight Tracking

- [ ] `p1` - **ID**: `cpt-frontx-dod-mfe-host-communication-mediator-dispatch`

The system **MUST** implement the actions-chains mediator with a keyed `(targetId, actionTypeId)` handler registry and a per-target catch-all tier, executing chains recursively with success and fallback branching, per-action and whole-chain timeout bounds, and in-flight tracking that blocks handler unregistration for a target while its actions are pending. Action admission is delegated to the injected type-system provider; the mediator carries no type-format knowledge. The property channel passed through the bridge surface carries no solution-specific identifiers, satisfying `cpt-frontx-constraint-mfes-no-solution-shared-properties` (MFES-2). The reachability guarantee behind this handler resolution MUST hold transitively across any nesting depth, not just at a single hop, and MUST hold when a nested registry is built against its own independently loaded copy of this package rather than sharing an evaluated module with its host: a registry constructed while an extension's `mount` call is synchronously in progress MUST automatically adopt that extension's bridge as its own inbound bridge, coordinated through a realm-global, version-namespaced rendezvous rather than shared module state, with no configuration or method call from the microfrontend author; a registry that resolves no bridge, or resolves a rendezvous entry tagged with an unrecognized protocol version, MUST behave as a root registry and MUST log a diagnostic rather than degrading silently; admitting a domain or extension MUST automatically propagate a forwarding advertisement through the registry's inbound bridge to every ancestor up to and including the shell, with a collision guard that MUST accept, without rejection and without a diagnostic, an advertisement re-stating an entry the ancestor already holds for the very edge that advertisement arrived on, and MUST reject and log one whose target identifier collides with an entry the ancestor holds locally or for a different edge; resolution MUST add a downward forwarding-entry tier and, when the registry holds an inbound bridge, a final upward-escalation tier reached through that bridge and carried by the link the parent registry minted for the current mount rather than identified by the child testing the bridge's concrete class, both reusing the catch-all-tier and chain-execution machinery so timeout, in-flight tracking, and branching apply uniformly; a forwarded or escalated chain MUST carry the caller's remaining time budget across each bridge hop rather than resetting it per hop, and MUST be tagged with its arrival edge so forwarding-entry resolution never re-selects that same edge as the chain's next hop; and on a host extension's unmount, mount failure, or a registry's own disposal, the parent registry MUST retract every advertisement propagated through that link and reject in-flight forwarded actions for its targets so per-target in-flight tracking drains. The parent registry MUST re-offer a fresh link, on every subsequent mount of the same host extension, through the re-link callbacks it retained from that extension's most recent adopting mount — ordinarily exactly one, and never a callback published by a different extension's mount; a registry re-linked this way MUST re-propagate every target it currently holds, both its own admissions and the forwarding entries it holds on behalf of its own descendants, and MUST escalate thereafter through the escalation route and arrival-edge tagging the fresh link carries; and a link revoked on unmount, mount failure, or disposal MUST be inert, refusing all further propagation, retraction, and escalation through it, so no ancestor can ever acquire or retain a forwarding entry pointing at a disposed bridge. This composition MUST introduce zero growth to the package's public surface, satisfying `cpt-frontx-constraint-mfes-cross-nesting-reachability` (MFES-6): no new public method is added to `MfeRegistry` or any other exported type to support propagation, the collision guard, escalation, timeout-budget carry-over, loop containment, or retraction, and the rendezvous protocol carries no importable symbol.

**Implements**:
- `cpt-frontx-flow-mfe-host-communication-dispatch-chain`
- `cpt-frontx-algo-mfe-host-communication-mediator-dispatch`
- `cpt-frontx-algo-mfe-host-communication-registration-propagation`

**Constraints**: `cpt-frontx-constraint-mfes-no-solution-shared-properties`, `cpt-frontx-constraint-mfes-cross-nesting-reachability`

**Touches**:
- Entities: `Action`, `ActionsChain`
- Component: `cpt-frontx-component-mfe-runtime`

### Narrow Capability Bridge With Delegating Methods

- [ ] `p1` - **ID**: `cpt-frontx-dod-mfe-host-communication-bridge-delegation`

The system **MUST** provide a child bridge exposing exactly `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler`, each delegating to the host registry or mediator without duplicating coordination logic, and a matching parent bridge exposing only `instanceId` and `dispose()`. The bridge MUST NOT expose runtime internals. Child domain forwarding MUST use the catch-all handler tier in the parent mediator, forwarding actions through the bridge transport without the parent enumerating the child's action vocabulary. This four-method child-facing surface MUST remain unchanged regardless of nesting depth, satisfying `cpt-frontx-constraint-mfes-cross-nesting-reachability` (MFES-6): the registry's own inbound bridge that carries registration-propagation advertisements and upward escalation is internal registry plumbing, not a bridge method, and propagation and escalation MUST be fully automatic internal registry behavior, triggered by admission, by re-mount of the host extension, and by disposal, requiring no explicit registration call and no action by the microfrontend author.

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
- [ ] When neither a keyed, hierarchy-derived, nor catch-all handler matches, resolution continues through a downward forwarding entry and, when the registry has an inbound bridge, a final upward-escalation handler, before treating the target as unresolved
- [x] Chain execution follows the `next` continuation on success and the `fallback` continuation on failure, both within per-action and whole-chain timeout bounds
- [x] In-flight action tracking prevents unregistration of a target's handlers while actions for that target are pending
- [x] Action admission is delegated to the injected type-system provider; no type-format literals appear in the mediator
- [x] The child bridge surface is exactly `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler`; the parent bridge surface is exactly `instanceId` and `dispose()`, unchanged regardless of nesting depth
- [x] The property channel carries no solution-specific shared-property identifiers, satisfying `cpt-frontx-constraint-mfes-no-solution-shared-properties` (MFES-2)
- [x] Child domain forwarding uses the catch-all handler tier in the parent mediator, forwarding actions through the bridge transport without the parent enumerating the child's action vocabulary
- [ ] A registry constructed while an extension's `mount` call is synchronously in progress automatically adopts that extension's bridge as its own inbound bridge via a realm-global rendezvous, requiring no configuration or method call by the microfrontend author, and this holds even when the registry and its host extension are evaluating independently loaded copies of this package; a registry constructed outside any such window, or resolving a rendezvous entry it cannot recognize, holds no inbound bridge, behaves as a root registry, and logs a diagnostic
- [ ] Admitting a domain or extension automatically propagates a forwarding advertisement through each registry's inbound bridge, so that every ancestor up to and including the shell ends up holding a forwarding entry for the admitted target, without any explicit registration action by the microfrontend author
- [ ] An ancestor that already holds a local registration, or a forwarding entry recorded for a different edge, for an advertised target identifier rejects the colliding advertisement, logs a diagnostic, and does not propagate it further; an advertisement re-stating an entry that ancestor already holds for the very edge it arrived on is accepted as an idempotent no-op, neither rejected nor logged
- [ ] A chain unresolved by the keyed, hierarchy-derived, local catch-all, and forwarding-entry tiers escalates upward through the registry's inbound bridge to the parent's mediator, except at the shell, which has no further ancestor to escalate to, using an escalation handler the parent registry minted at link time rather than one the child identifies by testing the bridge's concrete class
- [ ] A forwarded or escalated chain's remaining timeout budget is carried and decremented across each bridge hop it crosses, rather than being reset to a fresh default at each hop
- [ ] A chain never re-selects, as its next hop, the bridge edge it most recently arrived on, preventing an escalate-then-forward loop between the same two registries
- [ ] A host extension's unmount, mount failure, or a registry's own disposal causes the parent registry to retract every forwarding advertisement propagated through that link and reject in-flight forwarded actions for its targets, so per-target in-flight tracking drains, regardless of whether the registry's own author disposes it
- [ ] A registry rebuilt inside a fresh `mount` call on remount re-advertises cleanly because its predecessor's link and forwarding entries were already retracted on unmount; a registry an author reuses across a remount, without rebuilding it, is automatically re-linked to the fresh bridge when its host extension mounts again, re-advertises every target it still holds, and escalates thereafter through the route that fresh link carries — so both patterns route correctly, and neither can ever route through a previous mount's disposed bridge
- [ ] A link revoked on unmount, mount failure, or disposal is inert: a registry that retained a reference to it can neither propagate, retract, nor escalate through it, so no ancestor can acquire a forwarding entry pointing at a disposed bridge
- [ ] Propagation, the collision guard, escalation, timeout-budget carry-over, loop containment, and retraction introduce no new public method or exported type anywhere in the package's public surface, satisfying `cpt-frontx-constraint-mfes-cross-nesting-reachability` (MFES-6); the inbound-bridge rendezvous is verified, by a test exercising two independently loaded copies of this package rather than one shared module graph, to adopt correctly and never misattribute one extension's bridge to another's registry
