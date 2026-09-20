import { DateTime } from "luxon";
import { resolveApsJournals } from "./journals.js";
import { readLocalAcceptedExport } from "./localAccepted.js";
import { mergeApsScenarioResults } from "./pipeline/mergeResults.js";
import { fetchAccepted } from "./scenarios/fetchAccepted.js";
import { fetchPublished } from "./scenarios/fetchPublished.js";
import { logger } from "../../utils/logger.js";

function filterByDays(items, days) {
  if (!days) {
    return items;
  }

  const cutoff = DateTime.now().minus({ days });
  return items.filter((item) => !item.date || DateTime.fromISO(item.date) >= cutoff);
}

export async function fetchAps(options = {}) {
  const journals = resolveApsJournals(options.journals);
  const statuses = options.status || ["accepted", "published"];
  const scenarioResults = [];
  const acceptedFailures = [];

  // Each journal feed is independent, so fetch them concurrently. In fast mode
  // scenarios use feed-level title/abstract data and never visit article pages.
  await Promise.all(journals.map(async (journal) => {
    if (statuses.includes("accepted")) {
      try {
        scenarioResults.push(await fetchAccepted(journal, options));
      } catch (error) {
        acceptedFailures.push(journal.code);
        logger.warn("APS accepted scenario failed", {
          journal: journal.code,
          fallbackStage: "accepted-scenario",
          error: error.message
        });
      }
    }

    if (statuses.includes("published")) {
      try {
        scenarioResults.push(await fetchPublished(journal, options));
      } catch (error) {
        logger.warn("Skipping APS published scenario", {
          journal: journal.code,
          error: error.message
        });
      }
    }
  }));

  if (statuses.includes("accepted") && acceptedFailures.length > 0) {
    const localAccepted = await readLocalAcceptedExport(acceptedFailures);
    if (localAccepted.length > 0) {
      scenarioResults.push({
        raw: [
          {
            journal: acceptedFailures.join(","),
            status: "accepted",
            rawSource: "local-json",
            payload: { count: localAccepted.length }
          }
        ],
        normalized: localAccepted
      });
      logger.warn("Merged local APS accepted export into fetch result", {
        journals: acceptedFailures,
        count: localAccepted.length
      });
    }
  }

  const merged = mergeApsScenarioResults(scenarioResults);
  return {
    normalized: filterByDays(merged.normalized, options.days),
    raw: merged.raw
  };
}
