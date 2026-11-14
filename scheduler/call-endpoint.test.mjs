import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { callPushTick } from './call-endpoint.mjs';

const env = { FREGAPP_HTTP_PUSH_URL: 'https://example.test/api/internal/push/tick', FREGAPP_HTTP_PUSH_HMAC_SECRET: 'test-secret-only-012345678901234567890' };
const quiet = { log() {}, error() {} };

test('invalid configuration never calls the transport or logs credentials', async () => {
  for (const value of ['', 'http://example.test/api/internal/push/tick', `${env.FREGAPP_HTTP_PUSH_URL}?extra=1`, 'https://user:password@example.test/api/internal/push/tick']) {
    let calls = 0; const messages = [];
    assert.equal(await callPushTick({ env: { ...env, FREGAPP_HTTP_PUSH_URL: value }, fetchRequest: async () => { calls++; }, log: { error: m => messages.push(m) } }), false);
    assert.equal(calls, 0);
    assert.equal(messages.length, 1);
    assert.ok(!messages.join('').includes(env.FREGAPP_HTTP_PUSH_HMAC_SECRET));
    assert.ok(!messages.join('').includes(value || 'password'));
  }
  assert.equal(await callPushTick({ env: { ...env, FREGAPP_HTTP_PUSH_HMAC_SECRET: 'short' }, log: quiet }), false);
});

test('successful signed call stops immediately and forbids redirects', async () => {
  let calls = 0;
  const ok = await callPushTick({ env, clock: () => 123456789, log: quiet, fetchRequest: async (url, request) => {
    calls++;
    assert.equal(url, env.FREGAPP_HTTP_PUSH_URL);
    assert.equal(request.method, 'POST'); assert.equal(request.body, '{}'); assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    const h = request.headers;
    assert.match(h['x-fregapp-nonce'], /^[0-9a-f-]{36}$/);
    const hash = createHash('sha256').update('{}').digest('hex');
    const canonical = `v1\nPOST\n${url}\n/api/internal/push/tick\n123456789\n${h['x-fregapp-nonce']}\n${hash}`;
    assert.equal(h['x-fregapp-signature'], createHmac('sha256', env.FREGAPP_HTTP_PUSH_HMAC_SECRET).update(canonical).digest('hex'));
    return { status: 200 };
  } });
  assert.equal(ok, true); assert.equal(calls, 1);
});

test('network failure and conflict retry with increasing timestamps even when clock moves backwards', async () => {
  const times = [1000, 1000, 999]; const requests = [];
  assert.equal(await callPushTick({ env, clock: () => times.shift(), log: quiet, fetchRequest: async (_, r) => {
    requests.push(r.headers);
    if (requests.length === 1) throw new Error('synthetic failure');
    return { status: requests.length === 2 ? 409 : 200 };
  } }), true);
  assert.deepEqual(requests.map(r => r['x-fregapp-timestamp']), ['1000', '1001', '1002']);
  assert.equal(new Set(requests.map(r => r['x-fregapp-nonce'])).size, 3);
  assert.equal(new Set(requests.map(r => r['x-fregapp-signature'])).size, 3);
});

test('persistent failures stop at three attempts without leaking provider errors', async () => {
  let calls = 0; const messages = [];
  assert.equal(await callPushTick({ env, log: { error: m => messages.push(m) }, fetchRequest: async () => {
    calls++; throw new Error(env.FREGAPP_HTTP_PUSH_HMAC_SECRET);
  } }), false);
  assert.equal(calls, 3); assert.equal(messages.length, 1);
  assert.ok(!messages[0].includes(env.FREGAPP_HTTP_PUSH_HMAC_SECRET));
});
