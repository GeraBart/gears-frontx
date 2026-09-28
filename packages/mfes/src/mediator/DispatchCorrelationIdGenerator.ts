/**
 * Mints the monotonic per-instance correlation identity that groups every
 * diagnostic produced by ONE accepted chain's execution, refusal or node
 * failure alike, across however many nodes and hops that execution touches.
 * `DefaultMfeRegistry` constructs one instance per registry and injects it
 * into that registry's own mediator, so the sequence is shared by every
 * dispatch this ONE registry's executor observes. The same instance is
 * injected into that registry's `DefaultLifecycleManager`, which mints the
 * identity of a lifecycle hook's refused dispatch from it, so a refusal and
 * an accepted chain's diagnostics share one namespace per registry.
 *
 * Every instance mints its own random namespace at construction time and
 * folds it into every id this instance produces, so the namespace is
 * probabilistically unique across module copies and across registries —
 * two instances (e.g. one per registry, for a shell and a nested host
 * registry both running in-process, or in different copies of this
 * package) never mint the same identity for their own first dispatch,
 * without reaching for any module-level counter shared across instances.
 * The namespace source, in fallback order: `crypto.randomUUID()`; else 16
 * bytes from `crypto.getRandomValues()`, hex-encoded; else a timestamp, a
 * per-copy monotonic instance ordinal and a `Math.random()` string.
 */
export class DispatchCorrelationIdGenerator {
  /**
   * Monotonic count of instances whose namespace was minted through the
   * last-resort timestamp + `Math.random()` path in this module copy. Folded into the fallback namespace so
   * two instances constructed in the same copy never share one, even when
   * the timestamp and random parts coincide.
   */
  private static fallbackInstanceOrdinal = 0;

  private readonly namespace: string;
  private sequence = 0;

  constructor() {
    this.namespace = DispatchCorrelationIdGenerator.mintNamespace();
  }

  next(): string {
    this.sequence += 1;
    return `dispatch-${this.namespace}-${this.sequence}`;
  }

  private static mintNamespace(): string {
    const cryptoObj = (
      globalThis as {
        crypto?: {
          randomUUID?: () => string;
          getRandomValues?: (array: Uint8Array) => Uint8Array;
        };
      }
    ).crypto;
    if (typeof cryptoObj?.randomUUID === 'function') {
      return cryptoObj.randomUUID();
    }
    if (typeof cryptoObj?.getRandomValues === 'function') {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    DispatchCorrelationIdGenerator.fallbackInstanceOrdinal += 1;
    const ordinal = DispatchCorrelationIdGenerator.fallbackInstanceOrdinal.toString(36);
    return `${Date.now().toString(36)}-${ordinal}-${Math.random().toString(36).slice(2)}`;
  }
}
