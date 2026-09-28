import type { DispatchOriginContext } from './DispatchOriginStore';

/**
 * The full diagnostic-attribution context threaded through one accepted
 * chain's own recursion (and, across a hop, through the cross-hop
 * envelope): a correlation identity every diagnostic from this dispatch
 * carries, and an optional origin.
 */
export interface DiagnosticContext {
  readonly correlationId: string;
  readonly origin?: DispatchOriginContext;
  /**
   * The accumulated execution path of a SENDING executor, up to (but never
   * including) the node currently crossing the hop — carried across the
   * cross-hop envelope's `diagnostics` field alongside `correlationId`/
   * `origin` so a structured diagnostic reported at the RECEIVING end of
   * the hop (`acceptSingleNodeForHop`, which mints the receiving side's
   * execution state before accepting) can seed its own local path with it
   * rather than starting fresh: without this, a node several hops deep
   * would report a path naming only itself, understating how far the
   * failing chain actually reached. Absent for a dispatch that never
   * crossed a hop (the ordinary, same-registry case) and for a context
   * reconstructed from an envelope that carried no recognizable
   * `senderPath` (see `EnvelopeDiagnosticsMapper.fromEnvelope`).
   */
  readonly senderPath?: readonly string[];
}

/**
 * Converts a `DiagnosticContext` to and from the plain record shape
 * `CrossHopEnvelope.diagnostics` carries across a hop. Stateless — every
 * method is a pure transformation of its arguments — but exposed as
 * instance methods behind an object `DefaultMfeRegistry` constructs and
 * injects into `DefaultActionsChainsMediator`, rather than a static-only
 * namespace: this is a collaborator the mediator depends on, not a bag of
 * global functions, so it is substitutable the same way every other
 * injected collaborator is.
 */
export class EnvelopeDiagnosticsMapper {
  /**
   * Serialize a `DiagnosticContext` into the shape `CrossHopEnvelope.diagnostics`
   * carries across a hop — a plain, substitutable-transport-safe record, never
   * interpreted by the transport itself, only by the receiving mediator via
   * `fromEnvelope` below. Reuses the same `CrossHopEnvelope.diagnostics` channel
   * on the envelope rather than adding a second one.
   *
   * @param currentPath - The sending executor's own accumulated path so far
   *   (never including the node currently crossing the hop), carried as
   *   `senderPath` so the receiving end's own structured diagnostic, should
   *   this node fail there, names the full path leading to it rather than a
   *   disconnected single entry. Added inside this already-present
   *   `diagnostics` record — never a change to `CrossHopEnvelope`'s own shape
   *   (`action`/`version`/`diagnostics`), so it carries no version
   *   implication of its own (see this function's call site for the full
   *   version-increment reasoning).
   */
  toEnvelope(
    context: DiagnosticContext,
    currentPath: readonly string[]
  ): Readonly<Record<string, unknown>> {
    return {
      correlationId: context.correlationId,
      senderPath: [...currentPath],
      ...(context.origin
        ? {
            originEntityKind: context.origin.entityKind,
            originEntityId: context.origin.entityId,
            originStageId: context.origin.stageId,
          }
        : {}),
    };
  }

  /**
   * Reconstruct a `DiagnosticContext` from a received `CrossHopEnvelope`'s
   * `diagnostics` field, so a node failure at the RECEIVING end of a hop
   * still carries the correlation identity (and, where present, the origin)
   * of the dispatch that crossed into it — the same dispatch, several hops
   * away from wherever it started. Returns `undefined` if the record does
   * not carry a recognizable shape (e.g. an envelope produced by a copy of
   * this package that predates this field's use, or a malformed record),
   * in which case the receiving mediator mints its own fresh correlation
   * identity rather than failing the hop over a diagnostics-only gap.
   */
  fromEnvelope(record: Readonly<Record<string, unknown>>): DiagnosticContext | undefined {
    const { correlationId, originEntityKind, originEntityId, originStageId, senderPath } = record;
    if (typeof correlationId !== 'string') {
      return undefined;
    }
    const origin: DispatchOriginContext | undefined =
      (originEntityKind === 'extension' || originEntityKind === 'domain') &&
      typeof originEntityId === 'string' &&
      typeof originStageId === 'string'
        ? { entityKind: originEntityKind, entityId: originEntityId, stageId: originStageId }
        : undefined;
    // Tolerant, feature-detected, exactly like `origin` above: an envelope
    // produced by a copy of this package that predates `senderPath`'s use (or
    // one carrying a malformed value) simply yields no seeded prefix — the
    // receiving end's local path starts empty, exactly as it always has.
    return {
      correlationId,
      origin,
      ...(EnvelopeDiagnosticsMapper.isStringArray(senderPath) ? { senderPath } : {}),
    };
  }

  /** True when `value` is an array of strings — the one recognized shape a received `senderPath` may carry. Stateless (no substitution ever needed), so kept private static. */
  private static isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
}
