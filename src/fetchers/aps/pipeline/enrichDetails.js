import { logger } from "../../../utils/logger.js";
import { fetchStructuredDetail } from "../api/detail.js";
import { parseApsDetailPage } from "../web/detailParser.js";
import { APS_JOURNALS } from "../journals.js";
import { fetchApsWebPage } from "../web/client.js";
import { fetchDetailWithPlaywright } from "../web/playwrightClient.js";

let webDetailAccessBlocked = false;

function needsDetail(item) {
  return !item.abstract || /…|\.\.\./.test(item.abstract) || !item.doi;
}

function resolveJournalConfig(item) {
  return APS_JOURNALS[item.journal] || APS_JOURNALS.prl;
}

async function fetchWebDetail(item) {
  const html = await fetchApsWebPage(item.url, {
    journalConfig: resolveJournalConfig(item),
    page: 1,
    stage: `web-detail:${item.status}`,
    isDetail: true
  });
  return parseApsDetailPage(html);
}

export async function enrichApsDetails(items) {
  const enriched = [];

  for (const item of items) {
    if (!needsDetail(item)) {
      enriched.push(item);
      continue;
    }

    let merged = { ...item };

    try {
      const structured = await fetchStructuredDetail(item);
      if (structured) {
        merged = {
          ...merged,
          abstract: structured.abstract || merged.abstract,
          doi: structured.doi || merged.doi,
          url: structured.url || merged.url
        };
      }
    } catch (error) {
      logger.warn("APS structured detail enrichment failed", {
        url: item.url,
        error: error.message
      });
    }

    if (needsDetail(merged) && merged.url && !webDetailAccessBlocked) {
      try {
        const webDetail = await fetchWebDetail(merged);
        merged = {
          ...merged,
          title: webDetail.title || merged.title,
          authors: webDetail.authors?.length ? webDetail.authors : merged.authors,
          abstract: webDetail.abstract || merged.abstract,
          doi: webDetail.doi || merged.doi,
          date: webDetail.date || merged.date,
          journalDisplay: webDetail.journalDisplay || merged.journalDisplay
        };
      } catch (error) {
        if (/403|Forbidden|Just a moment/i.test(error.message)) {
          try {
            const html = await fetchDetailWithPlaywright(resolveJournalConfig(merged), merged.url);
            const webDetail = parseApsDetailPage(html);
            merged = {
              ...merged,
              title: webDetail.title || merged.title,
              authors: webDetail.authors?.length ? webDetail.authors : merged.authors,
              abstract: webDetail.abstract || merged.abstract,
              doi: webDetail.doi || merged.doi,
              date: webDetail.date || merged.date,
              journalDisplay: webDetail.journalDisplay || merged.journalDisplay
            };
          } catch (playwrightError) {
            webDetailAccessBlocked = true;
            logger.warn("APS Playwright detail enrichment failed", {
              url: item.url,
              error: playwrightError.message
            });
          }
        }
        logger.warn("APS web detail enrichment failed", {
          url: item.url,
          error: error.message
        });
      }
    }

    if (!merged.abstract) {
      logger.warn("APS item missing abstract after detail enrichment", {
        title: merged.title,
        doi: merged.doi,
        url: merged.url
      });
    }

    enriched.push(merged);
  }

  return enriched;
}
