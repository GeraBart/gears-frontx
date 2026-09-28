import { CROSS_HOP_FAILURE_CLASS_UNAVAILABLE, CrossHopUnavailableError } from './CrossHopUnavailableError';
import type { CrossHopUnavailabilityCause } from './CrossHopRoute';
import { NoHandlerForActionTargetError } from './NoHandlerForActionTargetError';
import { InvalidDomainDefaultTimeoutError } from './InvalidDomainDefaultTimeoutError';

/**
 * Classifies a node failure or a refused cross-hop delivery into the
 * vocabulary a `ChainNodeFailureDiagnostic` carries
 * (`inst-diagnostic-record`): the `failureClass`/`hopFailureCause` a
 * failure classifies as, and the `CrossHopUnavailableError` a refused
 * delivery normalises to. Stateless — every method is a pure function of
 * its arguments — but exposed as instance methods behind an object
 * `DefaultMfeRegistry` constructs once and injects into
 * `DefaultActionsChainsMediator`, rather than a static-only namespace: this
 * is a collaborator the mediator depends on, substitutable the same way
 * every other injected collaborator is. `CrossHopUnavailableError`'s own
 * `isCrossHopUnavailableError` recognizer stays a static method on that
 * error class itself, not on this mapper: recognizing an instance of a
 * class is that class's own concern (its structural brand,
 * `frontxCrossHopFailureKind`, is a detail of what makes a value AN
 * INSTANCE of that class), never a mapping this collaborator could be
 * substituted for — nothing here has a competing way to answer "is this a
 * `CrossHopUnavailableError`" that a test or a host could inject instead.
 */
export class CrossHopFailureMapper {
  /**
   * Classifies a caught node failure into the `failureClass` string a
   * `ChainNodeFailureDiagnostic` carries (`inst-diagnostic-record`).
   *
   * A hop's UNAVAILABILITY — refused at the call: an inactive or disposed
   * bridge, a revoked link, no receiver wired, an unrecognized transport
   * protocol version, or a disposed receiving registry — is a class of its
   * own and never `handler-failure`: no handler was reached at all, so naming
   * it a handler failure would send a reader looking for a defect in code
   * that was never invoked. A handler failure proper — a handler ran and did
   * not succeed, including its own bound elapsing — keeps `handler-failure`,
   * unchanged.
   *
   * Recognition of the cross-hop class is STRUCTURAL
   * (`CrossHopUnavailableError.isCrossHopUnavailableError`) rather than `instanceof`, because that
   * error may have been minted by a different, independently loaded copy of
   * this package on the far side of a hop.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-diagnostic-record
  classifyChainNodeFailure(error: unknown): string {
    if (error instanceof NoHandlerForActionTargetError) return 'missing-handler';
    if (CrossHopUnavailableError.isCrossHopUnavailableError(error)) return CROSS_HOP_FAILURE_CLASS_UNAVAILABLE;
    if (error instanceof InvalidDomainDefaultTimeoutError) return 'invalid-domain-default-timeout';
    if (error instanceof Error) return 'handler-failure';
    return 'unknown-failure';
  }

  /**
   * The `hopFailureCause` a diagnostic carries alongside the hop it names —
   * WHICH of the ways a hop became unavailable occurred
   * (`inst-diagnostic-record`). Absent for every failure that is not a
   * cross-hop one.
   */
  hopFailureCauseOf(error: unknown): string | undefined {
    return CrossHopUnavailableError.isCrossHopUnavailableError(error) ? error.unavailabilityCause : undefined;
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-diagnostic-record

  /**
   * Normalise a refused delivery into the hop's own unavailability class,
   * naming this executor's own hop (the node's target) rather than whatever
   * identifier the far side happened to use.
   *
   * Every refusal belongs to this class, and that is the ADR's own rule
   * rather than a convenience: a refusal means the hop never took the node,
   * so no handler ran, so nothing that happened can be a handler failure.
   * Recognised causes keep their own name; a bridge that refused delivery
   * because it is inactive or disposed, or found no receiver wired, is
   * recognised by its `code` (structurally — the bridge errors may come from
   * another copy of this package); anything else is `delivery-failed`.
   */
  toHopUnavailability(hop: string, error: unknown): CrossHopUnavailableError {
    if (CrossHopUnavailableError.isCrossHopUnavailableError(error)) {
      return error.hop === hop
        ? error
        : new CrossHopUnavailableError(hop, error.unavailabilityCause, error.message);
    }
    const code = (error as { code?: unknown } | null | undefined)?.code;
    const cause: CrossHopUnavailabilityCause =
      code === 'BRIDGE_INACTIVE' || code === 'BRIDGE_DISPOSED'
        ? 'bridge-deactivated'
        : code === 'NO_ACTIONS_CHAIN_HANDLER'
          ? 'no-receiver-wired'
          : 'delivery-failed';
    const detail = error instanceof Error ? error.message : String(error);
    return new CrossHopUnavailableError(
      hop,
      cause,
      `Cross-hop route to target '${hop}' is unavailable: the hop refused the delivery at the call (${detail})`
    );
  }
}
