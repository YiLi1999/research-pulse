import path from 'node:path';
import { lstat, readdir, readFile, unlink } from 'node:fs/promises';
import { config } from '../config/index.js';
import { writeJsonAtomic } from '../utils/fs.js';

export const RETENTION_DAYS = 30;
const DAY = 86400000;
const paperFiles = ['papers.json', 'arxiv-papers.json', 'aps/normalized.json',
  'aps/local-accepted.json', 'nature/normalized.json', 'nature_recent_physics.json'];

function firstDate(...values) {
  for (const value of values) {
    const date = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isFinite(date)) return date;
  }
  return NaN;
}

export function paperRetentionDate(paper, fallback) {
  return firstDate(paper.date, paper.submittedAt, paper.published_date, paper.publishedAt,
    paper.fetched_at, paper.savedAt, fallback);
}

export function retainRecentPapers(papers, now = Date.now(), fallback = now) {
  const cutoff = Number(now) - RETENTION_DAYS * DAY;
  return papers.filter(paper => paperRetentionDate(paper, fallback) >= cutoff)
    .map(paper => Number.isFinite(paperRetentionDate(paper)) ? paper
      : { ...paper, fetched_at: new Date(fallback).toISOString() });
}

// Inspect each path component: never traverse a symlink/junction or leave the
// explicit application-data root. Deletions are individual files, not trees.
async function safeStat(root, relative) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Retention path outside data root');
  let current = root;
  let info;
  for (const part of ['', ...rel.split(path.sep).filter(Boolean)]) {
    current = path.join(current, part);
    try { info = await lstat(current); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Retention refuses linked path: ${current}`);
  }
  return info;
}

export async function cleanupLocalData({ dataRoot = config.paths.dataRoot,
  archiveRoot = path.join(path.dirname(path.resolve(dataRoot)), 'archive'),
  now = Date.now(), dryRun = false } = {}) {
  now = Number(now);
  if (!Number.isFinite(now)) throw new Error('Invalid retention time');
  const root = path.resolve(dataRoot), cutoff = now - RETENTION_DAYS * DAY;
  const changes = [], knownDates = new Map(), keptIds = new Set();
  let removedRecords = 0;
  async function read(relative) {
    const info = await safeStat(root, relative);
    if (!info?.isFile()) return null;
    return { info, value: JSON.parse(await readFile(path.join(root, relative), 'utf8')) };
  }
  function rewrite(relative, before, after) {
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ root, relative, value: after });
  }
  for (const relative of paperFiles) {
    const item = await read(relative);
    if (!item) continue;
    if (!Array.isArray(item.value)) throw new Error(`Invalid paper dataset: ${relative}`);
    for (const paper of item.value) {
      const date = paperRetentionDate(paper, item.info.mtimeMs);
      if (paper.id) knownDates.set(paper.id, Math.max(knownDates.get(paper.id) ?? -Infinity, date));
    }
    const retained = retainRecentPapers(item.value, now, item.info.mtimeMs);
    for (const paper of retained) if (paper.id) keptIds.add(paper.id);
    removedRecords += item.value.length - retained.length;
    rewrite(relative, item.value, retained);
  }
  const summaries = await read('summaries/summaries.json');
  if (summaries) {
    const retained = {};
    for (const [id, summary] of Object.entries(summaries.value)) {
      const date = firstDate(summary.paperDate, knownDates.get(id), summary.savedAt, summaries.info.mtimeMs);
      if (date < cutoff) { removedRecords++; continue; }
      // Legacy summaries lack dates; stamp their original age before rewriting
      // the shared index, so new summaries cannot keep old entries alive forever.
      retained[id] = { ...summary, savedAt: summary.savedAt || new Date(date).toISOString() };
    }
    rewrite('summaries/summaries.json', summaries.value, retained);
  }
  const state = await read('cache/state.json');
  if (state) rewrite('cache/state.json', state.value, { ...state.value,
    knownPaperIds: (state.value.knownPaperIds || []).filter(id => keptIds.has(id)) });

  async function scan(base, relative, accept) {
    const info = await safeStat(base, relative);
    if (!info?.isDirectory()) return;
    for (const entry of await readdir(path.join(base, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      // Linked files/directories are never retention targets.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await scan(base, child, accept); continue; }
      if (!entry.isFile() || !accept(entry.name)) continue;
      const stat = await safeStat(base, child);
      if (!stat) continue;
      let date = firstDate(entry.name.match(/-(\d{13})\./)?.[1]
        ? Number(entry.name.match(/-(\d{13})\./)[1]) : undefined, stat.mtimeMs);
      if (child.startsWith(path.join('analysis', 'concerns')) && entry.name.endsWith('.json')) {
        // Content timestamps survive file copies/restores. Old malformed cache
        // files can still expire by mtime; recent malformed files are left alone.
        try {
          const cached = JSON.parse(await readFile(path.join(base, child), 'utf8'));
          date = firstDate(cached.paperDate, cached.savedAt, cached.generatedAt, date);
        } catch (error) { if (error.code) throw error; }
      }
      if (date < cutoff) changes.push({ root: base, relative: child });
    }
  }
  for (const dir of ['raw', 'aps/raw', 'nature/raw', 'analysis/concerns']) {
    await scan(root, dir, () => true);
  }
  // Only the application's named cleanup archives; research materials and
  // source/configuration files are outside the retention scope.
  if (archiveRoot) await scan(path.resolve(archiveRoot), '', name => /^cleanup-.*\.(zip|json)$/.test(name));
  for (const relative of ['analysis/latest.json', 'analysis/relevance-ranking.json', 'analysis/relevance-ranking.csv']) {
    const info = await safeStat(root, relative);
    if (info?.isFile() && info.mtimeMs < cutoff) changes.push({ root, relative });
  }
  // Build and validate the entire plan before changing any files.
  if (!dryRun) for (const change of changes) {
    if (!(await safeStat(change.root, change.relative))?.isFile()) continue;
    const target = path.join(change.root, change.relative);
    if ('value' in change) await writeJsonAtomic(target, change.value);
    else await unlink(target);
  }
  return { retentionDays: RETENTION_DAYS, cutoff: new Date(cutoff).toISOString(), dryRun,
    removedRecords, deletedFiles: changes.filter(change => !('value' in change)).length,
    updatedFiles: changes.filter(change => 'value' in change).length,
    files: changes.map(change => ({ path: path.join(change.root, change.relative),
      action: 'value' in change ? 'update' : 'delete' })) };
}
