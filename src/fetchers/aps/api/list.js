import { load } from "cheerio";
import { APS_RAW_SOURCE } from "../types.js";
import { fetchApsXml, parseApsXml } from "./client.js";

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stripMarkup(html) {
  if (!html) {
    return "";
  }

  const firstPass = load(`<root>${html}</root>`);
  const decoded = firstPass("root").text();
  const secondPass = load(`<root>${decoded}</root>`);
  return secondPass("root").text().replace(/\s+/g, " ").trim();
}

function parseAuthors(rawCreator) {
  if (!rawCreator) {
    return [];
  }

  return rawCreator
    .replace(/\s+and\s+/g, ", ")
    .split(/,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFeedItem(item, journalConfig, status) {
  const titleValue = Array.isArray(item.title) ? item.title[0] : item.title;
  const encoded = item.encoded || item.description || "";
  const $ = load(`<root>${encoded}</root>`);
  const paragraphs = $("root").children().toArray().map((element) => stripMarkup($.html(element)));
  const abstractCandidate = paragraphs
    .filter((text) => text && !/^Author\(s\):/i.test(text) && !/^\[Phys\./i.test(text))
    .join(" ")
    .trim();

  return {
    title: stripMarkup(titleValue || ""),
    authors: parseAuthors(item.creator || ""),
    abstract: abstractCandidate,
    doi: item.doi || item.identifier?.replace(/^doi:/i, "") || "",
    date: item.publicationDate || item.date || null,
    journal: journalConfig.code,
    journalDisplay: item.publicationName || journalConfig.displayName,
    url: item.url || item.link || item.about || "",
    status,
    rawSource: APS_RAW_SOURCE.api,
    section: item.section || item.subject || "",
    issue: item.number || "",
    volume: item.volume || "",
    articleType: item.type || "article",
    raw: item
  };
}

export async function fetchStructuredList(journalConfig, status) {
  const feedUrl = journalConfig.rss?.[status];
  if (!feedUrl) {
    throw new Error(`Missing APS structured feed for ${journalConfig.code}:${status}`);
  }

  const xml = await fetchApsXml(feedUrl);
  const parsed = parseApsXml(xml);
  const items = asArray(parsed?.RDF?.item || parsed?.rss?.channel?.item).map((item) =>
    normalizeFeedItem(item, journalConfig, status)
  );

  return {
    rawSource: APS_RAW_SOURCE.api,
    items,
    raw: {
      url: feedUrl,
      xml
    }
  };
}
