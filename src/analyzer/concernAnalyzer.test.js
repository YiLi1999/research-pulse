import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConcerns, analyzeConcerns, ruleConcernReport, buildBatches } from './concernAnalyzer.js';
import { renderConcernReport } from '../web/public/concernAnalysis.js';

const options = { now: new Date('2026-08-31T10:00:00Z'), timezone: 'Asia/Shanghai' };
const paper = (id, extra = {}) => ({ id, title: `Quantum error correction ${id}`, abstract: 'A surface code decoder suppresses logical errors.',
  source: 'arxiv', date: '2026-08-27', url: 'https://arxiv.org/abs/2608.12345', ...extra });

test('seven local calendar days exclude old, future, invalid dates, and deduplicate versions/cross-source copies', () => {
  const result = prepareConcerns([
    paper('2608.1v1', { title: 'The same study', abstract: '', date: '2026-08-24T16:00:00Z' }),
    paper('2608.1v2', { title: 'The same study revised', date: '2026-08-25' }),
    paper('aps-copy', { title: 'The SAME study revised!', source: 'aps' }),
    paper('today', { date: '2026-08-31' }),
    paper('old', { date: '2026-08-24T15:59:59Z' }),
    paper('future', { date: '2026-08-31T10:00:01Z' }),
    paper('missing', { date: null }),
    paper('invalid', { date: 'not-a-date' })
  ], {}, options);
  assert.equal(result.window.start, '2026-08-25');
  assert.equal(result.window.end, '2026-08-31');
  assert.deepEqual(result.papers.map(p => p.id), ['2608.1v2', 'today']);
  assert.equal(result.coverage.duplicateCount, 2);
  assert.equal(result.coverage.missingDateCount, 2);
  assert.equal(result.coverage.abstractCount, 2);
});

test('hierarchical scope validation, cross-field membership, and ranking independence', () => {
  const papers = [paper('q'), paper('gravity', { title: 'Black hole gravity', abstract: 'General relativity and black hole geometry.', journal: 'prd' }),
    paper('atom', { title: 'Atomic quantum clock', abstract: 'Atomic clocks improve precision measurement.', recommendation: { score: 99999 } })];
  const result = prepareConcerns(papers, { majorField: 'quantum', minorField: 'error-correction' }, options);
  assert.deepEqual(result.papers.map(p => p.id), ['q']);
  assert.equal(result.catalog.find(f => f.id === 'high-energy').children.find(s => s.id === 'gravity').count, 1);
  assert.equal(prepareConcerns(papers, { majorField: 'optics', minorField: 'sensing' }, options).papers[0].id, 'atom');
  assert.throws(() => prepareConcerns(papers, { minorField: 'gravity' }, options), { statusCode: 400 });
  assert.throws(() => prepareConcerns(papers, { majorField: 'quantum', minorField: 'gravity' }, options), { statusCode: 400 });
  assert.throws(() => prepareConcerns(papers, { majorField: ['quantum'] }, options), { statusCode: 400 });
  assert.throws(() => prepareConcerns(papers, null, options), { statusCode: 400 });
});

test('classical decoder and particle terminology does not imply quantum correction or particle physics', () => {
  const papers = [paper('classical-optics', { title: 'Optical encryption', abstract: 'An adaptive neural decoder for optical speckle patterns.', journal: 'prapplied' }),
    paper('fluid', { title: 'Particle flow in fluids', abstract: 'Classical particle transport.', journal: 'pre' })];
  assert.equal(prepareConcerns(papers, { majorField: 'quantum', minorField: 'error-correction' }, options).papers.length, 0);
  assert.equal(prepareConcerns(papers, { majorField: 'high-energy' }, options).papers.length, 0);
});

test('all selected papers reach the model, concurrency is bounded, and merged counts use unique evidence IDs', async () => {
  const prepared = prepareConcerns(Array.from({ length: 76 }, (_, n) => paper(`record-${n}`)), {}, options);
  const seen = [], progress = [];
  let active = 0, maxActive = 0;
  const report = await analyzeConcerns(prepared, { onProgress: p => progress.push(p), concurrency: 12, chat: async messages => {
    const input = JSON.parse(messages[1].content);
    if (input.candidates) return { summary: '共同关注解码精度与开销。', questions: [{ question: '如何改进解码？', focus: '比较解码方法。',
      groupIds: input.candidates.map(g => g.id), count: 100000 }] };
    active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setImmediate(resolve));
    active--; seen.push(...input.papers.map(p => p.id));
    const ids = input.papers.map(p => p.id);
    return { questions: [{ question: '如何改进解码？', focus: '基于摘要的归纳。', paperIds: [...ids, ids[0]], count: 100000 },
      { question: '如何降低开销？', paperIds: [ids[0]] }] };
  } });
  assert.equal(seen.length, 76);
  assert.equal(new Set(seen).size, 76);
  assert.equal(maxActive, 2);
  assert.equal(report.questions[0].count, 76);
  assert.equal(report.questions[0].share, 100);
  assert.equal(report.coverage.supportedCount, 76);
  assert.equal(report.mode, 'llm');
  assert.equal(progress.at(-1).stage, 'synthesizing');
  assert.equal(report.batchCount, 3);
  assert.equal(buildBatches(prepared.papers, 500).flat().length, 76);
});

test('invented model evidence is rejected, and empty data never invokes the model', async () => {
  const prepared = prepareConcerns([paper('q')], {}, options);
  await assert.rejects(analyzeConcerns(prepared, { chat: async () => ({ questions: [{ question: '虚构的问题？', paperIds: ['unknown'] }] }) }), /依据/);
  const empty = await analyzeConcerns(prepareConcerns([], {}, options), { chat: () => { throw new Error('must not call'); } });
  assert.equal(empty.questions.length, 0);
  assert.equal(empty.coverage.selectedCount, 0);
});

test('fallback reports are explicitly rules and rendering escapes model text and unsafe links', () => {
  const prepared = prepareConcerns([paper('q', { title: '<img src=x onerror=alert(1)> Quantum error correction', url: 'javascript:alert(1)' })], {}, options);
  const report = ruleConcernReport(prepared);
  assert.equal(report.mode, 'rules');
  assert.match(report.warning, /不是 AI/);
  report.questions[0].question = '<script>alert(1)</script>';
  const html = renderConcernReport(report);
  assert.ok(html.includes('规则统计') && html.includes('&lt;script&gt;') && html.includes('&lt;img'));
  assert.ok(!html.includes('<script>') && !html.includes('<img') && !html.includes('javascript:'));
  assert.ok(html.includes('href="#"'));
});
