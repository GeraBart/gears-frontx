/**
 * widgets-fixture-a — leaf widget MFE lifecycle.
 *
 * Each mount produces an isolated module instance under the per-load blob URL
 * chain (ADR-0004), so when this entry is registered as two distinct extension
 * instances (alpha and beta) sharing the same `entry.path`, the parent runtime
 * loads the bundle twice and evaluates this module twice — module-level state
 * (the random hex generated below) is therefore per-mount.
 *
 * The mount routine generates a per-mount random hex value, renders it visibly
 * under `data-testid="widget-a-instance"`, logs it to the console, and
 * registers a `ping` action handler on the bridge so the mediator routes
 * per-instance pings back to the correct handler.
 */
import React from 'react';
import {
  createFrontX,
  effects,
  queryCacheShared,
  mock,
  ActionHandler,
  ThemeAwareReactLifecycle,
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_SCREEN_DOMAIN,
  type ChildMfeBridge,
  type JsonObject,
} from '@gears-frontx/react';

const PING_ACTION_TYPE =
  'gts.frontx.mfes.comm.action.v1~frontx.widgets.test.widget_ping.v1~';

// Hello World's extension ID (demo-mfe), targeted via the shell's screen
// domain — mounting it from here exercises the upward-escalation tier: this
// widget's own registry doesn't know the screen domain locally, so the
// escalation must travel through Widgets Host's inbound bridge to the shell.
const HELLOWORLD_EXTENSION_ID =
  'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1';

const fixtureApp = createFrontX()
  .use(effects())
  .use(queryCacheShared())
  .use(mock())
  .build();

function generateRandomHex(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Per-mount random hex. Each blob-URL-isolated load of this module produces a
// fresh value, which is the empirical witness that distinct extension
// instances backed by the same entry path get distinct module evaluations.
const randomHex = generateRandomHex();

// Per-mount last-ping value. The handler always writes here, independent of
// whether a subscriber is wired yet, so registering the handler synchronously
// in `mount()` (required so a chained `next` step can reach it as soon as
// `mount()` resolves) can never race the DOM's observation of a ping: a ping
// that lands before `WidgetA` subscribes is still visible the moment it does,
// via the initial-state read below, instead of depending on ordering.
let lastPingValue: string | null = null;
let lastPingSubscriber: ((value: string) => void) | null = null;

class PingHandler extends ActionHandler {
  constructor(private readonly instanceId: string) {
    super();
  }

  handleAction(
    actionTypeId: string,
    _payload: JsonObject | undefined,
  ): Promise<void> {
    console.log(
      `[widget-a ${this.instanceId}] ping ${actionTypeId} randomHex=${randomHex}`,
    );
    lastPingValue = randomHex;
    if (lastPingSubscriber) {
      lastPingSubscriber(randomHex);
    }
    return Promise.resolve();
  }
}

interface WidgetAProps {
  readonly bridge: ChildMfeBridge;
}

function WidgetA({ bridge }: Readonly<WidgetAProps>): React.ReactElement {
  // Seed from the module-scoped value (not `null`) so a ping that already
  // landed -- e.g. one dispatched by a chain step immediately after `mount()`
  // resolved, before this component's own first render -- is reflected on
  // that very first render rather than silently missed.
  const [lastPing, setLastPing] = React.useState<string | null>(lastPingValue);
  const instanceId = bridge.instanceId;

  React.useEffect(() => {
    // Re-sync against the module-scoped value the moment this effect
    // commits, THEN subscribe for pings that arrive after that. A ping
    // dispatched between the initial render (which seeded `lastPing` above)
    // and this effect running writes `lastPingValue` while no subscriber is
    // installed yet -- without this re-sync, that write would update the
    // module value but never reach this component's own state, leaving the
    // indicator stuck even though the handler fired correctly. The handler
    // itself is registered synchronously in `mount()` (below), independent
    // of this effect, so it is never what races here -- only the view's
    // observation of a value that was already delivered correctly.
    setLastPing(lastPingValue);
    lastPingSubscriber = setLastPing;
    return () => {
      lastPingSubscriber = null;
    };
  }, [bridge, instanceId]);

  const handleMountHelloWorld = React.useCallback(async () => {
    await bridge.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: FRONTX_SCREEN_DOMAIN,
        payload: { subject: HELLOWORLD_EXTENSION_ID },
      },
    });
  }, [bridge]);

  return (
    <div
      data-testid="widget-a-instance"
      data-instance-id={instanceId}
      data-instance-text={randomHex}
      className="m-2 rounded-lg border-2 border-blue-400 bg-blue-50 p-4 text-blue-900"
    >
      <strong>Widget A instance:</strong>{' '}
      <span data-testid="widget-a-random">{randomHex}</span>
      <p className="mt-1 text-xs opacity-75">instance-id: {instanceId}</p>
      <p
        className="mt-1 text-xs"
        data-testid="widget-a-last-ping"
        data-last-ping={lastPing ?? ''}
      >
        last ping: {lastPing ?? '—'}
      </p>
      <button
        type="button"
        data-testid="widget-a-mount-helloworld"
        className="mt-2 rounded border border-blue-400 bg-white px-3 py-1 text-sm font-medium text-blue-900 hover:bg-blue-100"
        onClick={handleMountHelloWorld}
      >
        Mount Hello World (shell, 2 hops up)
      </button>
    </div>
  );
}

class WidgetsFixtureALifecycle extends ThemeAwareReactLifecycle {
  constructor() {
    super(fixtureApp);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <WidgetA bridge={bridge} />;
  }

  override mount(container: Element | ShadowRoot, bridge: ChildMfeBridge): void {
    console.log(
      `[widget-a ${bridge.instanceId}] mount randomHex=${randomHex}`,
    );
    super.mount(container, bridge);
    // Register synchronously, before `mount()` returns: `DefaultMountManager`
    // treats a lifecycle's `mount()` completion as the signal that the
    // extension is reachable, and lets a chain's `next` continuation dispatch
    // as soon as it does. A React `useEffect` runs strictly after that point
    // (`createRoot().render()` only schedules work), so registering there,
    // as this fixture previously did, is reachable-too-late for a chained
    // ping step. See `lifecycle-profile.tsx` for the same pattern.
    bridge.registerActionHandler(
      PING_ACTION_TYPE,
      new PingHandler(bridge.instanceId),
    );
  }
}

export default new WidgetsFixtureALifecycle();
