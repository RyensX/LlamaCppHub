import { useTranslation } from "react-i18next";
import {
  selectInstanceLogs,
  selectLatestInstanceIdForConfig,
  useInstanceStore,
} from "@/stores/instanceStore";
import { ScrollText, Lock, Unlock } from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface LiveLogProps {
  configId: string;
  className?: string;
}

export default function LiveLog({ configId, className }: LiveLogProps) {
  const { t } = useTranslation();
  const latestInstanceId = useInstanceStore(selectLatestInstanceIdForConfig(configId));
  const logs = useInstanceStore(selectInstanceLogs(latestInstanceId));
  const [keepBottom, setKeepBottom] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (keepBottom && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [keepBottom, logs?.length]);

  const visibleLogs = useMemo(() => logs?.slice(-300), [logs]);
  const visibleStartIndex = (logs?.length ?? 0) - (visibleLogs?.length ?? 0);

  if (!logs || !visibleLogs) return null;

  const getLineColor = (line: string) => {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("fail")) return "text-red-400";
    if (lower.includes("warn")) return "text-yellow-400";
    return "text-muted-foreground";
  };

  return (
    <div className={cn("flex min-h-0 flex-col rounded-lg border", className)}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <ScrollText className="h-4 w-4" />
          {t("monitor.liveLog")}
        </span>
        <button
          onClick={() => setKeepBottom(!keepBottom)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            keepBottom ? "bg-primary/10 text-primary" : "hover:bg-muted"
          }`}
        >
          {keepBottom ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          {t("monitor.keepBottom")}
        </button>
      </div>

      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground">{t("monitor.noLog")}</div>
        ) : (
          visibleLogs.map((line, i) => (
            <div key={visibleStartIndex + i} className={`${getLineColor(line)} leading-relaxed`}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
