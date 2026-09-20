import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisitorClient } from './visitorClient.js';

const api = { baseUrl: 'https://provider.example/v1', apiKey: 'visitor-test-secret', model: 'visitor-model' };
const paper = id => ({ id, title: `Quantum computer ${id}`, abstract: 'Quantum error correction and logical gates.', date: '2026-09-20' });
function memory() {
  const records = new Map();
  return { records, async get(key) { return records.get(key); }, async set(key, value) { records.set(key, structuredClone(value)); return true; } };
}
function answer(messages) {
  const input = JSON.parse(messages.at(-1).content);
  return input.papers ? { papers: input.papers.map(p => ({ id: p.id, questions: [{ question: '如何改善量子纠错？', focus: p.title }] })) }
    : { summary: '研究纠错性能。', questions: [{ question: '如何改善量子纠错？', focus: '共同证据', groupIds: input.candidates.map(c => c.id) }] };
}
function fixture(papers = [paper('one'), paper('two')], chat = answer) {
  const calls = [], storage = memory(), preferenceMap = new Map();
  let date = new Date('2026-09-20T10:00:00Z');
  const deps = { storage, now: () => date, preferences: {
    getItem: key => preferenceMap.get(key), setItem: (key, value) => preferenceMap.set(key, value)
  }, fetch: async (url, init) => {
    if (url === '/data/dashboard.json') return Response.json({ papers, state: { lastRefreshAt: date.toISOString() }, config: { timezone: 'Asia/Shanghai' } });
    assert.equal(url, '/api/chat');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body); calls.push(body);
    assert.deepEqual(body.api, api);
    assert.ok(body.options.maxTokens <= 16000);
    return Response.json({ result: await chat(body.messages, init.signal) });
  } };
  return { client: createVisitorClient(deps), deps, calls, storage, preferenceMap, setDate: next => { date = new Date(next); } };
}
async function request(client, path, body, signal) {
  return client.apiFetch(path, body ? { method: 'POST', body: JSON.stringify(body), signal } : {}).then(async response => ({ status: response.status, value: await response.json() }));
}
async function finish(client, job) {
  for (let i = 0; i < 200 && job.status === 'running'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    job = (await request(client, '/api/trends/jobs/' + job.id)).value;
  }
  assert.notEqual(job.status, 'running'); return job;
}

test('Vercel browse, selection and cache checks make no AI calls; only supplied visitor credentials can start', async () => {
  const f = fixture();
  const initial = (await request(f.client, '/api/trends/options?majorField=quantum')).value;
  assert.equal(initial.coverage.selectedCount, 2); assert.equal(initial.llmAvailable, false);
  assert.equal((await request(f.client, '/api/trends/options', { api })).value.incremental.pending, 2);
  assert.equal((await request(f.client, '/api/trends/analyze', {})).status, 400);
  assert.equal(f.calls.length, 0);
  const job = await finish(f.client, (await request(f.client, '/api/trends/analyze', { api })).value);
  assert.equal(job.status, 'completed'); assert.equal(job.report.mode, 'llm');
  assert.equal(f.calls.length, 2);
  assert.equal(api.apiKey, 'visitor-test-secret', 'runtime only clears its own copy');
  assert.ok(!JSON.stringify([...f.storage.records]).includes(api.apiKey));
  assert.ok(!JSON.stringify([...f.preferenceMap]).includes(api.apiKey));
  const restarted = createVisitorClient(f.deps);
  assert.equal((await request(restarted, '/api/trends/options')).value.report, null);
  assert.equal((await request(restarted, '/api/trends/options', { api })).value.report.mode, 'llm');
  assert.equal((await request(restarted, '/api/trends/analyze', { api })).value.cached, true);
  assert.equal(f.calls.length, 2, 'persistent result needs no server job or repeated paid request');
  assert.equal((await request(fixture().client, '/api/trends/options', { api })).value.report, null);
});

test('Vercel failed batch preserves completed notes and next day reads only new papers', async () => {
  let batches = 0, fail = true;
  const papers = Array.from({ length: 40 }, (_, i) => paper(`entry-${i}`));
  const f = fixture(papers, messages => {
    if (JSON.parse(messages.at(-1).content).papers && ++batches === 2 && fail) throw new Error('simulated request failure');
    return answer(messages);
  });
  const job = await finish(f.client, (await request(f.client, '/api/trends/analyze', { api })).value);
  assert.equal(job.status, 'failed');
  const retryOptions = (await request(f.client, '/api/trends/options', { api })).value;
  assert.equal(retryOptions.report, null); assert.equal(retryOptions.incremental.cached, 35);
  fail = false; f.calls.length = 0;
  const resumed = createVisitorClient(f.deps);
  const retried = await finish(resumed, (await request(resumed, '/api/trends/analyze', { api })).value);
  assert.equal(retried.status, 'completed');
  assert.equal(retried.report.incremental.analyzed, 5);
  assert.equal(f.calls.filter(c => JSON.parse(c.messages.at(-1).content).papers).length, 1);
  f.setDate('2026-09-21T10:00:00Z'); papers.push({ ...paper('new'), date: '2026-09-21' });
  const next = createVisitorClient(f.deps);
  const changed = await finish(next, (await request(next, '/api/trends/analyze', { api })).value);
  assert.equal(changed.report.incremental.analyzed, 1); assert.equal(changed.report.incremental.cached, 40);
});

test('aborting browser job prevents later synthesis/model requests and credentials never enter results', async () => {
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const f = fixture(undefined, async (_messages, signal) => {
    announce();
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const controller = new AbortController();
  const job = (await request(f.client, '/api/trends/analyze', { api }, controller.signal)).value;
  await started; controller.abort();
  const stopped = await finish(f.client, job);
  assert.equal(stopped.status, 'failed'); assert.match(stopped.error, /已停止/);
  assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(stopped).includes(api.apiKey));
});

test('Vercel keyword settings stay in each browser and never mutate shared dataset', async () => {
  const papers = [paper('one')], before = structuredClone(papers), f = fixture(papers);
  const saved = await f.client.apiFetch('/api/scoring', { method: 'PUT', body: JSON.stringify({ keywordWeights: { quantum: 10 } }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).papers[0].recommendation.score, 30);
  assert.deepEqual(papers, before);
  assert.deepEqual((await request(createVisitorClient(f.deps), '/api/scoring')).value.keywordWeights, { quantum: 10 });
  assert.notDeepEqual((await request(fixture().client, '/api/scoring')).value.keywordWeights, { quantum: 10 });
  assert.equal(f.calls.length, 0);
});
