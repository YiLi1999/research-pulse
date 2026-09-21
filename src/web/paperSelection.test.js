import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPapers } from './public/paperSelection.js';

const options = { now: new Date('2026-09-21T07:48:12Z'), timezone: 'Asia/Shanghai' };
const paper = (id, date, extra = {}) => ({ id, title: `Study ${id}`, date, ...extra });
const ids = result => result.papers.map(item => item.id);

test('seven calendar days use the site timezone and exclude older, future and invalid records', () => {
  const records = [
    paper('before', '2026-09-14T15:59:59.999Z'),
    paper('start', '2026-09-14T16:00:00Z'),
    paper('date-only', '2026-09-15'),
    paper('local-time', '2026-09-15T00:00:00'),
    paper('local-before', '2026-09-14T23:59:59.999'),
    paper('offset-time', '2026-09-15T01:00:00+09:00'),
    paper('now', options.now.toISOString()),
    paper('future', '2026-09-21T07:48:12.001Z'),
    paper('tomorrow', '2026-09-22'),
    paper('missing', undefined),
    paper('invalid', 'not-a-date'),
    paper('invalid-calendar', '2026-09-31'),
    paper('fallback', undefined, { submittedAt: '2026-09-20' })
  ];
  const selected = selectPapers(records, options);
  assert.deepEqual(ids(selected), ['start', 'date-only', 'local-time', 'offset-time', 'now', 'fallback']);
  assert.deepEqual(selected.window, { days: 7, start: '2026-09-15', end: '2026-09-21',
    asOf: '2026-09-21T15:48:12.000+08:00', timezone: 'Asia/Shanghai' });
  assert.equal(selected.missingDateCount, 3);
  assert.equal(selected.duplicateCount, 0);
  assert.equal(selected.papers[0], records[1], 'preserves the original paper objects');
});

test('date-only and timezone-free dates use the configured zone, including DST changes', () => {
  const result = selectPapers([
    paper('before', '2026-03-08T04:59:59.999Z'),
    paper('start', '2026-03-08T05:00:00Z'),
    paper('local', '2026-03-08T00:00:00'),
    paper('day', '2026-03-08'),
    paper('before-now', '2026-03-09T09:00:00'),
    paper('after-now', '2026-03-09T10:00:00')
  ], { now: new Date('2026-03-09T13:30:00Z'), timezone: 'America/New_York', days: 2 });
  assert.deepEqual(ids(result), ['start', 'local', 'day', 'before-now']);
  assert.equal(result.window.start, '2026-03-08');
  assert.equal(result.window.asOf, '2026-03-09T09:30:00.000-04:00');
  const nonexistent = selectPapers([paper('gap', '2026-03-08T02:30:00')], {
    now: new Date('2026-03-08T07:29:59Z'), timezone: 'America/New_York', days: 1
  });
  assert.equal(nonexistent.papers.length, 0, 'nonexistent 02:30 moves forward to 03:30');
});

test('validates calendar dates, leap years and clock values without Date.parse rollover', () => {
  const result = selectPapers([
    paper('leap', '2024-02-29'), paper('invalid-leap', '2023-02-29'),
    paper('month', '2024-13-01'), paper('zero-day', '2024-03-00'),
    paper('minute', '2024-03-01T01:60:00Z'), paper('hour', '2024-03-01T25:00:00Z'),
    paper('next-midnight', '2024-02-29T24:00:00'),
    paper('invalid-midnight', '2024-02-29T24:01:00'),
    paper('offset', '2024-03-01T00:00:00+24:00')
  ], { now: new Date('2024-03-02T00:00:00Z'), timezone: 'UTC' });
  assert.deepEqual(ids(result), ['leap', 'next-midnight']);
  assert.equal(result.missingDateCount, 7);
});

test('deduplicates DOI, arXiv versions and normalized titles, keeping the fullest abstract', () => {
  const records = [
    paper('short', '2026-09-20', { doi: 'HTTPS://DOI.ORG/10.1/EXAMPLE', abstract: 'Short' }),
    paper('full', '2026-09-20', { doi: '10.1/example', abstract: 'The full abstract text.' }),
    paper('2609.12345v1', '2026-09-20', { abstract: '' }),
    paper('2609.12345v2', '2026-09-20', { abstract: 'More.' }),
    paper('title-one', '2026-09-20', { title: 'Ａ study: Of QUANTUM!', abstract: '' }),
    paper('title-two', '2026-09-20', { title: 'A study of quantum', abstract: 'Full.' }),
    paper('independent', '2026-09-20')
  ];
  const result = selectPapers(records, options);
  assert.deepEqual(ids(result), ['full', '2609.12345v2', 'title-two', 'independent']);
  assert.equal(result.duplicateCount, 3);
  assert.equal(result.papers[0], records[1]);
});

test('ranking and input order cannot alter the chosen identities, even for bridged duplicates', () => {
  const records = [
    paper('a', '2026-09-20', { doi: '10.1/shared', title: 'Title A', abstract: 'Same length.' }),
    paper('b', '2026-09-20', { doi: '10.1/shared', title: 'Title B', abstract: 'Same length.' }),
    paper('c', '2026-09-20', { title: 'Title B', abstract: 'Same length.' }),
    paper('z', '2026-09-20')
  ];
  const baseline = ids(selectPapers(records, options)).sort();
  for (const reordered of [records.toReversed(), [records[2], records[0], records[3], records[1]]]) {
    const ranked = reordered.map((item, index) => ({ ...item, recommendation: { score: 100 - index, final_rank: index + 1 } }));
    const selected = selectPapers(ranked, options);
    assert.deepEqual(ids(selected).sort(), baseline);
    assert.deepEqual(selected.papers, ranked.filter(item => baseline.includes(item.id)), 'keeps caller order');
  }
});

test('30/90-day windows remain available and all retains undated records while deduplicating', () => {
  const records = [paper('recent', '2026-09-20'), paper('month', '2026-09-01'),
    paper('quarter', '2026-07-01'), paper('old', '2026-01-01'),
    paper('missing', undefined), paper('invalid', 'unknown'), paper('future', '2027-01-01'),
    paper('copy', undefined, { title: 'Study missing' })];
  assert.deepEqual(ids(selectPapers(records, { ...options, days: 30 })), ['recent', 'month']);
  assert.deepEqual(ids(selectPapers(records, { ...options, days: 90 })), ['recent', 'month', 'quarter']);
  const all = selectPapers(records, { ...options, days: 9999 });
  assert.equal(all.papers.length, 7);
  assert.equal(all.duplicateCount, 1);
  assert.equal(all.missingDateCount, 3);
  assert.equal(all.window.start, null);
  assert.ok(all.papers.some(item => item.id === 'future'));
  assert.ok(all.papers.some(item => item.id === 'invalid'));
});
