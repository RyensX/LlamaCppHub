import { useEffect } from "react";
import { create } from "zustand";

import { refreshRuntimeNow } from "@/lib/runtimeRefresh";

type WindowActivityState = {
  active: boolean;
  setActive: (active: boolean) => void;
};

function computeWindowActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

export const useWindowActivityStore = create<WindowActivityState>((set, get) => ({
  active: typeof document === "undefined" ? true : computeWindowActive(),
  setActive: (active) => {
    const wasActive = get().active;
    set({ active });

    if (!wasActive && active) {
      refreshRuntimeNow();
    }
  },
}));

export function isWindowActive() {
  return useWindowActivityStore.getState().active;
}

export function useWindowActivityListener() {
  useEffect(() => {
    const updateActivity = () => {
      useWindowActivityStore.getState().setActive(computeWindowActive());
    };

    updateActivity();
    window.addEventListener("focus", updateActivity);
    window.addEventListener("blur", updateActivity);
    document.addEventListener("visibilitychange", updateActivity);

    return () => {
      window.removeEventListener("focus", updateActivity);
      window.removeEventListener("blur", updateActivity);
      document.removeEventListener("visibilitychange", updateActivity);
    };
  }, []);
}
