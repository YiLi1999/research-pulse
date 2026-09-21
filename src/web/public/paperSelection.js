// Shared by the unbundled browser UI and the analysis service. Keep this module
// dependency-free so both views use the same calendar window and paper identity.
const DAY = 86400000;
const formatters = new Map();

function formatterFor(timezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }));
  return formatters.get(timezone);
}

function localParts(timestamp, formatter) {
  const parts = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

function civilTimestamp({ year, month, day, hour = 0, minute = 0, second = 0 }, millisecond = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.valueOf();
}

function offsetAt(timestamp, formatter) {
  return civilTimestamp(localParts(timestamp, formatter)) - Math.floor(timestamp / 1000) * 1000;
}

function localTimestamp(civil, formatter) {
  // Check both sides of a possible daylight-saving transition. On overlapping
  // clock times choose the earlier instant; move nonexistent clock times ahead
  // by the gap, matching the usual compatible local-time interpretation.
  const offsets = new Set([-36, 0, 36].map(hours => offsetAt(civil + hours * 3600000, formatter)));
  const candidates = [...offsets].map(offset => {
    const timestamp = civil - offset;
    return { timestamp, local: timestamp + offsetAt(timestamp, formatter) };
  });
  const exact = candidates.filter(candidate => candidate.local === civil);
  if (exact.length) return Math.min(...exact.map(candidate => candidate.timestamp));
  return candidates.filter(candidate => candidate.local > civil)
    .sort((a, b) => a.local - b.local)[0]?.timestamp ?? NaN;
}

function parseDate(value, formatter) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?)?$/.exec(value);
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s, fraction, utc, sign, oh, om] = match;
  const parts = { year: Number(y), month: Number(mo), day: Number(d),
    hour: Number(h || 0), minute: Number(mi || 0), second: Number(s || 0) };
  const milliseconds = Number((fraction || '').padEnd(3, '0').slice(0, 3));
  const midnight = civilTimestamp({ ...parts, hour: 0, minute: 0, second: 0 });
  const check = new Date(midnight);
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day ||
    parts.hour > 24 || parts.minute > 59 || parts.second > 59 ||
    (parts.hour === 24 && (parts.minute || parts.second || milliseconds)) || Number(oh || 0) > 23 || Number(om || 0) > 59) return NaN;
  const civil = civilTimestamp(parts, milliseconds);
  if (utc) return civil;
  if (sign) return civil - (sign === '+' ? 1 : -1) * (Number(oh) * 60 + Number(om || 0)) * 60000;
  return localTimestamp(civil, formatter);
}

const pad = (value, length = 2) => String(value).padStart(length, '0');
const dateLabel = parts => `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;

function identityKeys(paper) {
  const doi = String(paper.doi || '').toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').trim();
  const id = String(paper.id || '').replace(/v\d+$/, '');
  const title = String(paper.title || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return [doi && `doi:${doi}`, id && `id:${id}`, title && `title:${title}`].filter(Boolean);
}

function stableIdentity(paper) {
  // Recommendation scores and input position must never decide which copy is
  // used. These public metadata fields are identical before and after ranking.
  return JSON.stringify(['id', 'title', 'abstract', 'doi', 'source', 'journal', 'journal_display',
    'date', 'submittedAt', 'updatedAt', 'status', 'url', 'arxivUrl', 'pdfUrl', 'authors',
    'categories', 'arxivCollections', 'primaryCategory'].map(key => paper[key] ?? null));
}

export function selectPapers(papers, { now = new Date(), timezone = 'Asia/Shanghai', days = 7 } = {}) {
  if (!Array.isArray(papers)) throw new TypeError('papers must be an array.');
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new RangeError('now must be a valid Date.');
  if (!Number.isInteger(days) || days < 1) throw new RangeError('days must be a positive integer.');
  const formatter = formatterFor(timezone), end = now.valueOf();
  const endParts = localParts(end, formatter);
  const startCivil = civilTimestamp({ ...endParts, hour: 0, minute: 0, second: 0 }) - (days - 1) * DAY;
  const start = days === 9999 ? -Infinity : localTimestamp(startCivil, formatter);
  const offset = offsetAt(end, formatter), offsetMinutes = Math.abs(offset) / 60000;
  const asOf = `${dateLabel(endParts)}T${pad(endParts.hour)}:${pad(endParts.minute)}:${pad(endParts.second)}.${pad(now.getUTCMilliseconds(), 3)}` +
    `${offset >= 0 ? '+' : '-'}${pad(Math.floor(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
  const window = { days, start: days === 9999 ? null : dateLabel(localParts(start, formatter)),
    end: dateLabel(endParts), asOf, timezone };
  const dates = new Map();
  let missingDateCount = 0;
  const recent = papers.map((paper, index) => ({ paper, index })).filter(({ paper }) => {
    if (!paper || typeof paper !== 'object') { missingDateCount++; return false; }
    const value = paper.date || paper.submittedAt || '';
    if (!dates.has(value)) dates.set(value, parseDate(value, formatter));
    const timestamp = dates.get(value);
    if (!Number.isFinite(timestamp)) missingDateCount++;
    return days === 9999 || (Number.isFinite(timestamp) && timestamp >= start && timestamp <= end);
  });
  const candidates = recent.map(row => ({ ...row, identity: stableIdentity(row.paper) })).sort((a, b) =>
    (b.paper.abstract?.length || 0) - (a.paper.abstract?.length || 0) ||
    (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
  const seen = new Set(), retained = new Set();
  for (const { paper, index } of candidates) {
    const keys = identityKeys(paper), duplicate = keys.some(key => seen.has(key));
    keys.forEach(key => seen.add(key));
    if (!duplicate) retained.add(index);
  }
  const selected = recent.filter(({ index }) => retained.has(index)).map(({ paper }) => paper);
  return { papers: selected, window, duplicateCount: recent.length - selected.length, missingDateCount };
}
