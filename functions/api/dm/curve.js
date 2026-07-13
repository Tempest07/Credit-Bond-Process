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
const CURVES = {
  cdb: {
    id: "cdb",
    name: "中债国开债收益率曲线",
    nodes: [
      { termYears: 0.25, tenor: "3M" },
      { termYears: 0.5, tenor: "6M" },
      { termYears: 0.75, tenor: "9M" },
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
    const raw = await dm.post(YIELD_CURVE_PATH, {
      dataSource: CHINABOND_CURVE_SOURCE,
      curveName: curve.name,
      curveTermList: curve.nodes.map((node) => formatCurveTerm(node.termYears)),
      curveType: CURVE_TYPE_YTM,
      startDate,
      endDate: requestedAsOf,
      fieldNames: ["dataSource", "curveChName", "curveTerm", "curveType", "valuationDate", "yield"],
    });
    const snapshot = latestCurveSnapshot(rowsFromDm(raw), curve, requestedAsOf);
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
    return {
      termYears: definition.termYears,
      tenor: definition.tenor,
      yieldPct: row ? row.yieldPct : null,
      valuationDate: actualValuationDate,
    };
  });
  return {
    actualValuationDate,
    nodes,
    missingTerms: nodes.filter((node) => !Number.isFinite(node.yieldPct)).map((node) => node.tenor),
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

export const __test__ = {
  curve: CURVES.cdb,
  latestCurveSnapshot,
  normalizeCurveRow,
  normalizeIsoDate,
};
