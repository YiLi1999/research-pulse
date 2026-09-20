import { config } from "../config/index.js";
import {
  loadApsPapers,
  loadAnalysis,
  loadArxivPapers,
  loadNaturePapers,
  loadPapers,
  loadState,
  loadSummaryIndex,
  saveApsPapers,
  saveApsRawSnapshot,
  saveAnalysis,
  saveArxivPapers,
  saveNaturePapers,
  saveNatureRawSnapshot,
  savePapers,
  saveRelevanceRankingExport,
  saveRawSnapshot,
  saveState,
  saveSummaryIndex
} from "../store/repository.js";
import { analyzeTrends } from "../analyzer/trendAnalyzer.js";
import { rankPapersByRelevance } from "../scorer/recommendationScorer.js";
import { summarizePaper } from "../summarizer/summarizer.js";
import { logger } from "../utils/logger.js";
import { withRankingUpdate } from "./scoringService.js";
import { cleanupLocalData, retainRecentPapers, paperRetentionDate } from "./dataRetention.js";

function normalizeArxivPaper(basePaper) {
  return {
    ...basePaper,
    source: "arxiv",
    journal: basePaper.primaryCategory === "Quantum Physics (quant-ph)" ? "quant-ph" : "arxiv",
    journal_display: basePaper.primaryCategory || "arXiv",
    status: "preprint",
    url: basePaper.arxivUrl,
    date: basePaper.submittedAt,
    raw_source: basePaper.source,
    fetched_at: new Date().toISOString()
  };
}

function stripLegacyFields(paper) {
  if (!paper || typeof paper !== "object") {
    return paper;
  }

  const next = { ...paper };
  delete next.arxivId;
  return next;
}

function mergePaper(basePaper, summaryIndex) {
  const summary = summaryIndex[basePaper.id] || null;
  const keywords = summary?.keywords?.length ? summary.keywords : basePaper.keywords || [];

  return {
    ...basePaper,
    authorCount: basePaper.authors.length,
    keywords,
    summary
  };
}

export async function getDashboardData() {
  const [papers, analysis, state] = await Promise.all([loadPapers(), loadAnalysis(), loadState()]);

  return {
    // Cached recommendations can predate the saved config after a restart.
    papers: rankPapersByRelevance(papers),
    analysis,
    state,
    config: {
      category: config.arxiv.category,
      categories: config.arxiv.categories,
      windowDays: config.arxiv.windowDays,
      timezone: config.app.timezone
    }
  };
}

export async function refreshAll(deps = {}) {
  // Run even when all remote sources fail; clean before loading fallback data.
  const cleanup = await withRankingUpdate(() => cleanupLocalData());
  logger.info("Applied 30-day local data retention", cleanup);
  const [existingPapers, existingArxivPapers, existingApsPapers, existingNaturePapers, summaryIndex, state] = await Promise.all([
    loadPapers(),
    loadArxivPapers(),
    loadApsPapers(),
    loadNaturePapers(),
    loadSummaryIndex(),
    loadState()
  ]);

  const knownPaperIds = new Set(
    state.knownPaperIds || existingPapers.map((paper) => paper.id)
  );

  let arxivPapers = existingArxivPapers.map(stripLegacyFields);
  let apsPapers = existingApsPapers.map(stripLegacyFields);
  let naturePapers = existingNaturePapers.map(stripLegacyFields);
  let arxivSource = "cached";
  let arxivCollections = state.arxivCollections || [];
  let apsSource = "cached";
  let natureSource = "cached";

  try {
    // Load crawlers after the HTTP server is ready. Their browser/parser
    // dependencies can be slow on a cold Windows startup.
    const { fetchLatestPapers } = deps.arxiv || await import("../fetcher/index.js");
    const fetched = await fetchLatestPapers({ fastOnly: true, existingPapers: arxivPapers });
    arxivSource = fetched.source;
    arxivCollections = fetched.collections;

    if (fetched.raw.api) {
      const apiSnapshot = fetched.raw.api.rawPages.map(({ page, start, url, xml }) => ({
        page,
        start,
        url,
        xml
      }));
      await saveRawSnapshot(`api-${Date.now()}`, "json", apiSnapshot);
    }

    if (fetched.raw.fallback?.rawHtml) {
      await saveRawSnapshot(`recent-${Date.now()}`, "html", fetched.raw.fallback.rawHtml);
    }

    const newPapers = fetched.papers.filter((paper) => !knownPaperIds.has(paper.id));
    logger.info("Detected new papers", { total: fetched.papers.length, newCount: newPapers.length });

    arxivPapers = fetched.papers.map((paper) => mergePaper(normalizeArxivPaper(paper), summaryIndex));
  } catch (error) {
    logger.warn("Failed to refresh arXiv papers, using cached dataset", { error: error.message });
  }

  try {
    const { fetchAps } = deps.aps || await import("../fetchers/aps/index.js");
    const apsResult = await fetchAps({
      journals: ["prl", "pra", "prb", "prd", "pre", "prx", "prxquantum", "prapplied", "prresearch", "prmaterials"],
      // Published feeds consistently contain title + abstract. Accepted feeds
      // are unavailable for several journals and trigger slow browser fallbacks.
      status: ["accepted", "published"],
      days: 7,
      fastOnly: true
    });

    apsPapers = apsResult.normalized.map((paper) => mergePaper(paper, summaryIndex));
    apsSource = "api+fallback";
    await saveApsRawSnapshot(`aps-prl-${Date.now()}`, "json", apsResult.raw);
    logger.info("Fetched APS papers", { count: apsPapers.length });
  } catch (error) {
    logger.warn("Failed to fetch APS papers, using cached dataset", { error: error.message });
  }

  try {
    const { fetchNatureRecentPhysicsRecords } = deps.nature || await import("../fetchers/natureRecent.js");
    const natureResult = await fetchNatureRecentPhysicsRecords(7, { fastOnly: true });
    naturePapers = natureResult.map((paper) => mergePaper(paper, summaryIndex));
    natureSource = "feed+fallback";
    await saveNatureRawSnapshot(`nature-${Date.now()}`, "json", natureResult);
    logger.info("Fetched Nature papers", { count: naturePapers.length });
  } catch (error) {
    logger.warn("Failed to fetch Nature papers, using cached dataset", { error: error.message });
  }

  // A fallback or undated feed must not reintroduce expired cached records.
  arxivPapers = retainRecentPapers(arxivPapers);
  apsPapers = retainRecentPapers(apsPapers);
  naturePapers = retainRecentPapers(naturePapers);
  const mergedPapers = [...arxivPapers, ...apsPapers, ...naturePapers].map(stripLegacyFields);
  return withRankingUpdate(async () => {
  const enrichedPapers = rankPapersByRelevance(mergedPapers);
  // Keep the primary crawl responsive. The browser already computes the
  // optional trend panels locally from titles and abstracts.
  const analysis = await analyzeTrends(enrichedPapers, { useLlm: false });

  await Promise.all([
    saveSummaryIndex(summaryIndex),
    saveArxivPapers(arxivPapers),
    saveApsPapers(apsPapers),
    saveNaturePapers(naturePapers),
    savePapers(enrichedPapers),
    saveRelevanceRankingExport(enrichedPapers),
    saveAnalysis(analysis),
    saveState({
      arxivCollections,
      lastRefreshAt: new Date().toISOString(),
      knownPaperIds: enrichedPapers.map((paper) => paper.id),
      lastSource: {
        arxiv: arxivSource,
        aps: apsSource,
        nature: natureSource
      }
    })
  ]);

  return {
    cleanup,
    papers: enrichedPapers,
    analysis,
    state: {
      arxivCollections,
      lastRefreshAt: new Date().toISOString(),
      knownPaperIds: enrichedPapers.map((paper) => paper.id),
      lastSource: {
        arxiv: arxivSource,
        aps: apsSource,
        nature: natureSource
      }
    }
  };
  });
}

export async function summarizePaperOnDemand(paperId) {
  const [papers, summaryIndex] = await Promise.all([loadPapers(), loadSummaryIndex()]);
  const paper = papers.find((item) => item.id === paperId);

  if (!paper) {
    throw new Error(`未找到论文 ${paperId}`);
  }

  const summary = { ...await summarizePaper(paper), savedAt: new Date().toISOString(),
    paperDate: Number.isFinite(paperRetentionDate(paper))
      ? new Date(paperRetentionDate(paper)).toISOString() : null };
  summaryIndex[paperId] = summary;
  await saveSummaryIndex(summaryIndex);

  return withRankingUpdate(async () => {
  const latestPapers = await loadPapers();
  const updatedPapers = latestPapers.map((item) =>
    item.id === paperId
      ? mergePaper(
          {
            ...stripLegacyFields(item),
            keywords: summary.keywords || item.keywords || []
          },
          summaryIndex
        )
      : stripLegacyFields(item)
  );

  const refreshedPapers = rankPapersByRelevance(updatedPapers);
  const analysis = await analyzeTrends(refreshedPapers, { useLlm: false });

  await Promise.all([savePapers(refreshedPapers), saveAnalysis(analysis), saveRelevanceRankingExport(refreshedPapers)]);

  return {
    paper: refreshedPapers.find((item) => item.id === paperId),
    analysis
  };
  });
}
