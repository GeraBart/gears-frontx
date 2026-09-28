import { MfeError } from './MfeError';

/**
 * Refusal classes the runtime-owned chain envelope validator can raise.
 * Each names the exact rule the chain (or one of its nodes) violated;
 * see ADR `cpt-frontx-adr-action-dispatch-and-chaining` for the rationale
 * behind treating each of these as a synchronous refusal rather than a
 * chain (node) failure.
 */
export type ActionsChainRefusalClass =
  | 'malformed_action'
  | 'malformed_continuation'
  | 'cyclic_chain'
  | 'invalid_action_timeout'
  | 'disposed_registry';

/**
 * Thrown by the runtime-owned chain envelope validator (never by the
 * injected type-system provider, which admits individual actions and never
 * the chain envelope itself) when a chain is structurally malformed or
 * declares an invalid per-action timeout. Per ADR
 * `cpt-frontx-adr-action-dispatch-and-chaining`, this is a refusal — no
 * valid execution was accepted — distinct from a chain (node) failure.
 *
 * `nodePath` names the offending node as the sequence of `next`/`fallback`
 * edges taken from the dispatched root (`[]` denotes the root itself).
 */
export class ActionsChainRefusalError extends MfeError {
  constructor(
    public readonly refusalClass: ActionsChainRefusalClass,
    public readonly nodePath: ReadonlyArray<'next' | 'fallback'>,
    message: string
  ) {
    super(message, 'ACTIONS_CHAIN_REFUSAL');
    this.name = 'ActionsChainRefusalError';
  }
}
