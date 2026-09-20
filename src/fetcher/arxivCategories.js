// Official mathematics categories: https://arxiv.org/category_taxonomy
export const mathCategories = ['AC', 'AG', 'AP', 'AT', 'CA', 'CO', 'CT', 'CV', 'DG', 'DS', 'FA', 'GM', 'GN', 'GR', 'GT', 'HO',
  'IT', 'KT', 'LO', 'MG', 'MP', 'NA', 'NT', 'OA', 'OC', 'PR', 'QA', 'RA', 'RT', 'SG', 'SP', 'ST'].map(code => `math.${code}`);

export function categoryQuery(category) {
  if (category === 'math') return `(${mathCategories.map(code => `cat:${code}`).join(' OR ')})`;
  if (!/^[a-z][a-z0-9-]*(?:\.[A-Z]{2})?$/.test(category)) throw new Error(`无效 arXiv 分类：${category}`);
  return `cat:${category}`;
}

export function paperMatchesCategory(paper, category) {
  if (paper.arxivCollections?.includes(category)) return true;
  const values = [paper.primaryCategory, ...(paper.categories || [])].filter(Boolean).join(' ');
  if (category === 'math') return /\b(?:math\.[A-Z]{2}|math-ph|cs\.IT)\b/.test(values);
  return values.includes(category);
}
