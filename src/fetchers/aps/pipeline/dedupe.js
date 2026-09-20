function normalizeKey(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildKey(item) {
  if (item.doi) {
    return `doi:${normalizeKey(item.doi)}`;
  }

  return `fallback:${normalizeKey(item.journal)}|${normalizeKey(item.title)}|${normalizeKey(item.date)}`;
}

function choosePreferred(left, right) {
  if (left.status === "published" && right.status !== "published") {
    return left;
  }

  if (right.status === "published" && left.status !== "published") {
    return {
      ...right,
      extra: {
        ...right.extra,
        historical_status: Array.from(new Set([...(right.extra?.historical_status || []), left.status]))
      }
    };
  }

  return (right.abstract?.length || 0) > (left.abstract?.length || 0) ? right : left;
}

export function dedupeApsRecords(items) {
  const seen = new Map();

  for (const item of items) {
    const key = buildKey(item);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }

    seen.set(key, choosePreferred(existing, item));
  }

  return Array.from(seen.values());
}
