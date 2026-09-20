import path from 'node:path';
import { readJson, writeJsonAtomic } from '../utils/fs.js';
import { paperAnalysisKey, validPaperNotes, PAPER_ANALYSIS_VERSION } from '../analyzer/incrementalConcerns.js';
import { paperRetentionDate } from './dataRetention.js';

export function createPaperAnalysisCache(directory, engineSignature) {
  const cachePath = paper => path.join(directory, `${paperAnalysisKey(paper, engineSignature)}.json`);
  return {
    async load(papers) {
      const result = new Map();
      await Promise.all(papers.map(async paper => {
        const cached = await readJson(cachePath(paper));
        if (cached?.version === PAPER_ANALYSIS_VERSION && cached.key === paperAnalysisKey(paper, engineSignature) && validPaperNotes(cached.questions)) {
          result.set(paper.ref, cached.questions);
        }
      }));
      return result;
    },
    async save(paper, questions) {
      try {
        await writeJsonAtomic(cachePath(paper), { version: PAPER_ANALYSIS_VERSION, key: paperAnalysisKey(paper, engineSignature),
          questions, savedAt: new Date().toISOString(),
          paperDate: Number.isFinite(paperRetentionDate(paper))
            ? new Date(paperRetentionDate(paper)).toISOString() : null });
        return true;
      } catch { return false; }
    }
  };
}
