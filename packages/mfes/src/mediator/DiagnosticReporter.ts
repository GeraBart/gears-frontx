import type { ActionsChain } from '../types';
import { ActionsChainRefusalError } from '../errors';
import type { MfeDiagnosticSink } from '../runtime/config';
import type { DispatchOriginStore } from './DispatchOriginStore';
import type { DispatchCorrelationIdGenerator } from './DispatchCorrelationIdGenerator';

/**
 * Reports diagnostics through a substitutable `MfeDiagnosticSink`, contained
 * so a host-supplied sink's own failure can never alter runtime control
 * flow. Depends on a `DispatchOriginStore` (to recognize a lifecycle-tagged
 * chain that already has its own richer report) and a
 * `DispatchCorrelationIdGenerator` (to mint the identity an un-tagged
 * refusal is reported under), both injected through the constructor.
 */
export class DiagnosticReporter {
  constructor(
    private readonly originStore: DispatchOriginStore,
    private readonly correlationIdGenerator: DispatchCorrelationIdGenerator
  ) {}

  /**
   * Invoke a `MfeDiagnosticSink` method through a containment boundary: a
   * host-supplied sink is untrusted control-flow-wise, so a throw from it must
   * never propagate into the runtime path that triggered the report (a
   * chain's own fallback selection, or a lifecycle transition), which is
   * exactly what an uncontained sink call would do
   * (`cpt-frontx-adr-action-dispatch-and-chaining` / `inst-diagnostic-record`'s
   * containment). Deliberately NOT silent: the sink's own failure is still
   * surfaced via `console.error`, on the reasoning that swallowing a broken
   * sink completely would hide a real host-side defect from whoever is
   * watching the console, while still never letting it change what the
   * runtime itself does next.
   *
   * @param invoke - The sink call to perform, already bound with its own
   *   diagnostic payload.
   * @param description - Short, human-readable description of what was being
   *   reported, used only in the `console.error` fallback message.
   */
  invokeSinkSafely(invoke: () => void, description: string): void {
    try {
      invoke();
    } catch (sinkError) {
      console.error(
        `[MfeDiagnosticSink] threw while ${description}; the throw is contained here so a ` +
          'broken host-supplied sink cannot alter runtime control flow (still logged for visibility).',
        sinkError
      );
    }
  }

  /**
   * Report a chain's synchronous REFUSAL (`ActionsChainRefusalError`) through
   * the substitutable diagnostic sink, reusing the SAME structured shape
   * (`ChainNodeFailureDiagnostic`, via `reportChainNodeFailure`) a node
   * failure is reported through, and the SAME refusal classification the
   * envelope validator / registry already raise — never a parallel taxonomy
   * (`inst-diagnostic-record`: "for a refusal and for every node failure
   * alike"). A no-op for any other thrown value: only an
   * `ActionsChainRefusalError` is a refusal in this runtime's own vocabulary.
   *
   * Also a no-op when the chain's root action carries a dispatch-origin tag
   * (`this.originStore.get`): today the ONLY caller that tags one is
   * `DefaultLifecycleManager`, immediately before it dispatches a lifecycle
   * hook through this very same acceptance surface — and it ALREADY
   * synchronously catches and reports every one of that hook's own refusals,
   * through `reportLifecycleDispatchRefusal`'s own, richer shape (carrying
   * `hookPosition`/`stageId`, which this generic call site does not have).
   * Reporting here too would double-report the identical refusal under two
   * different diagnostic shapes; deferring to the tagged caller's own report
   * is what keeps this a single, coherent attribution per refusal rather than
   * two disagreeing ones. The tag is still present here for the hook's own
   * refusal, because a refusal happens before any accepted execution
   * consumes the tag (`DispatchOriginStore.take`). A new root dispatch a
   * hook's handler starts with the SAME `Action` object finds no tag — the
   * hook's accepted execution already consumed it — so its refusal is
   * reported here like any other untagged one.
   *
   * Called BEFORE the refusal is rethrown to the caller — the throw itself,
   * the contract with the emitter, is unchanged by this call.
   *
   * @param sink - The diagnostic sink to report through.
   * @param chain - The refused chain (its root action's target/type name the
   *   refusal; no node ever executed, so `path` is empty).
   * @param error - The value caught at the refusal site; ignored unless it is
   *   an `ActionsChainRefusalError`.
   */
  reportSynchronousChainRefusal(sink: MfeDiagnosticSink, chain: ActionsChain, error: unknown): void {
    if (!(error instanceof ActionsChainRefusalError)) {
      return;
    }
    const origin = this.originStore.get(chain.action);
    if (origin) {
      return;
    }
    // No origin fields here: this branch is reached only for an UN-tagged
    // dispatch (the check above already returned for a tagged one), so there
    // is never an origin to carry, exactly like an ordinary (non-lifecycle)
    // node failure's own diagnostic.
    this.invokeSinkSafely(
      () =>
        sink.reportChainNodeFailure({
          classification: 'chain-node-failure',
          path: [],
          target: chain.action.target,
          failureClass: error.refusalClass,
          correlationId: this.correlationIdGenerator.next(),
        }),
      'reporting a chain refusal'
    );
  }
}

// No module-level singleton instances here (`DispatchOriginStore`,
// `DispatchCorrelationIdGenerator`, `DiagnosticReporter`): `DefaultMfeRegistry`
// — the composition root — constructs exactly one of each per registry
// instance and injects them into `DefaultActionsChainsMediator` and
// `DefaultLifecycleManager` through their own constructors, which is what
// keeps this module free of hidden global state those two collaborators
// would otherwise reach around their own dependency lists to share.
