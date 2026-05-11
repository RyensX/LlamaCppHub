import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Package, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfigItemProps {
  config: { id: string; name: string; isFavorite: boolean };
  status: "starting" | "running" | "error" | "stopped";
  selected: boolean;
  onSelect: (id: string) => void;
}

const statusStyles = {
  running: "bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.14)]",
  starting: "bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.14)] animate-pulse",
  error: "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]",
  stopped: "bg-muted-foreground/35",
};

function ConfigItem({ config, status, selected, onSelect }: ConfigItemProps) {
  const { t } = useTranslation();

  return (
    <button
      onClick={() => onSelect(config.id)}
      title={config.name}
      className={cn(
        "group relative flex w-full items-center gap-2 overflow-hidden rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
        selected
          ? "border-primary/30 bg-primary/10 text-foreground shadow-sm"
          : "border-transparent hover:border-border hover:bg-muted/60"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-2 bottom-2 w-1 rounded-r-full transition-opacity",
          selected ? "bg-primary opacity-100" : "opacity-0"
        )}
      />
      <Package className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{config.name}</span>
          {config.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-500" />}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusStyles[status])} />
          <span>{t(`status.${status}`)}</span>
        </div>
      </div>
    </button>
  );
}

export default memo(ConfigItem);
