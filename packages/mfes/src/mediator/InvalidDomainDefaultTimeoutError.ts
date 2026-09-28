/**
 * Thrown inside a node's own failure boundary when the resolved per-action
 * timeout — an authoritative domain's `defaultActionTimeout`, resolved
 * absent a declared `action.timeout` — is not itself in the one valid form
 * ADR `cpt-frontx-adr-action-dispatch-and-chaining` holds a domain default
 * to (positive, finite, integer, schedulable). Deliberately a NODE failure
 * rather than a refusal: the invalidity is discovered only once execution
 * reaches the node whose target that domain is authoritative for, and an
 * emitter dispatching a chain that never reaches this target would have no
 * way to know the domain's own configuration is broken — the chain's
 * declared `fallback` is the addressee, exactly as for any other
 * discoverable-only-during-execution condition.
 *
 * @internal
 */
export class InvalidDomainDefaultTimeoutError extends Error {
  constructor(domainId: string, value: unknown) {
    super(
      `Domain '${domainId}' declares an invalid defaultActionTimeout (${String(value)}): ` +
        'must be a positive, finite integer count of milliseconds a platform timer schedules as written'
    );
    this.name = 'InvalidDomainDefaultTimeoutError';
  }
}
