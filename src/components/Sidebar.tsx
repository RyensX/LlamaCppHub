import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "@/stores/configStore";
import { useInstanceStore } from "@/stores/instanceStore";
import ConfigItem from "./ConfigItem";

export default function Sidebar() {
  const { t } = useTranslation();
  const configs = useConfigStore((s) => s.configs);
  const configStatus = useInstanceStore((s) => s.configStatus);
  const selectConfig = useConfigStore((s) => s.selectConfig);
  const openEditor = useConfigStore((s) => s.openEditor);
  const selectedId = useConfigStore((s) => s.selectedConfigId);

  const getStatus = (configId: string) => configStatus.get(configId) ?? "stopped";
  const favoriteConfigs = configs.filter((config) => config.isFavorite);
  const otherConfigs = configs.filter((config) => !config.isFavorite);

  const renderConfigSection = (title: string, sectionConfigs: typeof configs) => {
    if (sectionConfigs.length === 0) return null;

    return (
      <div className="space-y-1.5">
        <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          {title}
        </div>
        <div className="space-y-1">
          {sectionConfigs.map((config) => (
            <ConfigItem
              key={config.id}
              config={config}
              status={getStatus(config.id)}
              selected={selectedId === config.id}
              onSelect={selectConfig}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-background/95">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {configs.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-4 text-center text-muted-foreground">
            <Package className="h-10 w-10 opacity-45" />
            <span className="mt-3 text-sm font-medium text-foreground">{t("sidebar.emptyTitle")}</span>
            <span className="mt-1 text-xs leading-5">{t("sidebar.emptyDescription")}</span>
            <button
              onClick={() => openEditor()}
              className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("sidebar.newConfig")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {renderConfigSection(t("sidebar.favorites"), favoriteConfigs)}
            {renderConfigSection(`${t("sidebar.allConfigs")} (${otherConfigs.length})`, otherConfigs)}
          </div>
        )}
      </div>
    </aside>
  );
}
