import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConcerns } from './concernAnalyzer.js';
import { analyzeIncrementalConcerns } from './incrementalConcernsCore.js';

test('synthesis converges with maximum-length text and overlapping evidence across 1001 cached papers', async () => {
  const prepared = prepareConcerns(Array.from({ length: 1001 }, (_, index) => ({
    id: `paper-${index}`, title: `Quantum computing study ${index}`,
    abstract: 'Quantum error correction and logical gates.', date: '2026-09-20'
  })), {}, { now: new Date('2026-09-20T10:00:00Z') });
  const cachedNotes = new Map(prepared.papers.map(paper => [paper.ref, [{
    question: 'q'.repeat(300), focus: 'f'.repeat(800)
  }]]));
  const rounds = [];
  let calls = 0;
  const report = await analyzeIncrementalConcerns(prepared, {
    cachedNotes,
    saveNotes: async () => { assert.fail('cached papers must not be extracted or rewritten'); },
    onProgress: progress => {
      if (progress.stage === 'synthesizing' && progress.mergeCompleted === 0) rounds.push(progress.mergeTotal);
    },
    chat: async messages => {
      assert.ok(++calls < 100, 'overlapping evidence must not cause unbounded synthesis requests');
      const input = JSON.parse(messages.at(-1).content);
      assert.equal(input.mode, 'question-synthesis');
      assert.equal(input.papers, undefined, 'all original papers are already cached');
      assert.ok(input.candidates.length > 0 && input.candidates.length <= 60);
      assert.ok(Buffer.byteLength(JSON.stringify(input.candidates)) <= 40100,
        'the actual candidate payload stays within the 40000-character budget plus JSON separators');
      assert.deepEqual(input.candidates.map(candidate => candidate.id),
        input.candidates.map((_candidate, index) => `g${index + 1}`));
      assert.ok(input.candidates.every(candidate => !Object.hasOwn(candidate, 'paperIds')),
        'large evidence lists are retained locally rather than sent to the model');
      return { summary: 'All questions intentionally share the available supporting papers.',
        questions: Array.from({ length: 10 }, (_, index) => ({
          question: `${index}:${'q'.repeat(298)}`, focus: 'f'.repeat(1600),
          groupIds: input.candidates.map(candidate => candidate.id)
        })) };
    }
  });
  assert.ok(calls < 100);
  assert.ok(rounds.length > 1, 'the fixture exercises several merge rounds');
  assert.equal(rounds.at(-1), 1);
  for (let index = 1; index < rounds.length; index++) {
    assert.ok(rounds[index] < rounds[index - 1], 'each subsequent round has fewer batches');
  }
  assert.deepEqual(report.incremental, { cached: 1001, analyzed: 0, total: 1001, unsaved: 0 });
  assert.equal(report.coverage.supportedCount, 1001);
  assert.equal(report.questions.length, 10);
  const expectedIds = prepared.papers.map(paper => paper.id).sort();
  for (const question of report.questions) {
    assert.equal(question.count, 1001);
    assert.equal(question.share, 100);
    assert.deepEqual(question.papers.map(paper => paper.id).sort(), expectedIds,
      'overlapping evidence is deduplicated without losing or inventing original papers');
  }
});
