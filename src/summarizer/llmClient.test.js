import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/index.js';
import { chatJson } from './llmClient.js';

test('quota failures have a safe actionable reason and do not retry', async t => {
  const originalConfig = { ...config.llm };
  t.after(() => Object.assign(config.llm, originalConfig));
  Object.assign(config.llm, { apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'test' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'test-secret 已达到 Token Plan 用量上限' } }), { status: 429 });
  });
  await assert.rejects(chatJson([{ role: 'user', content: 'test' }]), error => {
    assert.equal(error.reason, 'quota');
    assert.equal(error.statusCode, 429);
    assert.ok(!error.message.includes('test-secret'));
    return true;
  });
  assert.equal(calls, 1);
});

test('batch analysis can supply its own token budget and bounded request timeout', async t => {
  const originalConfig = { ...config.llm };
  t.after(() => Object.assign(config.llm, originalConfig));
  Object.assign(config.llm, { apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'test' });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(JSON.parse(options.body).max_tokens, 6000);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }), { status: 200 });
  });
  assert.deepEqual(await chatJson([{ role: 'user', content: 'test' }], { maxTokens: 6000, timeoutMs: 2000 }), { ok: true });
});
