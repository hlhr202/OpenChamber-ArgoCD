import type { HostClient, JsonValue } from '@openchamber/sdk';
import { navigationKey, navigationState, type NavigationState } from './navigation-state.js';

type Storage = HostClient['storage'];
const writes = new WeakMap<Storage, Map<string, Promise<void>>>();

/** Serialize writes from successive mounts, and wait for a previous mount's
 * final save before reading. A failed save never clears the existing value. */
export function navigationStorage(storage: Storage, directory: string, device: boolean, failed: () => void, debounceMs = 150) {
  const key = navigationKey(directory); const options = { scope: device ? 'device' as const : 'instance' as const };
  let queue = writes.get(storage); if (!queue) { queue = new Map(); writes.set(storage, queue); }
  const slot = `${options.scope}:${key}`;
  let timer: ReturnType<typeof setTimeout> | undefined; let pending: NavigationState | null = null; let previous = ''; let closed = false;
  function flush(): Promise<void> {
    if (timer) clearTimeout(timer); timer = undefined;
    if (!pending) return queue!.get(slot) ?? Promise.resolve();
    const state = pending; pending = null; const serialized = JSON.stringify(state);
    if (serialized === previous) return queue!.get(slot) ?? Promise.resolve();
    previous = serialized;
    const write = async () => storage.set(key, JSON.parse(serialized) as JsonValue, options);
    const prior = queue!.get(slot);
    const next = (prior ? prior.then(write) : write()).catch(() => { previous = ''; failed(); });
    queue!.set(slot, next);
    void next.then(() => { if (queue!.get(slot) === next) queue!.delete(slot); });
    return next;
  }
  return {
    async load(): Promise<NavigationState | null> {
      try { await queue!.get(slot); const value = await storage.get(key, options); return navigationState(value, directory); }
      catch { failed(); return null; }
    },
    save(value: NavigationState): void {
      if (closed) return;
      const state = navigationState(value, directory); if (!state) { failed(); return; }
      pending = state; if (timer) clearTimeout(timer); timer = setTimeout(() => { void flush(); }, debounceMs);
    },
    flush,
    close(): void { if (closed) return; closed = true; void flush(); },
  };
}
