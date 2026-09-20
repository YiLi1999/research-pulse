import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config/index.js';
import { getConcernEngine } from './concernEngine.js';
import { createConcernService } from './concernService.js';

test('trend analysis never uses owner API or Codex configuration when visitor credentials are missing', async t => {
  const originalTrends = { ...config.trends }, originalLlm = { ...config.llm };
  t.after(() => { Object.assign(config.trends, originalTrends); Object.assign(config.llm, originalLlm); });
  Object.assign(config.llm, { apiKey: 'old-summary-secret', baseUrl: 'https://old.invalid/v1', model: 'old-model' });
  config.trends.api = { baseUrl: 'https://owner.example.com/v1', apiKey: 'owner-trend-secret', model: 'owner-model', concurrency: 4 };
  for (const provider of ['api', 'codex']) {
    config.trends.provider = provider;
    const engine = await getConcernEngine();
    assert.equal(engine.provider, 'api'); assert.equal(engine.available, false);
    assert.equal(engine.requiresConfiguration, true); assert.equal(engine.model, '');
    assert.match(engine.error, /自己的 API/); assert.equal(engine.chat, undefined);
    assert.doesNotMatch(JSON.stringify(engine), /old-summary-secret|owner-trend-secret|owner-model|owner.example/);
    const service = createConcernService({ loadPapers: async () => [], loadState: async () => ({}), getEngine: async () => engine });
    await assert.rejects(service.start({}), error => error.statusCode === 503 && /API/.test(error.message));
    assert.equal((await service.getFields()).coverage.recentCount, 0);
  }
});

test('visitor API sends only visitor endpoint, model, key and selected batch budget', async t => {
  const original = { ...config.trends }; t.after(() => Object.assign(config.trends, original));
  config.trends.provider = 'api';
  config.trends.api = { baseUrl: 'https://owner.example.com/v1', apiKey: 'owner-secret', model: 'owner-model' };
  t.mock.method(globalThis, 'fetch', () => { throw new Error('The unpinned global fetch must not be used.'); });
  const engine = await getConcernEngine({ baseUrl: 'https://visitor.example.com/v1///', apiKey: 'visitor-secret', model: 'visitor-model' }, { fetch: async (url, options) => {
    assert.equal(url, 'https://visitor.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer visitor-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'visitor-model'); assert.equal(body.max_tokens, 6000);
    assert.equal(body.temperature, 0.2); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(body.response_format.type, 'json_object');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  } });
  assert.equal(engine.available, true); assert.equal(engine.concurrency, 2);
  assert.deepEqual(await engine.chat([{ role: 'user', content: 'Return JSON.' }], { maxTokens: 6000, timeoutMs: 2000 }), { ok: true });
  assert.deepEqual(engine.signature, ['visitor-api', 'https://visitor.example.com/v1', 'visitor-model']);
  assert.doesNotMatch(JSON.stringify(engine), /visitor-secret|owner-secret/);
});

test('partial visitor configuration fails before a request and never falls back to owner credentials', async () => {
  await assert.rejects(getConcernEngine({ baseUrl: 'https://api.example.com/v1', model: 'model' }), error => error.statusCode === 400);
});

test('provider errors and invalid JSON never expose a visitor key', async () => {
  const api = { baseUrl: 'https://api.example.com/v1', apiKey: 'visitor-secret', model: 'model' };
  const cases = [
    async () => new Response(JSON.stringify({ error: { message: 'visitor-secret insufficient balance' } }), { status: 429 }),
    async () => new Response('visitor-secret invalid JSON'),
    async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"visitor-secret": broken}' } }] })),
    async () => { throw Object.assign(new Error('visitor-secret network details'), { reason: 'network' }); }
  ];
  for (const fetch of cases) {
    const engine = await getConcernEngine(api, { fetch });
    await assert.rejects(engine.chat([], { retries: 0 }), error => {
      assert.doesNotMatch(error.message, /visitor-secret/);
      assert.doesNotMatch(JSON.stringify(error), /visitor-secret/);
      return true;
    });
  }
});
