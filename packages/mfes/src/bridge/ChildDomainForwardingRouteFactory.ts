// @cpt-flow:cpt-frontx-flow-mfe-host-communication-dispatch-chain:p1
// @cpt-algo:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2
/**
 * Child Domain Forwarding Route
 *
 * Builds the cross-hop route for forwarding actions targeting a child
 * domain to the child runtime via the bridge transport.
 *
 * When a child MFE registers its own domain, the parent runtime needs a way
 * to route actions to it. This route is registered in the parent's mediator
 * as the catch-all tier for the child domain ID. Per
 * `cpt-frontx-adr-action-dispatch-and-chaining`, every hop that crosses a
 * runtime boundary — this one included — must resolve to the same
 * `CrossHopRoute` shape as the downward forwarding-entry and upward
 * escalation tiers, never to a plain `ActionHandler`: a handler is invoked
 * by the dispatching mediator AFTER it has already admitted the action, so
 * a hop wearing a handler's shape would admit at the forwarding (parent)
 * registry instead of the one authoritative for the target, and would run
 * under a bound the forwarding registry resolved locally rather than the
 * one the authoritative registry resolves for its own target.
 *
 * A catch-all tier is used here because the parent cannot know the full set
 * of action types the child domain supports at registration time — that
 * information lives in the child's own registry.
 *
 * Delivery goes through `ParentMfeBridgeImpl.sendCrossHopEnvelope`, which
 * itself throws `BridgeInactiveError`/`BridgeDisposedError` while the
 * bridge is inactive or destroyed — this class adds no gating logic of its
 * own.
 *
 * @packageDocumentation
 * @internal
 */

import { CrossHopRoute, type CrossHopEnvelope } from '../mediator/CrossHopRoute';
import type { ParentMfeBridgeImpl } from './ParentMfeBridgeImpl';

/**
 * Builds the cross-hop route forwarding any action targeting a child
 * domain through the parent bridge transport.
 *
 * Stateless — every method is a pure function of its arguments — but
 * exposed as an instance method behind an object `DefaultRuntimeBridgeFactory`
 * holds (a private field injected through that factory's constructor,
 * defaulted to this concrete class so every existing caller of that
 * still-public constructor keeps working unchanged) rather than a
 * static-only namespace: a substitutable collaborator, not a bag of global
 * functions.
 *
 * @internal
 */
export class ChildDomainForwardingRouteFactory {
  /**
   * Build the cross-hop route forwarding any action targeting
   * `childDomainId` through the parent bridge transport.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-register-catchall
  create(
    parentBridgeImpl: ParentMfeBridgeImpl,
    childDomainId: string
  ): CrossHopRoute {
    return new CrossHopRoute(
      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-catchall-forward
      (envelope: CrossHopEnvelope): void => {
        // The catch-all tier's key is the child domain id, which is the
        // action's target here. Hands the sub-chain over: a throw refuses,
        // with no side effect in the child runtime; a return means the
        // child's registry accepted it (`inst-hand-over-node`).
        const forwarded: CrossHopEnvelope = {
          ...envelope,
          chain: { ...envelope.chain, action: { ...envelope.chain.action, target: childDomainId } },
        };
        parentBridgeImpl.sendCrossHopEnvelope(forwarded);
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-catchall-forward
    );
  }
}
// @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-register-catchall
