/**
 * Default Runtime Bridge Factory Implementation
 *
 * Concrete runtime bridge factory that handles all internal bridge wiring:
 * creates bridge pairs, connects property subscriptions, wires action chain
 * callbacks, and sets up child domain forwarding.
 *
 * @packageDocumentation
 * @internal
 */

import type { ParentMfeBridge, ChildMfeBridge } from '../handler/types';
import type { ActionsChain } from '../types';
import type { ActionHandler } from '../mediator/types';
import type { ExtensionDomainState } from './extension-manager';
import { RuntimeBridgeFactory } from './runtime-bridge-factory';
import { ChildMfeBridgeImpl } from '../bridge/ChildMfeBridge';
import { ParentMfeBridgeImpl } from '../bridge/ParentMfeBridge';
import { ChildDomainForwardingHandler } from '../bridge/ChildDomainForwardingHandler';

/**
 * Monotonically-incrementing counter used to disambiguate bridge instance
 * ids minted within the same millisecond. Module-private -- not exported.
 */
let instanceSequence = 0;

/**
 * Default runtime bridge factory implementation.
 *
 * Handles all internal bridge wiring: creates bridge pairs, connects
 * property subscriptions, wires action chain callbacks, and sets up
 * child domain forwarding.
 *
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2
export class DefaultRuntimeBridgeFactory extends RuntimeBridgeFactory {
  /**
   * Create a bridge connection between host and child MFE.
   * INTERNAL: Called by mountExtension.
   *
   * @param domainState - Domain state containing properties and subscribers
   * @param extensionId - ID of the extension
   * @param entryTypeId - Type ID of the MFE entry
   * @param domainActions - Action type IDs the entry declares it can receive (unused — kept for API compat)
   * @param executeActionsChain - Callback for executing actions chains from child to parent
   * @param registerCatchAllActionHandler - Callback for registering catch-all child domain handlers in parent mediator
   * @param unregisterCatchAllActionHandler - Callback for unregistering catch-all child domain handlers from parent mediator
   * @param registerExtensionActionHandler - Callback for registering per-(extensionId, actionTypeId) handlers
   * @param _unregisterExtensionActionHandler - Callback for unregistering all extension handlers (unused — cleanup handled by mount manager)
   * @returns Object containing parent and child bridge instances
   */
  createBridge(
    domainState: ExtensionDomainState,
    extensionId: string,
    _entryTypeId: string,
    _domainActions: readonly string[],
    executeActionsChain: (chain: ActionsChain) => Promise<void>,
    registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void,
    unregisterCatchAllActionHandler: (domainId: string) => void,
    registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void,
    _unregisterExtensionActionHandler: (extensionId: string) => void
  ): { parentBridge: ParentMfeBridge; childBridge: ChildMfeBridge } {

    // Generate a unique instance ID. The counter guarantees uniqueness per
    // call regardless of how many mounts of the same `extensionId` occur
    // within the same clock tick, without depending on `crypto.randomUUID()`
    // (a secure-context-gated Web API unavailable in plain-HTTP dev setups).
    const instanceId = `${extensionId}:${Date.now()}:${++instanceSequence}`;

    // Create child bridge
    const childBridge = new ChildMfeBridgeImpl(domainState.domain.id, instanceId);

    // Create parent bridge (concrete type for access to internal methods)
    const parentBridgeImpl = new ParentMfeBridgeImpl(childBridge);

    // Connect child to parent
    childBridge.setParentBridge(parentBridgeImpl);

    // Wire child action handler (internal wiring, not on public interface)
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-exec-chain
    parentBridgeImpl.onChildAction(executeActionsChain);

    // Wire registry's executeActionsChain to child bridge as capability pass-through
    childBridge.setExecuteActionsChainCallback(executeActionsChain);
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-exec-chain

    // Wire child domain forwarding callbacks.
    // The forwarding handler is registered as a catch-all because the parent
    // cannot enumerate the child domain's action types at registration time.
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-domain
    const registerChildDomainCallback = (domainId: string) => {
      const handler = new ChildDomainForwardingHandler(parentBridgeImpl, domainId);
      registerCatchAllActionHandler(domainId, handler);
    };

    const unregisterChildDomainCallback = (domainId: string) => {
      unregisterCatchAllActionHandler(domainId);
    };

    childBridge.setChildDomainCallbacks(registerChildDomainCallback, unregisterChildDomainCallback);
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-domain

    // Wire per-(extensionId, actionTypeId) handler registration.
    // The bridge captures extensionId and domainId from createBridge params.
    // domainId is required so the mediator can populate targetDomainMap, which
    // allows resolveTimeout() to find the domain's defaultActionTimeout for
    // extension-targeted actions.
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-handler
    childBridge.setRegisterActionHandlerCallback((actionTypeId, handler) => {
      registerExtensionActionHandler(extensionId, actionTypeId, handler, domainState.domain.id);
    });
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-handler

    // Populate initial properties from domain state (raw values)
    for (const [propertyTypeId, rawValue] of domainState.properties) {
      parentBridgeImpl.receivePropertyUpdate(propertyTypeId, rawValue);
    }

    // Subscribe to domain property updates and track subscribers for cleanup
    for (const propertyTypeId of domainState.domain.sharedProperties) {
      if (!domainState.propertySubscribers.has(propertyTypeId)) {
        domainState.propertySubscribers.set(propertyTypeId, new Set());
      }
      const subscriber = (receivedPropertyTypeId: string, value: unknown) => {
        parentBridgeImpl.receivePropertyUpdate(receivedPropertyTypeId, value);
      };
      domainState.propertySubscribers.get(propertyTypeId)!.add(subscriber);

      // Track subscriber in parent bridge for cleanup on disposal
      parentBridgeImpl.registerPropertySubscriber(propertyTypeId, subscriber);
    }

    return { parentBridge: parentBridgeImpl, childBridge };
  }

  /**
   * Dispose a bridge connection and clean up domain subscribers.
   * INTERNAL: Called by unmountExtension.
   *
   * @param domainState - Domain state containing property subscribers
   * @param parentBridge - Parent bridge to dispose
   */
  disposeBridge(
    domainState: ExtensionDomainState,
    parentBridge: ParentMfeBridge
  ): void {
    // Access concrete type for internal methods
    if (!(parentBridge instanceof ParentMfeBridgeImpl)) {
      throw new Error('disposeBridge requires a ParentMfeBridgeImpl instance');
    }
    const impl = parentBridge;

    // Remove property subscribers from domain before disposing bridge
    const subscribers = impl.getPropertySubscribers();
    for (const [propertyTypeId, subscriber] of subscribers) {
      const domainSubscribers = domainState.propertySubscribers.get(propertyTypeId);
      if (domainSubscribers) {
        domainSubscribers.delete(subscriber);
      }
    }

    // Now dispose the bridge
    parentBridge.dispose();
  }
}
