import { useTranslation } from "react-i18next";
import { useInstanceStore } from "@/stores/instanceStore";
import { useConfigStore } from "@/stores/configStore";
import { extractServiceUrl } from "@/lib/serviceUrl";
import { Play, Square, Loader2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type UnlistenFn = () => void;

interface RunButtonProps {
  configId: string;
}

const unlistenByInstance = new Map<string, UnlistenFn[]>();
const logBufferByInstance = new Map<string, string[]>();
const logFlushIntervalByInstance = new Map<string, ReturnType<typeof setTimeout>>();
const startingConfigIds = new Set<string>();

function flushLogBuffer(instanceId: string, clear = false) {
  const lines = logBufferByInstance.get(instanceId);
  logFlushIntervalByInstance.delete(instanceId);
  if (!lines?.length) {
    if (clear) {
      logBufferByInstance.delete(instanceId);
    }
    return;
  }
  useInstanceStore.getState().appendLogs(instanceId, lines);
  if (clear) {
    logBufferByInstance.delete(instanceId);
  } else {
    logBufferByInstance.set(instanceId, []);
  }
}

function appendBufferedLog(instanceId: string, line: string) {
  const serviceUrl = extractServiceUrl(line);
  if (serviceUrl) {
    useInstanceStore.getState().updateServiceUrl(instanceId, serviceUrl);
  }

  const lines = logBufferByInstance.get(instanceId) ?? [];
  lines.push(line);
  logBufferByInstance.set(instanceId, lines);
  if (!logFlushIntervalByInstance.has(instanceId)) {
    const timer = setTimeout(() => {
      flushLogBuffer(instanceId);
    }, 200);
    logFlushIntervalByInstance.set(instanceId, timer);
  }
}

function cleanupRuntime(instanceId: string) {
  const timer = logFlushIntervalByInstance.get(instanceId);
  if (timer !== undefined) {
    clearTimeout(timer);
    logFlushIntervalByInstance.delete(instanceId);
  }
  flushLogBuffer(instanceId, true);

  const unlistens = unlistenByInstance.get(instanceId);
  if (unlistens) {
    unlistens.forEach((fn) => fn());
    unlistenByInstance.delete(instanceId);
  }
}

export default function RunButton({ configId }: RunButtonProps) {
  const { t } = useTranslation();
  const latestInstanceId = useInstanceStore((s) => s.latestInstanceByConfig.get(configId));
  const instanceStatus = useInstanceStore((s) => s.configStatus.get(configId));
  const instancePid = useInstanceStore((s) =>
    latestInstanceId ? s.instances.get(latestInstanceId)?.pid : undefined
  );
  const addInstance = useInstanceStore((s) => s.addInstance);
  const updateStatus = useInstanceStore((s) => s.updateStatus);
  const removeInstance = useInstanceStore((s) => s.removeInstance);
  const updatePid = useInstanceStore((s) => s.updatePid);
  const updateCommand = useInstanceStore((s) => s.updateCommand);

  const isStarting = instanceStatus === "starting";
  const isRunning = instanceStatus === "running";

  const handleStart = async () => {
    if (isStarting || isRunning || startingConfigIds.has(configId)) return;
    startingConfigIds.add(configId);

    const instanceId = `${configId}-${Date.now()}`;

    try {
      const configName = useConfigStore.getState().configs.find((c) => c.id === configId)?.name || "";
      addInstance({
        id: instanceId,
        configId,
        configName,
        status: "starting",
        pid: null,
        logs: [],
        resource: { cpu: 0, gpu: 0, ram: 0, vram: 0, timestamp: Date.now() },
        history: [],
        startedAt: Date.now(),
        command: "",
      });
      updateStatus(instanceId, "starting");

      const unlistenLog = await listen<any>(
        `instance:${instanceId}:log`,
        (event) => {
          const { line } = event.payload;
          appendBufferedLog(instanceId, line);
        }
      );
      const unlistenExit = await listen<any>(
        `instance:${instanceId}:exited`,
        (event) => {
          flushLogBuffer(instanceId);
          const code = event.payload?.code;
          const error = event.payload?.error;
          if (error) {
            useInstanceStore.getState().appendLog(instanceId, `[ERROR] ${error}`);
            if (typeof code === "number") {
              useInstanceStore.getState().appendLog(instanceId, `[EXIT] Process exited with code ${code}`);
            } else {
              useInstanceStore.getState().appendLog(instanceId, "[EXIT] Process stopped with error");
            }
            updateStatus(instanceId, "error");
          } else if (typeof code === "number" && code !== 0) {
            useInstanceStore.getState().appendLog(instanceId, `[EXIT] Process exited with code ${code}`);
            updateStatus(instanceId, "error");
          } else {
            useInstanceStore.getState().appendLog(instanceId, "[EXIT] Process stopped");
            updateStatus(instanceId, "stopped");
          }
          void invoke("unregister_instance_cmd", { instanceId });
          cleanupRuntime(instanceId);
        }
      );
      unlistenByInstance.set(instanceId, [unlistenLog, unlistenExit]);

      const result = await invoke("start_instance", { configId, instanceId }) as { pid: number; command: string };

      updatePid(instanceId, result.pid);
      updateCommand(instanceId, result.command);
      updateStatus(instanceId, "running");
    } catch (e: any) {
      flushLogBuffer(instanceId);
      const errorMsg = typeof e === "string"
        ? e
        : (e?.message ?? JSON.stringify(e));
      console.error("[RunButton] start_instance failed:", errorMsg);
      useInstanceStore.getState().appendLog(instanceId, `[ERROR] ${errorMsg}`);
      updateStatus(instanceId, "error");
      cleanupRuntime(instanceId);
    } finally {
      startingConfigIds.delete(configId);
    }
  };

  const handleStop = async () => {
    if (!latestInstanceId) return;

    if (!instancePid) {
      console.error("Failed to stop instance: missing pid");
      useInstanceStore.getState().appendLog(latestInstanceId, "[ERROR] Failed to stop instance: missing pid");
      return;
    }

    try {
      await invoke("stop_instance_cmd", { pid: instancePid });
      cleanupRuntime(latestInstanceId);
      removeInstance(latestInstanceId);
    } catch (e) {
      console.error("Failed to stop instance:", e);
      useInstanceStore.getState().appendLog(latestInstanceId, `[ERROR] Failed to stop instance: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (isStarting) {
    return (
      <button disabled className="flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-sm text-white opacity-80">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("actions.starting")}
      </button>
    );
  }

  if (isRunning) {
    return (
      <button
        onClick={handleStop}
        className="flex h-9 items-center gap-1.5 rounded-md bg-destructive px-4 text-sm text-destructive-foreground hover:bg-destructive/90"
      >
        <Square className="h-3.5 w-3.5" />
        {t("actions.stop")}
      </button>
    );
  }

  return (
    <button
      onClick={handleStart}
      className="flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-4 text-sm text-white hover:bg-green-600/90"
    >
      <Play className="h-4 w-4" />
      {t("actions.start")}
    </button>
  );
}
