import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config, setScoringKeywordWeights } from "../config/index.js";
import { initializeScoringConfig, updateScoringSettings, getScoringSettings } from "./scoringService.js";
import { savePapers, loadPapers } from "../store/repository.js";
import { createServer } from "../web/server.js";
import { createVisitorScoring } from "./visitorScoring.js";
import { getDashboardData } from "./refreshService.js";

test("private scoring exports and visitor API rankings persist independently without restoring deleted defaults", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-pulse-scoring-"));
  const previousPaths = { ...config.paths }, previousWeights = { ...config.scoring.keywordWeights };
  for (const key of ["papers", "summaryIndex", "scoringConfig", "analysisLatest", "relevanceRankingJson", "relevanceRankingCsv", "state"]) {
    config.paths[key] = path.join(directory, key + (key.endsWith("Csv") ? ".csv" : ".json"));
  }
  const visitorDirectory = path.join(directory, "visitors");
  const scoring = createVisitorScoring({ directory: visitorDirectory });
  const server = createServer({ scoring }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    Object.assign(config.paths, previousPaths);
    setScoringKeywordWeights(previousWeights);
    // Only remove the exact temporary test directory that mkdtemp created.
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + "research-pulse-scoring-"));
    await rm(directory, { recursive: true, force: true });
  });
  await initializeScoringConfig();
  await savePapers([{ id: "m", title: "Magic", date: "2026-08-30" }, { id: "e", title: "Entanglement", date: "2026-08-29" }]);
  const initial = await fetch(base + "/api/scoring");
  const cookie = initial.headers.get("set-cookie").split(";")[0];
  await initial.json();
  const ownerId = cookie.slice("rp-visitor=".length);
  const get = endpoint => fetch(base + endpoint, { headers: { Cookie: cookie } });
  const put = body => fetch(base + "/api/scoring", {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body)
  });

  await t.test("private service saves rerank shared papers and update both exports", async () => {
    const result = await updateScoringSettings({ magic: 4, entanglement: 1 });
    assert.equal(result.papers[0].id, "m");
    assert.equal(result.papers[0].recommendation.score, 8);
    assert.deepEqual(config.scoring.keywordWeights, { magic: 4, entanglement: 1 });
    assert.deepEqual((await getScoringSettings()).keywordWeights, { magic: 4, entanglement: 1 });
    assert.equal((await loadPapers())[0].id, "m");
    const exported = JSON.parse(await readFile(config.paths.relevanceRankingJson, "utf8"));
    assert.equal(exported[0].title, "Magic");
    assert.match(await readFile(config.paths.relevanceRankingCsv, "utf8"), /Magic/);
  });

  await t.test("API save reranks only this visitor and leaves private files and exports unchanged", async () => {
    const privateFiles = ["papers", "scoringConfig", "analysisLatest", "relevanceRankingJson", "relevanceRankingCsv"];
    const before = await Promise.all(privateFiles.map(key => readFile(config.paths[key], "utf8")));
    const response = await put({ keywordWeights: { magic: 1, entanglement: 4 } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.papers[0].id, "e");
    assert.equal(result.papers[0].recommendation.score, 8);
    assert.deepEqual(await Promise.all(privateFiles.map(key => readFile(config.paths[key], "utf8"))), before);
    assert.deepEqual(config.scoring.keywordWeights, { magic: 4, entanglement: 1 });
    const dashboard = await get("/api/papers").then(r => r.json());
    assert.equal(dashboard.papers[0].id, "e");
    const differentVisitor = await fetch(base + "/api/papers").then(r => r.json());
    assert.equal(differentVisitor.papers[0].id, "m");
  });

  await t.test("bad requests never erase saved settings", async () => {
    for (const body of [{}, { keywordWeights: null }, { keywordWeights: [] }, { keywordWeights: { magic: -1 } }]) {
      assert.equal((await put(body)).status, 400);
    }
    assert.deepEqual((await get("/api/scoring").then(r => r.json())).keywordWeights, { magic: 1, entanglement: 4 });
    assert.deepEqual((await getScoringSettings()).keywordWeights, { magic: 4, entanglement: 1 });
  });

  await t.test("serialized rapid edits leave disk, runtime, and rankings at the last setting", async () => {
    await Promise.all([updateScoringSettings({ magic: 9 }), updateScoringSettings({ magic: 2 }), updateScoringSettings({ entanglement: 6 })]);
    assert.deepEqual((await getScoringSettings()).keywordWeights, { entanglement: 6 });
    assert.deepEqual(config.scoring.keywordWeights, { entanglement: 6 });
    assert.equal((await loadPapers())[0].recommendation.score, 12);
  });

  await t.test("a fresh Node process loads the saved config and uses it to score", async () => {
    const script = [
      "const {config}=await import(" + JSON.stringify(new URL("../config/index.js", import.meta.url).href) + ");",
      "config.paths.scoringConfig=" + JSON.stringify(config.paths.scoringConfig) + ";",
      "const {initializeScoringConfig}=await import(" + JSON.stringify(new URL("./scoringService.js", import.meta.url).href) + ");",
      "const {scorePaper}=await import(" + JSON.stringify(new URL("../scorer/recommendationScorer.js", import.meta.url).href) + ");",
      "await initializeScoringConfig();",
      "console.log(JSON.stringify({weights:config.scoring.keywordWeights,score:scorePaper({title:'Entanglement'}).score}));"
    ].join("\n");
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true, timeout: 30000 });
    assert.deepEqual(JSON.parse(stdout.trim()), { weights: { entanglement: 6 }, score: 12 });
  });

  await t.test("deleting the final keyword remains empty after restart initialization", async () => {
    // The private service still persists its own explicit empty settings.
    await updateScoringSettings({});
    assert.equal((await put({ keywordWeights: {} })).status, 200);
    setScoringKeywordWeights({ magic: 100 });
    await initializeScoringConfig();
    assert.deepEqual(config.scoring.keywordWeights, {});
    assert.deepEqual((await getScoringSettings()).keywordWeights, {});
    // The HTTP visitor has a separate empty settings file and reload path.
    const restartedVisitorScoring = createVisitorScoring({ directory: visitorDirectory });
    assert.deepEqual((await restartedVisitorScoring.get(ownerId)).keywordWeights, {});
    const dashboard = await get("/api/papers").then(r => r.json());
    assert.ok(dashboard.papers.every(p => p.recommendation.score === 0));
  });

  await t.test("dashboard recomputes legacy/stale cached recommendations using current weights", async () => {
    await updateScoringSettings({ magic: 4 });
    await savePapers([{ id: "m", title: "Magic", recommendation: { score: 999 } }]);
    const dashboard = await getDashboardData();
    assert.equal(dashboard.papers[0].recommendation.score, 8);
    const visitorDashboard = await get("/api/papers").then(r => r.json());
    assert.equal(visitorDashboard.papers[0].recommendation.score, 0);
  });

  await t.test("failed config writes don't change runtime settings and the queue recovers", async () => {
    const originalPath = config.paths.scoringConfig;
    config.paths.scoringConfig = directory;
    await assert.rejects(updateScoringSettings({ magic: 99 }));
    assert.deepEqual(config.scoring.keywordWeights, { magic: 4 });
    config.paths.scoringConfig = originalPath;
    await updateScoringSettings({ magic: 5 });
    assert.deepEqual((await getScoringSettings()).keywordWeights, { magic: 5 });
  });

  await t.test("corrupt settings are reported rather than overwritten with defaults", async () => {
    await writeFile(config.paths.scoringConfig, "{broken", "utf8");
    await assert.rejects(initializeScoringConfig());
    assert.equal(await readFile(config.paths.scoringConfig, "utf8"), "{broken");
  });
});
