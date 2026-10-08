import type { DataGridItem, InternalContext } from '../../data-grid-types';
import { isRecord } from '../../utils/is-record';
import type {
  PersistOptions,
  UsePersistentState,
  PersistentStateService,
  PersistentStatePublicApi,
} from './persistent-state-types';

export function createPersistentStateService<TItem extends DataGridItem>(
  context: InternalContext<TItem>,
): PersistentStateService {
  const subscribers = new Map<string, Set<() => void>>();
  // Backing for the 'memory' mode, scoped to the grid instance: state survives
  // re-renders within one mount and resets on remount.
  const memoryStore = new Map<string, unknown>();
  const gridName = context.config.name;
  const persistMode = context.config.persistent ?? 'localStorage';

  const publicApi: PersistentStatePublicApi = {
    registerPersistentState,
  };

  context.plugins.registerPublicApi(publicApi);

  return publicApi;

  function getStorageKey(key: string) {
    return `dataGrid:${gridName}:${key}`;
  }

  function getStorage(area: 'localStorage' | 'sessionStorage'): Storage | null {
    if (typeof window === 'undefined') return null;
    return area === 'localStorage' ? localStorage : sessionStorage;
  }

  function registerPersistentState<T>(
    key: string,
    options: PersistOptions = {},
  ): UsePersistentState<T> {
    const storageKey = getStorageKey(key);
    // `storage` names the backend for this one state, overriding the grid-wide mode. For
    // state that belongs to the viewer rather than to the view they would share — a column
    // selection, say, next to filters that stay in the URL.
    const mode = options.storage ?? persistMode;
    // A state registered with `router: false` opted out of URL persistence:
    // in router mode it reads and writes nothing, other backends are unaffected.
    const isDisabled = mode === 'router' && options.router === false;

    return {
      get value() {
        return getValue();
      },
      setValue,
      buildStorageItem,
    };

    function getValue(): T | undefined {
      if (isDisabled) {
        return undefined;
      }

      if (mode === 'memory') {
        return memoryStore.get(key) as T | undefined;
      }

      if (mode === 'router') {
        // URL-based persistence
        const params = new URLSearchParams(window.location.search);
        return parseStored<T>(params.get(key));
      }

      const storage = getStorage(mode);
      if (!storage) return undefined;

      return parseStored<T>(storage.getItem(storageKey));
    }

    function setValue(value: T | undefined) {
      if (isDisabled) {
        return;
      }

      if (mode === 'memory') {
        if (value === undefined) {
          memoryStore.delete(key);
        } else {
          memoryStore.set(key, value);
        }
      } else if (mode === 'router') {
        const params = new URLSearchParams(window.location.search);
        if (value === undefined) {
          params.delete(key);
        } else {
          params.set(key, JSON.stringify(value));
        }
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState(null, '', newUrl);
      } else {
        const storage = getStorage(mode);
        if (!storage) return;

        if (value === undefined) {
          storage.removeItem(storageKey);
        } else {
          storage.setItem(storageKey, JSON.stringify(value));
        }
      }

      // Notify subscribers
      subscribers.get(key)?.forEach((fn) => fn());
    }

    function buildStorageItem(value: T): Record<string, unknown> {
      // Build URL query params based on schema
      if (!options.schema) return { [key]: value };

      const result: Record<string, unknown> = {};
      Object.entries(options.schema).forEach(([field]) => {
        const val = isRecord(value) ? value[field] : undefined;
        if (val !== undefined) {
          result[field] = val;
        }
      });
      return result;
    }
  }
}

/**
 * A stored value is a string the user can edit -- through devtools on `localStorage` and
 * `sessionStorage`, through the address bar on the router mode -- so it is not certain to be JSON
 * at all. A value that will not parse reads as an absent one rather than throwing: a `localStorage`
 * entry is read on every mount, so a throw here would leave the grid unable to render until
 * someone cleared site data. Narrowing what did parse is the caller's job.
 */
function parseStored<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
