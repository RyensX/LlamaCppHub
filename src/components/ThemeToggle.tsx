import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/contexts/ThemeProvider";

type AppTheme = "light" | "dark" | "system";

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { t } = useTranslation();
  const { theme, applyTheme, saveThemeOnly } = useTheme();

  const handleToggle = async () => {
    const next: AppTheme =
      theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    try {
      await saveThemeOnly(next);
      applyTheme(next);
    } catch (e) {
      console.error("Failed to save theme:", e);
    }
  };

  const icon =
    theme === "system" ? (
      <Sun className="h-4 w-4" />
    ) : theme === "light" ? (
      <Sun className="h-4 w-4" />
    ) : (
      <Moon className="h-4 w-4" />
    );

  const title =
    theme === "system"
      ? t("theme.system")
      : theme === "light"
        ? t("theme.light")
        : t("theme.dark");

  return (
    <button
      onClick={handleToggle}
      className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors ${className}`}
      title={title}
    >
      {icon}
    </button>
  );
}
