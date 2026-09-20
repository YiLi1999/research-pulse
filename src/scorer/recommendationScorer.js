import { config } from "../config/index.js";
import { scorePaper as score, rankPapersByRelevance as rank } from "./scoringCore.js";
export { SCORING_RULE, normalizeKeyword, normalizeKeywordWeights } from "./scoringCore.js";
export const scorePaper = (paper, weights = config.scoring.keywordWeights) => score(paper, weights);
export const rankPapersByRelevance = (papers, weights = config.scoring.keywordWeights) => rank(papers, weights);
