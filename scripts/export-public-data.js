import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const paperStrings = ['id', 'title', 'abstract', 'source', 'journal', 'journal_display', 'status', 'date', 'submittedAt', 'updatedAt', 'fetched_at', 'primaryCategory', 'doi'];
const paperUrls = ['url', 'arxivUrl', 'pdfUrl'];
const paperArrays = ['authors', 'categories', 'arxivCollections'];
const text = value => typeof value === 'string' ? value : '';
const publicUrl = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};

// Whitelist only public paper metadata; never spread a stored paper object.
export function sanitizeDashboard(input) {
  if (!Array.isArray(input?.papers)) throw new Error('Public snapshot must contain a papers array.');
  const papers = input.papers.filter(paper => paper && typeof paper === 'object').map(paper => {
    const clean = {};
    for (const key of paperStrings) if (typeof paper[key] === 'string') clean[key] = paper[key];
    for (const key of paperUrls) if (publicUrl(paper[key])) clean[key] = publicUrl(paper[key]);
    for (const key of paperArrays) clean[key] = Array.isArray(paper[key]) ? paper[key].filter(value => typeof value === 'string') : [];
    clean.authorCount = clean.authors.length;
    return clean;
  });
  const state = input.state || {};
  return { papers, state: {
    lastRefreshAt: text(state.lastRefreshAt) || null,
    arxivCollections: Array.isArray(state.arxivCollections) ? state.arxivCollections.map(collection => ({
      category: text(collection.category), status: text(collection.status), source: text(collection.source),
      count: Number.isFinite(collection.count) ? collection.count : 0,
      // Provider warnings can contain request URLs. Publish only fixed status text.
      warning: collection.warning ? '此分类的数据可能不完整，请以论文原始来源为准。' : ''
    })) : []
  }, config: { timezone: text(input.config?.timezone) || 'Asia/Shanghai' } };
}

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function exportPublicData(root = process.cwd()) {
  const [papers, state] = await Promise.all([readJson(path.join(root, 'data/papers.json')), readJson(path.join(root, 'data/cache/state.json')).catch(error => {
    if (error.code === 'ENOENT') return {}; throw error;
  })]);
  const snapshot = sanitizeDashboard({ papers, state, config: { timezone: process.env.APP_TIMEZONE || 'Asia/Shanghai' } });
  await writeJson(path.join(root, 'public-data/dashboard.json'), snapshot);
  return snapshot;
}

export async function seedPublicData(root = process.cwd()) {
  const snapshot = sanitizeDashboard(await readJson(path.join(root, 'public-data/dashboard.json')));
  const { papers, state } = snapshot;
  await Promise.all([
    writeJson(path.join(root, 'data/papers.json'), papers),
    writeJson(path.join(root, 'data/arxiv-papers.json'), papers.filter(p => p.source === 'arxiv')),
    writeJson(path.join(root, 'data/aps/normalized.json'), papers.filter(p => p.source === 'aps')),
    writeJson(path.join(root, 'data/aps/local-accepted.json'), papers.filter(p => p.source === 'aps' && p.status === 'accepted')),
    writeJson(path.join(root, 'data/nature/normalized.json'), papers.filter(p => p.source === 'nature')),
    writeJson(path.join(root, 'data/cache/state.json'), { ...state, knownPaperIds: papers.map(p => p.id).filter(Boolean) })
  ]);
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = process.argv.includes('--seed') ? await seedPublicData() : await exportPublicData();
  console.log(`${process.argv.includes('--seed') ? 'Seeded' : 'Exported'} ${result.papers.length} public paper records; private summaries, rankings and credentials excluded.`);
}
