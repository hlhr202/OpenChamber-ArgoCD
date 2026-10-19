import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { getLanguage, languageFor, setLanguage, t, formatTime } from '../src/panel/i18n.js';
import { LANGUAGES, isLanguage, directionFor, message } from '../src/shared/i18n.js';
import { translations } from '../src/shared/locales/generated.js';
import { english } from '../src/panel/locales.js';
import { buildSummary } from '../src/service/domains/summary.js';
import type { SummaryEvidence } from '../src/shared/summary.js';

test('locale matching, preference allowlist, opaque template interpolation and safe fallback', () => {
  assert.equal(languageFor('zh-TW'), 'zh-TW'); assert.equal(languageFor('zh_Hans_CN'), 'zh-CN'); assert.equal(languageFor('en-US'), 'en'); assert.equal(languageFor('fr-FR'), 'fr');
  assert.equal(languageFor('zh-Hant-HK'), 'zh-TW'); assert.equal(languageFor('pt_BR'), 'pt-BR'); assert.equal(languageFor('iw-IL'), 'he'); assert.equal(languageFor('ua'), 'uk');
  for (const value of [undefined, null, {}, '', 'unknown', 'constructor', '__proto__', 'pt-PT']) assert.equal(languageFor(value), 'en');
  assert.equal(isLanguage('fr'), true); assert.equal(isLanguage('fr-FR'), false); assert.equal(directionFor('ar'), 'rtl'); assert.equal(directionFor('he'), 'rtl'); assert.equal(directionFor('ja'), 'ltr');
  setLanguage('en'); assert.equal(getLanguage(), 'en'); assert.equal(t('只读'), 'Read only'); assert.equal(t`查看应用 ${'只读'}/${'{0}<img src=x>'}`, 'View application 只读/{0}<img src=x>');
  assert.equal(t('unrecognized-value'), 'unrecognized-value'); assert.ok(formatTime('2026-10-18T00:00:00Z').length); assert.equal(formatTime('bad'), 'Unknown');
  for (const value of ['__proto__', 'constructor', 'toString']) assert.equal(t(value), value);
  setLanguage('zh-CN'); assert.equal(t('Applications'), '应用'); assert.equal(t('只读'), '只读');
});

test('all 15 OpenChamber locales have complete bundled messages with identical numbered variables', () => {
  assert.deepEqual(LANGUAGES, ['en', 'de', 'fr', 'nl', 'zh-CN', 'zh-TW', 'uk', 'es', 'pt-BR', 'ko', 'pl', 'ja', 'tr', 'ar', 'he']);
  const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
  for (const locale of LANGUAGES) {
    for (const [key, value] of Object.entries(english)) {
      const text = message(locale, key); assert.equal(typeof text, 'string'); assert.ok(text.trim(), `${locale}: ${key}`);
      assert.deepEqual(placeholders(text), placeholders(value), `${locale}: ${key}`); assert.doesNotMatch(text, /OCVAR|OCNEWLINE|⟦\d+⟧/);
      if (locale !== 'en' && locale !== 'zh-CN') assert.ok(Object.hasOwn(translations[locale], key), `${locale}: ${key}`);
    }
    assert.ok(message(locale, '查看应用 {0}/{1}', '只读', '<img>{0}').includes('只读'));
    assert.ok(message(locale, '查看应用 {0}/{1}', '只读', '<img>{0}').includes('<img>{0}'));
  }
});

test('an absent translated message falls back to English, not its authored Chinese key', () => {
  const previous = translations.fr['只读']; delete translations.fr['只读'];
  try { assert.equal(message('fr', '只读'), 'Read only'); } finally { translations.fr['只读'] = previous!; }
});

test('documentation is English except the Chinese README/language switch and relative Markdown links resolve', async () => {
  const rootFiles = (await readdir('.')).filter((name) => name.endsWith('.md'));
  const files = [...rootFiles, ...(await readdir('docs')).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)];
  assert.equal(files.length, 8);
  const { dirname, resolve } = await import('node:path');
  for (const filename of files) {
    const text = await readFile(filename, 'utf8');
    if (filename === 'README.zh-CN.md') assert.match(text, /\p{Script=Han}/u, filename);
    else assert.doesNotMatch(filename === 'README.md' ? text.replace('English | [简体中文](README.zh-CN.md)', '') : text, /\p{Script=Han}/u, filename);
    for (const [, target] of text.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
      if (!target!.includes('://')) await readFile(resolve(dirname(filename), target!), 'utf8');
    }
  }
});

test('all authored Chinese panel messages have English catalog entries, including interpolated templates', async () => {
  const missing = new Set<string>();
  for (const filename of (await readdir('src/panel')).filter((name) => name.endsWith('.ts') && name !== 'locales.ts')) {
    const source = ts.createSourceFile(filename, await readFile(`src/panel/${filename}`, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      let message: string | undefined;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) message = node.text;
      else if (ts.isTemplateExpression(node)) message = node.head.text + node.templateSpans.map((span, index) => `{${index}}${span.literal.text}`).join('');
      if (message && /\p{Script=Han}/u.test(message) && message !== '简体中文' && !english[message]) missing.add(message);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual([...missing], []);
});

test('summary language changes authored framing, not the selected evidence or confirmation contract', () => {
  const evidence: SummaryEvidence = { application: { name: 'demo', appNamespace: 'argocd' }, records: [{ kind: 'logs', sampledAt: '2026-10-18T00:00:00Z', expiresAt: '2026-10-18T00:00:00Z', source: 'selected-log-fragment', stale: true, lines: ['只读 <img src=x> {0}'] }] };
  const en = buildSummary('primary', evidence, Date.parse('2026-10-18T00:00:01Z'), 'en');
  assert.match(en.parts.join('\n'), /not sent|untrusted data|no Sync/); assert.ok(en.parts.includes(JSON.stringify(evidence.records[0]!.lines[0]))); assert.equal(en.staleRecords, 1);
  const zh = buildSummary('primary', evidence, Date.parse('2026-10-18T00:00:01Z'), 'zh-CN'); assert.match(zh.parts[0]!, /未发送/);
});
