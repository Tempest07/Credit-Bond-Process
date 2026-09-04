import { requireUser } from "../_auth.js";
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

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const MARKET_DATA_DATE_PATH = "/dm-quant-func-service/api/v1/bond/market-data/date";
const MAX_SECURITIES = 200;
const MARKET_DATA_BATCH_SIZE = 5;
const MARKET_DATA_CONCURRENCY = 4;
const MARKET_DATA_LOOKBACK_DAYS = 7;
const REQUEST_TIMEOUT_MS = 20_000;
const DATA_SOURCE_LIST = [1, 3, 4, 7];

const BASIC_FIELDS = [
  "securityId",
  "secShortName",
  "nextOptionDate",
  "bondMatu",
  "specialItem",
];

const VALUATION_FIELDS = [
  "securityId",
  "secShortName",
  "issueDate",
  "dataSource",
  "cbReliability",
  "cbYtm",
  "cbYte",
  "cbNptm",
  "cbNpte",
  "csReliability",
  "csYtm",
  "csYte",
  "csNptm",
  "csNpte",
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
    return json({ ok: false, error: "请求正文必须是 JSON。" }, 400);
  }

  const securityIds = normalizeSecurityIds(input?.securityIds || input?.security_ids);
  if (!securityIds.length) return json({ ok: false, error: "请至少提供一只债券代码。" }, 400);
  if (securityIds.length > MAX_SECURITIES) {
    return json({ ok: false, error: `单次最多查询 ${MAX_SECURITIES} 只债券。` }, 400);
  }

  const dm = context.data?.dmClient || makeDmClient(context.env, context.request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const requestedDate = chinaToday();

  try {
    const [basicRows, marketRows] = await Promise.all([
      lookupBasicRows(dm, securityIds, controller.signal),
      lookupValuationRows(dm, securityIds, requestedDate, controller.signal),
    ]);
    const basicById = new Map(basicRows.map((row) => [securityKey(row), row]).filter(([key]) => key));
    const rows = securityIds.map((securityId) => buildValuationRow({
      securityId,
      basic: basicById.get(securityId),
      marketRows,
      requestedDate,
    }));

    return json({
      ok: true,
      source: "DM",
      sourcePath: MARKET_DATA_DATE_PATH,
      sourceScope: "最新可用中债/中证估值",
      requestedDate,
      fetchedAt: new Date().toISOString(),
      rows,
      diagnostic: {
        requested: securityIds.length,
        basicRows: basicRows.length,
        marketRows: marketRows.length,
        marketDataBatches: Math.ceil(securityIds.length / MARKET_DATA_BATCH_SIZE),
      },
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error(JSON.stringify({
      message: "DM realtime valuation lookup failed",
      timedOut,
      error: String(error?.message || error).slice(0, 240),
    }));
    return json({
      ok: false,
      error: timedOut ? "DM 中债/中证估值查询超时。" : "DM 中债/中证估值查询失败。",
      hint: timedOut ? "估值批量查询已在 20 秒后中止，请稍后刷新。" : "请检查 DM 估值接口权限或稍后重试。",
    }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function lookupBasicRows(dm, securityIds, signal) {
  const raw = await dm.post(BASIC_INFO_PATH, {
    securityIdList: securityIds,
    fieldNames: BASIC_FIELDS,
  }, { signal });
  return rowsFromDm(raw);
}

async function lookupValuationRows(dm, securityIds, requestedDate, signal) {
  const batches = chunk(securityIds, MARKET_DATA_BATCH_SIZE);
  const rows = [];
  for (let index = 0; index < batches.length; index += MARKET_DATA_CONCURRENCY) {
    const group = batches.slice(index, index + MARKET_DATA_CONCURRENCY);
    const results = await Promise.all(group.map((securityIdList) => dm.post(MARKET_DATA_DATE_PATH, {
      securityIdList,
      dataSourceList: DATA_SOURCE_LIST,
      startDate: offsetIsoDate(requestedDate, -MARKET_DATA_LOOKBACK_DAYS),
      endDate: requestedDate,
      fieldNames: VALUATION_FIELDS,
    }, { signal })));
    for (const result of results) rows.push(...rowsFromDm(result));
  }
  return rows;
}

function buildValuationRow({ securityId, basic = {}, marketRows = [], requestedDate }) {
  const preferExercise = bondPrefersExerciseYield(basic, requestedDate);
  const shortName = pickFirstString(basic, ["sec_short_name", "secShortName"])
    || pickFirstString(marketRows.find((row) => securityKey(row) === securityId) || {}, ["sec_short_name", "secShortName"]);
  return {
    securityId,
    shortName,
    preferredBasis: preferExercise ? "行权" : "到期",
    chinaBond: pickInstitutionValuation(marketRows, securityId, requestedDate, "cb", preferExercise),
    chinaSecurities: pickInstitutionValuation(marketRows, securityId, requestedDate, "cs", preferExercise),
  };
}

function pickInstitutionValuation(rows, securityId, requestedDate, prefix, preferExercise = false) {
  const descriptors = prefix === "cb"
    ? {
        reliability: ["cb_reliability", "cbReliability"],
        ytm: ["cb_ytm", "cbYtm"],
        yte: ["cb_yte", "cbYte"],
        nptm: ["cb_nptm", "cbNptm", "cb_net_price", "cbNetPrice"],
        npte: ["cb_npte", "cbNpte"],
      }
    : {
        reliability: ["cs_reliability", "csReliability"],
        ytm: ["cs_ytm", "csYtm"],
        yte: ["cs_yte", "csYte"],
        nptm: ["cs_nptm", "csNptm"],
        npte: ["cs_npte", "csNpte"],
      };

  return rows
    .map((row) => {
      const date = marketRowDate(row);
      const ytm = numberFromRow(row, descriptors.ytm);
      const yte = numberFromRow(row, descriptors.yte);
      const useExercise = preferExercise ? Number.isFinite(yte) : !Number.isFinite(ytm) && Number.isFinite(yte);
      const yieldValue = useExercise ? yte : ytm;
      const netPrice = numberFromRow(row, useExercise ? descriptors.npte : descriptors.nptm);
      return {
        securityId: securityKey(row),
        date,
        yield: yieldValue,
        netPrice,
        basis: useExercise ? "行权" : "到期",
        field: `${prefix}${useExercise ? "Yte" : "Ytm"}`,
        reliability: pickFirstString(row, descriptors.reliability),
        dataSource: numberFromRow(row, ["data_source", "dataSource"]),
      };
    })
    .filter((item) => item.securityId === securityId
      && isIsoDate(item.date)
      && item.date <= requestedDate
      && Number.isFinite(item.yield)
      && item.yield > -5
      && item.yield < 25)
    .sort((left, right) => right.date.localeCompare(left.date)
      || reliabilityRank(right.reliability) - reliabilityRank(left.reliability)
      || dataSourceRank(left.dataSource) - dataSourceRank(right.dataSource))[0] || null;
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

function normalizeSecurityIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeSecurityId(item)).filter(Boolean))];
}

function securityKey(row) {
  return normalizeSecurityId(pickFirstString(row || {}, ["security_id", "securityId"]));
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

function chinaToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
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

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export const __test__ = {
  bondPrefersExerciseYield,
  buildValuationRow,
  chinaToday,
  normalizeSecurityIds,
  pickInstitutionValuation,
};
