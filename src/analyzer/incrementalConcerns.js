import { createHash } from 'node:crypto';
import { PAPER_ANALYSIS_VERSION } from './incrementalConcernsCore.js';
export { PAPER_ANALYSIS_VERSION, validPaperNotes, analyzeIncrementalConcerns } from './incrementalConcernsCore.js';

export function paperAnalysisKey(paper, engineSignature) {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(JSON.stringify({ version: PAPER_ANALYSIS_VERSION,
    engine: engineSignature, title: clean(paper.title), abstract: clean(paper.abstract) })).digest('hex');
}
