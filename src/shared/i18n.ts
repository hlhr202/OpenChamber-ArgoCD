import { english, chinese } from './locales/base.js';
import { translations } from './locales/generated.js';
import { overrides } from './locales/overrides.js';
import type { Language } from './language.js';

export { LANGUAGES, languageFor, isLanguage, directionFor, type Language } from './language.js';
export function message(language: Language, key: string, ...values: unknown[]): string {
  const catalog = language === 'en' ? english : language === 'zh-CN' ? chinese : translations[language];
  const reviewed = overrides[language];
  const text = reviewed && Object.hasOwn(reviewed, key) ? reviewed[key]! : Object.hasOwn(catalog, key) ? catalog[key]! : Object.hasOwn(english, key) ? english[key]! : key;
  // A single interpolation pass keeps fetched values opaque, including braces.
  return values.length ? text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? '')) : text;
}
