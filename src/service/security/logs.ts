import { redactResult } from './redact.js';

/** Stateful across records: PEM keys often span multiple JSON log entries. */
export class LogRedactor {
  private privateKey = false;
  constructor(private readonly secrets: readonly string[]) {}
  clean(content: string): { content: string; truncated: boolean } {
    let text = content.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
    const begin = /-----BEGIN [^-]*PRIVATE KEY-----/.test(text); const end = /-----END [^-]*PRIVATE KEY-----/.test(text);
    if (this.privateKey || begin) { this.privateKey = !end; return { content: '[REDACTED PRIVATE KEY]', truncated: false }; }
    const result = redactResult(text, this.secrets); text = result.value as string;
    const bytes = Buffer.from(text);
    const truncated = result.truncated || bytes.length > 2048;
    return { content: truncated ? `${bytes.subarray(0, 2000).toString('utf8')} [TRUNCATED]` : text, truncated };
  }
}
