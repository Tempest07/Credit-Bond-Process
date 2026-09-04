import { requireUser } from "../_auth.js";
import {
  json,
  makeDmClient,
  normalizeSecurityId,
  numberFromRow,
  pickFirstString,
  rowsFromDm,
  validateDmConfig,
} from "./lookup.js";

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const REALTIME_QUOTE_PATH = "/dm-quant-func-service/api/v1/bond/market-data/realtime-quote";
const MAX_SECURITIES = 200;
const REQUEST_TIMEOUT_MS = 12_000;

const BASIC_FIELDS = [
  "securityId",
  "secShortName",
  "secFullName",
  "issuerName",
  "remainingTenor",
];

const QUOTE_FIELDS = [
  "securityId",
  "secShortName",
  "issueDate",
  "remainingTenor",
  "couponRate",
  "issuerFullName",
  "brokerIssueTime",
  "brokerBidYield",
  "brokerBidNetPrice",
  "brokerBidVolumeValue",
  "brokerOfrYield",
  "brokerOfrNetPrice",
  "brokerOfrVolumeValue",
  "brokerBidNetPriceSubOfr",
  "brokerBidYieldSubOfr",
  "brokerTradeTime",
  "brokerLastTradePrice",
];

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const missingConfig = validateDmConfig(context.env);
  if (missingConfig) return missingConfig;

  let requestBody;
  try {
    requestBody = await context.request.json();
  } catch {
    return json({ ok: false, error: "请求正文必须是 JSON。" }, 400);
  }

  const queries = normalizeQueries(requestBody?.queries);
  if (!queries.length) return json({ ok: false, error: "请至少导入一只债券。" }, 400);
  if (queries.length > MAX_SECURITIES) {
    return json({ ok: false, error: `单次最多查询 ${MAX_SECURITIES} 只债券。` }, 400);
  }

  const dm = context.data?.dmClient || makeDmClient(context.env, context.request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resolution = await resolveQueries(dm, queries, controller.signal);
    const securityIds = unique(resolution.resolved.map((item) => item.securityId)).slice(0, MAX_SECURITIES);
    const quoteRows = securityIds.length
      ? rowsFromDm(await dm.post(REALTIME_QUOTE_PATH, {
          securityIdList: securityIds,
          fieldNames: QUOTE_FIELDS,
        }, { signal: controller.signal }))
      : [];
    const quotesById = new Map(quoteRows.map((row) => [securityKey(row), row]).filter(([key]) => key));
    const fetchedAt = new Date().toISOString();

    return json({
      ok: true,
      source: "DM",
      sourcePath: REALTIME_QUOTE_PATH,
      sourceScope: "经纪商当日聚合最优报价",
      fetchedAt,
      rows: resolution.resolved.map((item) => buildQuoteRow(item, quotesById.get(normalizeSecurityId(item.securityId)), fetchedAt)),
      unresolved: resolution.unresolved,
      diagnostic: {
        requested: queries.length,
        resolved: resolution.resolved.length,
        quoteRows: quoteRows.length,
        unresolved: resolution.unresolved.length,
        brokerBreakdownAvailable: false,
      },
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return json({
      ok: false,
      error: timedOut ? "DM 实时行情查询超时。" : (error.message || "DM 实时行情查询失败。"),
      hint: timedOut
        ? "本次请求已在 12 秒后中止，请稍后刷新。"
        : "请检查 DM 实时行情接口权限、INNO 密钥配置或稍后重试。",
    }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function resolveQueries(dm, queries, signal) {
  const codeQueries = queries.filter(looksLikeSecurityId);
  const nameQueries = queries.filter((query) => !looksLikeSecurityId(query));
  const basicRows = [];

  if (codeQueries.length) {
    const raw = await dm.post(BASIC_INFO_PATH, {
      securityIdList: codeQueries,
      fieldNames: BASIC_FIELDS,
    }, { signal });
    basicRows.push(...rowsFromDm(raw));
  }
  if (nameQueries.length) {
    const raw = await dm.post(BASIC_INFO_PATH, {
      secShortNameList: nameQueries,
      fieldNames: BASIC_FIELDS,
    }, { signal });
    basicRows.push(...rowsFromDm(raw));
  }

  const resolved = [];
  const unresolved = [];
  const seenSecurities = new Set();
  for (const query of queries) {
    const matchingRows = basicRows.filter((row) => basicRowMatchesQuery(row, query));
    if (!matchingRows.length) {
      unresolved.push({
        query,
        reason: looksLikeSecurityId(query) ? "DM 基础资料未匹配到证券代码" : "DM 基础资料未匹配到精确简称",
      });
      continue;
    }
    for (const basic of matchingRows) {
      const securityId = normalizeSecurityId(pickFirstString(basic, ["security_id", "securityId"]));
      if (!securityId) continue;
      addResolved({ query, securityId, basic }, resolved, seenSecurities);
    }
  }
  return { resolved, unresolved };
}

function addResolved(item, output, seen) {
  const key = normalizeSecurityId(item.securityId);
  if (!key || seen.has(key)) return;
  seen.add(key);
  output.push(item);
}

function buildQuoteRow(item, quote, fetchedAt) {
  const basic = item.basic || {};
  const row = quote || {};
  const bidYield = numberFromRow(row, ["broker_bid_yield", "brokerBidYield"]);
  const ofrYield = numberFromRow(row, ["broker_ofr_yield", "brokerOfrYield"]);
  const bidNetPrice = numberFromRow(row, ["broker_bid_net_price", "brokerBidNetPrice"]);
  const ofrNetPrice = numberFromRow(row, ["broker_ofr_net_price", "brokerOfrNetPrice"]);
  const bidVolume = numberFromRow(row, ["broker_bid_volume_value", "brokerBidVolumeValue"]);
  const ofrVolume = numberFromRow(row, ["broker_ofr_volume_value", "brokerOfrVolumeValue"]);
  const hasBid = [bidYield, bidNetPrice, bidVolume].some(Number.isFinite);
  const hasOfr = [ofrYield, ofrNetPrice, ofrVolume].some(Number.isFinite);
  const status = hasBid && hasOfr ? "two-sided" : hasBid ? "bid-only" : hasOfr ? "ofr-only" : "no-quote";

  return {
    query: item.query,
    securityId: normalizeSecurityId(item.securityId),
    shortName: pickFirstString(row, ["sec_short_name", "secShortName"])
      || pickFirstString(basic, ["sec_short_name", "secShortName"]),
    fullName: pickFirstString(basic, ["sec_full_name", "secFullName"]),
    issuerName: pickFirstString(row, ["issuer_full_name", "issuerFullName"])
      || pickFirstString(basic, ["issuer_name", "issuerName"]),
    remainingTenor: pickFirstString(row, ["remaining_tenor", "remainingTenor"])
      || pickFirstString(basic, ["remaining_tenor", "remainingTenor"]),
    quoteDate: pickFirstString(row, ["issue_date", "issueDate"]),
    quoteTime: pickFirstString(row, ["broker_issue_time", "brokerIssueTime"]),
    bid: { yield: bidYield, netPrice: bidNetPrice, volumeWan: bidVolume },
    ofr: { yield: ofrYield, netPrice: ofrNetPrice, volumeWan: ofrVolume },
    spread: {
      yieldPct: numberFromRow(row, ["broker_bid_yield_sub_ofr", "brokerBidYieldSubOfr"]),
      netPrice: numberFromRow(row, ["broker_bid_net_price_sub_ofr", "brokerBidNetPriceSubOfr"]),
    },
    lastTrade: {
      time: pickFirstString(row, ["broker_trade_time", "brokerTradeTime"]),
      price: numberFromRow(row, ["broker_last_trade_price", "brokerLastTradePrice"]),
    },
    status,
    source: "DM 经纪商聚合",
    fetchedAt,
  };
}

function normalizeQueries(value) {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => String(item || "").trim()).filter(Boolean));
}

function looksLikeSecurityId(value = "") {
  const text = String(value || "").trim().toUpperCase();
  return /\.(?:IB|SH|SZ)$/.test(text) || /^\d{6,12}$/.test(text);
}

function basicRowMatchesQuery(row, query) {
  if (looksLikeSecurityId(query)) {
    return securityIdMatches(pickFirstString(row, ["security_id", "securityId"]), query);
  }
  return normalizeName(pickFirstString(row, ["sec_short_name", "secShortName"])) === normalizeName(query);
}

function securityIdMatches(left, right) {
  const a = normalizeSecurityId(left);
  const b = normalizeSecurityId(right);
  return a === b || stripVenue(a) === stripVenue(b);
}

function stripVenue(value = "") {
  return String(value || "").replace(/\.(?:IB|SH|SZ)$/i, "");
}

function normalizeName(value = "") {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function securityKey(row) {
  return normalizeSecurityId(pickFirstString(row, ["security_id", "securityId"]));
}

function unique(values) {
  return [...new Set(values)];
}

export const __test__ = {
  buildQuoteRow,
  looksLikeSecurityId,
  normalizeQueries,
  resolveQueries,
};
