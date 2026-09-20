import { normalizeApsRecord } from "../normalize.js";
import { readLocalAcceptedExport } from "../localAccepted.js";
import { fetchApsList } from "../pipeline/fetchList.js";
import { enrichApsDetails } from "../pipeline/enrichDetails.js";
import { probeAcceptedCapabilities } from "../web/probe.js";
import { logger } from "../../../utils/logger.js";

export async function fetchAccepted(journalConfig, options = {}) {
  const hasStructuredAcceptedFeed = Boolean(journalConfig.rss?.accepted);
  // Lightweight refreshes never open an interactive browser for journals that
  // do not publish an accepted-paper feed. Keep any local export if available.
  if (options.fastOnly && !hasStructuredAcceptedFeed) {
    const localAccepted = await readLocalAcceptedExport([journalConfig.code]);
    return {
      raw: [{ journal: journalConfig.code, status: "accepted", rawSource: "local-json", payload: { count: localAccepted.length } }],
      normalized: localAccepted
    };
  }
  const capability = hasStructuredAcceptedFeed
    ? {
        journal: journalConfig.code,
        accepted: {
          api: true,
          web: false,
          browser: false
        },
        failures: []
      }
    : await probeAcceptedCapabilities(journalConfig);

  if (!capability.accepted.api && !capability.accepted.web && !capability.accepted.browser) {
    const localAccepted = await readLocalAcceptedExport([journalConfig.code]);
    if (localAccepted.length > 0) {
      logger.warn("Using local APS accepted export", {
        journal: journalConfig.code,
        fallbackStage: "local-json",
        count: localAccepted.length
      });

      return {
        raw: [
          {
            journal: journalConfig.code,
            status: "accepted",
            rawSource: "local-json",
            payload: {
              count: localAccepted.length
            }
          }
        ],
        normalized: localAccepted
      };
    }
  }

  const listed = await fetchApsList(journalConfig, "accepted");
  const enriched = options.fastOnly ? listed.items : await enrichApsDetails(listed.items);

  return {
    raw: [
      {
        journal: journalConfig.code,
        status: "accepted",
        rawSource: listed.rawSource,
        payload: listed.raw
      }
    ],
    normalized: enriched.map(normalizeApsRecord)
  };
}
