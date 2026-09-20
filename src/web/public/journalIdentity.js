// Local typographic identities: no remote logos or fonts are needed to identify a source.
const journals = {
  arxiv: ['arxiv', 'arXiv', 'arXiv', 'PREPRINT'],
  prl: ['aps', 'PRL', 'Physical Review Letters', 'LETTERS'],
  pra: ['aps', 'PRA', 'Physical Review A', 'A'],
  prb: ['aps', 'PRB', 'Physical Review B', 'B'],
  prd: ['aps', 'PRD', 'Physical Review D', 'D'],
  pre: ['aps', 'PRE', 'Physical Review E', 'E'],
  prx: ['aps', 'PRX', 'Physical Review X', 'X'],
  prxquantum: ['aps', 'PRX', 'PRX Quantum', 'QUANTUM'],
  prapplied: ['aps', 'PR', 'Physical Review Applied', 'APPLIED'],
  prresearch: ['aps', 'PR', 'Physical Review Research', 'RESEARCH'],
  prmaterials: ['aps', 'PR', 'Physical Review Materials', 'MATERIALS'],
  nature: ['nature', 'nature', 'Nature', ''],
  nphys: ['nature', 'nature', 'Nature Physics', 'physics'],
  nphoton: ['nature', 'nature', 'Nature Photonics', 'photonics'],
  ncomms: ['nature', 'nature', 'Nature Communications', 'communications'],
  npjqi: ['nature', 'npj', 'npj Quantum Information', 'Quantum Information']
};
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map(Object.entries(journals).flatMap(([key, value]) =>
  [[normalize(key), key], [normalize(value[2]), key]]));

export function journalIdentity(paper) {
  // arXiv's display name is usually a subject code, not the publication name.
  const key = normalize(paper.source) === 'arxiv' ? 'arxiv'
    : aliases.get(normalize(paper.journal)) || aliases.get(normalize(paper.journal_display));
  if (!key) return { key: 'other', family: 'other', mark: 'PAPER',
    name: paper.journal_display || paper.journal || paper.source || 'Other', edition: '' };
  const [family, mark, name, edition] = journals[key];
  return { key, family, mark, name, edition };
}
