import crypto from "node:crypto";
import { DateTime } from "luxon";
import { config } from "../../config/index.js";
import { APS_RAW_SOURCE, APS_SOURCE } from "./types.js";

function cleanText(text) {
  const value = Array.isArray(text) ? text[0] : text;
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createFallbackId(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 20);
}

export function normalizeApsRecord(record) {
  const doi = cleanText(record.doi);
  const title = cleanText(record.title);
  const date = record.date
    ? DateTime.fromISO(record.date, { zone: "utc" }).setZone(config.app.timezone).toISO() || record.date
    : null;
  const journal = cleanText(record.journal || "");
  const journalDisplay = cleanText(record.journalDisplay || "");
  const url = cleanText(record.url || "");
  const id = doi
    ? `aps:${doi.toLowerCase()}`
    : `aps:${createFallbackId(`${journal}|${title}|${date || ""}`)}`;

  return {
    id,
    source: APS_SOURCE,
    journal,
    journal_display: journalDisplay,
    status: record.status,
    title,
    authors: Array.isArray(record.authors) ? record.authors.map(cleanText).filter(Boolean) : [],
    abstract: cleanText(record.abstract || ""),
    doi,
    date,
    url,
    raw_source: record.rawSource || APS_RAW_SOURCE.api,
    fetched_at: new Date().toISOString(),
    extra: {
      section: cleanText(record.section || ""),
      issue: cleanText(record.issue || ""),
      volume: cleanText(record.volume || ""),
      article_type: cleanText(record.articleType || ""),
      historical_status: record.historicalStatus || []
    }
  };
}
