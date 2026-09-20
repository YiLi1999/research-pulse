const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "using",
  "based",
  "their",
  "under",
  "quantum",
  "physics",
  "study",
  "show",
  "shows",
  "paper",
  "state",
  "states"
]);

export function extractKeywordsHeuristically(paper, limit = 8) {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  const tokens = text
    .replace(/[^a-z0-9\-\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}
