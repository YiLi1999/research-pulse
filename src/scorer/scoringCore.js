export const SCORING_RULE = Object.freeze({
  id: "keyword-weights-v1",
  title: 2,
  abstract: 1,
  maxKeywords: 200,
  maxKeywordLength: 100,
  maxWeight: 100000
});

export function normalizeKeyword(keyword) {
  return keyword.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ").trim();
}

export function normalizeKeywordWeights(value) {
  const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("keywordWeights 必须是关键词与数字权重组成的对象；空对象 {} 表示删除全部关键词。");
  }
  const entries = Object.entries(value);
  if (entries.length > SCORING_RULE.maxKeywords) invalid("最多设置 200 个关键词。");
  const seen = new Set();
  return Object.fromEntries(entries.map(([key, weight]) => {
    const keyword = normalizeKeyword(key);
    if (!keyword || keyword.length > SCORING_RULE.maxKeywordLength || /[\u0000-\u001f]/.test(keyword)) {
      invalid("关键词不能为空，且不能超过 100 个字符。");
    }
    if (seen.has(keyword)) invalid("关键词重复：" + keyword);
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > SCORING_RULE.maxWeight) {
      invalid("「" + keyword + "」的 weight 必须是 0–100000 之间的数字。");
    }
    seen.add(keyword);
    return [keyword, weight];
  }));
}

function matcher(keyword) {
  const escaped = keyword.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
  // Unicode word boundaries also support non-English keywords and literal symbols.
  return new RegExp("(?<![\\p{L}\\p{N}_])" + escaped + "(?![\\p{L}\\p{N}_])", "u");
}

const round = (value) => Math.round(value * 1e6) / 1e6;

function scoreWithRules(paper, rules) {
  const title = normalizeKeyword(paper.title || "");
  const abstract = normalizeKeyword(paper.abstract || "");
  const matches = [];
  for (const { keyword, weight, pattern } of rules) {
    if (weight === 0) continue;
    const hits = { title: Number(pattern.test(title)), abstract: Number(pattern.test(abstract)) };
    if (!hits.title && !hits.abstract) continue;
    matches.push({
      keyword, weight, hits,
      contribution: round(weight * (hits.title * SCORING_RULE.title + hits.abstract * SCORING_RULE.abstract))
    });
  }
  matches.sort((a, b) => b.contribution - a.contribution || a.keyword.localeCompare(b.keyword));
  const total = round(matches.reduce((sum, match) => sum + match.contribution, 0));
  const reasons = matches.map(({ keyword, weight, hits, contribution }) =>
    keyword + ": " + weight + " × (" + hits.title + " × 2 + " + hits.abstract + " × 1) = " + contribution);
  return {
    score: total,
    relevance_score: total,
    scoring_rule: SCORING_RULE.id,
    matched_keywords: matches,
    matchedKeywords: matches.map(({ keyword, contribution }) => ({ keyword, weight: contribution })),
    matched_phrases: [],
    matched_levels: [],
    synergy_bonus: 0,
    positive_reasons: reasons,
    negative_reasons: [],
    final_rank: null,
    explanation: ["Score = Σ weight × (title match × 2 + abstract match × 1) = " + total, ...reasons]
  };
}

function compileRules(keywordWeights) {
  return Object.entries(normalizeKeywordWeights(keywordWeights)).map(([keyword, weight]) => ({
    keyword, weight, pattern: matcher(keyword)
  }));
}

export function scorePaper(paper, keywordWeights = {}) {
  return scoreWithRules(paper, compileRules(keywordWeights));
}

function dateValue(paper) {
  return Date.parse(paper.date || paper.submittedAt || "") || 0;
}

export function rankPapersByRelevance(papers, keywordWeights = {}) {
  const rules = compileRules(keywordWeights);
  const scored = papers.map((paper) => ({ ...paper, recommendation: scoreWithRules(paper, rules) }));
  scored.sort((a, b) => b.recommendation.score - a.recommendation.score || dateValue(b) - dateValue(a) ||
    String(a.id || a.title || "").localeCompare(String(b.id || b.title || "")));
  scored.forEach((paper, index) => { paper.recommendation.final_rank = index + 1; });
  return scored;
}
