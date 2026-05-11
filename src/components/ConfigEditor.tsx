import { useTranslation } from "react-i18next";
import { useConfigStore } from "@/stores/configStore";
import { useInstanceStore } from "@/stores/instanceStore";
import { PARAM_DEFS, type CustomArg, type ParamValue, type PreStartCommand } from "@/types/llama-params";
import { useState, useEffect, useRef, useMemo } from "react";
import { X, Save, FolderOpen, Copy, Check, Terminal, AlertCircle, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ParamField from "./ParamField";
import { invoke } from "@tauri-apps/api/core";

function invokeSafe(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  return invoke(cmd, args ?? {}).catch((e) => {
    console.error(`[invoke ${cmd}]`, e);
    throw e;
  });
}

const PARAM_BY_KEY = Object.fromEntries(PARAM_DEFS.map((d) => [d.key, d]));
const KEY_TO_FLAG = Object.fromEntries(PARAM_DEFS.map((d) => [d.key, d.flag]));

function quoteCommandPart(value: string): string {
  if (!value) return value;
  return /\s|["']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

const DEFAULT_PRE_START_COMMAND: PreStartCommand = {
  enabled: false,
  command: "",
  continueOnFailure: false,
};

function normalizeCustomArgs(customArgs: CustomArg[] | undefined): CustomArg[] {
  return customArgs ?? [];
}

function normalizePreStartCommand(preStartCommand: PreStartCommand | undefined): PreStartCommand {
  return preStartCommand ?? DEFAULT_PRE_START_COMMAND;
}

function enabledCustomArgCount(customArgs: CustomArg[]): number {
  return customArgs.filter((arg) => arg.enabled && arg.text.trim()).length;
}

function buildServiceCommandPreview(
  llamaPath: string,
  params: Record<string, ParamValue>,
  customArgs: CustomArg[]
): string {
  const parts = [quoteCommandPart(llamaPath || "llama-server")];
  for (const [key, param] of Object.entries(params)) {
    if (!param.enabled) continue;
    const flag = KEY_TO_FLAG[key] || `--${key}`;
    parts.push(flag);
    if (PARAM_BY_KEY[key]?.type !== "bool" && param.value) {
      parts.push(quoteCommandPart(param.value));
    }
  }
  for (const arg of customArgs) {
    if (arg.enabled && arg.text.trim()) {
      parts.push(arg.text.trim());
    }
  }
  return parts.join(" ");
}

function buildCommandPreview(preStartCommand: PreStartCommand, serviceCommand: string): string {
  if (!preStartCommand.enabled) {
    return serviceCommand;
  }

  const preStartLines = preStartCommand.command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (preStartLines.length === 0) {
    return serviceCommand;
  }

  if (preStartCommand.continueOnFailure) {
    return [...preStartLines, serviceCommand].join("\n");
  }

  return `${preStartLines.join(" && ")} && ${serviceCommand}`;
}

export default function ConfigEditor() {
  const { t } = useTranslation();
  const editorOpen = useConfigStore((s) => s.editorOpen);
  const editingConfig = useConfigStore((s) => s.editingConfig);
  const closeEditor = useConfigStore((s) => s.closeEditor);
  const addConfig = useConfigStore((s) => s.addConfig);
  const updateConfig = useConfigStore((s) => s.updateConfig);
  const editingStatus = useInstanceStore((s) =>
    editingConfig?.id ? s.configStatus.get(editingConfig.id) : undefined
  );
  const isRunningConfig = editingStatus === "starting" || editingStatus === "running";

  const [name, setName] = useState("");
  const [llamaCppPath, setLlamaCppPath] = useState("");
  const [params, setParams] = useState<Record<string, ParamValue>>({});
  const [customArgs, setCustomArgs] = useState<CustomArg[]>([]);
  const [preStartCommand, setPreStartCommand] = useState<PreStartCommand>(DEFAULT_PRE_START_COMMAND);
  const [activeCategory, setActiveCategory] = useState<string>("model");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevConfigIdRef = useRef<string | null | undefined>(null);

  // Reset form when editor opens or config changes
  useEffect(() => {
    if (!editorOpen) {
      prevConfigIdRef.current = null;
      return;
    }
    const configId = editingConfig?.id;
    if (configId !== prevConfigIdRef.current) {
      if (editingConfig) {
        setName(editingConfig.name);
        setLlamaCppPath(editingConfig.llamaCppPath);
        setParams(editingConfig.params as Record<string, ParamValue>);
        setCustomArgs(normalizeCustomArgs(editingConfig.customArgs));
        setPreStartCommand(normalizePreStartCommand(editingConfig.preStartCommand));
      } else {
        const defaults: Record<string, ParamValue> = {};
        for (const def of PARAM_DEFS) {
          defaults[def.key] = { value: def.defaultValue, enabled: false };
        }
        setParams(defaults);
        setCustomArgs([]);
        setPreStartCommand(DEFAULT_PRE_START_COMMAND);
        setName("");
        setLlamaCppPath("");
      }
      prevConfigIdRef.current = configId;
    }
  }, [editorOpen, editingConfig]);

  const enabledCount = useMemo(
    () => Object.values(params).filter((p) => p.enabled).length + enabledCustomArgCount(customArgs),
    [params, customArgs]
  );

  const serviceCommandPreview = useMemo(
    () => buildServiceCommandPreview(llamaCppPath || "llama-server", params, customArgs),
    [llamaCppPath, params, customArgs]
  );

  const commandPreview = useMemo(
    () => buildCommandPreview(preStartCommand, serviceCommandPreview),
    [preStartCommand, serviceCommandPreview]
  );

  const handleSave = async () => {
    if (isRunningConfig) {
      setError(t("editor.runningLocked", "Stop this config before editing"));
      return;
    }

    if (!name.trim()) {
      setError(t("editor.nameRequired"));
      return;
    }

    const config = {
      id: editingConfig?.id || crypto.randomUUID(),
      name: name.trim(),
      llamaCppPath: llamaCppPath || editingConfig?.llamaCppPath || "",
      params,
      customArgs,
      preStartCommand,
      createdAt: editingConfig?.createdAt || Date.now(),
      updatedAt: Date.now(),
      isFavorite: editingConfig?.isFavorite ?? false,
    };

    try {
      await invoke("save_config", { config });
      if (editingConfig) {
        updateConfig(config.id, config);
      } else {
        addConfig(config);
      }
      setError(null);
      closeEditor();
    } catch (e: unknown) {
      console.error("Failed to save config:", e);
      setError(typeof e === "string" ? e : (e && typeof e === "object" && "message" in e ? (e as { message: string }).message : JSON.stringify(e)));
    }
  };

  const handleSelectLlamaFile = async () => {
    if (isRunningConfig) return;

    try {
      const path = await invoke<string>("select_file");
      if (path) {
        setLlamaCppPath(path);
      }
      setError(null);
    } catch (e: unknown) {
      console.error("[ConfigEditor] select_file (llama) error:", e);
      if (e !== "User cancelled") {
        setError(typeof e === "string" ? e : (e && typeof e === "object" && "message" in e ? (e as { message: string }).message : JSON.stringify(e)));
      }
    }
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(commandPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleAddCustomArg = () => {
    setCustomArgs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), enabled: true, text: "" },
    ]);
  };

  const handleUpdateCustomArg = (id: string, updates: Partial<CustomArg>) => {
    setCustomArgs((prev) =>
      prev.map((arg) => (arg.id === id ? { ...arg, ...updates } : arg))
    );
  };

  const handleDeleteCustomArg = (id: string) => {
    setCustomArgs((prev) => prev.filter((arg) => arg.id !== id));
  };

  const categories = [...new Set(PARAM_DEFS.map((d) => d.category))];

  return (
    <AnimatePresence>
      {editorOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeEditor}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 z-50 h-full w-[600px] bg-background border-l shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold">{t("editor.title")}</h2>
                {editingConfig && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(editingConfig.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
              <button onClick={closeEditor} className="rounded-md p-2 hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {isRunningConfig && (
                <div className="flex items-center gap-2 rounded-lg border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-500">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="flex-1 break-words">{t("editor.runningLocked", "Stop this config before editing")}</span>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 rounded-lg border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="flex-1 break-words">{error}</span>
                  <button onClick={() => setError(null)} className="shrink-0 hover:text-red-300">✕</button>
                </div>
              )}
              {/* --- Identity Card --- */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("editor.configName")}
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isRunningConfig}
                    placeholder={t("editor.configNamePlaceholder")}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:cursor-not-allowed disabled:bg-muted/30"
                  />
                </div>

                {/* llama.cpp path */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("editor.selectLlamaCpp")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={llamaCppPath}
                      onChange={(e) => setLlamaCppPath(e.target.value)}
                      disabled={isRunningConfig}
                      placeholder={t("editor.emptyGlobalHint")}
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors disabled:cursor-not-allowed disabled:bg-muted/30"
                    />
                    <button
                      onClick={handleSelectLlamaFile}
                      disabled={isRunningConfig}
                      className="flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {t("editor.selectFile")}
                    </button>
                  </div>
                </div>
              </div>

              {/* --- Pre-start Command Card --- */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("editor.preStartCommand")}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("editor.preStartCommandDesc")}
                    </p>
                  </div>
                  <button
                    onClick={() => setPreStartCommand((prev) => ({ ...prev, enabled: !prev.enabled }))}
                    disabled={isRunningConfig}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      preStartCommand.enabled ? "bg-green-500" : "bg-muted"
                    } ${isRunningConfig ? "cursor-not-allowed opacity-60" : ""}`}
                    aria-label={t("editor.enablePreStartCommand")}
                    role="switch"
                    aria-checked={preStartCommand.enabled}
                  >
                    <span
                      className={`absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        preStartCommand.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                {preStartCommand.enabled && (
                  <div className="space-y-3">
                    <textarea
                      aria-label={t("editor.preStartCommand")}
                      value={preStartCommand.command}
                      onChange={(e) => setPreStartCommand((prev) => ({ ...prev, command: e.target.value }))}
                      disabled={isRunningConfig}
                      placeholder={t("editor.preStartCommandPlaceholder")}
                      className="min-h-24 w-full resize-y rounded-lg border bg-background px-3 py-2 text-xs font-mono outline-none transition-colors focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:cursor-not-allowed disabled:bg-muted/30"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={preStartCommand.continueOnFailure}
                        onChange={(e) => setPreStartCommand((prev) => ({ ...prev, continueOnFailure: e.target.checked }))}
                        disabled={isRunningConfig}
                        className="h-3.5 w-3.5 rounded border-border"
                      />
                      {t("editor.continueOnFailure")}
                    </label>
                  </div>
                )}
              </div>

              {/* --- Command Preview Card --- */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    {t("editor.fullCommandPreview")}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {t("config.enabledCount", { count: enabledCount })}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex-1 space-y-2 min-w-0">
                    {preStartCommand.enabled && preStartCommand.command.trim() && (
                      <div>
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {t("editor.preStartCommand")}
                        </div>
                        <code className="block text-xs font-mono text-foreground break-all whitespace-pre-wrap">
                          {preStartCommand.command.trim()}
                        </code>
                      </div>
                    )}
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {t("editor.serviceCommand")}
                      </div>
                      <code className="block text-xs font-mono text-foreground break-all whitespace-pre-wrap">
                        {serviceCommandPreview}
                      </code>
                    </div>
                  </div>
                  <button
                    onClick={handleCopyCommand}
                    className="shrink-0 rounded-md p-1.5 hover:bg-muted transition-colors"
                    title={t("editor.copy")}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              {/* --- Category Tabs --- */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {categories.map((cat) => {
                  const builtInCount = PARAM_DEFS.filter((d) => d.category === cat && params[d.key]?.enabled).length;
                  const catCount = cat === "advanced"
                    ? builtInCount + enabledCustomArgCount(customArgs)
                    : builtInCount;
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        activeCategory === cat
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {t(`categories.${cat}`)}
                      {catCount > 0 && (
                        <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                          activeCategory === cat ? "bg-white/20" : "bg-primary/10 text-primary"
                        }`}>
                          {catCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* --- Params --- */}
              <div className="space-y-2">
                {PARAM_DEFS.filter((d) => d.category === activeCategory).map((def) => (
                  <ParamField
                    key={def.key}
                    def={def}
                    value={params[def.key]?.value ?? def.defaultValue}
                    enabled={params[def.key]?.enabled ?? false}
                    disabled={isRunningConfig}
                    onChange={(value) =>
                      setParams((prev) => ({
                        ...prev,
                        [def.key]: { ...prev[def.key], value },
                      }))
                    }
                    onToggle={(enabled) =>
                      setParams((prev) => ({
                        ...prev,
                        [def.key]: {
                          ...prev[def.key],
                          enabled,
                          value: def.type === "bool"
                            ? String(enabled)
                            : def.options?.includes(prev[def.key]?.value ?? "")
                              ? prev[def.key]?.value ?? def.defaultValue
                              : def.defaultValue,
                        },
                      }))
                    }
                  />
                ))}

                {activeCategory === "advanced" && (
                  <div className="mt-4 rounded-xl border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium">{t("editor.customArgs")}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{t("editor.customArgsDesc")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddCustomArg}
                        disabled={isRunningConfig}
                        className="flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t("editor.addCustomArg")}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {customArgs.map((arg) => (
                        <div
                          key={arg.id}
                          className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${
                            arg.enabled ? "bg-background" : "bg-muted/20 opacity-60"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleUpdateCustomArg(arg.id, { enabled: !arg.enabled })}
                            disabled={isRunningConfig}
                            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                              arg.enabled ? "bg-green-500" : "bg-muted"
                            } ${isRunningConfig ? "cursor-not-allowed opacity-60" : ""}`}
                            aria-label={arg.enabled ? t("editor.disableCustomArg") : t("editor.enableCustomArg")}
                            role="switch"
                            aria-checked={arg.enabled}
                          >
                            <span
                              className={`absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                arg.enabled ? "translate-x-4" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                          <input
                            aria-label={t("editor.customArgs")}
                            value={arg.text}
                            onChange={(e) => handleUpdateCustomArg(arg.id, { text: e.target.value })}
                            disabled={!arg.enabled || isRunningConfig}
                            placeholder={t("editor.customArgPlaceholder")}
                            className="min-w-0 flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-mono outline-none transition-colors focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:cursor-not-allowed disabled:bg-muted/30"
                          />
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomArg(arg.id)}
                            disabled={isRunningConfig}
                            title={t("editor.deleteCustomArg")}
                            aria-label={t("editor.deleteCustomArg")}
                            className="shrink-0 rounded-lg border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t px-5 py-4 shrink-0">
              <p className="text-xs text-muted-foreground">
                {editingConfig
                  ? `Updated ${new Date(editingConfig.updatedAt).toLocaleString()}`
                  : t("editor.newConfig")}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={closeEditor}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  {t("actions.cancel")}
                </button>
                <button
                  onClick={handleSave}
                  disabled={isRunningConfig}
                  className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
                >
                  <Save className="h-4 w-4" />
                  {t("actions.save")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
