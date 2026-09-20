import path from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/index.js";
import { ensureDir, readJson, writeJson, writeJsonAtomic, writeText } from "../utils/fs.js";

export async function initializeStorage() {
  await Promise.all([
    ensureDir(config.paths.dataRoot),
    ensureDir(config.paths.raw),
    ensureDir(config.paths.aps),
    ensureDir(config.paths.apsRaw),
    ensureDir(config.paths.nature),
    ensureDir(config.paths.natureRaw),
    ensureDir(config.paths.summaries),
    ensureDir(config.paths.analysis),
    ensureDir(config.paths.cache)
  ]);
}

export async function loadPapers() {
  return readJson(config.paths.papers, []);
}

export async function savePapers(papers) {
  await writeJsonAtomic(config.paths.papers, papers);
}

export async function loadArxivPapers() {
  return readJson(config.paths.arxivPapers, []);
}

export async function saveArxivPapers(papers) {
  await writeJson(config.paths.arxivPapers, papers);
}

export async function loadApsPapers() {
  return readJson(config.paths.apsPapers, []);
}

export async function saveApsPapers(papers) {
  await writeJson(config.paths.apsPapers, papers);
}

export async function loadApsAcceptedLocal() {
  return readJson(config.paths.apsAcceptedLocal, []);
}

export async function saveApsAcceptedLocal(papers) {
  await writeJson(config.paths.apsAcceptedLocal, papers);
}

export async function loadNaturePapers() {
  return readJson(config.paths.naturePapers, []);
}

export async function saveNaturePapers(papers) {
  await writeJson(config.paths.naturePapers, papers);
}

export async function loadState() {
  return readJson(config.paths.state, {
    lastRefreshAt: null,
    knownPaperIds: [],
    lastSource: null
  });
}

export async function saveState(state) {
  await writeJson(config.paths.state, state);
}

export async function loadSummaryIndex() {
  return readJson(config.paths.summaryIndex, {});
}

export async function saveSummaryIndex(index) {
  await writeJson(config.paths.summaryIndex, index);
}

export async function saveAnalysis(analysis) {
  await writeJson(config.paths.analysisLatest, analysis);
}

export async function loadAnalysis() {
  return readJson(config.paths.analysisLatest, null);
}

export async function loadScoringConfig() {
  try {
    return JSON.parse(await readFile(config.paths.scoringConfig, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // Never replace unreadable user settings with defaults.
    throw error;
  }
}

export async function saveScoringConfig(scoringConfig) {
  await writeJsonAtomic(config.paths.scoringConfig, scoringConfig);
}

function toCsvCell(value) {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function toCategories(paper) {
  if (Array.isArray(paper.categories) && paper.categories.length > 0) {
    return paper.categories.join(" | ");
  }

  return [paper.journal_display, paper.journal].filter(Boolean).join(" | ");
}

function toExportRow(paper) {
  return {
    title: paper.title || "",
    authors: Array.isArray(paper.authors) ? paper.authors.join(", ") : "",
    published_date: paper.date || paper.submittedAt || "",
    categories: toCategories(paper),
    url: paper.url || paper.arxivUrl || "",
    relevance_score: paper.recommendation?.relevance_score ?? paper.recommendation?.score ?? 0,
    matched_phrases: (paper.recommendation?.matched_phrases || [])
      .map((item) => item.phrase)
      .join(" | "),
    matched_keywords: (paper.recommendation?.matched_keywords || [])
      .map((item) => item.keyword)
      .join(" | "),
    positive_reasons: (paper.recommendation?.positive_reasons || []).join(" | "),
    negative_reasons: (paper.recommendation?.negative_reasons || []).join(" | ")
  };
}

export async function saveRelevanceRankingExport(papers) {
  const rows = papers.map(toExportRow);
  await writeJson(config.paths.relevanceRankingJson, rows);

  const headers = [
    "title",
    "authors",
    "published_date",
    "categories",
    "url",
    "relevance_score",
    "matched_phrases",
    "matched_keywords",
    "positive_reasons",
    "negative_reasons"
  ];

  const csvLines = [headers.map(toCsvCell).join(",")];
  for (const row of rows) {
    csvLines.push(headers.map((key) => toCsvCell(row[key])).join(","));
  }
  await writeText(config.paths.relevanceRankingCsv, `${csvLines.join("\n")}\n`);
}

export async function saveRawSnapshot(name, extension, content) {
  const filePath = path.join(config.paths.raw, `${name}.${extension}`);
  if (extension === "json") {
    await writeJson(filePath, content);
    return filePath;
  }

  await writeText(filePath, content);
  return filePath;
}

export async function saveApsRawSnapshot(name, extension, content) {
  const filePath = path.join(config.paths.apsRaw, `${name}.${extension}`);
  if (extension === "json") {
    await writeJson(filePath, content);
    return filePath;
  }

  await writeText(filePath, content);
  return filePath;
}

export async function saveNatureRawSnapshot(name, extension, content) {
  const filePath = path.join(config.paths.natureRaw, `${name}.${extension}`);
  if (extension === "json") {
    await writeJson(filePath, content);
    return filePath;
  }

  await writeText(filePath, content);
  return filePath;
}
