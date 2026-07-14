import { readUserAppState, requireUser } from "../_auth.js";
import { lookupWindImpliedRating, windImpliedRatingEnabled } from "../_wind.js";

const DM_BASE_URL = "https://gapi-ext.innodealing.com";
const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const PRIMARY_PATH = "/dm-quant-func-service/api/v1/bond/primary/data";
const COMPANY_INFO_PATH = "/dm-quant-func-service/api/v1/company/basic-info/info";
const OUTSTANDING_BONDS_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/outstanding-bonds";

const SBOX = [
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
];

const FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];
const CK = [
  0x00070e15, 0x1c232a31, 0x383f464d, 0x545b6269, 0x70777e85, 0x8c939aa1, 0xa8afb6bd, 0xc4cbd2d9,
  0xe0e7eef5, 0xfc030a11, 0x181f262d, 0x343b4249, 0x50575e65, 0x6c737a81, 0x888f969d, 0xa4abb2b9,
  0xc0c7ced5, 0xdce3eaf1, 0xf8ff060d, 0x141b2229, 0x30373e45, 0x4c535a61, 0x686f767d, 0x848b9299,
  0xa0a7aeb5, 0xbcc3cad1, 0xd8dfe6ed, 0xf4fb0209, 0x10171e25, 0x2c333a41, 0x484f565d, 0x646b7279,
];

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;

  const url = new URL(context.request.url);
  const shortName = (url.searchParams.get("shortName") || url.searchParams.get("short_name") || "").trim();
  const securityId = (url.searchParams.get("securityId") || url.searchParams.get("security_id") || "").trim();
  const fullName = (url.searchParams.get("fullName") || url.searchParams.get("full_name") || "").trim();
  const startDate = (url.searchParams.get("startDate") || url.searchParams.get("start_date") || "").trim();
  const endDate = (url.searchParams.get("endDate") || url.searchParams.get("end_date") || "").trim();

  if (!shortName && !securityId && !fullName) {
    return json({ error: "请提供 shortName、securityId 或 fullName" }, 400);
  }
  const missingConfig = validateDmConfig(context.env);
  if (missingConfig) return missingConfig;

  try {
    const dm = makeDmClient(context.env, context.request);
    const basic = await lookupBasicInfo(dm, { shortName, securityId, fullName });
    const basicRow = firstRow(basic);
    const primary = await lookupPrimaryData(dm, {
      shortName,
      securityId,
      fullName,
      issuerName: pickFirstString(basicRow, ["issuer_name", "issuerName"]),
      absHintText: rowAbsSearchText(basicRow),
      startDate,
      endDate,
    });
    const dmMatched = hasMatchedDmLookupResult(basic, primary);
    const issuerName = pickFirstString(firstRow(primary), ["issuer_full_name", "issuerFullName"])
      || pickFirstString(firstRow(basic), ["issuer_name", "issuerName"]);
    const company = issuerName ? await lookupCompanyInfo(dm, issuerName) : null;
    const normalized = normalizeDmLookup({ shortName, securityId, fullName, basic, primary, company });
    const windEnabled = windImpliedRatingEnabled(context.env);
    const dmRatingDiscovery = await lookupDmRatingDiscovery(dm, { normalized, basic, primary, company }, {
      includeImplied: !windEnabled,
    });
    const dmEnrichedNormalized = applyDmRatingDiscovery(normalized, dmRatingDiscovery);
    const windImpliedRating = dmMatched
      ? await lookupWindImpliedRating(context.env, {
          securityId: dmEnrichedNormalized.securityId || securityId,
          shortName: dmEnrichedNormalized.shortName || shortName,
        })
      : {
          status: "skipped_no_dm_match",
          source: "wind-analytics",
          target: securityId || shortName || fullName,
          rating: "",
          windCode: "",
          shortName: "",
          asOf: "",
          rowCount: 0,
        };
    const windEnrichedNormalized = applyWindImpliedRating(dmEnrichedNormalized, windImpliedRating, windEnabled);
    const d1State = await readD1AppState(context.env.DB, auth.user.id);
    const issuerRatingFallback = lookupIssuerRatingFallback(d1State, windEnrichedNormalized);
    const enrichedNormalized = applyIssuerRatingFallback(windEnrichedNormalized, issuerRatingFallback);
    const issueGroup = lookupIssueGroup(d1State, enrichedNormalized, { shortName, securityId, fullName }, primary, basic);
    if (!dmMatched && !issuerRatingFallback && !issueGroup) {
      return json(dmNoResultPayload({ shortName, securityId, fullName, basic, primary }));
    }
    const normalizedWithIssueGroup = issueGroup ? { ...enrichedNormalized, issueGroup } : enrichedNormalized;

    return json({
      ok: true,
      query: { shortName, securityId, fullName, startDate: primary.window.startDate, endDate: primary.window.endDate },
      normalized: normalizedWithIssueGroup,
      issueGroup,
      diagnostic: {
        dmMatched,
        rating: ratingDiagnostic(
          normalized,
          dmRatingDiscovery,
          windImpliedRating,
          issuerRatingFallback,
          enrichedNormalized,
          Boolean(context.env.DB),
          windEnabled,
        ),
        issueGroup: issueGroupDiagnostic(issueGroup),
      },
      fieldCandidates: collectFieldCandidates([
        basic.rows,
        primary.rows,
        company?.rows,
        ...(dmRatingDiscovery.sources || []).map((source) => source.rows),
      ].filter(Boolean)),
      raw: {
        basicInfo: basic.raw,
        primaryData: primary.raw,
        companyInfo: company?.raw || null,
        dmRatingDiscovery: Object.fromEntries((dmRatingDiscovery.sources || []).map((source) => [source.name, source.raw])),
        windImpliedRating,
      },
    });
  } catch (error) {
    return json({
      ok: false,
      error: error.message || "DM 查询失败",
      diagnostic: error.diagnostic || null,
      hint: "请检查 INNO_APP_KEY/INNO_APP_SECRET、DM 套餐权限、Cloudflare 到 DM 的网络访问以及简称是否能匹配。",
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function lookupBasicInfo(dm, { shortName, securityId, fullName }) {
  if (!shortName && !securityId) return { raw: null, rows: [] };
  const payload = securityId
    ? { securityIdList: [securityId] }
    : { secShortNameList: basicShortNameCandidates(shortName) };
  const raw = await dm.post(BASIC_INFO_PATH, payload);
  const rows = rowsFromDm(raw);
  return { raw, rows: rows.filter((row) => primaryRowMatchesQuery(row, { shortName, securityId, fullName })) };
}

function basicShortNameCandidates(shortName = "") {
  const value = String(shortName || "").trim();
  const label = value.match(/(\([^()]*\)|（[^（）]*）)$/)?.[1] || "";
  const core = label ? value.slice(0, -label.length) : value;
  if (!/^(?:.*)(?:MTN|PPN|PRN)\d{3}$/i.test(core)) return [value];
  return [value, `${core}A${label}`, `${core}B${label}`];
}

async function lookupPrimaryData(dm, { shortName, securityId, fullName, issuerName, absHintText, startDate, endDate }) {
  const window = resolvePrimaryWindow(startDate, endDate);
  const basePayload = {
    startDate: window.startDate,
    endDate: window.endDate,
  };
  if (issuerName) basePayload.issuerFullName = issuerName;

  const shouldTryAbsCategories = isAbsLookupText([shortName, fullName, absHintText].filter(Boolean).join(" "));
  const payloads = [
    { ...basePayload, bond_category: "1" },
    ...(shouldTryAbsCategories ? [
      { ...basePayload, bond_category: "2" },
      { ...basePayload, bond_category: "3" },
      { ...basePayload },
    ] : []),
  ];
  const allRows = [];
  const seen = new Set();
  const sources = [];
  let firstRaw = null;

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    try {
      const raw = await dm.post(PRIMARY_PATH, payload);
      if (!firstRaw) firstRaw = raw;
      const rows = rowsFromDm(raw);
      sources.push({
        bondCategory: payload.bond_category || "",
        rowCount: rows.length,
      });
      for (const row of rows) {
        const key = primaryRowDedupKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        allRows.push(row);
      }
    } catch (error) {
      if (index === 0) throw error;
      sources.push({
        bondCategory: payload.bond_category || "",
        error: error.message || "primary-data optional ABS lookup failed",
      });
    }
  }

  const filtered = allRows.filter((row) => primaryRowMatchesQuery(row, { shortName, securityId, fullName }));
  const raw = sources.length > 1 ? { list: allRows, sources, firstRaw } : (firstRaw || { list: allRows });
  return { raw, rows: shortName || securityId || fullName ? filtered : allRows, window };
}

async function lookupCompanyInfo(dm, issuerName) {
  const raw = await dm.post(COMPANY_INFO_PATH, { comFullNameList: [issuerName] });
  return { raw, rows: rowsFromDm(raw) };
}

function hasMatchedDmLookupResult(basic, primary) {
  return Boolean((basic?.rows || []).length || (primary?.rows || []).length);
}

function dmNoResultPayload({ shortName, securityId, fullName, basic, primary }) {
  const suggestions = closestDmLookupSuggestions({
    shortName,
    securityId,
    fullName,
    rows: rowsFromDm(primary?.raw),
  });
  return {
    ok: false,
    noResult: true,
    error: "未查询到匹配债券",
    hint: suggestions.length
      ? "请确认债券简称、债券代码或查询日期窗口；下方已列出相近候选，可点击继续查询。"
      : "请确认债券简称、债券代码或查询日期窗口；DM 接口已返回，但没有匹配到该债券。",
    query: { shortName, securityId, fullName, startDate: primary.window.startDate, endDate: primary.window.endDate },
    normalized: null,
    issueGroup: null,
    suggestions,
    diagnostic: {
      dmMatched: false,
      noResult: {
        basicRows: (basic?.rows || []).length,
        matchedPrimaryRows: (primary?.rows || []).length,
        rawPrimaryRows: rowsFromDm(primary?.raw).length,
        suggestionCount: suggestions.length,
        reason: "DM basic-info returned no row and primary-data had no row matching the requested short name or security id.",
      },
    },
    fieldCandidates: [],
    raw: {
      basicInfo: basic.raw,
      primaryData: primary.raw,
      companyInfo: null,
      dmRatingDiscovery: {},
    },
  };
}

function closestDmLookupSuggestions({ shortName, securityId, fullName, rows }) {
  const bestByKey = new Map();
  for (const row of rows || []) {
    const scoring = dmLookupSuggestionScore(row, { shortName, securityId, fullName });
    const score = scoring.score;
    if (score < 35) continue;
    const suggestion = dmLookupSuggestionFromRow(row, score, scoring.reasons);
    if (!suggestion.shortName && !suggestion.securityId) continue;
    const key = `${normalizeLookupName(suggestion.shortName)}|${normalizeSecurityId(suggestion.securityId)}`;
    if (!bestByKey.has(key) || score > bestByKey.get(key).score) {
      bestByKey.set(key, suggestion);
    }
  }
  return [...bestByKey.values()]
    .sort((left, right) => right.score - left.score || String(left.shortName).localeCompare(String(right.shortName), "zh-Hans-CN"))
    .slice(0, 5);
}

function dmLookupSuggestionScore(row, query) {
  const queryName = normalizeLookupName(query?.shortName);
  const querySecurityId = normalizeSecurityId(query?.securityId);
  const queryFullName = normalizeFullNameForLookup(query?.fullName);
  let score = 0;
  const reasons = [];
  if (queryFullName) {
    for (const name of rowFullNames(row)) {
      const candidateName = normalizeFullNameForLookup(name);
      if (!candidateName) continue;
      let candidateScore = 0;
      if (candidateName === queryFullName) {
        candidateScore = 100;
      } else if (candidateName.includes(queryFullName) || queryFullName.includes(candidateName)) {
        candidateScore = 82 + Math.round(12 * Math.min(candidateName.length, queryFullName.length) / Math.max(candidateName.length, queryFullName.length));
      } else {
        candidateScore = Math.round(100 * stringSimilarity(queryFullName, candidateName));
      }
      if (candidateScore > score) {
        score = candidateScore;
        reasons.splice(0, reasons.length, candidateScore >= 95 ? "鍏ㄧО楂樺害鍖归厤" : "鍏ㄧО鐩歌繎");
      }
    }
  }
  if (queryName) {
    const queryProfile = shortNameProfile(queryName);
    for (const name of rowShortNames(row)) {
      const candidate = scoreShortNameCandidate(queryName, queryProfile, normalizeLookupName(name));
      if (candidate.score > score) {
        score = candidate.score;
        reasons.splice(0, reasons.length, ...candidate.reasons);
      }
    }
  }
  if (querySecurityId) {
    const queryCode = stripSecuritySuffix(querySecurityId);
    for (const securityId of rowSecurityIds(row)) {
      const candidateCode = stripSecuritySuffix(normalizeSecurityId(securityId));
      const candidateScore = Math.round(100 * stringSimilarity(queryCode, candidateCode));
      if (candidateScore > score) {
        score = candidateScore;
        reasons.splice(0, reasons.length, candidateScore >= 90 ? "代码相近" : "代码部分相近");
      }
    }
  }
  return { score, reasons: uniqueStrings(reasons).slice(0, 3) };
}

function scoreShortNameCandidate(queryName, queryProfile, candidateName) {
  if (!candidateName) return { score: 0, reasons: [] };
  if (queryName === candidateName) return { score: 100, reasons: ["简称完全一致"] };

  const rawScore = Math.round(100 * stringSimilarity(queryName, candidateName));
  const candidateProfile = shortNameProfile(candidateName);
  const aliasScore = queryProfile.alias && candidateProfile.alias
    ? stringSimilarity(queryProfile.alias, candidateProfile.alias)
    : 0;
  const reasons = [];
  let score = rawScore;

  if (queryProfile.alias && candidateProfile.alias) {
    if (aliasScore >= 0.98) {
      score = Math.max(score, 72);
      reasons.push("同主体简称");
    } else if (aliasScore >= 0.75) {
      score = Math.max(score, 66 + Math.round(aliasScore * 20));
      reasons.push("简称高度相近");
    } else if (aliasScore >= 0.55) {
      score = Math.max(score, 40 + Math.round(aliasScore * 25));
      reasons.push("简称相近");
    } else {
      score = Math.min(score, 34);
    }
  }

  if (score >= 40 && queryProfile.year && queryProfile.year === candidateProfile.year) {
    score += 6;
    reasons.push("同发行年份");
  }
  if (score >= 45 && queryProfile.product && queryProfile.product === candidateProfile.product) {
    score += 8;
    reasons.push("同品种");
  }
  if (score >= 45 && Number.isFinite(queryProfile.serial) && Number.isFinite(candidateProfile.serial)) {
    const distance = Math.abs(queryProfile.serial - candidateProfile.serial);
    if (distance === 0) {
      score += 8;
      reasons.push("同期次");
    } else if (distance <= 2) {
      score += 6;
      reasons.push("期次相近");
    }
  }

  return { score: Math.min(100, score), reasons };
}

function shortNameProfile(value = "") {
  const normalized = normalizeLookupName(value);
  const yearMatch = normalized.match(/^(\d{2})(.+)$/);
  const year = yearMatch?.[1] || "";
  const body = yearMatch?.[2] || normalized;
  const productMatch = body.match(/^(.*?)(SCP|MTN|PPN|ABN|CP)(\d{1,4})([A-Z]?(?:\/[A-Z])?)?$/i);
  if (productMatch) {
    return {
      normalized,
      year,
      alias: productMatch[1],
      product: productMatch[2].toUpperCase(),
      serial: Number(productMatch[3]),
    };
  }

  const serialMatch = body.match(/^(.*?)(\d{1,4})([A-Z]?)$/i);
  if (serialMatch) {
    let alias = serialMatch[1];
    let product = "";
    const marker = alias.match(/^(.+?)([A-Z])$/i);
    if (marker) {
      alias = marker[1];
      product = marker[2].toUpperCase();
    }
    return {
      normalized,
      year,
      alias,
      product,
      serial: Number(serialMatch[2]),
    };
  }

  return { normalized, year, alias: body, product: "", serial: null };
}

function dmLookupSuggestionFromRow(row, score, reasons = []) {
  const scaleWan = numberFromRow(row, ["plan_issue_amount", "planIssueAmount"])
    ?? numberFromRow(row, ["actu_issue_amount", "actuIssueAmount"]);
  return {
    shortName: pickFirstString(row, ["sec_short_name", "secShortName"]),
    securityId: pickFirstString(row, ["security_id", "securityId"]),
    fullName: pickFirstString(row, ["sec_full_name", "secFullName"]),
    issuerName: pickFirstString(row, ["issuer_full_name", "issuerFullName", "issuer_name", "issuerName"]),
    tenor: pickFirstString(row, ["bond_issue_tenor", "bondIssueTenor", "bond_matu", "bondMatu"]),
    issueScaleYi: Number.isFinite(scaleWan) ? round(scaleWan / 10000, 4) : null,
    inquiryRange: normalizeInquiryRange(pickFirstString(row, ["subscribe_rate", "subscribeRate"])),
    subscribeDate: pickFirstDateString(row, ["subscribe_date", "subscribeDate", "issue_start_date", "issueStartDate"]),
    issueStatus: pickFirstString(row, ["issue_status_desc", "issueStatusDesc"]),
    score,
    matchReason: reasons.join("、"),
  };
}

function stringSimilarity(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  const minLength = Math.min(a.length, b.length);
  let score = 0;
  if (a.includes(b) || b.includes(a)) score = Math.max(score, 0.7 + (minLength / maxLength) * 0.2);
  score = Math.max(score, commonPrefixLength(a, b) / maxLength);
  score = Math.max(score, diceCoefficient(a, b));
  score = Math.max(score, 1 - levenshteinDistance(a, b) / maxLength);
  return Math.max(0, Math.min(1, score));
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function diceCoefficient(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return left[0] === right[0] ? 0.2 : 0;
  const counts = new Map();
  for (const item of a) counts.set(item, (counts.get(item) || 0) + 1);
  let overlap = 0;
  for (const item of b) {
    const count = counts.get(item) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(item, count - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function bigrams(value) {
  const chars = [...String(value || "")];
  if (chars.length < 2) return chars;
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
}

function levenshteinDistance(left, right) {
  const a = [...String(left || "")];
  const b = [...String(right || "")];
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

function normalizeDmLookup({ shortName, securityId, fullName, basic, primary, company }) {
  const basicRow = firstRow(basic);
  const primaryRow = bestPrimaryRow(primary, shortName, securityId, fullName);
  const companyRow = firstRow(company);
  const resolvedDuration = resolveDmDurationText(primaryRow, basicRow);
  const issuerName = pickFirstString(primaryRow, ["issuer_full_name", "issuerFullName"])
    || pickFirstString(basicRow, ["issuer_name", "issuerName"])
    || pickFirstString(companyRow, ["com_full_name", "comFullName"]);
  const societyCode = pickFirstString(primaryRow, ["society_code", "societyCode"])
    || pickFirstString(basicRow, ["society_code", "societyCode"])
    || pickFirstString(companyRow, ["society_code", "societyCode"]);
  const leadUnderwriter = pickFirstString(primaryRow, ["unde_name", "undeName"]);
  const scaleWan = numberFromRow(primaryRow, ["plan_issue_amount", "planIssueAmount"])
    ?? numberFromRow(primaryRow, ["actu_issue_amount", "actuIssueAmount"]);
  const scaleYi = Number.isFinite(scaleWan) ? round(scaleWan / 10000, 4) : numberFromRow(basicRow, ["actu_iss_amut", "actuIssAmut", "new_size", "newSize"]);
  const primarySecurityId = pickFirstString(primaryRow, ["security_id", "securityId"]);
  const basicSecurityId = pickFirstString(basicRow, ["security_id", "securityId"]);
  const resolvedShortName = pickFirstString(primaryRow, ["sec_short_name", "secShortName"])
    || pickFirstString(basicRow, ["sec_short_name", "secShortName"])
    || shortName;
  const absInfo = normalizeAbsLookupFields({ primaryRow, basicRow, companyRow, primaryRows: primary?.rows || [], query: { shortName, fullName } });
  const bondTypeDesc = pickFirstString(primaryRow, ["bond_type_desc", "bondTypeDesc"]) || pickFirstString(basicRow, ["bond_type_desc", "bondTypeDesc"]);
  const textForType = [resolvedShortName, fullName, pickFirstString(primaryRow, ["sec_full_name", "secFullName"]), pickFirstString(basicRow, ["sec_full_name", "secFullName"]), bondTypeDesc].join(" ");
  return {
    instrumentType: absInfo?.type || "",
    securityId: primarySecurityId || basicSecurityId || securityId,
    shortName: resolvedShortName,
    fullName: pickFirstString(primaryRow, ["sec_full_name", "secFullName"]) || pickFirstString(basicRow, ["sec_full_name", "secFullName"]),
    issuerName,
    societyCode,
    durationText: resolvedDuration.value,
    durationSource: resolvedDuration.source,
    specialItem: pickFirstString(basicRow, ["special_item", "specialItem"]),
    nextOptionDate: pickFirstDateString(basicRow, ["next_option_date", "nextOptionDate"]),
    issueScaleYi: scaleYi,
    inquiryRange: normalizeInquiryRange(pickFirstString(primaryRow, ["subscribe_rate", "subscribeRate"])),
    venue: pickFirstString(primaryRow, [
      "tender_market_desc", "tenderMarketDesc",
      "market_desc", "marketDesc",
      "exchange", "list_place", "listPlace",
      "listing_place", "listingPlace",
      "trade_place", "tradePlace",
    ])
      || inferVenue(primarySecurityId || basicSecurityId || securityId, resolvedShortName, bondTypeDesc),
    offeringType: pickFirstString(primaryRow, ["public_offering_status", "publicOfferingStatus"]),
    leadUnderwriter,
    sponsorStatus: inferSponsorStatus(leadUnderwriter),
    subscribeDate: pickFirstDateString(primaryRow, ["subscribe_date", "subscribeDate"]),
    subscribeTime: pickFirstString(primaryRow, ["subscribe_time", "subscribeTime"]),
    paymentDate: pickFirstDateString(primaryRow, ["pay_date", "payDate"]),
    issueStartDate: pickFirstDateString(primaryRow, ["issue_start_date", "issueStartDate"]) || pickFirstDateString(basicRow, ["iss_start_date", "issStartDate"]),
    issueEndDate: pickFirstDateString(primaryRow, ["issue_end_date", "issueEndDate"]) || pickFirstDateString(basicRow, ["iss_end_date", "issEndDate"]),
    subjectRating: pickRatingLike([basicRow, primaryRow, companyRow], "subject"),
    ratingAgency: pickRatingLike([basicRow, primaryRow, companyRow], "agency"),
    impliedRating: pickRatingLike([basicRow, primaryRow, companyRow], "implied"),
    absInfo,
    isAbs: Boolean(absInfo || isAbsLookupText(textForType)),
  };
}

function normalizeAbsLookupFields({ primaryRow = {}, basicRow = {}, companyRow = {}, primaryRows = [], query = {} }) {
  const rows = [primaryRow, basicRow, companyRow, ...primaryRows].filter(Boolean);
  const allText = [
    query.shortName,
    query.fullName,
    ...rows.map(rowAbsSearchText),
  ].filter(Boolean).join(" ");
  if (!isAbsLookupText(allText)) return null;

  const planName = normalizeAbsPlanName(
    pickFirstStringFromRows(rows, [
      "special_plan_name", "specialPlanName",
      "asset_support_plan_name", "assetSupportPlanName",
      "plan_name", "planName",
      "product_full_name", "productFullName",
      "asset_plan_name", "assetPlanName",
      "sec_full_name", "secFullName",
      "bond_full_name", "bondFullName",
    ]) || query.fullName,
  );
  const totalScale = dmAmountYiFromRows(rows, [
    "total_issue_amount", "totalIssueAmount",
    "total_plan_issue_amount", "totalPlanIssueAmount",
    "total_actu_issue_amount", "totalActuIssueAmount",
    "issue_amount", "issueAmount",
    "product_scale", "productScale",
    "plan_scale", "planScale",
  ]);
  const underlyingAsset = pickTextByKeyHints(rows, [/underlying.*asset/i, /base.*asset/i, /basic.*asset/i, /asset.*pool/i, /asset.*type/i, /基础资产/, /底层资产/, /资产池/]);
  const differencePaymentCommitter = pickTextByKeyHints(rows, [/difference.*payment/i, /deficien/i, /差额支付/, /差补/, /差额补足/]);
  const liquiditySupportCommitter = pickTextByKeyHints(rows, [/liquidity.*support/i, /liquidity.*provider/i, /流动性支持/, /流动性承诺/]);
  const creditEnhancementParty = differencePaymentCommitter || liquiditySupportCommitter
    || pickTextByKeyHints(rows, [/credit.*enhance/i, /enhancement.*party/i, /增信.*(主体|机构|方|人)/]);
  const creditEnhancementType = differencePaymentCommitter
    ? "差额支付承诺人"
    : liquiditySupportCommitter
      ? "流动性支持承诺人"
      : creditEnhancementParty
        ? "增信主体"
        : "";

  return {
    type: /ABN|资产支持票据/i.test(allText) ? "ABN" : "ABS",
    planName,
    totalScale,
    underlyingAsset,
    creditEnhancementType,
    creditEnhancementParty,
    differencePaymentCommitter,
    liquiditySupportCommitter,
    bookDate: pickFirstDateStringFromRows(rows, ["subscribe_date", "subscribeDate", "book_date", "bookDate", "issue_start_date", "issueStartDate"]),
    selectedClass: extractAbsTrancheLevel(primaryRow) || "",
    source: "dm",
  };
}

function rowAbsSearchText(row = {}) {
  return [
    pickFirstString(row, ["sec_short_name", "secShortName"]),
    pickFirstString(row, ["sec_full_name", "secFullName"]),
    pickFirstString(row, ["bond_full_name", "bondFullName"]),
    pickFirstString(row, ["bond_type_desc", "bondTypeDesc"]),
    pickFirstString(row, ["security_type_desc", "securityTypeDesc"]),
    pickFirstString(row, ["product_full_name", "productFullName"]),
    pickFirstString(row, ["special_plan_name", "specialPlanName"]),
    pickFirstString(row, ["asset_support_plan_name", "assetSupportPlanName"]),
  ].filter(Boolean).join(" ");
}

function isAbsLookupText(value = "") {
  return /(?:\bABS\b|\bABN\b|资产支持|专项计划|资产支持票据|资产支持证券|优先[ABC]?\d*级|次级|劣后)/i.test(String(value || ""));
}

function normalizeAbsPlanName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .replace(/\s+/g, "")
    .replace(/[（(]\s*(?:优先|次级|劣后|夹层)[^)）]*[)）]$/u, "")
    .replace(/(?:优先[ABC]?\d*级?|优先级|次级|劣后级?|夹层级?)(?:资产支持(?:证券|票据))?$/u, "")
    .replace(/(?:资产支持证券|资产支持票据)(?:优先[ABC]?\d*级?|优先级|次级|劣后级?|夹层级?)$/u, "资产支持证券")
    .trim();
}

function normalizeAbsPlanComparable(value = "") {
  return normalizeFullNameForLookup(normalizeAbsPlanName(value));
}

function pickFirstStringFromRows(rows, keys) {
  for (const row of rows || []) {
    const value = pickFirstString(row, keys);
    if (value) return value;
  }
  return "";
}

function pickFirstDateStringFromRows(rows, keys) {
  for (const row of rows || []) {
    const value = pickFirstDateString(row, keys);
    if (value) return value;
  }
  return "";
}

function dmAmountYiFromRows(rows, keys) {
  for (const row of rows || []) {
    const value = dmAmountYiFromRow(row, keys);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function dmAmountYiFromRow(row, keys) {
  for (const key of keys) {
    const raw = row?.[key];
    const value = numberOrNull(raw);
    if (!Number.isFinite(value)) continue;
    return amountKeyLooksYi(key) ? round(value, 4) : round(value / 10000, 4);
  }
  return null;
}

function amountKeyLooksYi(key = "") {
  return /(Yi|_yi|亿元|billion|amount_yi|scale_yi)$/i.test(String(key || ""));
}

function pickTextByKeyHints(rows, patterns) {
  for (const row of rows || []) {
    for (const item of flattenDmValues(row)) {
      const key = String(item.key || "");
      const value = String(item.value ?? "").trim();
      if (!value || value.length > 500) continue;
      if (patterns.some((pattern) => pattern.test(key))) return value;
    }
  }
  return "";
}

function extractAbsTrancheLevel(row = {}) {
  const explicit = pickFirstString(row, [
    "tranche_level", "trancheLevel",
    "priority_level", "priorityLevel",
    "security_level", "securityLevel",
    "class_name", "className",
    "bond_level", "bondLevel",
    "debt_level", "debtLevel",
  ]);
  const source = explicit || [
    pickFirstString(row, ["sec_short_name", "secShortName"]),
    pickFirstString(row, ["sec_full_name", "secFullName"]),
    pickFirstString(row, ["bond_full_name", "bondFullName"]),
  ].filter(Boolean).join(" ");
  const match = String(source || "").match(/(优先[ABC]?\d*级?|优先级|次级|劣后级?|夹层级?)/i);
  if (match?.[1] || explicit) return (match?.[1] || explicit || "").replace(/级?$/, (value) => value ? "级" : "").trim();
  const shortName = pickFirstString(row, ["sec_short_name", "secShortName"]);
  const suffix = String(shortName || "").match(/(?:\d)(A\d?|B\d?|C\d?)$/i)?.[1];
  return absClassNameFromShortSuffix(suffix);
}

function absClassNameFromShortSuffix(suffix = "") {
  const value = String(suffix || "").toUpperCase();
  if (value === "A") return "优先A1级";
  if (value === "B") return "优先A2级";
  if (value === "C") return "次级";
  if (/^A\d+$/.test(value)) return `优先${value}级`;
  if (/^[BC]\d+$/.test(value)) return `优先${value}级`;
  return "";
}

function pickAbsDebtRating(row = {}) {
  const direct = pickFirstString(row, [
    "bond_rating", "bondRating",
    "debt_rating", "debtRating",
    "credit_rating", "creditRating",
    "security_rating", "securityRating",
    "tranche_rating", "trancheRating",
  ]);
  const parsed = parseRatingWithAgency(direct);
  if (parsed.rating) return parsed.rating;
  for (const item of flattenDmValues(row)) {
    const key = String(item.key || "");
    if (/subject|issuer|main|主体|发行人/i.test(key)) continue;
    if (!/(bond|debt|credit|security|tranche|rating|grade|债项|信用|评级|级别|等级)/i.test(key)) continue;
    const rating = parseRatingWithAgency(item.value).rating;
    if (rating) return rating;
  }
  return "";
}

function pickAbsDebtRatingAgency(row = {}) {
  const direct = pickFirstString(row, [
    "bond_rating_agency", "bondRatingAgency",
    "debt_rating_agency", "debtRatingAgency",
    "credit_rating_agency", "creditRatingAgency",
    "rating_agency", "ratingAgency",
    "agency_name", "agencyName",
  ]);
  const parsed = parseRatingWithAgency(direct);
  if (parsed.agency) return parsed.agency;
  return direct && !ratingValuePattern().test(direct) ? direct : "";
}

function resolveDmDurationText(primaryRow, basicRow) {
  const primaryTenor = pickFirstString(primaryRow, ["bond_issue_tenor", "bondIssueTenor"]);
  const basicTenor = pickFirstString(basicRow, ["bond_matu", "bondMatu"]);
  const specialItem = pickFirstString(basicRow, ["special_item", "specialItem"]);
  const unit = dmTenorUnit(primaryTenor) || dmTenorUnit(basicTenor) || "Y";
  const explicitOptionTenor = normalizeDmOptionTenor(basicTenor, unit)
    || normalizeDmOptionTenor(specialItem, unit);
  if (explicitOptionTenor) return { value: explicitOptionTenor, source: basicTenor && normalizeDmOptionTenor(basicTenor, unit) ? "bond_matu" : "special_item" };

  const inferred = inferDmOptionTenorFromDates(primaryTenor, primaryRow, basicRow);
  if (inferred) return { value: inferred, source: "next_option_date" };
  if (primaryTenor) return { value: primaryTenor, source: "bond_issue_tenor" };
  if (basicTenor) return { value: basicTenor, source: "bond_matu" };
  return { value: "", source: "" };
}

function normalizeDmOptionTenor(value = "", fallbackUnit = "Y") {
  const text = String(value || "")
    .replace(/＋/g, "+")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!text || !text.includes("+")) return "";
  const match = text.match(/(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?){1,})(D|M|Y|天|月|年)?(?:期)?/i);
  if (!match) return "";
  const unit = match[2] || fallbackUnit || "Y";
  return `${match[1]}${unit.toUpperCase()}`;
}

function dmTenorUnit(value = "") {
  const unit = String(value || "").trim().match(/(D|M|Y|天|月|年)(?:期)?$/i)?.[1] || "";
  return unit ? unit.toUpperCase() : "";
}

function inferDmOptionTenorFromDates(primaryTenor, primaryRow, basicRow) {
  const finalYears = simpleDmTenorYears(primaryTenor);
  if (!Number.isFinite(finalYears) || finalYears <= 0) return "";
  const optionDate = pickFirstDateString(basicRow, ["next_option_date", "nextOptionDate"]);
  const startDate = pickFirstDateString(primaryRow, ["issue_start_date", "issueStartDate", "subscribe_date", "subscribeDate"])
    || pickFirstDateString(basicRow, ["iss_start_date", "issStartDate", "inte_start_date", "inteStartDate"]);
  const firstYears = yearsBetweenLocalDates(startDate, optionDate);
  if (!Number.isFinite(firstYears) || firstYears <= 0 || firstYears >= finalYears) return "";
  const first = roundToReasonableTenor(firstYears);
  const remaining = roundToReasonableTenor(finalYears - first);
  if (!Number.isFinite(first) || !Number.isFinite(remaining) || remaining <= 0) return "";
  return `${formatTenorNumber(first)}+${formatTenorNumber(remaining)}Y`;
}

function simpleDmTenorYears(value = "") {
  const match = String(value || "").trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(Y|年)$/i);
  return match ? Number(match[1]) : null;
}

function yearsBetweenLocalDates(start, end) {
  if (!start || !end) return null;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return (endDate.getTime() - startDate.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

function roundToReasonableTenor(value) {
  if (!Number.isFinite(value)) return null;
  const nearestHalf = Math.round(value * 2) / 2;
  return Math.abs(value - nearestHalf) < 0.08 ? nearestHalf : round(value, 2);
}

function formatTenorNumber(value) {
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

async function lookupDmRatingDiscovery(dm, { normalized, basic, primary, company }, { includeImplied = true } = {}) {
  const sources = [
    { name: "basicInfo", raw: basic.raw, rows: basic.rows || [] },
    { name: "primaryData", raw: primary.raw, rows: primary.rows || [] },
    { name: "companyInfo", raw: company?.raw || null, rows: company?.rows || [] },
  ];
  const errors = [];
  const initial = extractRatingsFromDmSources(sources, { includeImplied });
  if (ratingsComplete({ ...normalized, ...initial.values }, { includeImplied })) return { ...initial, sources, errors };

  const issuerName = normalized?.issuerName || pickFirstString(firstRow(basic), ["issuer_name", "issuerName"]);
  const societyCode = pickFirstString(firstRow(basic), ["society_code", "societyCode"])
    || pickFirstString(firstRow(company), ["society_code", "societyCode"]);
  const outstandingPayloads = [];
  if (issuerName) outstandingPayloads.push({ issuerFullName: issuerName });
  if (societyCode) outstandingPayloads.push({ societyCode });

  for (const payload of outstandingPayloads) {
    const sourceName = payload.issuerFullName ? "outstandingBondsByIssuer" : "outstandingBondsBySocietyCode";
    try {
      const raw = await dm.post(OUTSTANDING_BONDS_PATH, payload);
      const source = { name: sourceName, raw, rows: rowsFromDm(raw) };
      sources.push(source);
      const discovered = extractRatingsFromDmSources(sources, { includeImplied });
      if (ratingsComplete({ ...normalized, ...discovered.values }, { includeImplied })) {
        return { ...discovered, sources, errors };
      }
    } catch (error) {
      errors.push({
        source: sourceName,
        payloadKeys: Object.keys(payload),
        error: error.message || "DM rating discovery failed",
      });
    }
  }

  return { ...extractRatingsFromDmSources(sources, { includeImplied }), sources, errors };
}

function extractRatingsFromDmSources(sources, { includeImplied = true } = {}) {
  const values = {};
  const matches = {};
  for (const source of sources) {
    for (const row of rowsFromDm(source.rows)) {
      for (const item of flattenDmValues(row)) {
        applyRatingCandidate(values, matches, item, source.name, { includeImplied });
        if (ratingsComplete(values, { includeImplied })) return { values, matches };
      }
    }
  }
  return { values, matches };
}

function flattenDmValues(value, path = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenDmValues(item, path ? `${path}[${index}]` : `[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => flattenDmValues(child, path ? `${path}.${key}` : key));
  }
  return [{ key: path.split(".").pop() || path, path, value }];
}

function applyRatingCandidate(values, matches, item, source, { includeImplied = true } = {}) {
  const keyText = String(item.key || "");
  const path = item.path || keyText;
  const valueText = String(item.value ?? "").trim();
  if (!valueText) return;

  const ratingWithAgency = parseRatingWithAgency(valueText);
  if (!values.subjectRating && ratingWithAgency.rating && ratingKeyMatches(keyText, "subject")) {
    values.subjectRating = ratingWithAgency.rating;
    matches.subjectRating = { source, path, value: valueText };
  }
  if (!values.ratingAgency && ratingWithAgency.agency && ratingKeyMatches(keyText, "subject")) {
    values.ratingAgency = ratingWithAgency.agency;
    matches.ratingAgency = { source, path, value: valueText };
  }
  if (!values.ratingAgency && ratingKeyMatches(keyText, "agency") && !ratingValuePattern().test(valueText)) {
    values.ratingAgency = valueText;
    matches.ratingAgency = { source, path, value: valueText };
  }
  if (includeImplied && !values.impliedRating && ratingWithAgency.rating && ratingKeyMatches(keyText, "implied")) {
    values.impliedRating = ratingWithAgency.rating;
    matches.impliedRating = { source, path, value: valueText };
  }
}

function ratingKeyMatches(key, kind) {
  const text = String(key || "");
  const patterns = {
    subject: [
      /subject.*rating/i,
      /issuer.*rating/i,
      /main.*rating/i,
      /credit.*rating/i,
      /rating.*level/i,
      /主体.*评/i,
      /发行人.*评/i,
      /信用.*评/i,
    ],
    agency: [
      /rating.*agency/i,
      /agency/i,
      /rating.*(?:org|inst)/i,
      /(?:org|inst).*rating/i,
      /评.*机构/i,
      /评级.*公司/i,
    ],
    implied: [
      /implied/i,
      /hidden.*rating/i,
      /market.*rating/i,
      /cbc.*rating/i,
      /隐含/i,
      /中债.*评/i,
      /市场.*评/i,
    ],
  }[kind] || [];
  return patterns.some((pattern) => pattern.test(text));
}

function parseRatingWithAgency(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:^|[^A-Z0-9])(AAA|AA\+|AA\(2\)|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|B)(?:\s*[\(（]\s*([^)）]+?)\s*[\)）])?/i);
  return {
    rating: match?.[1]?.toUpperCase() || "",
    agency: match?.[2]?.trim() || "",
  };
}

function ratingValuePattern() {
  return /^(?:AAA|AA\+|AA\(2\)|AA-|AA|A\+|A-|A|BBB\+|BBB-|BBB|BB\+|BB-|BB|B\+|B-|B)$/i;
}

function ratingsComplete(value, { includeImplied = true } = {}) {
  return Boolean(value?.subjectRating && value?.ratingAgency && (!includeImplied || value?.impliedRating));
}

function applyDmRatingDiscovery(normalized, discovery) {
  const values = discovery?.values || {};
  const next = { ...normalized };
  const ratingSource = { ...(next.ratingSource || {}) };
  for (const [field, value] of Object.entries(values)) {
    if (!next[field] && value) {
      next[field] = value;
      ratingSource[field] = "dm-discovery";
    }
  }
  if (Object.keys(ratingSource).length) next.ratingSource = ratingSource;
  return next;
}

function applyWindImpliedRating(normalized, windResult, enabled) {
  if (!enabled) return normalized;
  const next = {
    ...normalized,
    impliedRating: "",
    impliedRatingAsOf: "",
  };
  const ratingSource = { ...(next.ratingSource || {}) };
  delete ratingSource.impliedRating;
  if (windResult?.status === "ok" && windResult.rating) {
    next.impliedRating = String(windResult.rating).trim().toUpperCase();
    next.impliedRatingAsOf = String(windResult.asOf || "").trim();
    ratingSource.impliedRating = "wind-analytics";
  }
  if (Object.keys(ratingSource).length) next.ratingSource = ratingSource;
  else delete next.ratingSource;
  return next;
}

async function readD1AppState(db, userId = "admin") {
  if (!db) return null;
  try {
    const result = await readUserAppState(db, userId);
    const hasUserData = result?.updatedAt
      || (Array.isArray(result?.data?.issuers) && result.data.issuers.length)
      || (Array.isArray(result?.data?.projects) && result.data.projects.length);
    if (hasUserData) return result.data;
  } catch {
    try {
      const row = await db.prepare("SELECT data FROM app_state WHERE id = 1").first();
      return row?.data ? JSON.parse(row.data) : null;
    } catch {
      return null;
    }
  }
  try {
    const row = await db.prepare("SELECT data FROM app_state WHERE id = 1").first();
    return row?.data ? JSON.parse(row.data) : null;
  } catch {
    return null;
  }
}

function lookupIssuerRatingFallback(data, normalized) {
  if (!data) return null;
  if (normalized?.subjectRating && normalized?.ratingAgency && normalized?.impliedRating) return null;
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const project = matchProjectForRating(normalized, projects);
  if (project) return project;
  const issuers = Array.isArray(data?.issuers) ? data.issuers : [];
  return matchIssuerForRating(normalized, issuers);
}

function matchProjectForRating(normalized, projects) {
  const querySecurityId = normalizeSecurityId(normalized?.securityId);
  const queryNames = uniqueStrings([normalized?.shortName, normalized?.fullName])
    .map((value) => ({ raw: value, normalized: normalizeIssuerMatchText(value) }));
  const issuerTargets = uniqueStrings([normalized?.issuerName, normalized?.fullName])
    .map((value) => ({ raw: value, normalized: normalizeIssuerMatchText(value) }));

  let best = null;
  for (const project of projects) {
    const ratingFields = projectRatingFields(project);
    if (!projectHasAnyRating(ratingFields)) continue;
    const codeScore = querySecurityId && projectSecurityIds(project).some((value) => securityIdMatches(value, querySecurityId)) ? 120 : 0;
    const nameScore = projectShortNames(project).reduce((score, name) => {
      const normalizedName = normalizeIssuerMatchText(name);
      const matched = queryNames.reduce((innerScore, target) => Math.max(innerScore, issuerMatchScore(normalizedName, target.normalized)), 0);
      return Math.max(score, matched);
    }, 0);
    const issuerScore = uniqueStrings([project.issuerName]).reduce((score, name) => {
      const normalizedName = normalizeIssuerMatchText(name);
      const matched = issuerTargets.reduce((innerScore, target) => Math.max(innerScore, issuerMatchScore(normalizedName, target.normalized)), 0);
      return Math.max(score, matched);
    }, 0);
    const score = Math.max(codeScore, nameScore, issuerScore > 0 ? issuerScore - 20 : 0);
    if (score > (best?.score || 0)) best = { project, ratingFields, score };
  }

  if (!best?.project) return null;
  return {
    subjectRating: best.ratingFields.subjectRating || "",
    ratingAgency: best.ratingFields.ratingAgency || "",
    hiddenRating: best.ratingFields.hiddenRating || "",
    legalName: best.project.issuerName || "",
    matchedBy: best.project.shortName || "",
    matchedTarget: normalized?.shortName || normalized?.securityId || "",
    matchedRecordType: "project",
  };
}

function projectHasAnyRating(project) {
  return Boolean(project?.subjectRating || project?.ratingAgency || project?.hiddenRating || project?.impliedRating);
}

function projectRatingFields(project) {
  const parsed = parseProjectRatingText(`${project?.sourceText || ""}\n${project?.opinion || ""}\n${project?.notes || ""}`);
  return {
    subjectRating: String(project?.subjectRating || parsed.subjectRating || "").trim().toUpperCase(),
    ratingAgency: String(project?.ratingAgency || parsed.ratingAgency || "").trim(),
    hiddenRating: String(project?.hiddenRating || project?.impliedRating || parsed.hiddenRating || "").trim().toUpperCase(),
  };
}

function parseProjectRatingText(text = "") {
  const value = String(text || "");
  const ratingPattern = "(AAA|AA\\+|AA\\(2\\)|AA-|AA|A\\+|A-|A|BBB\\+|BBB-|BBB|BB\\+|BB-|BB|B\\+|B-|B)";
  const compact = value.match(new RegExp(`${ratingPattern}\\s*[（(]\\s*([^）)\\n]+?)\\s*[）)]\\s*[/／]\\s*隐含\\s*${ratingPattern}`, "i"));
  if (compact) {
    return {
      subjectRating: compact[1].toUpperCase(),
      ratingAgency: compact[2].trim(),
      hiddenRating: compact[3].toUpperCase(),
    };
  }
  const subject = value.match(new RegExp(`主体(?:信用)?评级(?:为|[:：\\s])*${ratingPattern}(?:\\s*[（(]\\s*([^）)\\n]+?)\\s*[）)])?`, "i"));
  const agency = value.match(/评级机构(?:为|[:：\s])*([^\s,，;；/／。]+)/);
  const hidden = value.match(new RegExp(`(?:隐含|市场隐含评级)(?:评级)?(?:为|[:：\\s])*${ratingPattern}`, "i"));
  return {
    subjectRating: subject?.[1]?.toUpperCase() || "",
    ratingAgency: subject?.[2]?.trim() || agency?.[1]?.trim() || "",
    hiddenRating: hidden?.[1]?.toUpperCase() || "",
  };
}

function projectSecurityIds(project) {
  return uniqueStrings([
    project?.securityId,
    project?.security_id,
    project?.bondCode,
    project?.code,
    ...(project?.tranches || []).flatMap((tranche) => [tranche.securityId, tranche.security_id, tranche.bondCode, tranche.code]),
  ]);
}

function projectShortNames(project) {
  return uniqueStrings([
    project?.shortName,
    ...(project?.shortNames || []),
    ...(project?.tranches || []).map((tranche) => tranche.shortName),
  ]);
}

function matchIssuerForRating(normalized, issuers) {
  const targets = uniqueStrings([
    normalized?.issuerName,
    normalized?.fullName,
    normalized?.shortName,
  ]).map((value) => ({ raw: value, normalized: normalizeIssuerMatchText(value) }));

  let best = null;
  for (const issuer of issuers) {
    const names = uniqueStrings([issuer?.legalName, ...(issuer?.aliases || [])]);
    for (const name of names) {
      const normalizedName = normalizeIssuerMatchText(name);
      if (!normalizedName) continue;
      for (const target of targets) {
        const score = issuerMatchScore(normalizedName, target.normalized);
        if (score > (best?.score || 0)) best = { issuer, matchedBy: name, matchedTarget: target.raw, score };
      }
    }
  }
  return best?.issuer ? { ...best.issuer, matchedBy: best.matchedBy, matchedTarget: best.matchedTarget, matchedRecordType: "issuer" } : null;
}

function issuerMatchScore(name, target) {
  if (!name || !target) return 0;
  if (name === target) return 100 + name.length;
  if (name.length >= 4 && target.includes(name)) return 80 + name.length;
  if (target.length >= 4 && name.includes(target)) return 60 + target.length;
  const coreName = issuerCoreMatchText(name);
  const coreTarget = issuerCoreMatchText(target);
  if (coreName && coreTarget) {
    if (coreName === coreTarget) return 90 + coreName.length;
    if (coreName.length >= 4 && coreTarget.includes(coreName)) return 70 + coreName.length;
    if (coreTarget.length >= 4 && coreName.includes(coreTarget)) return 50 + coreTarget.length;
  }
  return 0;
}

function normalizeIssuerMatchText(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]{}]/g, "")
    .toUpperCase();
}

function issuerCoreMatchText(value = "") {
  let text = normalizeIssuerMatchText(value);
  const suffixes = [
    "股份有限公司",
    "有限责任公司",
    "责任有限公司",
    "集团有限公司",
    "有限公司",
    "股份公司",
    "集团公司",
    "控股公司",
    "公司",
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (text.endsWith(suffix) && text.length - suffix.length >= 4) {
        text = text.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return text;
}

function applyIssuerRatingFallback(normalized, issuer) {
  if (!issuer) return normalized;
  const next = { ...normalized };
  const ratingSource = { ...(next.ratingSource || {}) };
  if (!next.subjectRating && issuer.subjectRating) {
    next.subjectRating = String(issuer.subjectRating).trim().toUpperCase();
    ratingSource.subjectRating = "issuer-db";
  }
  if (!next.ratingAgency && issuer.ratingAgency) {
    next.ratingAgency = String(issuer.ratingAgency).trim();
    ratingSource.ratingAgency = "issuer-db";
  }
  if (!next.impliedRating && issuer.hiddenRating) {
    next.impliedRating = String(issuer.hiddenRating).trim().toUpperCase();
    ratingSource.impliedRating = "issuer-db";
  }
  if (Object.keys(ratingSource).length) next.ratingSource = ratingSource;
  return next;
}

function lookupIssueGroup(data, normalized, query, primary, basic) {
  const dmGroup = buildIssueGroupFromDmRows(normalized, query, primary, basic);
  let dbGroup = null;
  if (data) {
    const projects = Array.isArray(data?.projects) ? data.projects : [];
    dbGroup = buildIssueGroupFromProjects(normalized, query, projects);
  }
  const group = mergeIssueGroups(dbGroup, dmGroup) || dbGroup || dmGroup;
  const annotatedGroup = annotateIssueGroupReallocationTargets(group);
  return shouldExposeIssueGroup(annotatedGroup, query, normalized) ? annotatedGroup : null;
}

function buildIssueGroupFromProjects(normalized, query, projects) {
  const targets = issueGroupTargets(normalized, query);
  let best = null;
  for (const project of projects || []) {
    const entries = projectIssueEntries(project);
    if (!entries.length) continue;
    const score = projectIssueGroupScore(project, entries, targets);
    if (score > (best?.score || 0)) best = { project, entries, score };
  }
  if (!best || best.score < 90) return null;
  const group = issueGroupFromProject(best.project, best.entries, targets, best.score);
  return group?.tranches?.length ? group : null;
}

function projectIssueGroupScore(project, entries, targets) {
  let score = 0;
  const projectIssuer = normalizeIssuerMatchText(project?.issuerName || "");
  const issuerScore = targets.issuerTargets.reduce((maxScore, target) =>
    Math.max(maxScore, issuerMatchScore(projectIssuer, normalizeIssuerMatchText(target))), 0);
  for (const entry of entries) {
    const entrySecurityId = normalizeSecurityId(entry.securityId);
    if (entrySecurityId && targets.securityIds.some((target) => securityIdMatches(entrySecurityId, target))) score = Math.max(score, 160);
    const entryName = normalizeLookupName(entry.shortName);
    if (entryName && targets.names.some((target) => normalizeLookupName(target) === entryName)) score = Math.max(score, 140);
    const entryFamily = issueShortNameFamily(entry.shortName);
    if (entryFamily && targets.families.includes(entryFamily) && issuerScore >= 80) score = Math.max(score, 95);
    const entrySeriesKey = issueShortNameSeriesKey(entry.shortName);
    if (entrySeriesKey && targets.seriesKeys.includes(entrySeriesKey) && issuerScore >= 80) score = Math.max(score, 95);
  }
  if (issuerScore >= 90 && targets.names.some((name) => projectFullText(project).includes(normalizeLookupName(name)))) score = Math.max(score, 92);
  return score;
}

function issueGroupFromProject(project, entries, targets, score) {
  const finalEntries = sortIssueEntries(entries).map((entry) => ({
    ...entry,
    isQueriedInput: entryMatchesTargets(entry, targets.inputNames, targets.inputSecurityIds),
    isDmMatched: entryMatchesTargets(entry, targets.normalizedNames, targets.normalizedSecurityIds),
  }));
  const groupHasIssued = finalEntries.some((entry) => entryHasIssuedFields(entry));
  const projectResultConfirmed = Boolean(project?.resultConfirmed);
  const tranches = finalEntries.map((entry, index) => {
    const status = inferIssueTrancheStatus(entry, { groupHasIssued, projectResultConfirmed });
    return cleanIssueTranche({
      shortName: entry.shortName || `${project?.shortName || "品种"}-${index + 1}`,
      securityId: entry.securityId || "",
      fullName: "",
      tenor: entry.durationText || "",
      planScale: entry.planScale,
      actualScale: entry.actualScale,
      inquiryRange: formatIssueGroupRange(entry.inquiryLow, entry.inquiryHigh),
      couponRate: entry.couponRate,
      status,
      statusReason: issueTrancheStatusReason(status),
      source: "cloud-db",
      isQueriedInput: entry.isQueriedInput,
      isDmMatched: entry.isDmMatched,
    });
  });
  return {
    groupId: project?.id || issueGroupIdFromParts(project?.issuerName, project?.shortName),
    source: "cloud-db",
    confidence: Math.min(99, Math.max(90, score)),
    issuerName: project?.issuerName || "",
    issueName: project?.shortName || "",
    subscribeDate: project?.cutoffAt?.slice(0, 10) || "",
    venue: project?.venue || "",
    leadUnderwriter: project?.leadUnderwriter || "",
    queriedInput: targets.inputNames[0] || targets.inputSecurityIds[0] || "",
    tranches,
  };
}

function buildIssueGroupFromDmRows(normalized, query, primary, basic) {
  const rows = uniqueRowsByKey([
    ...rowsFromDm(primary?.raw),
    ...rowsFromDm(basic?.raw),
  ]);
  if (!rows.length) return null;
  if (normalized?.isAbs || normalized?.absInfo) {
    const absGroup = buildAbsIssueGroupFromDmRows(normalized, query, rows);
    if (absGroup) return absGroup;
  }
  const targets = issueGroupTargets(normalized, query);
  const issuerTarget = normalizeIssuerMatchText(normalized?.issuerName || "");
  const subscribeDate = normalized?.subscribeDate || "";
  const candidates = rows.filter((row) => {
    const rowNames = rowShortNames(row);
    const rowNameMatch = rowNames.map((name) => issueNameGroupMatchType(name, targets)).find(Boolean);
    if (!rowNameMatch) return false;
    const rowIssuer = normalizeIssuerMatchText(pickFirstString(row, ["issuer_full_name", "issuerFullName", "issuer_name", "issuerName"]));
    const issuerMatched = Boolean(issuerTarget && rowIssuer && issuerMatchScore(rowIssuer, issuerTarget) >= 90);
    if (rowNameMatch === "series" && !issuerMatched) return false;
    if (issuerTarget && rowIssuer && issuerMatchScore(rowIssuer, issuerTarget) < 90) return false;
    const rowDate = pickFirstDateString(row, ["subscribe_date", "subscribeDate", "issue_start_date", "issueStartDate"]);
    if (subscribeDate && rowDate && rowDate !== subscribeDate) return false;
    return true;
  });
  const entries = sortIssueEntries(uniqueIssueEntries(candidates.map(dmRowIssueEntry).filter((entry) => entry.shortName || entry.securityId)))
    .map((entry) => entryMatchesTargets(entry, targets.normalizedNames, targets.normalizedSecurityIds) && normalized?.durationText
      ? { ...entry, durationText: normalized.durationText }
      : entry);
  if (entries.length < 2) return null;
  return {
    groupId: issueGroupIdFromParts(normalized?.issuerName, entries[0]?.shortName || normalized?.shortName),
    source: "dm",
    confidence: 86,
    issuerName: normalized?.issuerName || "",
    issueName: issueShortNameFamily(entries[0]?.shortName || normalized?.shortName) || normalized?.shortName || "",
    subscribeDate: normalized?.subscribeDate || "",
    venue: normalized?.venue || "",
    leadUnderwriter: normalized?.leadUnderwriter || "",
    queriedInput: query?.shortName || query?.securityId || query?.fullName || "",
    tranches: entries.map((entry) => cleanIssueTranche({
      shortName: entry.shortName,
      securityId: entry.securityId,
      fullName: entry.fullName,
      tenor: entry.durationText,
      planScale: entry.planScale,
      actualScale: entry.actualScale,
      inquiryRange: entry.inquiryRange,
      couponRate: entry.couponRate,
      status: inferIssueTrancheStatus(entry, { groupHasIssued: entries.some(entryHasIssuedFields), projectResultConfirmed: false }),
      statusReason: issueTrancheStatusReason(inferIssueTrancheStatus(entry, { groupHasIssued: entries.some(entryHasIssuedFields), projectResultConfirmed: false })),
      source: "dm",
      isQueriedInput: entryMatchesTargets(entry, targets.inputNames, targets.inputSecurityIds),
      isDmMatched: entryMatchesTargets(entry, targets.normalizedNames, targets.normalizedSecurityIds),
    })),
  };
}

function dmRowIssueEntry(row) {
  const planWan = numberFromRow(row, ["plan_issue_amount", "planIssueAmount"]);
  const actualWan = numberFromRow(row, ["actu_issue_amount", "actuIssueAmount", "actu_iss_amut", "actuIssAmut", "new_size", "newSize"]);
  const couponRate = numberFromRow(row, ["coupon_rate", "couponRate", "issue_rate", "issueRate", "winning_rate", "winningRate"]);
  return {
    shortName: pickFirstString(row, ["sec_short_name", "secShortName"]),
    securityId: pickFirstString(row, ["security_id", "securityId"]),
    fullName: pickFirstString(row, ["sec_full_name", "secFullName"]),
    durationText: pickFirstString(row, ["bond_issue_tenor", "bondIssueTenor", "bond_matu", "bondMatu"]),
    planScale: Number.isFinite(planWan) ? round(planWan / 10000, 4) : null,
    actualScale: Number.isFinite(actualWan) ? round(actualWan / 10000, 4) : null,
    inquiryRange: normalizeInquiryRange(pickFirstString(row, ["subscribe_rate", "subscribeRate"])),
    couponRate,
    trancheLevel: extractAbsTrancheLevel(row),
    sharePct: numberFromRow(row, ["issue_ratio", "issueRatio", "scale_ratio", "scaleRatio", "tranche_ratio", "trancheRatio", "ratio", "shareRatio"]),
    expectedMaturityDate: pickAbsExpectedMaturityDate(row),
    debtRating: pickAbsDebtRating(row),
    debtRatingAgency: pickAbsDebtRatingAgency(row),
  };
}

function pickAbsExpectedMaturityDate(row = {}) {
  const direct = pickFirstDateString(row, [
    "expected_maturity_date", "expectedMaturityDate",
    "exp_matu_date", "expMatuDate",
    "expected_due_date", "expectedDueDate",
    "expected_end_date", "expectedEndDate",
    "pre_maturity_date", "preMaturityDate",
    "plan_maturity_date", "planMaturityDate",
    "est_maturity_date", "estMaturityDate",
    "maturity_date", "maturityDate",
    "due_date", "dueDate",
    "expire_date", "expireDate",
    "end_date", "endDate",
  ]);
  if (direct) return direct;
  for (const item of flattenDmValues(row)) {
    const key = String(item.key || "");
    if (!/(expected|expect|exp|pre|plan|maturity|matu|due|expire|兑付|到期|预期)/i.test(key)) continue;
    const text = formatDmDate(item.value);
    if (/\d{4}-\d{2}-\d{2}/.test(text)) return text;
  }
  return "";
}

function buildAbsIssueGroupFromDmRows(normalized, query, rows) {
  const targets = issueGroupTargets(normalized, query);
  const issuerTarget = normalizeIssuerMatchText(normalized?.issuerName || "");
  const planTargets = uniqueStrings([
    normalized?.absInfo?.planName,
    normalized?.fullName,
    query?.fullName,
    query?.shortName,
  ]).map(normalizeAbsPlanComparable).filter(Boolean);
  const subscribeDate = normalized?.subscribeDate || normalized?.absInfo?.bookDate || "";
  const candidates = rows.filter((row) => {
    if (!isAbsLookupText(rowAbsSearchText(row))) return false;
    const rowPlans = rowFullNames(row)
      .concat([
        pickFirstString(row, ["special_plan_name", "specialPlanName"]),
        pickFirstString(row, ["asset_support_plan_name", "assetSupportPlanName"]),
        pickFirstString(row, ["plan_name", "planName"]),
        pickFirstString(row, ["product_full_name", "productFullName"]),
      ])
      .map(normalizeAbsPlanComparable)
      .filter(Boolean);
    const planMatched = planTargets.length
      ? rowPlans.some((rowPlan) => planTargets.some((target) => absPlanMatches(rowPlan, target)))
      : true;
    if (!planMatched) return false;
    const rowIssuer = normalizeIssuerMatchText(pickFirstString(row, ["issuer_full_name", "issuerFullName", "issuer_name", "issuerName"]));
    if (issuerTarget && rowIssuer && issuerMatchScore(rowIssuer, issuerTarget) < 75) return false;
    const rowDate = pickFirstDateString(row, ["subscribe_date", "subscribeDate", "book_date", "bookDate", "issue_start_date", "issueStartDate"]);
    if (subscribeDate && rowDate && rowDate !== subscribeDate) return false;
    return true;
  });
  const entries = uniqueIssueEntries(candidates.map(dmRowIssueEntry).filter((entry) => entry.shortName || entry.securityId));
  if (entries.length < 2) return null;
  const totalScale = normalized?.absInfo?.totalScale
    ?? sumIssueEntryScales(entries.map((entry) => entry.actualScale ?? entry.planScale));
  return {
    groupId: issueGroupIdFromParts(normalized?.absInfo?.planName || normalized?.fullName || normalized?.issuerName, entries[0]?.shortName || normalized?.shortName),
    source: "dm",
    confidence: 90,
    instrumentType: normalized?.instrumentType || normalized?.absInfo?.type || "ABS",
    issuerName: normalized?.issuerName || "",
    issueName: normalized?.absInfo?.planName || normalizeAbsPlanName(entries[0]?.fullName) || normalized?.fullName || "",
    subscribeDate: subscribeDate || "",
    venue: normalized?.venue || "",
    leadUnderwriter: normalized?.leadUnderwriter || "",
    queriedInput: query?.shortName || query?.securityId || query?.fullName || "",
    totalScale,
    tranches: entries.map((entry) => {
      const scale = numberOrNull(entry.actualScale) ?? numberOrNull(entry.planScale);
      const sharePct = Number.isFinite(numberOrNull(entry.sharePct))
        ? numberOrNull(entry.sharePct)
        : Number.isFinite(scale) && Number.isFinite(totalScale) && totalScale > 0
          ? round(scale / totalScale * 100, 2)
          : null;
      const status = inferIssueTrancheStatus(entry, { groupHasIssued: entries.some(entryHasIssuedFields), projectResultConfirmed: false });
      return cleanIssueTranche({
        shortName: entry.shortName,
        securityId: entry.securityId,
        fullName: entry.fullName,
        tenor: entry.durationText,
        planScale: entry.planScale,
        actualScale: entry.actualScale,
        inquiryRange: entry.inquiryRange,
        couponRate: entry.couponRate,
        trancheLevel: entry.trancheLevel,
        sharePct,
        expectedMaturityDate: entry.expectedMaturityDate,
        debtRating: entry.debtRating,
        debtRatingAgency: entry.debtRatingAgency,
        status,
        statusReason: issueTrancheStatusReason(status),
        source: "dm",
        isQueriedInput: entryMatchesTargets(entry, targets.inputNames, targets.inputSecurityIds),
        isDmMatched: entryMatchesTargets(entry, targets.normalizedNames, targets.normalizedSecurityIds),
      });
    }),
  };
}

function absPlanMatches(rowPlan, target) {
  if (!rowPlan || !target) return false;
  if (rowPlan === target) return true;
  if (rowPlan.includes(target) || target.includes(rowPlan)) {
    return Math.min(rowPlan.length, target.length) / Math.max(rowPlan.length, target.length) >= 0.7;
  }
  return stringSimilarity(rowPlan, target) >= 0.82;
}

function sumIssueEntryScales(values = []) {
  const numbers = values.map(numberOrNull).filter(Number.isFinite);
  return numbers.length ? round(numbers.reduce((sum, value) => sum + value, 0), 4) : null;
}

function issueGroupTargets(normalized, query) {
  const inputNames = uniqueStrings([query?.shortName, query?.fullName]);
  const normalizedNames = uniqueStrings([normalized?.shortName, normalized?.fullName]);
  const names = uniqueStrings([...inputNames, ...normalizedNames]);
  const splitNames = names.flatMap((name) => splitCombinedShortNames(name));
  const inputSecurityIds = uniqueStrings([query?.securityId].map(normalizeSecurityId));
  const normalizedSecurityIds = uniqueStrings([normalized?.securityId].map(normalizeSecurityId));
  const securityIds = uniqueStrings([...inputSecurityIds, ...normalizedSecurityIds]);
  return {
    inputNames,
    normalizedNames,
    names,
    inputSecurityIds,
    normalizedSecurityIds,
    securityIds,
    issuerTargets: uniqueStrings([normalized?.issuerName, normalized?.fullName]),
    families: uniqueStrings(splitNames.map(issueShortNameFamily)),
    seriesKeys: uniqueStrings(splitNames.map(issueShortNameSeriesKey)),
    seriesProfiles: splitNames.map(issueShortNameSeriesProfile).filter(Boolean),
  };
}

function projectIssueEntries(project) {
  const entries = [];
  for (const tranche of project?.tranches || []) {
    entries.push({
      shortName: tranche?.shortName || "",
      securityId: tranche?.securityId || tranche?.security_id || tranche?.securityCode || tranche?.bondCode || tranche?.code || "",
      durationText: tranche?.durationText || "",
      planScale: numberOrNull(tranche?.planScale),
      actualScale: numberOrNull(tranche?.issueScale),
      inquiryLow: numberOrNull(tranche?.inquiryLow),
      inquiryHigh: numberOrNull(tranche?.inquiryHigh),
      couponRate: numberOrNull(tranche?.winningRate ?? tranche?.couponRate),
      winningAmountWan: numberOrNull(tranche?.winningAmountWan),
    });
  }
  const knownNames = new Set(entries.map((entry) => normalizeLookupName(entry.shortName)).filter(Boolean));
  const projectShortNameParts = splitCombinedShortNames(project?.shortName);
  const extraNames = uniqueStrings([
    ...(project?.shortNames || []),
    ...projectShortNameParts,
    projectShortNameParts.length ? "" : project?.shortName,
  ]);
  for (const name of extraNames) {
    const normalizedName = normalizeLookupName(name);
    if (normalizedName && !knownNames.has(normalizedName)) {
      entries.push({ shortName: name, securityId: "", durationText: "", planScale: null, actualScale: null });
      knownNames.add(normalizedName);
    }
  }
  return uniqueIssueEntries(entries);
}

function uniqueIssueEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = `${normalizeLookupName(entry.shortName)}|${normalizeSecurityId(entry.securityId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function sortIssueEntries(entries) {
  return [...(entries || [])].sort(compareIssueEntries);
}

function compareIssueEntries(left, right) {
  const a = issueEntrySortParts(left);
  const b = issueEntrySortParts(right);
  return a.groupKey.localeCompare(b.groupKey, "zh-Hans-CN")
    || a.variant - b.variant
    || a.text.localeCompare(b.text, "zh-Hans-CN");
}

function issueEntrySortParts(entry = {}) {
  const text = normalizeLookupName(entry.shortName || entry.securityId || "");
  const product = text.match(/^(\d{2})(.*?)(SCP|CP|MTN|PPN|ABN|PRN)(\d{1,3})([A-Z])?$/i);
  if (product) {
    return {
      groupKey: `${product[1]}-${product[3].toUpperCase()}-${product[4].padStart(3, "0")}`,
      variant: issueLetterSortValue(product[5]),
      text,
    };
  }
  const letter = text.match(/^(.*\d)([A-Z])$/i);
  if (letter) return { groupKey: letter[1], variant: issueLetterSortValue(letter[2]), text };
  const number = text.match(/^(.*?)(\d+)$/);
  if (number) return { groupKey: number[1], variant: Number(number[2]), text };
  return { groupKey: text, variant: 0, text };
}

function issueLetterSortValue(letter = "") {
  const text = String(letter || "").toUpperCase();
  if (!text) return 0;
  const code = text.charCodeAt(0);
  return code >= 65 && code <= 90 ? code - 64 : 99;
}

function mergeIssueGroups(primaryGroup, secondaryGroup) {
  if (!primaryGroup || !secondaryGroup) return null;
  const mergedTranches = [...primaryGroup.tranches];
  for (const secondary of secondaryGroup.tranches || []) {
    const index = mergedTranches.findIndex((item) => issueTranchesMatch(item, secondary));
    if (index >= 0) {
      mergedTranches[index] = {
        ...secondary,
        ...mergedTranches[index],
        securityId: mergedTranches[index].securityId || secondary.securityId,
        fullName: mergedTranches[index].fullName || secondary.fullName,
        tenor: mergedTranches[index].tenor || secondary.tenor,
        planScale: mergedTranches[index].planScale ?? secondary.planScale,
        actualScale: mergedTranches[index].actualScale ?? secondary.actualScale,
        inquiryRange: mergedTranches[index].inquiryRange || secondary.inquiryRange,
        couponRate: mergedTranches[index].couponRate ?? secondary.couponRate,
        trancheLevel: mergedTranches[index].trancheLevel || secondary.trancheLevel,
        sharePct: mergedTranches[index].sharePct ?? secondary.sharePct,
        expectedMaturityDate: mergedTranches[index].expectedMaturityDate || secondary.expectedMaturityDate,
        debtRating: mergedTranches[index].debtRating || secondary.debtRating,
        debtRatingAgency: mergedTranches[index].debtRatingAgency || secondary.debtRatingAgency,
        status: mergedTranches[index].status === "unknown" ? secondary.status : mergedTranches[index].status,
        isQueriedInput: Boolean(mergedTranches[index].isQueriedInput || secondary.isQueriedInput),
        isDmMatched: Boolean(mergedTranches[index].isDmMatched || secondary.isDmMatched),
        source: mergedTranches[index].source === secondary.source ? mergedTranches[index].source : "mixed",
      };
    } else {
      mergedTranches.push(secondary);
    }
  }
  return {
    ...primaryGroup,
    source: "mixed",
    confidence: Math.max(primaryGroup.confidence || 0, secondaryGroup.confidence || 0),
    tranches: sortIssueEntries(mergedTranches),
  };
}

function annotateIssueGroupReallocationTargets(group) {
  if (!group?.tranches?.length) return group;
  const issued = group.tranches.filter((tranche) => tranche.status === "issued");
  if (!issued.length) return group;
  const tranches = group.tranches.map((tranche) => {
    if (tranche.status !== "reallocated") return tranche;
    const target = reallocationTargetForTranche(tranche, issued);
    if (!target) return tranche;
    const targetShortName = target.shortName || "";
    return {
      ...tranche,
      reallocationTargetShortName: targetShortName,
      reallocationTargetSecurityId: target.securityId || "",
      statusReason: issueTrancheStatusReason(tranche.status, targetShortName),
    };
  });
  return { ...group, tranches };
}

function reallocationTargetForTranche(tranche, issuedTranches) {
  if (issuedTranches.length === 1) return issuedTranches[0];
  const family = issueShortNameFamily(tranche.shortName);
  if (!family) return null;
  const sameFamily = issuedTranches.filter((item) => issueShortNameFamily(item.shortName) === family);
  if (sameFamily.length === 1) return sameFamily[0];
  return null;
}

function issueTranchesMatch(a, b) {
  if (a?.securityId && b?.securityId && securityIdMatches(a.securityId, normalizeSecurityId(b.securityId))) return true;
  const aName = normalizeLookupName(a?.shortName);
  const bName = normalizeLookupName(b?.shortName);
  return Boolean(aName && bName && aName === bName);
}

function entryMatchesTargets(entry, names, securityIds) {
  const securityId = normalizeSecurityId(entry?.securityId);
  if (securityId && securityIds.some((target) => securityIdMatches(securityId, target))) return true;
  const name = normalizeLookupName(entry?.shortName);
  return Boolean(name && names.some((target) => normalizeLookupName(target) === name));
}

function shouldExposeIssueGroup(group, query, normalized) {
  if (!group?.tranches?.length) return false;
  if (group.tranches.length >= 2) return true;
  if (group.tranches.some((tranche) => tranche.status === "reallocated")) return true;
  const inputName = normalizeLookupName(query?.shortName);
  const normalizedName = normalizeLookupName(normalized?.shortName);
  return Boolean(inputName && normalizedName && inputName !== normalizedName);
}

function inferIssueTrancheStatus(entry, { groupHasIssued, projectResultConfirmed }) {
  if (entryHasIssuedFields(entry)) return "issued";
  if (groupHasIssued && projectResultConfirmed) return "reallocated";
  return "unknown";
}

function entryHasIssuedFields(entry) {
  return Boolean(
    normalizeSecurityId(entry?.securityId)
    || Number.isFinite(numberOrNull(entry?.actualScale))
    || Number.isFinite(numberOrNull(entry?.couponRate))
    || Number.isFinite(numberOrNull(entry?.winningAmountWan)) && numberOrNull(entry?.winningAmountWan) > 0,
  );
}

function issueTrancheStatusReason(status, targetShortName = "") {
  if (status === "issued") return "已取得发行结果字段";
  if (status === "reallocated" && targetShortName) return `本期债券已全部回拨至${targetShortName}`;
  if (status === "reallocated") return "同组其他期限已有发行结果，本期限未见发行结果，可能全额回拨或未发行";
  return "已识别同次发行关系，发行结果待确认";
}

function cleanIssueTranche(tranche) {
  return {
    shortName: tranche.shortName || "",
    securityId: tranche.securityId || "",
    fullName: tranche.fullName || "",
    tenor: tranche.tenor || "",
    planScale: numberOrNull(tranche.planScale),
    actualScale: numberOrNull(tranche.actualScale),
    inquiryRange: tranche.inquiryRange || "",
    couponRate: numberOrNull(tranche.couponRate),
    trancheLevel: tranche.trancheLevel || "",
    sharePct: numberOrNull(tranche.sharePct),
    expectedMaturityDate: tranche.expectedMaturityDate || "",
    debtRating: tranche.debtRating || "",
    debtRatingAgency: tranche.debtRatingAgency || "",
    status: tranche.status || "unknown",
    statusReason: tranche.statusReason || "",
    reallocationTargetShortName: tranche.reallocationTargetShortName || "",
    reallocationTargetSecurityId: tranche.reallocationTargetSecurityId || "",
    source: tranche.source || "",
    isQueriedInput: Boolean(tranche.isQueriedInput),
    isDmMatched: Boolean(tranche.isDmMatched),
  };
}

function splitCombinedShortNames(value = "") {
  const text = String(value || "").trim();
  if (!text || !text.includes("/")) return text ? [text] : [];
  const parts = text.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;
  const first = parts[0];
  const numberBase = first.match(/^(.*?)(\d{1,3})$/);
  if (numberBase && parts.slice(1).every((part) => /^\d{1,3}$/.test(part))) {
    const width = numberBase[2].length;
    return [first, ...parts.slice(1).map((part) => `${numberBase[1]}${part.padStart(width, "0")}`)];
  }
  const letterBase = first.match(/^(.*?)([A-Z])$/i);
  if (letterBase && parts.slice(1).every((part) => /^[A-Z]$/i.test(part))) {
    return [first, ...parts.slice(1).map((part) => `${letterBase[1]}${part.toUpperCase()}`)];
  }
  return parts;
}

function issueShortNameFamily(value = "") {
  const names = splitCombinedShortNames(value);
  const text = normalizeLookupName(names[0] || value);
  if (!text) return "";
  const letter = text.match(/^(.*\d)[A-Z]$/i);
  if (letter) return letter[1];
  const twoDigits = text.match(/^(.*\D)(\d{2})$/);
  if (twoDigits) return twoDigits[1];
  const letterDigit = text.match(/^(.*[A-Z])\d$/i);
  if (letterDigit) return letterDigit[1];
  return text;
}

function issueShortNameSeriesKey(value = "") {
  const names = splitCombinedShortNames(value);
  const text = normalizeLookupName(names[0] || value);
  if (!text) return "";
  const match = text.match(/^(\d{2}).*?(SCP|CP|MTN|PPN|ABN|PRN)(\d{1,3})([A-Z])?$/i);
  if (!match) return "";
  return `${match[1]}-${match[2].toUpperCase()}-${match[3].padStart(3, "0")}`;
}

function issueShortNameSeriesProfile(value = "") {
  const names = splitCombinedShortNames(value);
  const profile = shortNameProfile(names[0] || value);
  if (!profile.product || !Number.isFinite(profile.serial) || !profile.alias) return null;
  return {
    year: profile.year,
    alias: profile.alias,
    product: profile.product,
    serial: profile.serial,
  };
}

function issueSeriesProfilesCompatible(candidate, target) {
  if (!candidate || !target) return false;
  if (candidate.year && target.year && candidate.year !== target.year) return false;
  if (candidate.product !== target.product || candidate.serial !== target.serial) return false;
  return stringSimilarity(candidate.alias, target.alias) >= 0.75;
}

function issueNameMatchesGroupTargets(name, targets) {
  return Boolean(issueNameGroupMatchType(name, targets));
}

function issueNameGroupMatchType(name, targets) {
  const family = issueShortNameFamily(name);
  if (family && targets.families.includes(family)) return "family";
  const profile = issueShortNameSeriesProfile(name);
  if (profile && (targets.seriesProfiles || []).some((target) => issueSeriesProfilesCompatible(profile, target))) {
    return "seriesAlias";
  }
  const seriesKey = issueShortNameSeriesKey(name);
  return seriesKey && targets.seriesKeys.includes(seriesKey) ? "series" : "";
}

function projectFullText(project) {
  return normalizeLookupName([
    project?.shortName,
    project?.issuerName,
    project?.sourceText,
    project?.opinion,
  ].filter(Boolean).join(" "));
}

function formatIssueGroupRange(low, high) {
  return Number.isFinite(numberOrNull(low)) && Number.isFinite(numberOrNull(high))
    ? `${formatDecimal(low)}-${formatDecimal(high)}`
    : "";
}

function issueGroupIdFromParts(...parts) {
  return normalizeLookupName(parts.filter(Boolean).join("-")).slice(0, 80);
}

function issueGroupDiagnostic(issueGroup) {
  if (!issueGroup) return { found: false };
  return {
    found: true,
    source: issueGroup.source,
    confidence: issueGroup.confidence,
    trancheCount: issueGroup.tranches?.length || 0,
    statuses: (issueGroup.tranches || []).map((tranche) => ({
      shortName: tranche.shortName,
      status: tranche.status,
      source: tranche.source,
    })),
  };
}

function ratingDiagnostic(original, dmDiscovery, windImpliedRating, issuerFallback, enriched, hasDb, windEnabled) {
  const fields = ["subjectRating", "ratingAgency", "impliedRating"];
  const dmFields = windEnabled ? ["subjectRating", "ratingAgency"] : fields;
  const filledFromDm = dmFields.filter((field) => Boolean(original?.[field]));
  const filledFromDmDiscovery = fields.filter((field) => enriched?.ratingSource?.[field] === "dm-discovery");
  const filledFromWind = fields.filter((field) => enriched?.ratingSource?.[field] === "wind-analytics");
  const filledFromIssuerDb = fields.filter((field) => enriched?.ratingSource?.[field] === "issuer-db");
  return {
    filledFromDm,
    filledFromDmDiscovery,
    filledFromWind,
    filledFromIssuerDb,
    missing: fields.filter((field) => !enriched?.[field]),
    dmDiscoverySources: (dmDiscovery?.sources || []).map((source) => source.name),
    dmDiscoveryMatches: dmDiscovery?.matches || {},
    dmDiscoveryErrors: dmDiscovery?.errors || [],
    windImpliedRating: {
      enabled: windEnabled,
      status: windImpliedRating?.status || "not_run",
      target: windImpliedRating?.target || "",
      windCode: windImpliedRating?.windCode || "",
      shortName: windImpliedRating?.shortName || "",
      asOf: windImpliedRating?.asOf || "",
      rowCount: windImpliedRating?.rowCount || 0,
      errorCode: windImpliedRating?.errorCode || "",
      error: windImpliedRating?.error || "",
    },
    issuerDbAvailable: hasDb,
    matchedIssuer: issuerFallback?.legalName || "",
    matchedBy: issuerFallback?.matchedBy || "",
    matchedTarget: issuerFallback?.matchedTarget || "",
    note: filledFromWind.length
      ? "中债隐含评级由 Wind 返回；DM 仅继续提供债券档案、主体评级和评级机构。"
      : windEnabled && filledFromIssuerDb.includes("impliedRating")
      ? "Wind 未返回可用中债隐含评级，已使用明确标注的主体库历史隐含评级回退。"
      : windEnabled
      ? "Wind 未返回可用中债隐含评级，且没有可用的主体库回退；未使用 DM 隐含评级替代。"
      : filledFromDmDiscovery.length
      ? "Rating fields were not present in the initially selected DM row, but were found by scanning additional DM results before D1 fallback."
      : filledFromIssuerDb.length
      ? "DM did not return every rating field; missing values were filled from the issuer database."
      : "DM rating discovery did not find rating fields; no issuer-database fallback was available for the remaining fields.",
  };
}

function bestPrimaryRow(primary, shortName, securityId, fullName) {
  const rows = primary?.rows || [];
  return rows.find((row) => rowMatchesSecurityId(row, securityId))
    || rows.find((row) => rowMatchesShortName(row, shortName))
    || rows.find((row) => rowMatchesFullName(row, fullName))
    || rows[0]
    || {};
}

function primaryRowMatchesQuery(row, { shortName, securityId, fullName }) {
  return rowMatchesSecurityId(row, securityId)
    || rowMatchesShortName(row, shortName)
    || rowMatchesFullName(row, fullName)
    || rowMatchesLikelyShortName(row, shortName);
}

function primaryRowDedupKey(row = {}) {
  return [
    normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"])),
    normalizeLookupName(pickFirstString(row, ["sec_short_name", "secShortName"])),
    normalizeFullNameForLookup(pickFirstString(row, ["sec_full_name", "secFullName", "bond_full_name", "bondFullName"])),
  ].filter(Boolean).join("|") || JSON.stringify(row);
}

function uniqueRowsByKey(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = primaryRowDedupKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rowMatchesSecurityId(row, securityId) {
  const query = normalizeSecurityId(securityId);
  if (!query) return false;
  return rowSecurityIds(row).some((candidate) => securityIdMatches(candidate, query));
}

function rowMatchesShortName(row, shortName) {
  const queries = splitCombinedShortNames(shortName).map(normalizeLookupName).filter(Boolean);
  if (!queries.length) return false;
  return rowShortNames(row).some((candidate) => queries.includes(normalizeLookupName(candidate)));
}

function rowMatchesLikelyShortName(row, shortName) {
  const query = normalizeLookupName(shortName);
  if (!query) return false;
  const profile = shortNameProfile(query);
  if (!profile.product || !Number.isFinite(profile.serial)) return false;
  return rowShortNames(row).some((candidate) => {
    const candidateName = normalizeLookupName(candidate);
    const candidateProfile = shortNameProfile(candidateName);
    if (profile.year && candidateProfile.year && profile.year !== candidateProfile.year) return false;
    if (profile.product !== candidateProfile.product || profile.serial !== candidateProfile.serial) return false;
    const aliasScore = profile.alias && candidateProfile.alias
      ? stringSimilarity(profile.alias, candidateProfile.alias)
      : 0;
    return aliasScore >= 0.75 && scoreShortNameCandidate(query, profile, candidateName).score >= 88;
  });
}

function rowMatchesFullName(row, fullName) {
  const query = normalizeFullNameForLookup(fullName);
  if (!query || query.length < 8) return false;
  return rowFullNames(row).some((candidate) => {
    const normalized = normalizeFullNameForLookup(candidate);
    if (!normalized) return false;
    if (normalized === query) return true;
    if ((normalized.includes(query) || query.includes(normalized))
      && Math.min(normalized.length, query.length) / Math.max(normalized.length, query.length) >= 0.82) return true;
    return false;
  });
}

function rowSecurityIds(row) {
  return uniqueStrings([
    row?.security_id,
    row?.securityId,
    ...parseCrossMarketEntries(row).map((item) => item.securityId),
  ]);
}

function rowShortNames(row) {
  return uniqueStrings([
    row?.sec_short_name,
    row?.secShortName,
    ...parseCrossMarketEntries(row).map((item) => item.shortName),
  ]);
}

function rowFullNames(row) {
  return uniqueStrings([
    row?.sec_full_name,
    row?.secFullName,
    row?.bond_full_name,
    row?.bondFullName,
  ]);
}

function parseCrossMarketEntries(row) {
  const text = String(row?.cros_mar_bond ?? row?.crosMarBond ?? "").trim();
  if (!text) return [];
  return text.split(/[,，、;]/).map((part) => {
    const item = part.trim();
    const securityId = [...item.matchAll(/\(([^()]+)\)/g)]
      .map((match) => normalizeSecurityId(match[1]))
      .find(Boolean) || "";
    const shortName = item.replace(/\([^()]*\)/g, "").trim();
    return { shortName, securityId };
  }).filter((item) => item.shortName || item.securityId);
}

function securityIdMatches(candidate, query) {
  const candidateId = normalizeSecurityId(candidate);
  if (!candidateId || !query) return false;
  if (candidateId === query) return true;
  if (candidateId.includes(".") && query.includes(".")) return false;
  return stripSecuritySuffix(candidateId) === stripSecuritySuffix(query);
}

export function normalizeSecurityId(value = "") {
  const text = String(value || "").trim().toUpperCase();
  return /^[A-Z]*\d+(?:\.[A-Z]+)?$/.test(text) ? text : "";
}

function stripSecuritySuffix(value = "") {
  return String(value || "").replace(/\.[A-Z]+$/i, "");
}

function normalizeLookupName(value = "") {
  return normalizeName(value)
    .replace(/[\(（][^\)）]*[\)）]/g, "")
    .replace(/[\[\{][^\]\}]*[\]\}]/g, "")
    .replace(/_BC$/i, "")
    .replace(/[·.,，。:：;；"'`]/g, "")
    .replace(/债(?=\d+$)/g, "");
}

function normalizeFullNameForLookup(value = "") {
  return normalizeName(value)
    .replace(/[()（）\[\]{}"'`.,，。;；:：、\-_]/g, "");
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function firstRow(result) {
  return result?.rows?.[0] || {};
}

export function rowsFromDm(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.list)) return raw.list;
  if (Array.isArray(raw?.data)) return raw.data;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

function collectFieldCandidates(rawItems) {
  const candidates = [];
  for (const raw of rawItems) {
    for (const row of rowsFromDm(raw).slice(0, 5)) {
      for (const [key, value] of Object.entries(row || {})) {
        const valueText = String(value ?? "");
        const keyText = String(key);
        if (/(rating|agency|credit|grade|level|implied|rate|tenor|matu|option|special|asset|plan|tranche|ratio|support|enhance|underlying|评级|隐含|等级|级别|主体|机构|期限|条款|行权|回售|赎回|基础资产|底层资产|专项|计划|分档|优先|次级|劣后|占比|到期|差额|流动性|承诺|增信)/i.test(`${keyText} ${valueText}`)) {
          candidates.push({ key, value });
        }
      }
    }
  }
  return candidates.slice(0, 200);
}

function pickRatingLike(rows, kind) {
  const keyPatterns = {
    subject: [/subject.*rating/i, /issuer.*rating/i, /main.*rating/i, /主体.*评/i],
    agency: [/rating.*agency/i, /agency/i, /评.*机构/i],
    implied: [/implied/i, /隐含/i, /cbc.*rating/i, /中债.*评/i],
  }[kind] || [];
  const valuePattern = /^(?:AAA|AA\+?|AA\(2\)|AA-?|A\+?|A-?|BBB\+?|BBB-?|BB\+?|BB-?|B\+?|B-?)(?:\(.+?\))?$/i;
  for (const row of rows) {
    for (const [key, value] of Object.entries(row || {})) {
      const keyText = String(key);
      const valueText = String(value ?? "").trim();
      if (!valueText) continue;
      if (keyPatterns.some((pattern) => pattern.test(keyText))) return valueText;
      if (kind === "subject" && valuePattern.test(valueText) && /(rating|grade|level|评级|等级|级别)/i.test(keyText)) return valueText;
    }
  }
  return "";
}

export function pickFirstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function pickFirstDateString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    const text = formatDmDate(value);
    if (text) return text;
  }
  return "";
}

export function numberFromRow(row, keys) {
  for (const key of keys) {
    const value = numberOrNull(row?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeInquiryRange(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (matches?.length >= 2) return `${formatDecimal(matches[0])}-${formatDecimal(matches[1])}`;
  return text.replace(/\s*~\s*/g, "-");
}

function formatDecimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "");
  return String(Number(number.toFixed(6)));
}

function formatDmDate(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return chinaDate(new Date(value));
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{13}$/.test(text)) return chinaDate(new Date(Number(text)));
  const dateMatch = text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
  if (dateMatch) {
    const [year, month, day] = dateMatch[0].split(/[-/]/);
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return text;
}

function inferVenue(securityId = "", shortName = "", bondTypeDesc = "") {
  const value = String(securityId || "").toUpperCase();
  if (value.endsWith(".IB")) return "银行间";
  if (value.endsWith(".SH")) return "上交所";
  if (value.endsWith(".SZ")) return "深交所";
  if (/(SCP|CP|MTN|PPN|ABN|短期融资券|中期票据|定向工具|资产支持票据)/i.test(`${shortName} ${bondTypeDesc}`)) return "银行间";
  return "";
}

function inferSponsorStatus(leadUnderwriter = "") {
  const names = String(leadUnderwriter || "")
    .split(/[,\uFF0C、;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const xingyeIndex = names.findIndex((name) => /兴业银行/.test(name));
  if (xingyeIndex < 0) return "非我行主承";
  return xingyeIndex === 0 ? "牵头" : "联席";
}

function normalizeName(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function resolvePrimaryWindow(startDate, endDate) {
  if (startDate && endDate) return { startDate, endDate };
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 14);
  const end = new Date(today);
  end.setDate(today.getDate() + 15);
  return { startDate: localDate(start), endDate: localDate(end) };
}

export function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function chinaDate(date) {
  const adjusted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = adjusted.getUTCFullYear();
  const month = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(adjusted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function makeDmClient(env, request) {
  const appKey = env.INNO_APP_KEY;
  const appSecret = env.INNO_APP_SECRET || env.INNO_SM4_KEY;
  const baseUrl = (env.INNO_BASE_URL || DM_BASE_URL).replace(/\/+$/, "");
  return {
    async post(path, data) {
      const payload = sm4EncryptToBase64Url(JSON.stringify(data), appSecret);
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 Cloudflare Pages",
          "X-Dm-App-Key": appKey,
        },
        body: payload,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`DM HTTP ${response.status}: ${text.slice(0, 300)}`);
      let content;
      try {
        content = JSON.parse(text);
      } catch {
        content = text;
      }
      const encrypted = extractDmEncryptedPayload(content);
      const parsed = typeof encrypted === "string"
        ? JSON.parse(decryptDmPayload(encrypted, appSecret, { content, response, text }))
        : encrypted;
      if (parsed && typeof parsed === "object" && "code" in parsed && parsed.code !== 0) {
        throw new Error(`DM API ${parsed.code}: ${parsed.message || "unknown error"}`);
      }
      return parsed?.data ?? parsed;
    },
  };
}

export function validateDmConfig(env) {
  if (!env.INNO_APP_KEY) return json({ error: "Cloudflare Secret INNO_APP_KEY 尚未配置" }, 503);
  if (!env.INNO_APP_SECRET && !env.INNO_SM4_KEY) return json({ error: "Cloudflare Secret INNO_APP_SECRET 尚未配置" }, 503);
  return null;
}

export function apiHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders() });
}

function extractDmEncryptedPayload(content, depth = 0) {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (depth < 4 && looksLikeJson(trimmed)) {
      try {
        return extractDmEncryptedPayload(JSON.parse(trimmed), depth + 1);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (content && typeof content === "object") {
    for (const key of ["data", "result", "content", "payload", "cipherText", "ciphertext"]) {
      if (typeof content[key] === "string" && content[key].trim()) {
        return extractDmEncryptedPayload(content[key], depth + 1);
      }
    }

    if ("code" in content && content.code !== 0) {
      throw new Error(`DM API ${content.code}: ${content.message || content.msg || "unknown error"}`);
    }

    if (Array.isArray(content)) return content;
    if (content.data && typeof content.data === "object") return content.data;
    if (content.result && typeof content.result === "object") return content.result;

    const keys = Object.keys(content).slice(0, 12).join(", ");
    throw new Error(`DM response shape unsupported: object keys [${keys}]`);
  }

  throw new Error(`DM response shape unsupported: ${typeof content}`);
}

function decryptDmPayload(encrypted, key, context = {}) {
  if (!looksLikeBase64(encrypted)) {
    throw withDmDiagnostic(
      new Error("DM response is not encrypted base64/base64url text"),
      context,
      encrypted,
    );
  }

  try {
    return sm4DecryptFromBase64Url(encrypted, key);
  } catch (error) {
    throw withDmDiagnostic(error, context, encrypted);
  }
}

function withDmDiagnostic(error, context, encrypted) {
  error.diagnostic = {
    responseContentType: context.response?.headers?.get?.("content-type") || "",
    responsePreview: previewText(context.text),
    extractedPayloadPreview: previewText(encrypted),
    extractedPayloadLength: typeof encrypted === "string" ? encrypted.length : null,
    responseShape: describeShape(context.content),
  };
  return error;
}

function looksLikeJson(value) {
  return (value.startsWith("{") && value.endsWith("}"))
    || (value.startsWith("[") && value.endsWith("]"))
    || (value.startsWith('"') && value.endsWith('"'));
}

function looksLikeBase64(value) {
  const text = String(value || "").trim();
  return Boolean(text) && /^[A-Za-z0-9+/_=\-\s]+$/.test(text);
}

function describeShape(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") return `object(${Object.keys(value).slice(0, 12).join(",")})`;
  return typeof value;
}

function previewText(value, limit = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function sm4EncryptToBase64Url(plaintext, key) {
  const bytes = pkcs7Pad(utf8Encode(plaintext));
  const roundKeys = sm4RoundKeys(prepareSm4Key(key));
  const output = new Uint8Array(bytes.length);
  for (let offset = 0; offset < bytes.length; offset += 16) {
    output.set(sm4CryptBlock(bytes.subarray(offset, offset + 16), roundKeys), offset);
  }
  return base64UrlEncode(output);
}

function sm4DecryptFromBase64Url(value, key) {
  const bytes = base64UrlDecode(String(value || ""));
  if (!bytes.length || bytes.length % 16 !== 0) throw new Error("DM 返回密文长度不正确");
  const roundKeys = sm4RoundKeys(prepareSm4Key(key)).reverse();
  const output = new Uint8Array(bytes.length);
  for (let offset = 0; offset < bytes.length; offset += 16) {
    output.set(sm4CryptBlock(bytes.subarray(offset, offset + 16), roundKeys), offset);
  }
  return utf8Decode(pkcs7Unpad(output));
}

function prepareSm4Key(key) {
  const source = utf8Encode(String(key || ""));
  const result = new Uint8Array(16);
  result.set(source.slice(0, 16));
  return result;
}

function sm4RoundKeys(keyBytes) {
  const mk = [
    readUint32(keyBytes, 0),
    readUint32(keyBytes, 4),
    readUint32(keyBytes, 8),
    readUint32(keyBytes, 12),
  ];
  const k = [mk[0] ^ FK[0], mk[1] ^ FK[1], mk[2] ^ FK[2], mk[3] ^ FK[3]];
  const rk = [];
  for (let i = 0; i < 32; i += 1) {
    const next = (k[i] ^ sm4KeyTransform((k[i + 1] ^ k[i + 2] ^ k[i + 3] ^ CK[i]) >>> 0)) >>> 0;
    k.push(next);
    rk.push(next);
  }
  return rk;
}

function sm4CryptBlock(block, roundKeys) {
  const x = [
    readUint32(block, 0),
    readUint32(block, 4),
    readUint32(block, 8),
    readUint32(block, 12),
  ];
  for (let i = 0; i < 32; i += 1) {
    x.push((x[i] ^ sm4RoundTransform((x[i + 1] ^ x[i + 2] ^ x[i + 3] ^ roundKeys[i]) >>> 0)) >>> 0);
  }
  const output = new Uint8Array(16);
  writeUint32(output, 0, x[35]);
  writeUint32(output, 4, x[34]);
  writeUint32(output, 8, x[33]);
  writeUint32(output, 12, x[32]);
  return output;
}

function sm4RoundTransform(value) {
  const b = sm4Substitute(value);
  return (b ^ rotl32(b, 2) ^ rotl32(b, 10) ^ rotl32(b, 18) ^ rotl32(b, 24)) >>> 0;
}

function sm4KeyTransform(value) {
  const b = sm4Substitute(value);
  return (b ^ rotl32(b, 13) ^ rotl32(b, 23)) >>> 0;
}

function sm4Substitute(value) {
  return (
    (SBOX[(value >>> 24) & 0xff] << 24)
    | (SBOX[(value >>> 16) & 0xff] << 16)
    | (SBOX[(value >>> 8) & 0xff] << 8)
    | SBOX[value & 0xff]
  ) >>> 0;
}

function rotl32(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function pkcs7Pad(bytes) {
  const padding = 16 - (bytes.length % 16 || 16);
  const padLength = bytes.length % 16 === 0 ? 16 : padding;
  const result = new Uint8Array(bytes.length + padLength);
  result.set(bytes);
  result.fill(padLength, bytes.length);
  return result;
}

function pkcs7Unpad(bytes) {
  const padLength = bytes[bytes.length - 1];
  if (padLength < 1 || padLength > 16 || padLength > bytes.length) throw new Error("SM4 padding 不正确");
  for (let i = bytes.length - padLength; i < bytes.length; i += 1) {
    if (bytes[i] !== padLength) throw new Error("SM4 padding 不正确");
  }
  return bytes.slice(0, bytes.length - padLength);
}

function utf8Encode(value) {
  return new TextEncoder().encode(value);
}

function utf8Decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function base64UrlEncode(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(padded, "base64"));
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const __test__ = {
  sm4RoundKeys,
  sm4CryptBlock,
  prepareSm4Key,
  sm4EncryptToBase64Url,
  sm4DecryptFromBase64Url,
  extractDmEncryptedPayload,
  decryptDmPayload,
  resolvePrimaryWindow,
  closestDmLookupSuggestions,
  applyWindImpliedRating,
  bytesToHex,
};
