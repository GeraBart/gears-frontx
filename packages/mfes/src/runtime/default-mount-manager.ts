/**
 * Default Mount Manager Implementation
 *
 * Concrete mount manager that handles MFE loading, mounting, and unmounting
 * with full lifecycle support.
 * Extracted from the legacy screensets package in Phase 7 (extension-domain governance).
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2
// @cpt-state:cpt-frontx-state-extension-domain-governance-admission:p1
// @cpt-dod:cpt-frontx-dod-extension-domain-governance-default-deny:p1

import type { ChildMfeBridge, MfeHandler, MfeMountContext, ParentMfeBridge } from '../handler/types';
import type { TypeSystemPlugin } from '../type-substrate';
import type { RuntimeCoordinator } from './coordination/types';
import type { ActionHandler } from '../mediator/types';
import type { ActionsChain } from '../types';
import { DefaultExtensionManager } from './default-extension-manager';
import type { MfeRegistry } from '../registry/MfeRegistry';
import { MountManager } from './mount-manager';
import type { ActionChainExecutor, LifecycleTrigger } from './mount-manager';
import { RuntimeBridgeFactory } from './runtime-bridge-factory';
import { createShadowRoot } from '../shadow';
import {
  popAmbientMountingBridge,
  pushAmbientMountingBridge,
  registerInboundBridgeLink,
  type InboundBridgeLink,
  type InboundBridgeRelink,
} from './inbound-bridge-link';

export type HandlerResolver = (entryTypeId: string) => MfeHandler | undefined;

export class DefaultMountManager extends MountManager {
  private readonly extensionManager: DefaultExtensionManager;
  private readonly resolveHandler: HandlerResolver;
  private readonly coordinator: RuntimeCoordinator;
  private readonly typeSystem: TypeSystemPlugin;
  private readonly triggerLifecycle: LifecycleTrigger;
  private readonly executeActionsChain: ActionChainExecutor;
  private readonly hostRuntime: MfeRegistry;
  private readonly registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void;
  private readonly unregisterCatchAllActionHandler: (domainId: string) => void;
  private readonly registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void;
  private readonly unregisterExtensionActionHandler: (extensionId: string) => void;
  private readonly bridgeFactory: RuntimeBridgeFactory;
  private readonly buildInboundBridgeLink: (
    extensionId: string,
    childBridge: ChildMfeBridge,
    parentBridge: ParentMfeBridge
  ) => InboundBridgeLink;
  private readonly retractInboundBridgeLink: (childBridge: ChildMfeBridge) => void;

  /**
   * The `ChildMfeBridge` handed to each currently-mounted extension's own
   * `lifecycle.mount(...)`, tracked internally (never exposed) so that
   * `unmountExtension` and a mount-failure catch path can trigger
   * parent-owned retraction (`inst-retract-advertisements`) for the exact
   * bridge object a descendant registry may have propagated advertisements
   * through — regardless of whether that descendant's own registry ever
   * disposes itself.
   */
  private readonly childBridgesByExtension = new Map<string, ChildMfeBridge>();

  /**
   * The re-link callback of whichever registry adopted the inbound-bridge
   * link of the CURRENT (or most recent) mount of each extension, keyed by
   * extension id — retained across unmount/remount cycles, not cleared on
   * retraction. This is what lets a registry an author reuses (rather than
   * rebuilds) across a remount be re-linked to the fresh bridge the next time
   * its host extension mounts: `mountExtension` re-offers the new link to
   * every callback recorded here whenever the ambient rendezvous window
   * closes with no fresh adoption of its own (`inst-relink-on-remount`).
   */
  private readonly inboundAdoptersByExtension = new Map<string, readonly InboundBridgeRelink[]>();

  constructor(config: {
    extensionManager: DefaultExtensionManager;
    resolveHandler: HandlerResolver;
    coordinator: RuntimeCoordinator;
    typeSystem: TypeSystemPlugin;
    triggerLifecycle: LifecycleTrigger;
    executeActionsChain: ActionChainExecutor;
    hostRuntime: MfeRegistry;
    registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void;
    unregisterCatchAllActionHandler: (domainId: string) => void;
    registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void;
    unregisterExtensionActionHandler: (extensionId: string) => void;
    bridgeFactory: RuntimeBridgeFactory;
    buildInboundBridgeLink: (
      extensionId: string,
      childBridge: ChildMfeBridge,
      parentBridge: ParentMfeBridge
    ) => InboundBridgeLink;
    retractInboundBridgeLink: (childBridge: ChildMfeBridge) => void;
  }) {
    super();
    this.extensionManager = config.extensionManager;
    this.resolveHandler = config.resolveHandler;
    this.coordinator = config.coordinator;
    this.typeSystem = config.typeSystem;
    this.triggerLifecycle = config.triggerLifecycle;
    this.executeActionsChain = config.executeActionsChain;
    this.hostRuntime = config.hostRuntime;
    this.registerCatchAllActionHandler = config.registerCatchAllActionHandler;
    this.unregisterCatchAllActionHandler = config.unregisterCatchAllActionHandler;
    this.registerExtensionActionHandler = config.registerExtensionActionHandler;
    this.unregisterExtensionActionHandler = config.unregisterExtensionActionHandler;
    this.bridgeFactory = config.bridgeFactory;
    this.buildInboundBridgeLink = config.buildInboundBridgeLink;
    this.retractInboundBridgeLink = config.retractInboundBridgeLink;
  }

  async loadExtension(extensionId: string): Promise<void> {
    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (!extensionState) {
      throw new Error(
        `Cannot load extension '${extensionId}': extension is not registered. ` +
        `Call registerExtension() first.`
      );
    }

    if (extensionState.loadState === 'loaded') {
      return;
    }
    if (extensionState.loadState === 'loading') {
      return;
    }

    extensionState.loadState = 'loading';
    extensionState.error = undefined;

    try {
      const entry = extensionState.entry;
      const handler = this.resolveHandler(entry.id);
      if (!handler) {
        throw new Error(
          `No MFE handler registered that can handle entry type '${entry.id}'. ` +
          `Provide handlers via 'mfeHandlers' in MfeRegistryConfig.`
        );
      }

      const lifecycle = await handler.load(entry, extensionState.extension.id);
      extensionState.lifecycle = lifecycle;
      extensionState.loadState = 'loaded';
    } catch (error) {
      extensionState.loadState = 'error';
      extensionState.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  async preloadExtension(extensionId: string): Promise<void> {
    return this.loadExtension(extensionId);
  }

  // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t5
  async mountExtension(
    extensionId: string,
    container: Element
  ): Promise<ParentMfeBridge> {
    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (!extensionState) {
      throw new Error(
        `Cannot mount extension '${extensionId}': extension is not registered. ` +
        `Call registerExtension() first.`
      );
    }

    if (extensionState.mountState === 'mounted') {
      return extensionState.bridge!;
    }

    if (extensionState.loadState !== 'loaded') {
      await this.loadExtension(extensionId);
    }

    extensionState.mountState = 'mounting';
    extensionState.error = undefined;

    // Declared here (not inside the `try` below) so the `catch` can also see
    // whichever bridge was actually created before the failure, if any.
    let mountedChildBridge: ChildMfeBridge | undefined;

    try {
      const domainState = this.extensionManager.getDomainState(extensionState.extension.domain);
      if (!domainState) {
        throw new Error(
          `Cannot mount extension '${extensionId}': ` +
          `domain '${extensionState.extension.domain}' is not registered.`
        );
      }

      const entryDomainActions = extensionState.entry.domainActions;
      const { parentBridge, childBridge } = this.bridgeFactory.createBridge(
        domainState,
        extensionId,
        extensionState.entry.id,
        entryDomainActions,
        (chain: ActionsChain) => this.executeActionsChain(chain),
        (domainId, handler) => this.registerCatchAllActionHandler(domainId, handler),
        (domainId) => this.unregisterCatchAllActionHandler(domainId),
        (extId, actionTypeId, handler, domainId) => this.registerExtensionActionHandler(extId, actionTypeId, handler, domainId),
        (extId) => this.unregisterExtensionActionHandler(extId)
      );
      mountedChildBridge = childBridge;
      this.childBridgesByExtension.set(extensionId, childBridge);

      const existingConnection = this.coordinator.get(container);
      if (existingConnection) {
        existingConnection.bridges.set(extensionId, parentBridge);
      } else {
        this.coordinator.register(container, {
          hostRuntime: this.hostRuntime,
          bridges: new Map([[extensionId, parentBridge]]),
        });
      }

      const hostElement = container as HTMLElement;
      const shadowRoot = createShadowRoot(hostElement);
      extensionState.shadowRoot = shadowRoot;

      const lifecycle = extensionState.lifecycle;
      if (!lifecycle) {
        throw new Error(
          `Cannot mount extension '${extensionId}': lifecycle not loaded. ` +
          `This should not happen - loadExtension should have cached the lifecycle.`
        );
      }
      const mountContext: MfeMountContext = {
        extensionId,
        domainId: extensionState.extension.domain,
      };

      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-track-mounting-bridge
      // Prepare the link a nested registry constructed synchronously inside
      // this extension's own `mount()` body will automatically adopt, then
      // track `childBridge` as the ambient mounting bridge for exactly the
      // synchronous portion of the `lifecycle.mount(...)` invocation below —
      // no configuration or method call required from the microfrontend author.
      const link = this.buildInboundBridgeLink(extensionId, childBridge, parentBridge);
      registerInboundBridgeLink(childBridge, link);

      pushAmbientMountingBridge(childBridge);
      let claimed: readonly InboundBridgeRelink[];
      let mountInvocation: void | Promise<void>;
      try {
        mountInvocation = lifecycle.mount(shadowRoot, childBridge, mountContext);
      } finally {
        claimed = popAmbientMountingBridge();
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-track-mounting-bridge

      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-relink-on-remount
      if (claimed.length > 0) {
        // A registry was constructed inside this window and adopted the link
        // itself (the ordinary fresh-registry-per-mount pattern) — remember
        // its re-link callback(s) against this extension for a future remount.
        this.inboundAdoptersByExtension.set(extensionId, claimed);
      } else {
        // No construction happened during this window — re-offer the fresh
        // link to whichever registry adopted a PREVIOUS mount of THIS SAME
        // extension (the reused-registry case), never to a registry that
        // adopted any other extension's bridge.
        const previous = this.inboundAdoptersByExtension.get(extensionId);
        if (previous) {
          for (const relink of previous) {
            relink(link);
          }
        }
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-relink-on-remount

      await mountInvocation;

      extensionState.bridge = parentBridge;
      extensionState.container = container;
      extensionState.mountState = 'mounted';

      await this.triggerLifecycle(
        extensionId,
        this.typeSystem.resolveLifecycleStageActivatedId()
      );

      return parentBridge;
    } catch (error) {
      // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t6
      extensionState.mountState = 'error';
      extensionState.error = error instanceof Error ? error : new Error(String(error));
      // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t6

      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements
      // Mount-failure path: any nested registry that got as far as
      // synchronously constructing itself and propagating advertisements
      // upward through `childBridge` before `lifecycle.mount(...)` (or a
      // synchronous step around it) threw must have those advertisements
      // retracted by THIS (the parent) registry now — previously this path
      // leaked, leaving the parent holding forwarding entries for a target
      // whose host extension never finished mounting.
      if (mountedChildBridge) {
        this.retractInboundBridgeLink(mountedChildBridge);
        this.childBridgesByExtension.delete(extensionId);
        // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-unlink-on-retraction
        const adopters = this.inboundAdoptersByExtension.get(extensionId);
        if (adopters) {
          for (const relink of adopters) {
            relink(null);
          }
        }
        // Deliberately NOT deleted from the map — the next mount of this
        // extension needs it to re-offer a fresh link to the same registry.
        // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-unlink-on-retraction
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements

      throw error;
    }
  }
  // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t5

  async unmountExtension(extensionId: string): Promise<void> {
    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (!extensionState) {
      return;
    }

    if (extensionState.mountState !== 'mounted') {
      return;
    }

    await this.triggerLifecycle(
      extensionId,
      this.typeSystem.resolveLifecycleStageDeactivatedId()
    );

    try {
      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements
      // Parent-owned retraction on the host extension's own unmount: revoke
      // every forwarding entry keyed to the bridge this extension received
      // at mount time, regardless of whether the nested registry it may
      // host ever calls its own dispose(). Done up front so a subsequent
      // remount (this same extensionId, a fresh bridge pair) never trips
      // the collision guard on a stale entry from this mount.
      const mountedChildBridge = this.childBridgesByExtension.get(extensionId);
      if (mountedChildBridge) {
        this.retractInboundBridgeLink(mountedChildBridge);
        this.childBridgesByExtension.delete(extensionId);
        // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-unlink-on-retraction
        const adopters = this.inboundAdoptersByExtension.get(extensionId);
        if (adopters) {
          for (const relink of adopters) {
            relink(null);
          }
        }
        // Deliberately NOT deleted from the map — the next mount of this
        // extension needs it to re-offer a fresh link to the same registry.
        // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-unlink-on-retraction
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements

      const lifecycle = extensionState.lifecycle;
      const container = extensionState.container;
      if (lifecycle && container) {
        const unmountTarget = extensionState.shadowRoot ?? container;
        await lifecycle.unmount(unmountTarget);
      }

      try {
        this.unregisterExtensionActionHandler(extensionId);
      } catch (unregisterError) {
        console.error(
          `[MountManager] Failed to unregister extension action handler for '${extensionId}':`,
          unregisterError
        );
      }

      if (extensionState.bridge) {
        const domainState = this.extensionManager.getDomainState(extensionState.extension.domain);
        if (domainState) {
          this.bridgeFactory.disposeBridge(domainState, extensionState.bridge);
        }
      }

      if (container) {
        const connection = this.coordinator.get(container);
        if (connection) {
          connection.bridges.delete(extensionId);
          if (connection.bridges.size === 0) {
            this.coordinator.unregister(container);
          }
        }
      }

      extensionState.bridge = null;
      extensionState.container = null;
      extensionState.mountState = 'unmounted';
      extensionState.error = undefined;
      extensionState.shadowRoot = undefined;
    } catch (error) {
      extensionState.mountState = 'error';
      extensionState.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  setTheme(_cssVars: Record<string, string>): void {
    // No-op: CSS custom properties inherit across Shadow DOM boundaries
  }
}
