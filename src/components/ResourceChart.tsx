import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ResourceSnapshot } from "@/types/llama-params";
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

interface ResourceChartProps {
  history: ResourceSnapshot[];
}

type LineLabelProps = {
  index?: number;
  x?: number | string;
  y?: number | string;
};

function renderLineLabel(props: LineLabelProps, label: string, color: string, itemCount: number, yOffset = 4) {
  if (props.index !== itemCount - 1 || typeof props.x !== "number" || typeof props.y !== "number") {
    return null;
  }

  return (
    <text x={props.x + 6} y={props.y + yOffset} fill={color} fontSize={11} fontWeight={600}>
      {label}
    </text>
  );
}

const TREND_WINDOW_SECONDS = 120;
const TREND_AXIS_TICKS = [0, 30, 60, 90, 120];
const TREND_AXIS_LABELS = new Map<number, string>([
  [0, "2min"],
  [30, "90s"],
  [60, "1min"],
  [90, "30s"],
  [120, "现在"],
]);

function formatTooltipLabel(elapsedSeconds: number, nowLabel: string) {
  if (elapsedSeconds <= 0) return nowLabel;
  if (elapsedSeconds % 60 === 0) return `${elapsedSeconds / 60}min`;
  return `${elapsedSeconds}s`;
}

export default function ResourceChart({ history }: ResourceChartProps) {
  const { t } = useTranslation();

  const chartData = useMemo(() => {
    return history.map((point, i) => {
      const elapsedSeconds = history.length - i - 1;

      return {
        x: TREND_WINDOW_SECONDS - elapsedSeconds,
        label: formatTooltipLabel(elapsedSeconds, t("monitor.now")),
        cpu: point.cpu,
        gpu: point.gpu,
        ram: point.ram,
        vram: point.vram,
      };
    });
  }, [history, t]);

  const formatMemory = (value: number) => {
    if (value >= 1024) return `${(value / 1024).toFixed(1)}GB`;
    return `${value.toFixed(0)}MB`;
  };

  if (history.length < 2) {
    return (
      <div className="rounded-lg border p-4">
        <div className="mb-3 text-sm font-medium">{t("monitor.trendTitle")}</div>
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("monitor.waitingResourceData")}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 text-sm font-medium">{t("monitor.trendTitle")}</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, TREND_WINDOW_SECONDS]}
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => {
              const tick = Number(value);
              return TREND_AXIS_LABELS.get(tick) ?? "";
            }}
            ticks={TREND_AXIS_TICKS}
            interval={0}
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            yAxisId="cpu"
            domain={[0, 100]}
            tick={{ fontSize: 10 }}
            stroke="#3b82f6"
            tickFormatter={(value) => `${value}%`}
          />
          <YAxis
            yAxisId="memory"
            orientation="right"
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(value) => formatMemory(Number(value))}
          />
          <Tooltip
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
            formatter={(value, name) => {
              const numeric = typeof value === "number" ? value : Number(value);
              const formatted = name === t("monitor.memory") || name === t("monitor.vram")
                ? formatMemory(numeric)
                : `${numeric.toFixed(1)}%`;
              return [formatted, name];
            }}
            contentStyle={{
              fontSize: 12,
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 6,
            }}
          />
          <Line
            yAxisId="cpu"
            type="monotone"
            dataKey="cpu"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            name={t("monitor.cpu")}
          >
            <LabelList content={(props) => renderLineLabel(props, t("monitor.cpu"), "#3b82f6", history.length, -6)} />
          </Line>
          <Line
            yAxisId="cpu"
            type="monotone"
            dataKey="gpu"
            stroke="#10b981"
            strokeWidth={1.5}
            dot={false}
            name={t("monitor.gpu", "GPU")}
          >
            <LabelList content={(props) => renderLineLabel(props, t("monitor.gpu", "GPU"), "#10b981", history.length, 12)} />
          </Line>
          <Line
            yAxisId="memory"
            type="monotone"
            dataKey="ram"
            stroke="#a855f7"
            strokeWidth={1.5}
            dot={false}
            name={t("monitor.memory")}
          >
            <LabelList content={(props) => renderLineLabel(props, t("monitor.memory"), "#a855f7", history.length, -6)} />
          </Line>
          <Line
            yAxisId="memory"
            type="monotone"
            dataKey="vram"
            stroke="#22c55e"
            strokeWidth={1.5}
            dot={false}
            name={t("monitor.vram")}
          >
            <LabelList content={(props) => renderLineLabel(props, t("monitor.vram"), "#22c55e", history.length, 12)} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
