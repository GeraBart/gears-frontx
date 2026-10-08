import { create } from 'zustand';
import type { DataGridItem, InternalContext } from '../../data-grid-types';
import { createLoadInstance } from './load-instance';
import type {
  LoadInstance,
  LoadInstanceId,
  LoadPublicApi,
  LoadService,
  LoadTriggerConfig,
  RefreshOptions,
  RefreshOptionsRaw,
  LoadStateStore,
} from './load-types';

export function createLoadService<TItem extends DataGridItem>(
  context: InternalContext<TItem>,
): LoadService<TItem> {
  const instances = new Map<LoadInstanceId, LoadInstance<TItem>>();
  // The subset of `instances` whose result replaces the visible record set. Tracked alongside
  // rather than derived on read, so a child fetch outliving the root load still flips the state
  // back: `instances` alone stays non-empty and would never notify.
  const recordInstanceIds = new Set<LoadInstanceId>();

  const useLoadStateStore = create<LoadStateStore>()(() => ({
    loadState: 'blank',
    recordsLoadState: 'blank',
  }));

  const publicApi: LoadPublicApi<TItem> = {
    triggerLoad,
    refresh,
    abort,
    getLoadInstances,
    useLoadStateStore,
  };

  context.plugins.registerPublicApi(publicApi);

  return {
    ...publicApi,
    init,
  };

  function syncLoadState() {
    useLoadStateStore.setState({
      loadState: instances.size > 0 ? 'loading' : 'blank',
      recordsLoadState: recordInstanceIds.size > 0 ? 'loading' : 'blank',
    });
  }

  /**
   * Whether this load ends up replacing what the grid is showing.
   *
   * `store: false` opts out of storage entirely -- the export loops page through the whole set that
   * way -- and a load scoped to a tree parent appends a section beneath that row instead of
   * clearing the rest. Both leave the visible rows usable, so neither should raise the overlay.
   */
  function replacesRecords(triggerConfig?: LoadTriggerConfig): boolean {
    if (triggerConfig?.store === false) {
      return false;
    }

    return triggerConfig?.loadContext?.tree?.parentId == null;
  }

  function getLoadInstances(): LoadInstance<TItem>[] {
    return [...instances.values()];
  }

  function abort() {
    for (const instance of instances.values()) {
      instance.abort();
    }
  }

  async function init() {
    await context.hooked.callHook('init');
    await triggerLoad().promise;
  }

  async function refresh(options: RefreshOptionsRaw = {}) {
    abort();
    const refreshOptions: RefreshOptions = { resetFilters: options.resetFilters ?? true };
    await context.hooked.callHook('refresh', refreshOptions);
    await triggerLoad({ refresh: refreshOptions }).promise;
  }

  function triggerLoad(triggerConfig?: LoadTriggerConfig): LoadInstance<TItem> {
    const instance = createLoadInstance<TItem>(context, triggerConfig);

    instances.set(instance.id, instance);
    if (replacesRecords(triggerConfig)) {
      recordInstanceIds.add(instance.id);
    }
    syncLoadState();

    instance.promise
      .finally(() => {
        instances.delete(instance.id);
        recordInstanceIds.delete(instance.id);
        syncLoadState();
      })
      // Bookkeeping only. The rejection itself belongs to whoever awaited the instance's promise;
      // this branch re-raising it would land as an unhandled rejection with no one to catch it.
      .catch(() => undefined);

    return instance;
  }
}
