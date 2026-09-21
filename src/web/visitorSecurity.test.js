import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config/index.js';
import { getConcernEngine } from '../services/concernEngine.js';
import { createConcernService } from '../services/concernService.js';
import { createVisitorScoring } from '../services/visitorScoring.js';
import { createServer } from './server.js';
import { visitorContext } from './visitorContext.js';

const api = { baseUrl: 'https://api.example.com/v1', apiKey: 'visitor-secret-do-not-save', model: 'visitor-model' };
function answer(prompt) {
  return prompt.mode === 'paper-extraction'
    ? { papers: prompt.papers.map(paper => ({ id: paper.id,
      questions: [{ question: '如何改善逻辑错误率？', focus: '改进表面码解码。' }] })) }
    : { summary: '多篇论文共同研究表面码纠错可靠性。', questions: [{ question: '如何改善逻辑错误率？',
      focus: '两篇论文从不同解码方法研究逻辑错误率。', groupIds: prompt.candidates.map(candidate => candidate.id) }] };
}
const samplePapers = () => [
  { id: 'example', title: 'Quantum error correction', abstract: 'Surface code decoders improve reliability.', date: '2026-08-27', source: 'arxiv' },
  { id: 'example-two', title: 'Surface code decoding with correlated noise', abstract: 'Noise-aware decoding reduces logical error rates.', date: '2026-08-28', source: 'arxiv' }
];

async function fixture(t, { chat, publicOrigin = '', papers = samplePapers() } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'visitor-security-'));
  const state = { calls: 0 };
  const concerns = createConcernService({
    loadPapers: async () => papers, loadState: async () => ({}),
    now: () => new Date('2026-08-31T10:00:00Z'), storageDir: path.join(directory, 'concerns'),
    getEngine: credentials => getConcernEngine(credentials, { fetch: async (_url, options) => {
      state.calls++;
      assert.equal(options.headers.Authorization, `Bearer ${api.apiKey}`);
      const prompt = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
      const result = chat ? await chat(prompt) : answer(prompt);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    } })
  });
  const scoring = createVisitorScoring({ directory: path.join(directory, 'scoring'), defaults: async () => ({ keywordWeights: { entanglement: 1 } }) });
  const server = createServer({ concerns, scoring, dashboard: async () => ({ papers }), publicOrigin }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { concerns, scoring, directory, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function visitor(url) {
  const response = await fetch(url + '/api/trends/options');
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  return { cookie, ownerId: cookie.slice('rp-visitor='.length), options: await response.json() };
}

function jsonPost(url, endpoint, body, cookie) {
  return fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}

async function completed(service, job, ownerId) {
  for (let i = 0; i < 200 && job.status === 'running'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    job = service.getJob(job.id, { ownerId });
  }
  assert.equal(job.status, 'completed');
  return job;
}

test('missing visitor credentials never use owner keys; legacy summarize and malformed JSON do not leak secrets', async t => {
  const oldLlm = { ...config.llm }, oldTrends = { ...config.trends };
  t.after(() => { Object.assign(config.llm, oldLlm); Object.assign(config.trends, oldTrends); });
  Object.assign(config.llm, { baseUrl: 'https://owner.example.com/v1', model: 'owner-summary-model', apiKey: 'owner-summary-secret' });
  Object.assign(config.trends, { provider: 'codex', api: { baseUrl: 'https://owner.example.com/v1', model: 'owner-trend-model', apiKey: 'owner-trend-secret' } });
  const { url, state } = await fixture(t);
  const first = await visitor(url);
  assert.equal(first.options.llmAvailable, false);
  assert.equal(first.options.requiresConfiguration, true);
  assert.equal(first.options.model, '');
  assert.doesNotMatch(JSON.stringify(first.options), /owner-summary|owner-trend|owner\.example/);
  for (const endpoint of ['/api/trends/options', '/api/trends/analyze']) {
    const response = await jsonPost(url, endpoint, {}, first.cookie);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /自己的 API/);
  }
  const disabled = await jsonPost(url, '/api/papers/example/summarize', {}, first.cookie);
  assert.equal(disabled.status, 410);
  assert.doesNotMatch(await disabled.text(), /owner-summary-secret|owner-trend-secret/);
  const malformed = await fetch(url + '/api/trends/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: first.cookie }, body: '{"api":{"apiKey":"visitor-secret-do-not-save"' });
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(await malformed.text(), /visitor-secret-do-not-save/);
  assert.equal(state.calls, 0);
});

test('options never calls a model and visitor cookies isolate running jobs, reports and incremental caches', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { url, concerns, state, directory } = await fixture(t, { chat: async prompt => { await gate; return answer(prompt); } });
  const first = await visitor(url), second = await visitor(url);
  assert.notEqual(first.cookie, second.cookie);
  const options = await jsonPost(url, '/api/trends/options', { api }, first.cookie);
  assert.equal(options.status, 200);
  assert.equal(options.headers.get('cache-control'), 'no-store');
  const before = await options.json();
  assert.equal(before.llmAvailable, true); assert.equal(before.report, null);
  assert.equal(before.incremental.cached, 0); assert.equal(state.calls, 0);
  assert.doesNotMatch(JSON.stringify(before), /visitor-secret-do-not-save/);
  const started = await jsonPost(url, '/api/trends/analyze', { api }, first.cookie);
  const firstJob = await started.json();
  assert.equal(firstJob.status, 'running');
  assert.equal(state.calls, 1);
  const same = await jsonPost(url, '/api/trends/analyze', { api }, first.cookie);
  assert.equal((await same.json()).id, firstJob.id);
  assert.equal(state.calls, 1);
  const theirOptions = await jsonPost(url, '/api/trends/options', { api }, second.cookie);
  assert.equal((await theirOptions.json()).job, null);
  const denied = await fetch(url + '/api/trends/jobs/' + firstJob.id, { headers: { Cookie: second.cookie } });
  assert.equal(denied.status, 404);
  release();
  await completed(concerns, firstJob, first.ownerId);
  const own = await (await jsonPost(url, '/api/trends/options', { api }, first.cookie)).json();
  const other = await (await jsonPost(url, '/api/trends/options', { api }, second.cookie)).json();
  assert.equal(own.report.mode, 'llm'); assert.equal(own.incremental.cached, 2);
  assert.equal(own.report.synthesis.complete, true);
  assert.equal(own.report.questions[0].count, 2);
  assert.equal(state.calls, 2, 'the first visitor extracts two papers, then synthesizes their shared trend');
  assert.equal(other.report, null); assert.equal(other.incremental.cached, 0);
  const noCredentials = await (await fetch(url + '/api/trends/options', { headers: { Cookie: first.cookie } })).json();
  assert.equal(noCredentials.report, null); assert.equal(noCredentials.llmAvailable, false);
  const secondStarted = await (await jsonPost(url, '/api/trends/analyze', { api }, second.cookie)).json();
  await completed(concerns, secondStarted, second.ownerId);
  assert.equal(state.calls, 4, 'the second visitor cannot reuse the first visitor\'s extraction or report');
  const files = await readdir(directory, { recursive: true });
  const savedJson = await Promise.all(files.filter(file => file.endsWith('.json')).map(file => readFile(path.join(directory, file), 'utf8')));
  assert.ok(savedJson.length >= 6);
  assert.doesNotMatch(savedJson.join('\n'), /visitor-secret-do-not-save/);
});

test('ranking changes are isolated by visitor cookie and do not mutate shared paper data', async t => {
  const papers = [{ id: 'magic', title: 'Magic' }, { id: 'entanglement', title: 'Entanglement' }];
  const original = structuredClone(papers);
  const { url } = await fixture(t, { papers });
  const first = await visitor(url), second = await visitor(url);
  const update = await fetch(url + '/api/scoring', { method: 'PUT', headers: { Cookie: first.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ keywordWeights: { magic: 10 } }) });
  assert.equal(update.status, 200);
  const own = await (await fetch(url + '/api/papers', { headers: { Cookie: first.cookie } })).json();
  const other = await (await fetch(url + '/api/papers', { headers: { Cookie: second.cookie } })).json();
  assert.equal(own.papers[0].id, 'magic'); assert.equal(other.papers[0].id, 'entanglement');
  const otherSettings = await (await fetch(url + '/api/scoring', { headers: { Cookie: second.cookie } })).json();
  assert.deepEqual(otherSettings.keywordWeights, { entanglement: 1 });
  assert.deepEqual(papers, original);
});

function rawPost(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url + '/api/trends/options', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ api }));
  });
}

test('configured HTTPS public origin works behind a proxy while foreign origins, hosts and cross-site requests are rejected', async t => {
  const { url, state } = await fixture(t, { publicOrigin: 'https://papers.example.com' });
  const accepted = await rawPost(url, { Host: 'papers.example.com', Origin: 'https://papers.example.com' });
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers['set-cookie'][0], /Secure/);
  assert.equal(JSON.parse(accepted.text).llmAvailable, true);
  for (const headers of [
    { Host: 'papers.example.com', Origin: 'https://foreign.example.com' },
    { Host: 'foreign.example.com', Origin: 'https://papers.example.com' },
    { Host: 'papers.example.com', Origin: 'https://papers.example.com', 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'papers.example.com', Origin: 'null' }
  ]) assert.equal((await rawPost(url, headers)).status, 403);
  assert.equal(state.calls, 0);
  for (const origin of ['http://papers.example.com', 'https://papers.example.com/', 'https://user:secret@papers.example.com', 'not-a-url']) {
    assert.throws(() => visitorContext(origin), /PUBLIC_ORIGIN/);
  }
});
