// Onshore RMB bond calendars only; not bank-counter, cross-border or repo calendars.
// Coverage is deliberately limited to the verified 2026 notices. Do not extend a
// weekday rule into an unverified year or use the interbank calendar for SH/SZ.
// IB: CFETS / CCDC / SHCH, 中汇交发〔2025〕460号:
// https://www.chinamoney.com.cn/chinese/rdgz/20251219/3254572.html
// SH: 上证公告〔2025〕45号:
// https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
// SZ: 深证会〔2025〕481号:
// https://dataclouds.cninfo.com.cn/sjother2/regulatory/2025/20251222/50b258f0d89b4076b459eb746a7e100d.pdf
// CSDC T+1 funds settlement around the 2026 Mid-Autumn / National Day closures:
// https://m.chinaclear.cn/zdjs/gszb/202609/0404d81f1ee8409c95b5dc4af693409f.shtml
const CLOSED_RANGES_2026 = [
  ["2026-01-01", "2026-01-03"], ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"], ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"], ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
];
const INTERBANK_OPEN_WEEKENDS_2026 = new Set([
  "2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10",
]);
const DAY_MS = 86_400_000;
export const SETTLEMENT_DATE_REVIEW_WARNING = "结算日期待人工确认";

export function normalizeBondSettlementDate(value = "") {
  const match = String(value || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])) return "";
  return date.toISOString().slice(0, 10);
}

function speedOf(value) {
  return value === 0 || value === "0" ? 0 : value === 1 || value === "1" ? 1 : null;
}

function marketOf({ market = "", code = "" } = {}) {
  const explicit = String(market || "").trim().toUpperCase();
  const suffix = String(code || "").trim().toUpperCase().match(/\.(IB|SH|SZ)$/)?.[1] || "";
  if ((explicit && !["IB", "SH", "SZ"].includes(explicit)) || (explicit && suffix && explicit !== suffix)) return "";
  return explicit || suffix;
}

// null means that the date/market is outside the verified calendar, not closed.
export function isBondSettlementDay(value, market) {
  const date = normalizeBondSettlementDate(value);
  if (!date || !date.startsWith("2026-") || !["IB", "SH", "SZ"].includes(market)) return null;
  if (CLOSED_RANGES_2026.some(([from, to]) => date >= from && date <= to)) return false;
  if (market === "IB" && INTERBANK_OPEN_WEEKENDS_2026.has(date)) return true;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function resolveBondSettlementDate(input = {}) {
  if (String(input.settlementDate || "").trim()) return normalizeBondSettlementDate(input.settlementDate);
  const tradeDate = normalizeBondSettlementDate(input.tradeDate);
  const speed = speedOf(input.settlementSpeed);
  if (!tradeDate || speed === null) return "";
  if (speed === 0) return tradeDate;
  const market = marketOf(input);
  if (isBondSettlementDay(tradeDate, market) !== true) return "";
  let day = Date.parse(`${tradeDate}T00:00:00Z`);
  for (let offset = 1; offset <= 31; offset++) {
    day += DAY_MS;
    const date = new Date(day).toISOString().slice(0, 10);
    const open = isBondSettlementDay(date, market);
    if (open === null) return "";
    if (open) return date;
  }
  return "";
}

// Editing unrelated ledger fields must not replace an agreed settlement date.
// A new explicit date wins; changed date/speed/market requires a fresh calendar lookup.
export function settlementDateAfterEdit(previous = {}, changes = {}) {
  const previousSpeed = speedOf(previous.tradeRecord?.["清算速度(0/1)"]) ?? speedOf(previous.settlementSpeed);
  const input = { ...previous, settlementSpeed: previousSpeed, ...changes };
  const codeChanged = Object.hasOwn(changes, "code") && changes.code !== previous.code;
  if (codeChanged && !Object.hasOwn(changes, "market")) input.market = "";
  if (Object.hasOwn(changes, "settlementDate")) return resolveBondSettlementDate(input);
  const previousDate = normalizeBondSettlementDate(previous.settlementDate);
  if (previousDate && normalizeBondSettlementDate(input.tradeDate) === normalizeBondSettlementDate(previous.tradeDate)
    && speedOf(input.settlementSpeed) === previousSpeed
    && marketOf(input) === marketOf(previous)) return previousDate;
  return resolveBondSettlementDate({ ...input, settlementDate: "" });
}

export function settlementDateWarnings(warnings = [], settlementDate = "") {
  const result = (Array.isArray(warnings) ? warnings : []).filter(value => value !== SETTLEMENT_DATE_REVIEW_WARNING);
  if (!settlementDate) result.push(SETTLEMENT_DATE_REVIEW_WARNING);
  return result;
}
