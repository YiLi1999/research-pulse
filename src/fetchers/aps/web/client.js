import { logger } from "../../../utils/logger.js";

const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const jarByOrigin = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function buildCookieHeader(origin) {
  const cookieMap = jarByOrigin.get(origin);
  if (!cookieMap || cookieMap.size === 0) {
    return "";
  }

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function storeSetCookie(origin, response) {
  const setCookie = response.headers.getSetCookie?.() || [];
  if (setCookie.length === 0) {
    return;
  }

  const cookieMap = jarByOrigin.get(origin) || new Map();
  for (const header of setCookie) {
    const firstPart = header.split(";")[0];
    const [name, ...valueParts] = firstPart.split("=");
    if (!name || valueParts.length === 0) {
      continue;
    }
    cookieMap.set(name.trim(), valueParts.join("=").trim());
  }

  jarByOrigin.set(origin, cookieMap);
}

function serializeHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }
  return headers;
}

function buildBrowserHeaders({ referer, origin }) {
  const headers = {
    "User-Agent": DESKTOP_CHROME_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: referer
  };

  const cookieHeader = buildCookieHeader(origin);
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  return headers;
}

function shouldRetryStatus(status) {
  return status === 403 || status === 429 || status >= 500;
}

async function fetchWithRetries(url, options) {
  const {
    journal,
    page,
    stage,
    referer,
    maxRetries = 3
  } = options;
  const target = new URL(url);
  const origin = target.origin;
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const response = await fetch(url, {
      redirect: "follow",
      headers: buildBrowserHeaders({ referer, origin })
    });

    storeSetCookie(origin, response);

    logger.info("APS web response", {
      journal,
      page,
      stage,
      attempt: attempt + 1,
      statusCode: response.status,
      finalUrl: response.url,
      responseHeaders: serializeHeaders(response)
    });

    if (!shouldRetryStatus(response.status)) {
      if (!response.ok) {
        throw new Error(`APS web request failed: ${response.status} ${response.statusText}`);
      }

      return response.text();
    }

    lastError = new Error(`APS web request failed: ${response.status} ${response.statusText}`);

    if (attempt === maxRetries - 1) {
      break;
    }

    const backoffMs = 1000 * 2 ** attempt + randomBetween(200, 800);
    await sleep(backoffMs);
  }

  throw lastError;
}

export async function warmupJournalSession(journalConfig) {
  const origin = new URL(journalConfig.baseUrl).origin;
  if (jarByOrigin.has(origin)) {
    return;
  }

  await sleep(randomBetween(2000, 5000));
  await fetchWithRetries(journalConfig.baseUrl, {
    journal: journalConfig.code,
    page: 1,
    stage: "web-home",
    referer: journalConfig.baseUrl,
    maxRetries: 3
  });
}

export async function fetchApsWebPage(url, options) {
  const {
    journalConfig,
    page = 1,
    stage = "web-page",
    isDetail = false
  } = options;

  await warmupJournalSession(journalConfig);
  await sleep(isDetail ? randomBetween(1000, 3000) : randomBetween(2000, 5000));

  return fetchWithRetries(url, {
    journal: journalConfig.code,
    page,
    stage,
    referer: journalConfig.baseUrl,
    maxRetries: 3
  });
}
