import { create } from "zustand";
import type { RunningInstance, ResourceSnapshot } from "@/types/llama-params";

interface InstanceStore {
  instances: Map<string, RunningInstance>;
  latestInstanceByConfig: Map<string, string>;
  configStatus: Map<string, RunningInstance["status"]>;
  runningCount: number;

  addInstance: (instance: RunningInstance) => void;
  updateStatus: (instanceId: string, status: RunningInstance["status"]) => void;
  updatePid: (instanceId: string, pid: number) => void;
  updateCommand: (instanceId: string, command: string) => void;
  updateServiceUrl: (instanceId: string, serviceUrl: string) => void;
  appendLog: (instanceId: string, line: string) => void;
  appendLogs: (instanceId: string, lines: string[]) => void;
  updateResource: (instanceId: string, resource: ResourceSnapshot) => void;
  addHistoryPoint: (instanceId: string, point: ResourceSnapshot) => void;
  updateResourceSample: (instanceId: string, point: ResourceSnapshot) => void;
  removeInstance: (instanceId: string) => void;
  getRunningCount: () => number;
}

export const useInstanceStore = create<InstanceStore>((set, get) => ({
  instances: new Map(),
  latestInstanceByConfig: new Map(),
  configStatus: new Map(),
  runningCount: 0,

  addInstance: (instance) =>
    set((state) => {
      const next = new Map(state.instances);
      const latestInstanceByConfig = new Map(state.latestInstanceByConfig);
      const configStatus = new Map(state.configStatus);
      next.set(instance.id, instance);
      latestInstanceByConfig.set(instance.configId, instance.id);
      configStatus.set(instance.configId, instance.status);
      return { instances: next, latestInstanceByConfig, configStatus };
    }),

  updateStatus: (instanceId, status) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (!inst) return { instances: next };

      const updated = { ...inst, status };
      next.set(instanceId, updated);

      const latestInstanceByConfig = new Map(state.latestInstanceByConfig);
      const configStatus = new Map(state.configStatus);
      const isLatest = latestInstanceByConfig.get(inst.configId) === instanceId;
      if (isLatest) {
        configStatus.set(inst.configId, status);
      }

      const runningCount = Array.from(next.values()).filter((i) => i.status === "running").length;
      return { instances: next, configStatus, runningCount };
    }),

  updatePid: (instanceId, pid) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        next.set(instanceId, { ...inst, pid });
      }
      return { instances: next };
    }),

  updateCommand: (instanceId, command) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        next.set(instanceId, { ...inst, command });
      }
      return { instances: next };
    }),

  updateServiceUrl: (instanceId, serviceUrl) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst && inst.serviceUrl !== serviceUrl) {
        next.set(instanceId, { ...inst, serviceUrl });
      }
      return { instances: next };
    }),

  appendLog: (instanceId, line) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        const logs = [...inst.logs, line].slice(-1000); // keep last 1000 lines
        next.set(instanceId, { ...inst, logs });
      }
      return { instances: next };
    }),

  appendLogs: (instanceId, lines) =>
    set((state) => {
      if (lines.length === 0) return {};
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        const logs = [...inst.logs, ...lines].slice(-1000); // keep last 1000 lines
        next.set(instanceId, { ...inst, logs });
      }
      return { instances: next };
    }),

  updateResource: (instanceId, resource) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        next.set(instanceId, { ...inst, resource });
      }
      return { instances: next };
    }),

  addHistoryPoint: (instanceId, point) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        const history = [...inst.history, point].slice(-120); // keep last 2 minutes at 1s interval
        next.set(instanceId, { ...inst, history });
      }
      return { instances: next };
    }),

  updateResourceSample: (instanceId, point) =>
    set((state) => {
      const next = new Map(state.instances);
      const inst = next.get(instanceId);
      if (inst) {
        const history = [...inst.history, point].slice(-120); // keep last 2 minutes at 1s interval
        next.set(instanceId, { ...inst, resource: point, history });
      }
      return { instances: next };
    }),

  removeInstance: (instanceId) =>
    set((state) => {
      const inst = state.instances.get(instanceId);
      const next = new Map(state.instances);
      const latestInstanceByConfig = new Map(state.latestInstanceByConfig);
      const configStatus = new Map(state.configStatus);
      next.delete(instanceId);

      if (inst && latestInstanceByConfig.get(inst.configId) === instanceId) {
        const latest = Array.from(next.values())
          .filter((i) => i.configId === inst.configId)
          .sort((a, b) => b.startedAt - a.startedAt)[0];
        if (latest) {
          latestInstanceByConfig.set(inst.configId, latest.id);
          configStatus.set(inst.configId, latest.status);
        } else {
          latestInstanceByConfig.delete(inst.configId);
          configStatus.delete(inst.configId);
        }
      }

      const runningCount = Array.from(next.values()).filter((i) => i.status === "running").length;
      return { instances: next, latestInstanceByConfig, configStatus, runningCount };
    }),

  getRunningCount: () => get().runningCount,
}));

export function selectLatestInstanceIdForConfig(configId: string | null | undefined) {
  return (state: InstanceStore) =>
    configId ? state.latestInstanceByConfig.get(configId) : undefined;
}

export function selectConfigStatus(configId: string | null | undefined) {
  return (state: InstanceStore) =>
    configId ? state.configStatus.get(configId) : undefined;
}

export function selectInstancePid(instanceId: string | null | undefined) {
  return (state: InstanceStore) =>
    instanceId ? state.instances.get(instanceId)?.pid : undefined;
}

export function selectInstanceLogCount(instanceId: string | null | undefined) {
  return (state: InstanceStore) =>
    instanceId ? state.instances.get(instanceId)?.logs.length ?? 0 : 0;
}

export function selectInstanceLogs(instanceId: string | null | undefined) {
  return (state: InstanceStore) =>
    instanceId ? state.instances.get(instanceId)?.logs : undefined;
}

export function selectInstanceServiceUrl(instanceId: string | null | undefined) {
  return (state: InstanceStore) =>
    instanceId ? state.instances.get(instanceId)?.serviceUrl : undefined;
}

export function selectInstanceResource(instanceId: string | null | undefined) {
  return (state: InstanceStore) =>
    instanceId ? state.instances.get(instanceId)?.resource : undefined;
}

export function selectInstanceHistory(instanceId: string | null | undefined) {
  return (state: InstanceStore) =>
    instanceId ? state.instances.get(instanceId)?.history : undefined;
}
