import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConcernService } from './concernService.js';
import { createServer } from '../web/server.js';

const fixedNow = () => new Date('2026-08-31T10:00:00Z');
const sample = () => [{ id: 'example', title: 'Quantum error correction', abstract: 'Surface code decoders improve reliability.', date: '2026-08-27', source: 'arxiv' }];
const modelAnswer = { papers: [{ id: 'p1', questions: [{ question: '如何改善逻辑错误率？', focus: '改进表面码解码。' }] }] };
const visitorApi = { baseUrl: 'https://api.example.com/v1', apiKey: 'visitor-secret', model: 'test' };

async function setup(t, deps = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'research-concerns-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = { loadPapers: async () => sample(), loadState: async () => ({ lastRefreshAt: fixedNow().toISOString() }),
    now: fixedNow, storageDir: dir, hasLlmConfig: () => true, chat: async () => modelAnswer, ...deps };
  settings.getEngine ||= async () => ({ available: settings.hasLlmConfig(), provider: 'api', model: 'test', label: 'Test model',
    signature: ['test', settings.hasLlmConfig()], concurrency: 2, chat: settings.chat });
  return { service: createConcernService(settings), settings };
}

async function done(service, job, context) {
  for (let attempt = 0; attempt < 200 && job.status === 'running'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    job = service.getJob(job.id, context);
  }
  assert.equal(job.status, 'completed');
  return job;
}

test('opening options never calls AI; results survive restarts, ranking changes reuse cache, content changes invalidate it', async t => {
  let calls = 0;
  const papers = sample();
  const { service, settings } = await setup(t, { loadPapers: async () => papers, chat: async () => { calls++; return modelAnswer; } });
  const initial = await service.getOptions({});
  assert.equal(initial.report, null);
  assert.equal(calls, 0);
  const first = await done(service, await service.start({}));
  assert.equal(first.report.mode, 'llm');
  assert.equal(calls, 1);
  papers[0].recommendation = { score: 99999 };
  const restarted = createConcernService(settings);
  assert.equal((await restarted.start({})).cached, true);
  assert.equal((await restarted.getOptions({})).report.questions[0].count, 1);
  assert.equal(calls, 1);
  papers[0].abstract += ' New evidence.';
  assert.equal((await restarted.getOptions({})).report, null);
  await done(restarted, await restarted.start({}));
  assert.equal(calls, 2);
});

test('same-scope double clicks share a job; different active scopes are rejected without more AI calls', async t => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { service } = await setup(t, { chat: async () => { calls++; await gate; return modelAnswer; } });
  const [first, second] = await Promise.all([service.start({}), service.start({})]);
  assert.equal(first.id, second.id);
  assert.equal(calls, 1);
  assert.equal((await service.getOptions({})).job.id, first.id);
  await assert.rejects(service.start({ majorField: 'quantum' }), { statusCode: 409 });
  release();
  await done(service, first);
});

test('LLM failure is labeled, not cached, and a retry can succeed; missing configuration never calls AI', async t => {
  let calls = 0;
  const { service } = await setup(t, { chat: async () => { if (++calls === 1) throw new Error('test unavailable'); return modelAnswer; } });
  const failed = await done(service, await service.start({}));
  assert.equal(failed.report.mode, 'rules');
  assert.match(failed.report.warning, /AI 分析未完成/);
  assert.equal((await service.getOptions({})).report, null);
  assert.equal((await done(service, await service.start({}))).report.mode, 'llm');
  assert.equal(calls, 2);
  const offline = await setup(t, { hasLlmConfig: () => false, chat: () => { throw new Error('must not call'); } });
  assert.equal((await done(offline.service, await offline.service.start({}))).report.mode, 'rules');
});

test('HTTP integration validates hierarchy, returns job status, and redirects legacy trends to the current UI', async t => {
  const { service } = await setup(t, { hasLlmConfig: () => false });
  const server = createServer({ concerns: service }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const foreignOrigin = await fetch(url + '/api/trends/analyze', { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(foreignOrigin.status, 403);
  const formPost = await fetch(url + '/api/trends/analyze', { method: 'POST', body: 'majorField=quantum' });
  assert.equal(formPost.status, 415);
  const reboundStatus = await new Promise((resolve, reject) => {
    // fetch normalizes Host; use a raw HTTP request to exercise DNS rebinding.
    const request = httpRequest(url + '/api/trends/analyze', { method: 'POST', headers: {
      'Content-Type': 'application/json', Host: 'untrusted.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(reboundStatus, 403);
  const options = await fetch(url + '/api/trends/options?majorField=quantum&minorField=error-correction');
  const cookie = options.headers.get('set-cookie').split(';')[0];
  const context = { ownerId: cookie.slice('rp-visitor='.length) };
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  assert.equal(options.headers.get('cache-control'), 'no-store');
  assert.equal((await options.json()).coverage.selectedCount, 1);
  const invalid = await fetch(url + '/api/trends/analyze', { method: 'POST', headers, body: JSON.stringify({ api: visitorApi, majorField: 'quantum', minorField: 'gravity' }) });
  assert.equal(invalid.status, 400);
  const missingApi = await fetch(url + '/api/trends/analyze', { method: 'POST', headers, body: '{}' });
  assert.equal(missingApi.status, 400);
  const started = await fetch(url + '/api/trends/analyze', { method: 'POST', headers, body: JSON.stringify({ api: visitorApi }) });
  assert.ok([200, 202].includes(started.status));
  const job = await done(service, await started.json(), context);
  const polled = await fetch(url + '/api/trends/jobs/' + job.id, { headers: { Cookie: cookie } });
  assert.equal((await polled.json()).report.questions[0].count, 1);
  assert.equal((await fetch(url + '/api/trends/jobs/' + job.id)).status, 404);
  assert.equal((await fetch(url + '/api/trends/jobs/missing')).status, 404);
  const legacy = await fetch(url + '/trends', { redirect: 'manual' });
  assert.equal(legacy.headers.get('location'), '/?view=overview');
});

test('visitor endpoint and model changes have distinct cache identities', async t => {
  let baseUrl = 'https://first.example.com/v1', model = 'model-a', calls = 0;
  const { service } = await setup(t, { getEngine: async () => ({ available: true, provider: 'api', model,
    label: `API · ${model}`, signature: ['visitor-api', baseUrl, model], concurrency: 1,
    chat: async () => { calls++; return modelAnswer; } }) });
  await done(service, await service.start({}));
  assert.equal((await service.start({})).cached, true);
  baseUrl = 'https://second.example.com/v1';
  assert.equal((await service.getOptions({})).report, null);
  await done(service, await service.start({}));
  model = 'model-b';
  assert.equal((await service.getOptions({})).report, null);
  await done(service, await service.start({}));
  assert.equal(calls, 3);
});
