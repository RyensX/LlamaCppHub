import { Languages, Plus, Power, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConfigStore } from "@/stores/configStore";
import ThemeToggle from "./ThemeToggle";
import SettingsPanel from "./SettingsPanel";

export default function Header() {
  const { t, i18n: i18nInstance } = useTranslation();
  const openEditor = useConfigStore((s) => s.openEditor);
  const [lang, setLang] = useState<string>("en");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    Promise.all([
      invoke<string>("get_language").catch(() => "en"),
    ]).then(([l]) => {
      setLang(l);
      i18nInstance.changeLanguage(l);
    });
  }, [i18nInstance]);

  const handleLangToggle = async () => {
    const next = lang === "en" ? "zh" : "en";
    setLang(next);
    i18nInstance.changeLanguage(next);
    try {
      await invoke("set_language", { lang: next });
    } catch (e) {
      console.error("Failed to save language:", e);
    }
  };

  const handleQuit = async () => {
    try {
      await invoke("quit_app");
    } catch (e) {
      console.error("Failed to quit:", e);
    }
  };

  return (
    <>
      <header className="flex h-12 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEditor()}
            className="flex h-8 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("sidebar.newConfig")}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title={t("sidebar.settings")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <ThemeToggle />
          <button
            onClick={handleLangToggle}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
            title={t("actions.switchLanguage")}
          >
            <Languages className="h-4 w-4" />
          </button>
          <button
            onClick={handleQuit}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
            title={t("actions.quit")}
          >
            <Power className="h-4 w-4" />
          </button>
        </div>
      </header>

      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onLanguageSaved={setLang}
      />
    </>
  );
}
