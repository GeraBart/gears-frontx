/**
 * Action Timeout Resolver
 *
 * The one shared per-action timeout rule both the mediator
 * (`DefaultActionsChainsMediator.resolveTimeout`) and the domain's own
 * occupancy queue (`DomainOccupancyCoordinator`, for each caller's own timer)
 * apply: an action's own declared timeout when it declares one, otherwise the
 * authoritative domain's `defaultActionTimeout`
 * (`cpt-frontx-algo-mfe-host-communication-mediator-dispatch`
 * `inst-resolve-timeout`;
 * `cpt-frontx-algo-extension-domain-governance-mount-execution`
 * `inst-me-queue-caller-timer`).
 *
 * @packageDocumentation
 * @internal
 */

import type { ChainEnvelopeValidator } from './ChainEnvelopeValidator';
import { InvalidDomainDefaultTimeoutError } from './InvalidDomainDefaultTimeoutError';

/**
 * @internal
 */
export class ActionTimeoutResolver {
  constructor(private readonly chainEnvelopeValidator: ChainEnvelopeValidator) {}

  /**
   * @param declaredTimeout - The action's own declared timeout, already
   *   validated at acceptance, if it declared one.
   * @param domain - The authoritative domain for the target, if resolved —
   *   its `defaultActionTimeout` is used absent a declared timeout.
   * @param targetId - The target id, named in the error thrown when no
   *   domain resolves.
   * @returns The timeout in milliseconds.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-resolve-timeout
  resolve(
    declaredTimeout: number | undefined,
    domain: { id: string; defaultActionTimeout: number } | undefined,
    targetId: string
  ): number {
    if (declaredTimeout !== undefined) {
      return declaredTimeout;
    }

    if (domain) {
      if (!this.chainEnvelopeValidator.isValidDeclaredTimeout(domain.defaultActionTimeout)) {
        throw new InvalidDomainDefaultTimeoutError(domain.id, domain.defaultActionTimeout);
      }
      return domain.defaultActionTimeout;
    }

    throw new Error('Cannot resolve timeout: no domain found for target "' + targetId + '"');
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-resolve-timeout
}
