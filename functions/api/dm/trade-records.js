import {
  apiHeaders,
  json,
  makeDmClient,
  normalizeSecurityId,
  numberFromRow,
  pickFirstDateString,
  pickFirstString,
  rowsFromDm,
  validateDmConfig,
} from "./lookup.js";
import { requireUser } from "../_auth.js";

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const MARKET_DATA_DATE_PATH = "/dm-quant-func-service/api/v1/bond/market-data/date";
const MAX_ROWS = 80;
const BASIC_INFO_BATCH_SIZE = 200;
const MARKET_DATA_BATCH_SIZE = 5;
const MARKET_DATA_LOOKBACK_DAYS = 7;
const DATA_SOURCE_LIST = [1, 3, 4, 7];
const BASIC_INFO_FIELDS = [
  "securityId",
  "secShortName",
  "bondType",
  "bondTypeDesc",
  "nextOptionDate",
  "bondMatu",
  "specialItem",
];
const MARKET_DATA_FIELDS = [
  "securityId",
  "secShortName",
  "issueDate",
  "dataSource",
  "cbReliability",
  "cbYtm",
  "cbYte",
];

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const missingConfig = validateDmConfig(context.env);
  if (missingConfig) return missingConfig;

  let input;
  try {
    input = await context.request.json();
  } catch {
    return json({ ok: false, reason: "invalidJson", hint: "请求内容不是有效 JSON。" }, 400);
  }
  const requestRows = normalizeRequestRows(input?.rows);
  if (!requestRows.length) {
    return json({ ok: false, reason: "missingRows", hint: "没有可查询的债券代码。" }, 400);
  }

  try {
    const dm = context.data?.dmClient || makeDmClient(context.env, context.request);
    const securityIds = [...new Set(requestRows.map((row) => row.securityId))];
    const basicRows = await lookupBasicInfo(dm, securityIds);
    const marketRows = await lookupMarketData(dm, requestRows);
    const basicById = latestRowsBySecurityId(basicRows);
    const results = requestRows.map((row) =>
      buildResult(row, basicById.get(row.securityId), marketRows)
    );
    return json({
      ok: true,
      source: "DM",
      formulaMapping: {
        shortName: "bond/basic-info/info.secShortName",
        bondType: "bond/basic-info/info.bondTypeDesc",
        valuationYield: "bond/market-data/date.cbYte/cbYtm（按中债推荐口径）",
      },
      rows: results,
      queriedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "DM trade-record lookup failed",
      error: String(error?.message || error).slice(0, 240),
    }));
    return json({
      ok: false,
      reason: "dmError",
      hint: "DM 成交台账字段读取失败，请稍后重试。",
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function lookupBasicInfo(dm, securityIds) {
  const rows = [];
  for (let index = 0; index < securityIds.length; index += BASIC_INFO_BATCH_SIZE) {
    const securityIdList = securityIds.slice(index, index + BASIC_INFO_BATCH_SIZE);
    const raw = await dm.post(BASIC_INFO_PATH, {
      securityIdList,
      fieldNames: BASIC_INFO_FIELDS,
    });
    rows.push(...rowsFromDm(raw));
  }
  return rows;
}

async function lookupMarketData(dm, requestRows) {
  const rows = [];
  const groups = new Map();
  for (const row of requestRows) {
    if (!groups.has(row.requestedDate)) groups.set(row.requestedDate, new Set());
    groups.get(row.requestedDate).add(row.securityId);
  }
  for (const [requestedDate, ids] of groups) {
    const securityIds = [...ids];
    for (let index = 0; index < securityIds.length; index += MARKET_DATA_BATCH_SIZE) {
      const securityIdList = securityIds.slice(index, index + MARKET_DATA_BATCH_SIZE);
      const raw = await dm.post(MARKET_DATA_DATE_PATH, {
        securityIdList,
        dataSourceList: DATA_SOURCE_LIST,
        startDate: offsetIsoDate(requestedDate, -MARKET_DATA_LOOKBACK_DAYS),
        endDate: requestedDate,
        fieldNames: MARKET_DATA_FIELDS,
      });
      rows.push(...rowsFromDm(raw));
    }
  }
  return rows;
}

function buildResult(requestRow, basicRow, marketRows) {
  const valuation = pickChinaBondValuation(
    marketRows,
    requestRow.securityId,
    requestRow.requestedDate,
    bondPrefersExerciseYield(basicRow, requestRow.requestedDate),
  );
  const shortName = pickFirstString(basicRow || {}, ["sec_short_name", "secShortName"]);
  const bondType = pickFirstString(basicRow || {}, ["bond_type_desc", "bondTypeDesc"]);
  const missing = [];
  if (!shortName) missing.push("债券简称");
  if (!bondType) missing.push("债券类型");
  if (!Number.isFinite(valuation?.yield)) missing.push("估值收益率");
  return {
    id: requestRow.id,
    securityId: requestRow.securityId,
    shortName,
    bondType,
    valuationYield: Number.isFinite(valuation?.yield) ? valuation.yield : null,
    valuationField: Number.isFinite(valuation?.yield) ? valuation.field : "",
    requestedDate: requestRow.requestedDate,
    valuationDate: valuation?.date || "",
    status: missing.length === 0 ? "complete" : missing.length < 3 ? "partial" : "missing",
    missing,
    queriedAt: new Date().toISOString(),
  };
}

function pickChinaBondValuation(rows, securityId, requestedDate, preferExercise = false) {
  return rows
    .map((row) => {
      const rowSecurityId = normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]));
      const date = marketRowDate(row);
      const ytm = numberFromRow(row, ["cb_ytm", "cbYtm"]);
      const yte = numberFromRow(row, ["cb_yte", "cbYte"]);
      const useExercise = preferExercise && Number.isFinite(yte);
      const yieldValue = useExercise ? yte : ytm;
      return {
        row,
        securityId: rowSecurityId,
        date,
        yield: yieldValue,
        field: useExercise ? "cbYte" : "cbYtm",
        reliability: pickFirstString(row, ["cb_reliability", "cbReliability"]),
        dataSource: numberFromRow(row, ["data_source", "dataSource"]),
      };
    })
    .filter((item) =>
      item.securityId === securityId
      && isIsoDate(item.date)
      && item.date <= requestedDate
      && Number.isFinite(item.yield)
      && item.yield > -5
      && item.yield < 25
    )
    .sort((left, right) =>
      right.date.localeCompare(left.date)
      || reliabilityRank(right.reliability) - reliabilityRank(left.reliability)
      || dataSourceRank(left.dataSource) - dataSourceRank(right.dataSource)
    )[0] || null;
}

function bondPrefersExerciseYield(row, requestedDate = "") {
  const nextOptionDate = pickFirstDateString(row || {}, ["next_option_date", "nextOptionDate"]);
  if (nextOptionDate && (!requestedDate || nextOptionDate >= requestedDate)) return true;
  const text = [
    pickFirstString(row || {}, ["bond_matu", "bondMatu"]),
    pickFirstString(row || {}, ["special_item", "specialItem"]),
  ].filter(Boolean).join(" ");
  return /\d+(?:\.\d+)?\s*[Y年]?\s*\+\s*\d|回售|赎回|调整票面利率|投资者选择权|发行人选择权/.test(text);
}

function normalizeRequestRows(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_ROWS).map((row, index) => {
    const securityId = normalizeSecurityId(row?.securityId || row?.security_id || "");
    const negotiationDate = isIsoDate(row?.negotiationDate) ? row.negotiationDate : "";
    return {
      id: String(row?.id || index),
      securityId,
      negotiationDate,
      requestedDate: negotiationDate ? offsetIsoDate(negotiationDate, -1) : "",
    };
  }).filter((row) => row.securityId && row.requestedDate);
}

function latestRowsBySecurityId(rows) {
  const result = new Map();
  for (const row of rows) {
    const securityId = normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]));
    if (securityId && !result.has(securityId)) result.set(securityId, row);
  }
  return result;
}

function marketRowDate(row) {
  return pickFirstDateString(row, ["valuation_date", "valuationDate", "issue_date", "issueDate"]);
}

function reliabilityRank(value) {
  const text = String(value || "").trim();
  if (/不推荐|not[\s_-]*recommended/i.test(text)) return 0;
  if (/推荐|recommended/i.test(text)) return 3;
  if (/辅助|参考/i.test(text)) return 2;
  return text ? 1 : 0;
}

function dataSourceRank(value) {
  const index = DATA_SOURCE_LIST.indexOf(Number(value));
  return index >= 0 ? index : DATA_SOURCE_LIST.length;
}

function offsetIsoDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const __test__ = {
  bondPrefersExerciseYield,
  buildResult,
  normalizeRequestRows,
  pickChinaBondValuation,
};
