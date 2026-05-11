import { useTranslation } from "react-i18next";
import { ParamDef } from "@/types/llama-params";
import { useState, useRef } from "react";
import { FolderOpen, Info } from "lucide-react";
import ParamTooltip from "./ParamTooltip";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";

interface ParamFieldProps {
  def: ParamDef;
  value: string;
  enabled: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onToggle: (enabled: boolean) => void;
}

export default function ParamField({ def, value, enabled, disabled = false, onChange, onToggle }: ParamFieldProps) {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isBool = def.type === "bool";
  const isPath = def.type === "path";
  const isEnum = def.type === "enum";
  const paramName = def.name ?? t(`params.${def.key}.name`, def.flag);
  const paramDesc = def.description ?? t(`params.${def.key}.desc`, "");

  const handleSelectFile = async () => {
    if (disabled) return;
    const path = await invoke<string>("select_file");
    if (path) {
      onChange(path);
      if (!enabled) onToggle(true);
    }
  };

  return (
    <div
      className={cn(
        "group rounded-xl border p-3 transition-all duration-150",
        enabled
          ? "border-border/80 bg-card shadow-sm hover:shadow-md hover:border-primary/30"
          : "border-transparent bg-muted/20 opacity-50 hover:opacity-70"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Toggle switch */}
        <button
          onClick={() => onToggle(!enabled)}
          disabled={disabled}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1",
            enabled ? "bg-green-500" : "bg-muted",
            disabled && "cursor-not-allowed opacity-60"
          )}
          aria-label={enabled ? "Disable" : "Enable"}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
              enabled ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>

        {/* Flag + Name */}
        <div className="shrink-0 flex items-center gap-2 min-w-0">
          <span className="rounded-md bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground tabular-nums">
            {def.flag}
          </span>
          <span className="text-xs font-medium text-foreground truncate">
            {paramName}
          </span>
        </div>

        {/* Input */}
        <div className="flex-1 min-w-0">
          {isBool ? (
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs font-medium",
                value === "true" ? "text-green-500" : "text-muted-foreground"
              )}>
                {value === "true" ? "On" : "Off"}
              </span>
            </div>
          ) : isEnum ? (
            <select
              value={def.options?.includes(value) ? value : def.defaultValue}
              onChange={(e) => onChange(e.target.value)}
              disabled={!enabled || disabled}
              className={cn(
                "w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs font-mono outline-none transition-colors",
                "focus:ring-2 focus:ring-primary/30 focus:border-primary/50",
                (!enabled || disabled) && "cursor-not-allowed bg-muted/30"
              )}
            >
              {(def.options ?? []).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          ) : isPath ? (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={!enabled || disabled}
                placeholder="path/to/file"
                className={cn(
                  "min-w-0 flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-mono outline-none transition-colors",
                  "placeholder:text-muted-foreground/60",
                  "focus:ring-2 focus:ring-primary/30 focus:border-primary/50",
                  (!enabled || disabled) && "cursor-not-allowed bg-muted/30"
                )}
              />
              <button
                type="button"
                onClick={handleSelectFile}
                disabled={disabled}
                className="shrink-0 rounded-lg border bg-background px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-muted-foreground"
                title={t("editor.selectFile", "Select file")}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <input
              type={def.type === "int" || def.type === "float" ? "number" : "text"}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={!enabled || disabled}
              placeholder={def.defaultValue}
              className={cn(
                "w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs font-mono outline-none transition-colors",
                "placeholder:text-muted-foreground/60",
                "focus:ring-2 focus:ring-primary/30 focus:border-primary/50",
                (!enabled || disabled) && "cursor-not-allowed bg-muted/30"
              )}
              style={{ minWidth: 0 }}
            />
          )}
        </div>

        {/* Info button */}
        <div className="relative shrink-0">
          <button
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={paramDesc}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          {showTooltip && (
            <div ref={tooltipRef}>
              <ParamTooltip flag={def.flag} description={def} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
