import { XMLParser } from "fast-xml-parser";
import { withRetry } from "../../../utils/retry.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
  processEntities: false,
  htmlEntities: false
});

export async function fetchApsXml(url) {
  return withRetry(
    async () => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
        }
      });

      if (!response.ok) {
        throw new Error(`APS structured request failed: ${response.status} ${response.statusText}`);
      }

      return response.text();
    },
    { retries: 2, delayMs: 1200 }
  );
}

export function parseApsXml(xml) {
  return parser.parse(xml);
}
