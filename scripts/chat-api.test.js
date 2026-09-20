import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatHandler } from '../api/chat.js';
import { sanitizeDashboard } from './export-public-data.js';

function request(body = {}, headers = {}) {
  return { method: 'POST', headers: { host: 'papers.example.com', origin: 'https://papers.example.com',
    'content-type': 'application/json', ...headers }, body };
}
function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
const input = { api: { baseUrl: 'https://api.example.com/v1', apiKey: 'visitor-key', model: 'model' },
  messages: [{ role: 'user', content: 'Analyze these public papers.' }] };

test('one awaited chat uses visitor credentials and bounded options without retries', async () => {
  let calls = 0;
  const handler = createChatHandler({ getEngine: async api => {
    assert.deepEqual(api, input.api);
    return { available: true, chat: async (messages, options) => {
      calls++;
      assert.deepEqual(messages, input.messages);
      assert.deepEqual(options, { maxTokens: 16000, timeoutMs: 180000, retries: 0 });
      return { papers: [] };
    } };
  } });
  const res = response();
  await handler(request({ ...input, options: { maxTokens: 999999, timeoutMs: 999999 } }), res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { result: { papers: [] } });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(res.body).includes(input.api.apiKey));
});

test('cross-site, HTTP, missing credentials, and oversized requests cannot invoke an engine', async () => {
  let calls = 0;
  const handler = createChatHandler({ getEngine: async () => { calls++; throw new Error('must not run'); } });
  for (const [req, status] of [
    [request(input, { origin: 'https://other.example.com' }), 403],
    [request(input, { origin: 'http://papers.example.com' }), 403],
    [request(input, { origin: undefined }), 403],
    [request({ messages: input.messages }), 400],
    [request({ ...input, messages: [{ role: 'user', content: 'x'.repeat(160 * 1024) }] }), 413],
    [request('{malformed'), 400],
    [request(input, { 'content-type': 'text/plain' }), 415],
    [{ ...request(input), method: 'GET' }, 405]
  ]) {
    const res = response(); await handler(req, res); assert.equal(res.statusCode, status);
  }
  assert.equal(calls, 0);
});

test('unknown provider errors never expose request content or credentials', async () => {
  const handler = createChatHandler({ getEngine: async () => ({ available: true,
    chat: async () => { throw new Error('Provider echoed visitor-key and the prompt'); } }) });
  const res = response(); await handler(request(input), res);
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes('visitor-key'));
  assert.ok(!JSON.stringify(res.body).includes('prompt'));
});

test('concurrent requests keep distinct visitor keys', async () => {
  const seen = [];
  const handler = createChatHandler({ getEngine: async api => ({ available: true,
    chat: async () => { await Promise.resolve(); seen.push(api.apiKey); return { ok: true }; } }) });
  const first = response(), second = response();
  await Promise.all([handler(request(input), first), handler(request({ ...input, api: { ...input.api, apiKey: 'other-key' } }), second)]);
  assert.deepEqual(seen.sort(), ['other-key', 'visitor-key']);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200);
});

test('public export removes nested private fields and unsafe URLs', () => {
  const exported = sanitizeDashboard({ papers: [{ id: 'paper', title: 'Public title', abstract: 'Public abstract',
    authors: ['Author', { apiKey: 'private' }], url: 'https://name:secret@example.com/paper',
    pdfUrl: 'javascript:alert(1)', source: 'arxiv', summary: { apiKey: 'private' },
    recommendation: { personalWeight: 100 }, api: input.api, keywords: ['private-derived'] }],
    state: { lastRefreshAt: '2026-09-20T00:00:00Z', apiKey: 'private', arxivCollections: [{ category: 'math', count: 1, warning: 'https://secret@host' }] },
    config: { timezone: 'Asia/Shanghai', llm: input.api } });
  const encoded = JSON.stringify(exported);
  assert.ok(!/private|visitor-key|secret|javascript|personalWeight/.test(encoded));
  assert.deepEqual(exported.papers[0].authors, ['Author']);
  assert.equal(exported.papers[0].title, 'Public title');
  assert.equal(exported.config.timezone, 'Asia/Shanghai');
});
