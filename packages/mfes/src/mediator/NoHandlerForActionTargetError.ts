/**
 * Thrown by the mediator's primary-step execution when neither a
 * `(target, actionType)` handler nor a catch-all handler is registered
 * for the resolved target. Caught by `executeChainRecursive`'s own
 * try/catch — the failing node's own failure boundary — which selects
 * `chain.fallback` if declared; with no fallback declared, the chain ends
 * at this node and that same call frame returns `completed: false`
 * directly, never rethrowing past its own boundary — the mediator never
 * throws to an emitter, nor to an ancestor node that already dispatched
 * this continuation.
 *
 * Error message format matches the spec contract verbatim:
 * `No handler found for target '{target}' and action type '{actionType}'`.
 *
 * @internal
 */
export class NoHandlerForActionTargetError extends Error {
  constructor(
    public readonly target: string,
    public readonly actionType: string
  ) {
    super(
      `No handler found for target '${target}' and action type '${actionType}'`
    );
    this.name = 'NoHandlerForActionTargetError';
  }
}
