import type { CrossHopUnavailabilityCause } from './CrossHopRoute';

/**
 * The `failureClass` a hop's UNAVAILABILITY carries in a
 * `ChainNodeFailureDiagnostic` — a class of its own and never
 * `handler-failure`, because no handler was reached at all
 * (`inst-diagnostic-record`).
 */
export const CROSS_HOP_FAILURE_CLASS_UNAVAILABLE = 'hop-unavailable';

// @cpt-begin:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-diagnostic-record
/**
 * A hop became UNAVAILABLE: it refused the delivery at the call, so it never
 * took the node at all. Raised inside the node's own failure boundary, so
 * the dispatching chain's declared `fallback` answers it exactly as it
 * answers any other chain failure — the class governs only how the failure
 * is NAMED, never how it is routed (`inst-chain-failure-class`,
 * `inst-diagnostic-record`).
 */
export class CrossHopUnavailableError extends Error {
  readonly frontxCrossHopFailureKind: typeof CROSS_HOP_FAILURE_CLASS_UNAVAILABLE =
    CROSS_HOP_FAILURE_CLASS_UNAVAILABLE;

  constructor(
    /** The hop this executor was dispatching through — the node's target id. */
    public readonly hop: string,
    public readonly unavailabilityCause: CrossHopUnavailabilityCause,
    message: string
  ) {
    super(message);
    this.name = 'CrossHopUnavailableError';
  }

  /**
   * Structural (cross-copy-safe) recogniser for {@link CrossHopUnavailableError}.
   *
   * Recognises the structural brand `CrossHopUnavailableError` carries via
   * `frontxCrossHopFailureKind`, deliberately a data property tested
   * STRUCTURALLY rather than by `instanceof`: this error routinely crosses a
   * runtime boundary between two independently loaded copies of this package
   * (`cpt-frontx-adr-mfe-load-isolation`), which do not share a class
   * definition — the identical reason `hasOnCrossHopEnvelopeMethod`
   * duck-types the bridge edge rather than testing its class identity. Pure
   * and stateless — no substitution is ever needed for this recognition —
   * so it is a static method.
   */
  static isCrossHopUnavailableError(value: unknown): value is CrossHopUnavailableError {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { frontxCrossHopFailureKind?: unknown }).frontxCrossHopFailureKind ===
        CROSS_HOP_FAILURE_CLASS_UNAVAILABLE
    );
  }
}
// @cpt-end:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-diagnostic-record
