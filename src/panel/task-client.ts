import type { Envelope } from '../shared/contracts.js';
import type { TaskCommand, TaskSnapshot } from '../shared/tasks.js';

export interface PanelRequestOptions { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown }
export type PanelRequest = <T>(path: string, query?: Record<string, string>, options?: PanelRequestOptions) => Promise<Envelope<T>>;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('Cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Short SDK calls, not one long proxy request. Cancellation is best-effort
 * across disconnects; the Service also enforces its independent deadline. */
export async function queryTask<T>(request: PanelRequest, command: TaskCommand, signal: AbortSignal, options: { pollMs?: number; maxWaitMs?: number } = {}): Promise<Envelope<T>> {
  if (signal.aborted) throw new Error('Cancelled');
  let id: string | undefined;
  let terminal = false;
  let cancellation: Promise<unknown> | undefined;
  const deadline = Date.now() + (options.maxWaitMs ?? 35_000);
  const cancel = async () => {
    if (id && !terminal) {
      cancellation ??= request('/v1/tasks', { context: command.context, id }, { method: 'DELETE' }).catch(() => undefined);
      await cancellation;
    }
  };
  const abort = () => { void cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const start = await request<TaskSnapshot<T>>('/v1/tasks', undefined, { method: 'POST', body: command });
    if (!start.ok) return start;
    id = start.data.id;
    let metadata = { serviceInstance: start.serviceInstance, identityEpoch: start.identityEpoch };
    let snapshot = start.data;
    while (!signal.aborted && Date.now() < deadline) {
      if (snapshot.state === 'succeeded' && snapshot.result) {
        terminal = true;
        return { ok: true, ...snapshot.result, truncated: false, ...(metadata.serviceInstance ? { serviceInstance: metadata.serviceInstance } : {}), ...(metadata.identityEpoch ? { identityEpoch: metadata.identityEpoch } : {}) };
      }
      if (snapshot.state === 'failed' || snapshot.state === 'cancelled') {
        terminal = true;
        return { ok: false, error: snapshot.error ?? { code: 'INTERNAL', message: 'Task failed.' }, sampledAt: new Date().toISOString() };
      }
      await wait(options.pollMs ?? 300, signal);
      const response = await request<TaskSnapshot<T>>('/v1/tasks', { context: command.context, id });
      if (!response.ok) return response;
      metadata = { serviceInstance: response.serviceInstance, identityEpoch: response.identityEpoch };
      snapshot = response.data;
    }
    if (signal.aborted) throw new Error('Cancelled');
    return { ok: false, error: { code: 'TIMEOUT', message: 'Background query exceeded the client deadline.' }, sampledAt: new Date().toISOString() };
  } finally {
    signal.removeEventListener('abort', abort);
    await cancel();
  }
}
