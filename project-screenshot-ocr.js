export const PROJECT_SCREENSHOT_BRANCHES = ["广州分行", "武汉分行", "青岛分行", "兰州分行", "苏州分行", "太原分行", "西安分行"];

const PROJECT_SCREENSHOT_BRANCH_PATTERNS = [
  { branch: "广州分行", pattern: /[广廣厂][州卅洲]分行/g },
  { branch: "武汉分行", pattern: /(?:[武式]汉|武式)分行/g },
  { branch: "青岛分行", pattern: /青[岛島鸟鳥]分行/g },
  { branch: "兰州分行", pattern: /[兰蘭][州洲]分行/g },
  { branch: "苏州分行", pattern: /[苏蘇]州分行/g },
  { branch: "太原分行", pattern: /[太大]原分行/g },
  { branch: "西安分行", pattern: /西安分行/g },
];

const BOND_TYPE_ALIASES = [
  { canonical: "超短期融资券", pattern: /超短(?:期)?融[资資咨][券卷劵眷]/gi },
  { canonical: "短期融资券", pattern: /短期融[资資咨][券卷劵眷]/gi },
  { canonical: "中期票据", pattern: /中期票[据劇根锯鋸居掘]/gi },
  { canonical: "定向债务融资工具", pattern: /定向(?:[债債]务|[债債][券卷劵])融[资資咨]工具/gi },
  { canonical: "定向工具", pattern: /定向工具/gi },
  { canonical: "公司债券", pattern: /公司[债債][券卷劵眷]/gi },
  { canonical: "企业债券", pattern: /企[业業][债債][券卷劵眷]/gi },
  { canonical: "资产支持票据", pattern: /[资資]产[支文广]持票[据劇根居]/gi },
  { canonical: "资产支持证券", pattern: /[资資]产支持[证證]券/gi },
  { canonical: "资产支持专项计划", pattern: /[资資]产支持[专專]项[计計][划刬]/gi },
];

const PROJECT_SCREENSHOT_BOND_TYPE_PATTERN = "(?:超短期融资券|短期融资券|中期票据|定向债务融资工具|定向工具|公司债券|企业债券|资产支持票据|资产支持证券|资产支持专项计划|SCP|CP|MTN|PPN|ABN|ABS)";
const PROJECT_SCREENSHOT_TRANCHE_PATTERN = "(?:品种(?:[一二三四五六七八九十]+|[A-Z]|[0-9]{1,2})|(?:优先(?:级|档)?|次级|劣后)(?:[一二三四五六七八九十]+|[A-Z][0-9]{0,2}|[0-9]{1,2})?(?:级|档)?|[AB])";
const PROJECT_SCREENSHOT_BOND_DECORATION_PATTERN = `(?:(?:[()（）]?${PROJECT_SCREENSHOT_TRANCHE_PATTERN}[()（）]?)|(?:[()（）][^()（）]{1,24}[()（）])){0,4}`;
const PROJECT_SCREENSHOT_BOND_SUFFIX_PATTERN = `${PROJECT_SCREENSHOT_BOND_DECORATION_PATTERN}(?:${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}${PROJECT_SCREENSHOT_BOND_DECORATION_PATTERN})?`;
const BOND_NAME_CHARACTERS = "\\u4e00-\\u9fffA-Za-z0-9()（）·-";

export function normalizeProjectScreenshotOcrText(text = "") {
  return normalizeProjectScreenshotBondTokens(normalizeProjectScreenshotOcrSource(text).replace(/\s+/g, ""));
}

export function normalizeProjectScreenshotOcrSource(text = "") {
  let normalized = String(text || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[|｜│┃¦┆╎┊丨]/g, " ")
    .replace(/[‐‑‒–—]/g, "-");

  return normalizeProjectScreenshotBondTokens(normalized);
}

function normalizeProjectScreenshotBondTokens(value = "") {
  let normalized = String(value || "")
    .replace(/(^|[^A-Za-z])[5S][Cc][Pp](?=$|[^A-Za-z])/g, "$1SCP")
    .replace(/(^|[^A-Za-z])M[7T][Nn](?=$|[^A-Za-z])/g, "$1MTN")
    .replace(/(^|[^A-Za-z])P[Pp][Nn](?=$|[^A-Za-z])/g, "$1PPN")
    .replace(/(^|[^A-Za-z])A[8B][Nn](?=$|[^A-Za-z])/g, "$1ABN")
    .replace(/(^|[^A-Za-z])A[8B][5S](?=$|[^A-Za-z])/g, "$1ABS")
    .replace(/分[衍何珩打]/g, "分行")
    .replace(/集困/g, "集团")
    .replace(/公同/g, "公司")
    .replace(/股分/g, "股份")
    .replace(/([2Zz])([0OoQ])([0-9OoQIiLlZzSsGg])([0-9OoQIiLlZzSsGg])(?=年|年度)/g, (...match) => (
      match.slice(1, 5).map(normalizeOcrDigit).join("")
    ))
    .replace(/第([0-9OoQIiLlZzSsGg]+)(?=期|号)/g, (_, value) => `第${[...value].map(normalizeOcrDigit).join("")}`)
    .replace(/优先A[IiLl](?=级)/g, "优先A1");

  for (const alias of BOND_TYPE_ALIASES) normalized = normalized.replace(alias.pattern, alias.canonical);
  return normalized;
}

export function parseProjectScreenshotOcrText(text = "") {
  const normalizedSource = normalizeProjectScreenshotOcrSource(text);
  const lines = normalizedSource
    .split(/\n+/)
    .map((line) => normalizeProjectScreenshotOcrText(line))
    .filter(Boolean);
  if (!lines.length) return [];

  const hasDetachedBranchColumn = lines.some((line, index) => (
    findProjectScreenshotBranchMatches(line).length > 0
    && !extractProjectScreenshotBondFullName(line)
    && (findProjectScreenshotBranchMatches(lines[index - 1] || "").length > 0
      || findProjectScreenshotBranchMatches(lines[index + 1] || "").length > 0)
  ));
  const hasStandaloneBranchLine = lines.some((line) => {
    const normalizedLine = normalizeProjectScreenshotOcrText(line);
    return findProjectScreenshotBranchMatches(normalizedLine)
      .some((match) => match.index === 0 && match.length === normalizedLine.length);
  });

  const entries = [];
  const seen = new Set();
  let carryBranch = "";
  let carryAdditionalRows = false;
  let carryLineIndex = -1;
  const addEntry = (branch, fullName) => {
    const cleaned = cleanProjectScreenshotBondFullName(fullName);
    if (!branch || !cleaned) return;
    const key = `${branch}|${normalizeProjectScreenshotOcrText(cleaned)}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ branch, fullName: cleaned });
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const branchMatches = findProjectScreenshotBranchMatches(lines[lineIndex]);
    if (!branchMatches.length && carryBranch && carryAdditionalRows && !hasDetachedBranchColumn) {
      const carriedNames = lineIndex === carryLineIndex + 1
        ? extractProjectScreenshotWrappedBondNames(lines, lineIndex)
        : [];
      let carried = false;
      for (const fullName of carriedNames) {
        addEntry(carryBranch, fullName);
        carried = true;
      }
      if (carried) carryLineIndex = lineIndex;
      else {
        carryBranch = "";
        carryAdditionalRows = false;
        carryLineIndex = -1;
      }
    }
    for (let branchIndex = 0; branchIndex < branchMatches.length; branchIndex += 1) {
      const branchMatch = branchMatches[branchIndex];
      carryBranch = branchMatch.branch;
      const currentSegment = lines[lineIndex].slice(
        branchMatch.index,
        branchMatches[branchIndex + 1]?.index ?? lines[lineIndex].length,
      );
      const currentHasBond = Boolean(extractProjectScreenshotBondFullName(currentSegment));
      carryAdditionalRows = currentHasBond;
      carryLineIndex = currentHasBond ? lineIndex : -1;
      const previousHasBranch = findProjectScreenshotBranchMatches(lines[lineIndex - 1] || "").length > 0;
      const previousPreviousHasBranch = findProjectScreenshotBranchMatches(lines[lineIndex - 2] || "").length > 0;
      const nextHasBranch = findProjectScreenshotBranchMatches(lines[lineIndex + 1] || "").length > 0;
      const previousHasBond = Boolean(extractProjectScreenshotBondFullName(lines[lineIndex - 1] || ""));
      const nextHasBond = Boolean(extractProjectScreenshotBondFullName(lines[lineIndex + 1] || ""));
      const isBranchColumnRun = !currentHasBond
        && ((previousHasBranch && !previousHasBond) || (nextHasBranch && !nextHasBond));
      const previousLine = !isBranchColumnRun && !previousHasBranch && !previousPreviousHasBranch
        ? lines[lineIndex - 1]
        : "";
      const currentTail = currentSegment.slice(branchMatch.length);
      const forwardWindows = isBranchColumnRun || currentHasBond
        ? [currentSegment]
        : projectScreenshotForwardBondWindows(lines, lineIndex, currentSegment);
      const backwardWindows = previousLine
        ? projectScreenshotForwardBondWindows(lines, lineIndex, `${previousLine}${currentTail}`).reverse()
        : [];
      const windows = [
        ...forwardWindows,
        ...backwardWindows,
        [previousLine, currentSegment].filter(Boolean).join(""),
      ];
      const candidateGroups = windows
        .map(extractProjectScreenshotBondFullNames)
        .filter((candidates) => candidates.length);
      for (const candidate of selectProjectScreenshotWindowCandidates(candidateGroups)) {
        addEntry(branchMatch.branch, candidate);
      }
    }
  }

  if (entries.length) return entries;
  if (hasDetachedBranchColumn || hasStandaloneBranchLine) return [];

  const compact = normalizeProjectScreenshotOcrText(normalizedSource);
  const matches = findProjectScreenshotBranchMatches(compact);
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const nextIndex = matches[index + 1]?.index ?? compact.length;
    const segmentEnd = Math.min(nextIndex, current.index + 320);
    const segment = compact.slice(current.index + current.length, segmentEnd);
    for (const fullName of extractProjectScreenshotBondFullNames(segment)) addEntry(current.branch, fullName);
  }
  return entries;
}

function projectScreenshotForwardBondWindows(lines = [], lineIndex = 0, seed = "") {
  const windows = [seed];
  let combined = seed;
  for (let offset = 1; offset <= 7; offset += 1) {
    const next = lines[lineIndex + offset] || "";
    if (!next || findProjectScreenshotBranchMatches(next).length) break;
    if (isProjectScreenshotTableMetadataLine(next)) continue;
    if (projectScreenshotIssueYear(combined) && projectScreenshotIssueYear(next)) break;
    const combinedText = normalizeProjectScreenshotOcrText(combined);
    const nextIssuer = projectScreenshotBondIssuer(next);
    const nextIssuerFragment = nextIssuer.replace(/^[()（）]+|[()（）]+$/g, "");
    const nextIssuerIsLegalSuffix = /^(?:有限责任公司|股份有限公司|集团有限公司|有限公司)$/.test(nextIssuerFragment);
    if (
      !projectScreenshotIssueYear(combined)
      && nextIssuer
      && (
        /(?:有限责任公司|股份有限公司|集团有限公司|有限公司)$/.test(combinedText)
        || (/(?:集团|公司|股份)$/.test(combinedText) && !nextIssuerIsLegalSuffix)
      )
    ) break;
    combined += next;
    windows.push(combined);
  }
  return windows;
}

function isProjectScreenshotTableMetadataLine(value = "") {
  const text = normalizeProjectScreenshotOcrText(value).toUpperCase();
  if (!text) return true;
  if (/^(?:期限|规模|发行规模|状态|截标(?:时间)?|缴款(?:时间|日)?|主承|牵头|联席|备注|发行场所|评级)[：:]?/.test(text)) return true;
  return /^(?:(?:\d+(?:\.\d+)?(?:Y|D|M|年|月|天))(?:\/(?:\d+(?:\.\d+)?(?:Y|D|M|年|月|天)))?|\d+(?:\.\d+)?(?:亿|亿元|万|万元)|(?:未投标|待投标|已投标|等待结果|中标|未中标|已缴款|待缴款)|(?:公募|私募|银行间|交易所)|(?:AAA|AA\+?|A\+?))$/i.test(text);
}

function selectProjectScreenshotWindowCandidates(candidateGroups = []) {
  let selected = candidateGroups[0] || [];
  for (const group of candidateGroups.slice(1)) {
    const onlyExtendsSelected = group.length > 0 && group.every((candidate) => {
      const candidateText = normalizeProjectScreenshotOcrText(candidate);
      return selected.some((base) => candidateText.startsWith(normalizeProjectScreenshotOcrText(base)));
    });
    if (onlyExtendsSelected) selected = group;
  }
  return selected;
}

export function mergeProjectScreenshotOcrPasses(passes = []) {
  const clusters = [];
  let order = 0;
  for (const pass of passes) {
    const confidence = Number(pass?.confidence);
    const sourceKey = String(pass?.sourceKey || "");
    const physicalRowKey = /^row:\d+$/.test(sourceKey) ? sourceKey : "";
    for (const entry of parseProjectScreenshotOcrText(pass?.text || "")) {
      const normalizedName = normalizeProjectScreenshotOcrText(entry.fullName);
      let cluster = physicalRowKey
        ? clusters.find((candidate) => candidate.branch === entry.branch
          && candidate.sourceKeys.has(physicalRowKey)
          && [...candidate.names].some((name) => projectScreenshotBondNamesMatch(name, normalizedName, { sameSourceRow: true })))
        : null;
      if (!cluster) cluster = clusters.find((candidate) => candidate.branch === entry.branch
        && [...candidate.names].some((name) => projectScreenshotBondNamesMatch(name, normalizedName, {
            sameSourceRow: Boolean(sourceKey && candidate.sourceKeys.has(sourceKey)),
          })));
      if (!cluster) {
        cluster = { branch: entry.branch, names: new Set([normalizedName]), candidates: [], labels: new Set(), sourceKeys: new Set(), order: order++ };
        clusters.push(cluster);
      }
      cluster.names.add(normalizedName);
      cluster.labels.add(String(pass?.label || "OCR"));
      if (sourceKey) cluster.sourceKeys.add(sourceKey);
      cluster.candidates.push({
        ...entry,
        confidence: Number.isFinite(confidence) ? confidence : 0,
        quality: projectScreenshotBondNameQuality(entry.fullName),
      });
      if (physicalRowKey) {
        const exactDuplicate = clusters.find((candidate) => candidate !== cluster
          && candidate.branch === entry.branch
          && candidate.names.has(normalizedName));
        if (exactDuplicate) {
          exactDuplicate.names.forEach((name) => cluster.names.add(name));
          exactDuplicate.labels.forEach((label) => cluster.labels.add(label));
          exactDuplicate.sourceKeys.forEach((key) => cluster.sourceKeys.add(key));
          cluster.candidates.push(...exactDuplicate.candidates);
          clusters.splice(clusters.indexOf(exactDuplicate), 1);
        }
      }
    }
  }

  return clusters
    .map((cluster) => {
      const best = [...cluster.candidates].sort((left, right) => (
        right.quality - left.quality
        || right.confidence - left.confidence
        || right.fullName.length - left.fullName.length
      ))[0];
      return {
        branch: cluster.branch,
        fullName: best.fullName,
        ocrConfidence: Math.round(best.confidence || 0),
        ocrVotes: cluster.labels.size,
        _order: cluster.order,
      };
    })
    .sort((left, right) => (
      PROJECT_SCREENSHOT_BRANCHES.indexOf(left.branch) - PROJECT_SCREENSHOT_BRANCHES.indexOf(right.branch)
      || left._order - right._order
    ))
    .map(({ _order, ...entry }) => entry);
}

export function groupProjectScreenshotOcrPhysicalRows(lines = []) {
  const normalized = (lines || [])
    .map((line, index) => ({
      text: normalizeProjectScreenshotOcrSource(line?.text || "").trim(),
      confidence: Number(line?.confidence) || 0,
      bbox: {
        x0: Number(line?.bbox?.x0),
        y0: Number(line?.bbox?.y0),
        x1: Number(line?.bbox?.x1),
        y1: Number(line?.bbox?.y1),
      },
      index,
    }))
    .filter((line) => line.text
      && Object.values(line.bbox).every(Number.isFinite)
      && line.bbox.x1 > line.bbox.x0
      && line.bbox.y1 > line.bbox.y0)
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0 || left.index - right.index);
  const sortedHeights = normalized
    .map((line) => line.bbox.y1 - line.bbox.y0)
    .sort((left, right) => left - right);
  const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] || 0;
  const spanningBranchLines = normalized.filter((line) => (
    medianHeight > 0
    && line.bbox.y1 - line.bbox.y0 > Math.max(medianHeight * 1.8, medianHeight + 24)
    && findProjectScreenshotBranchMatches(line.text).length
  ));
  const spanningBranchSet = new Set(spanningBranchLines);
  const rows = [];
  for (const line of normalized.filter((candidate) => !spanningBranchSet.has(candidate))) {
    const lineHeight = line.bbox.y1 - line.bbox.y0;
    const lineCenter = (line.bbox.y0 + line.bbox.y1) / 2;
    let best = null;
    for (const row of rows) {
      const rowHeight = row.bbox.y1 - row.bbox.y0;
      const overlap = Math.max(0, Math.min(row.bbox.y1, line.bbox.y1) - Math.max(row.bbox.y0, line.bbox.y0));
      const minimumHeight = Math.max(1, Math.min(rowHeight, lineHeight));
      const maximumHeight = Math.max(1, Math.max(rowHeight, lineHeight));
      const rowCenter = (row.bbox.y0 + row.bbox.y1) / 2;
      const samePhysicalRow = overlap / maximumHeight >= 0.35
        || Math.abs(rowCenter - lineCenter) <= minimumHeight * 0.42;
      if (!samePhysicalRow) continue;
      const distance = Math.abs(rowCenter - lineCenter);
      if (!best || distance < best.distance) best = { row, distance };
    }
    if (!best) {
      rows.push({ bbox: { ...line.bbox }, lines: [line] });
      continue;
    }
    best.row.lines.push(line);
    best.row.bbox.x0 = Math.min(best.row.bbox.x0, line.bbox.x0);
    best.row.bbox.y0 = Math.min(best.row.bbox.y0, line.bbox.y0);
    best.row.bbox.x1 = Math.max(best.row.bbox.x1, line.bbox.x1);
    best.row.bbox.y1 = Math.max(best.row.bbox.y1, line.bbox.y1);
  }
  for (const line of spanningBranchLines) {
    const matchingRows = rows.filter((row) => {
      const rowCenter = (row.bbox.y0 + row.bbox.y1) / 2;
      return rowCenter >= line.bbox.y0 && rowCenter <= line.bbox.y1;
    });
    if (!matchingRows.length) {
      rows.push({ bbox: { ...line.bbox }, lines: [line] });
      continue;
    }
    matchingRows.forEach((row) => row.lines.push(line));
  }
  const physicalRows = rows
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0)
    .map((row) => {
      const ordered = row.lines.sort((left, right) => left.bbox.x0 - right.bbox.x0 || left.index - right.index);
      const meaningful = ordered.filter((line) => !isProjectScreenshotTableMetadataLine(line.text));
      const textLines = meaningful.length ? meaningful : ordered;
      return {
        text: textLines.map((line) => line.text).join(" "),
        confidence: Math.round(textLines.reduce((sum, line) => sum + line.confidence, 0) / textLines.length),
        bbox: row.bbox,
      };
    });
  const mergedRows = [];
  for (const row of physicalRows) {
    const previous = mergedRows.at(-1);
    const previousLooksIncomplete = previous
      && projectScreenshotIssueYear(previous.text)
      && !findProjectScreenshotBranchMatches(row.text).length
      && !extractProjectScreenshotBondFullName(previous.text)
      && projectScreenshotCanContinueWrappedBond(row.text, previous.text);
    if (!previousLooksIncomplete) {
      mergedRows.push(row);
      continue;
    }
    previous.text = `${previous.text} ${row.text}`;
    previous.confidence = Math.round((previous.confidence + row.confidence) / 2);
    previous.bbox.x0 = Math.min(previous.bbox.x0, row.bbox.x0);
    previous.bbox.y0 = Math.min(previous.bbox.y0, row.bbox.y0);
    previous.bbox.x1 = Math.max(previous.bbox.x1, row.bbox.x1);
    previous.bbox.y1 = Math.max(previous.bbox.y1, row.bbox.y1);
  }
  return mergedRows;
}

export function selectReliableProjectScreenshotSuggestion(fullName = "", suggestions = []) {
  const query = normalizeProjectScreenshotBondComparisonText(fullName);
  if (!query) return null;
  const ranked = (suggestions || [])
    .filter((suggestion) => suggestion?.shortName || suggestion?.securityId)
    .map((suggestion) => ({
      ...suggestion,
      ocrSimilarity: projectScreenshotTextSimilarity(query, normalizeProjectScreenshotBondComparisonText(suggestion?.fullName || "")),
    }))
    .filter((suggestion) => Number(suggestion.score) >= 90 && suggestion.ocrSimilarity >= 0.9)
    .filter((suggestion) => projectScreenshotBondFamily(fullName) === projectScreenshotBondFamily(suggestion.fullName))
    .filter((suggestion) => projectScreenshotIssueYear(fullName) === projectScreenshotIssueYear(suggestion.fullName))
    .filter((suggestion) => projectScreenshotBondVariant(fullName) === projectScreenshotBondVariant(suggestion.fullName, suggestion.shortName))
    .filter((suggestion) => projectScreenshotBondFeatureKey(fullName) === projectScreenshotBondFeatureKey(suggestion.fullName))
    .filter((suggestion) => {
      const queryIssuer = projectScreenshotBondIssuer(fullName);
      const candidateIssuer = projectScreenshotBondIssuer(suggestion.fullName);
      return Boolean(queryIssuer && candidateIssuer && queryIssuer === candidateIssuer);
    })
    .sort((left, right) => right.ocrSimilarity - left.ocrSimilarity || Number(right.score) - Number(left.score));
  const top = ranked[0];
  if (!top) return null;
  const second = ranked[1];
  if (second && top.ocrSimilarity - second.ocrSimilarity < 0.025 && Number(top.score) - Number(second.score) < 5) return null;
  return top;
}

export function collapseProjectScreenshotRowsWithVerifiedMatches(rows = []) {
  const verifiedSecurityIds = new Set();
  return rows.filter((row) => {
    if (row.status !== "ok" || !row.dmVerified) return true;
    const securityId = row.verifiedSecurityId || row.securityId || "";
    if (!securityId) return true;
    const key = `${row.branch || ""}|${securityId}`;
    if (verifiedSecurityIds.has(key)) return false;
    verifiedSecurityIds.add(key);
    return true;
  });
}

export function extractProjectScreenshotBondFullName(segment = "") {
  return extractProjectScreenshotBondFullNames(segment)[0] || "";
}

export function extractProjectScreenshotBondFullNames(segment = "") {
  const text = normalizeProjectScreenshotOcrText(segment);
  if (!text) return [];
  const year = "20\\d{2}(?:年度|年)";
  const officialPattern = new RegExp(`([${BOND_NAME_CHARACTERS}]{3,120}?${year}[${BOND_NAME_CHARACTERS}]{0,100}?${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}${PROJECT_SCREENSHOT_BOND_SUFFIX_PATTERN})`, "ig");
  const fallbackPattern = new RegExp(`([${BOND_NAME_CHARACTERS}]{6,180}?(?:资产支持票据|资产支持证券|资产支持专项计划|ABN|ABS)${PROJECT_SCREENSHOT_BOND_SUFFIX_PATTERN})`, "ig");
  const candidates = projectScreenshotBondTextVariants(text)
    .flatMap((variant) => [...variant.matchAll(officialPattern), ...variant.matchAll(fallbackPattern)])
    .map((match) => cleanProjectScreenshotBondFullName(match[1]))
    .filter(Boolean)
    .filter(isStructurallyValidProjectScreenshotBondName);
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizeProjectScreenshotOcrText(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanProjectScreenshotBondFullName(value = "") {
  let text = normalizeProjectScreenshotOcrText(value)
    .replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, "")
    .replace(/^(?:序号|项目|分行|主承|牵头|联席|债券全称|债项名称)+/, "")
    .replace(/[,:;，。；：].*$/, "");
  const ocrBranchPrefix = findProjectScreenshotBranchMatches(text).find((match) => match.index === 0);
  if (ocrBranchPrefix) text = text.slice(ocrBranchPrefix.length);
  for (const branch of PROJECT_SCREENSHOT_BRANCHES) {
    if (text.startsWith(branch)) text = text.slice(branch.length);
  }
  const endPattern = new RegExp(`^(.+?${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}${PROJECT_SCREENSHOT_BOND_SUFFIX_PATTERN})`, "i");
  const endMatch = text.match(endPattern);
  if (endMatch) text = endMatch[1];
  return text.length >= 8 && projectScreenshotBondFamily(text) ? text : "";
}

export function findProjectScreenshotBranchMatches(compact = "") {
  const text = normalizeProjectScreenshotOcrText(compact);
  const matches = [];
  for (const { branch, pattern } of PROJECT_SCREENSHOT_BRANCH_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) matches.push({ branch, index: match.index, length: match[0].length });
  }
  return matches
    .sort((left, right) => left.index - right.index || right.length - left.length)
    .filter((match, index, list) => !index || match.index !== list[index - 1].index || match.branch !== list[index - 1].branch);
}

function normalizeOcrDigit(value) {
  if (/[OoQ]/.test(value)) return "0";
  if (/[IiLl]/.test(value)) return "1";
  if (/[Zz]/.test(value)) return "2";
  if (/[Ss]/.test(value)) return "5";
  if (/[Gg]/.test(value)) return "6";
  return value;
}

function extractProjectScreenshotWrappedBondNames(lines = [], lineIndex = 0) {
  const current = lines[lineIndex] || "";
  if (!current || !projectScreenshotCanContinueWrappedBond(current)) return [];
  const windows = [current];
  let combined = current;
  for (let offset = 1; offset <= 6; offset += 1) {
    const next = lines[lineIndex + offset] || "";
    if (!next || findProjectScreenshotBranchMatches(next).length || !projectScreenshotCanContinueWrappedBond(next, combined)) break;
    combined += next;
    windows.push(combined);
  }
  return selectProjectScreenshotWindowCandidates(
    windows.map(extractProjectScreenshotBondFullNames).filter((candidates) => candidates.length),
  );
}

function projectScreenshotCanContinueWrappedBond(line = "", prefix = "") {
  const text = normalizeProjectScreenshotOcrText(line);
  if (!text) return false;
  if (/(?:项目表|项目说明|序号|截标|询价|规模|主承|牵头|联席|备注|状态|发行日|缴款日)/.test(text)) return false;
  if (!prefix) return Boolean(projectScreenshotIssueYear(text) || projectScreenshotBondFamily(text) || /(?:公司|集团|股份|有限|专项计划|第[一二三四五六七八九十0-9]+号)/.test(text));
  return Boolean(projectScreenshotBondFamily(text)
    || /^(?:中期|票据|短期|超短期|融资|券|定向|债务|工具|公司债|企业债|资产|支持|专项|计划|证券)$/i.test(text)
    || /(?:品种|优先|次级|劣后|第[一二三四五六七八九十0-9]+(?:期|号))/.test(text));
}

function isStructurallyValidProjectScreenshotBondName(value = "") {
  const text = normalizeProjectScreenshotOcrText(value);
  const family = projectScreenshotBondFamily(text);
  if (!family) return false;
  const issueYears = text.match(/20\d{2}(?=年度|年)/g) || [];
  if (issueYears.length > 1) return false;
  if (issueYears.length === 1) {
    const issuer = projectScreenshotBondIssuer(text);
    if (!issuer || /^(?:本期|本次|项目|债券|发行|计划|汇总|清单)/.test(issuer)) return false;
    const issuerLegalNames = issuer
      .match(/(?:有限责任公司|股份有限公司|集团有限公司|有限公司)/g) || [];
    return issuerLegalNames.length <= 1;
  }
  if (!/(?:资产支持票据|资产支持证券|资产支持专项计划|ABN|ABS)/i.test(family)) return false;
  const familyIndex = text.search(new RegExp(PROJECT_SCREENSHOT_BOND_TYPE_PATTERN, "i"));
  const productPrefix = familyIndex > 0 ? text.slice(0, familyIndex) : "";
  if (!productPrefix || /^(?:本期|本次|项目|债券|发行|计划|汇总|清单)/.test(productPrefix)) return false;
  return /(?:第[一二三四五六七八九十百0-9]+(?:期|号)|优先|次级|劣后|[A-Z][0-9]+级?)/i.test(text);
}

function projectScreenshotBondNameQuality(value = "") {
  const text = normalizeProjectScreenshotOcrText(value);
  let score = Math.min(4, text.length / 24);
  if (projectScreenshotIssueYear(text)) score += 4;
  if (projectScreenshotBondFamily(text)) score += 5;
  if (/(?:第[一二三四五六七八九十0-9]+期|[A-Z]?[0-9]{2,3})/i.test(text)) score += 1;
  if (/(?:分行|牵头|规模|截标|亿元|序号)/.test(text)) score -= 6;
  const openingParentheses = (text.match(/[(（]/g) || []).length;
  const closingParentheses = (text.match(/[)）]/g) || []).length;
  score -= Math.abs(openingParentheses - closingParentheses) * 2;
  if (/[/／]$/.test(text)) score -= 2;
  return score;
}

function projectScreenshotBondNamesMatch(left = "", right = "", { sameSourceRow = false } = {}) {
  if (left === right) return true;
  const leftYear = projectScreenshotIssueYear(left);
  const rightYear = projectScreenshotIssueYear(right);
  if (leftYear !== rightYear) return false;
  if (projectScreenshotBondFamily(left) !== projectScreenshotBondFamily(right)) return false;
  const leftIssuer = projectScreenshotBondIssuer(left);
  const rightIssuer = projectScreenshotBondIssuer(right);
  if (leftIssuer && rightIssuer && leftIssuer !== rightIssuer) {
    if (!sameSourceRow || projectScreenshotTextSimilarity(leftIssuer, rightIssuer) < 0.86) return false;
  }
  const leftVariant = projectScreenshotBondVariant(left);
  const rightVariant = projectScreenshotBondVariant(right);
  if ((leftVariant || rightVariant) && leftVariant !== rightVariant) return false;
  if (projectScreenshotBondFeatureKey(left) !== projectScreenshotBondFeatureKey(right)) return false;
  if (!leftYear && !rightYear) return false;
  return projectScreenshotTextSimilarity(left, right) >= 0.84;
}

function projectScreenshotBondFeatureKey(value = "") {
  const text = normalizeProjectScreenshotOcrText(value).toUpperCase();
  const features = [];
  if (/(?:永续|可续期|无固定期限|PERP)/i.test(text)) features.push("PERPETUAL");
  if (/(?:绿色|碳中和)/.test(text)) features.push("GREEN");
  if (/(?:科创|科技创新)/.test(text)) features.push("TECH");
  if (/乡村振兴/.test(text)) features.push("RURAL");
  if (/(?:可持续发展挂钩|可持续挂钩)/.test(text)) features.push("SUSTAINABILITY_LINKED");
  if (/(?:次级|二级资本|资本补充|总损失吸收能力|TLAC)/i.test(text)) features.push("SUBORDINATED");
  if (/(?:无担保|无增信)/.test(text)) features.push("UNSECURED");
  else if (/(?:有担保|保证担保|担保债券)/.test(text)) features.push("GUARANTEED");
  if (/抵押/.test(text)) features.push("MORTGAGE");
  if (/质押/.test(text)) features.push("PLEDGED");
  return features.join("|");
}

function projectScreenshotBondTextVariants(value = "") {
  const text = normalizeProjectScreenshotOcrText(value);
  const variety = "(?:品种(?:[一二三四五六七八九十]+|[A-Z]|[0-9]{1,2})|[AB])";
  const typePattern = new RegExp(`^(.*?${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN})(?:[()（）])?(${variety})(?:[()（）])?/(?:[()（）])?(${variety}|[一二三四五六七八九十0-9]+)(?:[()（）])?(.*)$`, "i");
  const match = text.match(typePattern);
  if (!match) return [text];
  const [, prefix, leftVariant, rightVariant, suffix] = match;
  if (/^[一二三四五六七八九十0-9]+$/.test(rightVariant)
    && !/^品种(?:[一二三四五六七八九十]+|[0-9]{1,2})$/.test(leftVariant)) return [text];
  const usesVarietyLabel = leftVariant.startsWith("品种") || rightVariant.startsWith("品种");
  const normalizeVariant = (variant) => (
    usesVarietyLabel && !variant.startsWith("品种") ? `品种${variant}` : variant
  );
  const cleanedSuffix = suffix.replace(/^[)）]/, "");
  return [
    `${prefix}${normalizeVariant(leftVariant)}${cleanedSuffix}`,
    `${prefix}${normalizeVariant(rightVariant)}${cleanedSuffix}`,
  ];
}

function projectScreenshotIssueYear(value = "") {
  return normalizeProjectScreenshotOcrText(value).match(/20\d{2}(?=年度|年)/)?.[0] || "";
}

function projectScreenshotBondIssuer(value = "") {
  const text = normalizeProjectScreenshotOcrText(value);
  const yearIndex = text.search(/20\d{2}(?=年度|年)/);
  return yearIndex > 0 ? text.slice(0, yearIndex) : "";
}

function normalizeProjectScreenshotBondComparisonText(value = "") {
  let text = normalizeProjectScreenshotOcrText(value).toUpperCase();
  text = text
    .replace(/第([一二三四五六七八九十百0-9]+)(期|号)/g, (_, ordinal, suffix) => `第${normalizeProjectScreenshotOrdinal(ordinal)}${suffix}`)
    .replace(/品种([一二三四五六七八九十百AB0-9]+)/g, (_, ordinal) => `品种${normalizeProjectScreenshotOrdinal(ordinal)}`)
    .replace(new RegExp(`(${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN})([AB])(?=[()（）]|$)`, "i"), (_, family, tranche) => `${family}品种${tranche === "A" ? "1" : "2"}`);
  return text;
}

function projectScreenshotBondFamily(value = "") {
  return normalizeProjectScreenshotOcrText(value).match(new RegExp(PROJECT_SCREENSHOT_BOND_TYPE_PATTERN, "i"))?.[0]?.toUpperCase() || "";
}

function projectScreenshotBondVariant(value = "", shortName = "") {
  const text = normalizeProjectScreenshotOcrText(value).toUpperCase();
  const issueValue = text.match(/第([一二三四五六七八九十百0-9]+)(?:期|号)/)?.[1] || "";
  const issue = issueValue ? `ISSUE:${normalizeProjectScreenshotOrdinal(issueValue)}` : "";
  const fullTranche = projectScreenshotTrancheToken(text);
  const shortTranche = normalizeProjectScreenshotOcrText(shortName).toUpperCase().match(/(?:MTN|PPN|ABN|ABS|SCP|CP)\d{1,3}([AB])(?:\b|$)/)?.[1] || "";
  const normalizedShortTranche = shortTranche === "A" ? "TRANCHE:1" : shortTranche === "B" ? "TRANCHE:2" : "";
  const tranche = fullTranche && normalizedShortTranche && fullTranche !== normalizedShortTranche
    ? "TRANCHE:CONFLICT"
    : fullTranche || normalizedShortTranche;
  return [issue, tranche].filter(Boolean).join("|");
}

function projectScreenshotTrancheToken(text = "") {
  const variety = text.match(/品种([一二三四五六七八九十百AB0-9]+)/)?.[1] || "";
  if (variety) return `TRANCHE:${normalizeProjectScreenshotOrdinal(variety)}`;
  const familyTranche = text.match(new RegExp(`${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}([AB])(?=[()（）]|$)`, "i"))?.[1] || "";
  if (familyTranche === "A") return "TRANCHE:1";
  if (familyTranche === "B") return "TRANCHE:2";
  const priority = text.match(/(优先(?:级|档)?[一二三四五六七八九十A-Z0-9-]*|次级[一二三四五六七八九十A-Z0-9-]*|劣后[一二三四五六七八九十A-Z0-9-]*)/)?.[1] || "";
  return priority ? `CLASS:${priority}` : "";
}

function normalizeProjectScreenshotOrdinal(value = "") {
  const text = String(value || "").toUpperCase();
  if (text === "A") return "1";
  if (text === "B") return "2";
  if (/^\d+$/.test(text)) return String(Number(text));
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return "10";
  if (text.includes("十")) {
    const [left, right] = text.split("十");
    const tens = left ? digits[left] : 1;
    const ones = right ? digits[right] : 0;
    if (Number.isFinite(tens) && Number.isFinite(ones)) return String(tens * 10 + ones);
  }
  if (Object.hasOwn(digits, text)) return String(digits[text]);
  return text;
}

function projectScreenshotTextSimilarity(left = "", right = "") {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLength = Math.max(left.length, right.length);
  return Math.max(0, 1 - levenshteinDistance(left, right) / maxLength);
}

function levenshteinDistance(left = "", right = "") {
  const a = [...String(left)];
  const b = [...String(right)];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (a[i] === b[j] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] || 0;
}
