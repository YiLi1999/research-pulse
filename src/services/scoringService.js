import { config, defaultScoringKeywordWeights, setScoringKeywordWeights } from "../config/index.js";
import {
  loadPapers, loadScoringConfig, saveRelevanceRankingExport, loadSummaryIndex,
  saveAnalysis, savePapers, saveScoringConfig
} from "../store/repository.js";
import { analyzeTrends } from "../analyzer/trendAnalyzer.js";
import { rankPapersByRelevance, normalizeKeywordWeights, SCORING_RULE } from "../scorer/recommendationScorer.js";

// Share this short commit queue with refreshes, so a crawl cannot overwrite
// the ranking produced by a newer settings save. Network crawling stays outside.
let pendingUpdate = Promise.resolve();
export function withRankingUpdate(action) {
  const result = pendingUpdate.then(action);
  pendingUpdate = result.catch(() => {});
  return result;
}

function settingsFor(keywordWeights) {
  return { keywordWeights: { ...keywordWeights }, defaults: { ...defaultScoringKeywordWeights }, rule: SCORING_RULE };
}

export async function initializeScoringConfig() {
  const saved = await loadScoringConfig();
  if (saved !== null) {
    setScoringKeywordWeights(normalizeKeywordWeights(saved.keywordWeights));
    return;
  }
  await saveScoringConfig({ keywordWeights: { ...defaultScoringKeywordWeights } });
  setScoringKeywordWeights(defaultScoringKeywordWeights);
}

export async function getScoringSettings() {
  const saved = await loadScoringConfig();
  return settingsFor(normalizeKeywordWeights(saved === null ? config.scoring.keywordWeights : saved.keywordWeights));
}

export async function updateScoringSettings(keywordWeights) {
  // Validate before queuing, without dropping invalid entries or treating missing
  // input as an instruction to erase settings. An explicitly empty {} is valid.
  const normalized = normalizeKeywordWeights(keywordWeights);
  return withRankingUpdate(async () => {
    await saveScoringConfig({ keywordWeights: normalized });
    setScoringKeywordWeights(normalized);
    const [papers, summaryIndex] = await Promise.all([loadPapers(), loadSummaryIndex()]);
    const merged = papers.map(paper => ({ ...paper, summary: summaryIndex[paper.id] || paper.summary || null }));
    const rescoredPapers = rankPapersByRelevance(merged);
    const analysis = await analyzeTrends(rescoredPapers, { useLlm: false });
    await Promise.all([savePapers(rescoredPapers), saveAnalysis(analysis), saveRelevanceRankingExport(rescoredPapers)]);
    return { settings: settingsFor(normalized), papers: rescoredPapers, analysis };
  });
}
