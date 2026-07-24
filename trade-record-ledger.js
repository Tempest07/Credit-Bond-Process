import {
  TRADE_RECORD_COLUMNS,
  normalizeTradeRecord,
} from "./trade-record-converter.js";

export function secondaryTradeRecordForOutput(trade = {}) {
  const record = normalizeTradeRecord(trade.tradeRecord || {});
  const quantity = numberText(trade.quantityWan ?? trade.quantity);
  const yieldRate = numberText(trade.yieldRate);
  const settlementSpeed = normalizedSpeedText(
    record["清算速度(0/1)"] || trade.settlementSpeed,
  );
  return normalizeTradeRecord({
    ...record,
    谈判日: record["谈判日"] || dateText(trade.negotiationDate),
    交易日: record["交易日"] || dateText(trade.tradeDate),
    债券代码: record["债券代码"] || String(trade.code || "").trim(),
    债券简称: record["债券简称"] || String(trade.shortName || "").trim(),
    净价: String(trade.frontOfficePrice || record["净价"] || trade.price || "").trim(),
    "收益率(%)": record["收益率(%)"] || yieldRate,
    我行方向: record["我行方向"] || (trade.side === "buy" ? "买入" : trade.side === "sell" ? "卖出" : ""),
    "面值（万元）": record["面值（万元）"] || quantity,
    真实交易对手: record["真实交易对手"] || String(trade.counterparty || "").trim(),
    组合: record["组合"] || String(trade.account || "").trim(),
    中介: record["中介"] || String(trade.intermediary || "").trim(),
    "清算速度(0/1)": settlementSpeed,
  });
}

export function protocolTransferRecordForOutput(record = {}, bankName = "兴业银行") {
  const existing = normalizeTradeRecord(record.tradeRecord || {});
  const buyer = String(record.buyer || "").trim();
  const seller = String(record.seller || "").trim();
  const isBuy = buyer.includes(bankName);
  const isSell = seller.includes(bankName);
  const direction = isBuy && !isSell ? "买入" : isSell && !isBuy ? "卖出" : "";
  const counterparty = direction === "买入" ? seller : direction === "卖出" ? buyer : "";
  return normalizeTradeRecord({
    ...existing,
    谈判日: existing["谈判日"] || dateText(record.tradeDate),
    交易日: existing["交易日"] || dateText(record.tradeDate),
    债券代码: existing["债券代码"] || String(record.code || "").trim(),
    债券简称: existing["债券简称"] || String(record.shortName || "").trim(),
    净价: existing["净价"] || String(record.price || "").trim(),
    我行方向: existing["我行方向"] || direction,
    "面值（万元）": existing["面值（万元）"] || numberText(record.amountTenThousand),
    真实交易对手: existing["真实交易对手"] || counterparty,
    组合: existing["组合"] || "SSE",
  });
}

export function buildTradeRecordRows(state = {}, date = "", options = {}) {
  const ledgerDate = dateText(date);
  const secondaryTrades = Array.isArray(state.secondaryTrades) ? state.secondaryTrades : [];
  const protocolTransfers = Array.isArray(state.protocolTransfers) ? state.protocolTransfers : [];
  const linkedProtocolIds = new Set(
    secondaryTrades.map((trade) => String(trade.protocolTransferId || "")).filter(Boolean),
  );

  const secondaryRows = secondaryTrades
    .filter((trade) =>
      isFrontOfficeDoneTrade(trade)
      && dateText(trade.ledgerDate || trade.tradeDate) === ledgerDate
    )
    .map((trade) => ({
      id: String(trade.id || ""),
      source: "secondary",
      record: secondaryTradeRecordForOutput(trade),
      fieldSources: normalizeFieldSources(trade.tradeRecordSources),
      dmLookup: normalizeDmLookup(trade.tradeRecordDm),
      sent: Boolean(trade.ledgerSentAt),
      sortKey: `${dateText(trade.tradeDate)}:${trade.shortName || ""}:${trade.id || ""}`,
    }));

  const protocolRows = protocolTransfers
    .filter((record) =>
      dateText(record.tradeDate) === ledgerDate
      && !linkedProtocolIds.has(String(record.id || ""))
    )
    .map((record) => ({
      id: String(record.id || ""),
      source: "protocol",
      record: protocolTransferRecordForOutput(record, options.bankName),
      fieldSources: normalizeFieldSources(record.tradeRecordSources),
      dmLookup: normalizeDmLookup(record.tradeRecordDm),
      sent: true,
      sortKey: `${dateText(record.tradeDate)}:${record.shortName || ""}:${record.id || ""}`,
    }));

  return [...secondaryRows, ...protocolRows].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

export function buildTradeRecordTableText(rows = [], options = {}) {
  const includeHeader = options.includeHeader !== false;
  const lines = [];
  if (includeHeader) lines.push(TRADE_RECORD_COLUMNS.join("\t"));
  for (const row of rows) {
    const record = normalizeTradeRecord(row?.record || row);
    lines.push(TRADE_RECORD_COLUMNS.map((column) => cleanCell(record[column])).join("\t"));
  }
  return lines.join("\n");
}

export function applyTradeRecordRowsToState(state = {}, rows = []) {
  const dirtyRows = new Map(
    rows
      .filter((row) => row?.dirty && row?.id)
      .map((row) => [`${row.source}:${row.id}`, row]),
  );
  if (!dirtyRows.size) return state;
  const now = new Date().toISOString();
  const secondaryTrades = (state.secondaryTrades || []).map((trade) => {
    const row = dirtyRows.get(`secondary:${trade.id}`);
    if (!row) return trade;
    const record = normalizeTradeRecord(row.record || {});
    const direction = record["我行方向"];
    const settlementSpeed = record["清算速度(0/1)"];
    const tradeDate = dateText(record["交易日"]) || dateText(trade.tradeDate);
    const negotiationDate = dateText(record["谈判日"]) || dateText(trade.negotiationDate);
    const normalizedSettlementSpeed = settlementSpeed === "0"
      ? 0
      : settlementSpeed === "1"
        ? 1
        : trade.settlementSpeed;
    return {
      ...trade,
      code: normalizeCode(record["债券代码"]) || String(trade.code || ""),
      shortName: record["债券简称"],
      account: record["组合"],
      side: direction === "买入" ? "buy" : direction === "卖出" ? "sell" : "unknown",
      quantityWan: numberValue(record["面值（万元）"]) ?? 0,
      price: record["净价"],
      frontOfficePrice: record["净价"],
      yieldRate: numberValue(record["收益率(%)"]),
      negotiationDate,
      tradeDate,
      ledgerDate: tradeDate,
      settlementSpeed: normalizedSettlementSpeed,
      settlementDate: inferSettlementDate(tradeDate, normalizedSettlementSpeed),
      counterparty: record["真实交易对手"],
      intermediary: record["中介"],
      tradeRecord: record,
      tradeRecordSources: normalizeFieldSources(row.fieldSources),
      tradeRecordDm: normalizeDmLookup(row.dmLookup),
      ledgerSentAt: "",
      tradeStage: "front_office_done",
      updatedAt: now,
    };
  });
  const protocolTransfers = (state.protocolTransfers || []).map((transfer) => {
    const row = dirtyRows.get(`protocol:${transfer.id}`);
    if (!row) return transfer;
    const record = normalizeTradeRecord(row.record || {});
    return {
      ...transfer,
      code: normalizeCode(record["债券代码"]) || String(transfer.code || ""),
      shortName: record["债券简称"],
      tradeDate: dateText(record["交易日"]) || dateText(transfer.tradeDate),
      price: record["净价"],
      amountTenThousand: numberValue(record["面值（万元）"]),
      quantityHands: Number.isFinite(numberValue(record["面值（万元）"]))
        ? Math.round(numberValue(record["面值（万元）"]) * 10)
        : transfer.quantityHands,
      tradeRecord: record,
      tradeRecordSources: normalizeFieldSources(row.fieldSources),
      tradeRecordDm: normalizeDmLookup(row.dmLookup),
      updatedAt: now,
    };
  });
  return {
    ...state,
    secondaryTrades,
    protocolTransfers,
    updatedAt: now,
  };
}

function isFrontOfficeDoneTrade(trade = {}) {
  return Boolean(trade.frontOfficeDone)
    || Boolean(String(trade.frontOfficeAt || "").trim())
    || ["front_office_done", "ledgered", "sent"].includes(String(trade.tradeStage || ""));
}

function normalizedSpeedText(value) {
  if (value === 0 || value === "0") return "0";
  if (value === 1 || value === "1") return "1";
  return "";
}

function dateText(value) {
  return String(value || "").trim().slice(0, 10);
}

function inferSettlementDate(tradeDate, speed = 0) {
  const match = String(tradeDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) {
    return "";
  }
  date.setDate(date.getDate() + (Number(speed) === 1 ? 1 : 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function numberText(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeFieldSources(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeDmLookup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    status: String(value.status || ""),
    requestedDate: String(value.requestedDate || ""),
    valuationDate: String(value.valuationDate || ""),
    valuationField: String(value.valuationField || ""),
    missing: Array.isArray(value.missing) ? value.missing.map(String) : [],
    queriedAt: String(value.queriedAt || ""),
  };
}

function cleanCell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}
