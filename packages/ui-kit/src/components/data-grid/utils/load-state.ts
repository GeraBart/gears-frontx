import type { StoreApi, UseBoundStore } from 'zustand';
import { create } from 'zustand';

export type LoadState = 'blank' | 'loading' | 'error' | 'loaded';

export interface LoadStateStore {
  loadState: LoadState;
}

export type UseLoadStateStore = UseBoundStore<StoreApi<LoadStateStore>>;

export interface LoadStateManager {
  useLoadState: UseLoadStateStore;
  setLoading: () => void;
  setLoaded: () => void;
  setError: () => void;
  setBlank: () => void;
  loadPromise: <T>(promise: Promise<T>) => Promise<T>;
}

/**
 * A zustand store holding a `blank -> loading -> loaded | error` state, plus the helpers that move
 * it. `loadPromise` follows a promise: loading while it is pending, then loaded or error.
 */
export function createLoadStateManager(): LoadStateManager {
  const useLoadStateStore = create<LoadStateStore>()(() => ({
    loadState: 'blank',
  }));

  return {
    useLoadState: useLoadStateStore,
    setLoading,
    setLoaded,
    setError,
    setBlank,
    loadPromise,
  };

  function setLoading() {
    useLoadStateStore.setState({ loadState: 'loading' });
  }

  function setLoaded() {
    useLoadStateStore.setState({ loadState: 'loaded' });
  }

  function setError() {
    useLoadStateStore.setState({ loadState: 'error' });
  }

  function setBlank() {
    useLoadStateStore.setState({ loadState: 'blank' });
  }

  async function loadPromise<T>(promise: Promise<T>): Promise<T> {
    setLoading();
    try {
      const result = await promise;
      setLoaded();
      return result;
    } catch (error) {
      setError();
      throw error;
    }
  }
}
