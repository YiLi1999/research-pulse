import { buildSummaryMessages } from "./prompts.js";
import { chatJson, hasLlmConfig } from "./llmClient.js";
import { extractKeywordsHeuristically } from "../analyzer/keywordExtractor.js";
import { logger } from "../utils/logger.js";

function fallbackSummary(paper, errorMessage = "总结失败，可稍后重试") {
  return {
    status: "failed",
    error: errorMessage,
    oneLine: errorMessage,
    researchProblem: "模型调用失败，当前保留英文摘要供复查。",
    method: "请稍后重新触发刷新，以便重新生成总结。",
    results: paper.abstract,
    whyImportant: "可先根据原摘要判断是否需要优先阅读。",
    keywords: extractKeywordsHeuristically(paper),
    modelImportanceScore: null
  };
}

export async function summarizePaper(paper) {
  if (!hasLlmConfig()) {
    return {
      ...fallbackSummary(paper, "总结失败，可稍后重试（尚未配置 LLM API key）"),
      status: "skipped"
    };
  }

  try {
    const result = await chatJson(buildSummaryMessages(paper));
    return {
      status: "ok",
      error: null,
      oneLine: result.oneLine || "",
      researchProblem: result.researchProblem || "",
      method: result.method || "",
      results: result.results || "",
      whyImportant: result.whyImportant || "",
      keywords: Array.isArray(result.keywords) && result.keywords.length > 0
        ? result.keywords
        : extractKeywordsHeuristically(paper),
      modelImportanceScore: Number.isFinite(Number(result.importanceScore))
        ? Number(result.importanceScore)
        : null
    };
  } catch (error) {
    logger.warn("Failed to summarize paper", { id: paper.id, error: error.message });
    return fallbackSummary(paper);
  }
}
