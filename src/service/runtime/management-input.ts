import type { ManagementCommand } from '../../shared/management.js';
import { operationUrl } from '../argocd/transport.js';
import { ServiceError } from '../security/errors.js';

export const MANAGEMENT_OPERATIONS = ['projects', 'project', 'projectWindows', 'repositories', 'clusters', 'applicationSets', 'applicationSet', 'applicationSetChildren', 'applicationSetEvents', 'applicationWindows'] as const;
export function isManagement(command: { operation: string }): command is ManagementCommand { return (MANAGEMENT_OPERATIONS as readonly string[]).includes(command.operation); }
export function parseManagementCommand(value: unknown): ManagementCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
  const input = value as Record<string, unknown>;
  if (typeof input.operation !== 'string' || !isManagement({ operation: input.operation })) throw new ServiceError('BAD_REQUEST', 400);
  const operation = input.operation as ManagementCommand['operation'];
  if (typeof input.context !== 'string' || !input.context || input.context.length > 512 || /[\u0000-\u001f\u007f]/.test(input.context)) throw new ServiceError('BAD_REQUEST', 400);
  const keys = ['project', 'projectWindows'].includes(operation) ? ['project'] : operation === 'applicationSets' ? ['appsetNamespace'] : operation === 'applicationWindows' ? ['name', 'appNamespace'] : ['applicationSet', 'applicationSetChildren', 'applicationSetEvents'].includes(operation) ? ['name', 'appsetNamespace'] : [];
  if (Object.keys(input).some((key) => !['operation', 'context', ...keys].includes(key))) throw new ServiceError('BAD_REQUEST', 400);
  const parameters: Record<string, string> = {};
  for (const key of keys) {
    if (operation === 'applicationSets' && input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || (input[key] as string).length > 253) throw new ServiceError('BAD_REQUEST', 400);
    parameters[key] = input[key] as string;
  }
  operationUrl('https://validation.invalid', operation, parameters);
  return { operation, context: input.context, ...parameters } as ManagementCommand;
}
