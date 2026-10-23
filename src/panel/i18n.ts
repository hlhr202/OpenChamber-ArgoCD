import { message, type Language } from '../shared/i18n.js';
export { languageFor, directionFor, type Language } from '../shared/i18n.js';

let language: Language = 'zh-CN';
export function setLanguage(value: Language): void { language = value; }
export function getLanguage(): Language { return language; }
export function formatTime(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)) : t("Unknown");
}
/** Only call at authored UI-message boundaries. Substitutions are opaque:
 * names, URLs, revisions, logs and manifests are never translated. */
export function t(message: string): string;
export function t(parts: TemplateStringsArray, ...values: unknown[]): string;
export function t(input: string | TemplateStringsArray, ...values: unknown[]): string {
  const key = typeof input === 'string' ? input : input.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '');
  return message(language, key, ...values);
}
