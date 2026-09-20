import { chromium } from "playwright";
import { logger } from "../../../utils/logger.js";

function isChallengePage(html, title) {
  return /Just a moment/i.test(title || "") || /cf-mitigated|challenge-error-text|__cf_chl_rt_tk/i.test(html || "");
}

export async function fetchAcceptedListWithPlaywright(journalConfig, listUrl, page = 1) {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "en-US"
    });
    const pageHandle = await context.newPage();

    await pageHandle.setExtraHTTPHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: journalConfig.baseUrl
    });

    const homeResponse = await pageHandle.goto(journalConfig.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    logger.info("APS Playwright warmup", {
      journal: journalConfig.code,
      page,
      fallbackStage: "playwright-home",
      statusCode: homeResponse?.status?.() ?? null,
      finalUrl: pageHandle.url(),
      responseHeaders: homeResponse ? await homeResponse.allHeaders() : {}
    });

    await pageHandle.waitForTimeout(2500);

    const response = await pageHandle.goto(listUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    logger.info("APS Playwright accepted fallback", {
      journal: journalConfig.code,
      page,
      fallbackStage: "playwright-accepted-list",
      statusCode: response?.status?.() ?? null,
      finalUrl: pageHandle.url(),
      responseHeaders: response ? await response.allHeaders() : {}
    });

    await pageHandle.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await pageHandle.waitForTimeout(5000);

    const html = await pageHandle.content();
    const title = await pageHandle.title();
    if (isChallengePage(html, title)) {
      throw new Error("APS Playwright fallback reached Cloudflare challenge page");
    }

    return html;
  } finally {
    await browser.close();
  }
}

export async function fetchDetailWithPlaywright(journalConfig, detailUrl) {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "en-US"
    });
    const pageHandle = await context.newPage();

    await pageHandle.setExtraHTTPHeaders({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: journalConfig.baseUrl
    });

    const response = await pageHandle.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    logger.info("APS Playwright detail fallback", {
      journal: journalConfig.code,
      page: 1,
      fallbackStage: "playwright-detail",
      statusCode: response?.status?.() ?? null,
      finalUrl: pageHandle.url(),
      responseHeaders: response ? await response.allHeaders() : {}
    });

    await pageHandle.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await pageHandle.waitForTimeout(3000);

    const html = await pageHandle.content();
    const title = await pageHandle.title();
    if (isChallengePage(html, title)) {
      throw new Error("APS Playwright detail fallback reached Cloudflare challenge page");
    }

    return html;
  } finally {
    await browser.close();
  }
}
