import { create } from 'zustand';
import { createLoadStateManager } from '../../utils/load-state';
import type { CoreService, ExternalLoadingStore } from './core-types';

export function createCoreService(): CoreService {
  const { useLoadState, loadPromise } = createLoadStateManager();

  const useExternalLoadingStore = create<ExternalLoadingStore>()(() => ({
    loading: false,
  }));

  return {
    useLoadStateStore: useLoadState,
    loadPromise,
    useExternalLoadingStore,
    updateLoading,
  };

  function updateLoading(loading: boolean) {
    useExternalLoadingStore.setState({ loading });
  }
}
