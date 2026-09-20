import { loadApsAcceptedLocal, saveApsAcceptedLocal } from "../../store/repository.js";

export async function readLocalAcceptedExport(journals = []) {
  const papers = await loadApsAcceptedLocal();
  if (!journals.length) {
    return papers;
  }

  const journalSet = new Set(journals);
  return papers.filter((paper) => journalSet.has(paper.journal));
}

export async function writeLocalAcceptedExport(papers) {
  await saveApsAcceptedLocal(papers);
}
