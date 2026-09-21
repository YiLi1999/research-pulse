import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "./server.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { paperCard } from "./public/paperCards.js";

test("ranking controls belong only to papers and overview contains the questions panel", async (t) => {
  const server = createServer().listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const { load } = await import("cheerio");
  const $ = load(await response.text());
  assert.equal($(".rank-settings").closest(".view").attr("id"), "papers");
  assert.equal($("#keywordForm").closest(".view").attr("id"), "papers");
  assert.equal($("#overview > .questions #questions").length, 1);
  assert.deepEqual($("#overview h2").map((_, el) => $(el).text()).get(), ["近7天研究趋势"]);
  assert.equal($("#overview").children().length, 1);
  assert.equal($("#topics, #stats, #sources, #trendChart").length, 0);
  assert.equal($("#network, [data-view=network]").length, 0);
  assert.equal($("#trendApiKey").attr("type"), "password");
  assert.equal($("#trendApiKey").attr("autocomplete"), "off");
  assert.equal($("#trendBaseUrl, #trendApiKey, #trendModel").length, 3);
  assert.equal($("#analyzeConcerns").attr("disabled"), "disabled");
});

test("score cards explain each contribution and safely render custom keyword text", () => {
  const html = paperCard({
    title: "<script>paper</script>", url: "javascript:alert(1)",
    recommendation: {
      final_rank: 1, score: 6,
      matched_keywords: [{ keyword: '<img src=x onerror="alert(1)">', weight: 2,
        hits: { title: 1, abstract: 1 }, contribution: 6 }]
    }
  }, "zh");
  assert.ok(html.includes("SCORE 6") && html.includes("评分明细"));
  assert.ok(html.includes("&lt;img") && html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>") && !html.includes("<img") && !html.includes("javascript:"));
  assert.ok(html.includes('href="#"'));
});

test("server can start when crawler dependencies are unavailable", async () => {
  // A fresh process rejects crawler imports. Page/cache access must not load
  // them; only an actual refresh should need them.
  const loader = `export async function resolve(specifier, context, nextResolve) {
    if (/fetchers\\/|fetcher\\/|playwright|cheerio|fast-xml-parser/.test(specifier)) {
      throw new Error('Crawler dependency loaded before HTTP startup: ' + specifier);
    }
    return nextResolve(specifier, context);
  }`;
  const script = `
    const { createServer } = await import(${JSON.stringify(new URL("./server.js", import.meta.url).href)});
    const server = createServer().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/health');
    if (!response.ok || !(await response.json()).ok) throw new Error('HTTP server not ready');
    await new Promise(resolve => server.close(resolve));
  `;
  await promisify(execFile)(process.execPath, [
    "--experimental-loader", `data:text/javascript,${encodeURIComponent(loader)}`,
    "--input-type=module", "-e", script
  ], { windowsHide: true, timeout: 30000 });
});

test("health endpoint identifies the running service without reading paper data", async (t) => {
  const server = createServer().listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "arxiv-quant-tracker",
    pid: process.pid
  });
});
