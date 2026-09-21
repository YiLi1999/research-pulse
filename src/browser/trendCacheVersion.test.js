import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVisitorClient } from './visitorClient.js';
import { createConcernService } from '../services/concernService.js';
import { finishReport, prepareConcerns } from '../analyzer/concernAnalyzer.js';
import { PAPER_ANALYSIS_VERSION, TREND_SYNTHESIS_VERSION } from '../analyzer/incrementalConcernsCore.js';

const api = { baseUrl: 'https://provider.example/v1', apiKey: 'test-only-key', model: 'test-model' };
const now = new Date('2026-09-20T10:00:00Z');
const papers = ['alpha', 'beta'].map(id => ({ id, title: `Quantum communication study ${id}`,
  abstract: `Original abstract ${id}: entanglement distribution in quantum networks.`, date: '2026-09-20', source: 'arxiv' }));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const notes = paper => [{ question: '如何提高纠缠分发效率？', focus: `Cached evidence ${paper.id}` }];
const oldPaperKey = (paper, engine) => digest({ version: 1, engine, title: paper.title, abstract: paper.abstract });

function oldReport(prepared) {
  return finishReport(prepared, [{ question: '旧版已成功汇总的问题', focus: '旧版报告不可继续复用。',
    paperIds: prepared.papers.map(paper => paper.ref) }], { mode: 'llm', summary: 'LEGACY SUCCESSFUL REPORT' });
}

function synthesisAnswer(prompt) {
  assert.equal(prompt.mode, 'question-synthesis');
  assert.equal(prompt.papers, undefined, 'version upgrade must not reread cached papers');
  assert.equal(prompt.candidates.length, papers.length);
  for (const paper of papers) {
    assert.ok(!JSON.stringify(prompt).includes(paper.title));
    assert.ok(!JSON.stringify(prompt).includes(paper.abstract));
  }
  return { summary: '新的跨论文研究趋势。', questions: [{ question: '如何提高纠缠分发效率？',
    focus: '两篇论文共同研究网络中的纠缠分发。', groupIds: prompt.candidates.map(candidate => candidate.id) }] };
}

function assertMigratedReport(report) {
  assert.equal(report.mode, 'llm');
  assert.notEqual(report.summary, 'LEGACY SUCCESSFUL REPORT');
  assert.deepEqual(report.incremental, { cached: 2, analyzed: 0, total: 2, unsaved: 0 });
  assert.equal(report.synthesis.version, 2);
  assert.equal(report.synthesis.complete, true);
  assert.equal(report.coverage.supportedCount, 2);
  assert.equal(report.questions[0].count, 2);
}

async function request(client, pathname, body) {
  const response = await client.apiFetch(pathname, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  assert.ok(response.ok);
  return response.json();
}

async function finishJob(job, getJob) {
  for (let attempt = 0; job.status === 'running' && attempt < 200; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    job = await getJob(job.id);
  }
  assert.equal(job.status, 'completed');
  return job;
}

test('browser synthesis v2 ignores a successful v1 report and reuses every v1 paper note', async () => {
  assert.equal(PAPER_ANALYSIS_VERSION, 1);
  assert.equal(TREND_SYNTHESIS_VERSION, 2);
  const prepared = prepareConcerns(papers, {}, { now, timezone: 'Asia/Shanghai' });
  const engine = ['visitor-api', api.baseUrl, api.model];
  const reportKey = version => 'report:' + digest({ version, engine, scope: prepared.scope,
    start: prepared.window.start, end: prepared.window.end, timezone: prepared.window.timezone, coverage: prepared.coverage,
    papers: prepared.papers.map(p => [p.id, p.title, p.abstract, p.date, p.submittedAt, p.url, p.arxivUrl, p.journal_display, p.journal, p.source]) });
  const savedNotes = papers.map(paper => ['paper:' + oldPaperKey(paper, engine), notes(paper)]);
  const legacyReport = oldReport(prepared), legacyKey = reportKey(1), upgradedKey = reportKey(2);
  const records = new Map([...savedNotes, [legacyKey, legacyReport]]);
  const calls = [], writes = [];
  const dependencies = { now: () => now, preferences: { getItem() { return null; } }, storage: {
    async get(key) { return structuredClone(records.get(key)); },
    async set(key, value) { writes.push(key); records.set(key, structuredClone(value)); return true; }
  }, fetch: async (url, init) => {
    if (url === '/data/dashboard.json') return Response.json({ papers, config: { timezone: 'Asia/Shanghai' } });
    assert.equal(url, '/api/chat');
    const prompt = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
    calls.push(prompt);
    return Response.json({ result: synthesisAnswer(prompt) });
  } };
  const client = createVisitorClient(dependencies);
  const before = await request(client, '/api/trends/options', { api });
  assert.equal(before.report, null, 'cache inspection must not restore the old successful report');
  assert.deepEqual(before.incremental, { cached: 2, pending: 0, total: 2 });
  assert.equal(calls.length, 0);

  const started = await request(client, '/api/trends/analyze', { api });
  assert.notEqual(started.cached, true, 'start must not return the old successful report');
  const completed = await finishJob(started, id => request(client, '/api/trends/jobs/' + id));
  assertMigratedReport(completed.report);
  assert.equal(calls.length, 1, 'only one synthesis call is needed for both cached papers');
  assert.deepEqual(writes, [upgradedKey]);
  assert.deepEqual([...records].filter(([key]) => key.startsWith('paper:')), savedNotes);
  assert.deepEqual(records.get(legacyKey), legacyReport, 'migration leaves existing saved data untouched');

  const restarted = createVisitorClient(dependencies);
  assert.deepEqual((await request(restarted, '/api/trends/options', { api })).report, completed.report);
  const repeated = await request(restarted, '/api/trends/analyze', { api });
  assert.equal(repeated.cached, true);
  assert.deepEqual(repeated.report, completed.report);
  assert.equal(calls.length, 1, 'the new complete report is reusable after reload');
});

test('server synthesis v2 invalidates the old report key while retaining v1 disk paper notes', async t => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'rp-trend-version-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    assert.ok(path.basename(directory).startsWith('rp-trend-version-'));
    await rm(directory, { recursive: true, force: true });
  });
  const engine = ['test', 'migration-model'], calls = [];
  const dependencies = { storageDir: directory, now: () => now,
    loadPapers: async () => papers, loadState: async () => ({}),
    getEngine: async () => ({ available: true, provider: 'api', model: 'migration-model', label: 'Migration test',
      signature: engine, concurrency: 1, chat: async messages => {
        const prompt = JSON.parse(messages.at(-1).content);
        calls.push(prompt);
        return synthesisAnswer(prompt);
      } }) };
  const service = createConcernService(dependencies);
  const prepared = prepareConcerns(papers, {}, { now, timezone: (await service.getFields()).window.timezone });
  const reportKey = upgraded => digest({ version: 3, ...(upgraded ? { synthesisVersion: 2 } : {}),
    scope: prepared.scope, start: prepared.window.start, end: prepared.window.end,
    timezone: prepared.window.timezone, engine, coverage: prepared.coverage,
    papers: prepared.papers.map(p => [p.id, p.title, p.abstract, p.keywords, p.date, p.submittedAt, p.url, p.arxivUrl, p.journal_display, p.journal, p.source]) });
  const legacyReport = oldReport(prepared), legacyFile = path.join(directory, reportKey(false) + '.json');
  await writeFile(legacyFile, JSON.stringify(legacyReport));
  await mkdir(path.join(directory, 'papers'));
  const savedFiles = [];
  for (const paper of papers) {
    const key = oldPaperKey(paper, engine), filename = path.join(directory, 'papers', key + '.json');
    const contents = JSON.stringify({ version: 1, key, questions: notes(paper),
      savedAt: '2026-09-19T10:00:00Z', paperDate: paper.date });
    await writeFile(filename, contents);
    savedFiles.push([filename, contents]);
  }
  const before = await service.getOptions({});
  assert.equal(before.report, null, 'getOptions must ignore the old successful report file');
  assert.deepEqual(before.incremental, { cached: 2, pending: 0, total: 2 });
  assert.equal(calls.length, 0);

  const started = await service.start({});
  assert.notEqual(started.cached, true, 'start must not reuse the old report file');
  const completed = await finishJob(started, id => service.getJob(id));
  assertMigratedReport(completed.report);
  assert.equal(calls.length, 1, 'no paper-extraction request is made during migration');
  assert.deepEqual(JSON.parse(await readFile(legacyFile, 'utf8')), legacyReport);
  for (const [filename, contents] of savedFiles) assert.equal(await readFile(filename, 'utf8'), contents);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, reportKey(true) + '.json'), 'utf8')), completed.report);

  const restarted = createConcernService(dependencies);
  assert.deepEqual((await restarted.getOptions({})).report, completed.report);
  const repeated = await restarted.start({});
  assert.equal(repeated.cached, true);
  assert.deepEqual(repeated.report, completed.report);
  assert.equal(calls.length, 1, 'the upgraded complete report is reusable after restart');
});
