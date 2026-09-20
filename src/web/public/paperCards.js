import { journalIdentity } from './journalIdentity.js';

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? escapeHtml(url.href) : "#";
  } catch { return "#"; }
}

export function paperCard(paper, lang) {
  const zh = lang === "zh", rec = paper.recommendation || {};
  const identity = journalIdentity(paper);
  const masthead = '<div class="paper-masthead" aria-label="' + escapeHtml(identity.name) + '">' +
    '<div class="journal-wordmark" aria-hidden="true"><span class="journal-mark">' + escapeHtml(identity.mark) +
    '</span><span class="journal-edition">' + escapeHtml(identity.edition) + '</span></div>' +
    '<span class="journal-caption">' + escapeHtml(identity.family === 'arxiv'
      ? (zh ? '开放预印本' : 'OPEN PREPRINT')
      : identity.family === 'nature' ? 'NATURE PORTFOLIO' : identity.name) + '</span></div>';
  const matches = rec.matched_keywords || [], score = rec.relevance_score ?? rec.score ?? 0;
  const heading = zh ? "评分明细" : "Score breakdown";
  const details = matches.length ? (
    '<div class="score-table-wrap"><table class="score-table"><thead><tr><th>' + (zh ? "关键词" : "Keyword") +
    '</th><th>Weight</th><th>' + (zh ? "标题 ×2" : "Title ×2") + '</th><th>' +
    (zh ? "摘要 ×1" : "Abstract ×1") + '</th><th>' + (zh ? "得分" : "Score") +
    '</th></tr></thead><tbody>' + matches.map(match => '<tr><td>' + escapeHtml(match.keyword) +
      '</td><td>' + escapeHtml(match.weight) + '</td><td>' + (match.hits?.title ? "✓" : "—") +
      '</td><td>' + (match.hits?.abstract ? "✓" : "—") + '</td><td>+' + escapeHtml(match.contribution) +
      '</td></tr>').join("") +
    '</tbody><tfoot><tr><th colspan="4">' + (zh ? "合计" : "Total") + '</th><td>' +
    escapeHtml(score) + '</td></tr></tfoot></table></div>'
  ) : '<p>' + (zh ? "标题和摘要未命中已启用的关键词，得分为 0。" : "No enabled keywords matched the title or abstract. Score: 0.") + '</p>';

  return '<article class="paper paper-branded" data-journal="' + identity.key + '" data-family="' + identity.family + '">' + masthead +
    '<div class="paper-body"><div class="paper-meta"><b>' + escapeHtml(paper.status || paper.source || "SOURCE") +
    '</b><span>' + escapeHtml((paper.date || "").slice(0, 10)) + '</span><span>' +
    escapeHtml(paper.journal_display || paper.journal || "") + '</span></div>' +
    '<div class="rank-line"><span class="rank-badge">RANK #' + escapeHtml(rec.final_rank || "—") +
    '</span><span class="score-badge">SCORE ' + escapeHtml(score) + '</span><span class="match-chips">' +
    matches.slice(0, 4).map(match => '<i>' + escapeHtml(match.keyword) + ' +' + escapeHtml(match.contribution) + '</i>').join("") +
    '</span></div><h3><a href="' + safeUrl(paper.url || paper.arxivUrl) + '" target="_blank" rel="noopener">' +
    escapeHtml(paper.title || "Untitled paper") + '</a></h3><p class="authors">' +
    escapeHtml((paper.authors || []).slice(0, 5).join(" · ")) + (paper.authors?.length > 5 ? (zh ? " 等" : " et al.") : "") +
    '</p><p>' + escapeHtml((paper.summary?.oneLine || paper.abstract || (zh ? "暂无摘要" : "No abstract available")).slice(0, 210)) +
    '</p><details class="score-details"><summary>' + heading + ' · ' + matches.length +
    (zh ? " 个命中关键词" : " matched keywords") + '</summary>' + details + '</details></div></article>';
}
