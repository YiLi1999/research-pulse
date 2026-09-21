import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConcerns } from './concernAnalyzer.js';
import { analyzeIncrementalConcerns } from './incrementalConcernsCore.js';

function fixture(count, notesPerPaper = 1) {
  const prepared = prepareConcerns(Array.from({ length: count }, (_, index) => ({
    id: `study-${String(index).padStart(3, '0')}`, title: `Quantum study ${index}`,
    abstract: 'Evidence about error correction and quantum communication.', date: '2026-09-20'
  })), {}, { now: new Date('2026-09-20T10:00:00Z') });
  const cachedNotes = new Map(prepared.papers.map((paper, index) => [paper.ref,
    Array.from({ length: notesPerPaper }, () => ({
      question: index % 2 ? '量子通信的可扩展实现' : '量子纠错的资源效率', focus: `摘要证据 ${paper.id}`
    }))]));
  return { prepared, cachedNotes };
}

async function synthesize(count, answer, notesPerPaper = 1) {
  const { prepared, cachedNotes } = fixture(count, notesPerPaper);
  const calls = [], rounds = [];
  const report = await analyzeIncrementalConcerns(prepared, {
    cachedNotes,
    saveNotes: async () => assert.fail('existing extraction notes must remain unchanged'),
    onProgress(progress) {
      if (progress.stage === 'synthesizing' && progress.mergeCompleted === 0) rounds.push(progress.mergeRound);
    },
    chat: async messages => {
      const input = JSON.parse(messages.at(-1).content);
      calls.push(input);
      assert.ok(calls.length <= 100, 'synthesis must stop before unbounded paid requests');
      assert.equal(input.mode, 'question-synthesis');
      assert.equal(input.papers, undefined);
      assert.ok(input.candidates.length <= 60);
      assert.ok(JSON.stringify(input.candidates).length <= 40000);
      return answer(input, calls.length);
    }
  });
  assert.ok(rounds.length <= 6, 'a maximum of six merge rounds bounds API work');
  return { report, calls, prepared, rounds };
}

function allCandidates(input, extra = {}) {
  return { summary: '这些论文共同探索提高量子技术可靠性的方法。', questions: [{
    question: '量子技术的可靠性与扩展', focus: '比较多篇工作的共同路径和未解难点。',
    groupIds: input.candidates.map(candidate => candidate.id), ...extra
  }] };
}

test('65 cached papers cannot become a false 10-paper success when the model keeps selecting isolated works', async () => {
  const { report, calls } = await synthesize(65, input => ({
    summary: '逐篇列出的研究工作。',
    questions: input.candidates.slice(0, 10).map(candidate => ({
      question: candidate.question, focus: candidate.focus, groupIds: [candidate.id]
    }))
  }));
  assert.equal(report.incremental.cached, 65);
  assert.equal(report.incremental.analyzed, 0);
  assert.equal(report.coverage.analyzedCount, 65);
  assert.equal(report.coverage.synthesizableCount, 65);
  assert.equal(report.coverage.supportedCount, 0);
  assert.equal(report.coverage.unassignedCount, 65);
  assert.equal(new Set(report.unassignedPapers.map(paper => paper.id)).size, 65);
  assert.deepEqual(report.questions, []);
  assert.equal(report.synthesis.complete, false);
  assert.ok(report.warning);
  assert.ok(calls.length <= 12, 'two chunks per round and at most six rounds');
});

test('65 papers retain full evidence when separate chunks are merged into two broad directions', async () => {
  const { report, calls, prepared } = await synthesize(65, input => ({
    summary: '样本共同关注量子纠错的资源效率与量子通信的可扩展实现。',
    questions: ['量子纠错的资源效率', '量子通信的可扩展实现'].map(question => ({
      question, focus: '多项工作的共同研究路线。',
      pattern: '多篇研究比较可靠性和资源开销。',
      approaches: '对比不同实现策略的适用条件。',
      gaps: '规模增大时的性能仍需验证。',
      groupIds: input.candidates.filter(candidate => candidate.question === question).map(candidate => candidate.id)
    })).filter(question => question.groupIds.length)
  }));
  assert.ok(calls.length > 1, 'the sample spans more than one merge chunk');
  assert.equal(report.questions.length, 2);
  assert.deepEqual(report.questions.map(question => question.count), [33, 32]);
  assert.equal(report.coverage.analyzedCount, 65);
  assert.equal(report.coverage.synthesizableCount, 65);
  assert.equal(report.coverage.supportedCount, 65);
  assert.equal(report.coverage.unassignedCount, 0);
  assert.deepEqual(report.unassignedPapers, []);
  assert.deepEqual(report.synthesis, { version: 2, complete: true, maxTrends: 5 });
  assert.deepEqual(report.questions.flatMap(question => question.papers.map(paper => paper.id)).sort(),
    prepared.papers.map(paper => paper.id).sort());
  for (const question of report.questions) {
    assert.equal(question.pattern, '多篇研究比较可靠性和资源开销。');
    assert.equal(question.approaches, '对比不同实现策略的适用条件。');
    assert.equal(question.gaps, '规模增大时的性能仍需验证。');
  }
});

test('omitted candidate evidence is carried into another round instead of silently discarded', async () => {
  const { report, calls } = await synthesize(14, (input, call) => call === 1 ? {
    summary: '暂时仅汇总部分证据。', questions: [{
      question: '量子技术的可靠性与扩展', focus: '先合并四篇相关工作。',
      groupIds: input.candidates.slice(0, 4).map(candidate => candidate.id)
    }]
  } : allCandidates(input));
  assert.ok(calls.length >= 2, 'unmentioned evidence must not be counted as an intentional exclusion');
  assert.equal(calls[1].candidates.reduce((sum, candidate) => sum + candidate.paperCount, 0), 14);
  assert.equal(report.coverage.supportedCount, 14);
  assert.equal(report.coverage.unassignedCount, 0);
  assert.equal(report.synthesis.complete, true);
});

test('evidence in a sixth disjoint returned group survives local top-five selection', async () => {
  const { report, calls } = await synthesize(18, (input, call) => call === 1 ? {
    summary: '模型把工作分成六类。', questions: Array.from({ length: 6 }, (_, index) => ({
      question: `共同研究方向 ${index + 1}`, focus: '每类三篇论文。',
      groupIds: input.candidates.slice(index * 3, index * 3 + 3).map(candidate => candidate.id)
    }))
  } : allCandidates(input));
  assert.ok(calls.length >= 2, 'discarded output groups cannot discard their evidence');
  assert.equal(report.coverage.supportedCount, 18);
  assert.equal(report.coverage.unassignedCount, 0);
  assert.equal(report.synthesis.complete, true);
  assert.ok(report.questions.length <= 5);
});

test('slowly shrinking synthesis stops after six rounds and reports the remaining papers', async () => {
  const { report, calls, rounds } = await synthesize(30, input => ({
    summary: '逐轮仅合并少量候选。', questions: [{
      question: '量子技术的可靠性与扩展', focus: '当前仅归纳部分依据。',
      groupIds: input.candidates.slice(0, 2).map(candidate => candidate.id)
    }]
  }));
  assert.equal(rounds.length, 6, 'convergence must have a fixed work limit even while it keeps shrinking');
  assert.equal(calls.length, 6);
  assert.equal(report.synthesis.complete, false);
  assert.equal(report.coverage.analyzedCount, 30);
  assert.ok(report.coverage.supportedCount > 0);
  assert.ok(report.coverage.unassignedCount > 0);
  assert.equal(report.coverage.supportedCount + report.coverage.unassignedCount, 30);
  assert.equal(report.unassignedPapers.length, report.coverage.unassignedCount);
});

test('explicitly unassigned candidates remain visible as excluded evidence', async () => {
  const { report, calls } = await synthesize(8, input => ({
    summary: '六篇形成共同方向，两篇尚不能归类。', questions: [{
      question: '量子技术的可靠性与扩展', focus: '六篇研究提供共同依据。',
      groupIds: input.candidates.slice(0, 6).map(candidate => candidate.id)
    }], unassignedGroupIds: input.candidates.slice(6).map(candidate => candidate.id)
  }));
  assert.equal(calls.length, 1, 'explicit exclusions do not need an automatic repair request');
  assert.equal(report.coverage.analyzedCount, 8);
  assert.equal(report.coverage.supportedCount, 6);
  assert.equal(report.coverage.unassignedCount, 2);
  assert.equal(report.unassignedPapers.length, 2);
  assert.equal(report.synthesis.complete, true);
});

test('multiple notes from a single paper cannot manufacture a shared trend', async () => {
  const { report, calls } = await synthesize(1, input => allCandidates(input), 3);
  assert.equal(calls.length, 0);
  assert.equal(report.coverage.analyzedCount, 1);
  assert.equal(report.coverage.synthesizableCount, 1);
  assert.equal(report.coverage.supportedCount, 0);
  assert.equal(report.coverage.unassignedCount, 1);
  assert.deepEqual(report.questions, []);
  assert.equal(report.unassignedPapers.length, 1);
});

test('a model group citing three notes from the same paper still lacks two distinct supporting papers', async () => {
  const { report } = await synthesize(2, input => ({
    summary: '两篇不同的工作各自有多个问题。',
    questions: ['study-000', 'study-001'].map(id => ({
      question: `单篇工作 ${id}`, focus: '只关联这一篇的三个问题。',
      groupIds: input.candidates.filter(candidate => candidate.focus.includes(id)).map(candidate => candidate.id)
    })).filter(group => group.groupIds.length)
  }), 3);
  assert.deepEqual(report.questions, []);
  assert.equal(report.coverage.analyzedCount, 2);
  assert.equal(report.coverage.supportedCount, 0);
  assert.equal(report.coverage.unassignedCount, 2);
  assert.equal(report.synthesis.complete, false);
});

test('overlapping notes and candidate IDs count each supporting paper only once', async () => {
  const { report } = await synthesize(4, input => {
    const result = allCandidates(input);
    result.questions[0].groupIds.push(...result.questions[0].groupIds);
    return result;
  }, 3);
  assert.equal(report.questions.length, 1);
  assert.equal(report.questions[0].count, 4);
  assert.equal(report.questions[0].share, 100);
  assert.equal(report.coverage.supportedCount, 4);
  assert.equal(report.coverage.synthesizableCount, 4);
  assert.equal(report.coverage.unassignedCount, 0);
});

test('already-read papers without usable notes remain counted and do not trigger model requests', async () => {
  const { prepared } = fixture(3);
  const report = await analyzeIncrementalConcerns(prepared, {
    cachedNotes: new Map(prepared.papers.map(paper => [paper.ref, []])),
    chat: async () => assert.fail('empty cached notes cannot supply synthesis evidence')
  });
  assert.equal(report.coverage.analyzedCount, 3);
  assert.equal(report.coverage.synthesizableCount, 0);
  assert.equal(report.coverage.supportedCount, 0);
  assert.equal(report.coverage.unassignedCount, 3);
  assert.equal(report.unassignedPapers.length, 3);
  assert.deepEqual(report.questions, []);
  assert.ok(report.warning);
});

test('invented exclusion IDs cannot bypass candidate evidence validation', async () => {
  await assert.rejects(synthesize(8, input => ({ ...allCandidates(input), unassignedGroupIds: ['invented-group'] })),
    /汇总|依据|候选/);
});
