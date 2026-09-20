import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { DateTime } from "luxon";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
  processEntities: false,
  htmlEntities: false
});

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache"
};

const FEED_HEADERS = {
  ...BROWSER_HEADERS,
  Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
};

const PHYSICS_INCLUDE_TERMS = [
  "quantum",
  "quantum information",
  "quantum optics",
  "quantum communication",
  "quantum entanglement",
  "quantum sensing",
  "optics",
  "optical",
  "photonics",
  "photonic",
  "laser",
  "spectroscopy",
  "condensed matter",
  "superconduct",
  "spin",
  "magnetism",
  "magnon",
  "amo",
  "atomic",
  "molecular",
  "nanophotonic",
  "nanophotonics",
  "optoelectronic",
  "semiconductor",
  "metrology",
  "imaging",
  "x-ray",
  "detector",
  "scintillator",
  "topological",
  "interferometer",
  "optomechan",
  "plasmon",
  "polariton",
  "microcavity",
  "frequency comb",
  "ultrafast",
  "soliton",
  "dielectric",
  "metamaterial",
  "spintronic",
  "charge density",
  "moire",
  "transport",
  "battery",
  "electrolyte",
  "corrosion",
  "device physics",
  "sensor",
  "microscopy"
];

const PHYSICS_EXCLUDE_TERMS = [
  "biology",
  "biological",
  "medicine",
  "medical",
  "clinical",
  "genomics",
  "genomic",
  "ecology",
  "agriculture",
  "cancer biology",
  "neuroscience",
  "neural",
  "brain",
  "tumour",
  "tumor",
  "infection",
  "disease",
  "cell",
  "mouse",
  "mice",
  "patient",
  "immune",
  "protein",
  "gene",
  "genetic",
  "rna",
  "dna",
  "microbi",
  "parasite",
  "colitis"
];

const NON_RESEARCH_TERMS = [
  "correction",
  "author correction",
  "publisher correction",
  "retraction",
  "retraction note",
  "editorial",
  "news",
  "opinion",
  "comment",
  "career",
  "briefing",
  "books in brief",
  "book review",
  "podcast",
  "research highlight",
  "world view",
  "news & views",
  "news and views",
  "commentary"
];

const RESEARCH_TYPE_ALLOWLIST = new Set([
  "article",
  "brief communication",
  "research highlight"
]);

const NATURE_SOURCES = [
  {
    code: "ncomms",
    journal: "Nature Communications",
    feedUrls: ["https://www.nature.com/ncomms.rss"],
    fallbackListUrl: "https://www.nature.com/ncomms/articles?sort=PubDate&year=2026",
    requirePhysicsKeyword: true
  },
  {
    code: "nphys",
    journal: "Nature Physics",
    feedUrls: [
      "https://www.nature.com/nphys/journal/vaop/ncurrent/rss.rdf",
      "https://www.nature.com/nphys/current_issue/rss/"
    ],
    fallbackListUrl: "https://www.nature.com/nphys/articles?sort=PubDate&year=2026",
    requirePhysicsKeyword: false
  },
  {
    code: "nphoton",
    journal: "Nature Photonics",
    feedUrls: ["https://www.nature.com/nphoton.rss"],
    fallbackListUrl: "https://www.nature.com/nphoton/articles?sort=PubDate&year=2026",
    requirePhysicsKeyword: false
  },
  {
    code: "npjqi",
    journal: "npj Quantum Information",
    feedUrls: ["https://www.nature.com/npjqi.rss"],
    fallbackListUrl: "https://www.nature.com/npjqi/articles?sort=PubDate&year=2026",
    requirePhysicsKeyword: false
  }
];

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function decodeHtml(text) {
  if (!text) {
    return "";
  }

  return load(`<root>${text}</root>`)("root").text();
}

function cleanText(text) {
  return decodeHtml(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDoi(value) {
  const text = cleanText(value || "");
  const match = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return match ? match[0] : "";
}

function looksCorruptedText(text) {
  return /[鈥鈭锟茅枚么]/.test(text || "");
}

function preferCleanerText(primary, secondary) {
  const first = cleanText(primary || "");
  const second = cleanText(secondary || "");

  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  if (looksCorruptedText(first) && !looksCorruptedText(second)) {
    return second;
  }

  if (looksCorruptedText(second) && !looksCorruptedText(first)) {
    return first;
  }

  return second.length > first.length ? second : first;
}

function uniqueAuthors(authors) {
  const seen = new Set();
  const result = [];

  for (const author of authors.map(cleanText).filter(Boolean)) {
    const key = author.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(author);
  }

  return result;
}

function extractAbstractFromEncoded(encoded) {
  const html = encoded || "";
  if (!html) {
    return "";
  }

  const $ = load(`<root>${html}</root>`);
  const paragraphs = $("root")
    .find("p")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return cleanText($("root").text());
  }

  return cleanText(paragraphs.slice(1).join(" "));
}

function extractDate(rawItem) {
  return (
    cleanText(rawItem.date) ||
    cleanText(rawItem.pubDate) ||
    cleanText(rawItem.publicationDate) ||
    cleanText(rawItem["dc:date"]) ||
    ""
  );
}

function extractUrl(rawItem) {
  return cleanText(rawItem.url || rawItem.link || rawItem.about || rawItem.guid || "");
}

function extractAuthors(rawItem) {
  const creators = [
    ...asArray(rawItem.creator),
    ...asArray(rawItem["dc:creator"]),
    ...asArray(rawItem.author)
  ];

  return uniqueAuthors(
    creators.flatMap((value) => {
      if (typeof value === "string") {
        return value.split(/\s+and\s+|;\s*|,\s*(?=[A-Z][a-z])/);
      }

      if (value?.name) {
        return [value.name];
      }

      return [];
    })
  );
}

export async function fetchFeed(url) {
  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      try {
        const response = await fetch(url, {
          headers: FEED_HEADERS,
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Feed request failed: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") || "";
        const xml = await response.text();
        if (!contentType.includes("xml") && !xml.trim().startsWith("<")) {
          throw new Error(`Feed response is not XML for ${url}`);
        }

        return xml;
      } finally {
        clearTimeout(timeout);
      }
    },
    { retries: 2, delayMs: 1200 }
  );
}

export function parseRssOrRdf(xml, sourceConfig) {
  const parsed = xmlParser.parse(xml);
  const items = parsed?.RDF?.item || parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
  const normalized = asArray(items);

  if (normalized.length === 0) {
    throw new Error(`Empty feed for ${sourceConfig.journal}`);
  }

  return normalized;
}

export function normalizeItem(rawItem, sourceConfig) {
  const title = cleanText(
    Array.isArray(rawItem.title) ? rawItem.title[0] : rawItem.title || rawItem["dc:title"] || ""
  );
  const authors = extractAuthors(rawItem);
  const abstract = cleanText(
    rawItem.summary || rawItem.description || rawItem.content || rawItem.encoded
      ? extractAbstractFromEncoded(rawItem.encoded || rawItem.summary || rawItem.description || rawItem.content)
      : ""
  );
  const doi = cleanDoi(rawItem.doi || rawItem.identifier || rawItem["prism:doi"] || rawItem.id || "");
  const date = extractDate(rawItem);
  const url = extractUrl(rawItem);

  return {
    title,
    authors,
    abstract,
    doi,
    date,
    url,
    journal: sourceConfig.journal,
    articleType: cleanText(rawItem.type || rawItem.articleType || ""),
    sourceType: "feed"
  };
}

export function isRecentWithinDays(dateValue, days) {
  if (!dateValue) {
    return false;
  }

  const timezone = config.app.timezone || "Asia/Shanghai";
  const parsed = DateTime.fromISO(dateValue, { zone: timezone });
  if (!parsed.isValid) {
    return false;
  }

  const cutoff = DateTime.now().setZone(timezone).startOf("day").minus({ days: days - 1 });
  return parsed >= cutoff;
}

export function isNonResearchItem(title, abstract = "") {
  const text = `${title} ${abstract}`.toLowerCase();
  return NON_RESEARCH_TERMS.some((term) => text.includes(term));
}

function countMatches(text, terms) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

export function isPhysicsRelated(title, abstract, journal) {
  const text = `${title} ${abstract}`.toLowerCase();
  const includeCount = countMatches(text, PHYSICS_INCLUDE_TERMS);
  const excludeCount = countMatches(text, PHYSICS_EXCLUDE_TERMS);

  if (journal === "Nature Communications") {
    if (includeCount === 0) {
      return false;
    }

    return includeCount > excludeCount;
  }

  if (journal === "npj Quantum Information") {
    return !isNonResearchItem(title, abstract);
  }

  if (journal === "Nature Physics" || journal === "Nature Photonics") {
    return includeCount > 0 || excludeCount === 0;
  }

  return includeCount > excludeCount;
}

function normalizeTitleKey(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeByDoiOrTitle(items) {
  const seen = new Map();

  for (const item of items) {
    const key = item.doi ? `doi:${item.doi.toLowerCase()}` : `title:${normalizeTitleKey(item.title)}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, item);
      continue;
    }

    const currentAbstractLength = item.abstract?.length || 0;
    const existingAbstractLength = existing.abstract?.length || 0;
    seen.set(key, currentAbstractLength > existingAbstractLength ? item : existing);
  }

  return Array.from(seen.values());
}

async function fetchHtml(url, accept = BROWSER_HEADERS.Accept) {
  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      try {
        let currentUrl = url;
        for (let step = 0; step < 10; step += 1) {
          const response = await fetch(currentUrl, {
            redirect: "manual",
            headers: {
              ...BROWSER_HEADERS,
              Accept: accept
            },
            signal: controller.signal
          });

          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) {
              throw new Error(`Redirect without location for ${currentUrl}`);
            }

            currentUrl = new URL(location, currentUrl).toString();
            continue;
          }

          if (!response.ok) {
            throw new Error(`HTML request failed: ${response.status} ${response.statusText}`);
          }

          return await response.text();
        }

        throw new Error(`Too many redirects for ${url}`);
      } finally {
        clearTimeout(timeout);
      }
    },
    { retries: 1, delayMs: 1000 }
  );
}

function parseArticleType($article) {
  return cleanText(
    $article.find("[data-test='article.type'] .c-meta__type").first().text() ||
      $article.find(".c-meta__type").first().text()
  );
}

async function fetchFallbackList(sourceConfig) {
  const items = [];
  const seenUrls = new Set();
  const maxPages = 8;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = new URL(sourceConfig.fallbackListUrl);
    if (page > 1) {
      pageUrl.searchParams.set("page", String(page));
    }

    const html = await fetchHtml(pageUrl.toString());
    const $ = load(html);
    const pageItems = [];

    $("article").each((_, element) => {
      const $article = $(element);
      const title = cleanText($article.find(".c-card__title a").first().text());
      const url = cleanText($article.find(".c-card__title a").first().attr("href") || "");
      const abstract = cleanText($article.find("[data-test='article-description']").first().text());
      const authors = uniqueAuthors(
        $article
          .find("[data-test='author-list'] [itemprop='name']")
          .toArray()
          .map((node) => $(node).text())
      );
      const articleType = parseArticleType($article);
      const date = cleanText($article.find("time").attr("datetime") || $article.find("time").text());

      if (!title || !url) {
        return;
      }

      const absoluteUrl = new URL(url, "https://www.nature.com").toString();
      if (seenUrls.has(absoluteUrl)) {
        return;
      }

      seenUrls.add(absoluteUrl);
      pageItems.push({
        title,
        authors,
        abstract,
        doi: "",
        date,
        url: absoluteUrl,
        journal: sourceConfig.journal,
        articleType,
        sourceType: "fallback-list"
      });
    });

    if (pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);

    const hasRecentOnPage = pageItems.some((item) => isRecentWithinDays(item.date, 7));
    if (!hasRecentOnPage) {
      break;
    }
  }

  return items;
}

async function fetchArticleDetail(url) {
  const html = await fetchHtml(url);
  const $ = load(html);

  const meta = (name) => cleanText($(`meta[name='${name}']`).attr("content") || "");
  const metaMany = (name) =>
    uniqueAuthors(
      $(`meta[name='${name}']`)
        .toArray()
        .map((element) => $(element).attr("content") || "")
    );

  const title = meta("citation_title") || cleanText($("h1").first().text());
  const authors = metaMany("citation_author");
  const abstract =
    meta("dc.description") ||
    meta("description") ||
    cleanText($(".c-article-section__content p").first().text()) ||
    cleanText($(".c-article-teaser").first().text());
  const doi = cleanDoi(meta("prism.doi") || meta("citation_doi") || meta("dc.identifier"));
  const date =
    meta("prism.publicationDate") ||
    meta("citation_online_date") ||
    meta("dc.date") ||
    cleanText($("time").first().attr("datetime") || "");
  const articleType = meta("citation_article_type") || meta("dc.type");

  return {
    title,
    authors,
    abstract,
    doi,
    date,
    articleType
  };
}

function shouldAllowResearchType(articleType) {
  if (!articleType) {
    return true;
  }

  return RESEARCH_TYPE_ALLOWLIST.has(articleType.toLowerCase());
}

async function fetchSource(sourceConfig, days = 7, options = {}) {
  let feedItems = [];
  let fallbackItems = [];
  let feedRawCount = 0;

  for (const feedUrl of sourceConfig.feedUrls) {
    try {
      const xml = await fetchFeed(feedUrl);
      const rawItems = parseRssOrRdf(xml, sourceConfig);
      feedRawCount = Math.max(feedRawCount, rawItems.length);
      feedItems = rawItems.map((item) => normalizeItem(item, sourceConfig));
      break;
    } catch (error) {
      logger.warn("Nature feed failed, trying next source", {
        journal: sourceConfig.journal,
        feedUrl,
        error: error.message
      });
    }
  }

  if (!options.fastOnly || feedItems.length === 0) {
    try {
      fallbackItems = await fetchFallbackList(sourceConfig);
    } catch (error) {
      logger.warn("Nature fallback list failed", {
        journal: sourceConfig.journal,
        error: error.message
      });
    }
  }

  const items = dedupeByDoiOrTitle([...feedItems, ...fallbackItems]);
  const recentItems = items.filter((item) => isRecentWithinDays(item.date, days));
  const detailReadyItems = options.fastOnly ? recentItems : await Promise.all(
    recentItems.map(async (item) => {
      try {
        // For feed entries, detail pages often have a cleaner abstract in meta tags.
        const detail = await fetchArticleDetail(item.url);
        return {
          ...item,
          title: preferCleanerText(item.title, detail.title),
          authors: item.authors.length ? item.authors : detail.authors,
          abstract: preferCleanerText(item.abstract, detail.abstract),
          doi: detail.doi || item.doi,
          date: detail.date || item.date,
          articleType: detail.articleType || item.articleType
        };
      } catch (error) {
        logger.warn("Nature detail fetch failed, keeping feed summary", {
          journal: sourceConfig.journal,
          url: item.url,
          error: error.message
        });
        return item;
      }
    })
  );

  const researchItems = detailReadyItems.filter(
    (item) => !isNonResearchItem(item.title, item.abstract) && shouldAllowResearchType(item.articleType)
  );
  const physicsItems = researchItems.filter((item) =>
    isPhysicsRelated(item.title, item.abstract, sourceConfig.journal)
  );

  logger.info("Nature source processed", {
    journal: sourceConfig.journal,
    strategy: feedItems.length && fallbackItems.length ? "feed+fallback" : feedItems.length ? "feed" : "fallback",
    feedRaw: feedRawCount,
    fallbackRaw: fallbackItems.length,
    raw: items.length,
    recentWithin7Days: recentItems.length,
    filteredNonResearch: detailReadyItems.length - researchItems.length,
    filteredNonPhysics: researchItems.length - physicsItems.length,
    kept: physicsItems.length
  });

  return physicsItems.map((item) => ({
    id: `nature:${item.doi || normalizeTitleKey(item.title)}`,
    source: "nature",
    journal: sourceConfig.code,
    journal_display: sourceConfig.journal,
    status: "published",
    title: item.title,
    authors: item.authors,
    abstract: item.abstract,
    doi: item.doi,
    date: item.date,
    url: item.url,
    raw_source: item.sourceType,
    fetched_at: new Date().toISOString(),
    extra: {
      article_type: item.articleType || ""
    }
  }));
}

export async function fetchNatureRecentPhysicsRecords(days = 7, options = {}) {
  const settled = await Promise.allSettled(
    NATURE_SOURCES.map((sourceConfig) => fetchSource(sourceConfig, days, options))
  );

  const allItems = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
      continue;
    }

    logger.warn("Nature source failed", { error: result.reason?.message || String(result.reason) });
  }

  return dedupeByDoiOrTitle(allItems).filter((item) => item.title && item.doi);
}

export async function fetchNatureRecentPhysics(days = 7) {
  const items = await fetchNatureRecentPhysicsRecords(days);
  return items.map((item) => ({
    title: item.title,
    authors: item.authors,
    abstract: item.abstract,
    doi: item.doi
  }));
}

export { NATURE_SOURCES };
