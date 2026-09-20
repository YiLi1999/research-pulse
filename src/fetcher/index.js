import { DateTime } from "luxon";
import { config } from "../config/index.js";
import { fetchFromApi } from "./arxivClient.js";
import { fetchFromRecentPage } from "./recentPageClient.js";
import { logger } from "../utils/logger.js";
import { paperMatchesCategory } from "./arxivCategories.js";

export function dedupePapers(papers) {
  const seen = new Map();

  for (const paper of papers) {
    if (!paper.id) {
      continue;
    }

    const key = paper.id.replace(/v\d+$/, "");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, paper);
      continue;
    }

    const newer = (Number(paper.id.match(/v(\d+)$/)?.[1]) || 0) >= (Number(existing.id.match(/v(\d+)$/)?.[1]) || 0) ? paper : existing;
    seen.set(key, {
      ...existing,
      ...newer,
      categories: [...new Set([...(existing.categories || []), ...(paper.categories || [])])],
      arxivCollections: [...new Set([...(existing.arxivCollections || []), ...(paper.arxivCollections || [])])],
      authors: newer.authors?.length ? newer.authors : existing.authors,
      abstract: newer.abstract || existing.abstract,
      submittedAt: existing.submittedAt || paper.submittedAt,
      updatedAt: newer.updatedAt || existing.updatedAt,
      source: newer.source || existing.source
    });
  }

  return Array.from(seen.values());
}

function sortPapers(papers) {
  return papers.sort((left, right) => {
    const rightDate = right.submittedAt ? DateTime.fromISO(right.submittedAt).toMillis() : 0;
    const leftDate = left.submittedAt ? DateTime.fromISO(left.submittedAt).toMillis() : 0;
    return rightDate - leftDate;
  });
}

export async function fetchLatestPapers(options = {}) {
  const categories = options.categories || config.arxiv.categories;
  const fetchApi = options.fetchApi || fetchFromApi, fetchRecent = options.fetchRecent || fetchFromRecentPage;
  const papers = [], collections = [], rawPages = [], fallbackPages = [];
  for (const category of categories) {
    let result, source = 'api';
    try {
      result = await fetchApi({ category });
      logger.info('Fetched papers from arXiv API', { category, count: result.papers.length, complete: result.complete });
    } catch (error) {
      logger.warn('Failed to fetch arXiv category', { category, error: error.message });
    }
    // The broad math archive needs complete dated API pagination, not the abbreviated recent listing.
    if (!result && category !== 'math' && config.arxiv.enableFallback) {
      try { result = await fetchRecent({ category }); source = 'recent-page'; }
      catch (error) { logger.warn('Failed to fetch arXiv recent page', { category, error: error.message }); }
    }
    const cached = (options.existingPapers || []).filter(p => paperMatchesCategory(p, category));
    if (result) {
      const complete = result.complete !== false;
      papers.push(...(!complete ? cached : []), ...result.papers.map(p => ({ ...p, arxivCollections: [category] })));
      rawPages.push(...(result.rawPages || []));
      if (result.rawHtml) fallbackPages.push(result.rawHtml);
      collections.push({ category, status: complete ? 'updated' : 'partial', count: result.papers.length,
        warning: complete ? '' : '达到分页上限，本次数据可能不完整；保留已有缓存。' });
    } else {
      papers.push(...cached);
      source = 'cached';
      collections.push({ category, status: 'cached', count: cached.length, warning: '抓取失败，保留已有缓存；若尚无缓存则本次为空。' });
    }
    collections.at(-1).source = source;
  }
  if (collections.every(c => c.status === 'cached') && !papers.length) throw new Error('所有 arXiv 分类抓取失败，且无已有缓存。');
  return { papers: sortPapers(dedupePapers(papers)), collections,
    source: collections.map(c => c.category + ':' + c.source + (c.status === 'partial' ? ':partial' : '')).join(', '),
    raw: { api: rawPages.length ? { rawPages } : null, fallback: fallbackPages.length ? { rawHtml: fallbackPages.join('\n') } : null } };
}
