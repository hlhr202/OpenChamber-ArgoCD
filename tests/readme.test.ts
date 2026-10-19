import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assembleRelease, verifyRelease } from '../scripts/release.js';

test('English and Chinese READMEs stay concise, link to each other and retain packaged local assets', async () => {
  const release = await assembleRelease(); const files = verifyRelease(release.zip);
  for (const [path, other, heading] of [['README.md', 'README.zh-CN.md', 'Installation'], ['README.zh-CN.md', 'README.md', '安装']] as const) {
    const text = files.get(path)!.toString();
    assert.ok(text.split('\n').length < 90, 'Keep user-facing READMEs focused.');
    assert.ok(text.includes(`](${other})`));
    assert.match(text, /!\[[^\]]+\]\(docs\/screenshot\.png\)/);
    const installation = text.split(`## ${heading}\n\n`)[1]!.split('\n## ')[0]!;
    assert.ok(installation.includes('https://github.com/hlhr202/OpenChamber-ArgoCD'));
    assert.match(installation, /Service/);
    assert.doesNotMatch(installation, /TBD/);
    assert.equal((text.match(/^### /gm) ?? []).length, 5);
    assert.match(text, /v1\.24\.0/); assert.match(text, /v2\.2\.0/);
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target!)) continue;
      assert.ok(files.has(target!), `README link must resolve inside the release: ${target}`);
      assert.ok(files.get(target!)!.equals(await readFile(target!)), 'Ship the original linked asset.');
    }
  }
  assert.ok(files.get('docs/screenshot.png')!.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
});

test('MIT license is declared in both manifests and shipped alongside third-party notices', async () => {
  const { files } = await assembleRelease();
  assert.equal(JSON.parse(await readFile('package.json', 'utf8')).license, 'MIT');
  assert.equal(JSON.parse(files.get('package.json')!.toString()).license, 'MIT');
  const license = files.get('LICENSE')!.toString();
  assert.match(license, /^MIT License\n/);
  assert.match(license, /Copyright \(c\) 2026 OpenChamber Argo CD Observer contributors/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.ok(files.has('THIRD_PARTY_NOTICES.txt'));
});

test('both READMEs state no privacy collection and explain credential use and confirmed chat sharing', async () => {
  const en = await readFile('README.md', 'utf8'); const zh = await readFile('README.zh-CN.md', 'utf8');
  assert.match(en, /## Privacy/); assert.match(en, /does not collect personal information/);
  assert.match(en, /no telemetry, analytics, or tracking/); assert.match(en, /authenticate requests to your configured Argo CD API/);
  assert.match(en, /explicit preview and confirmation/); assert.match(en, /model provider.*own policies/);
  assert.match(en, /Browsing preferences.*OpenChamber storage/); assert.match(en, /otherwise on the connected Server/);
  assert.match(zh, /## 隐私/); assert.match(zh, /不采集个人隐私信息/);
  assert.match(zh, /不包含遥测、行为分析或追踪/); assert.match(zh, /读取已有本地凭据/);
  assert.match(zh, /明确预览并确认/); assert.match(zh, /模型服务商按各自政策处理/);
  assert.match(zh, /浏览偏好.*OpenChamber 存储/); assert.match(zh, /否则保存在所连接的 Server/);
});
