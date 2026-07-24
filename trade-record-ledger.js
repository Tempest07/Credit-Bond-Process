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
  const buyer = String(record.buyer || "").trim();
  const seller = String(record.seller || "").trim();
  const isBuy = buyer.includes(bankName);
  const isSell = seller.includes(bankName);
  const direction = isBuy && !isSell ? "买入" : isSell && !isBuy ? "卖出" : "";
  const counterparty = direction === "买入" ? seller : direction === "卖出" ? buyer : "";
  return normalizeTradeRecord({
    谈判日: dateText(record.tradeDate),
    交易日: dateText(record.tradeDate),
    债券代码: String(record.code || "").trim(),
    债券简称: String(record.shortName || "").trim(),
    净价: String(record.price || "").trim(),
    我行方向: direction,
    "面值（万元）": numberText(record.amountTenThousand),
    真实交易对手: counterparty,
    组合: "SSE",
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

function numberText(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function cleanCell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}
