import type { ActionsChain, SharedProperty } from '../types';
import { ActionHandler } from '../mediator/ActionHandler';

/**
 * Child MFE Bridge abstract class.
 * Provided to child MFEs for communication with the host.
 */
// @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-inbound-bridge-internal
export abstract class ChildMfeBridge {
  /** The GTS id of the domain the extension is mounted into. */
  abstract readonly extDomainId: string;
  /** The extension's own GTS id. */
  abstract readonly extensionId: string;

  /**
   * Accept (or synchronously refuse) an actions chain for execution via the
   * registry. This is a capability pass-through — the bridge forwards
   * directly to the registry's own acceptance-only `executeActionsChain`,
   * adding no coordination logic of its own. This is the ONLY public API
   * for actions chain execution from child MFEs
   * (`cpt-frontx-adr-child-mfe-host-access`).
   *
   * Acceptance-only: yields nothing a child can await for the chain's own
   * execution, and takes no per-call execution-options argument. Refuses
   * synchronously, at the call, when this bridge is disposed, already
   * inactive, or holds no wired dispatch callback — each an unusable
   * dispatch capability at the moment of the call, distinct from a bridge
   * that becomes inactive or loses its route only AFTER a chain has already
   * been accepted through it, which instead lets that chain's declared
   * `fallback` run.
   *
   * @param chain - Actions chain to accept.
   * @throws {Error} synchronously if this bridge is disposed, inactive, or
   *   unwired, or if the chain itself is refused by the registry.
   */
  abstract executeActionsChain(chain: ActionsChain): void;

  /**
   * Subscribe to a specific property's updates.
   *
   * @param propertyTypeId - Type ID of the property to subscribe to
   * @param callback - Callback invoked when property updates
   * @returns Unsubscribe function
   */
  abstract subscribeToProperty(propertyTypeId: string, callback: (value: SharedProperty) => void): () => void;

  /**
   * Get a property's current value synchronously.
   *
   * @param propertyTypeId - Type ID of the property to get
   * @returns Current property value, or undefined if not set
   */
  abstract getProperty(propertyTypeId: string): SharedProperty | undefined;

  /**
   * Register a handler for a specific action type on this MFE.
   * The MFE may call this once per action type it wants to handle.
   * The mediator routes extension-targeted actions by (extensionId, actionTypeId) pair.
   *
   * @param actionTypeId - The action type this handler handles
   * @param handler - The ActionHandler instance to invoke
   */
  abstract registerActionHandler(actionTypeId: string, handler: ActionHandler): void;
}
// @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-inbound-bridge-internal
