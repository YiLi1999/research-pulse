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

test('oversized valid synthesis keeps the 5 most supported trends when they cover all papers, without another model request', async () => {
  const fixture = cachedFixture(prompt => ({ summary: '模型返回15个有依据的问题。', questions:
    prompt.candidates.map((candidate, index) => ({
      question: `研究问题 ${index + 1}？`, focus: '依据已缓存的逐篇分析。', count: 99999,
      groupIds: [...prompt.candidates.slice(0, index + 1).map(item => item.id), candidate.id]
    }))
  }));
  const completed = await analyze(fixture.client);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.report.questions.length, 5);
  assert.deepEqual(completed.report.questions.map(question => question.question),
    Array.from({ length: 5 }, (_, index) => `研究问题 ${15 - index}？`));
  assert.deepEqual(completed.report.questions.map(question => question.count),
    Array.from({ length: 5 }, (_, index) => 15 - index));
  for (const question of completed.report.questions) {
    assert.equal(new Set(question.papers.map(paper => paper.id)).size, question.count);
    assert.equal(question.share, Math.round(question.count / 15 * 1000) / 10);
  }
  assert.equal(completed.report.coverage.supportedCount, 15);
  assert.equal(completed.report.incremental.cached, 15);
  assert.equal(completed.report.incremental.analyzed, 0);
  assert.equal(completed.report.coverage.analyzedCount, 15);
  assert.equal(completed.report.coverage.unassignedCount, 0);
  assert.equal(completed.report.synthesis.complete, true);
  assert.match(completed.report.warning, /5/);
  assert.equal(fixture.calls.length, 1, 'local ranking must not make an additional paid merge request');
  assertOnlySynthesis(fixture.calls[0]);
  assert.deepEqual([...fixture.records].filter(([key]) => key.startsWith('paper:')), fixture.initialNotes);
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0], /^report:/);

  const options = await request(fixture.client, '/api/trends/options', { api });
  assert.deepEqual(options.report, completed.report);
  const repeated = await analyze(createVisitorClient(fixture.dependencies));
  assert.equal(repeated.status, 'completed');
  assert.equal(repeated.cached, true);
  assert.deepEqual(repeated.report, completed.report);
  assert.equal(fixture.calls.length, 1, 'repeat clicks reuse the persisted full report');
  assert.equal(fixture.writes.length, 1);
});

test('oversized synthesis validates evidence beyond the first 5 trends before reducing output', async () => {
  const fixture = cachedFixture(prompt => ({ summary: '最后一个问题含伪造依据。', questions:
    Array.from({ length: 15 }, (_, index) => ({
      question: `研究问题 ${index + 1}？`, focus: '必须验证全部返回问题。',
      groupIds: [index === 14 ? 'invented-tail-group' : prompt.candidates[index].id]
    }))
  }));
  const failed = await analyze(fixture.client);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /汇总/);
  assert.match(failed.error, /依据/);
  assert.match(failed.error, /缓存/);
  assert.equal(fixture.calls.length, 1);
  assertOnlySynthesis(fixture.calls[0]);
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual([...fixture.records], fixture.initialNotes);
  assert.equal((await request(fixture.client, '/api/trends/options', { api })).report, null);
});

test('incomplete synthesis with a real partial trend remains retryable without losing any cached paper notes', async () => {
  let recover = false;
  const fixture = cachedFixture((prompt, call) => {
    if (recover) return synthesisAnswer(prompt);
    const selected = call === 1 ? prompt.candidates.slice(0, 4)
      : [prompt.candidates.find(candidate => candidate.paperCount === 4)];
    assert.ok(selected.every(Boolean), 'the supported partial trend survives into the next round');
    return { summary: '目前只归纳出部分论文的共同方向。', questions: [{
      question: '量子通信的可靠性', focus: '四篇论文提供共同依据，其余尚未汇总。',
      groupIds: selected.map(candidate => candidate.id)
    }] };
  });
  const partial = await analyze(fixture.client);
  assert.equal(partial.status, 'completed', 'return a truthful partial result rather than discarding it');
  assert.equal(partial.report.synthesis.complete, false);
  assert.equal(partial.report.coverage.analyzedCount, 15);
  assert.equal(partial.report.coverage.supportedCount, 4);
  assert.equal(partial.report.coverage.unassignedCount, 11);
  assert.equal(partial.report.unassignedPapers.length, 11);
  assert.ok(partial.report.warning);
  assert.ok(fixture.calls.length <= 6);
  assert.deepEqual(fixture.writes, [], 'a partial trend must not be persisted as a completed report');
  assert.deepEqual([...fixture.records], fixture.initialNotes);

  const options = await request(fixture.client, '/api/trends/options', { api });
  assert.equal(options.report, null);
  assert.deepEqual(options.incremental, { cached: 15, pending: 0, total: 15 });
  const callsBeforeRetry = fixture.calls.length;
  recover = true;
  const recovered = await analyze(createVisitorClient(fixture.dependencies));
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.report.synthesis.complete, true);
  assert.equal(recovered.report.coverage.supportedCount, 15);
  assert.equal(recovered.report.coverage.unassignedCount, 0);
  assert.equal(recovered.report.incremental.analyzed, 0);
  assert.equal(fixture.calls.length, callsBeforeRetry + 1);
  assertOnlySynthesis(fixture.calls.at(-1));
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0], /^report:/);
  assert.deepEqual([...fixture.records].filter(([key]) => key.startsWith('paper:')), fixture.initialNotes);
});
