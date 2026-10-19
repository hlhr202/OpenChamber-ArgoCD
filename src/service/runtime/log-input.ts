import type { LogCommand } from '../../shared/logs.js';
import { logTimestamp } from '../../shared/logs.js';
import { operationUrl } from '../argocd/transport.js';
import { ServiceError } from '../security/errors.js';
import { parseResourceInput } from './resource-input.js';

export function parseLogCommand(value: unknown): LogCommand {
  const bad = () => new ServiceError('BAD_REQUEST', 400);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  const input = value as Record<string, unknown>;
  const keys = ['context', 'name', 'appNamespace', 'resource', 'container', 'tailLines', 'follow', 'previous', 'sinceSeconds', 'sinceTime', 'untilTime'];
  if (Object.keys(input).some((key) => !keys.includes(key))) throw bad();
  if (typeof input.context !== 'string' || !input.context || input.context.length > 512 || /[\u0000-\u001f\u007f]/.test(input.context)) throw bad();
  if (typeof input.name !== 'string' || typeof input.appNamespace !== 'string') throw bad();
  operationUrl('https://validation.invalid', 'application', { name: input.name, appNamespace: input.appNamespace });
  const resource = parseResourceInput(input.resource, 'resource');
  if (resource.group || resource.kind !== 'Pod' || !resource.namespace || !resource.uid || resource.version !== 'v1') throw bad();
  if (typeof input.container !== 'string' || !/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(input.container)) throw bad();
  const tailLines = input.tailLines === undefined ? 100 : input.tailLines;
  if (!Number.isSafeInteger(tailLines) || Number(tailLines) < 1 || Number(tailLines) > 1000) throw bad();
  const follow = input.follow === undefined ? false : input.follow; const previous = input.previous === undefined ? false : input.previous;
  if (typeof follow !== 'boolean' || typeof previous !== 'boolean' || (follow && previous)) throw bad();
  if (input.sinceSeconds !== undefined && (!Number.isSafeInteger(input.sinceSeconds) || Number(input.sinceSeconds) < 1 || Number(input.sinceSeconds) > 604800)) throw bad();
  if (input.sinceSeconds !== undefined && input.sinceTime !== undefined) throw bad();
  const time = (value: unknown): string => {
    if (typeof value !== 'string' || logTimestamp(value) === null) throw bad();
    return value;
  };
  const sinceTime = input.sinceTime !== undefined ? time(input.sinceTime) : undefined;
  const untilTime = input.untilTime !== undefined ? time(input.untilTime) : undefined;
  if (sinceTime && untilTime && logTimestamp(sinceTime)! >= logTimestamp(untilTime)!) throw bad();
  return { context: input.context, name: input.name, appNamespace: input.appNamespace, resource, container: input.container, tailLines: Number(tailLines), follow, previous,
    ...(input.sinceSeconds !== undefined ? { sinceSeconds: Number(input.sinceSeconds) } : {}), ...(sinceTime ? { sinceTime } : {}), ...(untilTime ? { untilTime } : {}) };
}
