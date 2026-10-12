/**
 * Router Port Contract
 *
 * The abstract contract an injected router implements, accepted through the
 * optional `MfeRegistryConfig.router`. The runtime presents each domain and
 * extension registration to it, obtains each extension's opaque occupant
 * value from it at mount, commands it to reflect a domain's projected
 * occupancy in the URL (`reflect`), and hands it a reader for an extension's
 * navigable occupant value. The router owns routing identity and page-wide
 * domain-route uniqueness; this package keeps no routing grammar of its own
 * (`cpt-frontx-adr-extension-routing-port`).
 *
 * This package MUST NOT import `@gears-frontx/routing` or
 * `@gears-frontx/routing-tanstack`, nor be imported by either — the router
 * port is the only contact surface between this package and a concrete
 * router (`cpt-frontx-dod-mfe-host-communication-router-port-contract`).
 *
 * @packageDocumentation
 */
// @cpt-dod:cpt-frontx-dod-mfe-host-communication-router-port-contract:p1

import type { ExtensionDomain, Extension } from '../types';

/**
 * The opaque value a router assigns an extension at mount. The runtime
 * stores and hands this value over without ever inspecting it
 * (`cpt-frontx-algo-mfe-host-communication-occupant-value-rendezvous`).
 */
export type OccupantValue = unknown;

/**
 * The input to `RouterPort.assignOccupantValue`: the registered domain and
 * extension declarations for the mount in progress, and the value associated
 * with the mounting registry's own inbound bridge (`undefined` for a root
 * registry, when no value is associated with that bridge, or when this copy
 * backed away from the rendezvous).
 */
export interface OccupantValueAssignment {
  domain: ExtensionDomain;
  extension: Extension;
  enclosingValue: OccupantValue | undefined;
}

/**
 * The router port: the abstract contract an injected router implements.
 * Every member is synchronous. Adds no member to `MfeRegistry`,
 * `ChildMfeBridge`, or `ParentMfeBridge`.
 */
export interface RouterPort {
  /** The registration notification for a domain; throwing rejects the registration. */
  registerDomain(domain: ExtensionDomain): void;
  /** The registration notification for an extension; throwing rejects the registration. */
  registerExtension(extension: Extension): void;
  /** The release notification that frees what the router admitted for a domain. */
  releaseDomain(domainId: string): void;
  /** The release notification that frees what the router admitted for an extension. */
  releaseExtension(extensionId: string): void;
  /** The value assignment at mount. */
  assignOccupantValue(assignment: OccupantValueAssignment): OccupantValue;
  /**
   * The URL command: the URL entries of the domain `domainId` must show
   * exactly the extensions `extensionIds`, written with the history verb
   * `verb`. The runtime issues it from the wrappers around a domain's
   * `mount_ext` and `unmount_ext` handlers, at a request's acceptance and at
   * its settle; it carries no action type, payload, history intent, or
   * outcome.
   */
  reflect(domainId: string, extensionIds: string[], verb: 'push' | 'replace'): void;
  /** The supply of an extension's navigation from its occupant value. */
  supplyNavigation(readOccupantValue: () => OccupantValue | undefined): void;
}
