import { load } from "cheerio";
import { APS_RAW_SOURCE } from "../types.js";

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function parseAuthors(text) {
  return cleanText(text)
    .replace(/^Author\(s\):\s*/i, "")
    .split(/\s+and\s+|,\s*(?=[^,]+$)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseApsListPage(html, journalConfig, status) {
  const $ = load(html);
  const items = [];

  $(".article, .feed-item, .article-panel, .article-item").each((_, element) => {
    const root = $(element);
    const titleAnchor = root.find("h5 a, h4 a, .title a").first();
    const authorsText = root.find(".authors, .authors-list").first().text();
    const dateText = root.find(".pub-info, .date, time").first().text();

    const url = titleAnchor.attr("href")
      ? new URL(titleAnchor.attr("href"), journalConfig.baseUrl).toString()
      : "";

    items.push({
      title: cleanText(titleAnchor.text()),
      authors: parseAuthors(authorsText),
      abstract: cleanText(root.find(".abstract, .summary").first().text()),
      doi: cleanText(root.find("[data-doi]").attr("data-doi") || ""),
      date: cleanText(dateText),
      journal: journalConfig.code,
      journalDisplay: journalConfig.displayName,
      url,
      status,
      rawSource: APS_RAW_SOURCE.web,
      raw: root.html()
    });
  });

  return items.filter((item) => item.title && item.url);
}
