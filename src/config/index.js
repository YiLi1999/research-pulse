import dotenv from "dotenv";

dotenv.config({ quiet: true });

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const defaultKeywordWeights = {
  randomness: 1,
  entanglement: 1,
  "error correction": 1,
  photonics: 1,
  "many-body": 1,
  magic: 1,
  nonstabilizerness: 1,
  "fidelity estimation": 1
};

export const config = {
  app: {
    port: toNumber(process.env.PORT, 3100),
    host: process.env.HOST || "127.0.0.1",
    publicOrigin: process.env.PUBLIC_ORIGIN || "",
    timezone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    directionLabel: process.env.DEFAULT_DIRECTION_LABEL || "Quantum Physics"
  },
  arxiv: {
    category: process.env.ARXIV_CATEGORY || "quant-ph",
    categories: [...new Set((process.env.ARXIV_CATEGORIES || `${process.env.ARXIV_CATEGORY || 'quant-ph'},math`).split(',').map(s => s.trim()).filter(Boolean))],
    mathMaxPages: toNumber(process.env.ARXIV_MATH_MAX_PAGES, 50),
    windowDays: toNumber(process.env.ARXIV_WINDOW_DAYS, 7),
    apiPageSize: toNumber(process.env.ARXIV_API_PAGE_SIZE, 100),
    apiMaxPages: toNumber(process.env.ARXIV_API_MAX_PAGES, 5),
    requestTimeoutMs: toNumber(process.env.ARXIV_REQUEST_TIMEOUT_MS, 20000),
    enableFallback: toBoolean(process.env.ARXIV_ENABLE_FALLBACK, true)
  },
  llm: {
    provider: process.env.LLM_PROVIDER || "openai-compatible",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-4.1-mini",
    temperature: toNumber(process.env.LLM_TEMPERATURE, 0.2),
    maxTokens: toNumber(process.env.LLM_MAX_TOKENS, 1400),
    concurrency: toNumber(process.env.LLM_CONCURRENCY, 2)
  },
  trends: {
    provider: process.env.TREND_ANALYSIS_PROVIDER || "api",
    api: {
      baseUrl: process.env.TREND_API_BASE_URL || "",
      apiKey: process.env.TREND_API_KEY || "",
      model: process.env.TREND_API_MODEL || "",
      temperature: 0.2,
      maxTokens: 16000,
      concurrency: Math.max(1, Math.min(4, toNumber(process.env.TREND_API_CONCURRENCY, 4)))
    },
    codexPath: process.env.CODEX_CLI_PATH || "",
    codexModel: process.env.CODEX_ANALYSIS_MODEL || "",
    codexTimeoutMs: toNumber(process.env.CODEX_ANALYSIS_TIMEOUT_MS, 600000)
  },
  paths: {
    dataRoot: "data",
    raw: "data/raw",
    aps: "data/aps",
    apsRaw: "data/aps/raw",
    apsAcceptedLocal: "data/aps/local-accepted.json",
    nature: "data/nature",
    naturePapers: "data/nature/normalized.json",
    natureRaw: "data/nature/raw",
    summaries: "data/summaries",
    analysis: "data/analysis",
    cache: "data/cache",
    papers: "data/papers.json",
    arxivPapers: "data/arxiv-papers.json",
    apsPapers: "data/aps/normalized.json",
    state: "data/cache/state.json",
    summaryIndex: "data/summaries/summaries.json",
    analysisLatest: "data/analysis/latest.json",
    scoringConfig: "data/cache/scoring-config.json",
    relevanceRankingJson: "data/analysis/relevance-ranking.json",
    relevanceRankingCsv: "data/analysis/relevance-ranking.csv"
  },
  scoring: {
    keywordWeights: { ...defaultKeywordWeights }
  }
};

export const defaultScoringKeywordWeights = { ...defaultKeywordWeights };

export function setScoringKeywordWeights(keywordWeights) {
  config.scoring.keywordWeights = { ...keywordWeights };
}
