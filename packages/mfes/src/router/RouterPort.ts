/**
 * The Abstract Router
 *
 * The optional abstract router this package declares and calls, accepted
 * through `MfeRegistryConfig.router`. The runtime tells the router everything
 * in ids, routes and one boolean per domain: it connects the router to the
 * registry's actions-chain executor and type system, registers and releases
 * routed domains and extensions, starts and stops a domain at its root's
 * attach and detach, obtains each extension's opaque occupant value at mount,
 * supplies an extension runtime's navigation, and commands the router to
 * reflect a domain's projected occupancy in the URL. The router owns routing
 * identity and page-wide domain-route uniqueness; this package keeps no
 * routing grammar of its own (`cpt-frontx-adr-extension-routing-port`).
 *
 * The FrontX router in `@gears-frontx/routing` conforms to this class
 * structurally and does not extend it; the runtime never tests a router with
 * `instanceof`. This package MUST NOT import `@gears-frontx/routing` or
 * `@gears-frontx/routing-tanstack`, nor be imported by either
 * (`cpt-frontx-dod-mfe-host-communication-router-port-contract`).
 *
 * @packageDocumentation
 */
// @cpt-dod:cpt-frontx-dod-mfe-host-communication-router-port-contract:p1

import type { ActionsChain } from '../types';
import type { TypeSystemPlugin } from '../type-substrate';

/**
 * The opaque value a router assigns an extension at mount. The runtime
 * stores and hands this value over without ever inspecting it
 * (`cpt-frontx-algo-mfe-host-communication-occupant-value-rendezvous`).
 */
export type OccupantValue = unknown;

/**
 * The abstract router: only abstract public methods and no fields. Every
 * member is a synchronous call that returns its result directly. Adds no
 * member to `MfeRegistry`, `ChildMfeBridge`, or `ParentMfeBridge`.
 */
export abstract class RouterPort {
  /**
   * Called once, in the registry's constructor, before any domain or
   * extension registers. `executor` executes each chain it is given through
   * the registry's own `executeActionsChain`; `typeSystem` is the registry's
   * own type-system plugin.
   */
  abstract connect(
    executor: { executeActionsChain(chain: ActionsChain): void },
    typeSystem: TypeSystemPlugin
  ): void;

  /**
   * Called when a domain whose declaration carries `route` registers.
   * `declaresUnmount` is whether the domain's actions list the `unmount_ext`
   * action type id. A throw rejects the registration.
   */
  abstract registerDomain(domainId: string, route: string, declaresUnmount: boolean): void;

  /** Called when an extension whose declaration carries `route` registers. A throw rejects it. */
  abstract registerExtension(extensionId: string, domainId: string, route: string): void;

  /** Frees what the router admitted for a domain, on unregistration, rollback or disposal. */
  abstract releaseDomain(domainId: string): void;

  /** Frees what the router admitted for an extension, in the same cases as `releaseDomain`. */
  abstract releaseExtension(extensionId: string): void;

  /** Called at mount, before the lifecycle `mount` runs; the result is stored without being read. */
  abstract assignOccupantValue(domainId: string, extensionId: string): unknown;

  /** Called when the registry adopts its inbound bridge, on each adoption. */
  abstract supplyNavigation(readOccupantValue: () => unknown): void;

  /** Called in the domain's mounter `attach(root)`, once the domain's root is attached. */
  abstract startDomain(domainId: string): void;

  /** Called first in the domain's mounter `detach()`, synchronously, before the mass unmount. */
  abstract stopDomain(domainId: string): void;

  /**
   * The URL command: the URL entries of the domain `domainId` must show
   * exactly the extensions `extensionIds`, written with the history verb
   * `verb`. The runtime issues it from the wrappers around a domain's
   * `mount_ext` and `unmount_ext` handlers, at a request's acceptance and at
   * its settle; it carries no action type, payload, history intent, or
   * outcome.
   */
  abstract reflect(domainId: string, extensionIds: string[], verb: 'push' | 'replace'): void;
}
