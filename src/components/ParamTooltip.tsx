import { useTranslation } from "react-i18next";
import { ParamDef } from "@/types/llama-params";
import { motion } from "framer-motion";

interface ParamTooltipProps {
  flag: string;
  description: ParamDef;
}

export default function ParamTooltip({ flag, description }: ParamTooltipProps) {
  const { t } = useTranslation();
  const name = description.name ?? t(`params.${description.key}.name`, flag);
  const desc = description.description ?? t(`params.${description.key}.desc`, "");

  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className="absolute right-0 z-50 w-72 rounded-xl border bg-popover/95 backdrop-blur supports-[backdrop-filter]:bg-popover/80 p-3.5 shadow-xl ring-1 ring-black/5"
    >
      <div className="flex items-center justify-between mb-2">
        <code className="rounded-md bg-muted/80 px-2 py-1 font-mono text-sm font-semibold text-primary">
          {flag}
        </code>
        {description.min !== undefined && (
          <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
            {description.min}{description.max !== undefined ? ` ~ ${description.max}` : " +"}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-foreground">{name}</p>
      {desc && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {desc}
        </p>
      )}
    </motion.div>
  );
}
