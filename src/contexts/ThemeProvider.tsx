import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

type ThemeMode = "light" | "dark" | "system";

function normalizeTheme(theme: unknown): ThemeMode {
  return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
}

interface ThemeContextValue {
  theme: ThemeMode;
  /** Apply theme immediately (for runtime changes) */
  applyTheme: (mode: ThemeMode) => void;
  /** Save theme to backend without applying (for settings pending) */
  saveThemeOnly: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  applyTheme: () => {},
  saveThemeOnly: async () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const isDark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", mode);
  root.classList.toggle("dark", isDark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("system");

  useEffect(() => {
    invoke<string>("get_theme").then((th) => {
      const mode = normalizeTheme(th);
      setTheme(mode);
      applyTheme(mode);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [theme]);

  const applyThemeImmediately = (mode: ThemeMode) => {
    setTheme(normalizeTheme(mode));
  };

  const saveThemeOnly = async (mode: ThemeMode) => {
    // Save to backend without changing current applied theme
    try {
      await invoke("set_theme", { theme: normalizeTheme(mode) });
    } catch (e) {
      console.error("Failed to save theme:", e);
      throw e;
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, applyTheme: applyThemeImmediately, saveThemeOnly }}>
      {children}
    </ThemeContext.Provider>
  );
}
