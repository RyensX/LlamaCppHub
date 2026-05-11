import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInstanceStore } from "@/stores/instanceStore";
import { useConfigStore } from "@/stores/configStore";
import type { RunningInstance } from "@/types/llama-params";

/**
 * Hook that provides instance lifecycle operations.
 * The caller is responsible for setting up Tauri event listeners
 * (instance:{id}:log, instance:{id}:exited) and resource polling.
 */
export function useInstances() {
  const addInstance = useInstanceStore((s) => s.addInstance);
  const updateStatus = useInstanceStore((s) => s.updateStatus);
  const updatePid = useInstanceStore((s) => s.updatePid);
  const updateCommand = useInstanceStore((s) => s.updateCommand);
  const removeInstance = useInstanceStore((s) => s.removeInstance);

  const createInstance = useCallback(
    (configId: string): string => {
      const instanceId = `${configId}-${Date.now()}`;
      const configName =
        useConfigStore.getState().configs.find((c) => c.id === configId)?.name || "";

      addInstance({
        id: instanceId,
        configId,
        configName,
        status: "starting",
        pid: null,
        logs: [],
        resource: { cpu: 0, gpu: 0, ram: 0, vram: 0, timestamp: Date.now() },
        history: [],
        startedAt: Date.now(),
        command: "",
      });
      updateStatus(instanceId, "starting");

      return instanceId;
    },
    [addInstance, updateStatus]
  );

  const startInstance = useCallback(
    async (configId: string): Promise<{ instanceId: string; pid: number; command: string }> => {
      const instanceId = createInstance(configId);

      const result = await invoke<{ pid: number; command: string }>("start_instance", {
        configId,
        instanceId,
      });

      updateStatus(instanceId, "running");
      updatePid(instanceId, result.pid);
      updateCommand(instanceId, result.command);

      return { instanceId, pid: result.pid, command: result.command };
    },
    [createInstance, updatePid, updateCommand]
  );

  const stopInstance = useCallback(
    async (instanceId: string) => {
      const instance = useInstanceStore.getState().instances.get(instanceId);
      if (!instance) return;

      if (instance.pid) {
        await invoke<void>("stop_instance_cmd", { pid: instance.pid }).catch(() => {});
      }
      removeInstance(instanceId);
    },
    [removeInstance]
  );

  return { createInstance, startInstance, stopInstance };
}
