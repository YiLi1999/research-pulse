import { getApsRoutes } from "./routes.js";
import { fetchApsWebPage } from "./client.js";
import { fetchAcceptedListWithPlaywright } from "./playwrightClient.js";
import { logger } from "../../../utils/logger.js";

export async function probeAcceptedCapabilities(journalConfig) {
  const { listUrl } = getApsRoutes(journalConfig, "accepted", 1);
  const result = {
    journal: journalConfig.code,
    accepted: {
      api: Boolean(journalConfig.rss?.accepted),
      web: false,
      browser: false
    },
    failures: []
  };

  try {
    await fetchApsWebPage(listUrl, {
      journalConfig,
      page: 1,
      stage: "probe-web-list:accepted"
    });
    result.accepted.web = true;
  } catch (error) {
    result.failures.push({ stage: "probe-web", error: error.message });
    logger.warn("APS accepted capability probe failed on web", {
      journal: journalConfig.code,
      error: error.message
    });
  }

  try {
    await fetchAcceptedListWithPlaywright(journalConfig, listUrl, 1);
    result.accepted.browser = true;
  } catch (error) {
    result.failures.push({ stage: "probe-browser", error: error.message });
    logger.warn("APS accepted capability probe failed on browser", {
      journal: journalConfig.code,
      error: error.message
    });
  }

  return result;
}
