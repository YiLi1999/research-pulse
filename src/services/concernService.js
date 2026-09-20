import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "../config/index.js";
import { loadPapers, loadState } from "../store/repository.js";
import { readJson, writeJsonAtomic } from "../utils/fs.js";
import { getConcernEngine } from "./concernEngine.js";
import { prepareConcerns, ruleConcernReport } from "../analyzer/concernAnalyzer.js";
import { analyzeIncrementalConcerns } from "../analyzer/incrementalConcerns.js";
import { createPaperAnalysisCache } from "./paperAnalysisCache.js";
import { logger } from "../utils/logger.js";

export function createConcernService(deps = {}) {
  const readPapers = deps.loadPapers || loadPapers;
  const readState = deps.loadState || loadState;
  const getEngine = deps.getEngine || getConcernEngine;
  const storageDir = deps.storageDir || path.join(config.paths.analysis, "concerns");
  const jobs = new Map();
  const now = deps.now || (() => new Date());
  const snapshot = job => ({ id: job.id, status: job.status, progress: job.progress,
    report: job.report || null, error: job.error || null });

  async function prepare(input = {}, { ownerId = "internal" } = {}) {
    const [papers, state, engine] = await Promise.all([readPapers(), readState(), getEngine(input.api)]);
    const prepared = prepareConcerns(papers, { majorField: input.majorField, minorField: input.minorField }, { now: now(), timezone: config.app.timezone });
    // Visitor IDs are opaque cookies, not API credentials. Never save request bodies.
    const namespace = ownerId === "internal" ? storageDir
      : path.join(storageDir, "visitors", createHash("sha256").update(ownerId).digest("hex"));
    const useLlm = engine.available;
    // Ranking changes do not invalidate the analysis; content and scope changes do.
    const key = createHash("sha256").update(JSON.stringify({ version: 3,
      scope: prepared.scope, start: prepared.window.start, end: prepared.window.end,
      timezone: prepared.window.timezone, engine: engine.signature, coverage: prepared.coverage,
      papers: prepared.papers.map(p => [p.id, p.title, p.abstract, p.keywords, p.date, p.submittedAt, p.url, p.arxivUrl, p.journal_display, p.journal, p.source])
    })).digest("hex");
    const paperCache = createPaperAnalysisCache(path.join(namespace, 'papers'), engine.signature);
    const cachedNotes = useLlm ? await paperCache.load(prepared.papers) : new Map();
    return { prepared, key, ownerId, cacheFile: path.join(namespace, `${key}.json`), useLlm, engine, paperCache, cachedNotes, arxivCollections: state?.arxivCollections || [], lastRefreshAt: state?.lastRefreshAt || null };
  }

  function restoreReferences(report, prepared) {
    if (!report) return null;
    const refs = new Map(prepared.papers.map(paper => [paper.id || paper.ref, paper.ref]));
    return { ...report, questions: report.questions.map(question => ({ ...question,
      papers: question.papers.map(paper => ({ ...paper, ref: paper.ref || refs.get(paper.id) || "" })) })) };
  }
  function existingJob(key, ownerId) {
    return [...jobs.values()].find(job => job.key === key && job.ownerId === ownerId && job.status === "running");
  }

  async function getOptions(input, context) {
    const data = await prepare(input, context);
    const cached = data.useLlm ? restoreReferences(await readJson(data.cacheFile), data.prepared) : null;
    const running = data.useLlm ? existingJob(data.key, data.ownerId) : null;
    const { prepared } = data;
    return { catalog: prepared.catalog, scope: prepared.scope, window: prepared.window,
      coverage: prepared.coverage, lastRefreshAt: data.lastRefreshAt,
      arxivCollections: data.arxivCollections,
      llmAvailable: data.useLlm, model: data.engine.model, provider: data.engine.provider,
      incremental: { cached: data.cachedNotes.size, pending: prepared.papers.length - data.cachedNotes.size, total: prepared.papers.length },
      engineLabel: data.engine.label, authMode: data.engine.authMode, requiresConfiguration: Boolean(data.engine.requiresConfiguration), engineError: data.engine.error || null,
      report: cached, job: running ? snapshot(running) : null };
  }

  async function run(job, data) {
    try {
      let report;
      if (data.useLlm && data.prepared.papers.length) {
        try {
          const byRef = new Map(data.prepared.papers.map(p => [p.ref, p]));
          report = await analyzeIncrementalConcerns(data.prepared, { chat: data.engine.chat, concurrency: data.engine.concurrency,
            cachedNotes: data.cachedNotes, saveNotes: (ref, questions) => data.paperCache.save(byRef.get(ref), questions),
            onProgress: progress => { job.progress = progress; } });
        } catch (error) {
          logger.warn("Concern analysis fell back to rules", { reason: ["quota", "auth", "rate-limit"].includes(error.reason) ? error.reason : "request" });
          const reason = data.engine.provider === "codex" ? error.message
            : error.reason === "quota" ? "模型接口的用量额度已耗尽，恢复额度后可重试"
            : error.reason === "auth" ? "模型接口认证失败，请检查你填写的 API Key 和模型访问权限"
              : error.reason === "rate-limit" ? "模型接口限流（HTTP 429），请稍后重试"
                : "接口失败、超时或返回格式无效，可点击按钮重试";
          report = ruleConcernReport(data.prepared, `AI 分析未完成：${reason.replace(/[。.\s]+$/u, "")}。以下仅为规则统计，不是 AI 归纳。`);
        }
      } else {
        report = ruleConcernReport(data.prepared, data.useLlm ? "" : `${data.engine.error || "分析引擎不可用。"} 以下仅为规则统计，不是 AI 归纳。`);
      }
      report.lastRefreshAt = data.lastRefreshAt;
      report.provider = data.engine.provider;
      if (report.mode === "llm") report.model = data.engine.label;
      // A temporary LLM failure must never become a permanent cached answer.
      if (report.mode === "llm" || !data.useLlm || !data.prepared.papers.length) {
        try { await writeJsonAtomic(data.cacheFile, report); }
        catch { report.warning = [report.warning, "结果已生成，但本地缓存保存失败；关闭页面后可能需要重新分析。"].filter(Boolean).join(" "); }
      }
      job.report = report;
      job.status = "completed";
    } catch {
      job.status = "failed";
      job.error = "分析失败，请稍后重试。";
    }
  }

  async function start(input, context) {
    const data = await prepare(input, context);
    if (!data.useLlm && data.engine.requiresConfiguration) {
      throw Object.assign(new Error(data.engine.error), { statusCode: 503 });
    }
    const cached = restoreReferences(await readJson(data.cacheFile), data.prepared);
    if (cached) return { status: "completed", report: cached, cached: true };
    const running = existingJob(data.key, data.ownerId);
    if (running) return snapshot(running);
    if ([...jobs.values()].some(job => job.status === "running" && job.ownerId === data.ownerId)) {
      throw Object.assign(new Error("已有一个领域正在分析，请等待完成后再分析其他领域。"), { statusCode: 409 });
    }
    if ([...jobs.values()].filter(job => job.status === "running").length >= 4) {
      throw Object.assign(new Error("当前分析人数较多，请稍后再试；尚未调用你的 API。"), { statusCode: 429 });
    }
    // One active job per visitor, four globally; never evict running jobs.
    if (jobs.size >= 30) {
      const completed = [...jobs.values()].find(job => job.status !== "running");
      if (completed) jobs.delete(completed.id);
    }
    const job = { id: randomUUID(), key: data.key, ownerId: data.ownerId, status: "running", progress: { stage: "preparing", completed: 0, total: 0 } };
    jobs.set(job.id, job);
    void run(job, data);
    return snapshot(job);
  }

  function getJob(id, { ownerId = "internal" } = {}) {
    const job = jobs.get(id);
    if (!job || job.ownerId !== ownerId) throw Object.assign(new Error("分析任务不存在或服务已重启，请重新点击分析。"), { statusCode: 404 });
    return snapshot(job);
  }

  async function getFields() {
    const [papers, state] = await Promise.all([readPapers(), readState()]);
    const prepared = prepareConcerns(papers, {}, { now: now(), timezone: config.app.timezone });
    return { catalog: prepared.catalog, coverage: prepared.coverage, window: prepared.window, arxivCollections: state?.arxivCollections || [] };
  }

  return { getOptions, start, getJob, getFields };
}

export const concernService = createConcernService();
