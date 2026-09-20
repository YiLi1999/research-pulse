import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createConcernService } from './concernService.js';
import { prepareConcerns } from '../analyzer/concernAnalyzer.js';
import { paperAnalysisKey, analyzeIncrementalConcerns } from '../analyzer/incrementalConcerns.js';

const paper = (id, date = '2026-08-31') => ({ id, title: `Quantum computing ${id}`, abstract: 'Quantum error correction with entanglement and qubits.', date });
function answer(messages) {
  const input = JSON.parse(messages.at(-1).content);
  return input.mode === 'paper-extraction' ? { papers: input.papers.map(p => ({ id: p.id,
    questions: [{ question: '如何降低量子计算错误率？', focus: p.title }] })) }
    : { summary: '样本关注纠错精度。', questions: [{ question: '如何降低量子计算错误率？', focus: '基于逐篇证据。', groupIds: input.candidates.map(c => c.id) }] };
}
async function complete(service, scope = {}) {
  let job = await service.start(scope);
  for (let i = 0; job.status === 'running' && i < 800; i++) {
    await new Promise(resolve => setTimeout(resolve, 5)); job = service.getJob(job.id);
  }
  assert.equal(job.status, 'completed'); return job.report;
}
async function fixture(t, papers, handler = answer) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rp-incremental-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = new Date('2026-08-31T10:00:00Z'), signature = ['test', 'model-1'], calls = [];
  const settings = { loadPapers: async () => papers, loadState: async () => ({}), storageDir: directory, now: () => now,
    getEngine: async () => ({ available: true, provider: 'codex', model: 'test', label: 'test', signature, concurrency: 1,
      chat: async messages => { calls.push(JSON.parse(messages.at(-1).content)); return handler(messages); } }) };
  return { service: createConcernService(settings), settings, calls, directory,
    setDate: value => { now = new Date(value); }, changeEngine: () => { signature = ['test', 'model-2']; } };
}

test('daily analysis reuses unchanged papers across scopes, excludes expired papers and remaps transient IDs', async t => {
  const papers = [paper('b-old', '2026-08-25'), paper('c-kept')];
  const f = await fixture(t, papers);
  const first = await complete(f.service);
  assert.deepEqual(first.incremental, { cached: 0, analyzed: 2, total: 2, unsaved: 0 });
  f.calls.length = 0;
  const scoped = await complete(f.service, { majorField: 'quantum-information' });
  assert.equal(scoped.incremental.cached, 2);
  assert.ok(f.calls.every(c => c.mode !== 'paper-extraction'), 'scope change only resynthesizes');
  f.calls.length = 0;
  f.setDate('2026-09-01T10:00:00Z');
  papers.push(paper('a-new', '2026-09-01'));
  const restarted = createConcernService(f.settings);
  const report = await complete(restarted);
  assert.deepEqual(report.incremental, { cached: 1, analyzed: 1, total: 2, unsaved: 0 });
  assert.equal(f.calls.filter(c => c.mode === 'paper-extraction').flatMap(c => c.papers).length, 1);
  const evidence = report.questions.flatMap(q => q.papers);
  assert.deepEqual(evidence.map(p => p.id).sort(), ['a-new', 'c-kept']);
  assert.equal(evidence.find(p => p.id === 'a-new').ref, 'p1');
  assert.equal(evidence.find(p => p.id === 'c-kept').ref, 'p2');
  f.calls.length = 0;
  papers[1].abstract += ' Revised physical conclusion.';
  const changed = await complete(restarted);
  assert.equal(changed.incremental.analyzed, 1);
  assert.equal(changed.incremental.cached, 1);
  assert.equal(f.calls.find(c => c.mode === 'paper-extraction').papers[0].title, 'Quantum computing c-kept');
  f.changeEngine();
  assert.equal((await complete(restarted)).incremental.analyzed, 2);
});

test('a failed later batch preserves earlier paper notes; retry reads only the unfinished papers', async t => {
  let extractionCalls = 0, fail = true;
  const f = await fixture(t, Array.from({ length: 40 }, (_, i) => paper(`entry-${i}`)), messages => {
    if (JSON.parse(messages.at(-1).content).mode === 'paper-extraction' && ++extractionCalls === 2 && fail) throw new Error('batch interrupted');
    return answer(messages);
  });
  assert.equal((await complete(f.service)).mode, 'rules');
  const options = await f.service.getOptions({});
  assert.deepEqual(options.incremental, { cached: 35, pending: 5, total: 40 });
  fail = false; f.calls.length = 0;
  const resumed = await complete(createConcernService(f.settings));
  assert.equal(resumed.incremental.cached, 35);
  assert.equal(resumed.incremental.analyzed, 5);
  assert.equal(f.calls.filter(c => c.mode === 'paper-extraction').flatMap(c => c.papers).length, 5);
});

test('merge failure keeps all notes, and corrupt notes are reread instead of reused', async t => {
  let fail = true;
  const papers = [paper('one'), paper('two')];
  const f = await fixture(t, papers, messages => {
    if (JSON.parse(messages.at(-1).content).candidates && fail) throw new Error('merge interrupted');
    return answer(messages);
  });
  assert.equal((await complete(f.service)).mode, 'rules');
  assert.equal((await f.service.getOptions({})).incremental.cached, 2);
  f.calls.length = 0; fail = false;
  assert.equal((await complete(f.service)).incremental.analyzed, 0);
  assert.ok(f.calls.every(c => c.mode !== 'paper-extraction'));
  const key = paperAnalysisKey(papers[0], ['test', 'model-1']);
  await writeFile(path.join(f.directory, 'papers', `${key}.json`), '{broken');
  f.setDate('2026-09-01T10:00:00Z');
  assert.equal((await complete(f.service)).incremental.analyzed, 1);
});

test('field counts need no AI engine and keep quantum information and metrology separately selectable', async t => {
  const f = await fixture(t, [paper('computation'), { id: 'clock', title: 'Atomic optical clock', abstract: 'Precision measurement with atoms.', date: '2026-08-31' },
    { id: 'other', title: 'An unrelated study', date: '2026-08-31' }]);
  const service = createConcernService({ ...f.settings, getEngine: () => { throw new Error('must not inspect Codex'); } });
  const counts = await service.getFields();
  assert.equal(counts.catalog.length, 14);
  assert.equal(counts.catalog.find(f => f.id === 'quantum').count, 1);
  assert.equal(counts.catalog.find(f => f.id === 'quantum-information').count, 1);
  assert.equal(counts.catalog.find(f => f.id === 'metrology').count, 1);
  assert.equal(counts.coverage.unclassifiedCount, 1);
});

test('malformed extraction cannot poison caches, and large synthesis is bounded with valid references', async () => {
  const prepared = prepareConcerns([paper('one'), paper('two')], {}, { now: new Date('2026-08-31T10:00:00Z') });
  for (const invalid of [[], [{ id: 'p1', questions: [] }, { id: 'p1', questions: [] }], [{ id: 'unknown', questions: [] }, { id: 'p2', questions: [] }]]) {
    let saves = 0;
    await assert.rejects(analyzeIncrementalConcerns(prepared, { chat: async () => ({ papers: invalid }), saveNotes: async () => { saves++; } }));
    assert.equal(saves, 0);
  }
  const large = prepareConcerns(Array.from({ length: 1001 }, (_, i) => paper(`paper-${i}`)), {}, { now: new Date('2026-08-31T10:00:00Z') });
  const cachedNotes = new Map(large.papers.map(p => [p.ref, [{ question: '如何改善量子控制？', focus: p.title }]]));
  let merges = 0;
  const report = await analyzeIncrementalConcerns(large, { cachedNotes, chat: async messages => {
    const input = JSON.parse(messages.at(-1).content); assert.ok(!input.papers); assert.ok(input.candidates.length <= 60); merges++;
    return answer(messages);
  } });
  assert.ok(merges > 1);
  assert.equal(report.incremental.analyzed, 0);
  assert.equal(report.questions[0].count, 1001);
  assert.equal(report.coverage.supportedCount, 1001);
});
