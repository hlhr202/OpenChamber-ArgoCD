import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicError, ServiceError } from '../src/service/security/errors.js';
import { redact } from '../src/service/security/redact.js';

test('exceptions never expose upstream error messages', () => {
  const result = publicError(new Error('Bearer sensitive-token https://user:pass@internal/'));
  assert.equal(result.code, 'INTERNAL');
  assert.doesNotMatch(result.message, /sensitive-token|user:pass|internal\//);
  assert.equal(publicError(new ServiceError('BAD_REQUEST', 400)).status, 400);
});

test('redacts Secret objects, last-applied content and credential fields', () => {
  const result = JSON.stringify(redact({
    kind: 'Secret', data: { config: 'base64-value' }, stringData: { value: 'secret-value' },
    metadata: { annotations: { 'kubectl.kubernetes.io/last-applied-configuration': 'embedded-secret' } },
    authToken: 'auth-value', clientCertificateKeyData: 'key-value',
  }));
  assert.doesNotMatch(result, /base64-value|secret-value|embedded-secret|auth-value|key-value/);
  assert.match(result, /REDACTED/);
});

test('redacts known secrets, URL credentials, JWTs, bearer headers and private keys', () => {
  const result = JSON.stringify(redact({ message: 'opaque-value https://admin:password@example.test/?token=query-value Bearer bearer-value eyJabc.def.ghi -----BEGIN PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----' }, ['opaque-value']));
  assert.doesNotMatch(result, /opaque-value|admin:password|query-value|bearer-value|eyJabc|private-value/);
});

test('redaction bounds deep and oversized structures', () => {
  let deep: unknown = 'end';
  for (let i = 0; i < 50; i++) deep = { next: deep };
  assert.match(JSON.stringify(redact(deep)), /OMITTED/);
  assert.match(String(redact('x'.repeat(5000))), /TRUNCATED/);
});
