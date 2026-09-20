import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVisitorClient } from './visitorClient.js';
import { PAPER_ANALYSIS_VERSION } from '../analyzer/incrementalConcernsCore.js';

const api = { baseUrl: 'https://provider.example/v1', apiKey: 'test-only-visitor-key', model: 'test-model' };
const papers = Array.from({ length: 15 }, (_, index) => ({
  id: `cached-study-${index + 1}`,
  title: `Quantum communication study ${index + 1}`,
  abstract: `Original paper abstract ${index + 1}: entanglement distribution in a quantum network.`,
  date: '2026-09-20', source: 'arxiv'
}));

function cachedFixture(answer) {
  const records = new Map(papers.map(paper => {
    const key = 'paper:' + createHash('sha256').update(JSON.stringify({
      version: PAPER_ANALYSIS_VERSION,
      engine: ['visitor-api', api.baseUrl, api.model],
      title: paper.title, abstract: paper.abstract
    })).digest('hex');
    return [key, [{ question: '如何提高纠缠分发效率？', focus: `已缓存证据 ${paper.id}` }]];
  }));
  const calls = [], writes = [];
  const initialNotes = structuredClone([...records]);
  const dependencies = {
    storage: {
      async get(key) { return structuredClone(records.get(key)); },
      async set(key, value) { writes.push(key); records.set(key, structuredClone(value)); return true; }
    },
    preferences: { getItem() { return null; } },
    now: () => new Date('2026-09-20T10:00:00Z'),
    fetch: async (url, init) => {
      if (url === '/data/dashboard.json') return Response.json({ papers, config: { timezone: 'Asia/Shanghai' } });
      assert.equal(url, '/api/chat');
      const body = JSON.parse(init.body);
      const prompt = JSON.parse(body.messages.at(-1).content);
      calls.push(prompt);
      return Response.json({ result: await answer(prompt, calls.length) });
    }
  };
  return { client: createVisitorClient(dependencies), dependencies, records, initialNotes, calls, writes };
}

async function request(client, path, body) {
  const response = await client.apiFetch(path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  assert.ok(response.ok);
  return response.json();
}

async function analyze(client) {
  let job = await request(client, '/api/trends/analyze', { api });
  for (let attempt = 0; job.status === 'running' && attempt < 200; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    job = await request(client, '/api/trends/jobs/' + job.id);
  }
  assert.notEqual(job.status, 'running');
  return job;
}

function synthesisAnswer(prompt) {
  return { summary: '样本共同研究纠缠分发效率。', questions: [{
    question: '如何提高纠缠分发效率？', focus: '基于已缓存的逐篇研究问题。',
    groupIds: prompt.candidates.map(candidate => candidate.id)
  }] };
}

function assertOnlySynthesis(prompt) {
  assert.equal(prompt.mode, 'question-synthesis');
  assert.equal(prompt.candidates.length, 15);
  assert.equal(prompt.papers, undefined, 'cached papers must never be sent for extraction again');
  for (const paper of papers) {
    assert.ok(!JSON.stringify(prompt).includes(paper.title), 'synthesis must not resend original titles');
    assert.ok(!JSON.stringify(prompt).includes(paper.abstract), 'synthesis must not resend original abstracts');
  }
  assert.equal(typeof prompt.output_schema?.summary, 'string');
  assert.ok(Array.isArray(prompt.output_schema?.questions));
  const schema = prompt.output_schema.questions[0];
  assert.equal(typeof schema.question, 'string');
  assert.equal(typeof schema.focus, 'string');
  assert.ok(Array.isArray(schema.groupIds));
}

test('15 cached papers survive failed synthesis; explicit retry only resubmits the merge', async () => {
  const fixture = cachedFixture((prompt, call) => call === 1 ? { summary: '未提供问题数组。' } : synthesisAnswer(prompt));
  const before = await request(fixture.client, '/api/trends/options', { api });
  assert.deepEqual(before.incremental, { cached: 15, pending: 0, total: 15 });
  assert.equal(fixture.calls.length, 0, 'checking browser cache never calls the model');

  const failed = await analyze(fixture.client);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /汇总/);
  assert.match(failed.error, /缓存/);
  assert.match(failed.error, /重试|再次/);
  assert.equal(fixture.calls.length, 1, 'invalid synthesis does not trigger an automatic paid retry');
  assertOnlySynthesis(fixture.calls[0]);
  assert.deepEqual([...fixture.records], fixture.initialNotes);
  assert.deepEqual(fixture.writes, [], 'neither failed report nor paper notes are overwritten');

  const options = await request(fixture.client, '/api/trends/options', { api });
  assert.equal(options.report, null);
  assert.deepEqual(options.incremental, { cached: 15, pending: 0, total: 15 });
  assert.equal(fixture.calls.length, 1);

  const reloaded = createVisitorClient(fixture.dependencies);
  const retried = await analyze(reloaded);
  assert.equal(retried.status, 'completed');
  assert.equal(fixture.calls.length, 2);
  assertOnlySynthesis(fixture.calls[1]);
  assert.equal(retried.report.incremental.cached, 15);
  assert.equal(retried.report.incremental.analyzed, 0);
  assert.equal(retried.report.questions[0].count, 15);
  assert.equal(retried.report.coverage.supportedCount, 15);
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0], /^report:/);
  assert.deepEqual([...fixture.records].filter(([key]) => key.startsWith('paper:')), fixture.initialNotes);
});

test('wrong synthesis root fails clearly and keeps cached paper notes available', async () => {
  const fixture = cachedFixture(prompt => {
    const result = synthesisAnswer(prompt);
    return { summary: result.summary, groups: result.questions };
  });
  const failed = await analyze(fixture.client);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /汇总/);
  assert.match(failed.error, /格式/);
  assert.match(failed.error, /缓存/);
  assert.equal(fixture.calls.length, 1);
  assertOnlySynthesis(fixture.calls[0]);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual([...fixture.records], fixture.initialNotes);
  assert.equal((await request(fixture.client, '/api/trends/options', { api })).report, null);
});

test('invented synthesis group IDs fail without caching a report', async () => {
  const fixture = cachedFixture(() => ({ summary: '无效依据。', questions: [{
    question: '如何提高纠缠分发效率？', focus: '不支持的依据。', groupIds: ['g1', 'invented-group']
  }] }));
  const failed = await analyze(fixture.client);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /依据/);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual([...fixture.records], fixture.initialNotes);
  assert.equal((await request(fixture.client, '/api/trends/options', { api })).report, null);
});

test('null and malformed synthesis groups produce actionable validation errors without overwriting notes', async () => {
  for (const group of [null, 'invalid-group', [], { question: '问题？', groupIds: [] }]) {
    const fixture = cachedFixture(() => ({ summary: '无效问题结构。', questions: [group] }));
    const failed = await analyze(fixture.client);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /汇总/);
    assert.match(failed.error, /依据/);
    assert.match(failed.error, /缓存/);
    assert.doesNotMatch(failed.error, /TypeError|Cannot read/);
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.writes, []);
    assert.deepEqual([...fixture.records], fixture.initialNotes);
  }
});

test('explicitly empty synthesis is a completed uncertain result without preventing a later retry', async () => {
  const fixture = cachedFixture((prompt, call) => call === 1 ? { summary: '依据不足。', questions: [] } : synthesisAnswer(prompt));
  const empty = await analyze(fixture.client);
  assert.equal(empty.status, 'completed');
  assert.equal(empty.report.mode, 'llm');
  assert.deepEqual(empty.report.questions, []);
  assert.equal(empty.report.coverage.supportedCount, 0);
  assert.ok(empty.report.warning, 'an empty model result must explain its limitations');
  assert.equal(fixture.calls.length, 1, 'an empty response never invokes an automatic paid retry');
  assertOnlySynthesis(fixture.calls[0]);
  assert.deepEqual(fixture.writes, [], 'an empty report must not hide the explicit retry behind a cached success');
  assert.deepEqual([...fixture.records], fixture.initialNotes);

  const options = await request(fixture.client, '/api/trends/options', { api });
  assert.equal(options.report, null);
  assert.deepEqual(options.incremental, { cached: 15, pending: 0, total: 15 });
  assert.equal(fixture.calls.length, 1);
  const retried = await analyze(fixture.client);
  assert.equal(retried.status, 'completed');
  assert.equal(fixture.calls.length, 2);
  assertOnlySynthesis(fixture.calls[1]);
  assert.equal(retried.report.questions[0].count, 15);
  assert.equal(retried.report.incremental.analyzed, 0);
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0], /^report:/);
});
