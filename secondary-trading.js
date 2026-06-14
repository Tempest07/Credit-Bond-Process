const DEFAULT_ACCOUNT = "SDR";
const DEFAULT_PRICE_TYPE = "收益率";
const STATUS_LISTING = "拟挂卖";
const STATUS_LISTED = "已挂出";
const STATUS_PENDING_SETTLEMENT = "待交割";
const STATUS_SETTLED = "已交割";
const STATUS_CANCELLED = "已取消";

export const SECONDARY_TRADE_STATUSES = [
  STATUS_LISTING,
  STATUS_LISTED,
  STATUS_PENDING_SETTLEMENT,
  STATUS_SETTLED,
  STATUS_CANCELLED,
];

export const SECONDARY_TRADE_ACCOUNTS = [
  { key: "SDR", label: "SDR", description: "可售类总分联动大账户" },
  { key: "THR", label: "THR", description: "应收类总分联动大账户" },
  { key: "TX", label: "TX", description: "套息交易策略组合" },
  { key: "小账户", label: "小账户", description: "个人 DV01 小账户" },
];

const BOND_CODE_PATTERN = /\b(\d{6,9})(?:\.(IB|SH|SZ))?\b/i;
const INSTITUTION_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:证券|基金|银行|信托|资管|保险|理财|财务|租赁))/g;

export function normalizeSecondaryTrades(input = []) {
  return Array.isArray(input) ? input.map(normalizeSecondaryTrade) : [];
}

export function normalizeSecondaryTrade(input = {}, referenceDate = new Date()) {
  const tradeDate = normalizeDate(input.tradeDate) || localDate(referenceDate);
  const status = normalizeStatus(input.status, input.kind);
  const isExecuted = [STATUS_PENDING_SETTLEMENT, STATUS_SETTLED].includes(status);
  const settlementDate = normalizeDate(input.settlementDate)
    || (isExecuted ? addBusinessDays(tradeDate, inferSettlementDays(input.settlementText)) : "");
  const direction = normalizeDirection(input.direction);
  const price = normalizePrice(input.price);
  const amountWan = numberOrNull(input.amountWan);

  return {
    id: input.id || crypto.randomUUID(),
    code: normalizeCode(input.code),
    shortName: String(input.shortName || "").trim(),
    direction,
    account: normalizeAccount(input.account),
    status,
    tradeDate,
    settlementDate,
    priceType: normalizePriceType(input.priceType, price, input.rawText || input.notes || ""),
    price,
    amountWan,
    broker: String(input.broker || "").trim(),
    counterparty: String(input.counterparty || "").trim(),
    isTaskPurchase: Boolean(input.isTaskPurchase),
    rawText: String(input.rawText || "").trim(),
    notes: String(input.notes || "").trim(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function upsertSecondaryTrade(state, input) {
  const trade = normalizeSecondaryTrade({ ...input, updatedAt: new Date().toISOString() });
  const trades = [...(state.secondaryTrades || [])];
  const index = trades.findIndex((item) => item.id === trade.id);
  if (index >= 0) trades[index] = trade;
  else trades.unshift(trade);
  return { ...state, secondaryTrades: trades, updatedAt: new Date().toISOString() };
}

export function removeSecondaryTrade(state, id) {
  return {
    ...state,
    secondaryTrades: (state.secondaryTrades || []).filter((item) => item.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

export function parseSecondaryTradeBatch(rawText = "", options = {}) {
  const text = normalizeText(rawText);
  if (!text) return [];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = lines.length > 1 ? lines : [text];
  return candidates
    .map((line) => parseSecondaryTradeText(line, options))
    .filter((trade) => trade.code || trade.shortName || trade.amountWan !== null || trade.price !== null);
}

export function parseSecondaryTradeText(rawText = "", options = {}) {
  const text = normalizeText(rawText);
  const kind = options.kind || "trade";
  const code = parseBondCode(text);
  const shortName = parseShortName(text, code);
  const direction = normalizeDirection(options.direction || parseDirection(text) || (kind === "listing" ? "卖出" : ""));
  const tradeDate = parseTradeDate(text, options.referenceDate || new Date());
  const settlementText = parseSettlementText(text);
  const settlementDate = parseExplicitSettlementDate(text, tradeDate) || (
    kind === "trade" ? addBusinessDays(tradeDate, inferSettlementDays(settlementText)) : ""
  );
  const price = parsePrice(text);
  const amountWan = parseAmountWan(text);
  const parties = parseSecondaryParties(text, direction);

  return normalizeSecondaryTrade({
    code,
    shortName,
    direction,
    account: options.account || parseAccount(text),
    status: options.status || (kind === "listing" ? STATUS_LISTING : STATUS_PENDING_SETTLEMENT),
    tradeDate,
    settlementDate,
    settlementText,
    priceType: parsePriceType(text, price),
    price,
    amountWan,
    broker: parties.broker,
    counterparty: parties.counterparty,
    isTaskPurchase: Boolean(options.isTaskPurchase || /任务|收券|套息|TX/i.test(text)),
    rawText: text,
    notes: parseNotes(text),
  }, options.referenceDate || new Date());
}

export function secondaryTradeTodos(records = [], referenceDate = new Date()) {
  const today = localDate(referenceDate);
  return normalizeSecondaryTrades(records)
    .filter((record) => record.status === STATUS_PENDING_SETTLEMENT && record.settlementDate)
    .map((record) => ({
      record,
      step: { key: "settled", label: "交割", dueDate: record.settlementDate },
      timing: record.settlementDate < today ? "overdue" : record.settlementDate === today ? "today" : "upcoming",
    }))
    .sort((left, right) =>
      left.step.dueDate.localeCompare(right.step.dueDate)
      || left.record.shortName.localeCompare(right.record.shortName, "zh-CN"),
    );
}

export function markSecondaryTradeAction(record, action) {
  const trade = normalizeSecondaryTrade(record);
  if (action === "listed") return normalizeSecondaryTrade({ ...trade, status: STATUS_LISTED });
  if (action === "executed") {
    return normalizeSecondaryTrade({
      ...trade,
      status: STATUS_PENDING_SETTLEMENT,
      settlementDate: trade.settlementDate || addBusinessDays(trade.tradeDate, 1),
    });
  }
  if (action === "settled") return normalizeSecondaryTrade({ ...trade, status: STATUS_SETTLED });
  if (action === "cancelled") return normalizeSecondaryTrade({ ...trade, status: STATUS_CANCELLED });
  return trade;
}

export function buildBrokerSellList(records = [], date = localDate(new Date())) {
  const trades = normalizeSecondaryTrades(records)
    .filter((record) =>
      record.tradeDate === date
      && record.direction === "卖出"
      && [STATUS_LISTING, STATUS_LISTED].includes(record.status),
    )
    .sort(compareSecondaryTrades);

  if (!trades.length) return "";
  return [
    `${formatDisplayDate(date)}挂卖：`,
    ...trades.map((record, index) =>
      `${index + 1}. ${formatCodeName(record)}，${record.account}，卖出${formatAmount(record.amountWan)}，${formatPrice(record)}${record.broker ? `，中介${record.broker}` : ""}`,
    ),
  ].join("\n");
}

export function buildDailySecondaryTradeSummary(records = [], date = localDate(new Date())) {
  const trades = normalizeSecondaryTrades(records)
    .filter((record) =>
      record.tradeDate === date
      && [STATUS_PENDING_SETTLEMENT, STATUS_SETTLED].includes(record.status),
    )
    .sort(compareSecondaryTrades);

  if (!trades.length) return "";
  const sells = trades.filter((record) => record.direction === "卖出");
  const buys = trades.filter((record) => record.direction === "买入");
  const lines = [`${formatDisplayDate(date)}二级成交：`];
  appendSummaryGroup(lines, "卖出", sells);
  appendSummaryGroup(lines, "买入", buys);
  const settlements = trades
    .filter((record) => record.settlementDate)
    .map((record) => `${formatCodeName(record)}，${record.direction}${formatAmount(record.amountWan)}，${record.settlementDate}交割`);
  if (settlements.length) {
    lines.push("");
    lines.push("交割提醒：");
    settlements.forEach((line, index) => lines.push(`${index + 1}. ${line}`));
  }
  return lines.join("\n");
}

export function buildSecondaryTradeLedgerRows(records = []) {
  const header = ["序号", "交易日", "交割日", "状态", "方向", "组合", "代码", "简称", "金额（万元）", "价格类型", "价格", "中介", "对手方", "任务收券", "备注"];
  const body = normalizeSecondaryTrades(records)
    .sort(compareSecondaryTrades)
    .map((record, index) => [
      index + 1,
      record.tradeDate,
      record.settlementDate,
      record.status,
      record.direction,
      record.account,
      record.code,
      record.shortName,
      record.amountWan ?? "",
      record.priceType,
      record.price ?? "",
      record.broker,
      record.counterparty,
      record.isTaskPurchase ? "是" : "",
      record.notes,
    ]);
  return [header, ...body];
}

export function standardizeSecondaryTradeText(record) {
  const trade = normalizeSecondaryTrade(record);
  if (!trade.code && !trade.shortName) return "";
  const head = [trade.status === STATUS_LISTING || trade.status === STATUS_LISTED ? "挂卖" : "二级成交", trade.account].filter(Boolean).join(" ");
  const party = trade.counterparty || trade.broker;
  return [
    `【${head}】${trade.direction}${formatCodeName(trade)}，${formatAmount(trade.amountWan)}，${formatPrice(trade)}`,
    party ? `对手/中介：${party}` : "",
    trade.tradeDate ? `交易日：${trade.tradeDate}` : "",
    trade.settlementDate ? `交割日：${trade.settlementDate}` : "",
  ].filter(Boolean).join("\n");
}

function appendSummaryGroup(lines, title, records) {
  if (!records.length) return;
  lines.push("");
  lines.push(`一、${title}`);
  records.forEach((record, index) => {
    const party = record.counterparty || record.broker || "对手方待补";
    const task = record.isTaskPurchase ? "，任务内收券" : "";
    lines.push(`${index + 1}. ${formatCodeName(record)}，${record.account}，${title}${formatAmount(record.amountWan)}，${formatPrice(record)}，${party}，${record.settlementDate || "交割日待补"}交割${task}。`);
  });
}

function compareSecondaryTrades(left, right) {
  return right.tradeDate.localeCompare(left.tradeDate)
    || (right.settlementDate || "").localeCompare(left.settlementDate || "")
    || (right.createdAt || "").localeCompare(left.createdAt || "");
}

function normalizeText(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeStatus(value = "", kind = "") {
  const text = String(value || "").trim();
  if (SECONDARY_TRADE_STATUSES.includes(text)) return text;
  if (/已交割|完成/.test(text)) return STATUS_SETTLED;
  if (/已挂/.test(text)) return STATUS_LISTED;
  if (/取消/.test(text)) return STATUS_CANCELLED;
  if (/成交|交割/.test(text) || kind === "trade") return STATUS_PENDING_SETTLEMENT;
  return STATUS_LISTING;
}

function normalizeDirection(value = "") {
  const text = String(value || "").trim();
  if (/买|收/.test(text)) return "买入";
  if (/卖|出/.test(text)) return "卖出";
  return "卖出";
}

function normalizeAccount(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (["SDR", "THR", "TX"].includes(text)) return text;
  if (/小|个人/.test(String(value))) return "小账户";
  return DEFAULT_ACCOUNT;
}

function normalizeCode(value = "") {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(BOND_CODE_PATTERN);
  if (!match) return text;
  return match[2] ? `${match[1]}.${match[2].toUpperCase()}` : match[1];
}

function normalizeDate(value = "") {
  if (!value) return "";
  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function normalizePrice(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.includes("/")) {
    const numbers = text.split("/").map(numberOrNull).filter((item) => item !== null);
    return numbers.length ? numbers[numbers.length - 1] : null;
  }
  return numberOrNull(text.replace("%", ""));
}

function normalizePriceType(value = "", price = null, rawText = "") {
  const text = `${value} ${rawText}`;
  if (/全价/.test(text)) return "全价";
  if (/净价/.test(text) || (Number.isFinite(Number(price)) && Number(price) >= 50)) return "净价";
  return DEFAULT_PRICE_TYPE;
}

function parseDirection(text) {
  if (/(买入|买进|收券|收|bid)/i.test(text)) return "买入";
  if (/(卖出|挂卖|出给|卖|offer)/i.test(text)) return "卖出";
  return "";
}

function parseBondCode(text) {
  const match = text.match(BOND_CODE_PATTERN);
  if (!match) return "";
  return match[2] ? `${match[1]}.${match[2].toUpperCase()}` : match[1];
}

function parseShortName(text, code = "") {
  if (code) {
    const compactCode = code.replace(/\.(IB|SH|SZ)$/i, "");
    const after = text.slice(text.search(new RegExp(compactCode, "i")) + compactCode.length);
    const candidate = after.split(/\s+/).map(cleanToken).find(isBondShortName);
    if (candidate) return candidate;
  }
  const tokens = text.split(/\s+/).map(cleanToken).filter(Boolean);
  return tokens.find((token) => isBondShortName(token) && !BOND_CODE_PATTERN.test(token)) || "";
}

function cleanToken(token = "") {
  return String(token).replace(/[【】\[\]（）(),，。；;:：]/g, "").trim();
}

function isBondShortName(token = "") {
  return /^[0-9]{2}[\u4e00-\u9fa5A-Za-z]{1,14}[0-9A-Za-z]{1,6}$/.test(token);
}

function parseAccount(text) {
  const match = text.match(/\b(SDR|THR|TX)\b/i);
  if (match) return match[1].toUpperCase();
  if (/小账户|小户头|个人账户/.test(text)) return "小账户";
  return DEFAULT_ACCOUNT;
}

function parseTradeDate(text, referenceDate) {
  if (/明日|明天/.test(text) && /交易|成交/.test(text)) return addCalendarDays(localDate(referenceDate), 1);
  if (/今日|今天/.test(text) && /交易|成交/.test(text)) return localDate(referenceDate);
  return parseDateFromText(text, referenceDate) || localDate(referenceDate);
}

function parseExplicitSettlementDate(text, tradeDate) {
  const settlementText = text.match(/(?:交割|结算|清算)[^\d]*(\d{1,2})[./月](\d{1,2})/)?.[0] || "";
  if (settlementText) return parseDateFromText(settlementText, new Date(`${tradeDate}T09:00:00`));
  return "";
}

function parseDateFromText(text, referenceDate) {
  let match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  const monthDayMatches = [...text.matchAll(/(?:^|[^\d])(\d{1,2})[./月](\d{1,2})(?:日)?(?!\d|[A-Za-z%亿万])/g)];
  match = monthDayMatches.find((item) => {
    const month = Number(item[1]);
    const day = Number(item[2]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  });
  if (!match) return "";
  const year = referenceDate.getFullYear();
  return `${year}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

function parseSettlementText(text) {
  if (/T\s*\+\s*0|DVP|当天|今日|今天/.test(text) && /交割|结算|清算|T\s*\+\s*0/i.test(text)) return "T+0";
  if (/T\s*\+\s*1|明日|明天/.test(text) && /交割|结算|清算|T\s*\+\s*1/i.test(text)) return "T+1";
  return "";
}

function inferSettlementDays(text = "") {
  if (/T\s*\+\s*0/i.test(text)) return 0;
  return 1;
}

function parsePriceType(text, price) {
  if (/全价/.test(text)) return "全价";
  if (/净价/.test(text) || (Number.isFinite(Number(price)) && Number(price) >= 50)) return "净价";
  return DEFAULT_PRICE_TYPE;
}

function parsePrice(text) {
  const slash = text.match(/\b((?:9\d|10\d|11\d|12\d)(?:\.\d+)?)\s*\/\s*((?:9\d|10\d|11\d|12\d)(?:\.\d+)?)\b/);
  if (slash) return numberOrNull(slash[2]);

  const labelled = text.match(/(?:收益率|利率|净价|全价|价格|成交价|挂卖价|报价)[:：]?\s*(\d+(?:\.\d+)?)(?:\s*%)?/);
  if (labelled) return numberOrNull(labelled[1]);

  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) return numberOrNull(percent[1]);

  const decimals = [...text.matchAll(/(?<!\d)(\d{1,3}\.\d+)(?!\d|Y|y)/g)]
    .map((match) => numberOrNull(match[1]))
    .filter((number) => number !== null && number >= 0.1);
  const netPrice = decimals.find((number) => number >= 50);
  if (netPrice !== undefined) return netPrice;
  return decimals.filter((number) => number < 20).at(-1) ?? null;
}

function parseAmountWan(text) {
  let match = text.match(/(\d+(?:\.\d+)?)\s*(?:亿|e|E)(?![A-Za-z])/);
  if (match) return round(Number(match[1]) * 10000, 4);
  match = text.match(/(\d+(?:\.\d+)?)\s*(?:千万|kw|KW|k|K)\b/);
  if (match) return round(Number(match[1]) * 1000, 4);
  match = text.match(/(\d+(?:\.\d+)?)\s*(?:万|w|W)/);
  if (match) return round(Number(match[1]), 4);
  match = text.match(/(\d+(?:\.\d+)?)\s*手/);
  if (match) return round(Number(match[1]) / 10, 4);
  return null;
}

function parseSecondaryParties(text, direction) {
  const counterparty = firstMatch(text, /(?:出给|卖给|给到|对手方|对手|买方)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,20})/)
    || (direction === "买入" ? firstMatch(text, /(?:从|向)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,20})(?:买|收)/) : "");
  const broker = firstMatch(text, /([\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:证券|基金|银行|信托|资管|保险|理财))\s*(?:发|报|给价)/)
    || collectInstitutions(text).find((item) => item !== counterparty) || "";
  return { broker, counterparty };
}

function collectInstitutions(text) {
  return [...text.matchAll(INSTITUTION_PATTERN)]
    .map((match) => match[1])
    .filter((value, index, array) => array.indexOf(value) === index);
}

function parseNotes(text) {
  const notes = [];
  if (/急|马上|T\s*\+\s*0/i.test(text)) notes.push("可能需T+0交割");
  if (/任务|收券|套息/i.test(text)) notes.push("任务内收券");
  return notes.join("；");
}

function firstMatch(text, pattern) {
  return text.match(pattern)?.[1]?.trim() || "";
}

function formatCodeName(record) {
  return [record.code, record.shortName].filter(Boolean).join(" ");
}

function formatAmount(value) {
  if (!Number.isFinite(Number(value))) return "金额待补";
  const number = Number(value);
  return number >= 10000 && number % 10000 === 0 ? `${number / 10000}亿` : `${formatNumber(number)}万`;
}

function formatPrice(record) {
  if (!Number.isFinite(Number(record.price))) return "价格待补";
  const suffix = record.priceType === "收益率" ? "%" : "";
  return `${record.priceType}${formatNumber(record.price)}${suffix}`;
}

function formatDisplayDate(date) {
  return String(date || "").replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3");
}

function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addCalendarDays(dateText, days) {
  const date = new Date(`${dateText}T09:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function addBusinessDays(dateText, days) {
  const date = new Date(`${dateText}T09:00:00`);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (![0, 6].includes(date.getDay())) remaining -= 1;
  }
  return localDate(date);
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number.isInteger(number) ? String(number) : String(round(number, 4)).replace(/\.?0+$/, "");
}
