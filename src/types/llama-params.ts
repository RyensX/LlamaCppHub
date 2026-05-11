// llama.cpp server mode parameter definitions

export type ParamType = "int" | "float" | "bool" | "string" | "path" | "enum";
export type ParamCategory =
  | "model"
  | "context"
  | "batch"
  | "gpu"
  | "server"
  | "log"
  | "advanced";

export interface ParamDef {
  key: string;
  flag: string;
  category: ParamCategory;
  defaultValue: string;
  type: ParamType;
  min?: number;
  max?: number;
  options?: string[];
  name?: string;
  description?: string;
}

export const PARAM_DEFS: ParamDef[] = [
  // Model
  { key: "model", flag: "-m", category: "model", defaultValue: "", type: "path" },
  { key: "threads", flag: "-t", category: "model", defaultValue: "4", type: "int", min: 1, max: 128 },
  { key: "threads_batch", flag: "-tb", category: "model", defaultValue: "0", type: "int", min: 0 },
  { key: "gpu_layers", flag: "-ngl", category: "gpu", defaultValue: "0", type: "int", min: 0, max: 1000 },
  { key: "split_mode", flag: "-sm", category: "gpu", defaultValue: "layer", type: "enum", options: ["none", "layer", "row", "tensor"] },
  { key: "tensor_split", flag: "-ts", category: "gpu", defaultValue: "", type: "string" },
  { key: "main_gpu", flag: "-mg", category: "gpu", defaultValue: "0", type: "int" },
  { key: "fit", flag: "--fit", category: "gpu", defaultValue: "on", type: "enum", options: ["on", "off"] },
  { key: "fit_target", flag: "--fit-target", category: "gpu", defaultValue: "1024", type: "string" },
  { key: "fit_ctx", flag: "--fit-ctx", category: "gpu", defaultValue: "4096", type: "int", min: 1 },
  { key: "rope_scaling", flag: "--rope-scaling", category: "gpu", defaultValue: "", type: "string" },
  { key: "rope_freq_base", flag: "--rope-freq-base", category: "gpu", defaultValue: "0.0", type: "float" },
  { key: "rope_freq_scale", flag: "--rope-freq-scale", category: "gpu", defaultValue: "0.0", type: "float" },
  { key: "vocab_only", flag: "--vocab-only", category: "model", defaultValue: "false", type: "bool" },
  { key: "use_mmap", flag: "--mmap", category: "model", defaultValue: "true", type: "bool" },
  { key: "use_mlock", flag: "--mlock", category: "model", defaultValue: "false", type: "bool" },
  { key: "no_mmap", flag: "--no-mmap", category: "model", defaultValue: "false", type: "bool" },
  { key: "check_tensors", flag: "--check-tensors", category: "model", defaultValue: "false", type: "bool" },
  { key: "override_kv", flag: "--override-kv", category: "model", defaultValue: "", type: "string" },
  { key: "op_offload", flag: "--op-offload", category: "gpu", defaultValue: "true", type: "bool" },
  { key: "no_op_offload", flag: "--no-op-offload", category: "gpu", defaultValue: "false", type: "bool" },
  { key: "lora", flag: "--lora", category: "model", defaultValue: "", type: "path" },
  { key: "lora_scaled", flag: "--lora-scaled", category: "model", defaultValue: "", type: "string" },
  // Context
  { key: "ctx_size", flag: "-c", category: "context", defaultValue: "512", type: "int", min: 1 },
  { key: "batch_size", flag: "--batch-size", category: "batch", defaultValue: "512", type: "int", min: 1 },
  { key: "ubatch_size", flag: "--ubatch-size", category: "batch", defaultValue: "512", type: "int", min: 1 },
  { key: "repetition_penalty", flag: "--repeat-penalty", category: "context", defaultValue: "1.1", type: "float" },
  { key: "frequency_penalty", flag: "--frequency-penalty", category: "context", defaultValue: "0.0", type: "float" },
  { key: "presence_penalty", flag: "--presence-penalty", category: "context", defaultValue: "0.0", type: "float" },
  { key: "dry_multiplier", flag: "--dry-multiplier", category: "context", defaultValue: "0.0", type: "float" },
  { key: "dry_base", flag: "--dry-base", category: "context", defaultValue: "1.75", type: "float" },
  { key: "dry_allowed_length", flag: "--dry-allowed-length", category: "context", defaultValue: "0", type: "int" },
  { key: "dry_penalty_last_n", flag: "--dry-penalty-last-n", category: "context", defaultValue: "0", type: "int" },
  { key: "cache_type_k", flag: "--cache-type-k", category: "context", defaultValue: "f16", type: "string" },
  { key: "cache_type_v", flag: "--cache-type-v", category: "context", defaultValue: "f16", type: "string" },
  // Server
  { key: "host", flag: "--host", category: "server", defaultValue: "127.0.0.1", type: "string" },
  { key: "port", flag: "--port", category: "server", defaultValue: "8080", type: "int", min: 1, max: 65535 },
  { key: "embedding", flag: "--embedding", category: "server", defaultValue: "false", type: "bool" },
  { key: "log_disable", flag: "--log-disable", category: "log", defaultValue: "false", type: "bool" },
  { key: "log_prefix", flag: "--log-prefix", category: "log", defaultValue: "", type: "string" },
  { key: "cslots", flag: "--chunk-size", category: "context", defaultValue: "0", type: "int" },
  // Advanced
  { key: "flash_attn", flag: "-fa", category: "advanced", defaultValue: "auto", type: "enum", options: ["auto", "on", "off"] },
  { key: "low_vram", flag: "--low-vram", category: "advanced", defaultValue: "false", type: "bool" },
  { key: "no_kv_offload", flag: "--no-kv-offload", category: "advanced", defaultValue: "false", type: "bool" },
  { key: "batch_break", flag: "--batch-break", category: "advanced", defaultValue: "true", type: "bool" },
  { key: "logit_bias", flag: "--logit-bias", category: "advanced", defaultValue: "", type: "string" },
  { key: "ignore_eos", flag: "--ignore-eos", category: "advanced", defaultValue: "false", type: "bool" },
  { key: "speculative", flag: "--speculative", category: "advanced", defaultValue: "", type: "string" },
  { key: "jinja", flag: "--jinja", category: "advanced", defaultValue: "false", type: "bool" },
  { key: "chat_template_file", flag: "--chat-template-file", category: "advanced", defaultValue: "", type: "path" },
  // Runtime / sampling
  { key: "numa", flag: "--numa", category: "advanced", defaultValue: "false", type: "bool" },
  { key: "mirostat", flag: "--mirostat", category: "advanced", defaultValue: "-1", type: "int" },
  { key: "mirostat_lr", flag: "--mirostat-lr", category: "advanced", defaultValue: "0.1", type: "float" },
  { key: "mirostat_ent", flag: "--mirostat-ent", category: "advanced", defaultValue: "5.0", type: "float" },
  { key: "mirostat_tau", flag: "--mirostat-tau", category: "advanced", defaultValue: "0.5", type: "float" },
  { key: "seed", flag: "--seed", category: "advanced", defaultValue: "42", type: "int" },
  { key: "skip_predict_special", flag: "--skip-predict-special", category: "advanced", defaultValue: "false", type: "bool" },
  { key: "tokens_add_special", flag: "--tokens-add-special", category: "advanced", defaultValue: "", type: "string" },
  { key: "tokens_add_user", flag: "--tokens-add-user", category: "advanced", defaultValue: "", type: "string" },
  { key: "tokens_add_assistant", flag: "--tokens-add-assistant", category: "advanced", defaultValue: "", type: "string" },
  { key: "maas_mode", flag: "--maas-mode", category: "advanced", defaultValue: "false", type: "bool" },
];

export interface ParamValue {
  value: string;
  enabled: boolean;
}

export interface CustomArg {
  id: string;
  enabled: boolean;
  text: string;
}

export interface PreStartCommand {
  enabled: boolean;
  command: string;
  continueOnFailure: boolean;
}

export interface LlamaConfig {
  id: string;
  name: string;
  llamaCppPath: string;
  params: Record<string, ParamValue>;
  customArgs: CustomArg[];
  preStartCommand: PreStartCommand;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
}

export type InstanceStatus = "starting" | "running" | "error" | "stopped";

export interface ResourceSnapshot {
  cpu: number;
  gpu: number;
  ram: number;
  vram: number;
  timestamp: number;
}

export interface SystemCpuInfo {
  brand?: string;
  usagePercent: number;
  cores: number;
}

export interface SystemMemoryModuleInfo {
  manufacturer?: string;
  partNumber?: string;
  capacityBytes?: number;
  speedMhz?: number;
  memoryType?: string;
}

export interface SystemMemoryInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  modules: SystemMemoryModuleInfo[];
}

export interface SystemGpuInfo {
  name: string;
  memoryTotalBytes?: number;
  memoryUsedBytes?: number;
}

export interface SystemInfo {
  cpu: SystemCpuInfo;
  memory: SystemMemoryInfo;
  gpus: SystemGpuInfo[];
  updatedAt: number;
}

export interface RunningInstance {
  id: string;
  configId: string;
  configName: string;
  status: InstanceStatus;
  pid: number | null;
  logs: string[];
  resource: ResourceSnapshot;
  history: ResourceSnapshot[];
  startedAt: number;
  command: string;
  serviceUrl?: string;
}

export interface LogEntry {
  line: string;
  timestamp: number;
  type: "stdout" | "stderr";
}
