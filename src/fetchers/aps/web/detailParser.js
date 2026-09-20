import { load } from "cheerio";

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function metaContent($, name) {
  return cleanText($(`meta[name="${name}"]`).attr("content") || "");
}

export function parseApsDetailPage(html) {
  const $ = load(html);
  const abstract =
    metaContent($, "description") ||
    cleanText($(".abstract p, section.abstract p, #abstract p, .content .abstract").first().text());

  const authors = $('meta[name="citation_author"]')
    .map((_, element) => cleanText($(element).attr("content")))
    .get()
    .filter(Boolean);

  return {
    title: metaContent($, "citation_title") || cleanText($("h3, h1").first().text()),
    authors,
    abstract,
    doi: metaContent($, "citation_doi"),
    journalDisplay: metaContent($, "citation_journal_title"),
    date: metaContent($, "citation_publication_date"),
    url: metaContent($, "citation_abstract_html_url")
  };
}
