type RefreshCallback = () => void | Promise<void>;

const callbacks = new Set<RefreshCallback>();

export function registerRuntimeRefresh(callback: RefreshCallback) {
  callbacks.add(callback);
  return () => callbacks.delete(callback);
}

export function refreshRuntimeNow() {
  for (const callback of Array.from(callbacks)) {
    void Promise.resolve(callback()).catch((error) => {
      console.warn("Runtime refresh failed", error);
    });
  }
}
