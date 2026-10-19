/** OpenChamber UI runtime.ts at bf977d2ed89c079ec592210d7cd0e2d649ba0636. */
export const LANGUAGES = ['en', 'de', 'fr', 'nl', 'zh-CN', 'zh-TW', 'uk', 'es', 'pt-BR', 'ko', 'pl', 'ja', 'tr', 'ar', 'he'] as const;
export type Language = typeof LANGUAGES[number];
export function isLanguage(value: unknown): value is Language { return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value); }
export function languageFor(value: unknown): Language {
  if (typeof value !== 'string') return 'en';
  const locale = value.trim().toLowerCase().replace(/_/g, '-');
  if (/^zh-(?:tw|hant)(?:-|$)/.test(locale)) return 'zh-TW';
  if (/^zh(?:-|$)/.test(locale)) return 'zh-CN';
  if (locale === 'pt' || /^pt-br(?:-|$)/.test(locale)) return 'pt-BR';
  if (/^(?:iw|he)(?:-|$)/.test(locale)) return 'he';
  if (/^(?:ua|uk)(?:-|$)/.test(locale)) return 'uk';
  const base = locale.split('-')[0];
  return base && isLanguage(base) ? base : 'en';
}
export function directionFor(language: Language): 'ltr' | 'rtl' { return language === 'ar' || language === 'he' ? 'rtl' : 'ltr'; }
