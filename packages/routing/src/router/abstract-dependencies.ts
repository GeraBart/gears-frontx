/**
 * The FrontX router's own abstract dependencies (FEATURE route-ownership-signal
 * §1.5, "Router's abstract dependencies"; DESIGN §3.3).
 *
 * The router reaches the runtime only through these two: an executor that
 * runs an actions chain and a type system that names the `mount_ext` and
 * `unmount_ext` action type ids (`cpt-frontx-constraint-routing-no-intra-ecosystem-dependency`).
 * Both are runtime abstract classes with abstract members only. The executor
 * and the type system the runtime hands to `connect` conform structurally:
 * nothing extends either class, and the router never checks an argument with
 * `instanceof`.
 *
 * @packageDocumentation
 */

/** The one chain shape the FrontX router sends: a single action, with no `next` and no `fallback`. */
export interface RouterActionsChain {
  readonly action: {
    readonly type: string;
    readonly target: string;
    readonly payload: { readonly subject: string; readonly history: 'none' };
  };
}

/**
 * Runs an actions chain. `executeActionsChain` returns nothing, so the router
 * observes no delivery, execution state or outcome of a chain it sends.
 */
export abstract class ActionsChainExecutor {
  abstract executeActionsChain(chain: RouterActionsChain): void;
}

/**
 * Names the action type ids the router sends: the only source of the
 * `mount_ext` and `unmount_ext` type ids, so the router hardcodes none.
 */
export abstract class RouterTypeSystem {
  abstract resolveMountExtActionId(): string;
  abstract resolveUnmountExtActionId(): string;
}
