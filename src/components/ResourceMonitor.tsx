import { useEffect, useMemo, type ElementType } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  selectInstanceHistory,
  selectInstancePid,
  selectInstanceResource,
  selectLatestInstanceIdForConfig,
  useInstanceStore,
} from "@/stores/instanceStore";
import { Cpu, Gauge, MemoryStick, Monitor } from "lucide-react";
import type { ResourceSnapshot } from "@/types/llama-params";
import ResourceChart from "./ResourceChart";

interface ResourceMonitorProps {
  configId: string;
  showTrend: boolean;
}

type ResourceKey = "cpu" | "gpu" | "ram" | "vram";

interface ResourceSummary {
  average: number | null;
  peak: number | null;
}

function getResourceSummary(history: ResourceSnapshot[], key: ResourceKey): ResourceSummary {
  if (history.length === 0) return { average: null, peak: null };

  let total = 0;
  let peak = Number.NEGATIVE_INFINITY;

  for (const point of history) {
    const value = point[key];
    total += value;
    if (value > peak) peak = value;
  }

  return { average: total / history.length, peak };
}

function ResourceBadge({ icon: Icon, label, value, unit, color, average, peak }: {
  icon: ElementType;
  label: string;
  value: string;
  unit: string;
  color: string;
  average: string;
  peak: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">
            {value} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </div>
        </div>
      </div>
      <div className="shrink-0 space-y-1 text-right text-xs text-muted-foreground">
        <div>{t("monitor.average")}: <span className="font-medium text-foreground">{average}</span></div>
        <div>{t("monitor.peak")}: <span className="font-medium text-foreground">{peak}</span></div>
      </div>
    </div>
  );
}

export default function ResourceMonitor({ configId, showTrend }: ResourceMonitorProps) {
  const { t } = useTranslation();
  const latestInstanceId = useInstanceStore(selectLatestInstanceIdForConfig(configId));
  const instancePid = useInstanceStore(selectInstancePid(latestInstanceId));
  const resource = useInstanceStore(selectInstanceResource(latestInstanceId));
  const history = useInstanceStore(selectInstanceHistory(latestInstanceId));

  useEffect(() => {
    if (!latestInstanceId || !instancePid) return;

    let mounted = true;
    let unlisten: (() => void) | undefined;
    const subscriptionId = `${latestInstanceId}:${Date.now()}:${Math.random()}`;

    listen<{ cpu: number; gpu: number; ram: number; vram: number; timestamp: number }>(
      `instance:${latestInstanceId}:resource`,
      (event) => {
        if (!mounted) return;
        const { cpu, gpu, ram, vram, timestamp } = event.payload;
        useInstanceStore.getState().updateResourceSample(latestInstanceId, {
          cpu,
          gpu,
          ram,
          vram,
          timestamp,
        });
      }
    )
      .then((cleanup) => {
        if (mounted) {
          unlisten = cleanup;
          void invoke("start_instance_resource_monitor", {
            instanceId: latestInstanceId,
            pid: instancePid,
            subscriptionId,
          });
        } else {
          cleanup();
        }
      })
      .catch((error) => {
        console.error("Failed to subscribe to instance resource", error);
      });

    return () => {
      mounted = false;
      unlisten?.();
      void invoke("stop_instance_resource_monitor", { instanceId: latestInstanceId, subscriptionId });
    };
  }, [latestInstanceId, instancePid]);

  const formatMemory = (n: number) => {
    if (n >= 1024) return { value: (n / 1024).toFixed(1), unit: "GB" };
    return { value: n.toFixed(0), unit: "MB" };
  };

  const formatMemoryText = (n: number) => {
    const formatted = formatMemory(n);
    return `${formatted.value}${formatted.unit}`;
  };

  const formatPercentSummary = (summary: ResourceSummary) => ({
    average: summary.average === null ? "--" : `${summary.average.toFixed(1)}%`,
    peak: summary.peak === null ? "--" : `${summary.peak.toFixed(1)}%`,
  });

  const formatMemorySummary = (summary: ResourceSummary) => ({
    average: summary.average === null ? "--" : formatMemoryText(summary.average),
    peak: summary.peak === null ? "--" : formatMemoryText(summary.peak),
  });

  const summaries = useMemo(() => {
    const samples = history ?? [];

    return {
      cpu: formatPercentSummary(getResourceSummary(samples, "cpu")),
      gpu: formatPercentSummary(getResourceSummary(samples, "gpu")),
      ram: formatMemorySummary(getResourceSummary(samples, "ram")),
      vram: formatMemorySummary(getResourceSummary(samples, "vram")),
    };
  }, [history]);

  if (!resource || !history) return null;

  const ram = formatMemory(resource.ram);
  const vram = formatMemory(resource.vram);

  return (
    <div className="flex flex-col gap-3">
      {showTrend && <ResourceChart history={history} />}
      <div className="grid grid-cols-4 gap-3">
        <ResourceBadge
          icon={Cpu}
          label={t("monitor.cpu")}
          value={resource.cpu.toFixed(1)}
          unit="%"
          color="bg-blue-500"
          average={summaries.cpu.average}
          peak={summaries.cpu.peak}
        />
        <ResourceBadge
          icon={Gauge}
          label={t("monitor.gpu", "GPU")}
          value={resource.gpu.toFixed(1)}
          unit="%"
          color="bg-emerald-500"
          average={summaries.gpu.average}
          peak={summaries.gpu.peak}
        />
        <ResourceBadge
          icon={MemoryStick}
          label={t("monitor.memory")}
          value={ram.value}
          unit={ram.unit}
          color="bg-purple-500"
          average={summaries.ram.average}
          peak={summaries.ram.peak}
        />
        <ResourceBadge
          icon={Monitor}
          label={t("monitor.vram")}
          value={vram.value}
          unit={vram.unit}
          color="bg-green-500"
          average={summaries.vram.average}
          peak={summaries.vram.peak}
        />
      </div>
    </div>
  );
}
