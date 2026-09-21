import { apiFetch, usesBrowserRuntime } from './apiClient.js';
import { escapeHtml } from './paperCards.js';

const strings = {
  zh: { title: '大家最近在解决', major: '大领域', minor: '小领域', all: '全部领域', allMinor: '全部小领域',
    analyze: '分析近7天关注问题', analyzing: '正在分析…', retry: '重试 AI 分析',
    intro: '先查看各领域近7天的发文量，再选择你关心的方向。点击分析后，只读取新增或标题、摘要变化的论文，复用历史逐篇结果并汇总近7天的共同问题。',
    loading: '正在读取分析范围…', choose: '尚未开始分析。选择范围后点击按钮；打开页面和切换领域不会调用 AI。',
    preparing: '正在准备论文…', merge: '所有批次已读完，正在合并共同问题…',
    noPapers: '这个范围近7天没有论文。请切换领域或点击页面顶部的“刷新数据”。',
    failed: '加载失败，请点击重试。', loadRetry: '重试加载', method: '分析方法与范围说明',
    rules: '规则统计 · 非 AI 归纳', llm: 'AI 归纳 · 基于标题与摘要',
    evidence: '查看依据论文', noQuestions: '没有足够依据归纳共同问题。', abstract: '摘要片段', missing: '无摘要，依据仅为标题。',
    caveat: '分析范围为所选时区今天及前6天，截止点击时；排除旧数据、未来日期和无有效日期的条目。同一论文可跨领域。统计使用期刊栏目、标题、摘要和关键词规则，不调用 AI。AI 首次分析读取所选领域全部标题与可用摘要；以后仅分析未缓存或标题、摘要变化的论文，逐篇保存后重新汇总。跨日期和领域可复用；切换模型或分析方法会重新读取。旧版仅有整份报告，无法作为逐篇缓存。每位访客须填写自己的 API 地址、Key 和模型。只有点击分析才会调用模型，费用由该 API 账户承担。API 地址、Key 和模型保存在当前浏览器，下次打开自动填入；Key 不写入服务器数据文件或日志。清除 Key 会删除浏览器保存的密钥并停止本页跟踪，已提交的服务端任务仍可能完成并产生费用。API 调用失败时会明确标记失败，不将规则统计当作 AI 结论。分析结果保存在服务端访客空间，同一访客、数据、领域与引擎可复用；恢复相同 API 配置后可手动检查缓存，不会自动调用模型。'
  },
  en: { title: 'Questions researchers are tackling', major: 'Broad field', minor: 'Subfield', all: 'All fields', allMinor: 'All subfields',
    analyze: 'Analyze the last 7 days', analyzing: 'Analyzing…', retry: 'Retry AI analysis',
    intro: 'Compare publication counts, choose your field, then analyze new or changed papers. Saved per-paper notes are reused to synthesize the last seven days. Reports are in Chinese.',
    loading: 'Loading analysis scope…', choose: 'Choose a scope, then click Analyze. Opening this page or changing fields does not call AI.',
    preparing: 'Preparing papers…', merge: 'All batches read. Combining research questions…',
    noPapers: 'No papers in this scope in the last 7 days. Change fields or refresh the dataset.',
    failed: 'Loading failed. Please retry.', loadRetry: 'Retry loading', method: 'Method and scope',
    rules: 'Rule statistics · not AI synthesis', llm: 'AI synthesis · titles and abstracts', evidence: 'Supporting papers',
    noQuestions: 'Insufficient evidence to identify shared questions.', abstract: 'Abstract excerpt', missing: 'No abstract; title evidence only.',
    caveat: 'The window includes today and the previous six days in the configured time zone, up to the request time. Old, future-dated and undated records are excluded. Fields can overlap. Counts use local classification rules without AI. Initial analysis reads every selected title and abstract. Later runs only read uncached or changed content, save per-paper notes and synthesize the current seven-day window. Notes can be reused across dates and scopes; model or extraction changes invalidate them. Legacy whole reports are not per-paper caches. Each visitor supplies their own API base URL, key and model. Only clicking Analyze calls the model, billed to that API account. The API address, key and model are saved in this browser and restored on your next visit. Keys are not saved in server data files or logs. Clearing a key removes it from browser storage and stops this page from following the job; an already submitted server job may still finish and incur charges. API failures are explicitly identified. Successful results are saved in your visitor space on the server and reused for unchanged data, scope and engine. With the same API configuration restored, explicitly check the cache to restore a result. Restoring settings does not call the model.'
  }
};

if (usesBrowserRuntime()) {
  strings.zh.caveat = strings.zh.caveat
    .replace('清除 Key 会删除浏览器保存的密钥并停止本页跟踪，已提交的服务端任务仍可能完成并产生费用。', '清除 Key 会删除浏览器保存的密钥。刷新、离开页面或清除 Key 会中断后续分析批次；已经发出的请求仍可能完成并产生费用。')
    .replace('分析结果保存在服务端访客空间，同一访客、数据、领域与引擎可复用', '逐篇分析与报告保存在当前浏览器，同一浏览器、数据、领域与引擎可复用');
  strings.en.caveat = strings.en.caveat
    .replace('Clearing a key removes it from browser storage and stops this page from following the job; an already submitted server job may still finish and incur charges.', 'Clearing a key removes it from browser storage. Reloading, leaving or clearing a key interrupts subsequent batches. An in-flight API request may still finish and incur charges.')
    .replace('saved in your visitor space on the server', 'saved in this browser');
}

function safeLink(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? escapeHtml(url.href) : '#'; }
  catch { return '#'; }
}

export function renderConcernReport(report, lang = 'zh') {
  const c = strings[lang], coverage = report.coverage;
  const sources = Object.entries(coverage.sourceCounts).map(([source, count]) => `${source}: ${count}`).join(' · ');
  const meta = lang === 'zh'
    ? `${coverage.selectedCount} 篇去重论文 · ${coverage.abstractCount} 篇有摘要 · 以下问题关联 ${coverage.supportedCount} 篇`
    : `${coverage.selectedCount} unique papers · ${coverage.abstractCount} with abstracts · ${coverage.supportedCount} cited below`;
  const paperHtml = paper => `<li><a href="${safeLink(paper.url)}" target="_blank" rel="noopener noreferrer">${paper.ref ? `[${escapeHtml(paper.ref)}] ` : ''}${escapeHtml(paper.title)}</a>
    <p class="concern-paper-meta">${escapeHtml(paper.source)} · ${escapeHtml(paper.date.slice(0, 10))}</p>
    <p>${paper.abstract ? `${c.abstract}: ${escapeHtml(paper.abstract)}…` : c.missing}</p></li>`;
  return `<div class="concern-report-head"><span class="concern-badge ${report.mode === 'llm' ? 'is-ai' : ''}">${c[report.mode === 'llm' ? 'llm' : 'rules']}</span>
    <span>${escapeHtml(report.scope.label)}</span></div>
    <p class="concern-period">${escapeHtml(report.window.start)} — ${escapeHtml(report.window.end)} · ${escapeHtml(report.window.timezone)}</p>
    <p class="concern-summary">${escapeHtml(report.summary)}</p>
    ${report.incremental ? `<p class="concern-incremental">${lang === 'zh'
      ? `本报告生成时：复用 ${report.incremental.cached} 篇 · 新分析 ${report.incremental.analyzed} 篇 · 近7天共 ${report.incremental.total} 篇`
      : `At generation: ${report.incremental.cached} reused · ${report.incremental.analyzed} newly analyzed · ${report.incremental.total} in this window`}</p>` : ''}
    ${report.warning ? `<p class="concern-warning" role="note">${escapeHtml(report.warning)}</p>` : ''}
    <p class="concern-meta">${escapeHtml(meta)}<br>${escapeHtml(sources)}<br>${lang === 'zh' ? '生成于' : 'Generated'} ${escapeHtml(new Date(report.generatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'))}${report.model ? ` · ${escapeHtml(report.model)}` : ''}</p>
    ${report.questions.map((question, index) => `<article class="concern-question">
      <div class="concern-question-head"><span class="concern-number">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(question.question)}</h3>
      <span class="concern-count">${question.count} ${lang === 'zh' ? '篇' : 'papers'}<small>${question.share}%</small></span></div>
      <p>${escapeHtml(question.focus)}</p>
      <div class="bar" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, Number(question.share) || 0))}%"></i></div>
      <details class="concern-evidence"><summary>${c.evidence} (${question.count})</summary><ol>${question.papers.map(paperHtml).join('')}</ol></details>
    </article>`).join('') || `<p class="rank-help">${c.noQuestions}</p>`}
    <div class="concern-limitations">${report.limitations.map(note => `<p>${escapeHtml(note)}</p>`).join('')}</div>`;
}

export function mountConcernAnalysis({ lang = 'zh' } = {}) {
  const $ = selector => document.querySelector(selector);
  const major = $('#trendMajor'), minor = $('#trendMinor'), button = $('#analyzeConcerns');
  const status = $('#concernStatus'), output = $('#questions'), preview = $('#concernScope');
  const baseUrl = $('#trendBaseUrl'), apiKey = $('#trendApiKey'), model = $('#trendModel');
  const checkCache = $('#checkTrendCache'), clearApi = $('#clearTrendApi'), reloadOptions = $('#reloadTrendOptions');
  let locale = lang, catalog = [], scopeVersion = 0, operationVersion = 0, controller = null;
  let busy = false, ready = false, report = null, metadata = null, retryLoading = false;
  let restoreSelection = true, savedScope = {};
  try { savedScope = JSON.parse(localStorage.getItem('rp-trend-scope') || '{}') || {}; } catch { /* Use all fields. */ }
  const apiStorageKey = 'rp-trend-api';
  let apiStorageFailed = false;
  const copy = () => strings[locale];
  const isZh = () => locale === 'zh';
  const api = () => ({ baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), model: model.value.trim() });
  const scope = () => ({ majorField: major.value, minorField: minor.value });
  function restoreApi() {
    try {
      const saved = JSON.parse(localStorage.getItem(apiStorageKey) || '{}');
      for (const [name, input] of [['baseUrl', baseUrl], ['apiKey', apiKey], ['model', model]]) {
        input.value = typeof saved?.[name] === 'string' ? saved[name].slice(0, input.maxLength) : '';
      }
      apiStorageFailed = false;
    } catch {
      apiKey.value = '';
      apiStorageFailed = true;
    }
  }
  function saveApi({ clearKey = false } = {}) {
    try {
      // Remove the previous credential first so a failed settings write cannot
      // restore the cleared key on the next visit.
      if (clearKey) localStorage.removeItem(apiStorageKey);
      localStorage.setItem(apiStorageKey, JSON.stringify(api()));
      apiStorageFailed = false;
    } catch { apiStorageFailed = true; }
  }
  restoreApi();
  function validApi() {
    const values = api();
    if (!values.apiKey || /\s/.test(values.apiKey) || !values.model || /[\r\n]/.test(values.model)) return false;
    try {
      const url = new URL(values.baseUrl);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && url.hostname.includes('.') && !url.hostname.endsWith('.local') && !url.hostname.endsWith('.localhost');
    } catch { return false; }
  }
  function saveSelection() {
    try { localStorage.setItem('rp-trend-scope', JSON.stringify(scope())); } catch { /* Selection works without storage. */ }
  }
  function idleStatus() {
    if (!ready) return;
    status.dataset.state = 'ready';
    status.textContent = !metadata.coverage.selectedCount ? copy().noPapers : !validApi()
      ? isZh() ? '领域统计可直接浏览；填写你自己的 API 后才能分析。' : 'Field counts are free to browse. Enter your own API configuration to analyze.'
      : copy().choose;
  }
  function controls() {
    major.disabled = busy || !catalog.length;
    minor.disabled = busy || !major.value;
    button.disabled = busy || !ready || !metadata?.coverage.selectedCount || !validApi();
    checkCache.disabled = button.disabled;
    reloadOptions.hidden = !retryLoading;
    button.textContent = busy ? copy().analyzing : report?.mode === 'rules' ? copy().retry : copy().analyze;
    button.classList.toggle('loading', busy);
    output.setAttribute('aria-busy', String(busy));
    $('#fieldCards').querySelectorAll('button').forEach(card => { card.disabled = busy; });
    $('#trendApiStatus').textContent = apiStorageFailed
      ? isZh() ? '浏览器无法读取或更新配置缓存；旧配置可能仍保留。当前填写仍可使用，清除本站浏览器数据可删除旧配置。' : 'Browser settings could not be read or updated; previous settings may remain. You can use the current inputs. Clear this site’s browser data to remove previous settings.'
      : validApi()
      ? isZh() ? '已保存在当前浏览器，下次打开自动填入。点击“分析”才会调用模型；也可以先免费检查已有缓存。' : 'Saved in this browser and restored on your next visit. Only Analyze calls the model; you can check your existing cache for free.'
      : isZh() ? '请填写公网 HTTPS API 地址、API Key 和模型名称。' : 'Enter a public HTTPS API base URL, API key and model name.';
  }
  function renderFieldOverview() {
    const zh = isZh();
    $('#fieldOverviewTitle').textContent = zh ? '先看各领域发文量' : 'Compare publication counts';
    $('#concernSelectionTitle').textContent = zh ? '选择感兴趣的领域，再分析共同问题' : 'Choose a field to analyze';
    $('#fieldOverviewNote').textContent = zh
      ? '近7天 · 按论文数排序 · 本站已抓取样本，非全学界。跨领域论文可重复计入，比例之和可超过100%。发文量不是研究人数，也不能说明热度正在上升。分类为规则估计，可能误分或漏分。'
      : 'Last 7 days, ranked by paper count in this dataset. Fields overlap, so shares can exceed 100%. Paper counts are not researcher counts or evidence of growth. Rule-based labels can be incomplete or inaccurate.';
    if (!metadata) return;
    const cov = metadata.coverage, total = cov.recentCount;
    $('#fieldOverviewSummary').textContent = zh
      ? `${metadata.window.start} — ${metadata.window.end} · ${total} 篇去重论文 · ${cov.unclassifiedCount ?? 0} 篇尚未归入所列领域 · 点击卡片选择，不会自动调用 AI`
      : `${metadata.window.start} — ${metadata.window.end} · ${total} unique papers · ${cov.unclassifiedCount ?? 0} unclassified · Clicking a card selects a field without calling AI`;
    const incomplete = (metadata.arxivCollections || []).filter(item => item.status !== 'updated');
    if (incomplete.length) $('#fieldOverviewSummary').textContent += ' · ' + (zh
      ? `抓取提示：${incomplete.map(item => `${item.category}：${item.warning}`).join('；')}`
      : `Incomplete feeds: ${incomplete.map(item => item.category).join(', ')}. Cached data retained.`);
    const sorted = [...catalog].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    $('#fieldCards').innerHTML = [{ id: '', label: zh ? '全部领域' : 'All fields', count: total }, ...sorted].map(field => {
      const share = total ? Math.round(field.count / total * 1000) / 10 : 0;
      return `<button type="button" class="field-card${major.value === field.id ? ' is-selected' : ''}" data-field="${escapeHtml(field.id)}" aria-pressed="${major.value === field.id}" ${busy ? 'disabled' : ''}>
        <span>${escapeHtml(field.label)}</span><strong>${field.count}<small>${zh ? '篇' : 'papers'}</small></strong>
        <span class="field-share">${share}% ${zh ? '样本占比' : 'of sample'}</span><span class="field-bar" aria-hidden="true"><i style="width:${share}%"></i></span></button>`;
    }).join('');
    $('#fieldCards').querySelectorAll('button').forEach(card => { card.onclick = () => {
      major.value = card.dataset.field; minor.value = ''; saveSelection(); fillFields(); void refresh();
    }; });
  }
  function fillFields() {
    let majorValue = major.value, minorValue = minor.value;
    if (restoreSelection && catalog.length) {
      majorValue = catalog.some(field => field.id === savedScope.majorField) ? savedScope.majorField : '';
      minorValue = savedScope.minorField || ''; restoreSelection = false;
    }
    major.innerHTML = `<option value="">${copy().all}${metadata ? ` (${metadata.coverage.recentCount})` : ''}</option>` +
      catalog.map(field => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)} (${field.count})</option>`).join('');
    major.value = majorValue;
    const field = catalog.find(item => item.id === major.value);
    minor.innerHTML = `<option value="">${copy().allMinor}</option>` + (field?.children || [])
      .map(child => `<option value="${escapeHtml(child.id)}">${escapeHtml(child.label)} (${child.count})</option>`).join('');
    minor.value = field?.children.some(child => child.id === minorValue) ? minorValue : '';
    controls(); renderFieldOverview();
  }
  function scopeText() {
    if (!metadata) { preview.textContent = copy().loading; return; }
    const { coverage: cov, window: period, lastRefreshAt } = metadata;
    const sync = lastRefreshAt ? new Date(lastRefreshAt).toLocaleString(isZh() ? 'zh-CN' : 'en-US') : '—';
    preview.textContent = `${period.start} — ${period.end} (${period.timezone}) · ${isZh()
      ? `当前匹配 ${cov.selectedCount} 篇 / 近7天共 ${cov.recentCount} 篇 · 有摘要 ${cov.abstractCount} 篇 · 已排除重复 ${cov.duplicateCount} 条、无日期 ${cov.missingDateCount} 条 · 数据更新 ${sync}`
      : `${cov.selectedCount} matched / ${cov.recentCount} recent · ${cov.abstractCount} with abstracts · ${cov.duplicateCount} duplicates, ${cov.missingDateCount} undated excluded · Synced ${sync}`}`;
    $('#concernModel').textContent = validApi()
      ? isZh() ? '分析费用由你填写的 API 账户承担。' : 'Analysis is billed to the API account you supply.'
      : isZh() ? '浏览统计无需 API；分析需要你自己的 API。' : 'Browsing counts needs no API; analysis requires your own API.';
    const incremental = metadata.incremental;
    $('#concernIncremental').textContent = !incremental || !metadata.llmAvailable ? '' : isZh()
      ? `本次可复用 ${incremental.cached} 篇，需分析新增或变化的 ${incremental.pending} 篇。${incremental.pending ? '首次建立缓存时需读取全部未缓存论文。' : '标题和摘要无需重读；仅在报告变化时重新汇总。'} 每次点击均以近7天当前样本为准。`
      : `${incremental.cached} papers reusable; ${incremental.pending} new or changed papers need analysis. Synthesis uses the current seven-day window.`;
  }
  async function request(url, options = {}) {
    const response = await apiFetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  function post(url, payload, signal) {
    return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  }
  function invalidateOperation() {
    operationVersion++;
    controller?.abort(); controller = null; busy = false; report = null;
    output.innerHTML = '';
    if (metadata) metadata = { ...metadata, llmAvailable: false, incremental: null, report: null, job: null };
    $('#concernIncremental').textContent = '';
  }
  function configurationChanged() {
    invalidateOperation(); scopeText(); idleStatus(); controls();
  }
  function showReport(value) {
    report = value; output.innerHTML = renderConcernReport(value, locale);
  }
  function progressText(job) {
    const { stage, completed, total, cached = 0, analyzed = 0, pending = 0, mergeRound, mergeCompleted, mergeTotal } = job.progress || {};
    status.textContent = stage === 'synthesizing' ? (isZh()
      ? `已复用 ${cached} 篇、新分析 ${analyzed} 篇；正在汇总近7天问题（第 ${mergeRound || 1} 轮 ${mergeCompleted || 0}/${mergeTotal || 1}）。`
      : `Reused ${cached}, analyzed ${analyzed}. Synthesizing round ${mergeRound || 1}: ${mergeCompleted || 0}/${mergeTotal || 1}.`) : total
      ? isZh() ? `已复用 ${cached} 篇；新增或变化论文 ${analyzed} / ${pending} 篇，${completed} / ${total} 批完成。逐篇结果随完成保存。`
        : `Reading papers: ${completed} / ${total} batches. You may switch tabs; analysis continues.`
      : copy().preparing;
  }
  async function follow(job, version, payload, signal) {
    while (job.status === 'running') {
      if (version !== operationVersion) return;
      progressText(job);
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (version !== operationVersion) return;
      job = await request(`/api/trends/jobs/${encodeURIComponent(job.id)}`, { signal });
    }
    if (version !== operationVersion) return;
    if (job.status === 'failed' || !job.report) throw new Error(job.error || copy().failed);
    showReport(job.report);
    try {
      const data = await post('/api/trends/options', payload, signal);
      if (version !== operationVersion) return;
      metadata = data; catalog = data.catalog; fillFields(); scopeText();
    } catch { /* Keep the completed report if metadata refresh fails. */ }
    if (version !== operationVersion) return;
    const fallback = job.report.mode === 'rules' && job.report.warning;
    status.textContent = fallback
      ? isZh() ? 'AI 分析未完成，已展示规则统计。请查看下方原因，恢复后可重试。' : 'AI analysis did not complete. Rule statistics are shown; see the reason below before retrying.'
      : isZh() ? (job.cached ? '已载入你保存的分析，无需重复调用模型。' : '分析完成。展开问题下方的依据论文可核对原文。')
        : 'Analysis ready. Expand the supporting papers to inspect the evidence.';
    status.dataset.state = fallback ? 'warning' : 'ready';
  }
  async function refresh() {
    if (busy) return;
    const version = ++scopeVersion;
    invalidateOperation(); ready = false; retryLoading = false;
    status.dataset.state = 'loading'; status.textContent = copy().loading; controls();
    try {
      const selected = restoreSelection ? { majorField: savedScope.majorField || '', minorField: savedScope.minorField || '' } : scope();
      const data = await request(`/api/trends/options?${new URLSearchParams(selected)}`);
      if (version !== scopeVersion) return;
      metadata = data; catalog = data.catalog; ready = true;
      fillFields(); scopeText(); idleStatus(); controls();
    } catch (error) {
      if (version !== scopeVersion) return;
      retryLoading = true; ready = false; status.dataset.state = 'error';
      status.textContent = `${copy().failed} ${error.message}`; controls();
    }
  }
  async function run(checkOnly = false) {
    if (busy || !ready || !metadata?.coverage.selectedCount || !validApi()) return;
    const version = ++operationVersion, payload = { ...scope(), api: api() };
    controller = new AbortController(); const signal = controller.signal;
    busy = true; controls(); status.dataset.state = 'loading'; status.textContent = copy().preparing;
    try {
      if (checkOnly) {
        const data = await post('/api/trends/options', payload, signal);
        if (version !== operationVersion) return;
        metadata = data; catalog = data.catalog; fillFields(); scopeText();
        if (data.job) { await follow(data.job, version, payload, signal); return; }
        if (data.report) showReport(data.report);
        status.dataset.state = 'ready';
        status.textContent = data.report
          ? isZh() ? '已载入你的缓存，没有调用 AI。' : 'Your saved report is loaded. No AI call was made.'
          : isZh() ? '尚无当前范围的报告缓存。点击分析将使用你的 API。' : 'No saved report for this scope. Analyze will use your API.';
      } else {
        const job = await post('/api/trends/analyze', payload, signal);
        if (version !== operationVersion) return;
        await follow(job, version, payload, signal);
      }
    } catch (error) {
      if (version !== operationVersion) return;
      status.dataset.state = 'error'; status.textContent = error.message;
    } finally {
      // Release the request copy, including when a changed key invalidated this operation.
      payload.api.apiKey = '';
      if (version === operationVersion) { busy = false; controller = null; controls(); }
    }
  }
  function setLanguage(value) {
    locale = value;
    for (const [id, key] of [['concernTitle', 'title'], ['trendMajorLabel', 'major'], ['trendMinorLabel', 'minor'],
      ['concernIntro', 'intro'], ['concernMethodLabel', 'method'], ['concernMethod', 'caveat']]) $('#' + id).textContent = copy()[key];
    const labels = isZh() ? {
      trendApiTitle: '使用你自己的 API 分析', trendBaseUrlLabel: 'API 地址（Base URL）', trendModelLabel: '模型名称',
      trendApiPrivacy: 'API 地址、API Key 和模型名称自动保存在当前浏览器，下次打开自动填入。点击“清除 API Key”可删除保存的密钥。配置不会自动调用模型；密钥不写入服务器数据文件或日志，调用费用由你的 API 账户承担。',
      trendApiHelp: '填写你信任的 OpenAI 兼容服务商的公网 HTTPS 接口根地址（通常以 /v1 结尾）。Key 会经本站服务端转发给该地址。填写或切换领域不会调用 AI。',
      checkTrendCache: '检查我的缓存（不调用 AI）', clearTrendApi: '清除 API Key', reloadTrendOptions: '重新读取范围'
    } : {
      trendApiTitle: 'Analyze with your own API', trendBaseUrlLabel: 'API base URL', trendModelLabel: 'Model name',
      trendApiPrivacy: 'Your API address, key and model are saved in this browser and restored on your next visit. Clear API key removes the saved key. Restoring settings does not call the model. Keys are not saved in server data files or logs. Model calls are billed to your API account.',
      trendApiHelp: 'Use a trusted OpenAI-compatible provider with a public HTTPS base URL (usually ending in /v1). This server forwards your key to that address. Entering settings or changing fields does not call AI.',
      checkTrendCache: 'Check my cache (no AI call)', clearTrendApi: 'Clear API key', reloadTrendOptions: 'Reload scope'
    };
    if (usesBrowserRuntime()) {
      labels.trendApiPrivacy = isZh()
        ? 'API 地址、API Key 和模型名称自动保存在当前浏览器，下次打开自动填入；“清除 API Key”会删除保存的密钥。报告与逐篇结果也保存在本浏览器。恢复配置不会自动调用模型；刷新或离开页面会中断后续分析批次，已发出的请求仍可能计费。密钥不写入服务器数据文件或日志。'
        : 'Your API address, key and model are saved in this browser and restored on your next visit. Clear API key removes the saved key. Reports and per-paper notes also stay in this browser. Restoring settings does not call the model. Reloading or leaving interrupts subsequent batches; in-flight requests may still be billed to your API account. Keys are not saved in server data files or logs.';
    }
    Object.entries(labels).forEach(([id, text]) => { $('#' + id).textContent = text; });
    model.placeholder = isZh() ? '你的服务商提供的模型 ID' : 'Model ID from your provider';
    fillFields(); scopeText(); if (report) showReport(report); else if (!busy) idleStatus();
  }
  major.onchange = () => { minor.value = ''; saveSelection(); fillFields(); void refresh(); };
  minor.onchange = () => { saveSelection(); void refresh(); };
  [baseUrl, apiKey, model].forEach(input => {
    input.oninput = input.onchange = () => { saveApi(); configurationChanged(); };
  });
  clearApi.onclick = () => {
    const wasBusy = busy; apiKey.value = ''; saveApi({ clearKey: true }); configurationChanged();
    status.textContent = isZh()
      ? `${apiStorageFailed ? 'API Key 已从本页清除，但浏览器缓存更新失败，请清除本站浏览器数据' : 'API Key 已从本页和浏览器缓存中删除；API 地址和模型名称已保留'}。${wasBusy ? usesBrowserRuntime() ? '已发出的请求仍可能完成并产生费用。' : '已提交的服务端任务仍可能完成并产生费用。' : ''}`
      : `API key cleared from this page${apiStorageFailed ? ', but the browser cache could not be updated. Clear this site’s browser data' : ' and removed from browser storage; the API address and model are kept'}.${wasBusy ? usesBrowserRuntime() ? ' An in-flight request may still finish and incur charges.' : ' An already submitted server job may still finish and incur charges.' : ''}`;
  };
  // Also clear sensitive input when a page enters the browser back/forward cache.
  window.addEventListener('pagehide', () => { apiKey.value = ''; invalidateOperation(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { restoreApi(); configurationChanged(); } });
  window.addEventListener('storage', event => {
    if (event.key === apiStorageKey || event.key === null) { restoreApi(); configurationChanged(); }
  });
  button.onclick = () => void run(); checkCache.onclick = () => void run(true); reloadOptions.onclick = () => void refresh();
  setLanguage(locale); void refresh();
  return { refresh, setLanguage };
}
