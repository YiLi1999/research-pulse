import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDashboardData, refreshAll } from "../services/refreshService.js";
import { visitorScoring } from "../services/visitorScoring.js";
import { rankPapersByRelevance } from "../scorer/recommendationScorer.js";
import { config } from "../config/index.js";
import { visitorContext } from "./visitorContext.js";
import { logger } from "../utils/logger.js";
import { concernService } from "../services/concernService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer({ concerns = concernService, scoring = visitorScoring, dashboard = getDashboardData,
  refresh = refreshAll, publicOrigin = config.app.publicOrigin } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(visitorContext(publicOrigin));
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/health", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({ ok: true, service: "arxiv-quant-tracker", pid: process.pid });
  });

  app.get("/api/papers", async (request, response) => {
    const [data, settings] = await Promise.all([dashboard(), scoring.get(request.visitor.ownerId)]);
    response.json({ ...data, papers: rankPapersByRelevance(data.papers, settings.keywordWeights) });
  });

  app.get("/api/analysis", async (_request, response) => {
    const data = await dashboard();
    response.json({
      analysis: data.analysis,
      state: data.state,
      config: data.config
    });
  });

  app.get("/api/scoring", async (request, response) => {
    const settings = await scoring.get(request.visitor.ownerId);
    response.json(settings);
  });

  app.get("/api/trends/fields", async (_request, response) => {
    try { response.json(await concerns.getFields()); }
    catch (error) { response.status(error.statusCode || 500).json({ error: error.message }); }
  });

  app.get("/api/trends/options", async (request, response) => {
    try {
      response.json(await concerns.getOptions({ majorField: request.query.majorField, minorField: request.query.minorField }, request.visitor));
    } catch (error) {
      response.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "无法读取趋势分析数据。" });
    }
  });

  function requireVisitorApi(request, response, next) {
    if (!request.is("application/json")) {
      response.status(415).json({ error: "分析请求必须使用 JSON。" }); return;
    }
    const api = request.body?.api;
    if (!api || typeof api !== "object" || Array.isArray(api) || ![api.baseUrl, api.apiKey, api.model].every(value => typeof value === "string" && value.trim())) {
      response.status(400).json({ error: "请先填写你自己的 API 地址、API Key 和模型名称。" }); return;
    }
    next();
  }

  app.post("/api/trends/options", requireVisitorApi, async (request, response) => {
    try { response.json(await concerns.getOptions(request.body, request.visitor)); }
    catch (error) { response.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "无法检查分析缓存。" }); }
  });

  app.post("/api/trends/analyze", requireVisitorApi, async (request, response) => {
    try {
      const job = await concerns.start(request.body, request.visitor);
      response.status(job.status === "running" ? 202 : 200).json(job);
    } catch (error) {
      response.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "无法启动趋势分析。" });
    }
  });

  app.get("/api/trends/jobs/:id", (request, response) => {
    try { response.json(concerns.getJob(request.params.id, request.visitor)); }
    catch (error) { response.status(error.statusCode || 500).json({ error: error.message }); }
  });

  app.put("/api/scoring", async (request, response) => {
    try {
      const data = await dashboard();
      const result = await scoring.save(request.visitor.ownerId, request.body?.keywordWeights, data.papers);
      response.json({ ok: true, ...result });
    } catch (error) {
      logger.error("Failed to update scoring settings", { error: error.message });
      response.status(error.statusCode || 500).json({ ok: false, error: error.message });
    }
  });

  let refreshTask, lastRefresh = 0;
  app.post("/api/refresh", async (_request, response) => {
    try {
      // Share expensive crawls and reuse recent data for the small public site.
      if (!refreshTask && Date.now() - lastRefresh >= 5 * 60000) {
        refreshTask = refresh().then(() => { lastRefresh = Date.now(); }).finally(() => { refreshTask = null; });
      }
      await refreshTask;
      response.json({ ok: true });
    } catch (error) {
      logger.error("Refresh failed", { error: error.message });
      response.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/papers/:paperId/summarize", (_request, response) => {
    response.status(410).json({ error: "此网页已关闭使用站主密钥的单篇总结。请在趋势分析中使用你自己的 API。" });
  });

  app.use("/api", (_request, response) => response.status(404).json({ error: "接口不存在。" }));

  app.get("/trends", (_request, response) => {
    response.redirect("/?view=overview");
  });

  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.use((error, _request, response, _next) => {
    // JSON parse failures can contain the body/key; never echo or log them.
    const status = error.type === "entity.too.large" ? 413 : error.type === "entity.parse.failed" ? 400 : 500;
    response.status(status).json({ error: status === 413 ? "请求内容过大。" : status === 400 ? "请求 JSON 格式无效。" : "请求失败，请稍后重试。" });
  });

  return app;
}
