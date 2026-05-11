import { create } from "zustand";
import type { CustomArg, LlamaConfig, ParamValue, PreStartCommand } from "@/types/llama-params";
import { PARAM_DEFS } from "@/types/llama-params";

interface ConfigStore {
  configs: LlamaConfig[];
  selectedConfigId: string | null;
  editorOpen: boolean;
  editingConfig: LlamaConfig | null;

  // Actions
  loadConfigs: (configs: LlamaConfig[]) => void;
  selectConfig: (id: string | null) => void;
  openEditor: (config?: LlamaConfig) => void;
  closeEditor: () => void;

  // CRUD
  addConfig: (config: LlamaConfig) => void;
  updateConfig: (id: string, updates: Partial<LlamaConfig>) => void;
  deleteConfig: (id: string) => void;
  duplicateConfig: (id: string) => LlamaConfig;

  // Helpers
  getSelectedConfig: () => LlamaConfig | undefined;
  createDefaultConfig: () => LlamaConfig;
  getParamValue: (config: LlamaConfig, key: string) => string;
  setParamValue: (configId: string, key: string, value: string, enabled: boolean) => void;
}

function createDefaultParams(): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const def of PARAM_DEFS) {
    params[def.key] = {
      value: def.defaultValue,
      enabled: false,
    };
  }
  return params;
}

function createDefaultPreStartCommand(): PreStartCommand {
  return {
    enabled: false,
    command: "",
    continueOnFailure: false,
  };
}

function copyCustomArgs(customArgs: CustomArg[] | undefined): CustomArg[] {
  return (customArgs ?? []).map((arg) => ({ ...arg }));
}

function copyParams(params: Record<string, ParamValue>): Record<string, ParamValue> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, { ...value }])
  );
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  configs: [],
  selectedConfigId: null,
  editorOpen: false,
  editingConfig: null,

  loadConfigs: (configs) => set({ configs }),

  selectConfig: (id) => set({ selectedConfigId: id }),

  openEditor: (config) => set({
    editorOpen: true,
    editingConfig: config || null,
  }),

  closeEditor: () => set({
    editorOpen: false,
    editingConfig: null,
  }),

  addConfig: (config) =>
    set((state) => ({
      configs: [...state.configs, config],
    })),

  updateConfig: (id, updates) =>
    set((state) => ({
      configs: state.configs.map((c) =>
        c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
      ),
    })),

  deleteConfig: (id) =>
    set((state) => ({
      configs: state.configs.filter((c) => c.id !== id),
      selectedConfigId: state.selectedConfigId === id ? null : state.selectedConfigId,
    })),

  duplicateConfig: (id) => {
    const source = get().configs.find((c) => c.id === id);
    if (!source) return get().createDefaultConfig();
    const newConfig: LlamaConfig = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      params: copyParams(source.params),
      customArgs: copyCustomArgs(source.customArgs),
      preStartCommand: source.preStartCommand
        ? { ...source.preStartCommand }
        : createDefaultPreStartCommand(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    get().addConfig(newConfig);
    return newConfig;
  },

  getSelectedConfig: () => {
    const id = get().selectedConfigId;
    return get().configs.find((c) => c.id === id);
  },

  createDefaultConfig: (): LlamaConfig => ({
    id: crypto.randomUUID(),
    name: "Unnamed",
    llamaCppPath: "",
    params: createDefaultParams(),
    customArgs: [],
    preStartCommand: createDefaultPreStartCommand(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isFavorite: false,
  }),

  getParamValue: (config, key) => {
    return config.params[key]?.value ?? "";
  },

  setParamValue: (configId, key, value, enabled) =>
    set((state) => ({
      configs: state.configs.map((c) =>
        c.id === configId
          ? {
              ...c,
              params: {
                ...c.params,
                [key]: { value, enabled },
              },
              updatedAt: Date.now(),
            }
          : c
      ),
    })),
}));
