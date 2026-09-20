import { XMLParser } from "fast-xml-parser";
import { config } from "../config/index.js";
import { parseArxivDate, cutoffDate } from "../utils/dates.js";
import { fetchArxivText } from './arxivRequest.js';
import { categoryQuery } from './arxivCategories.js';
import { withRetry } from "../utils/retry.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true
});

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeApiEntry(entry) {
  const idUrl = entry.id || "";
  const id = idUrl.split("/abs/")[1]?.trim();
  const published = parseArxivDate(entry.published).toISO();
  const updated = parseArxivDate(entry.updated).toISO();
  const categories = asArray(entry.category).map((item) => item.term).filter(Boolean);
  const authors = asArray(entry.author).map((author) => author.name).filter(Boolean);
  const links = asArray(entry.link);
  const pdfLink = links.find((item) => item.title === "pdf")?.href || `https://arxiv.org/pdf/${id}.pdf`;
  const primaryCategory = entry.primary_category?.term || categories[0] || config.arxiv.category;

  return {
    id,
    title: (entry.title || "").replace(/\s+/g, " ").trim(),
    authors,
    submittedAt: published,
    updatedAt: updated,
    abstract: (entry.summary || "").replace(/\s+/g, " ").trim(),
    pdfUrl: pdfLink,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    primaryCategory,
    categories,
    source: "api"
  };
}

export async function fetchFromApi({ category = config.arxiv.category, request = fetchArxivText,
  cutoff = cutoffDate(), maxPages = category === 'math' ? config.arxiv.mathMaxPages : config.arxiv.apiMaxPages,
  pageSize = config.arxiv.apiPageSize } = {}) {
  const papers = [];
  const rawPages = [];
  let complete = false;

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * pageSize;
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", categoryQuery(category));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");
    url.searchParams.set("start", String(start));
    url.searchParams.set("max_results", String(pageSize));

    const xml = await withRetry(() => request(url.toString()), { retries: 2, delayMs: 1500 });
    rawPages.push({ category, page, start, url: url.toString(), xml });

    const feed = parser.parse(xml)?.feed;
    if (!feed || asArray(feed.entry).some(entry => String(entry.id).includes('/api/errors'))) throw new Error(`arXiv ${category} 返回无效 Atom 数据。`);
    const entries = asArray(feed?.entry).map(normalizeApiEntry);

    if (entries.length === 0) {
      complete = true;
      break;
    }

    papers.push(...entries);

    const last = entries.at(-1);
    if (!last || parseArxivDate(last.submittedAt) < cutoff || entries.length < pageSize || start + entries.length >= Number(feed.totalResults)) {
      complete = true;
      break;
    }
  }

  return {
    source: "api",
    category, complete,
    papers: papers.filter((paper) => parseArxivDate(paper.submittedAt) >= cutoff),
    rawPages
  };
}
