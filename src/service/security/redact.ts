const sensitiveKey = /password|token|secret|authorization|cookie|private.?key|client.?key|client.?certificate|certificate-authority-data|last-applied-configuration|sshprivatekey|credential/i;
const hidden = '[REDACTED]';

export function redactResult(value: unknown, secrets: readonly string[] = []): { value: unknown; truncated: boolean } {
  let nodes = 0;
  let truncated = false;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 10_000 || depth > 20) { truncated = true; return '[OMITTED]'; }
    if (typeof item === 'string') {
      let text = item;
      for (const secret of secrets) if (secret) text = text.split(secret).join(hidden);
      text = text
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, hidden)
        .replace(/\bBearer\s+[^\s"'<>]+/gi, `Bearer ${hidden}`)
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, hidden)
        .replace(/(https?:\/\/)[^\s/@]+@/gi, `$1${hidden}@`)
        .replace(/([?&](?:token|password|secret|api[_-]?key)=)[^&#\s]*/gi, `$1${hidden}`);
      if (text.length > 4096) { truncated = true; return `${text.slice(0, 4096)}\n[TRUNCATED]`; }
      return text;
    }
    if (Array.isArray(item)) {
      if (item.length > 1000) truncated = true;
      return item.slice(0, 1000).map((entry) => visit(entry, depth + 1));
    }
    if (item && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      const isSecret = object.kind === 'Secret';
      const entries = Object.entries(object);
      if (entries.length > 1000) truncated = true;
      return Object.fromEntries(entries.slice(0, 1000).map(([key, entry]) => [
        key, sensitiveKey.test(key) || (isSecret && (key === 'data' || key === 'stringData'))
          ? hidden : visit(entry, depth + 1),
      ]));
    }
    return item;
  };
  const result = visit(value, 0);
  return { value: result, truncated };
}

export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  return redactResult(value, secrets).value;
}
