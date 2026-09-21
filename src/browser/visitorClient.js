import { prepareConcerns, ruleConcernReport } from "../analyzer/concernAnalyzer.js";
import { analyzeIncrementalConcerns, validPaperNotes, PAPER_ANALYSIS_VERSION } from "../analyzer/incrementalConcernsCore.js";
import { rankPapersByRelevance, normalizeKeywordWeights, SCORING_RULE } from "../scorer/scoringCore.js";
import { createAnalysisStorage } from "./analysisStorage.js";

const defaults = { randomness: 1, entanglement: 1, "error correction": 1, photonics: 1,
  "many-body": 1, magic: 1, nonstabilizerness: 1, "fidelity estimation": 1 };
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function connectionFor(value) {
  if (!value) return null;
  if (![value.baseUrl, value.apiKey, value.model].every(v => typeof v === "string" && v.trim())) throw invalid("请填写你自己的 API 地址、Key 和模型。");
  const api = { baseUrl: value.baseUrl.trim().replace(/\/+$/, ""), apiKey: value.apiKey.trim(), model: value.model.trim() };
  let url;
  try { url = new URL(api.baseUrl); } catch { throw invalid("API 地址无效。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /[\r\n]/.test(api.apiKey + api.model)) throw invalid("请使用公网 HTTPS API 地址及有效的 Key、模型。");
  return api;
}
const snapshot = job => ({ id: job.id, status: job.status, progress: job.progress, report: job.report || null, error: job.error || null });

export function createVisitorClient({ fetch: network = globalThis.fetch.bind(globalThis), storage = createAnalysisStorage(),
  preferences, now = () => new Date(), datasetUrl = "/data/dashboard.json" } = {}) {
  if (!preferences) { try { preferences = globalThis.localStorage; } catch { /* Cache restrictions do not block browsing. */ } }
  const jobs = new Map();
  let datasetPromise, weights;
  function settings() {
    if (!weights) {
      try { const saved = preferences?.getItem("rp-visitor-weights"); weights = saved ? normalizeKeywordWeights(JSON.parse(saved)) : { ...defaults }; }
      catch { weights = { ...defaults }; }
    }
    return { keywordWeights: weights, defaults, rule: SCORING_RULE };
  }
  async function dataset(force = false) {
    if (!datasetPromise || force) datasetPromise = network(datasetUrl, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("无法读取共享论文数据，请稍后刷新。");
      const value = await response.json();
      if (!Array.isArray(value.papers)) throw new Error("共享论文数据格式无效。");
      return value;
    }).catch(error => { datasetPromise = null; throw error; });
    return datasetPromise;
  }
  async function prepare(input = {}) {
    const api = connectionFor(input.api), data = await dataset();
    const prepared = prepareConcerns(data.papers, input, { now: now(), timezone: data.config?.timezone || "Asia/Shanghai" });
    const engine = api ? ["visitor-api", api.baseUrl, api.model] : null;
    const paperKeys = new Map();
    const notes = new Map();
    if (api) await Promise.all(prepared.papers.map(async paper => {
      const key = "paper:" + await digest({ version: PAPER_ANALYSIS_VERSION, engine, title: clean(paper.title), abstract: clean(paper.abstract) });
      paperKeys.set(paper.ref, key);
      const saved = await storage.get(key);
      if (validPaperNotes(saved)) notes.set(paper.ref, saved);
    }));
    const reportKey = api ? "report:" + await digest({ version: 1, engine, scope: prepared.scope,
      start: prepared.window.start, end: prepared.window.end, timezone: prepared.window.timezone, coverage: prepared.coverage,
      papers: prepared.papers.map(p => [p.id, p.title, p.abstract, p.date, p.submittedAt, p.url, p.arxivUrl, p.journal_display, p.journal, p.source]) }) : null;
    return { api, data, prepared, notes, paperKeys, reportKey };
  }
  function running(key) { return [...jobs.values()].find(job => job.key === key && job.status === "running"); }
  async function options(input) {
    const context = await prepare(input);
    const { api, data, prepared, notes, reportKey } = context;
    const job = reportKey ? running(reportKey) : null;
    return { catalog: prepared.catalog, scope: prepared.scope, window: prepared.window, coverage: prepared.coverage,
      lastRefreshAt: data.state?.lastRefreshAt || null, arxivCollections: data.state?.arxivCollections || [],
      llmAvailable: Boolean(api), requiresConfiguration: true, provider: "api", authMode: "visitor-api-key",
      model: api?.model || "", engineLabel: api ? `API · ${api.model}` : "API · 待配置",
      engineError: api ? null : "请填写你自己的 API 地址、API Key 和模型名称。",
      incremental: { cached: notes.size, pending: prepared.papers.length - notes.size, total: prepared.papers.length },
      report: reportKey ? (await storage.get(reportKey) ?? null) : null, job: job ? snapshot(job) : null };
  }
  async function run(job, context, signal) {
    const { api, prepared, data, notes, paperKeys, reportKey } = context;
    try {
      job.report = prepared.papers.length ? await analyzeIncrementalConcerns(prepared, {
        concurrency: 2, cachedNotes: notes, saveNotes: (ref, questions) => storage.set(paperKeys.get(ref), questions),
        onProgress: progress => { job.progress = progress; },
        chat: async (messages, budget) => {
          signal?.throwIfAborted();
          const response = await network("/api/chat", { method: "POST", signal,
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api, messages, options: { maxTokens: budget.maxTokens } }) });
          const result = await response.json().catch(() => null);
          if (!response.ok || !result?.result) throw new Error(result?.error || "模型请求失败，请检查你的 API 配置后重试。");
          return result.result;
        }
      }) : ruleConcernReport(prepared, "");
      job.report.model = `API · ${api.model}`;
      job.report.provider = "api";
      job.report.lastRefreshAt = data.state?.lastRefreshAt || null;
      job.report.limitations = job.report.limitations.map(text => text.replace("本机已抓取", "本站共享数据中"));
      // Keep paper notes, but let visitors explicitly retry an inconclusive synthesis.
      if ((job.report.questions.length || !prepared.papers.length) && !await storage.set(reportKey, job.report)) {
        job.report.warning = [job.report.warning, "浏览器未能持久保存报告；关闭页面后可能需要重新分析。"].filter(Boolean).join(" ");
      }
      job.status = "completed";
    } catch (error) {
      job.status = "failed";
      job.error = signal?.aborted ? "分析已停止。已完成的逐篇缓存可在重试时复用；已发出的请求仍可能计费。" : error.message || "分析失败，请重试。";
      if (!signal?.aborted && job.progress.stage === "synthesizing") {
        job.error += " 已保存的逐篇缓存仍可复用；保持相同 API 地址和模型重试即可，无需清除浏览器数据。";
      }
    } finally { api.apiKey = ""; }
  }
  async function start(input, signal) {
    const context = await prepare(input);
    if (!context.api) throw invalid("请先填写你自己的 API。");
    const cached = await storage.get(context.reportKey);
    if (cached) return { status: "completed", report: cached, cached: true };
    const same = running(context.reportKey);
    if (same) return snapshot(same);
    if ([...jobs.values()].some(job => job.status === "running")) throw Object.assign(new Error("本页已有分析正在运行，请等待结束。"), { statusCode: 409 });
    signal?.throwIfAborted();
    if (jobs.size >= 20) jobs.delete(jobs.keys().next().value);
    const job = { id: crypto.randomUUID(), key: context.reportKey, status: "running", progress: { stage: "preparing", completed: 0, total: 0 } };
    jobs.set(job.id, job);
    void run(job, context, signal);
    return snapshot(job);
  }
  async function apiFetch(input, init = {}) {
    init.signal?.throwIfAborted();
    const url = new URL(input, "https://local.invalid"), method = init.method || "GET";
    try {
      const body = init.body ? JSON.parse(init.body) : {};
      let result;
      if (url.pathname === "/api/papers") {
        const data = await dataset(); result = { ...data, papers: rankPapersByRelevance(data.papers, settings().keywordWeights) };
      } else if (url.pathname === "/api/scoring") {
        if (method === "PUT") {
          const nextWeights = normalizeKeywordWeights(body.keywordWeights);
          const data = await dataset();
          if (!preferences) throw new Error("浏览器禁止保存设置，请允许本站存储后重试。");
          preferences.setItem("rp-visitor-weights", JSON.stringify(nextWeights)); weights = nextWeights;
          result = { ok: true, settings: settings(), papers: rankPapersByRelevance(data.papers, weights) };
        } else result = settings();
      } else if (url.pathname === "/api/refresh") { await dataset(true); result = { ok: true }; }
      else if (url.pathname === "/api/trends/options" || url.pathname === "/api/trends/fields") {
        result = await options(method === "POST" ? body : { majorField: url.searchParams.get("majorField") || "", minorField: url.searchParams.get("minorField") || "" });
      } else if (url.pathname === "/api/trends/analyze" && method === "POST") result = await start(body, init.signal);
      else if (url.pathname.startsWith("/api/trends/jobs/")) {
        const job = jobs.get(decodeURIComponent(url.pathname.split("/").at(-1)));
        if (!job) throw Object.assign(new Error("页面已刷新或任务不存在，请使用已保存的 API 配置检查缓存。"), { statusCode: 404 });
        result = snapshot(job);
      } else throw Object.assign(new Error("接口不存在。"), { statusCode: 404 });
      return Response.json(result, { status: result.status === "running" ? 202 : 200 });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      return Response.json({ error: error.message || "请求失败。" }, { status: error.statusCode || 500 });
    }
  }
  return { apiFetch };
}

let client;
export const apiFetch = (input, init) => (client ||= createVisitorClient()).apiFetch(input, init);
