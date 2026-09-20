import { createHash } from "node:crypto";
import path from "node:path";
import { config, defaultScoringKeywordWeights } from "../config/index.js";
import { readJson, writeJsonAtomic } from "../utils/fs.js";
import { getScoringSettings } from "./scoringService.js";
import { normalizeKeywordWeights, rankPapersByRelevance, SCORING_RULE } from "../scorer/recommendationScorer.js";

export function createVisitorScoring({ directory = path.join(config.paths.cache, "visitor-scoring"), defaults = getScoringSettings } = {}) {
  const filename = ownerId => path.join(directory, `${createHash("sha256").update(ownerId).digest("hex")}.json`);
  const settingsFor = keywordWeights => ({ keywordWeights, defaults: { ...defaultScoringKeywordWeights }, rule: SCORING_RULE });
  async function get(ownerId) {
    const saved = await readJson(filename(ownerId));
    return saved ? settingsFor(normalizeKeywordWeights(saved.keywordWeights)) : defaults();
  }
  async function save(ownerId, keywordWeights, papers) {
    const normalized = normalizeKeywordWeights(keywordWeights);
    await writeJsonAtomic(filename(ownerId), { keywordWeights: normalized });
    return { settings: settingsFor(normalized), papers: rankPapersByRelevance(papers, normalized) };
  }
  return { get, save };
}

export const visitorScoring = createVisitorScoring();
