import { load } from "cheerio";
import { config } from "../config/index.js";
import { cutoffDate } from "../utils/dates.js";
import { fetchArxivText as fetchText } from "./arxivRequest.js";
import { withRetry } from "../utils/retry.js";

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function parseRecentPage(html) {
  const $ = load(html);
  const papers = [];

  $("#articles dt").each((_, dtElement) => {
    const dt = $(dtElement);
    const dd = dt.next("dd");
    if (!dd.length) {
      return;
    }

    const idText = normalizeWhitespace(dt.find('a[title="Abstract"]').first().text()).replace(/^arXiv:/, "");
    if (!idText) {
      return;
    }

    const title = normalizeWhitespace(dd.find(".list-title").text().replace(/^Title:/, ""));
    const abstract = normalizeWhitespace(dd.find("p.mathjax").first().text());
    const authors = dd
      .find(".list-authors a")
      .map((__, author) => normalizeWhitespace($(author).text()))
      .get();
    const subjects = normalizeWhitespace(dd.find(".list-subjects").text().replace(/^Subjects:/, ""));
    const primaryCategory = dd.find(".primary-subject").text().trim() || config.arxiv.category;
    const categories = subjects
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);

    const isReplacement = /\(replaced\)/i.test(dt.text());
    const isCrossList = /\(cross-list/i.test(dt.text());

    papers.push({
      id: idText,
      title,
      authors,
      submittedAt: null,
      updatedAt: null,
      abstract,
      pdfUrl: `https://arxiv.org/pdf/${idText}.pdf`,
      arxivUrl: `https://arxiv.org/abs/${idText}`,
      primaryCategory,
      categories,
      source: "recent-page",
      isReplacement,
      isCrossList
    });
  });

  const dayLinks = $("#dlpage h2")
    .nextAll("ul")
    .first()
    .find("a")
    .map((_, element) => ({
      href: $(element).attr("href"),
      label: normalizeWhitespace($(element).text())
    }))
    .get();

  return { papers, dayLinks };
}

function parseRecentDateLabel(label) {
  const normalized = label.replace(/\./g, "").trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function buildRecentUrl(href) {
  return href?.startsWith("http") ? href : `https://arxiv.org${href}`;
}

function uniqueById(papers) {
  const map = new Map();
  for (const paper of papers) {
    map.set(paper.id, { ...map.get(paper.id), ...paper });
  }
  return Array.from(map.values());
}

function extractAbsDetails(html, id) {
  const $ = load(html);
  const abstract = normalizeWhitespace($("blockquote.abstract").text().replace(/^\s*Abstract:\s*/i, ""));
  const historyLine = $(".submission-history li").first().text();
  const match = historyLine.match(/\]\s*(.+?)\s*\(/);
  const submittedAt = match ? new Date(match[1]).toISOString() : null;

  return {
    id,
    abstract,
    submittedAt,
    updatedAt: submittedAt
  };
}

async function enrichPapersWithAbstracts(papers) {
  const enriched = [];
  const chunkSize = 6;

  for (let index = 0; index < papers.length; index += chunkSize) {
    const chunk = papers.slice(index, index + chunkSize);
    const results = await Promise.all(
      chunk.map(async (paper) => {
        if (paper.abstract && paper.submittedAt) {
          return paper;
        }

        try {
          const html = await withRetry(() => fetchText(paper.arxivUrl), { retries: 2, delayMs: 1000 });
          const details = extractAbsDetails(html, paper.id);
          return {
            ...paper,
            ...(details.abstract ? { abstract: details.abstract } : {}),
            ...(details.submittedAt ? { submittedAt: details.submittedAt } : {}),
            ...(details.updatedAt ? { updatedAt: details.updatedAt } : {})
          };
        } catch {
          return paper;
        }
      })
    );

    enriched.push(...results);
  }

  return enriched;
}

export async function fetchFromRecentPage({ category = config.arxiv.category } = {}) {
  const url = `https://arxiv.org/list/${category}/recent`;
  const html = await withRetry(() => fetchText(url), { retries: 2, delayMs: 1500 });
  const parsed = parseRecentPage(html);
  const cutoff = cutoffDate();
  const dayEntries = parsed.dayLinks
    .map((item) => ({
      ...item,
      date: parseRecentDateLabel(item.label)
    }))
    .filter((item) => item.href && item.date && new Date(item.date) >= cutoff.toJSDate());

  const pages = [{ url, html, label: "recent-index" }];
  for (const item of dayEntries) {
    if (buildRecentUrl(item.href) === url) {
      continue;
    }

    const pageHtml = await withRetry(() => fetchText(buildRecentUrl(item.href)), { retries: 2, delayMs: 1500 });
    pages.push({ url: buildRecentUrl(item.href), html: pageHtml, label: item.label });
  }

  const pagePapers = pages.flatMap((page) => {
    const pageParsed = parseRecentPage(page.html);
    const pageDate = page.label === "recent-index" ? dayEntries[0]?.date : parseRecentDateLabel(page.label);

    return pageParsed.papers.map((paper) => ({
      ...paper,
      submittedAt: paper.submittedAt || pageDate,
      updatedAt: paper.updatedAt || pageDate
    }));
  });

  const deduped = uniqueById(pagePapers);
  const enriched = await enrichPapersWithAbstracts(deduped);

  return {
    source: "recent-page",
    papers: enriched.filter((paper) => paper.submittedAt && new Date(paper.submittedAt) >= cutoff.toJSDate()),
    rawHtml: html,
    dayLinks: dayEntries
  };
}
