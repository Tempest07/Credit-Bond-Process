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
  const denied = authorize(context);
  if (denied) return denied;

  const url = new URL(context.request.url);
  const shortName = (url.searchParams.get("shortName") || url.searchParams.get("short_name") || "").trim();
  const securityId = (url.searchParams.get("securityId") || url.searchParams.get("security_id") || "").trim();
  const startDate = (url.searchParams.get("startDate") || url.searchParams.get("start_date") || "").trim();
  const endDate = (url.searchParams.get("endDate") || url.searchParams.get("end_date") || "").trim();

  if (!shortName && !securityId) {
    return json({ error: "请提供 shortName 或 securityId" }, 400);
  }
  const missingConfig = validateDmConfig(context.env);
  if (missingConfig) return missingConfig;

  try {
    const dm = makeDmClient(context.env, context.request);
    const basic = await lookupBasicInfo(dm, { shortName, securityId });
    const primary = await lookupPrimaryData(dm, {
      shortName,
      securityId,
      issuerName: pickFirstString(firstRow(basic), ["issuer_name", "issuerName"]),
      startDate,
      endDate,
    });
    const issuerName = pickFirstString(firstRow(primary), ["issuer_full_name", "issuerFullName"])
      || pickFirstString(firstRow(basic), ["issuer_name", "issuerName"]);
    const company = issuerName ? await lookupCompanyInfo(dm, issuerName) : null;
    const normalized = normalizeDmLookup({ shortName, securityId, basic, primary, company });
    const dmRatingDiscovery = await lookupDmRatingDiscovery(dm, { normalized, basic, primary, company });
    const dmEnrichedNormalized = applyDmRatingDiscovery(normalized, dmRatingDiscovery);
    const issuerRatingFallback = await lookupIssuerRatingFallback(context.env.DB, dmEnrichedNormalized);
    const enrichedNormalized = applyIssuerRatingFallback(dmEnrichedNormalized, issuerRatingFallback);

    return json({
      ok: true,
      query: { shortName, securityId, startDate: primary.window.startDate, endDate: primary.window.endDate },
      normalized: enrichedNormalized,
      diagnostic: {
        rating: ratingDiagnostic(normalized, dmRatingDiscovery, issuerRatingFallback, enrichedNormalized, Boolean(context.env.DB)),
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

async function lookupBasicInfo(dm, { shortName, securityId }) {
  const payload = securityId
    ? { securityIdList: [securityId] }
    : { secShortNameList: [shortName] };
  const raw = await dm.post(BASIC_INFO_PATH, payload);
  return { raw, rows: rowsFromDm(raw) };
}

async function lookupPrimaryData(dm, { shortName, securityId, issuerName, startDate, endDate }) {
  const window = resolvePrimaryWindow(startDate, endDate);
  const payload = {
    startDate: window.startDate,
    endDate: window.endDate,
    bond_category: "1",
  };
  if (issuerName) payload.issuerFullName = issuerName;

  const raw = await dm.post(PRIMARY_PATH, payload);
  const rows = rowsFromDm(raw);
  const filtered = rows.filter((row) => primaryRowMatchesQuery(row, { shortName, securityId }));
  return { raw, rows: shortName || securityId ? filtered : rows, window };
}

async function lookupCompanyInfo(dm, issuerName) {
  const raw = await dm.post(COMPANY_INFO_PATH, { comFullNameList: [issuerName] });
  return { raw, rows: rowsFromDm(raw) };
}

function normalizeDmLookup({ shortName, securityId, basic, primary, company }) {
  const basicRow = firstRow(basic);
  const primaryRow = bestPrimaryRow(primary, shortName, securityId);
  const companyRow = firstRow(company);
  const issuerName = pickFirstString(primaryRow, ["issuer_full_name", "issuerFullName"])
    || pickFirstString(basicRow, ["issuer_name", "issuerName"])
    || pickFirstString(companyRow, ["com_full_name", "comFullName"]);
  const leadUnderwriter = pickFirstString(primaryRow, ["unde_name", "undeName"]);
  const scaleWan = numberFromRow(primaryRow, ["plan_issue_amount", "planIssueAmount"])
    ?? numberFromRow(primaryRow, ["actu_issue_amount", "actuIssueAmount"]);
  const scaleYi = Number.isFinite(scaleWan) ? round(scaleWan / 10000, 4) : numberFromRow(basicRow, ["actu_iss_amut", "actuIssAmut", "new_size", "newSize"]);
  const primarySecurityId = pickFirstString(primaryRow, ["security_id", "securityId"]);
  const basicSecurityId = pickFirstString(basicRow, ["security_id", "securityId"]);
  const resolvedShortName = pickFirstString(primaryRow, ["sec_short_name", "secShortName"])
    || pickFirstString(basicRow, ["sec_short_name", "secShortName"])
    || shortName;
  return {
    securityId: primarySecurityId || basicSecurityId || securityId,
    shortName: resolvedShortName,
    fullName: pickFirstString(primaryRow, ["sec_full_name", "secFullName"]) || pickFirstString(basicRow, ["sec_full_name", "secFullName"]),
    issuerName,
    durationText: pickFirstString(primaryRow, ["bond_issue_tenor", "bondIssueTenor"]) || pickFirstString(basicRow, ["bond_matu", "bondMatu"]),
    issueScaleYi: scaleYi,
    inquiryRange: normalizeInquiryRange(pickFirstString(primaryRow, ["subscribe_rate", "subscribeRate"])),
    venue: pickFirstString(primaryRow, ["tender_market_desc", "tenderMarketDesc"])
      || inferVenue(primarySecurityId || basicSecurityId || securityId, resolvedShortName, pickFirstString(primaryRow, ["bond_type_desc", "bondTypeDesc"]) || pickFirstString(basicRow, ["bond_type_desc", "bondTypeDesc"])),
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
  };
}

async function lookupDmRatingDiscovery(dm, { normalized, basic, primary, company }) {
  const sources = [
    { name: "basicInfo", raw: basic.raw, rows: basic.rows || [] },
    { name: "primaryData", raw: primary.raw, rows: primary.rows || [] },
    { name: "companyInfo", raw: company?.raw || null, rows: company?.rows || [] },
  ];
  const errors = [];
  const initial = extractRatingsFromDmSources(sources);
  if (ratingsComplete({ ...normalized, ...initial.values })) return { ...initial, sources, errors };

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
      const discovered = extractRatingsFromDmSources(sources);
      if (ratingsComplete({ ...normalized, ...discovered.values })) {
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

  return { ...extractRatingsFromDmSources(sources), sources, errors };
}

function extractRatingsFromDmSources(sources) {
  const values = {};
  const matches = {};
  for (const source of sources) {
    for (const row of rowsFromDm(source.rows)) {
      for (const item of flattenDmValues(row)) {
        applyRatingCandidate(values, matches, item, source.name);
        if (values.subjectRating && values.ratingAgency && values.impliedRating) return { values, matches };
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

function applyRatingCandidate(values, matches, item, source) {
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
  if (!values.impliedRating && ratingWithAgency.rating && ratingKeyMatches(keyText, "implied")) {
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

function ratingsComplete(value) {
  return Boolean(value?.subjectRating && value?.ratingAgency && value?.impliedRating);
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

async function lookupIssuerRatingFallback(db, normalized) {
  if (!db) return null;
  if (normalized?.subjectRating && normalized?.ratingAgency && normalized?.impliedRating) return null;
  try {
    const row = await db.prepare("SELECT data FROM app_state WHERE id = 1").first();
    const data = row?.data ? JSON.parse(row.data) : null;
    const issuers = Array.isArray(data?.issuers) ? data.issuers : [];
    return matchIssuerForRating(normalized, issuers);
  } catch {
    return null;
  }
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
  return best?.issuer ? { ...best.issuer, matchedBy: best.matchedBy, matchedTarget: best.matchedTarget } : null;
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

function ratingDiagnostic(original, dmDiscovery, issuerFallback, enriched, hasDb) {
  const fields = ["subjectRating", "ratingAgency", "impliedRating"];
  const filledFromDm = fields.filter((field) => Boolean(original?.[field]));
  const filledFromDmDiscovery = fields.filter((field) => enriched?.ratingSource?.[field] === "dm-discovery");
  const filledFromIssuerDb = fields.filter((field) => enriched?.ratingSource?.[field] === "issuer-db");
  return {
    filledFromDm,
    filledFromDmDiscovery,
    filledFromIssuerDb,
    missing: fields.filter((field) => !enriched?.[field]),
    dmDiscoverySources: (dmDiscovery?.sources || []).map((source) => source.name),
    dmDiscoveryMatches: dmDiscovery?.matches || {},
    dmDiscoveryErrors: dmDiscovery?.errors || [],
    issuerDbAvailable: hasDb,
    matchedIssuer: issuerFallback?.legalName || "",
    matchedBy: issuerFallback?.matchedBy || "",
    matchedTarget: issuerFallback?.matchedTarget || "",
    note: filledFromDmDiscovery.length
      ? "Rating fields were not present in the initially selected DM row, but were found by scanning additional DM results before D1 fallback."
      : filledFromIssuerDb.length
      ? "DM did not return every rating field; missing values were filled from the issuer database."
      : "DM rating discovery did not find rating fields; no issuer-database fallback was available for the remaining fields.",
  };
}

function bestPrimaryRow(primary, shortName, securityId) {
  const rows = primary?.rows || [];
  return rows.find((row) => rowMatchesSecurityId(row, securityId))
    || rows.find((row) => rowMatchesShortName(row, shortName))
    || rows[0]
    || {};
}

function primaryRowMatchesQuery(row, { shortName, securityId }) {
  return rowMatchesSecurityId(row, securityId) || rowMatchesShortName(row, shortName);
}

function rowMatchesSecurityId(row, securityId) {
  const query = normalizeSecurityId(securityId);
  if (!query) return false;
  return rowSecurityIds(row).some((candidate) => securityIdMatches(candidate, query));
}

function rowMatchesShortName(row, shortName) {
  const query = normalizeLookupName(shortName);
  if (!query) return false;
  return rowShortNames(row).some((candidate) => normalizeLookupName(candidate) === query);
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

function normalizeSecurityId(value = "") {
  const text = String(value || "").trim().toUpperCase();
  return /^[A-Z]*\d+(?:\.[A-Z]+)?$/.test(text) ? text : "";
}

function stripSecuritySuffix(value = "") {
  return String(value || "").replace(/\.[A-Z]+$/i, "");
}

function normalizeLookupName(value = "") {
  return normalizeName(value)
    .replace(/_BC$/i, "")
    .replace(/债(?=\d+$)/g, "");
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function firstRow(result) {
  return result?.rows?.[0] || {};
}

function rowsFromDm(raw) {
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
        if (/(rating|agency|credit|grade|level|implied|rate|评级|隐含|等级|级别|主体|机构)/i.test(`${keyText} ${valueText}`)) {
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

function pickFirstString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function pickFirstDateString(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    const text = formatDmDate(value);
    if (text) return text;
  }
  return "";
}

function numberFromRow(row, keys) {
  for (const key of keys) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
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

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chinaDate(date) {
  const adjusted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = adjusted.getUTCFullYear();
  const month = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(adjusted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function makeDmClient(env, request) {
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

function validateDmConfig(env) {
  if (!env.INNO_APP_KEY) return json({ error: "Cloudflare Secret INNO_APP_KEY 尚未配置" }, 503);
  if (!env.INNO_APP_SECRET && !env.INNO_SM4_KEY) return json({ error: "Cloudflare Secret INNO_APP_SECRET 尚未配置" }, 503);
  return null;
}

function authorize(context) {
  if (isLocalRequest(context.request)) return null;
  const password = context.env.APP_PASSWORD;
  if (!password) return json({ error: "Pages Secret APP_PASSWORD 尚未配置" }, 503);
  const authorization = context.request.headers.get("Authorization") || "";
  if (authorization !== `Bearer ${password}`) return json({ error: "Unauthorized" }, 401);
  return null;
}

function isLocalRequest(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function apiHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(data, status = 200) {
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
  bytesToHex,
};
