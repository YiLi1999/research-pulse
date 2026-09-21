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
    : { summary: '依据当前论文归纳的主要研究方向。', questions: [{ question: '提高实验与计算的精度和可靠性',
      pattern: '多篇论文共同关注受限资源下的计算可靠性。', approaches: '比较编码设计、控制策略与算法路径。',
      gaps: '统一验证基准与规模扩展仍有待解决。', focus: '结合逐篇证据。', groupIds: input.candidates.map(candidate => candidate.id) }] };
}

async function setup(t, chat, { papers: inputPapers, now } = {}) {
  const { build } = await import('esbuild');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rp-vercel-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, 'visitorClient.js');
  await build({ entryPoints: [fileURLToPath(new URL('../browser/visitorClient.js', import.meta.url))], outfile: bundle,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  const index = (await readFile(path.join(publicDirectory, 'index.html'), 'utf8'))
    .replace('<head>', '<head><meta name="rp-runtime" content="vercel">');
  const date = new Date((now ? new Date(now).getTime() : Date.now()) - 3600000).toISOString();
  const papers = inputPapers || [
    { id: 'q1', title: 'Quantum computing with qubits', abstract: 'Entanglement and error correction.', date, source: 'arXiv' },
    { id: 'q2', title: 'Quantum algorithms with logical qubits', abstract: 'Fault tolerant quantum computing.', date, source: 'arXiv' },
    { id: 'a1', title: 'Galaxies and cosmic expansion', abstract: 'Astrophysics and cosmology with stars.', date, source: 'arXiv' }
  ];
  let dashboard = { papers, config: { timezone: 'Asia/Shanghai' }, state: { lastRefreshAt: date } };
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.get('/', (_request, response) => response.type('html').send(index));
  app.get('/visitorClient.js', (_request, response) => response.sendFile(bundle));
  app.get('/data/dashboard.json', (_request, response) => response.json(dashboard));
  app.post('/api/chat', chat);
  app.use(express.static(publicDirectory));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const address = `http://127.0.0.1:${server.address().port}`;
  async function newPage({ timezoneId, view = 'overview', context: existingContext } = {}) {
    const context = existingContext || await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(timezoneId ? { timezoneId } : {}) });
    if (!existingContext) await context.route('https://fonts.googleapis.com/**', route => route.abort());
    const page = await context.newPage();
    if (now) await page.clock.setFixedTime(new Date(now));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${address}/?view=${view}`);
    await page.waitForFunction(() => document.querySelectorAll('.field-card').length === 15
      && /^\d+$/.test(document.querySelector('#paperCount').textContent));
    return { page, context, errors };
  }
  function setDataset(nextPapers, lastRefreshAt = date) {
    dashboard = { ...dashboard, papers: nextPapers, state: { lastRefreshAt } };
  }
  return { browser, newPage, papers, address, setDataset };
}

async function waitForPaperCounts(page, count) {
  await page.waitForFunction(expected => Number(document.querySelector('#paperCount').textContent) === expected
    && parseInt(document.querySelector('.field-card[data-field=""] strong')?.textContent, 10) === expected, count);
}

test('Vercel browser: latest papers and trends share the site calendar window after ranking changes', { timeout: 60000 }, async t => {
  const now = '2026-09-20T16:30:00.000Z'; // September 21, 00:30 in the configured site timezone.
  const paper = (id, date, extra = {}) => ({ id, title: `Quantum ${id}`, abstract: 'Quantum computing.', source: 'arXiv', date, ...extra });
  const papers = [
    paper('window-start', '2026-09-14T16:00:00.000Z'),
    paper('date-only-today', '2026-09-21'),
    paper('site-local-time', '2026-09-15T00:05:00'),
    paper('submitted-fallback', undefined, { submittedAt: '2026-09-19T02:00:00.000Z' }),
    paper('date-only-today', '2026-09-21'),
    paper('just-before-window', '2026-09-14T15:59:59.999Z'),
    paper('earlier-this-month', '2026-09-01T10:00:00.000Z'),
    paper('archive', '1980-01-01'),
    paper('later-today', '2026-09-20T16:31:00.000Z'),
    paper('tomorrow', '2026-09-22'),
    paper('missing-date', undefined),
    paper('invalid-date', 'not-a-date')
  ];
  let modelCalls = 0;
  const { newPage } = await setup(t, (_request, response) => { modelCalls++; response.sendStatus(500); }, { papers, now });
  for (const timezoneId of ['Asia/Shanghai', 'America/Los_Angeles']) {
    const { page, context, errors } = await newPage({ timezoneId, view: 'papers' });
    await waitForPaperCounts(page, 4);
    assert.equal(await page.locator('#days').inputValue(), '7');
    assert.equal(await page.locator('#journal').inputValue(), '');
    assert.deepEqual((await page.locator('#paperList h3').allTextContents()).sort(), [
      'Quantum date-only-today', 'Quantum site-local-time', 'Quantum submitted-fallback', 'Quantum window-start'
    ]);
    assert.match(await page.locator('#fieldOverviewSummary').textContent(), /2026-09-15 — 2026-09-21/);
    assert.match(await page.locator('#concernScope').textContent(), /Asia\/Shanghai/);

    await page.locator('#keywordInput').fill('window-start');
    await page.locator('#keywordWeight').fill('17');
    await page.locator('#keywordAdd').click();
    await page.waitForFunction(() => document.querySelector('#rankSaveStatus').dataset.state === 'saved'
      && localStorage.getItem('rp-visitor-weights')?.includes('window-start'));
    await waitForPaperCounts(page, 4);
    assert.equal(await page.locator('#paperList h3').first().innerText(), 'Quantum window-start');

    await page.locator('#days').selectOption('30');
    assert.equal(await page.locator('#paperCount').innerText(), '6');
    await page.locator('#days').selectOption('9999');
    assert.equal(await page.locator('#paperCount').innerText(), '11', 'All keeps the complete deduplicated archive');
    await page.locator('#clear').click();
    await waitForPaperCounts(page, 4);
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.equal(modelCalls, 0, 'browsing counts and saving ranking weights never invoke AI');
});

test('Vercel browser: refresh replaces the snapshot used by both paper counts', { timeout: 60000 }, async t => {
  const now = '2026-09-20T16:30:00.000Z';
  const paper = id => ({ id, title: `Quantum ${id}`, date: '2026-09-21', source: 'arXiv' });
  const { newPage, setDataset } = await setup(t, (_request, response) => response.sendStatus(500), {
    now, papers: [paper('initial')]
  });
  const { page, errors } = await newPage({ timezoneId: 'America/Los_Angeles', view: 'papers' });
  await waitForPaperCounts(page, 1);
  setDataset([paper('replacement-one'), paper('replacement-two')], now);
  await page.locator('#refresh').click();
  await waitForPaperCounts(page, 2);
  assert.deepEqual((await page.locator('#paperList h3').allTextContents()).sort(), [
    'Quantum replacement-one', 'Quantum replacement-two'
  ]);
  await page.locator('.nav[data-view="overview"]').click();
  assert.match(await page.locator('#concernScope').innerText(), /当前匹配 2 篇 \/ 近7天共 2 篇/);
  assert.deepEqual(errors, []);
});

async function fillApi(page, connection = api) {
  await page.locator('#trendBaseUrl').fill(connection.baseUrl);
  await page.locator('#trendApiKey').fill(connection.apiKey);
  await page.locator('#trendModel').fill(connection.model);
}

async function assertApi(page, connection = api) {
  assert.equal(await page.locator('#trendBaseUrl').inputValue(), connection.baseUrl);
  assert.equal(await page.locator('#trendApiKey').inputValue(), connection.apiKey);
  assert.equal(await page.locator('#trendModel').inputValue(), connection.model);
}

function assertDedicatedCredentialStorage(stored, connection = api) {
  const { 'rp-trend-api': savedApi, ...otherLocal } = stored.local;
  assert.deepEqual(JSON.parse(savedApi), connection);
  const otherStorage = JSON.stringify({ local: otherLocal, session: stored.session, records: stored.records });
  assert.ok(!otherStorage.includes(connection.apiKey), 'the key is saved only in the dedicated API configuration');
  assert.ok(!otherStorage.includes(connection.baseUrl), 'report caches and session storage contain no endpoint credentials');
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

test('Vercel browser: API settings survive reopening, synchronize tabs and keep a cleared key cleared', { timeout: 60000 }, async t => {
  let modelCalls = 0;
  const { newPage } = await setup(t, (_request, response) => { modelCalls++; response.sendStatus(500); });
  const first = await newPage();
  const posts = [];
  first.context.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await fillApi(first.page);
  assertDedicatedCredentialStorage(await storageContents(first.page));
  await first.page.close();

  const reopened = await newPage({ context: first.context });
  await assertApi(reopened.page);
  assert.equal(await reopened.page.locator('#analyzeConcerns').isDisabled(), false);
  const secondTab = await newPage({ context: first.context });
  await assertApi(secondTab.page);
  const nextApi = { ...api, baseUrl: 'https://another.example.com/v1', model: 'updated-model' };
  await fillApi(reopened.page, nextApi);
  await secondTab.page.waitForFunction(expected => document.querySelector('#trendBaseUrl').value === expected.baseUrl
    && document.querySelector('#trendModel').value === expected.model, nextApi);
  await assertApi(secondTab.page, nextApi);

  await reopened.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await reopened.page.locator('#trendApiKey').inputValue(), '');
  assertDedicatedCredentialStorage(await storageContents(reopened.page), nextApi);
  await reopened.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await assertApi(reopened.page, nextApi);

  await reopened.page.locator('#clearTrendApi').click();
  await secondTab.page.waitForFunction(() => document.querySelector('#trendApiKey').value === '');
  for (const current of [reopened.page, secondTab.page]) {
    await assertApi(current, { ...nextApi, apiKey: '' });
    assert.equal(await current.locator('#analyzeConcerns').isDisabled(), true);
    assert.equal(await current.locator('#checkTrendCache').isDisabled(), true);
    const stored = await storageContents(current);
    const config = JSON.parse(stored.local['rp-trend-api']);
    assert.equal(config.baseUrl, nextApi.baseUrl);
    assert.equal(config.model, nextApi.model);
    assert.ok(!config.apiKey);
    assert.ok(!JSON.stringify(stored).includes(api.apiKey), 'clearing removes the key from persistent storage');
  }
  await reopened.page.reload();
  await reopened.page.waitForFunction(() => document.querySelectorAll('.field-card').length === 15);
  await assertApi(reopened.page, { ...nextApi, apiKey: '' });
  assert.equal(await reopened.page.locator('#analyzeConcerns').isDisabled(), true);
  assert.equal(modelCalls, 0);
  assert.deepEqual(posts, [], 'typing, reopening, tab synchronization and restoring pages must not submit credentials');
  assert.deepEqual([...first.errors, ...reopened.errors, ...secondTab.errors], []);
});

test('Vercel browser: unavailable API storage leaves settings usable and reports that they were not saved', { timeout: 60000 }, async t => {
  let modelCalls = 0;
  const { newPage } = await setup(t, (_request, response) => { modelCalls++; response.sendStatus(500); });
  const { page, errors } = await newPage();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'rp-trend-api') throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
  });
  await fillApi(page);
  await assertApi(page);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), false);
  assert.match(await page.locator('#trendApiStatus').innerText(), /未能|无法|失败/);
  assert.equal(await page.evaluate(() => localStorage.getItem('rp-trend-api')), null);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
});

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
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('趋势分析完成'));
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
  assertDedicatedCredentialStorage(stored);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#trendMajor').value === 'quantum');
  await assertApi(page);
  assert.equal(await page.locator('#questions .concern-question').count(), 0);
  assert.equal(await page.locator('#analyzeConcerns').isDisabled(), false);
  assert.equal(requests.length, 2);
  await page.locator('#checkTrendCache').click();
  await page.waitForSelector('#questions .concern-question');
  assert.equal(requests.length, 2, 'explicit cache restore makes no model calls');
  await page.locator('.field-card[data-field=""]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 3 篇'));
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('本次可复用 2 篇'));
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('趋势分析完成'));
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
  assert.equal(await second.page.evaluate(() => localStorage.getItem('rp-trend-api')), null);
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

test('Vercel browser: all 25 papers are analyzed while broad directions and isolated evidence remain separate', { timeout: 60000 }, async t => {
  const now = '2026-09-21T05:00:00.000Z';
  const papers = Array.from({ length: 25 }, (_, index) => ({ id: `q${index + 1}`,
    title: index === 24 ? 'Quantum isolated geometry proposal' : `Quantum error correction study ${index + 1}`,
    abstract: index === 24 ? 'An isolated geometry proposal.' : `Comparison of quantum error correction approach ${index + 1}.`,
    source: 'arXiv', date: '2026-09-21' }));
  const extracted = [];
  let modelCalls = 0;
  const { newPage } = await setup(t, (request, response) => {
    modelCalls++;
    const input = JSON.parse(request.body.messages.at(-1).content);
    if (input.papers) {
      extracted.push(...input.papers.map(paper => paper.title));
      response.json({ result: { papers: input.papers.map(paper => ({ id: paper.id, questions: [{
        question: paper.title.includes('isolated') ? '孤立的几何方案' : '如何降低量子纠错开销？', focus: paper.abstract
      }] })) } });
      return;
    }
    const grouped = input.candidates.filter(candidate => candidate.question !== '孤立的几何方案');
    response.json({ result: { summary: '本周样本主要围绕量子纠错资源效率，比较编码与译码两条路径。',
      questions: [{ question: '降低量子纠错的资源开销', pattern: '多篇研究共同推进有限资源下的可靠计算。',
        approaches: '编码设计与译码算法是两条主要路径。', gaps: '共同瓶颈是规模扩展和统一评测。',
        groupIds: grouped.map(candidate => candidate.id) }],
      unassignedGroupIds: input.candidates.filter(candidate => candidate.question === '孤立的几何方案').map(candidate => candidate.id) } });
  }, { papers, now });
  const { page, errors } = await newPage();
  await fillApi(page);
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('趋势分析完成'));
  assert.equal(new Set(extracted).size, 25, 'every selected paper is read, including papers beyond the old visible ten');
  assert.equal(extracted.length, 25);
  assert.equal(await page.locator('.concern-coverage').innerText(), '完整分析 25/25 篇');
  assert.equal(await page.locator('.concern-directions-title').innerText(), '主要研究方向（1 个）');
  assert.equal(await page.locator('#questions .concern-question').count(), 1);
  assert.match(await page.locator('.concern-question').innerText(), /主要路径与差异/);
  assert.match(await page.locator('.concern-question').innerText(), /共同瓶颈/);
  assert.equal(await page.locator('.concern-question .concern-evidence li').count(), 24);
  assert.equal(await page.locator('.concern-unassigned li').count(), 1);
  assert.equal(await page.locator('.concern-unassigned').getAttribute('open'), null);
  const afterAnalysis = modelCalls;
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#checkTrendCache').disabled);
  await page.locator('#checkTrendCache').click();
  await page.waitForSelector('.concern-coverage');
  assert.equal(await page.locator('.concern-coverage').innerText(), '完整分析 25/25 篇');
  assert.equal(modelCalls, afterAnalysis, 'restoring the complete report keeps every analyzed paper without paid calls');
  assert.deepEqual(errors, []);
});

test('Vercel browser: per-paper output is marked incomplete and can retry synthesis using saved notes', { timeout: 60000 }, async t => {
  let useSharedTrend = false;
  const requests = [];
  const { newPage } = await setup(t, (request, response) => {
    requests.push(request.body);
    const input = JSON.parse(request.body.messages.at(-1).content);
    const result = modelAnswer(request.body);
    if (input.candidates && !useSharedTrend) {
      result.questions = input.candidates.map(candidate => ({ question: candidate.question, focus: candidate.focus, groupIds: [candidate.id] }));
    }
    response.json({ result });
  });
  const { page, errors } = await newPage();
  await page.locator('.field-card[data-field="quantum"]').click();
  await page.waitForFunction(() => document.querySelector('#concernScope').textContent.includes('当前匹配 2 篇'));
  await fillApi(page);
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').dataset.state === 'warning'
    && !document.querySelector('#analyzeConcerns').disabled);
  assert.match(await page.locator('#concernStatus').innerText(), /趋势汇总未充分完成/);
  assert.equal(await page.locator('#analyzeConcerns').innerText(), '重试趋势归纳');
  assert.equal(await page.locator('.concern-coverage').innerText(), '已读取 2/2 篇 · 趋势汇总未充分完成');
  assert.equal(await page.locator('.concern-question').count(), 0, 'single-paper groups must not become trend cards');
  assert.equal(await page.locator('.concern-unassigned li').count(), 2);
  assert.equal(requests.length, 2, 'incomplete synthesis cannot trigger an automatic paid retry');
  const incompleteStorage = await storageContents(page);
  assert.equal(incompleteStorage.records.filter(row => row.key.startsWith('paper:')).length, 2);
  assert.equal(incompleteStorage.records.filter(row => row.key.startsWith('report:')).length, 0);
  useSharedTrend = true;
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('趋势分析完成'));
  assert.equal(requests.length, 3, 'manual retry only synthesizes the already saved paper notes');
  assert.equal(await page.locator('.concern-coverage').innerText(), '完整分析 2/2 篇');
  assert.equal(await page.locator('.concern-question').count(), 1);
  assert.deepEqual(errors, []);
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
  await assertApi(page);
  await page.locator('#checkTrendCache').click();
  await page.waitForFunction(() => document.querySelector('#concernIncremental').textContent.includes('本次可复用 2 篇'));
  assert.equal(requests.length, 2, 'reloading and checking retained notes do not invoke the model');
  await page.locator('#analyzeConcerns').click();
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('趋势分析完成'));
  assert.equal(requests.length, 3, 'manual retry makes only the synthesis request');
  assert.equal(requests.filter(body => JSON.parse(body.messages.at(-1).content).papers).length, 1);
  assert.equal(synthesisCalls, 2);
  assert.ok((await page.locator('#questions').innerText()).includes('复用 2 篇 · 新分析 0 篇'));
  assert.equal(await page.locator('#questions .concern-question').count(), 5);
  assert.match(await page.locator('#questions .concern-coverage').innerText(), /完整分析 2\/2 篇/);
  const afterRetry = await storageContents(page);
  assert.deepEqual(afterRetry.records.filter(row => row.key.startsWith('paper:')), savedNotes);
  assert.equal(afterRetry.records.filter(row => row.key.startsWith('report:')).length, 1);
  assertDedicatedCredentialStorage(afterRetry);
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
  await page.waitForFunction(() => document.querySelector('#concernStatus').textContent.startsWith('趋势分析完成'));
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.slice(1).map(request => request.api.apiKey), [nextApi.apiKey, nextApi.apiKey]);
  const stored = await storageContents(page);
  assert.ok(!JSON.stringify(stored).includes(api.apiKey), 'the cleared key must be removed from all storage');
  assertDedicatedCredentialStorage(stored, nextApi);
  assert.deepEqual(errors, []);
});
