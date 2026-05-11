import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeProvider";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";
type SupportedLanguage = "en" | "zh";
type MessageTone = "success" | "warning" | "error" | "info";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onLanguageSaved: (language: string) => void;
}

interface PanelMessage {
  tone: MessageTone;
  text: string;
}

const themeOptions: Array<{ value: ThemeMode; labelKey: string; icon: typeof Monitor }> = [
  { value: "system", labelKey: "settings.system", icon: Monitor },
  { value: "light", labelKey: "settings.light", icon: Sun },
  { value: "dark", labelKey: "settings.dark", icon: Moon },
];

const languageOptions: Array<{ value: SupportedLanguage; labelKey: string }> = [
  { value: "zh", labelKey: "settings.langZh" },
  { value: "en", labelKey: "settings.langEn" },
];

function normalizeLanguage(language: unknown): SupportedLanguage {
  return language === "zh" ? "zh" : "en";
}

function normalizeTheme(theme: unknown): ThemeMode {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error);
}

function MessageBox({ message }: { message: PanelMessage }) {
  const styles = {
    success: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    error: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  }[message.tone];
  const Icon = message.tone === "success" ? CheckCircle2 : AlertCircle;

  return (
    <div
      role={message.tone === "error" ? "alert" : "status"}
      aria-live={message.tone === "error" ? "assertive" : "polite"}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", styles)}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message.text}</span>
    </div>
  );
}

export default function SettingsPanel({ open, onClose, onLanguageSaved }: SettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const { applyTheme } = useTheme();
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const pathInputId = `${panelId}-llama-path`;
  const [pendingLlamaPath, setPendingLlamaPath] = useState("");
  const [pendingLanguage, setPendingLanguage] = useState<SupportedLanguage>("en");
  const [pendingTheme, setPendingTheme] = useState<ThemeMode>("system");
  const [initialValues, setInitialValues] = useState({ llamaPath: "", language: "en" as SupportedLanguage, theme: "system" as ThemeMode });
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const wasOpenRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const editVersionRef = useRef(0);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      loadRequestIdRef.current += 1;
      setLoading(false);
      setLoadFailed(false);
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const editVersion = editVersionRef.current;
    let cancelled = false;

    setLoading(true);
    setLoadFailed(false);
    setMessage(null);
    Promise.all([
      invoke<string | null>("get_llama_cpp_path"),
      invoke<string>("get_language"),
      invoke<string>("get_theme"),
    ])
      .then(([llamaPath, language, theme]) => {
        if (cancelled || requestId !== loadRequestIdRef.current || editVersion !== editVersionRef.current) {
          return;
        }

        const nextValues = {
          llamaPath: llamaPath ?? "",
          language: normalizeLanguage(language),
          theme: normalizeTheme(theme),
        };
        setPendingLlamaPath(nextValues.llamaPath);
        setPendingLanguage(nextValues.language);
        setPendingTheme(nextValues.theme);
        setInitialValues(nextValues);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled || requestId !== loadRequestIdRef.current) {
          return;
        }

        setLoadFailed(true);
        setMessage({ tone: "error", text: `${t("settings.loadFailed")}: ${getErrorMessage(error)}` });
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const hasChanges = useMemo(
    () =>
      pendingLlamaPath !== initialValues.llamaPath ||
      pendingLanguage !== initialValues.language ||
      pendingTheme !== initialValues.theme,
    [initialValues, pendingLanguage, pendingLlamaPath, pendingTheme]
  );

  const controlsDisabled = loading || saving || loadFailed;

  const pathHint = !loading && !pendingLlamaPath.trim()
    ? { tone: "warning" as const, text: t("settings.emptyPathHint") }
    : null;

  const markUserEdited = () => {
    editVersionRef.current += 1;
  };

  const handleDetectPaths = async () => {
    if (controlsDisabled) return;

    setDetecting(true);
    setMessage({ tone: "info", text: t("settings.detecting") });
    try {
      const paths = await invoke<string[]>("detect_llama_cpp_paths_cmd");
      if (paths.length > 0) {
        markUserEdited();
        setPendingLlamaPath(paths[0]);
        setMessage({ tone: "success", text: t("settings.pathDetected") });
      } else {
        setMessage({ tone: "warning", text: t("settings.noPathFound") });
      }
    } catch (error) {
      setMessage({ tone: "error", text: `${t("settings.detectFailed")}: ${getErrorMessage(error)}` });
    } finally {
      setDetecting(false);
    }
  };

  const handleSelectFile = async () => {
    if (controlsDisabled) return;

    try {
      const path = await invoke<string>("select_file");
      if (path) {
        markUserEdited();
        setPendingLlamaPath(path);
        setMessage({ tone: "success", text: t("settings.pathSelected") });
      }
    } catch (error) {
      if (error !== "User cancelled") {
        setMessage({ tone: "error", text: `${t("settings.fileSelectError")}: ${getErrorMessage(error)}` });
      }
    }
  };

  const handleSave = async () => {
    if (loading || saving || loadFailed) return;

    const languageToSave = normalizeLanguage(pendingLanguage);
    setSaving(true);
    setMessage(null);
    try {
      await invoke("save_all_settings", {
        llamaCppPath: pendingLlamaPath,
        language: languageToSave,
        theme: pendingTheme,
      });
      applyTheme(pendingTheme);
      if (i18n.language !== languageToSave) {
        await i18n.changeLanguage(languageToSave);
      }
      onLanguageSaved(languageToSave);
      setInitialValues({ llamaPath: pendingLlamaPath, language: languageToSave, theme: pendingTheme });
      onClose();
    } catch (error) {
      setMessage({ tone: "error", text: `${t("settings.saveFailed")}: ${getErrorMessage(error)}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l bg-background shadow-2xl"
          >
            <div className="flex items-start justify-between border-b px-5 py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-primary" />
                  <h2 id={titleId} className="text-base font-semibold">{t("settings.title")}</h2>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{t("settings.description")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("actions.close")}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-4">
                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="space-y-1">
                    <label htmlFor={pathInputId} className="block text-sm font-semibold">{t("settings.llamaCppPath")}</label>
                    <p className="text-xs leading-5 text-muted-foreground">{t("settings.llamaCppGlobalDesc")}</p>
                  </div>

                  <div className="mt-4 space-y-3">
                    <input
                      id={pathInputId}
                      value={pendingLlamaPath}
                      onChange={(event) => {
                        markUserEdited();
                        setPendingLlamaPath(event.target.value);
                        setMessage(null);
                      }}
                      placeholder={t("settings.noPathSet")}
                      disabled={controlsDisabled}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-xs font-mono outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSelectFile}
                        disabled={controlsDisabled}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t("settings.selectFile")}
                      </button>
                      <button
                        type="button"
                        onClick={handleDetectPaths}
                        disabled={controlsDisabled || detecting}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        {detecting ? t("settings.detecting") : t("settings.detectPaths")}
                      </button>
                    </div>
                    {message ? <MessageBox message={message} /> : pathHint ? <MessageBox message={pathHint} /> : null}
                  </div>
                </section>

                <section className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold">{t("settings.preferences")}</h3>
                    <p className="text-xs leading-5 text-muted-foreground">{t("settings.preferencesDesc")}</p>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("settings.language")}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {languageOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={pendingLanguage === option.value}
                            onClick={() => {
                              markUserEdited();
                              setPendingLanguage(option.value);
                            }}
                            disabled={controlsDisabled}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
                              pendingLanguage === option.value
                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {t(option.labelKey)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("settings.theme")}</div>
                      <div className="grid grid-cols-3 gap-2">
                        {themeOptions.map((option) => {
                          const Icon = option.icon;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={pendingTheme === option.value}
                              onClick={() => {
                                markUserEdited();
                                setPendingTheme(option.value);
                              }}
                              disabled={controlsDisabled}
                              className={cn(
                                "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
                                pendingTheme === option.value
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              {t(option.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
              <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {loading ? t("settings.loadingSettings") : hasChanges ? t("settings.unsavedChanges") : t("settings.noUnsavedChanges")}
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
                  {t("actions.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || saving || loadFailed}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? t("actions.updating") : t("actions.save")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
