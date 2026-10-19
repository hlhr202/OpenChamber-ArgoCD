import type { ManifestSelection } from '../../shared/manifests.js';
import { ServiceError } from '../security/errors.js';

export function parseManifestSelection(value: unknown): ManifestSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['revision', 'sources'].includes(key))) throw new ServiceError('BAD_REQUEST', 400);
  const revision = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new ServiceError('BAD_REQUEST', 400);
    return value;
  };
  if (input.revision !== undefined && input.sources !== undefined) throw new ServiceError('BAD_REQUEST', 400);
  if (input.revision !== undefined) return { revision: revision(input.revision) };
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 20) throw new ServiceError('BAD_REQUEST', 400);
    const sources = input.sources.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('BAD_REQUEST', 400);
      const item = value as Record<string, unknown>;
      if (Object.keys(item).some((key) => !['position', 'revision'].includes(key)) || !Number.isSafeInteger(item.position) || Number(item.position) < 1 || Number(item.position) > 20) throw new ServiceError('BAD_REQUEST', 400);
      return { position: item.position as number, revision: revision(item.revision) };
    }).sort((a, b) => a.position - b.position);
    if (new Set(sources.map((source) => source.position)).size !== sources.length) throw new ServiceError('BAD_REQUEST', 400);
    return { sources };
  }
  return {};
}
