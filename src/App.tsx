import { useEffect } from "react";
import { useConfigStore } from "./stores/configStore";
import { useWindowActivityListener } from "./stores/windowActivityStore";
import Layout from "./components/Layout";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider } from "./contexts/ThemeProvider";

function App() {
  useWindowActivityListener();

  // Global unhandled rejection handler
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      console.error("[GLOBAL UNHANDLED REJECTION]", e.reason);
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  useEffect(() => {
    invoke("get_configs")
      .then((configs) => {
        useConfigStore.getState().loadConfigs(configs as any);
      })
      .catch((e) => console.error("Failed to load configs:", e));
  }, []);

  return (
    <ThemeProvider>
      <Layout />
    </ThemeProvider>
  );
}

export default App;
