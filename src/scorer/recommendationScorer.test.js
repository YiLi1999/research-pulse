import test from "node:test";
import assert from "node:assert/strict";
import { scorePaper, rankPapersByRelevance, normalizeKeywordWeights } from "./recommendationScorer.js";

test("score is exactly the sum of configured title ×2 and abstract ×1 contributions", () => {
  const score = scorePaper({ title: "Magic and MAGIC", abstract: "Magic magic; fidelity estimation." },
    { magic: 2.5, "fidelity estimation": 4 });
  assert.equal(score.score, 11.5);
  assert.deepEqual(score.matched_keywords.find(item => item.keyword === "magic"),
    { keyword: "magic", weight: 2.5, hits: { title: 1, abstract: 1 }, contribution: 7.5 });
  assert.equal(score.score, score.matched_keywords.reduce((sum, item) => sum + item.contribution, 0));
});

test("keywords are case-insensitive, match whole words/phrases, and normalize Unicode hyphens", () => {
  const weights = { magic: 1, nonstabilizerness: 2, "fidelity estimation": 3, "many-body": 4 };
  assert.equal(scorePaper({ title: "MAGIC Nonstabilizerness; many‑body", abstract: "FIDELITY   ESTIMATION" }, weights).score, 17);
  assert.equal(scorePaper({ title: "Magical nonstabilizernesses; fidelity estimationism" }, weights).score, 0);
});

test("regex symbols and Unicode keywords are treated literally", () => {
  assert.equal(scorePaper({ title: "C++ and (magic) and 量子纠缠" }, { "C++": 2, "(magic)": 3, "量子纠缠": 4 }).score, 18);
  assert.equal(scorePaper({ title: "Anything" }, { ".*": 100 }).score, 0);
});

test("only title and abstract count; no hidden levels, bonuses or domain penalties remain", () => {
  const score = scorePaper({
    title: "Device-independent randomness certification and bell inequality",
    abstract: "Quantum chemistry and classical machine learning",
    authors: ["Magic"], categories: ["magic"]
  }, { magic: 20 });
  assert.equal(score.score, 0);
  assert.equal(score.synergy_bonus, 0);
  assert.deepEqual(score.negative_reasons, []);
});

test("editing weights, adding and deleting keywords changes the actual ranking", () => {
  const papers = [{ id: "magic", title: "Magic" }, { id: "entanglement", title: "Entanglement" }];
  assert.equal(rankPapersByRelevance(papers, { magic: 1, entanglement: 2 })[0].id, "entanglement");
  assert.equal(rankPapersByRelevance(papers, { magic: 3, entanglement: 2 })[0].id, "magic");
  assert.equal(rankPapersByRelevance(papers, { entanglement: 2 })[0].id, "entanglement");
  assert.equal(rankPapersByRelevance(papers, { magic: 3 })[0].id, "magic");
  assert.equal(papers[0].recommendation, undefined);
});

test("zero/empty settings disable scores, ties use date then stable id, and ranks are consecutive", () => {
  const papers = [
    { id: "b", title: "Magic", date: "2026-08-20" },
    { id: "z", title: "Magic", date: "2026-08-29" },
    { id: "a", title: "Magic", date: "2026-08-20" },
    { id: "unknown", title: "Magic", date: "invalid" }
  ];
  for (const weights of [{}, { magic: 0 }]) {
    const ranked = rankPapersByRelevance(papers, weights);
    assert.deepEqual(ranked.map(p => p.id), ["z", "a", "b", "unknown"]);
    assert.deepEqual(ranked.map(p => p.recommendation.final_rank), [1, 2, 3, 4]);
    assert.ok(ranked.every(p => p.recommendation.score === 0 && !p.recommendation.matched_keywords.length));
  }
});

test("validation rejects malformed, duplicate and invalid weights instead of silently deleting settings", () => {
  for (const invalid of [undefined, null, [], "magic", { " ": 1 }, { magic: -1 }, { magic: null },
    { magic: "2" }, { magic: Infinity }, { magic: 100001 }, { magic: 1, " MAGIC ": 2 }]) {
    assert.throws(() => normalizeKeywordWeights(invalid), error => error.statusCode === 400);
  }
  assert.deepEqual(normalizeKeywordWeights({ "  MAGIC  ": 0, "fidelity   estimation": 2.25 }), { magic: 0, "fidelity estimation": 2.25 });
  assert.deepEqual(normalizeKeywordWeights({}), {});
});
