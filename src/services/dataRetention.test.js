import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, utimes, rm, symlink } from 'node:fs/promises';
import { cleanupLocalData, retainRecentPapers } from './dataRetention.js';
import { refreshAll } from './refreshService.js';
import { config } from '../config/index.js';

const now = Date.parse('2026-09-07T12:00:00Z'), day = 86400000;
const old = new Date(now - 31 * day).toISOString();
const recent = new Date(now - 3 * day).toISOString();
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pulse-retention-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'pulse-retention-'));
    await rm(root, { recursive: true, force: true });
  });
  async function put(name, value, date = recent) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
    await utimes(file, new Date(date), new Date(date));
  }
  const get = name => readFile(path.join(root, name), 'utf8').then(JSON.parse);
  const exists = async name => { try { await readFile(path.join(root, name)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  return { root, put, get, exists, options: { dataRoot: path.join(root, 'data'), now } };
}

test('30-day boundary uses paper date, including fresh copies of old papers', () => {
  const papers = [{ id: 'expired', date: old, fetched_at: recent },
    { id: 'boundary', date: new Date(now - 30 * day).toISOString() },
    { id: 'before', date: new Date(now - 30 * day - 1).toISOString() },
    { id: 'undated', date: 'invalid' }];
  const kept = retainRecentPapers(papers, now);
  assert.deepEqual(kept.map(p => p.id), ['boundary', 'undated']);
  assert.equal(kept[1].fetched_at, new Date(now).toISOString());
});

test('dry run and cleanup cover datasets, summaries, raw files, reports and archives, preserving settings', async t => {
  const f = await fixture(t);
  for (const name of ['papers.json', 'arxiv-papers.json', 'aps/normalized.json', 'aps/local-accepted.json', 'nature/normalized.json', 'nature_recent_physics.json']) {
    await f.put('data/' + name, [{ id: 'old', date: old }, { id: 'new', date: recent }]);
  }
  await f.put('data/summaries/summaries.json', { old: { oneLine: 'old' }, new: { oneLine: 'new' }, orphan: { savedAt: old } });
  await f.put('data/cache/state.json', { knownPaperIds: ['old', 'new'], lastRefreshAt: recent });
  await f.put('data/cache/scoring-config.json', { keywordWeights: { magic: 42 } }, old);
  for (const dir of ['raw', 'aps/raw', 'nature/raw']) {
    await f.put(`data/${dir}/api-${now - 31 * day}.json`, {});
    await f.put(`data/${dir}/api-${now - day}.json`, {}, old);
  }
  await f.put('data/analysis/concerns/expired.json', { generatedAt: old });
  await f.put('data/analysis/concerns/papers/expired.json', { savedAt: old });
  await f.put('data/analysis/concerns/papers/old-paper.json', { savedAt: recent, paperDate: old });
  await f.put('data/analysis/concerns/new.json', { generatedAt: recent }, old);
  await f.put('data/analysis/latest.json', {}, old);
  await f.put('archive/cleanup-old.zip', 'zip', old);
  await f.put('archive/cleanup-old.json', {}, old);
  await f.put('archive/README.md', 'archive documentation', old);
  await f.put('paper2task_materials/research.md', 'research', old);
  const preview = await cleanupLocalData({ ...f.options, dryRun: true });
  assert.equal(preview.removedRecords, 8);
  assert.equal((await f.get('data/papers.json')).length, 2);
  assert.equal(await f.exists('archive/cleanup-old.zip'), true);
  const result = await cleanupLocalData(f.options);
  assert.equal(result.deletedFiles, 9);
  assert.deepEqual((await f.get('data/papers.json')).map(p => p.id), ['new']);
  assert.deepEqual(Object.keys(await f.get('data/summaries/summaries.json')), ['new']);
  assert.deepEqual((await f.get('data/cache/state.json')).knownPaperIds, ['new']);
  assert.equal((await f.get('data/cache/scoring-config.json')).keywordWeights.magic, 42);
  assert.equal(await f.exists('data/analysis/concerns/new.json'), true);
  assert.equal(await f.exists('archive/README.md'), true);
  assert.equal(await f.exists('paper2task_materials/research.md'), true);
  assert.equal(await f.exists(`data/raw/api-${now - day}.json`), true);
  assert.equal((await cleanupLocalData(f.options)).files.length, 0);
});

test('undated legacy records keep their original age when shared files are rewritten', async t => {
  const f = await fixture(t);
  const age = new Date(now - 29 * day).toISOString();
  await f.put('data/papers.json', [{ id: 'undated' }, { id: 'old', date: old }], age);
  await f.put('data/summaries/summaries.json', { orphan: { oneLine: 'legacy' } }, age);
  await cleanupLocalData(f.options);
  assert.equal((await f.get('data/papers.json'))[0].fetched_at, age);
  await cleanupLocalData({ ...f.options, now: now + 2 * day });
  assert.deepEqual(await f.get('data/papers.json'), []);
  assert.deepEqual(await f.get('data/summaries/summaries.json'), {});
});

test('malformed datasets abort planning without partial deletion', async t => {
  const f = await fixture(t);
  await f.put('data/papers.json', [{ id: 'old', date: old }]);
  await f.put('data/aps/normalized.json', '{invalid');
  await f.put(`data/raw/api-${now - 31 * day}.json`, {});
  await assert.rejects(cleanupLocalData(f.options));
  assert.equal((await f.get('data/papers.json')).length, 1);
  assert.equal(await f.exists(`data/raw/api-${now - 31 * day}.json`), true);
});

test('cleanup refuses junctions leading outside the data directory', async t => {
  const f = await fixture(t);
  await f.put('outside/keep.json', {}, old);
  await mkdir(path.join(f.root, 'data'), { recursive: true });
  await symlink(path.join(f.root, 'outside'), path.join(f.root, 'data/raw'), 'junction');
  await assert.rejects(cleanupLocalData(f.options), /linked path/);
  assert.equal(await f.exists('outside/keep.json'), true);
});

test('refresh expires fallback papers when all sources fail, and filters newly returned old papers', async t => {
  const f = await fixture(t), previous = { ...config.paths };
  for (const [key, value] of Object.entries(config.paths)) config.paths[key] = path.join(f.root, value);
  t.after(() => Object.assign(config.paths, previous));
  const actualNow = Date.now();
  const freshPaper = { id: 'new', date: new Date(actualNow - day).toISOString(), authors: [], title: 'Quantum magic', keywords: [] };
  const expiredPaper = { ...freshPaper, id: 'old', date: new Date(actualNow - 31 * day).toISOString() };
  await f.put('data/papers.json', [expiredPaper, freshPaper]);
  await f.put('data/arxiv-papers.json', [expiredPaper, freshPaper]);
  const fail = async () => { throw new Error('offline test'); };
  const deps = { arxiv: { fetchLatestPapers: fail }, aps: { fetchAps: fail }, nature: { fetchNatureRecentPhysicsRecords: fail } };
  const result = await refreshAll(deps);
  assert.deepEqual(result.papers.map(p => p.id), ['new']);
  assert.equal(result.cleanup.removedRecords, 2);
  assert.deepEqual((await f.get('data/papers.json')).map(p => p.id), ['new']);
  assert.equal((await f.get('data/analysis/relevance-ranking.json')).length, 1);
  deps.nature.fetchNatureRecentPhysicsRecords = async () => [{ ...expiredPaper, id: 'old-refetched' }];
  const second = await refreshAll(deps);
  assert.equal(second.papers.some(p => p.id === 'old-refetched'), false);
});
