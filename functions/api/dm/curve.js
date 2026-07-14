import {
  apiHeaders,
  chinaDate,
  json,
  makeDmClient,
  numberFromRow,
  pickFirstDateString,
  pickFirstString,
  round,
  rowsFromDm,
  validateDmConfig,
} from "./lookup.js";
import { requireUser } from "../_auth.js";

const YIELD_CURVE_PATH = "/dm-quant-func-service/api/v1/bond/yield-curve/data";
const CHINABOND_CURVE_SOURCE = "18";
const CURVE_TYPE_YTM = "1";
const CURVE_LOOKBACK_DAYS = 7;
const MAX_CURVE_TERMS_PER_REQUEST = 5;
const CURVES = {
  cdb: {
    id: "cdb",
    name: "中债国开债收益率曲线",
    nodes: [
      { termYears: 0.1, tenor: "0.1Y" },
      { termYears: 0.2, tenor: "0.2Y", allowInterpolation: true },
      { termYears: 0.25, tenor: "0.25Y" },
      { termYears: 0.3, tenor: "0.3Y", allowInterpolation: true },
      { termYears: 0.4, tenor: "0.4Y", allowInterpolation: true },
      { termYears: 0.5, tenor: "0.5Y" },
      { termYears: 0.6, tenor: "0.6Y", allowInterpolation: true },
      { termYears: 0.7, tenor: "0.7Y", allowInterpolation: true },
      { termYears: 0.75, tenor: "0.75Y" },
      { termYears: 0.8, tenor: "0.8Y", allowInterpolation: true },
      { termYears: 0.9, tenor: "0.9Y", allowInterpolation: true },
      { termYears: 1, tenor: "1Y" },
    ],
  },
};

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const missingConfig = validateDmConfig(context.env);
  if (missingConfig) return missingConfig;

  const url = new URL(context.request.url);
  const curveId = (url.searchParams.get("curve") || "cdb").trim().toLowerCase();
  const curve = CURVES[curveId];
  if (!curve) return json({ ok: false, reason: "unsupportedCurve", hint: "暂不支持该曲线。" }, 400);

  const requestedAsOf = (url.searchParams.get("asOf") || chinaDate(new Date())).trim();
  if (!isIsoDate(requestedAsOf)) {
    return json({ ok: false, reason: "invalidAsOf", hint: "asOf 必须为 YYYY-MM-DD。" }, 400);
  }

  const startDate = offsetIsoDate(requestedAsOf, -CURVE_LOOKBACK_DAYS);
  try {
    const dm = context.data?.dmClient || makeDmClient(context.env, context.request);
    const nodeBatches = chunkItems(curve.nodes, MAX_CURVE_TERMS_PER_REQUEST);
    const rawBatches = await Promise.all(nodeBatches.map((nodes) => dm.post(YIELD_CURVE_PATH, {
      dataSource: CHINABOND_CURVE_SOURCE,
      curveName: curve.name,
      curveTermList: nodes.map((node) => formatCurveTerm(node.termYears)),
      curveType: CURVE_TYPE_YTM,
      startDate,
      endDate: requestedAsOf,
      fieldNames: ["dataSource", "curveChName", "curveTerm", "curveType", "valuationDate", "yield"],
    })));
    const snapshot = latestCurveSnapshot(rawBatches.flatMap(rowsFromDm), curve, requestedAsOf);
    const retrievedAt = new Date().toISOString();
    if (!snapshot) {
      return json({
        ok: false,
        reason: "noCurveData",
        hint: "DM 暂未返回最近可用的国开债曲线。",
        source: "DM",
        curveId: curve.id,
        curveName: curve.name,
        requestedAsOf,
        retrievedAt,
      });
    }

    const ageDays = isoDateDistance(snapshot.actualValuationDate, requestedAsOf);
    return json({
      ok: true,
      source: "DM",
      curveId: curve.id,
      curveName: curve.name,
      curveType: "到期收益率",
      unit: "%",
      requestedAsOf,
      actualValuationDate: snapshot.actualValuationDate,
      retrievedAt,
      nodes: snapshot.nodes,
      missingTerms: snapshot.missingTerms,
      derivedTerms: snapshot.derivedTerms,
      partial: snapshot.missingTerms.length > 0,
      stale: Number.isFinite(ageDays) && ageDays > 4,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "DM policy-bank curve request failed",
      curveId,
      error: String(error?.message || error).slice(0, 240),
    }));
    return json({
      ok: false,
      reason: "upstreamFailed",
      hint: "国开债曲线读取失败，请稍后重试。",
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

function latestCurveSnapshot(rows, curve, requestedAsOf) {
  const normalized = rows
    .map((row) => normalizeCurveRow(row, curve))
    .filter(Boolean)
    .filter((row) => row.valuationDate <= requestedAsOf);
  const actualValuationDate = normalized
    .map((row) => row.valuationDate)
    .sort((left, right) => right.localeCompare(left))[0];
  if (!actualValuationDate) return null;

  const rowsByTerm = new Map();
  for (const row of normalized) {
    if (row.valuationDate !== actualValuationDate || rowsByTerm.has(row.termKey)) continue;
    rowsByTerm.set(row.termKey, row);
  }
  const nodes = curve.nodes.map((definition) => {
    const row = rowsByTerm.get(curveTermKey(definition.termYears));
    const derivedYield = !row && definition.allowInterpolation
      ? interpolateCurveYield(rowsByTerm, definition.termYears)
      : null;
    return {
      termYears: definition.termYears,
      tenor: definition.tenor,
      yieldPct: row ? row.yieldPct : derivedYield?.yieldPct ?? null,
      valuationDate: actualValuationDate,
      method: row ? "dm-returned" : derivedYield ? "derived-linear" : "missing",
      anchors: derivedYield?.anchors || [],
    };
  });
  return {
    actualValuationDate,
    nodes,
    missingTerms: nodes.filter((node) => !Number.isFinite(node.yieldPct)).map((node) => node.tenor),
    derivedTerms: nodes.filter((node) => node.method === "derived-linear").map((node) => node.tenor),
  };
}

function interpolateCurveYield(rowsByTerm, termYears) {
  const rows = [...rowsByTerm.values()].sort((left, right) => left.termYears - right.termYears);
  const lower = [...rows].reverse().find((row) => row.termYears < termYears);
  const upper = rows.find((row) => row.termYears > termYears);
  if (!lower || !upper) return null;
  const span = upper.termYears - lower.termYears;
  if (!Number.isFinite(span) || span <= 0) return null;
  const weight = (termYears - lower.termYears) / span;
  return {
    yieldPct: round(lower.yieldPct + ((upper.yieldPct - lower.yieldPct) * weight), 4),
    anchors: [lower.termYears, upper.termYears],
  };
}

function normalizeCurveRow(row, curve) {
  const curveName = pickFirstString(row, ["curve_ch_name", "curveChName"]);
  if (normalizeCurveName(curveName) !== normalizeCurveName(curve.name)) return null;

  const dataSource = pickFirstString(row, ["data_source", "dataSource"]);
  if (dataSource && dataSource !== CHINABOND_CURVE_SOURCE) return null;
  const curveType = pickFirstString(row, ["curve_type", "curveType"]);
  if (curveType && curveType !== CURVE_TYPE_YTM) return null;

  const termYears = numberFromRow(row, ["curve_term", "curveTerm"]);
  const definition = curve.nodes.find((node) => Math.abs(node.termYears - termYears) < 0.0001);
  const yieldPct = numberFromRow(row, ["yield"]);
  const valuationDate = normalizeIsoDate(pickFirstDateString(row, ["valuation_date", "valuationDate"]));
  if (!definition || !Number.isFinite(yieldPct) || yieldPct <= -5 || yieldPct >= 25 || !valuationDate) return null;
  return {
    termKey: curveTermKey(definition.termYears),
    termYears: definition.termYears,
    yieldPct: round(yieldPct, 4),
    valuationDate,
  };
}

function normalizeCurveName(value = "") {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeIsoDate(value = "") {
  const match = String(value || "").match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  return isIsoDate(normalized) ? normalized : "";
}

function isIsoDate(value = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function offsetIsoDate(value, offsetDays) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isoDateDistance(from, to) {
  const fromTime = new Date(`${from}T00:00:00Z`).getTime();
  const toTime = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null;
  return Math.round((toTime - fromTime) / 86400000);
}

function curveTermKey(value) {
  return String(round(Number(value), 4));
}

function formatCurveTerm(value) {
  return curveTermKey(value);
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export const __test__ = {
  curve: CURVES.cdb,
  interpolateCurveYield,
  latestCurveSnapshot,
  normalizeCurveRow,
  normalizeIsoDate,
};
