import {
  apiHeaders,
  json,
  makeDmClient,
  normalizeSecurityId,
  numberFromRow,
  numberOrNull,
  pickFirstDateString,
  pickFirstString,
  round,
  rowsFromDm,
  validateDmConfig,
} from "./lookup.js";
import { requireUser } from "../_auth.js";

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const OUTSTANDING_BONDS_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/outstanding-bonds";
const MARKET_DATA_DATE_PATH = "/dm-quant-func-service/api/v1/bond/market-data/date";
const YIELD_CURVE_PATH = "/dm-quant-func-service/api/v1/bond/yield-curve/data";
const MAX_MARKET_DATA_SECURITIES = 25;
const MARKET_DATA_BATCH_SIZE = 5;
const MAX_CURVE_TERMS = 5;
const DURATION_SLOPE_BP_PER_YEAR = 5;
const PRIMARY_DURATION_CLUSTER_MIN_ITEMS = 2;
const MAX_DISPLAY_COMPARABLES = 5;
const DATA_SOURCE_LIST = [1, 2, 3, 4, 7];
const CHINABOND_CURVE_SOURCE = "18";
const CURVE_TYPE_YTM = "1";
const SUPPORTED_CHINABOND_MTN_CURVE_RATINGS = new Set(["AAA+", "AAA", "AAA-", "AA+", "AA", "AA-", "A+", "A", "A-"]);
const MARKET_DATA_FIELDS = [
  "securityId",
  "secShortName",
  "issuerName",
  "remainingTenor",
  "dataSource",
  "issueDate",
  "cbReliability",
  "cbYtm",
  "cbYte",
  "csReliability",
  "csYtm",
  "csYte",
  "spiderYield",
];

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const missingConfig = validateDmConfig(context.env);
  if (missingConfig) return missingConfig;

  const url = new URL(context.request.url);
  const issuerName = (url.searchParams.get("issuerName") || url.searchParams.get("issuer_name") || "").trim();
  const societyCode = (url.searchParams.get("societyCode") || url.searchParams.get("society_code") || "").trim();
  const durationText = (url.searchParams.get("durationText") || url.searchParams.get("duration_text") || "").trim();
  const shortName = (url.searchParams.get("shortName") || url.searchParams.get("short_name") || "").trim();
  const fullName = (url.searchParams.get("fullName") || url.searchParams.get("full_name") || "").trim();
  const offeringType = (url.searchParams.get("offeringType") || url.searchParams.get("offering_type") || "").trim();
  const venue = (url.searchParams.get("venue") || "").trim();
  const impliedRating = normalizeCurveRating(
    url.searchParams.get("hiddenRating")
    || url.searchParams.get("hidden_rating")
    || url.searchParams.get("impliedRating")
    || url.searchParams.get("implied_rating")
    || "",
  );
  const valuationDate = (url.searchParams.get("valuationDate") || url.searchParams.get("valuation_date") || previousChinaBusinessDate()).trim();

  if (!issuerName && !societyCode) {
    return json({ ok: false, reason: "missingIssuer", hint: "缺少发行人，暂无法读取 DM 可比券估值。" });
  }
  const targetDurations = targetDurationParts(durationText);
  if (!targetDurations.length) {
    return json({ ok: false, reason: "missingDuration", hint: "缺少期限，暂无法读取 DM 可比券估值。" });
  }

  try {
    const dm = makeDmClient(context.env, context.request);
    const outstanding = await lookupOutstandingBonds(dm, { issuerName, societyCode });
    if (!outstanding.rows.length) {
      return json(noComparablePayload({ issuerName, durationText, valuationDate, reason: "noOutstandingBonds", hint: "DM 未返回该主体的存续债清单。" }));
    }

    const enrichedRows = await enrichOutstandingWithBasicInfo(dm, outstanding.rows);
    const targetProfile = comparableProfile({
      shortName,
      fullName,
      venue,
      offeringType,
      durationText,
    });
    const targetOffering = normalizeOffering(offeringType);
    const targetHasExercise = durationHasExercise(durationText);
    const candidates = enrichedRows
      .map((row) => candidateFromOutstandingRow(row, { valuationDate, targetHasExercise }))
      .filter((candidate) => candidate && candidate.securityId)
      .filter((candidate) => !sameSecurity(candidate, { shortName }))
      .filter((candidate) => offeringMatches(targetOffering, candidate.offeringType))
      .filter((candidate) => profilesAreComparable(targetProfile, candidate.profile));

    if (!candidates.length) {
      return json(noComparablePayload({ issuerName, durationText, valuationDate, reason: "noSimilarBond", hint: "DM 有存续债，但未筛出同发行方式、同类属性的可比券。" }));
    }

    const valuationUniverse = candidatesForMarketData(candidates, targetDurations);
    const marketRows = await lookupMarketDataRows(dm, valuationUniverse.map((item) => item.securityId), valuationDate);
    const marketRowsBySecurityId = groupMarketRowsBySecurityId(marketRows);
    const pricedCandidates = candidates
      .map((candidate) => ({
        ...candidate,
        valuation: pickDmValuationRate(marketRowsBySecurityId.get(candidate.securityId) || [], targetHasExercise),
      }))
      .filter((candidate) => Number.isFinite(candidate.valuation?.rate));

    let trancheSuggestions = targetDurations
      .map((target, index) => buildTrancheSuggestion(target, index, pricedCandidates, targetProfile, targetHasExercise))
      .filter(Boolean);
    if (impliedRating && trancheSuggestions.some(shouldTryCurveCalibration)) {
      trancheSuggestions = await Promise.all(trancheSuggestions.map((suggestion) => maybeApplyCurveCalibration(dm, {
        suggestion,
        impliedRating,
        valuationDate,
        targetProfile,
      })));
    }

    if (!trancheSuggestions.length) {
      return json(noComparablePayload({ issuerName, durationText, valuationDate, reason: "noValuation", hint: "DM 有可比存续债，但上一日估值字段未返回中债/中证/上清所收益率。" }));
    }

    return json({
      ok: true,
      source: "DM market-data/date",
      query: { issuerName, societyCode, durationText, offeringType, shortName, impliedRating, valuationDate },
      valuationDate,
      targetProfile,
      candidateCount: candidates.length,
      pricedCandidateCount: pricedCandidates.length,
      trancheSuggestions,
      diagnostic: {
        outstandingRows: outstanding.rows.length,
        outstandingPages: outstanding.pages,
        marketRows: marketRows.length,
        curveCalibratedSuggestions: trancheSuggestions.filter((item) => item.clusterMode === "curveResidualCalibration").length,
      },
    });
  } catch (error) {
    return json({
      ok: false,
      reason: "dmError",
      error: error.message || "DM 估值助手查询失败",
      hint: "请检查 DM 估值接口权限、INNO 密钥配置，或稍后重试。",
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function lookupOutstandingBonds(dm, { issuerName, societyCode }) {
  const rows = [];
  const pages = [];
  const seen = new Set();
  const queries = [
    ...(societyCode ? [{ source: "societyCode", societyCode }] : []),
    ...(issuerName ? [{ source: "issuerFullName", issuerFullName: issuerName }] : []),
  ];
  for (const query of queries) {
    const beforeCount = rows.length;
    let offset = 0;
    for (let page = 0; page < 5; page += 1) {
      const payload = {
        bondStatusList: [2],
        offset,
        ...(query.issuerFullName ? { issuerFullName: query.issuerFullName } : {}),
        ...(query.societyCode ? { societyCode: query.societyCode } : {}),
      };
      const raw = await dm.post(OUTSTANDING_BONDS_PATH, payload);
      const pageRows = rowsFromDm(raw);
      for (const row of pageRows) {
        const key = normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"])) || JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      const nextOffset = raw?.maxOffset ?? raw?.max_offset ?? raw?.Max_Offset ?? raw?.max_Offset;
      pages.push({ source: query.source, offset, count: pageRows.length, nextOffset: nextOffset ?? null });
      if (!pageRows.length || nextOffset === undefined || nextOffset === null || String(nextOffset) === String(offset)) break;
      offset = nextOffset;
    }
    if (rows.length > beforeCount) break;
  }
  return { rows, pages };
}

async function enrichOutstandingWithBasicInfo(dm, rows) {
  const securityIds = [...new Set(rows.map((row) => normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]))).filter(Boolean))];
  const basicRows = [];
  for (let index = 0; index < securityIds.length; index += 200) {
    const securityIdList = securityIds.slice(index, index + 200);
    if (!securityIdList.length) continue;
    const raw = await dm.post(BASIC_INFO_PATH, {
      securityIdList,
      fieldNames: [
        "securityId",
        "secShortName",
        "secFullName",
        "issuerName",
        "nextOptionDate",
        "actuEndDate",
        "matuPayDate",
        "remainingTenor",
        "bondMatu",
        "bondTypeDesc",
        "paymentOrder",
        "specialItem",
        "isCrosMar",
      ],
    });
    basicRows.push(...rowsFromDm(raw));
  }
  const basicById = new Map(basicRows.map((row) => [normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"])), row]));
  return rows.map((row) => {
    const securityId = normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]));
    return { ...row, ...(basicById.get(securityId) || {}) };
  });
}

async function lookupMarketDataRows(dm, securityIds, valuationDate) {
  const rows = [];
  const uniqueIds = [...new Set(securityIds.map(normalizeSecurityId).filter(Boolean))].slice(0, MAX_MARKET_DATA_SECURITIES);
  for (let index = 0; index < uniqueIds.length; index += MARKET_DATA_BATCH_SIZE) {
    const securityIdList = uniqueIds.slice(index, index + MARKET_DATA_BATCH_SIZE);
    const raw = await dm.post(MARKET_DATA_DATE_PATH, {
      securityIdList,
      dataSourceList: DATA_SOURCE_LIST,
      startDate: valuationDate,
      endDate: valuationDate,
      fieldNames: MARKET_DATA_FIELDS,
    });
    rows.push(...rowsFromDm(raw));
  }
  return rows;
}

async function lookupYieldCurveRows(dm, { impliedRating, terms, valuationDate }) {
  const curveName = chinaBondMtnCurveName(impliedRating);
  const curveTermList = normalizeCurveTerms(terms).slice(0, MAX_CURVE_TERMS);
  if (!curveName || !curveTermList.length) return { curveName, rows: [], raw: null };
  const raw = await dm.post(YIELD_CURVE_PATH, {
    dataSource: CHINABOND_CURVE_SOURCE,
    curveName,
    curveTermList,
    curveType: CURVE_TYPE_YTM,
    startDate: valuationDate,
    endDate: valuationDate,
    fieldNames: ["curveChName", "curveTerm", "curveType", "valuationDate", "yield"],
  });
  return { curveName, rows: rowsFromDm(raw), raw };
}

function candidateFromOutstandingRow(row, { valuationDate, targetHasExercise }) {
  const securityId = normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]));
  const shortName = pickFirstString(row, ["sec_short_name", "secShortName"]);
  const fullName = pickFirstString(row, ["sec_full_name", "secFullName"]);
  const nextOptionDate = pickFirstDateString(row, ["next_option_date", "nextOptionDate"]);
  const years = comparableYears(row, valuationDate, targetHasExercise);
  if (!Number.isFinite(years) || years <= 0) return null;
  const profile = comparableProfile(row);
  return {
    securityId,
    shortName,
    fullName,
    issuerName: pickFirstString(row, ["issuer_name", "issuerName"]),
    durationText: pickFirstString(row, ["remaining_tenor", "remainingTenor", "bond_issue_tenor", "bondIssueTenor", "bond_matu", "bondMatu"]),
    years,
    nextOptionDate,
    offeringType: inferOfferingType(row),
    bondTypeDesc: pickFirstString(row, ["bond_type_desc", "bondTypeDesc"]),
    profile,
    raw: row,
  };
}

function comparableYears(row, valuationDate, targetHasExercise) {
  const nextOptionDate = pickFirstDateString(row, ["next_option_date", "nextOptionDate"]);
  if (targetHasExercise && nextOptionDate) {
    const years = yearsBetween(valuationDate, nextOptionDate);
    if (Number.isFinite(years) && years > 0) return years;
  }
  return durationToYears(pickFirstString(row, ["remaining_tenor", "remainingTenor"]))
    ?? durationToYears(pickFirstString(row, ["bond_issue_tenor", "bondIssueTenor", "bond_matu", "bondMatu"]));
}

function candidatesForMarketData(candidates, targets) {
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    nearestGap: Math.min(...targets.map((target) => Math.abs(candidate.years - target.years))),
  }));
  return ranked
    .filter((candidate) => candidate.nearestGap <= maxDurationGapYears(candidate.years))
    .sort((left, right) => left.nearestGap - right.nearestGap || left.shortName.localeCompare(right.shortName, "zh-Hans-CN"))
    .slice(0, MAX_MARKET_DATA_SECURITIES);
}

function buildTrancheSuggestion(target, index, candidates, targetProfile, preferExercise) {
  const maxGap = maxDurationGapYears(target.years);
  const allComparableItems = candidates
    .map((candidate) => {
      const durationGapYears = target.years - candidate.years;
      const absoluteGapYears = Math.abs(durationGapYears);
      if (absoluteGapYears > maxGap) return null;
      const durationAdjustment = (durationGapYears * DURATION_SLOPE_BP_PER_YEAR) / 100;
      const marketAdjustment = marketQualityAdjustment(targetProfile, candidate.profile);
      const adjustment = durationAdjustment + marketAdjustment;
      return {
        shortName: candidate.shortName,
        securityId: candidate.securityId,
        durationText: candidate.durationText,
        years: round(candidate.years, 2),
        rate: candidate.valuation.rate,
        source: candidate.valuation.source,
        reliability: candidate.valuation.reliability,
        valuationDate: candidate.valuation.valuationDate,
        durationGapYears: round(durationGapYears, 4),
        durationAdjustment: round(durationAdjustment, 4),
        marketAdjustment: round(marketAdjustment, 4),
        adjustment: round(adjustment, 4),
        adjustedRate: round(candidate.valuation.rate + adjustment, 4),
        absoluteGapYears: round(absoluteGapYears, 4),
        candidateMarketPremiumBp: marketQualityPremiumBp(candidate.profile),
        targetMarketPremiumBp: marketQualityPremiumBp(targetProfile),
        weight: 1 / (0.35 + absoluteGapYears),
      };
    })
    .filter(Boolean)
    .sort(compareDurationGapThenName);

  const cluster = selectPrimaryDurationCluster(allComparableItems, target.years);
  const comparableItems = cluster.items;
  if (!comparableItems.length) return null;
  const totalWeight = comparableItems.reduce((sum, item) => sum + item.weight, 0);
  const center = round(comparableItems.reduce((sum, item) => sum + item.adjustedRate * item.weight, 0) / totalWeight, 2);
  const spread = suggestionSpread(comparableItems, center, cluster);
  return {
    index,
    durationText: target.durationText,
    years: round(target.years, 2),
    center,
    low: round(center - spread, 2),
    high: round(center + spread, 2),
    confidence: confidenceLabel(comparableItems, cluster),
    clusterMode: cluster.mode,
    clusterNote: cluster.note,
    comparableCount: comparableItems.length,
    profileLabel: comparableProfileLabel(targetProfile),
    valuationDate: comparableItems[0]?.valuationDate || "",
    preferredYield: preferExercise ? "行权收益率" : "到期收益率",
    method: `DM 存续债上一日估值；${cluster.note}；期限差按约 ${DURATION_SLOPE_BP_PER_YEAR}bp/年机械调整，并纳入普通交易所约1bp、交易所科创债约4bp的口径调整`,
    comparableItems,
  };
}

function shouldTryCurveCalibration(suggestion) {
  return suggestion?.clusterMode && suggestion.clusterMode !== "nearestCluster";
}

async function maybeApplyCurveCalibration(dm, { suggestion, impliedRating, valuationDate, targetProfile }) {
  if (!shouldTryCurveCalibration(suggestion)) return suggestion;
  const curveName = chinaBondMtnCurveName(impliedRating);
  if (!curveName) return {
    ...suggestion,
    clusterNote: `${suggestion.clusterNote}；隐含评级缺少可用中债中短票曲线`,
  };
  const curveTerms = [suggestion.years, ...suggestion.comparableItems.map((item) => item.years)];
  const curve = await lookupYieldCurveRows(dm, { impliedRating, terms: curveTerms, valuationDate });
  const curveByTerm = curveRowsByTerm(curve.rows);
  const targetCurveYield = curveYieldForTerm(curveByTerm, suggestion.years);
  if (!Number.isFinite(targetCurveYield)) return suggestion;

  const residualItems = suggestion.comparableItems
    .map((item) => {
      const curveYield = curveYieldForTerm(curveByTerm, item.years);
      if (!Number.isFinite(curveYield)) return null;
      const ordinaryEquivalentRate = item.rate + ((item.candidateMarketPremiumBp || 0) / 100);
      const residual = ordinaryEquivalentRate - curveYield;
      return {
        ...item,
        curveYield: round(curveYield, 4),
        curveResidual: round(residual, 4),
        curveResidualBp: round(residual * 100, 1),
      };
    })
    .filter(Boolean);
  if (!residualItems.length) return suggestion;

  const totalWeight = residualItems.reduce((sum, item) => sum + item.weight, 0);
  const averageResidual = residualItems.reduce((sum, item) => sum + item.curveResidual * item.weight, 0) / totalWeight;
  const residualDeviation = weightedValueDeviation(residualItems, averageResidual, "curveResidual");
  const targetPremium = marketQualityPremiumBp(targetProfile) / 100;
  const targetCurveAdjusted = targetCurveYield - targetPremium;
  const center = round(targetCurveAdjusted + averageResidual, 2);
  const spread = curveCalibrationSpread(residualItems, residualDeviation);
  const residualDeviationBp = round(residualDeviation * 100, 1);
  const averageResidualBp = round(averageResidual * 100, 1);

  return {
    ...suggestion,
    center,
    low: round(center - spread, 2),
    high: round(center + spread, 2),
    confidence: curveCalibrationConfidence(residualItems, residualDeviationBp),
    clusterMode: "curveResidualCalibration",
    clusterNote: "目标附近无足够券，采用隐含评级中债中短票曲线 + 主体曲线偏离校准",
    method: `DM 存续债上一日估值；目标附近无足够券，按${impliedRating}隐含评级中债中短票曲线加主体曲线偏离${formatSignedBp(averageResidualBp)}校准；不使用主体评级`,
    comparableItems: residualItems,
    curveCalibration: {
      curveName,
      impliedRating,
      targetCurveYield: round(targetCurveYield, 4),
      targetCurveAdjusted: round(targetCurveAdjusted, 4),
      averageResidual: round(averageResidual, 4),
      averageResidualBp,
      residualDeviation: round(residualDeviation, 4),
      residualDeviationBp,
      itemCount: residualItems.length,
      valuationDate,
    },
  };
}

function curveRowsByTerm(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const term = numberFromRow(row, ["curve_term", "curveTerm"]);
    const yieldRate = numberFromRow(row, ["yield"]);
    if (!Number.isFinite(term) || !Number.isFinite(yieldRate)) continue;
    map.set(curveTermKey(term), {
      term,
      yieldRate,
      curveName: pickFirstString(row, ["curve_ch_name", "curveChName"]),
      valuationDate: pickFirstDateString(row, ["valuation_date", "valuationDate"]),
    });
  }
  return map;
}

function curveYieldForTerm(curveByTerm, years) {
  const exact = curveByTerm.get(curveTermKey(years));
  if (exact) return exact.yieldRate;
  let best = null;
  for (const value of curveByTerm.values()) {
    const gap = Math.abs(value.term - years);
    if (gap > 0.02) continue;
    if (!best || gap < best.gap) best = { ...value, gap };
  }
  return best?.yieldRate ?? null;
}

function normalizeCurveTerms(terms = []) {
  const seen = new Set();
  const result = [];
  for (const term of terms) {
    const value = Number(term);
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = curveTermKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(formatCurveTerm(value));
  }
  return result;
}

function curveTermKey(value) {
  return String(round(Number(value), 4));
}

function formatCurveTerm(value) {
  return String(round(Number(value), 4));
}

function chinaBondMtnCurveName(impliedRating) {
  const rating = normalizeCurveRating(impliedRating);
  return rating ? `中债中短期票据收益率曲线(${rating})` : "";
}

function normalizeCurveRating(value = "") {
  const rating = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
  if (!SUPPORTED_CHINABOND_MTN_CURVE_RATINGS.has(rating)) return "";
  return rating;
}

function curveCalibrationSpread(items, residualDeviation) {
  return items.length <= 1 ? 0.08 : Math.max(0.05, Math.min(0.18, residualDeviation));
}

function curveCalibrationConfidence(items, residualDeviationBp) {
  if (items.length >= 3 && residualDeviationBp <= 5) return "中等";
  if (items.length >= 2 && residualDeviationBp <= 8) return "中等";
  return "较低";
}

function weightedValueDeviation(items, center, key) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const variance = items.reduce((sum, item) => sum + ((item[key] - center) ** 2) * item.weight, 0) / totalWeight;
  return Math.sqrt(variance);
}

function formatSignedBp(value) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}bp`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(round(number, 1));
}

function selectPrimaryDurationCluster(items, targetYears) {
  const sorted = [...items].sort(compareDurationGapThenName);
  if (!sorted.length) return { items: [], mode: "empty", note: "暂无可用期限簇" };

  const tightGap = primaryDurationClusterGapYears(targetYears);
  const tightCluster = sorted.filter((item) => itemAbsoluteGap(item) <= tightGap);
  if (tightCluster.length >= PRIMARY_DURATION_CLUSTER_MIN_ITEMS) {
    return {
      items: tightCluster.slice(0, MAX_DISPLAY_COMPARABLES),
      mode: "nearestCluster",
      note: "中心值优先采用最近期限簇",
    };
  }
  if (tightCluster.length === 1) {
    const expandedGap = Math.min(maxDurationGapYears(targetYears), tightGap + fallbackDurationClusterGapYears(targetYears));
    const expanded = sorted.filter((item) => itemAbsoluteGap(item) <= expandedGap).slice(0, MAX_DISPLAY_COMPARABLES);
    return {
      items: expanded.length ? expanded : tightCluster,
      mode: expanded.length >= PRIMARY_DURATION_CLUSTER_MIN_ITEMS ? "sparseNearCluster" : "singleAnchor",
      note: expanded.length >= PRIMARY_DURATION_CLUSTER_MIN_ITEMS
        ? "目标附近可比券不足，采用最近锚点并有限扩展相邻期限"
        : "目标附近仅1只可比券，采用最近锚点并降低置信度",
    };
  }

  const shorter = sorted.filter((item) => item.durationGapYears > 0).sort(compareDurationGapThenName);
  const longer = sorted.filter((item) => item.durationGapYears < 0).sort(compareDurationGapThenName);
  if (shorter.length && longer.length) {
    return {
      items: [shorter[0], longer[0]].sort(compareDurationGapThenName),
      mode: "bracketInterpolation",
      note: "目标附近无足够券，采用上下相邻期限插值并降低置信度",
    };
  }

  const nearestGap = itemAbsoluteGap(sorted[0]);
  const fallbackGap = Math.min(maxDurationGapYears(targetYears), nearestGap + fallbackDurationClusterGapYears(targetYears));
  const oneSideItems = sorted
    .filter((item) => itemAbsoluteGap(item) <= fallbackGap)
    .slice(0, MAX_DISPLAY_COMPARABLES);
  return {
    items: oneSideItems.length ? oneSideItems : [sorted[0]],
    mode: "oneSidedExtrapolation",
    note: "目标附近无足够券，采用单侧最近期限外推，置信度较低",
  };
}

function suggestionSpread(items, center, cluster) {
  const baseSpread = items.length === 1 ? 0.05 : Math.max(0.03, Math.min(0.15, weightedDeviation(items, center)));
  if (cluster.mode === "nearestCluster") return baseSpread;
  if (cluster.mode === "sparseNearCluster") return Math.max(baseSpread, 0.05);
  if (cluster.mode === "singleAnchor") return Math.max(baseSpread, 0.08);
  if (cluster.mode === "bracketInterpolation") return Math.max(baseSpread, 0.06);
  if (cluster.mode === "oneSidedExtrapolation") return Math.max(baseSpread, 0.08);
  return baseSpread;
}

function primaryDurationClusterGapYears(years) {
  if (years <= 1) return 0.15;
  if (years <= 3) return 0.35;
  if (years <= 5) return 0.5;
  return 0.75;
}

function fallbackDurationClusterGapYears(years) {
  if (years <= 1) return 0.2;
  if (years <= 3) return 0.4;
  if (years <= 5) return 0.5;
  return 0.75;
}

function compareDurationGapThenName(left, right) {
  return itemAbsoluteGap(left) - itemAbsoluteGap(right)
    || left.shortName.localeCompare(right.shortName, "zh-Hans-CN");
}

function itemAbsoluteGap(item) {
  return Number.isFinite(item.absoluteGapYears) ? item.absoluteGapYears : Math.abs(item.durationGapYears || 0);
}

function pickDmValuationRate(rows, preferExercise) {
  const priorities = preferExercise
    ? [
        [["cb_yte", "cbYte"], "中债行权估值", ["cb_reliability", "cbReliability"]],
        [["cs_yte", "csYte"], "中证行权估值", ["cs_reliability", "csReliability"]],
        [["cb_ytm", "cbYtm"], "中债到期估值", ["cb_reliability", "cbReliability"]],
        [["cs_ytm", "csYtm"], "中证到期估值", ["cs_reliability", "csReliability"]],
        [["spider_yield", "spiderYield"], "上清所估值", []],
      ]
    : [
        [["cb_ytm", "cbYtm"], "中债到期估值", ["cb_reliability", "cbReliability"]],
        [["cs_ytm", "csYtm"], "中证到期估值", ["cs_reliability", "csReliability"]],
        [["cb_yte", "cbYte"], "中债行权估值", ["cb_reliability", "cbReliability"]],
        [["cs_yte", "csYte"], "中证行权估值", ["cs_reliability", "csReliability"]],
        [["spider_yield", "spiderYield"], "上清所估值", []],
      ];
  for (const [keys, source, reliabilityKeys] of priorities) {
    for (const row of rows) {
      const rate = numberFromRow(row, keys);
      if (!Number.isFinite(rate)) continue;
      return {
        rate,
        source,
        reliability: pickFirstString(row, reliabilityKeys),
        valuationDate: pickFirstDateString(row, ["valuation_date", "valuationDate", "issue_date", "issueDate"]),
      };
    }
  }
  return null;
}

function groupMarketRowsBySecurityId(rows) {
  const map = new Map();
  for (const row of rows) {
    const securityId = normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]));
    if (!securityId) continue;
    if (!map.has(securityId)) map.set(securityId, []);
    map.get(securityId).push(row);
  }
  return map;
}

function noComparablePayload({ issuerName, durationText, valuationDate, reason, hint }) {
  return {
    ok: false,
    reason,
    hint,
    source: "DM market-data/date",
    query: { issuerName, durationText, valuationDate },
    valuationDate,
    trancheSuggestions: [],
  };
}

function targetDurationParts(durationText) {
  return splitDurationParts(durationText)
    .map((part) => ({ durationText: part, years: durationToYears(part) }))
    .filter((item) => Number.isFinite(item.years) && item.years > 0);
}

function splitDurationParts(value = "") {
  const text = String(value || "").trim().toUpperCase().replace(/期$/, "");
  const unit = text.match(/(D|M|Y|天|日|月|年)$/i)?.[1] || "";
  if (!unit) return text ? [text] : [];
  return text.slice(0, -unit.length).split("/").map((part) => `${part}${unit}`).filter(Boolean);
}

function durationToYears(value = "") {
  const text = String(value || "").trim().toUpperCase().replace(/期$/, "");
  let match = text.match(/^(\d+(?:\.\d+)?)\s*(D|天|日)$/i);
  if (match) return Number(match[1]) / 365;
  match = text.match(/^(\d+(?:\.\d+)?)\s*(M|月)$/i);
  if (match) return Number(match[1]) / 12;
  match = text.match(/^([\d.+/]+)\s*(Y|年)$/i);
  if (match) {
    const years = match[1].split("/").map((part) => Number(part.split("+")[0])).filter(Number.isFinite);
    return years.length ? Math.max(...years) : null;
  }
  match = text.match(/(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?/i);
  if (match && match[0]) {
    return (Number(match[1] || 0)) + (Number(match[2] || 0) / 12) + (Number(match[3] || 0) / 365);
  }
  return null;
}

function durationHasExercise(value = "") {
  return /\d\s*\+/.test(String(value || ""));
}

function maxDurationGapYears(years) {
  if (years <= 1) return 0.5;
  if (years <= 3) return 1.25;
  if (years <= 5) return 2;
  return 3;
}

function yearsBetween(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;
  return (end.getTime() - start.getTime()) / (365 * 24 * 60 * 60 * 1000);
}

function parseDate(value = "") {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function comparableProfile(source = {}) {
  const tenorText = [
    source.remaining_tenor,
    source.remainingTenor,
    source.bond_issue_tenor,
    source.bondIssueTenor,
    source.bond_matu,
    source.bondMatu,
  ].filter(Boolean).join(" ").toUpperCase();
  const text = [
    source.shortName,
    source.sec_short_name,
    source.secShortName,
    source.fullName,
    source.sec_full_name,
    source.secFullName,
    source.venue,
    source.offeringType,
    source.bond_type_desc,
    source.bondTypeDesc,
    source.payment_order,
    source.paymentOrder,
    source.special_item,
    source.specialItem,
    source.durationText,
    tenorText,
  ].filter(Boolean).join(" ").toUpperCase();
  return {
    bondClass: bondClassFromText(text),
    market: marketFromText(text),
    exchangeTech: marketFromText(text) === "exchange" && /科创|科技创新|创新创业|双创/.test(text),
    perpetual: textHasPerpetualTerms(text) || tenorLooksPerpetual(tenorText),
    subordinated: /次级|二级资本|资本补充|TLAC|清偿顺序|劣后/.test(text),
    structured: /ABS|ABN|资产支持|可转债|可交换|REIT|项目收益/.test(text),
  };
}

function textHasPerpetualTerms(text = "") {
  return /永续|可续期|无固定期限|续期中票|续期选择权|发行人续期|递延支付|利息递延|可递延|PERP/.test(text);
}

function tenorLooksPerpetual(text = "") {
  const value = String(text || "").toUpperCase().replace(/\s+/g, "");
  if (!value) return false;
  return /\+\s*N/.test(value);
}

function profilesAreComparable(target, candidate) {
  if (
    target.bondClass
    && candidate.bondClass
    && target.bondClass !== candidate.bondClass
    && !bondClassesCrossMarketComparable(target.bondClass, candidate.bondClass)
  ) return false;
  return target.perpetual === candidate.perpetual
    && target.subordinated === candidate.subordinated
    && target.structured === candidate.structured;
}

function bondClassesCrossMarketComparable(targetClass, candidateClass) {
  const publicOrdinary = new Set(["MTN", "公司债", "企业债"]);
  return publicOrdinary.has(targetClass) && publicOrdinary.has(candidateClass);
}

function bondClassFromText(text = "") {
  if (/SCP|超短期融资券/.test(text)) return "SCP";
  if (/(^|[^S])CP|短期融资券/.test(text)) return "CP";
  if (/MTN|中期票据/.test(text)) return "MTN";
  if (/PPN|定向债务融资工具/.test(text)) return "PPN";
  if (/企业债/.test(text)) return "企业债";
  if (/公司债|小公募|私募债|\.SH|\.SZ|上交所|深交所/.test(text)) return "公司债";
  return "";
}

function comparableProfileLabel(profile = {}) {
  const labels = [];
  if (profile.bondClass) labels.push(profile.bondClass);
  if (profile.market === "exchange") labels.push(profile.exchangeTech ? "交易所科创" : "交易所");
  if (profile.market === "interbank") labels.push("银行间");
  labels.push(profile.perpetual ? "永续" : "非永续");
  if (profile.subordinated) labels.push("次级/资本类");
  if (profile.structured) labels.push("结构化");
  return labels.join(" · ");
}

function marketFromText(text = "") {
  if (/\.SH|\.SZ|上交所|深交所|交易所|公司债/.test(text)) return "exchange";
  if (/\.IB|银行间|SCP|MTN|PPN|短期融资券|中期票据|定向债务融资工具/.test(text)) return "interbank";
  return "";
}

function marketQualityAdjustment(targetProfile = {}, candidateProfile = {}) {
  return (marketQualityPremiumBp(candidateProfile) - marketQualityPremiumBp(targetProfile)) / 100;
}

function marketQualityPremiumBp(profile = {}) {
  if (profile.market !== "exchange") return 0;
  if (profile.exchangeTech) return 4;
  return 1;
}

function inferOfferingType(row = {}) {
  const text = [
    pickFirstString(row, ["public_offering_status", "publicOfferingStatus"]),
    pickFirstString(row, ["sec_short_name", "secShortName"]),
    pickFirstString(row, ["sec_full_name", "secFullName"]),
    pickFirstString(row, ["bond_type_desc", "bondTypeDesc"]),
  ].filter(Boolean).join(" ");
  return normalizeOffering(text);
}

function normalizeOffering(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/公私/.test(text)) return "mixed";
  if (/非公开|私募|定向|PPN/.test(text)) return "private";
  if (/公开|公募|SCP|短期融资券|CP|MTN|中期票据|公司债券/.test(text)) return "public";
  return "";
}

function offeringMatches(targetOffering, candidateOffering) {
  if (!targetOffering || targetOffering === "mixed") return true;
  if (!candidateOffering || candidateOffering === "mixed") return targetOffering === "public";
  return targetOffering === candidateOffering;
}

function sameSecurity(candidate, target) {
  const targetName = normalizeName(target.shortName);
  return Boolean(targetName && normalizeName(candidate.shortName) === targetName);
}

function normalizeName(value = "") {
  return String(value || "").toUpperCase().replace(/\s+/g, "").trim();
}

function confidenceLabel(items = [], cluster = {}) {
  if (cluster.mode === "singleAnchor" || cluster.mode === "oneSidedExtrapolation") return "较低";
  if (cluster.mode === "bracketInterpolation" || cluster.mode === "sparseNearCluster") return "中等";
  if (items.length >= 4 && items.every((item) => Math.abs(item.durationGapYears) <= 1)) return "较高";
  if (items.length >= 2) return "中等";
  return "较低";
}

function weightedDeviation(items, center) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const variance = items.reduce((sum, item) => sum + ((item.adjustedRate - center) ** 2) * item.weight, 0) / totalWeight;
  return Math.sqrt(variance);
}

function previousChinaBusinessDate(reference = new Date()) {
  const chinaNow = new Date(reference.getTime() + 8 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), chinaNow.getUTCDate()));
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export const __test__ = {
  buildTrancheSuggestion,
  chinaBondMtnCurveName,
  durationToYears,
  normalizeCurveRating,
  previousChinaBusinessDate,
  pickDmValuationRate,
  selectPrimaryDurationCluster,
};
