import { parseLogCommand } from '../src/service/runtime/log-input.js';
import { podRef } from './resource-fixtures.js';
import type { LogCommand } from '../src/shared/logs.js';

export function logCommand(extra: Partial<LogCommand> = {}): LogCommand {
  return parseLogCommand({ context: 'primary', name: 'demo', appNamespace: 'argocd', resource: podRef, container: 'main', ...extra });
}
export function logPacket(content: string, timestamp = '2026-10-18T00:00:00.123456789Z') {
  return JSON.stringify({ result: { content, podName: 'demo', timeStampStr: timestamp } }) + '\n';
}
export const lastPacket = JSON.stringify({ result: { last: true } }) + '\n';
