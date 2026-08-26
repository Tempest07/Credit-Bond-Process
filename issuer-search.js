export function normalizeIssuerSearchTerm(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function buildIssuerSearchIndex(issuers = [], pinyin = globalThis.pinyinPro?.pinyin) {
  return [...issuers]
    .map((issuer, sourceIndex) => {
      const sources = [
        issuer.legalName,
        ...(issuer.aliases || []),
        issuer.linkedBranch || issuer.defaultBranch,
      ].map((value) => String(value || "").trim()).filter(Boolean);
      return {
        issuer,
        sourceIndex,
        directKeys: sources.map(normalizeIssuerSearchTerm),
        fullPinyinKeys: sources.map((value) => convertIssuerPinyin(value, pinyin, false)),
        initialPinyinKeys: sources.map((value) => convertIssuerPinyin(value, pinyin, true)),
      };
    })
    .sort((left, right) => left.issuer.legalName.localeCompare(right.issuer.legalName, "zh-CN"));
}

export function searchIssuerIndex(index = [], query = "") {
  const normalizedQuery = normalizeIssuerSearchTerm(query);
  if (!normalizedQuery) return [...index];
  return index
    .map((entry) => ({ entry, score: issuerSearchScore(entry, normalizedQuery) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score
      || left.entry.issuer.legalName.localeCompare(right.entry.issuer.legalName, "zh-CN")
      || left.entry.sourceIndex - right.entry.sourceIndex)
    .map(({ entry }) => entry);
}

function convertIssuerPinyin(value, pinyin, initialsOnly) {
  if (typeof pinyin !== "function") return "";
  try {
    const result = pinyin(value, {
      toneType: "none",
      type: "array",
      ...(initialsOnly ? { pattern: "first" } : {}),
    });
    const joined = Array.isArray(result) ? result.join("") : result;
    const deskAdjusted = initialsOnly ? joined : String(joined).replace(/fenxing(?=$|fen)/g, "fenhang");
    return normalizeIssuerSearchTerm(deskAdjusted);
  } catch {
    return "";
  }
}

function issuerSearchScore(entry, query) {
  const groups = [
    [entry.directKeys, 0],
    [entry.fullPinyinKeys, 20],
    [entry.initialPinyinKeys, 40],
  ];
  let score = Number.POSITIVE_INFINITY;
  for (const [keys, offset] of groups) {
    for (const key of keys) {
      if (!key) continue;
      if (key === query) score = Math.min(score, offset);
      else if (key.startsWith(query)) score = Math.min(score, offset + 4);
      else if (key.includes(query)) score = Math.min(score, offset + 8);
    }
  }
  return score;
}
