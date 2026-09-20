import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright';

const api = { baseUrl: 'https://api.example.com/compatible-mode/v1', apiKey: 'sk-vercel-secret-visitor-one', model: 'test-model' };
const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));

function modelAnswer(body) {
  const input = JSON.parse(body.messages.at(-1).content);
  return input.papers ? { papers: input.papers.map(paper => ({ id: paper.id,
    questions: [{ question: '如何提高实验与计算精度？', focus: paper.title }] })) }
    : { summary: '依据当前论文汇总的研究问题。', questions: [{ question: '如何提高实验与计算精度？', focus: '结合逐篇证据。', groupIds: input.candidates.map(candidate => candidate.id) }] };
}

async function setup(t, chat) {
  const { build } = await import('esbuild');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rp-vercel-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, 'visitorClient.js');
  await build({ entryPoints: [fileURLToPath(new URL('../browser/visitorClient.js', import.meta.url))], outfile: bundle,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  const index = (await readFile(path.join(publicDirectory, 'index.html'), 'utf8'))
    .replace('<head>', '<head><meta name="rp-runtime" content="vercel">');
  const date = new Date(Date.now() - 3600000).toISOString();
  const papers = [
    { id: 'q1', title: 'Quantum computing with qubits', abstract: 'Entanglement and error correction.', date, source: 'arXiv' },
    { id: 'q2', title: 'Quantum algorithms with logical qubits', abstract: 'Fault tolerant quantum computing.', date, source: 'arXiv' },
    { id: 'a1', title: 'Galaxies and cosmic expansion', abstract: 'Astrophysics and cosmology with stars.', date, source: 'arXiv' }
  ];
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.get('/', (_request, response) => response.type('html').send(index));
  app.get('/visitorClient.js', (_request, response) => response.sendFile(bundle));
  app.get('/data/dashboard.json', (_request, response) => response.json({ papers, config: { timezone: 'Asia/Shanghai' }, state: { lastRefreshAt: date } }));
  app.post('/api/chat', chat);
  app.use(express.static(publicDirectory));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const address = `http://127.0.0.1:${server.address().port}`;
  async function newPage() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${address}/?view=overview`);
    await page.waitForFunction(() => document.querySelectorAll('.field-card').length === 15);
    return { page, context, errors };
  }
  return { browser, newPage, papers, address };
}

async function fillApi(page, connection = api) {
  await page.locator('#trendBaseUrl').fill(connection.baseUrl);
  await page.locator('#trendApiKey').fill(connection.apiKey);
  await page.locator('#trendModel').fill(connection.model);
}

async function storageContents(page) {
  return page.evaluate(async () => {
    const records = [];
    for (const database of await indexedDB.databases()) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(database.name);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      for (const store of db.objectStoreNames) {
        records.push(...await new Promise((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).openCursor();
          const rows = [];
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(rows); return; }
            rows.push({ database: database.name, store, key: cursor.key, value: cursor.value }); cursor.continue();
          };
          request.onerror = () => reject(request.error);
        }));
      }
      db.close();
    }
    return { local: { ...localStorage }, session: { ...sessionStorage }, records };
  });
}

test('Vercel browser: own API, IndexedDB cache, scope reuse and isolated visitor preferences', { timeout: 90000 }, async t => {
  const requests = [], extractionTitles = [];
  const { newPage } = await setup(t, (request, response) => {
    requests.push(request.body);
    const input = JSON.parse(request.body.messages.at(-1).content);
    if (input.papers) extractionTitles.push(...input.papers.map(paper => paper.title));
    response.json({ result: modelAnswer(request.body) });
  });
  const { page, errors } = await newPage();
  const urls = []; page.on('request', request => urls.push(request.url()));
  assert.equal(requests.length, 0);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  assert.ok((await page.locator('#trendApiPrivacy').innerText()).includes('保存在本浏览器'));
  assert.ok((await page.locator('#brief').innerText()).includes('每天统一更新'));
  await page.locator('.field-card[data-field="quantum"]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 2 篇'));
  assert.equal(requests.length, 0);
  await fillApi(page);
  assert.equal(requests.length, 0, 'typing credentials must not invoke AI');
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('变化的 2 篇'));
  assert.equal(requests.length, 0);
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('分析完成'));
  assert.equal(requests.length, 2, 'two-paper analysis extracts once and synthesizes once');
  assert.equal(extractionTitles.length, 2);
  for (const body of requests) {
    assert.deepEqual(body.api, api);
    assert.ok(body.options.maxTokens > 0);
  }
  const stored = await storageContents(page);
  assert.equal(stored.records.filter(row => row.key.startsWith('paper:')).length, 2);
  assert.equal(stored.records.filter(row => row.key.startsWith('report:')).length, 1);
  assert.ok(stored.records.every(row => /^(paper|report):[a-f0-9]{64}$/.test(row.key)));
  assert.ok(!JSON.stringify(stored).includes(api.apiKey), 'no API key in stored values or IndexedDB keys');
  assert.ok(!JSON.stringify(stored).includes(api.baseUrl), 'the base URL is not stored in plaintext');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#trendMajor').value === 'quantum');
  assert.equal(await page.locator('#trendApiKey').inputValue(), '');
  assert.equal(await page.locator('#questions .concern-question').count(), 0);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  assert.equal(requests.length, 2);
  await fillApi(page);
  await page.locator('#checkTrendCache').click();
  await page.waitForSelector('#questions .concern-question');
  assert.equal(requests.length, 2, 'explicit cache restore makes no model calls');
  await page.locator('.field-card[data-field=""]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 3 篇'));
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('本次可复用 2 篇'));
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('分析完成'));
  assert.equal(extractionTitles.length, 3, 'changing to all fields only extracts the newly included paper');
  assert.ok((await page.locator('#questions').innerText()).includes('复用 2 篇 · 新分析 1 篇'));
  assert.equal(requests.length, 4);

  await page.locator('.nav[data-view="papers"]').click();
  await page.locator('#keywordInput').fill('personal visitor phrase');
  await page.locator('#keywordWeight').fill('17');
  await page.locator('#keywordAdd').click();
  await page.waitForFunction(() => localStorage.getItem('rp-visitor-weights')?.includes('personal visitor phrase'));
  assert.ok((await page.locator('#rankPersistence').innerText()).includes('保存在当前浏览器'));
  const second = await newPage();
  assert.equal(await second.page.locator('#trendApiKey').inputValue(), '');
  assert.equal(await second.page.locator('#trendMajor').inputValue(), '');
  await fillApi(second.page);
  await second.page.locator('#checkTrendCache').click();
  await second.page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('本次可复用 0 篇'));
  assert.equal(await second.page.locator('#questions .concern-question').count(), 0);
  const isolatedStorage = await storageContents(second.page);
  assert.equal(isolatedStorage.records.length, 0);
  assert.ok(!JSON.stringify(isolatedStorage.local).includes('personal visitor phrase'));
  assert.equal(requests.length, 4, 'another browser cannot see or reuse the first browser cache');
  assert.ok(urls.every(url => !url.includes(api.apiKey)));
  await page.locator('.nav[data-view="overview"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.lang-btn[data-lang="en"]').click();
  assert.equal(await page.locator('#trendApiTitle').innerText(), 'Analyze with your own API');
  assert.ok((await page.locator('#trendApiPrivacy').innerText()).includes('this browser'));
  assert.deepEqual(errors, []); assert.deepEqual(second.errors, []);
});

test('Vercel browser: malformed synthesis preserves notes and an oversized retry succeeds without extra calls', { timeout: 60000 }, async t => {
  const requests = [];
  let synthesisCalls = 0;
  const { newPage } = await setup(t, (request, response) => {
    requests.push(request.body);
    const input = JSON.parse(request.body.messages.at(-1).content);
    if (input.candidates && ++synthesisCalls === 1) {
      response.json({ result: { summary: 'This response deliberately omits the required questions array.' } });
      return;
    }
    const result = modelAnswer(request.body);
    if (input.candidates) result.questions = Array.from({ length: 15 }, (_, index) => ({
      ...result.questions[0], question: `问题 ${index + 1}：如何提高实验与计算精度？`
    }));
    response.json({ result });
  });
  const { page, errors } = await newPage();
  await page.locator('.field-card[data-field="quantum"]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 2 篇'));
  await fillApi(page);
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').dataset.state === 'error');
  const failure = await page.locator('#concernStatus').innerText();
  assert.match(failure, /汇总/);
  assert.match(failure, /缓存/);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), false);
  assert.equal(await page.locator('#questions .concern-question').count(), 0);
  assert.equal(requests.length, 2, 'a malformed response must not trigger an automatic paid retry');
  const afterFailure = await storageContents(page);
  const savedNotes = afterFailure.records.filter(row => row.key.startsWith('paper:'));
  assert.equal(savedNotes.length, 2);
  assert.equal(afterFailure.records.filter(row => row.key.startsWith('report:')).length, 0);

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#trendMajor').value === 'quantum');
  assert.equal(await page.locator('#trendApiKey').inputValue(), '');
  await fillApi(page);
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('本次可复用 2 篇'));
  assert.equal(requests.length, 2, 'reloading and checking retained notes do not invoke the model');
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('分析完成'));
  assert.equal(requests.length, 3, 'manual retry makes only the synthesis request');
  assert.equal(requests.filter(body => JSON.parse(body.messages.at(-1).content).papers).length, 1);
  assert.equal(synthesisCalls, 2);
  assert.ok((await page.locator('#questions').innerText()).includes('复用 2 篇 · 新分析 0 篇'));
  assert.equal(await page.locator('#questions .concern-question').count(), 10);
  assert.match(await page.locator('#questions').innerText(), /筛选没有额外调用 API/);
  const afterRetry = await storageContents(page);
  assert.deepEqual(afterRetry.records.filter(row => row.key.startsWith('paper:')), savedNotes);
  assert.equal(afterRetry.records.filter(row => row.key.startsWith('report:')).length, 1);
  assert.ok(!JSON.stringify(afterRetry).includes(api.apiKey));
  assert.deepEqual(errors, []);
});

test('Vercel browser: clearing an in-flight key stops later calls and a new key can analyze', { timeout: 60000 }, async t => {
  const requests = [];
  let releaseFirst, firstRequest;
  const started = new Promise(resolve => { firstRequest = resolve; });
  const held = new Promise(resolve => { releaseFirst = resolve; });
  const { newPage } = await setup(t, async (request, response) => {
    requests.push(request.body);
    if (requests.length === 1) { firstRequest(); await held; }
    if (!response.destroyed) response.json({ result: modelAnswer(request.body) });
  });
  const { page, errors } = await newPage();
  await page.locator('.field-card[data-field="quantum"]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 2 篇'));
  await fillApi(page);
  await page.locator('#analyzeConcerns').click();
  await started;
  await page.locator('#clearTrendApi').click();
  releaseFirst();
  await page.waitForTimeout(1750);
  assert.equal(requests.length, 1, 'aborted extraction cannot proceed to synthesis');
  assert.equal(await page.locator('#questions').innerText(), '');
  assert.equal(await page.locator('#trendApiKey').inputValue(), '');
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), true);
  const nextApi = { ...api, apiKey: 'sk-vercel-secret-visitor-two' };
  await fillApi(page, nextApi);
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('分析完成'));
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).map(request => request.api.apiKey), [nextApi.apiKey, nextApi.apiKey]);
  const stored = JSON.stringify(await storageContents(page));
  assert.ok(!stored.includes(api.apiKey) && !stored.includes(nextApi.apiKey));
  assert.deepEqual(errors, []);
});
