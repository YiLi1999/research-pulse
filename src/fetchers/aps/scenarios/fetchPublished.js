import { normalizeApsRecord } from "../normalize.js";
import { fetchApsList } from "../pipeline/fetchList.js";
import { enrichApsDetails } from "../pipeline/enrichDetails.js";

export async function fetchPublished(journalConfig, options = {}) {
  const listed = await fetchApsList(journalConfig, "published");
  const enriched = options.fastOnly ? listed.items : await enrichApsDetails(listed.items);

  return {
    raw: [
      {
        journal: journalConfig.code,
        status: "published",
        rawSource: listed.rawSource,
        payload: listed.raw
      }
    ],
    normalized: enriched.map(normalizeApsRecord)
  };
}
