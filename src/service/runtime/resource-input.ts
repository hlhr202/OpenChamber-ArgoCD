import type { ResourceReference } from '../../shared/resources.js';
import { operationUrl } from '../argocd/transport.js';
import { ServiceError } from '../security/errors.js';

export function parseResourceInput(value: unknown, purpose: 'resource' | 'events'): ResourceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
  const input = value as Record<string, unknown>;
  const keys = ['group', 'version', 'kind', 'namespace', 'name', 'uid'] as const;
  if (Object.keys(input).some((key) => !keys.includes(key as typeof keys[number]))) throw new ServiceError('BAD_REQUEST', 400);
  const ref = Object.fromEntries(keys.map((key) => {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceError('BAD_REQUEST', 400);
    return [key, value];
  })) as unknown as ResourceReference;
  if (!/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(ref.kind) || (ref.uid && !/^[A-Za-z0-9_.:-]{1,128}$/.test(ref.uid))) throw new ServiceError('BAD_REQUEST', 400);
  const app = { name: 'validation', appNamespace: 'validation' };
  if (purpose === 'resource') operationUrl('https://validation.invalid', 'resource', { ...app, group: ref.group, kind: ref.kind, version: ref.version, namespace: ref.namespace, resourceName: ref.name });
  else operationUrl('https://validation.invalid', 'events', { ...app, namespace: ref.namespace, resourceName: ref.name, resourceUID: ref.uid });
  return ref;
}
