/**
 * Dispatch-diagnostics origin tagging and correlation-identity issuance.
 *
 * Realizes the carrying half of `inst-diagnostic-record`
 * (`mfe-host-communication/FEATURE.md`): a structured diagnostic for a
 * refusal or a node failure must carry "a correlation identity for the
 * dispatch, and, where the dispatch carried them, the originating lifecycle
 * stage and extension". Two distinct pieces of context travel through the
 * executor's own recursion (and, when a chain crosses a hop, through the
 * `CrossHopEnvelope.diagnostics` field that carries this across a hop):
 *
 *  - A correlation identity, minted once per accepted root chain, once per
 *    refused lifecycle-hook dispatch, or once per cross-hop single-node
 *    execution that received none — always from the registry's one
 *    `DispatchCorrelationIdGenerator` — so every diagnostic produced while
 *    executing that one dispatch — however many nodes or hops it traverses —
 *    can be told apart from every other dispatch's diagnostics, including
 *    those of another registry reporting to the same sink. Each generator
 *    folds a random namespace into its ids — probabilistically unique across
 *    module copies and registries — drawn from `crypto.randomUUID()`, else
 *    16 `crypto.getRandomValues()` bytes (hex), else a timestamp, a per-copy
 *    ordinal and a `Math.random()` string.
 *  - An optional origin (lifecycle stage id + entity kind/id), tagged onto
 *    the dispatched chain's root `Action` object BEFORE it is handed to
 *    `executeActionsChain`, by whichever caller has that context —
 *    currently only `DefaultLifecycleManager`, for a lifecycle-hook-
 *    triggered chain. A chain dispatched by ordinary application code
 *    carries no such tag, and the origin fields are simply absent from its
 *    diagnostics, exactly as the instruction's "where the dispatch carried
 *    them" anticipates. The accepted execution consumes the tag when it
 *    captures it (`DispatchOriginStore.take`), so the origin belongs to that
 *    ONE execution and never to a new root dispatch a handler starts with
 *    the same `Action` object.
 *
 * Tagging is by object identity via a `WeakMap` held on a `DispatchOriginStore`
 * instance, the same pattern `inbound-bridge-link.ts` uses for arrival-edge
 * tagging (`tagArrivalEdge`/`getArrivalEdge`). `DefaultMfeRegistry` — the
 * composition root — constructs exactly ONE `DispatchOriginStore` (and one
 * `DispatchCorrelationIdGenerator`, and the `DiagnosticReporter` wired to
 * both) per registry instance, and injects that same instance into both
 * `DefaultLifecycleManager` (the write side) and `DefaultActionsChainsMediator`
 * (the read side, via `runAcceptedChain`), so the write and the read observe
 * the SAME store without depending on a module-level singleton: no field is
 * added to the public `Action`/`ActionsChain` GTS-backed contracts
 * (`packages/mfes/src/types/index.ts`) to carry this either — it stays
 * purely on this internal, per-registry side channel.
 *
 * @packageDocumentation
 * @internal
 */

import type { Action } from '../types';

/**
 * The lifecycle-triggering context a dispatch may have been tagged with:
 * which stage, on which entity, triggered the chain this diagnostic
 * attributes.
 */
export interface DispatchOriginContext {
  readonly entityKind: 'extension' | 'domain';
  readonly entityId: string;
  readonly stageId: string;
}

/**
 * Holds the identity-keyed association between a chain's root `Action` and
 * the lifecycle origin that dispatched it. A `WeakMap` keyed by `Action`
 * object identity, so a tagged action is reclaimable the moment nothing
 * else references it.
 */
export class DispatchOriginStore {
  private readonly originByAction = new WeakMap<Action, DispatchOriginContext>();

  /**
   * Tag a chain's root action with the lifecycle stage/entity that is about
   * to dispatch it, BEFORE handing the chain to `executeActionsChain`.
   * Called only by a caller that itself has this context (today,
   * exclusively `DefaultLifecycleManager`).
   */
  tag(action: Action, origin: DispatchOriginContext): void {
    this.originByAction.set(action, origin);
  }

  /**
   * Read back the origin tagged onto a chain's root action, if any, leaving
   * the tag in place. Ordinary (non-lifecycle-triggered) dispatches were
   * never tagged, so this returns `undefined` for them — the diagnostic
   * simply omits the origin fields, per "where the dispatch carried them".
   * Used where a dispatch is refused BEFORE any execution captures the
   * origin (`DiagnosticReporter.reportSynchronousChainRefusal`), so the tag
   * stays visible to the tagging caller's own refusal handling.
   */
  get(action: Action): DispatchOriginContext | undefined {
    return this.originByAction.get(action);
  }

  /**
   * Read back AND remove the origin tagged onto a chain's root action, if
   * any: the capture that consumes the tag.
   * `DefaultActionsChainsMediator.runAcceptedChain` calls this once, when it
   * builds an accepted chain's `DiagnosticContext`, before any handler of
   * that chain is invoked. The tag therefore belongs to exactly the ONE
   * accepted execution it was set for: a handler of that execution that
   * synchronously starts a NEW root dispatch reusing the SAME `Action`
   * object finds no tag, so that dispatch is a new root execution with its
   * own diagnostic context (`inst-new-root-execution`) — its synchronous
   * refusal is reported rather than suppressed, and its node failures carry
   * no lifecycle origin (`inst-diagnostic-record`).
   */
  take(action: Action): DispatchOriginContext | undefined {
    const origin = this.originByAction.get(action);
    this.originByAction.delete(action);
    return origin;
  }

  /**
   * Remove a previously tagged origin for a chain's root action.
   * `DefaultLifecycleManager` calls this in a `finally` around its own
   * synchronous `executeActionsChain` call, right after that call returns or
   * throws. For an accepted chain, `take` has already consumed the tag at
   * capture and this is a no-op; for a chain refused BEFORE capture, this is
   * what removes the tag.
   *
   * Without this, a hook's own root `Action` object — reused, unchanged,
   * across every future trigger of that hook per the manifest — would stay
   * tagged after a refused dispatch: the SAME action object later dispatched
   * by ordinary application code (outside any lifecycle stage) would still
   * read back this stale origin, and
   * `DiagnosticReporter.reportSynchronousChainRefusal` would then (wrongly)
   * treat that unrelated dispatch's own synchronous refusal as belonging to
   * a lifecycle-tagged caller and suppress it, rather than reporting it as
   * the untagged, ordinary refusal it actually is. A no-op if `action` was
   * never tagged, or its tag was already consumed or removed.
   */
  untag(action: Action): void {
    this.originByAction.delete(action);
  }
}
