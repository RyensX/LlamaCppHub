import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useInstanceStore } from "@/stores/instanceStore";
import type { SystemGpuInfo, SystemInfo } from "@/types/llama-params";

function formatBytes(bytes?: number) {
  if (!bytes) return "N/A";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function compactCpuName(name?: string) {
  return name?.replace(/\s+/g, " ").replace(/\(R\)|\(TM\)|CPU|Processor/g, "").trim() || "N/A";
}

function formatGpu(gpu?: SystemGpuInfo) {
  if (!gpu) return "N/A";
  if (gpu.memoryUsedBytes && gpu.memoryTotalBytes) {
    return `${gpu.name} ${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(gpu.memoryTotalBytes)}`;
  }
  return gpu.name;
}

function formatMemory(systemInfo: SystemInfo) {
  const memoryType = systemInfo.memory.modules.find((module) => module.memoryType)?.memoryType ?? "N/A";
  return `${memoryType} ${formatBytes(systemInfo.memory.usedBytes)} / ${formatBytes(systemInfo.memory.totalBytes)}`;
}

export default function GlobalStatusBar() {
  const { t } = useTranslation();
  const runningCount = useInstanceStore((s) => s.runningCount);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [systemUnavailable, setSystemUnavailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<SystemInfo>("system:info", (event) => {
      if (!mounted) return;
      setSystemInfo(event.payload);
      setSystemUnavailable(false);
    })
      .then((cleanup) => {
        if (mounted) {
          unlisten = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((error) => {
        if (mounted) {
          setSystemUnavailable(true);
          console.warn("Failed to subscribe to system info", error);
        }
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const systemSummary = useMemo(() => {
    if (!systemInfo) return systemUnavailable ? t("status.systemUnavailable") : t("status.notAvailable");

    const cpu = `${compactCpuName(systemInfo.cpu.brand)} ${systemInfo.cpu.usagePercent.toFixed(0)}%`;
    const memory = formatMemory(systemInfo);
    const gpu = formatGpu(systemInfo.gpus[0]);

    return `${t("status.cpu")}: ${cpu} | ${t("status.ram")}: ${memory} | ${t("status.gpu")}: ${gpu}`;
  }, [systemInfo, systemUnavailable, t]);

  const detailTitle = useMemo(() => {
    if (!systemInfo) return systemSummary;

    const gpuList = systemInfo.gpus.map(formatGpu).join("\n") || t("status.notAvailable");

    return [
      `${t("status.cpu")}: ${systemInfo.cpu.brand || t("status.notAvailable")} (${systemInfo.cpu.cores} cores, ${systemInfo.cpu.usagePercent.toFixed(0)}%)`,
      `${t("status.ram")}: ${formatMemory(systemInfo)}`,
      `${t("status.gpu")}: ${gpuList}`,
    ].join("\n");
  }, [systemInfo, systemSummary, t]);

  return (
    <footer className="flex h-8 min-w-0 items-center justify-between gap-3 border-t bg-background/95 px-4 text-xs text-muted-foreground">
      <span className="shrink-0">{t("status.instancesRunning", { count: runningCount })}</span>
      <div className="flex min-w-0 items-center gap-2 text-right">
        <span className="hidden md:inline" title={detailTitle}>
          {systemSummary}
        </span>
        <span className="shrink-0 border-l pl-2">v0.1.0</span>
      </div>
    </footer>
  );
}
