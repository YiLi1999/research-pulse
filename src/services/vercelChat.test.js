import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createChatHandler } from '../../api/chat.js';
import { config } from '../config/index.js';
import { getConcernEngine } from './concernEngine.js';
import { createVisitorFetch } from './visitorApi.js';

const visitorApi = { baseUrl: 'https://visitor.example.com/v1/', apiKey: 'visitor-only-secret', model: 'visitor-model' };
const input = { api: visitorApi, messages: [{ role: 'user', content: 'Analyze public papers.' }] };
function request(body = input) {
  return { method: 'POST', headers: { host: 'papers.example.com', origin: 'https://papers.example.com', 'content-type': 'application/json' }, body };
}
function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
function transport({ lookup, status = 200, body = '{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}', inspect = () => {} } = {}) {
  const state = { calls: 0, lookups: 0 };
  const fetch = createVisitorFetch({
    lookup: async hostname => {
      state.lookups++;
      return lookup ? lookup(hostname) : [{ address: '93.184.216.34', family: 4 }];
    },
    request: (url, options, callback) => {
      state.calls++;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = sent => {
        inspect(url, options, sent);
        queueMicrotask(() => {
          const incoming = Readable.from([Buffer.from(body)]);
          incoming.statusCode = status;
          incoming.headers = { location: 'https://127.0.0.1/visitor-only-secret' };
          callback(incoming);
        });
      };
      return req;
    }
  });
  return { state, handler: createChatHandler({ getEngine: api => getConcernEngine(api, { fetch }) }) };
}

test('Vercel real engine sends only visitor credentials through pinned HTTPS and never owner API or Codex settings', async t => {
  const originalLlm = { ...config.llm }, originalTrends = { ...config.trends };
  t.after(() => { Object.assign(config.llm, originalLlm); Object.assign(config.trends, originalTrends); });
  Object.assign(config.llm, { apiKey: 'owner-summary-secret', model: 'owner-summary-model', baseUrl: 'https://owner.example.com/v1' });
  Object.assign(config.trends, { provider: 'codex', api: { apiKey: 'owner-trend-secret', model: 'owner-trend-model', baseUrl: 'https://owner.example.com/v1' } });
  const { state, handler } = transport({ inspect: (url, options, body) => {
    assert.equal(url.href, 'https://visitor.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer visitor-only-secret');
    assert.equal(options.agent, false);
    options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); });
    assert.equal(JSON.parse(body).model, 'visitor-model');
    assert.equal(JSON.parse(body).max_tokens, 6000);
    assert.doesNotMatch(body, /owner-summary|owner-trend|owner\.example/);
  } });
  const success = response();
  await handler(request({ ...input, options: { maxTokens: 6000 } }), success);
  assert.equal(success.statusCode, 200); assert.deepEqual(success.body, { result: { ok: true } });
  assert.equal(state.calls, 1); assert.equal(state.lookups, 1);
  for (const api of [undefined, null, {}, { ...visitorApi, apiKey: '' }, { ...visitorApi, model: '' }]) {
    const rejected = response();
    await handler(request({ ...input, api }), rejected);
    assert.equal(rejected.statusCode, 400);
    assert.doesNotMatch(JSON.stringify(rejected.body), /owner-summary|owner-trend|visitor-only-secret/);
  }
  assert.equal(state.calls, 1);
});

test('Vercel endpoint rejects unsafe URLs and mixed DNS answers without opening an outbound request', async () => {
  const { handler, state } = transport({ lookup: () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] });
  for (const baseUrl of [
    'http://visitor.example.com/v1', 'https://localhost/v1', 'https://169.254.169.254/v1',
    'https://[::ffff:127.0.0.1]/v1', 'https://visitor-only-secret@visitor.example.com/v1',
    'https://visitor.example.com/v1?key=visitor-only-secret', 'https://visitor.example.com/v1'
  ]) {
    const rejected = response();
    await handler(request({ ...input, api: { ...visitorApi, baseUrl } }), rejected);
    assert.equal(rejected.statusCode, 400, baseUrl);
    assert.doesNotMatch(JSON.stringify(rejected.body), /visitor-only-secret|169\.254|10\.0\.0/);
  }
  assert.equal(state.calls, 0);
});

test('Vercel provider redirects, credential echoes and malformed JSON produce safe errors and no automatic paid retry', async () => {
  for (const [status, body, expectedStatus, reason] of [
    [302, 'visitor-only-secret redirect body', 502, 'redirect'],
    [401, '{"error":{"message":"visitor-only-secret unauthorized"}}', 401, 'auth'],
    [429, '{"error":{"message":"visitor-only-secret insufficient balance"}}', 429, 'quota'],
    [429, '{"error":{"message":"visitor-only-secret rate limit"}}', 429, 'rate-limit'],
    [503, '{"error":{"message":"visitor-only-secret request failed"}}', 503, 'request'],
    [200, 'visitor-only-secret invalid JSON', 502, undefined],
    [200, '{"choices":[{"message":{"content":"{\\"visitor-only-secret\\": invalid}"}}]}', 502, undefined]
  ]) {
    const { handler, state } = transport({ status, body });
    const rejected = response(); await handler(request(), rejected);
    assert.equal(rejected.statusCode, expectedStatus);
    assert.equal(rejected.body.reason, reason);
    assert.doesNotMatch(JSON.stringify(rejected.body), /visitor-only-secret|127\.0\.0\.1/);
    assert.equal(state.calls, 1);
  }
});

test('malformed or oversized JSON bodies are rejected without exposing a key or invoking the transport', async () => {
  const { handler, state } = transport();
  for (const [body, status] of [
    ['{"api":{"apiKey":"visitor-only-secret"', 400],
    [Buffer.from('{"api":{"apiKey":"visitor-only-secret"'), 400],
    [{ ...input, messages: [{ role: 'user', content: '访客'.repeat(30000) }] }, 413],
    [{ ...input, api: { ...visitorApi, apiKey: 'visitor-only-secret\r\nInjected: header' } }, 400]
  ]) {
    const rejected = response(); await handler(request(body), rejected);
    assert.equal(rejected.statusCode, status);
    assert.doesNotMatch(JSON.stringify(rejected.body), /visitor-only-secret/);
  }
  assert.equal(state.calls, 0);
});
