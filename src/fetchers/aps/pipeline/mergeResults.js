import { dedupeApsRecords } from "./dedupe.js";

export function mergeApsScenarioResults(results) {
  const normalized = dedupeApsRecords(results.flatMap((result) => result.normalized || []));
  const raw = results.flatMap((result) => result.raw || []);

  return {
    normalized,
    raw
  };
}
