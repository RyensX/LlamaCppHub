import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

/**
 * Hook that wraps useTranslation and adds persistence to the backend.
 * When language is changed, it also saves the preference to the Rust backend.
 */
export function useI18n() {
  const { t, i18n } = useTranslation();

  const changeLanguage = useCallback(
    async (lang: string) => {
      i18n.changeLanguage(lang);
      try {
        await invoke("set_language", { lang });
      } catch (e) {
        console.error("Failed to save language preference:", e);
      }
    },
    [i18n]
  );

  return { t, changeLanguage, language: i18n.language };
}
