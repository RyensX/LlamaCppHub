import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhTranslation from "./locales/zh/translation.json";
import enTranslation from "./locales/en/translation.json";

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zhTranslation },
    en: { translation: enTranslation },
  },
  lng: undefined,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
