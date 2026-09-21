import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { renderConcernReport } from './public/concernAnalysis.js';

function reportFixture() {
  const paper = id => ({ id, title: `Paper ${id}`, source: 'arXiv', date: '2026-09-21', url: `https://example.com/${id}`, abstract: 'Evidence.' });
  return {
    mode: 'llm', scope: { label: '量子科学' }, window: { start: '2026-09-15', end: '2026-09-21', timezone: 'Asia/Shanghai' },
    generatedAt: '2026-09-21T00:00:00Z', summary: '多项研究共同改善量子纠错的资源效率。',
    coverage: { selectedCount: 25, abstractCount: 25, analyzedCount: 25, synthesizableCount: 25, supportedCount: 24, unassignedCount: 1, sourceCounts: { arXiv: 25 } },
    synthesis: { version: 2, complete: true, maxTrends: 5 }, incremental: { cached: 20, analyzed: 5, total: 25 },
    questions: [{ question: '降低量子纠错的资源开销', focus: '兼容旧报告的解释', pattern: '围绕有限资源下的可靠性展开。',
      approaches: '编码设计与译码算法形成两条互补路径。', gaps: '统一噪声基准和大规模验证仍不足。',
      count: 24, share: 96, papers: Array.from({ length: 24 }, (_, index) => paper(index + 1)) }],
    unassignedPapers: [paper(25)], limitations: []
  };
}

test('trend report distinguishes all analyzed papers from broad directions and collapses unassigned evidence', () => {
  const $ = load(renderConcernReport(reportFixture()));
  assert.equal($('.concern-coverage').text(), '完整分析 25/25 篇');
  assert.equal($('.concern-directions-title').text(), '主要研究方向（1 个）');
  assert.equal($('.concern-question').length, 1);
  assert.match($('.concern-question').text(), /共同动向：围绕有限资源/);
  assert.match($('.concern-question').text(), /主要路径与差异：编码设计/);
  assert.match($('.concern-question').text(), /共同瓶颈：统一噪声基准/);
  assert.doesNotMatch($('.concern-question').text(), /兼容旧报告/);
  assert.equal($('.concern-question .concern-evidence li').length, 24);
  assert.equal($('.concern-unassigned li').length, 1);
  assert.equal($('.concern-unassigned').attr('open'), undefined);
  assert.equal($('.concern-unassigned').closest('.concern-question').length, 0);
  assert.match($.text(), /未与前一周比较，不代表热度上升/);
});

test('incomplete synthesis cannot claim full analysis success and offers reusable-note retry', () => {
  const report = reportFixture();
  report.synthesis.complete = false;
  const $ = load(renderConcernReport(report));
  assert.equal($('.concern-coverage').text(), '已读取 25/25 篇 · 趋势汇总未充分完成');
  assert.doesNotMatch($.text(), /完整分析|缓存已保存/);
  assert.match($('.concern-warning').text(), /逐篇分析可复用/);
});

test('trend report safely renders new synthesis fields and preserves legacy focus compatibility', () => {
  const report = reportFixture();
  report.questions[0].pattern = '<script>window.leak()</script>';
  report.questions[0].approaches = '<img src=x onerror=alert(1)>';
  report.questions[0].gaps = '<a href="javascript:alert(1)">gap</a>';
  const $ = load(renderConcernReport(report, 'en'));
  assert.equal($('script, img, a[href^="javascript:"]').length, 0);
  assert.match($('.concern-question').text(), /Shared pattern/);
  assert.equal($('.concern-coverage').text(), 'All papers analyzed: 25/25');
  delete report.questions[0].pattern;
  assert.match(load(renderConcernReport(report))('.concern-question').text(), /共同动向：兼容旧报告的解释/);
});
