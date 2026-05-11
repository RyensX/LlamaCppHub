import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfigStore } from "@/stores/configStore";
import type { LlamaConfig } from "@/types/llama-params";

/**
 * Hook to sync config state with the Rust backend.
 * Loads configs on mount and provides refresh capability.
 */
export function useConfigs() {
  const configs = useConfigStore((s) => s.configs);
  const loadConfigs = useConfigStore((s) => s.loadConfigs);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    const result = await invoke<LlamaConfig[]>("get_configs");
    loadConfigs(result);
  }, [loadConfigs]);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    refresh();
  }, [refresh]);

  return { configs, refresh };
}

/**
 * Helper to save a config and update the store.
 * Returns an object of async operations that can be called from event handlers.
 */
export function useConfigOperations() {
  const addConfig = useConfigStore((s) => s.addConfig);
  const updateConfig = useConfigStore((s) => s.updateConfig);
  const deleteConfig = useConfigStore((s) => s.deleteConfig);

  return {
    saveConfig: async (config: LlamaConfig) => {
      await invoke<void>("save_config", { config });
      const existing = useConfigStore.getState().configs.find((c) => c.id === config.id);
      if (existing) {
        updateConfig(config.id, config);
      } else {
        addConfig(config);
      }
    },

    deleteConfigById: async (id: string) => {
      await invoke<void>("delete_config", { id });
      deleteConfig(id);
    },

    duplicateConfig: async (id: string) => {
      const newConfig = await invoke<LlamaConfig>("duplicate_config", { id });
      addConfig(newConfig);
      return newConfig;
    },
  };
}
