import { ServiceError } from './errors.js';

/** Defense before generic text/key redaction. Embedded manifests must be
 * parsed first; scanning the enclosing JSON string cannot protect Secret
 * data, literal env values, args, or last-applied copies reliably. */
export function sanitizeKubernetes(value: Record<string, unknown>, rootKind = ''): Record<string, unknown> {
  let nodes = 0;
  const visit = (value: unknown, depth: number, property = ''): unknown => {
    if (++nodes > 10_000 || depth > 20) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
    if (Array.isArray(value)) {
      if (value.length > 1000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      if (property === 'env') return value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ServiceError('UPSTREAM_INVALID', 502);
        const input = entry as Record<string, unknown>;
        return visit({ ...input, ...('value' in input ? { value: '[REDACTED]' } : {}) }, depth + 1);
      });
      if (property === 'args' || property === 'command') return ['[REDACTED]'];
      return value.map((entry) => visit(entry, depth + 1));
    }
    if (value && typeof value === 'object') {
      const input = value as Record<string, unknown>;
      if (Object.keys(input).length > 1000) throw new ServiceError('RESPONSE_TOO_LARGE', 413);
      return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key,
        ((input.kind === 'Secret' || (depth === 0 && rootKind === 'Secret')) && ['data', 'stringData'].includes(key)) || key === 'annotations'
          ? key === 'annotations' && entry && typeof entry === 'object' && !Array.isArray(entry)
            ? Object.fromEntries(Object.keys(entry).map((name) => [name, '[REDACTED]'])) : '[REDACTED]'
          : visit(entry, depth + 1, key),
      ]));
    }
    return value;
  };
  return visit(value, 0) as Record<string, unknown>;
}
