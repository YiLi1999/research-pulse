import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from './server.js';
import { createConcernService } from '../services/concernService.js';

const visitorApi = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-visitor-secret', model: 'test-model' };
async function enterApi(page, value = visitorApi) {
  await page.locator('#trendBaseUrl').fill(value.baseUrl);
  await page.locator('#trendApiKey').fill(value.apiKey);
  await page.locator('#trendModel').fill(value.model);
}

test('browser: visitor API settings persist locally; field counts and incremental cache remain available', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rp-overview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const papers = [
    { id: 'q1', title: 'Quantum computing with qubits', abstract: 'Entanglement and error correction.', date: '2026-08-31' },
    { id: 'q2', title: 'Quantum algorithms with logical qubits', abstract: 'Fault tolerant quantum computing.', date: '2026-08-31' },
    { id: 'm1', title: 'Atomic clocks', abstract: 'Precision measurement using atoms.', date: '2026-08-31' }
  ];
  let extractionPapers = [], now = new Date('2026-08-31T10:00:00Z'), calls = 0;
  const concerns = createConcernService({ storageDir: directory, now: () => now,
    loadPapers: async () => papers, loadState: async () => ({}),
    getEngine: async api => !api ? { available: false, provider: 'api', requiresConfiguration: true, authMode: 'visitor-api-key', signature: ['unconfigured'] }
      : ({ available: true, provider: 'api', model: api.model, label: 'Test API', signature: ['test'], concurrency: 1,
      chat: async messages => {
        calls++; const input = JSON.parse(messages.at(-1).content);
        if (input.papers) { extractionPapers.push(...input.papers); return { papers: input.papers.map(p => ({ id: p.id, questions: [{ question: '如何控制量子错误？', focus: p.title }] })) }; }
        return { summary: '量子纠错研究。', questions: [{ question: '如何控制量子错误？', focus: '结合全部逐篇证据。', groupIds: input.candidates.map(c => c.id) }] };
      } }) });
  const server = createServer({ concerns }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve))); await once(server, 'listening');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const requests = [];
  page.on('request', request => { if (request.url().includes('/api/trends/')) requests.push({ url: request.url(), method: request.method(), body: request.postDataJSON() }); });
  await page.route('**/api/papers', route => route.fulfill({ json: { papers: [], state: {} } }));
  await page.route('**/api/scoring', route => route.fulfill({ json: { keywordWeights: {} } }));
  await page.goto(`http://127.0.0.1:${server.address().port}/?view=overview`);
  await page.waitForFunction(() => document.querySelectorAll('.field-card').length === 15);
  assert.equal(calls, 0);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  assert.equal(await page.locator('[data-view="network"], #network').count(), 0);
  const counts = await page.locator('.field-card strong').allTextContents();
  const numbers = counts.slice(1).map(v => parseInt(v, 10));
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a));
  await page.locator('.field-card[data-field="quantum"]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 2 篇'));
  assert.equal(await page.locator('#trendMajor').inputValue(), 'quantum');
  assert.equal(calls, 0, 'selecting a card must not invoke AI');
  await enterApi(page);
  assert.equal(requests.filter(request => request.method === 'POST').length, 0, 'entering a key does not send it');
  assert.equal(await page.locator('#trendApiKey').getAttribute('type'), 'password');
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('变化的 2 篇'));
  assert.equal(calls, 0, 'checking cache must not invoke AI');
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('分析完成'));
  assert.equal(extractionPapers.length, 2);
  assert.ok((await page.locator('#concernIncremental').innerText()).includes('本次可复用 2 篇'));
  const before = calls;
  const postsBeforeReload = requests.filter(request => request.method === 'POST').length;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#trendMajor').value === 'quantum');
  assert.equal(await page.locator('#trendBaseUrl').inputValue(), visitorApi.baseUrl);
  assert.equal(await page.locator('#trendApiKey').inputValue(), visitorApi.apiKey);
  assert.equal(await page.locator('#trendModel').inputValue(), visitorApi.model);
  assert.equal(await page.locator('#questions .concern-question').count(), 0);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), false);
  assert.equal(requests.filter(request => request.method === 'POST').length, postsBeforeReload, 'restoring saved settings does not send them');
  await page.locator('#checkTrendCache').click();
  await page.waitForSelector('#questions .concern-question');
  assert.equal(calls, before);
  now = new Date('2026-09-01T10:00:00Z');
  papers.push({ id: 'a-new', title: 'Quantum computer control', abstract: 'Quantum error correction with new gates.', date: '2026-09-01' });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#trendMajor').value === 'quantum');
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('变化的 1 篇'));
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('分析完成'));
  assert.equal(extractionPapers.length, 3, 'only the added paper is sent for extraction');
  assert.ok((await page.locator('#questions').innerText()).includes('复用 2 篇 · 新分析 1 篇'));
  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const { 'rp-trend-api': savedApi, ...otherLocal } = storage.local;
  assert.deepEqual(JSON.parse(savedApi), visitorApi);
  const otherStorage = JSON.stringify({ local: otherLocal, session: storage.session });
  assert.ok(!otherStorage.includes(visitorApi.apiKey) && !otherStorage.includes(visitorApi.baseUrl) && !otherStorage.includes(visitorApi.model));
  assert.ok(requests.every(request => !request.url.includes(visitorApi.apiKey)), 'API keys never enter GET URLs');
  const starts = requests.filter(request => request.url.endsWith('/api/trends/analyze'));
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0].body, { majorField: 'quantum', minorField: '', api: visitorApi });
  await page.locator('#trendModel').fill('another-model');
  assert.equal(await page.locator('#questions .concern-question').count(), 0, 'changing API identity clears the old report');
  await page.locator('#clearTrendApi').click();
  assert.equal(await page.locator('#trendApiKey').inputValue(), '');
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  assert.equal(await page.locator('#checkTrendCache').isDisabled(), true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#trendMajor').value === 'quantum');
  assert.equal(await page.locator('#trendBaseUrl').inputValue(), visitorApi.baseUrl);
  assert.equal(await page.locator('#trendApiKey').inputValue(), '');
  assert.equal(await page.locator('#trendModel').inputValue(), 'another-model');
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  assert.ok(!(await page.evaluate(() => localStorage.getItem('rp-trend-api'))).includes(visitorApi.apiKey));
  await enterApi(page, { ...visitorApi, baseUrl: 'http://api.example.com/v1' });
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true, 'plain HTTP endpoints are not accepted');
  await enterApi(page);
  const emptyField = await page.locator('.field-card').evaluateAll(cards => cards.find(card => card.querySelector('strong').textContent.startsWith('0'))?.dataset.field);
  assert.ok(emptyField);
  await page.locator(`.field-card[data-field="${emptyField}"]`).click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 0 篇'));
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.lang-btn[data-lang="en"]').click();
  assert.equal(await page.locator('#fieldOverviewTitle').innerText(), 'Compare publication counts');
  assert.deepEqual(errors, []);
});

test('browser: clearing a key during polling discards the old job and sends no more polling requests', { timeout: 30000 }, async t => {
  const catalog = [{ id: 'quantum', label: 'Quantum', count: 1, children: [] }];
  const metadata = { catalog, coverage: { recentCount: 1, selectedCount: 1, abstractCount: 1, duplicateCount: 0, missingDateCount: 0 },
    window: { start: '2026-09-01', end: '2026-09-07', timezone: 'UTC' }, llmAvailable: false };
  const server = createServer({ concerns: { getOptions: async () => metadata,
    start: async () => ({ id: 'pending-job', status: 'running', progress: {} }) } }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve))); await once(server, 'listening');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/papers', route => route.fulfill({ json: { papers: [], state: {} } }));
  await page.route('**/api/scoring', route => route.fulfill({ json: { keywordWeights: {} } }));
  let pollCount = 0, releasePoll;
  const pollStarted = new Promise(resolve => { releasePoll = resolve; });
  let finishPoll;
  const gate = new Promise(resolve => { finishPoll = resolve; });
  await page.route('**/api/trends/jobs/*', async route => {
    pollCount++; releasePoll(); await gate;
    await route.fulfill({ json: { status: 'completed', report: { summary: 'STALE-REPORT' } } }).catch(() => {});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?view=overview`);
  await page.waitForFunction(() => document.querySelectorAll('.field-card').length === 2);
  await enterApi(page);
  await page.locator('#analyzeConcerns').click();
  await pollStarted;
  await page.locator('#clearTrendApi').click();
  finishPoll();
  await page.waitForTimeout(1700);
  assert.equal(pollCount, 1);
  assert.equal(await page.locator('#questions').innerText(), '');
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  assert.ok((await page.locator('#concernStatus').innerText()).includes('仍可能完成并产生费用'));
  assert.deepEqual(errors, []);
});
