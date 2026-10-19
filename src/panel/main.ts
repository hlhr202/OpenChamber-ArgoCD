import { connectHost, type HostReadyContext } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { Envelope } from '../shared/contracts.js';
import { ServiceGateway } from './gateway.js';
import { mountWorkspace } from './workspace.js';
import type { PanelRequestOptions } from './task-client.js';

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root')!;
let ready: HostReadyContext | undefined;
let workspace: ReturnType<typeof mountWorkspace> | undefined;
const gateway = new ServiceGateway(async <T>(path: string, query?: Record<string, string>, options?: PanelRequestOptions): Promise<Envelope<T>> => {
  const result = await host.serviceRequest({ method: options?.method ?? 'GET', path, ...(query ? { query } : {}), ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  return JSON.parse(result.body) as Envelope<T>;
}, (reason) => { workspace?.dispose(); if (ready) workspace = mountWorkspace(root, gateway.bind(), host, ready, reason, { autoRestore: false }); });
const disposers = [host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  const changed = ready && (ready.directory !== context.directory || ready.surface !== context.surface);
  ready = context;
  if (changed) { gateway.invalidate(); workspace?.dispose(); workspace = undefined; }
  if (!workspace) workspace = mountWorkspace(root, gateway.bind(), host, context);
  else { workspace.setSession(context.session); workspace.setHostLocale(context.locale); }
}), host.onDirectory((directory) => {
  if (!ready || ready.directory === directory) return;
  gateway.invalidate(); workspace?.dispose(); ready = { ...ready, directory }; workspace = mountWorkspace(root, gateway.bind(), host, ready, '宿主项目/目录变化，旧数据与预览已清除。');
}), host.onSession((session) => { if (ready) ready = { ...ready, session }; workspace?.setSession(session); })];
window.addEventListener('pagehide', () => { workspace?.dispose(); gateway.invalidate(); for (const dispose of disposers) dispose(); host.dispose(); }, { once: true });
