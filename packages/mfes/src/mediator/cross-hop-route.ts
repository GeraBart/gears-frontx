/**
 * Cross-hop routing types for the downward forwarding-entry and upward
 * escalation resolution tiers.
 *
 * Deliberately NOT an `ActionHandler`: a `CrossHopRoute` needs to carry the
 * caller's remaining chain-time budget across the bridge hop it crosses
 * (`inst-cross-hop-timeout`) and support forced-rejection of an in-flight
 * dispatch on retraction (`inst-reject-inflight-retracted`), neither of which
 * fits `ActionHandler.handleAction(actionTypeId, payload)`'s narrower shape.
 * Internal-only: not exported from the package's public barrel.
 *
 * @packageDocumentation
 * @internal
 */

import type { ActionsChain } from '../types';

export interface CrossHopRoute {
  /**
   * Send the (re-wrapped) chain across this hop — down through a specific
   * child's bridge for a forwarding entry, or up through the registry's own
   * inbound bridge for escalation.
   */
  send(chain: ActionsChain): Promise<void>;

  /**
   * Register a reject callback to be invoked if this route's target is
   * retracted while the dispatch is in flight. Returns an unregister
   * function to call once the dispatch settles normally.
   */
  registerInFlight(reject: (err: Error) => void): () => void;
}
