import { APS_RAW_SOURCE } from "../types.js";

function looksTruncated(text) {
  return /…|\.\.\./.test(text || "");
}

export async function fetchStructuredDetail(item) {
  const detail = {
    abstract: item.abstract || "",
    doi: item.doi || "",
    url: item.url || "",
    rawSource: APS_RAW_SOURCE.api
  };

  if (!looksTruncated(detail.abstract) && detail.abstract) {
    return detail;
  }

  return null;
}
