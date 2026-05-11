import { useTranslation } from "react-i18next";
import { useConfigStore } from "@/stores/configStore";
import { useConfigOperations } from "@/hooks/useConfigs";
import {
  selectConfigStatus,
  selectInstanceLogCount,
  selectInstancePid,
  selectInstanceServiceUrl,
  selectLatestInstanceIdForConfig,
  useInstanceStore,
} from "@/stores/instanceStore";
import { Pencil, Copy, Trash2, Server, Clock, SlidersHorizontal, Terminal, ExternalLink, LineChart } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import RunButton from "./RunButton";
import LiveLog from "./LiveLog";
import ResourceMonitor from "./ResourceMonitor";
import { PARAM_DEFS, type InstanceStatus } from "@/types/llama-params";
import { cn } from "@/lib/utils";

function StatusBadge({ status, label }: { status: InstanceStatus | "stopped"; label: string }) {
  const styles = {
    running: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
    starting: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    error: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    stopped: "border-border bg-muted/50 text-muted-foreground",
  }[status];

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", styles)}>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", status === "starting" && "animate-pulse")} />
      {label}
    </span>
  );
}

function MetaChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
    >
      {children}
    </span>
  );
}

export default function DetailView() {
  const { t } = useTranslation();
  const selectedConfig = useConfigStore((s) => s.getSelectedConfig());
  const openEditor = useConfigStore((s) => s.openEditor);
  const deleteConfig = useConfigStore((s) => s.deleteConfig);
  const { duplicateConfig } = useConfigOperations();
  const selectedId = useConfigStore((s) => s.selectedConfigId);
  const latestInstanceId = useInstanceStore(selectLatestInstanceIdForConfig(selectedId));
  const instanceStatus = useInstanceStore(selectConfigStatus(selectedId));
  const instancePid = useInstanceStore(selectInstancePid(latestInstanceId));
  const serviceUrl = useInstanceStore(selectInstanceServiceUrl(latestInstanceId));
  const logCount = useInstanceStore(selectInstanceLogCount(latestInstanceId));

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResourceTrend, setShowResourceTrend] = useState(true);

  const displayStatus = instanceStatus ?? "stopped";
  const isRunning = instanceStatus === "running";
  const isConfigLocked = instanceStatus === "starting" || instanceStatus === "running";
  const isErrored = instanceStatus === "error";
  const hasLogs = logCount > 0;

  const enabledParams = useMemo(() => PARAM_DEFS.filter((def) => {
    const p = selectedConfig?.params[def.key];
    return p?.enabled;
  }), [selectedConfig?.params]);
  const enabledCustomArgCount = selectedConfig?.customArgs.filter((arg) => arg.enabled && arg.text.trim()).length ?? 0;
  const enabledCount = enabledParams.length + enabledCustomArgCount;

  const handleDelete = async () => {
    if (!selectedId || isConfigLocked) return;
    try {
      await invoke("delete_config", { id: selectedId });
      deleteConfig(selectedId);
      setShowDeleteConfirm(false);
    } catch (e) {
      console.error("Failed to delete config:", e);
    }
  };

  const handleDuplicate = async () => {
    if (!selectedConfig) return;
    try {
      await duplicateConfig(selectedConfig.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenService = async () => {
    if (!serviceUrl) return;
    try {
      await open(serviceUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!selectedConfig) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <Server className="h-16 w-16 opacity-30" />
        <p className="text-sm">{t("config.noConfigSelected")}</p>
      </div>
    );
  }


  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{selectedConfig.name}</h1>
              <StatusBadge status={displayStatus} label={t(`status.${displayStatus}`)} />
            </div>

            <div className="flex flex-wrap gap-2">
              <MetaChip>
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span>{t("config.enabledCount", { count: enabledCount })}</span>
              </MetaChip>
              {selectedConfig.llamaCppPath && (
                <MetaChip title={selectedConfig.llamaCppPath}>
                  <Terminal className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{selectedConfig.llamaCppPath}</span>
                </MetaChip>
              )}
              {isRunning && instancePid && (
                <MetaChip>PID: {instancePid}</MetaChip>
              )}
              {selectedConfig.createdAt && (
                <MetaChip>
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{new Date(selectedConfig.createdAt).toLocaleDateString()}</span>
                </MetaChip>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 self-start rounded-lg bg-muted/30 p-1">
            {serviceUrl && (
              <button
                onClick={handleOpenService}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                title={t("config.openService", { url: serviceUrl })}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => {
                if (!isConfigLocked) openEditor(selectedConfig);
              }}
              disabled={isConfigLocked}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title={isConfigLocked ? t("editor.runningLocked", "Stop this config before editing") : t("config.edit")}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={handleDuplicate}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title={t("config.duplicate")}
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                if (!isConfigLocked) setShowDeleteConfirm(true);
              }}
              disabled={isConfigLocked}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              title={isConfigLocked ? t("editor.runningLocked", "Stop this config before editing") : t("config.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <RunButton configId={selectedConfig.id} />
            {isRunning && (
              <button
                type="button"
                onClick={() => setShowResourceTrend((value) => !value)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                  showResourceTrend
                    ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title={showResourceTrend ? t("monitor.trendToggleHide") : t("monitor.trendToggleShow")}
                aria-pressed={showResourceTrend}
              >
                <LineChart className="h-4 w-4" />
                {t("monitor.trendToggle")}
              </button>
            )}
          </div>
          {isConfigLocked && (
            <p className="text-xs text-muted-foreground">
              {t("editor.runningLocked", "Stop this config before editing")}
            </p>
          )}
        </div>

        {showDeleteConfirm && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            <span className="font-medium">{t("config.confirmDelete")}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                className="rounded-md bg-destructive px-3 py-1.5 text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                {t("actions.confirm")}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("actions.cancel")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            <span className="font-medium">{t("status.error")}:</span>
            <span className="min-w-0 flex-1 break-all">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 hover:text-red-300">✕</button>
          </div>
        )}
      </div>

      {/* Parameter Summary */}
      {!isConfigLocked && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-medium">{t("config.paramsSummary")}</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {enabledParams.map((def) => {
              const p = selectedConfig.params[def.key];
              return (
                <div key={def.key} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1">
                  <span className="text-muted-foreground">{def.flag}</span>
                  <span className="font-mono">{p?.value || "-"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Running info / Error logs */}
      {(isRunning || isErrored || hasLogs) && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {isRunning && <ResourceMonitor configId={selectedConfig.id} showTrend={showResourceTrend} />}
          <LiveLog configId={selectedConfig.id} className="min-h-0 flex-1" />
        </div>
      )}
    </div>
  );
}
