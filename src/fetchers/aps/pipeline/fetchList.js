import { logger } from "../../../utils/logger.js";
import { fetchStructuredList } from "../api/list.js";
import { getApsRoutes } from "../web/routes.js";
import { parseApsListPage } from "../web/listParser.js";
import { fetchApsWebPage } from "../web/client.js";
import { fetchAcceptedListWithPlaywright } from "../web/playwrightClient.js";

async function fetchWebList(journalConfig, status, page = 1) {
  const { listUrl } = getApsRoutes(journalConfig, status, page);
  const html = await fetchApsWebPage(listUrl, {
    journalConfig,
    page,
    stage: `web-list:${status}`
  });

  return {
    rawSource: "web",
    items: parseApsListPage(html, journalConfig, status),
    raw: {
      url: listUrl,
      html
    }
  };
}

async function fetchAcceptedListWithFallback(journalConfig, page = 1) {
  try {
    return await fetchWebList(journalConfig, "accepted", page);
  } catch (error) {
    logger.warn("APS accepted web list failed, trying Playwright", {
      journal: journalConfig.code,
      page,
      fallbackStage: "web-to-playwright",
      error: error.message
    });

    const { listUrl } = getApsRoutes(journalConfig, "accepted", page);
    const html = await fetchAcceptedListWithPlaywright(journalConfig, listUrl, page);

    return {
      rawSource: "web",
      items: parseApsListPage(html, journalConfig, "accepted"),
      raw: {
        url: listUrl,
        html,
        via: "playwright"
      }
    };
  }
}

export async function fetchApsList(journalConfig, status) {
  try {
    const result = await fetchStructuredList(journalConfig, status);
    logger.info("Fetched APS structured list", {
      journal: journalConfig.code,
      status,
      count: result.items.length
    });
    return result;
  } catch (error) {
    logger.warn("APS structured list failed, falling back to web", {
      journal: journalConfig.code,
      status,
      page: 1,
      fallbackStage: "structured-to-web",
      error: error.message
    });

    try {
      if (status === "accepted") {
        return await fetchAcceptedListWithFallback(journalConfig, 1);
      }

      return await fetchWebList(journalConfig, status, 1);
    } catch (webError) {
      throw new Error(
        `APS list unavailable for ${journalConfig.code}:${status}. structured=${error.message}; web=${webError.message}`
      );
    }
  }
}
