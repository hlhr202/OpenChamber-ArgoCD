import type { Envelope } from '../shared/contracts.js';
import type { PanelRequest, PanelRequestOptions } from './task-client.js';
import { t } from './i18n.js';

/** Bind each mounted view to one generation. Retired callbacks cannot even
 * issue cleanup calls through a newly connected host. Old server leases are
 * the fallback when its original socket/host is no longer reachable. */
export class ServiceGateway {
  private generation = 0; private instance = ''; private readonly epochs = new Map<string, string>();
  constructor(private readonly transport: PanelRequest, private readonly boundary: (reason: string) => void) {}
  invalidate(): void { this.generation++; this.instance = ''; this.epochs.clear(); }
  bind(): PanelRequest {
    const generation = this.generation;
    return async <T>(path: string, query?: Record<string, string>, options?: PanelRequestOptions): Promise<Envelope<T>> => {
      if (generation !== this.generation) throw new Error('Retired host view');
      const result = await this.transport<T>(path, query, options);
      if (generation !== this.generation) throw new Error('Retired response');
      if (!result.serviceInstance || !/^[a-f0-9-]{36}$/.test(result.serviceInstance)) {
        this.invalidate(); this.boundary('Service 缺少实例标识，请重启/更新扩展后重新加载。'); throw new Error('Unidentified Service');
      }
      const context = query?.context ?? (options?.body && typeof options.body === 'object' ? (options.body as { context?: string }).context : undefined);
      const changed = this.instance && this.instance !== result.serviceInstance;
      const epochChanged = context && result.identityEpoch && this.epochs.has(context) && this.epochs.get(context) !== result.identityEpoch;
      const terminal = result.ok && ['/v1/tasks', '/v1/logs'].includes(path) && result.data && typeof result.data === 'object' ? result.data as { state?: string; error?: { code?: string } } : undefined;
      const errorCode = !result.ok ? result.error.code : terminal?.state === 'failed' ? terminal.error?.code : undefined;
      const sensitive = errorCode && ['UNAUTHORIZED', 'AUTH_REQUIRED', 'CONFIG_MISSING', 'CONFIG_INVALID', 'CONTEXT_NOT_FOUND', 'NETWORK_DISABLED'].includes(errorCode);
      if (changed || epochChanged || sensitive) {
        this.invalidate(); this.instance = result.serviceInstance;
        this.boundary(changed ? 'Service 实例/进程已变化；请重新加载 contexts。' : errorCode === 'AUTH_REQUIRED' ? '现有 Argo CD 登录态已过期或无效；扩展不会登录或自动续期。请检查已有 CLI 登录态后重新加载 contexts。' : '身份/授权边界已变化或不可用；请重新加载 contexts。');
        throw new Error('Observation boundary changed');
      }
      this.instance = result.serviceInstance;
      if (context && result.identityEpoch) { if (this.epochs.size >= 128 && !this.epochs.has(context)) this.epochs.clear(); this.epochs.set(context, result.identityEpoch); }
      return result.ok ? result : { ...result, error: { ...result.error, message: t(result.error.message) } };
    };
  }
}
