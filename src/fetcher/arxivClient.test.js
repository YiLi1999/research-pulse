import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { fetchFromApi } from './arxivClient.js';
import { fetchLatestPapers, dedupePapers } from './index.js';
import { categoryQuery, mathCategories } from './arxivCategories.js';
import { classifyPaper } from '../analyzer/researchFields.js';

const entry = (id, date, category = 'math.NT') => `<entry><id>https://arxiv.org/abs/${id}</id><title>Study ${id}</title><summary>Full mathematical abstract.</summary><published>${date}T10:00:00Z</published><updated>${date}T10:00:00Z</updated><author><name>Alice</name></author><arxiv:primary_category term="${category}"/><category term="${category}"/></entry>`;
const feed = (entries, total = 10000) => `<feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${total}</opensearch:totalResults>${entries.join('')}</feed>`;

test('math API query covers all official subcategories and paginates until the date cutoff', async () => {
  const starts = [];
  const result = await fetchFromApi({ category: 'math', pageSize: 2, maxPages: 5, cutoff: DateTime.fromISO('2026-08-31'), request: async value => {
    const url = new URL(value), start = Number(url.searchParams.get('start')); starts.push(start);
    assert.equal(url.searchParams.get('search_query'), categoryQuery('math'));
    return start === 0 ? feed([entry('onev1', '2026-09-05'), entry('twov1', '2026-09-04')])
      : feed([entry('threev1', '2026-08-31'), entry('oldv1', '2026-08-30')]);
  } });
  assert.deepEqual(starts, [0, 2]); assert.equal(result.complete, true); assert.equal(result.papers.length, 3);
  assert.equal(result.papers[0].primaryCategory, 'math.NT');
  assert.equal(result.papers[0].abstract, 'Full mathematical abstract.');
  assert.equal(mathCategories.length, 32);
});

test('a full page at the configured cap is marked partial, and malformed feeds are rejected', async () => {
  const result = await fetchFromApi({ category: 'math', pageSize: 1, maxPages: 1, cutoff: DateTime.fromISO('2026-08-31'), request: async () => feed([entry('onev1', '2026-09-05')]) });
  assert.equal(result.complete, false);
  await assert.rejects(fetchFromApi({ category: 'math', request: async () => '<html>Not a feed</html>' }), /无效 Atom/);
});

test('independent feeds retain failed-category caches and deduplicate math/quantum cross-lists by version', async () => {
  const cached = { id: 'sharedv1', primaryCategory: 'quant-ph', categories: ['quant-ph', 'math.MP'], abstract: 'Old.', submittedAt: '2026-09-01' };
  const other = { id: 'quantum-onlyv1', primaryCategory: 'quant-ph', submittedAt: '2026-09-01' };
  const result = await fetchLatestPapers({ categories: ['quant-ph', 'math'], existingPapers: [cached, other],
    fetchApi: async ({ category }) => { if (category === 'quant-ph') throw new Error('offline'); return { complete: true, papers: [{ ...cached, id: 'sharedv2', abstract: 'Revised.' }] }; },
    fetchRecent: async () => { throw new Error('offline'); } });
  assert.equal(result.papers.length, 2);
  assert.equal(result.papers.find(p => p.id === 'sharedv2').abstract, 'Revised.');
  assert.equal(result.collections[0].status, 'cached'); assert.equal(result.collections[1].status, 'updated');
  const reverse = dedupePapers([{ ...cached, id: 'sharedv2', abstract: 'Revised.' }, cached]);
  assert.equal(reverse[0].id, 'sharedv2'); assert.equal(reverse[0].abstract, 'Revised.');
});

test('all math category tags map to a math subfield without labeling all math as AI', () => {
  for (const category of mathCategories) {
    const fields = classifyPaper({ title: 'A theorem', primaryCategory: category, categories: [category] });
    const math = fields.find(field => field.id === 'mathematics');
    assert.ok(math?.children.length, `No subfield for ${category}`);
    assert.ok(!fields.some(field => field.id === 'interdisciplinary'));
  }
  const fields = classifyPaper({ title: 'Quantum entanglement', categories: ['quant-ph', 'math.MP'] });
  assert.ok(fields.some(f => f.id === 'quantum-information'));
  assert.deepEqual(fields.find(f => f.id === 'mathematics').children, ['mathematical-physics']);
  assert.deepEqual(classifyPaper({ categories: ['math-ph'], title: 'A theorem' }).find(f => f.id === 'mathematics').children, ['mathematical-physics']);
  assert.deepEqual(classifyPaper({ categories: ['cs.IT'], title: 'A theorem' }).find(f => f.id === 'mathematics').children, ['discrete-information']);
});
