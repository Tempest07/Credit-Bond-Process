import {
  normalizeTradeRecord,
  parseTradeRecordLine,
} from "./trade-record-converter.js";

const ACCOUNT_ALIASES = new Map([
  ["SDR", "SDR"],
  ["THR", "THR"],
  ["TX", "TX"],
  ["小账户", "小账户"],
  ["小户", "小账户"],
]);

const DEFAULT_ACCOUNT = "SDR";
const SECURITY_CODE_PATTERN = /\b(\d{6,9})(?:\.(IB|SH|SZ))?\b/i;
const SHORT_NAME_PATTERN = /\b(\d{2}[\u4e00-\u9fa5A-Za-z0-9]+?(?:SCP|CP|MTN|PPN|PRN|ABN|ABS)?[A-Za-z]?\d{0,3}(?:\/\d{2}[\u4e00-\u9fa5A-Za-z0-9]+?(?:SCP|CP|MTN|PPN|PRN|ABN|ABS)?[A-Za-z]?\d{0,3})?)\b/i;
const SECONDARY_TRADE_STAGES = new Set(["negotiated", "front_office_done", "ledgered", "sent"]);
const SECONDARY_TRADE_CATEGORIES = new Set(["protocol", "non_protocol", "primary_award"]);
const SECONDARY_INSTRUMENT_SCOPES = new Set(["public", "ppn", "exchange_private"]);
const TRADE_RECORD_SOURCE = "trade-phraser-54d42a6";

export function normalizeSecondaryInventoryPositions(input = []) {
  return Array.isArray(input) ? input.map(normalizeInventoryPosition).filter(isUsableSecondaryRecord) : [];
}

export function normalizeSecondaryOrders(input = []) {
  return Array.isArray(input) ? input.map(normalizeSecondaryOrder).filter(isUsableSecondaryRecord) : [];
}

export function normalizeSecondaryTrades(input = []) {
  return Array.isArray(input) ? input.map(normalizeSecondaryTrade).filter(isUsableSecondaryTrade) : [];
}

export function hasGarbledSecondaryText(record = {}) {
  return /\?{2,}/.test([
    record.shortName,
    record.region,
    record.groupName,
    record.price,
    record.sourceText,
  ].filter(Boolean).join(" "));
}

function isUsableSecondaryRecord(record = {}) {
  return Boolean(record.code || record.shortName) && !hasGarbledSecondaryText(record);
}

function isUsableSecondaryTrade(record = {}) {
  return (
    isUsableSecondaryRecord(record)
    || (record.tradeRecordSource === TRADE_RECORD_SOURCE && Boolean(record.sourceText))
  ) && !hasGarbledSecondaryText(record);
}

export function normalizeInventoryPosition(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || crypto.randomUUID(),
    account: normalizeAccount(input.account),
    code: normalizeSecurityCode(input.code),
    shortName: String(input.shortName || "").trim(),
    quantityWan: numberOrNull(input.quantityWan ?? input.quantity) ?? 0,
    snapshotDate: normalizeDate(input.snapshotDate) || localDate(new Date()),
    sourceText: String(input.sourceText || "").trim(),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function normalizeSecondaryOrder(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || crypto.randomUUID(),
    side: ["offer", "bid"].includes(input.side) ? input.side : "offer",
    account: normalizeAccount(input.account),
    code: normalizeSecurityCode(input.code),
    shortName: String(input.shortName || "").trim(),
    region: String(input.region || input.groupName || "").trim(),
    quantityWan: numberOrNull(input.quantityWan ?? input.quantity) ?? 0,
    price: normalizePrice(input.price),
    yieldRate: numberOrNull(input.yieldRate),
    status: ["active", "partial", "filled", "cancelled", "expired"].includes(input.status) ? input.status : "active",
    filledWan: numberOrNull(input.filledWan) ?? 0,
    sourceText: String(input.sourceText || "").trim(),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function normalizeSecondaryTrade(input = {}) {
  const now = new Date().toISOString();
  const tradeDate = normalizeDate(input.tradeDate) || localDate(new Date());
  const settlementSpeed = normalizeSettlementSpeed(input.settlementSpeed);
  const settlementDate = normalizeDate(input.settlementDate) || inferSettlementDate(tradeDate, settlementSpeed);
  const code = normalizeSecurityCode(input.code);
  const storedShortName = String(input.shortName || "").trim();
  const shortName = storedShortName && !extractRemainingTerm(storedShortName)
    ? storedShortName
    : extractShortName(normalizeLine(input.sourceText), code);
  const ledgerSentAt = String(input.ledgerSentAt || "").trim();
  const frontOfficeDone = Boolean(input.frontOfficeDone)
    || Boolean(String(input.frontOfficeAt || "").trim())
    || ["front_office_done", "ledgered", "sent"].includes(input.tradeStage);
  const frontOfficePrice = normalizePrice(input.frontOfficePrice ?? (frontOfficeDone ? input.price : ""));
  const tradeRecord = normalizeTradeRecord({
    ...secondaryTradeToTradeRecord(input),
    ...(frontOfficeDone && frontOfficePrice ? { 净价: frontOfficePrice } : {}),
  });
  return {
    id: input.id || crypto.randomUUID(),
    side: ["buy", "sell", "unknown"].includes(input.side)
      ? input.side
      : input.tradeRecordSource === TRADE_RECORD_SOURCE ? "unknown" : "sell",
    account: normalizeAccount(input.account),
    code,
    shortName,
    quantityWan: numberOrNull(input.quantityWan ?? input.quantity) ?? 0,
    price: normalizePrice(input.price),
    yieldRate: numberOrNull(input.yieldRate),
    negotiationDate: normalizeDate(input.negotiationDate) || localDate(new Date()),
    tradeDate,
    settlementSpeed,
    settlementDate,
    counterparty: String(input.counterparty || "").trim(),
    intermediary: String(input.intermediary || "").trim(),
    remainingTerm: String(input.remainingTerm || "").trim(),
    contactNote: String(input.contactNote || "").trim(),
    market: normalizeSecondaryMarket(input.market, code),
    instrumentScope: normalizeSecondaryInstrumentScope(input.instrumentScope, input.sourceText, code, shortName),
    parseWarnings: Array.isArray(input.parseWarnings) ? input.parseWarnings.map((item) => String(item || "").trim()).filter(Boolean) : [],
    sourceType: String(input.sourceType || "manual").trim(),
    tradeRecord,
    tradeRecordSources: normalizeTradeRecordSources(input.tradeRecordSources),
    tradeRecordDm: normalizeTradeRecordDm(input.tradeRecordDm),
    tradeRecordSource: String(input.tradeRecordSource || "").trim(),
    sourceProjectId: String(input.sourceProjectId || "").trim(),
    sourceTrancheId: String(input.sourceTrancheId || "").trim(),
    orderId: String(input.orderId || "").trim(),
    protocolTransferId: String(input.protocolTransferId || "").trim(),
    tradeCategory: normalizeSecondaryTradeCategory(input.tradeCategory, input.sourceType, input.code),
    tradeStage: normalizeSecondaryTradeStage(input.tradeStage, frontOfficeDone, ledgerSentAt),
    frontOfficeDone,
    frontOfficePrice,
    frontOfficeAt: String(input.frontOfficeAt || "").trim(),
    ledgerDate: normalizeDate(input.ledgerDate) || tradeDate,
    ledgerSentAt,
    codeStatus: input.codeStatus === "pending" || !normalizeSecurityCode(input.code) ? "pending" : "confirmed",
    sourceText: String(input.sourceText || "").trim(),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function parseInventorySnapshotText(text = "", options = {}) {
  const snapshotDate = normalizeDate(options.snapshotDate) || localDate(new Date());
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => parseInventorySnapshotLine(line, snapshotDate))
    .filter(Boolean);
}

export function parseInventoryLedgerRows(rows = [], options = {}) {
  const matrix = Array.isArray(rows)
    ? rows.map((row) => Array.isArray(row) ? row.map(cellText) : [])
    : [];
  const codeHeaders = ["债券代码", "证券代码", "债券标准代码", "标准代码", "代码"];
  const standardCodeHeaders = ["债券标准代码", "证券标准代码", "标准代码"];
  const shortNameHeaders = ["债券简称", "证券简称", "简称", "债券名称", "证券名称"];
  const principalHeaders = ["名义本金", "本金", "持仓面额", "持仓面值", "面额", "余额", "持仓数量", "数量"];
  const headerIndex = matrix.findIndex((row) =>
    headerColumn(row, codeHeaders) >= 0
    && headerColumn(row, shortNameHeaders) >= 0
    && headerColumn(row, principalHeaders) >= 0
  );
  if (headerIndex < 0) return [];

  const headers = matrix[headerIndex];
  const codeIndex = headerColumn(headers, codeHeaders);
  const standardCodeIndex = headerColumn(headers, standardCodeHeaders);
  const shortNameIndex = headerColumn(headers, shortNameHeaders);
  const principalIndex = headerColumn(headers, principalHeaders);
  const accountingIndex = headerColumn(headers, ["会计分类"]);
  const portfolioIndex = headerColumn(headers, ["投组信息", "投资组合", "组合"]);
  const branchIndex = headerColumn(headers, ["联动分行", "分行"]);
  const businessDateIndex = headerColumn(headers, ["数据业务日期", "业务日期", "报表日期"]);
  const fallbackDate = normalizeDate(options.snapshotDate) || localDate(new Date());

  return matrix.slice(headerIndex + 1)
    .map((row) => {
      const principal = numberOrNull(row[principalIndex]);
      const quantityWan = principalToWan(principal);
      const code = normalizeSecurityCode(row[codeIndex] || row[standardCodeIndex]);
      const shortName = String(row[shortNameIndex] || "").trim();
      if ((!code && !shortName) || !Number.isFinite(quantityWan) || quantityWan <= 0) return null;
      const accounting = String(row[accountingIndex] || "").trim();
      const portfolioInfo = String(row[portfolioIndex] || "").trim();
      const branch = String(row[branchIndex] || "").trim();
      return normalizeInventoryPosition({
        account: mapLedgerAccount(portfolioInfo, accounting),
        code,
        shortName,
        quantityWan,
        snapshotDate: normalizeDate(row[businessDateIndex]) || fallbackDate,
        sourceText: [branch, accounting, portfolioInfo, code || shortName, quantityWan].filter(Boolean).join(" "),
      });
    })
    .filter(Boolean);
}

export function parseSecondaryOrderText(text = "", options = {}) {
  const orders = [];
  let region = String(options.region || "").trim();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = normalizeLine(rawLine);
    if (isSecondaryOrderRegionLine(line)) {
      region = normalizeRegionHeading(rawLine);
      continue;
    }
    const order = parseSecondaryOrderLine(rawLine, { ...options, region });
    if (order) orders.push(order);
  }
  return orders;
}

export function parseSecondaryTradeText(text = "", options = {}) {
  return parseSecondaryTradeIntake(text, options).trades;
}

export function parseSecondaryTradeIntake(text = "", options = {}) {
  const trades = [];
  const protocolCandidates = [];
  const diagnostics = [];
  const negotiationDate = normalizeDate(options.negotiationDate) || localDate(new Date());
  const negotiationDateValue = parseDate(negotiationDate) || new Date();
  const bankName = String(options.bankName || "兴业银行").trim() || "兴业银行";
  String(text || "").split(/\r?\n/).forEach((rawLine, index) => {
    const line = normalizeLine(rawLine);
    if (!line) return;
    const parsed = parseTradeRecordLine(rawLine, negotiationDateValue, bankName);
    const trade = tradeRecordToSecondaryTrade(parsed.trade, {
      ...options,
      bankName,
      negotiationDate,
      sourceText: rawLine,
      warnings: parsed.warnings,
    });
    if (trade.instrumentScope === "exchange_private") {
      protocolCandidates.push(trade);
      diagnostics.push({
        lineNumber: index + 1,
        original: trade.sourceText,
        status: "protocol",
        message: "交易所私募已分流到协议转让",
      });
      return;
    }
    trades.push(trade);
    if (parsed.warnings.length) {
      diagnostics.push({
        lineNumber: index + 1,
        original: trade.sourceText,
        status: "warning",
        message: parsed.warnings.join("；"),
      });
    }
  });
  return { trades, protocolCandidates, diagnostics };
}

function normalizeTradeRecordSources(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, source]) => ["manual", "dm", "parsed"].includes(source))
      .map(([column, source]) => [String(column), source]),
  );
}

function normalizeTradeRecordDm(value) {
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

export function tradeRecordToSecondaryTrade(record = {}, context = {}) {
  const tradeRecord = normalizeTradeRecord(record);
  const sourceText = String(context.sourceText || "").trim();
  const code = normalizeSecurityCode(tradeRecord["债券代码"]);
  const shortName = String(tradeRecord["债券简称"] || extractShortName(normalizeLine(sourceText), code)).trim();
  const tradeDate = normalizeDate(tradeRecord["交易日"]) || normalizeDate(context.negotiationDate) || localDate(new Date());
  const settlementSpeed = tradeRecord["清算速度(0/1)"];
  const instrumentScope = classifySecondaryInstrument(normalizeLine(sourceText), code, shortName);
  return normalizeSecondaryTrade({
    side: tradeRecord["我行方向"] === "买入"
      ? "buy"
      : tradeRecord["我行方向"] === "卖出" ? "sell" : "unknown",
    account: tradeRecord["组合"] || context.account || DEFAULT_ACCOUNT,
    code,
    shortName,
    quantityWan: numberOrNull(tradeRecord["面值（万元）"]) ?? 0,
    price: tradeRecord["净价"],
    yieldRate: numberOrNull(tradeRecord["收益率(%)"]),
    negotiationDate: tradeRecord["谈判日"] || context.negotiationDate,
    tradeDate,
    settlementSpeed,
    settlementDate: inferSettlementDate(tradeDate, settlementSpeed),
    counterparty: tradeRecord["真实交易对手"],
    intermediary: tradeRecord["中介"],
    remainingTerm: extractRemainingTerm(normalizeLine(sourceText)),
    contactNote: extractContactNote(sourceText),
    instrumentScope,
    market: normalizeSecondaryMarket("", code),
    parseWarnings: context.warnings || [],
    sourceType: "trade_phraser",
    tradeRecord,
    tradeRecordSource: TRADE_RECORD_SOURCE,
    sourceText,
  });
}

export function secondaryTradeToTradeRecord(input = {}) {
  const existing = normalizeTradeRecord(input.tradeRecord || {});
  if (input.tradeRecordSource === TRADE_RECORD_SOURCE && input.tradeRecord) return existing;
  return normalizeTradeRecord({
    ...existing,
    谈判日: existing["谈判日"] || normalizeDate(input.negotiationDate),
    交易日: existing["交易日"] || normalizeDate(input.tradeDate),
    债券代码: existing["债券代码"] || normalizeSecurityCode(input.code),
    净价: existing["净价"] || normalizePrice(input.frontOfficePrice || input.price),
    "收益率(%)": existing["收益率(%)"] || (
      Number.isFinite(numberOrNull(input.yieldRate)) ? String(input.yieldRate) : ""
    ),
    我行方向: existing["我行方向"] || (input.side === "buy" ? "买入" : input.side === "sell" ? "卖出" : ""),
    "面值（万元）": existing["面值（万元）"] || (
      Number.isFinite(numberOrNull(input.quantityWan ?? input.quantity))
        ? String(numberOrNull(input.quantityWan ?? input.quantity))
        : ""
    ),
    真实交易对手: existing["真实交易对手"] || String(input.counterparty || "").trim(),
    中介: existing["中介"] || String(input.intermediary || "").trim(),
    "清算速度(0/1)": existing["清算速度(0/1)"] || (
      input.settlementSpeed === 0 || input.settlementSpeed === 1 ? String(input.settlementSpeed) : ""
    ),
  });
}

export function upsertInventoryPositions(state, positions = []) {
  const incoming = normalizeSecondaryInventoryPositions(positions);
  const existing = [...(state.secondaryInventoryPositions || [])];
  for (const position of incoming) {
    const index = existing.findIndex((item) =>
      positionKey(item) === positionKey(position) && item.snapshotDate === position.snapshotDate
    );
    if (index >= 0) existing[index] = { ...existing[index], ...position, updatedAt: new Date().toISOString() };
    else existing.unshift(position);
  }
  return { ...state, secondaryInventoryPositions: existing, updatedAt: new Date().toISOString() };
}

export function upsertSecondaryOrders(state, orders = []) {
  const incoming = normalizeSecondaryOrders(Array.isArray(orders) ? orders : [orders]);
  const existing = [...(state.secondaryOrders || [])];
  const additions = [];
  for (const order of incoming) {
    const incomingKey = secondaryOrderUpsertKey(order);
    const index = existing.findIndex((item) => item.id === order.id || secondaryOrderUpsertKey(item) === incomingKey);
    if (index >= 0) existing.splice(index, 1);
    additions.push(order);
  }
  return { ...state, secondaryOrders: [...additions, ...existing], updatedAt: new Date().toISOString() };
}

export function upsertSecondaryTrades(state, trades = []) {
  const incoming = normalizeSecondaryTrades(Array.isArray(trades) ? trades : [trades]);
  const existing = [...(state.secondaryTrades || [])];
  for (const trade of incoming) {
    const index = existing.findIndex((item) => item.id === trade.id);
    if (index >= 0) existing[index] = trade;
    else existing.unshift(trade);
  }
  return { ...state, secondaryTrades: existing, updatedAt: new Date().toISOString() };
}

export function markSecondaryOrderStatus(order, status, filledWan = null) {
  return normalizeSecondaryOrder({
    ...order,
    status,
    filledWan: numberOrNull(filledWan) ?? order.filledWan,
    updatedAt: new Date().toISOString(),
  });
}

export function removeSecondaryTrade(state = {}, id = "") {
  return {
    ...state,
    secondaryTrades: normalizeSecondaryTrades(state.secondaryTrades || []).filter((trade) => trade.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

export function secondaryTradeMissingFields(input = {}) {
  const tradeRecord = normalizeTradeRecord(input.tradeRecord || secondaryTradeToTradeRecord(input));
  const fields = [];
  const add = (key, label) => fields.push({ key, label });
  const settlementSpeed = String(tradeRecord["清算速度(0/1)"] || "").trim();

  if (!normalizeDate(tradeRecord["谈判日"])) add("negotiationDate", "谈判日");
  if (!normalizeDate(tradeRecord["交易日"])) add("tradeDate", "交易日");
  if (!normalizeSecurityCode(tradeRecord["债券代码"])) add("code", "债券代码");
  if (!String(tradeRecord["债券简称"] || input.shortName || "").trim()) add("shortName", "债券简称");
  if (!["买入", "卖出"].includes(String(tradeRecord["我行方向"] || "").trim())) add("side", "我行方向");
  if (!(numberOrNull(tradeRecord["面值（万元）"]) > 0)) add("quantityWan", "面值");
  if (!String(tradeRecord["真实交易对手"] || "").trim()) add("counterparty", "真实交易对手");
  if (!String(tradeRecord["中介"] || "").trim()) add("intermediary", "中介");
  if (!["0", "1"].includes(settlementSpeed)) add("settlementSpeed", "清算速度");
  if (!isValidSecondaryNetPrice(input.frontOfficePrice || input.price || tradeRecord["净价"])) {
    add("frontOfficePrice", "成交净价");
  }

  return fields;
}

export function updateSecondaryPendingTrade(trade = {}, input = {}) {
  const existing = normalizeTradeRecord(trade.tradeRecord || secondaryTradeToTradeRecord(trade));
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const negotiationDate = normalizeDate(has("negotiationDate") ? input.negotiationDate : existing["谈判日"]);
  const tradeDate = normalizeDate(has("tradeDate") ? input.tradeDate : existing["交易日"]);
  const code = normalizeSecurityCode(has("code") ? input.code : existing["债券代码"]);
  const shortName = String(has("shortName") ? input.shortName : trade.shortName || existing["债券简称"] || "").trim();
  const side = has("side")
    ? (["buy", "sell"].includes(input.side) ? input.side : "unknown")
    : existing["我行方向"] === "买入" ? "buy" : existing["我行方向"] === "卖出" ? "sell" : "unknown";
  const quantityWan = numberOrNull(has("quantityWan") ? input.quantityWan : existing["面值（万元）"]) ?? 0;
  const yieldRate = numberOrNull(has("yieldRate") ? input.yieldRate : existing["收益率(%)"] || trade.yieldRate);
  const counterparty = String(has("counterparty") ? input.counterparty : existing["真实交易对手"] || "").trim();
  const tradeCounterparty = String(
    has("tradeCounterparty") ? input.tradeCounterparty : existing["交易对手"] || "",
  ).trim();
  const intermediary = String(has("intermediary") ? input.intermediary : existing["中介"] || "").trim();
  const speedValue = String(has("settlementSpeed") ? input.settlementSpeed : existing["清算速度(0/1)"] || "").trim();
  const settlementSpeed = ["0", "1"].includes(speedValue) ? speedValue : "";
  const frontOfficePrice = normalizePrice(
    has("frontOfficePrice") ? input.frontOfficePrice : trade.frontOfficePrice || trade.price || existing["净价"],
  );
  const tradeRecord = normalizeTradeRecord({
    ...existing,
    谈判日: negotiationDate,
    交易日: tradeDate,
    债券代码: code,
    债券简称: shortName,
    净价: frontOfficePrice,
    "收益率(%)": Number.isFinite(yieldRate) ? String(yieldRate) : "",
    我行方向: side === "buy" ? "买入" : side === "sell" ? "卖出" : "",
    "面值（万元）": quantityWan > 0 ? String(quantityWan) : "",
    真实交易对手: counterparty,
    交易对手: tradeCounterparty,
    中介: intermediary,
    "清算速度(0/1)": settlementSpeed,
  });
  const parseWarnings = [];
  if (!intermediary) parseWarnings.push("未识别中介");
  if (!code) parseWarnings.push("未识别债券代码");
  if (!tradeDate) parseWarnings.push("未识别交易日");
  if (!settlementSpeed) parseWarnings.push("未识别清算速度");
  if (!tradeRecord["收益率(%)"] && !frontOfficePrice) parseWarnings.push("未识别收益率或净价");
  if (!(quantityWan > 0)) parseWarnings.push("未识别面值");
  if (side === "unknown" || !counterparty) parseWarnings.push("未识别方向或真实交易对手");

  return normalizeSecondaryTrade({
    ...trade,
    code,
    shortName,
    side,
    quantityWan,
    yieldRate,
    negotiationDate,
    tradeDate,
    settlementSpeed,
    settlementDate: tradeDate && settlementSpeed ? inferSettlementDate(tradeDate, settlementSpeed) : "",
    counterparty,
    intermediary,
    frontOfficePrice,
    price: frontOfficePrice || trade.price,
    parseWarnings,
    tradeRecord,
    updatedAt: new Date().toISOString(),
  });
}

export function markSecondaryTradeFrontOffice(trade, input = {}) {
  const now = String(input.frontOfficeAt || input.now || new Date().toISOString());
  const tradeDate = normalizeDate(input.tradeDate) || trade.tradeDate;
  const frontOfficePrice = normalizePrice(input.frontOfficePrice ?? trade.frontOfficePrice ?? trade.price);
  return normalizeSecondaryTrade({
    ...trade,
    tradeDate,
    frontOfficeDone: true,
    frontOfficePrice,
    tradeRecord: {
      ...secondaryTradeToTradeRecord(trade),
      净价: frontOfficePrice,
      交易日: tradeDate,
    },
    frontOfficeAt: now,
    ledgerDate: normalizeDate(input.ledgerDate) || tradeDate,
    tradeStage: "front_office_done",
    updatedAt: now,
  });
}

export function markSecondaryTradesLedgerSent(trades = [], ids = [], sentAt = new Date().toISOString()) {
  const selectedIds = new Set(ids);
  return normalizeSecondaryTrades(trades).map((trade) =>
    selectedIds.has(trade.id)
      ? normalizeSecondaryTrade({ ...trade, ledgerSentAt: sentAt, tradeStage: "sent", updatedAt: sentAt })
      : trade,
  );
}

export function buildPrimaryAwardTrades(projects = [], existingTrades = []) {
  const existingKeys = new Set(existingTrades.map(primaryAwardKey).filter(Boolean));
  const trades = [];
  for (const project of projects || []) {
    for (const tranche of project.tranches || []) {
      const quantityWan = numberOrNull(tranche.winningAmountWan);
      if (!Number.isFinite(quantityWan) || quantityWan <= 0) continue;
      const key = `${project.id}:${tranche.id}`;
      if (existingKeys.has(key)) continue;
      trades.push(normalizeSecondaryTrade({
        side: "buy",
        account: "SDR",
        code: tranche.securityCode || "",
        shortName: tranche.shortName || project.shortName,
        quantityWan,
        price: tranche.winningRate ? `${tranche.winningRate}%` : "",
        yieldRate: tranche.winningRate,
        negotiationDate: project.cutoffAt ? String(project.cutoffAt).slice(0, 10) : localDate(new Date()),
        tradeDate: tranche.paymentDate || project.cutoffAt?.slice(0, 10) || localDate(new Date()),
        settlementSpeed: 0,
        settlementDate: tranche.paymentDate || project.cutoffAt?.slice(0, 10) || localDate(new Date()),
        counterparty: project.leadUnderwriter || "",
        sourceType: "primary_award",
        sourceProjectId: project.id,
        sourceTrancheId: tranche.id,
        codeStatus: tranche.securityCode ? "confirmed" : "pending",
        sourceText: project.sourceText || project.opinion || "",
      }));
    }
  }
  return trades;
}

export function calculateShadowInventory(state = {}, options = {}) {
  const asOfDate = normalizeDate(options.asOfDate) || localDate(new Date());
  const positions = latestInventoryPositions(state.secondaryInventoryPositions || []);
  const trades = normalizeSecondaryTrades(state.secondaryTrades || []);
  const orders = normalizeSecondaryOrders(state.secondaryOrders || []);
  const rows = new Map();

  for (const position of positions) {
    const key = positionKey(position);
    rows.set(key, baseInventoryRow(position, position.quantityWan));
  }

  for (const trade of trades) {
    const key = positionKey(trade);
    if (!rows.has(key)) rows.set(key, baseInventoryRow(trade));
    const row = rows.get(key);
    const snapshotDate = row.snapshotDate || "";
    const shouldApply = !snapshotDate || !trade.settlementDate || trade.settlementDate > snapshotDate;
    if (!shouldApply) continue;

    if (trade.side === "sell") {
      row.soldWan += trade.quantityWan;
      if (trade.settlementDate > asOfDate) row.unsettledSellWan += trade.quantityWan;
    } else if (trade.side === "buy") {
      if (trade.settlementDate <= asOfDate) row.settledBuyWan += trade.quantityWan;
      else row.pendingBuyWan += trade.quantityWan;
    }
  }

  for (const order of orders.filter((item) => item.status === "active" || item.status === "partial")) {
    const key = positionKey(order);
    if (!rows.has(key)) rows.set(key, baseInventoryRow(order));
    const row = rows.get(key);
    if (order.side === "offer") row.activeOfferWan += Math.max(0, order.quantityWan - order.filledWan);
    else row.activeBidWan += Math.max(0, order.quantityWan - order.filledWan);
  }

  for (const row of rows.values()) {
    row.shadowQuantityWan = round(row.snapshotQuantityWan + row.settledBuyWan - row.soldWan, 4);
    row.availableWan = round(row.shadowQuantityWan - row.activeOfferWan, 4);
    row.needsSnapshot = !row.snapshotDate
      && row.snapshotQuantityWan === 0
      && (row.activeOfferWan > 0 || row.soldWan > 0 || row.unsettledSellWan > 0);
    row.warning = row.needsSnapshot
      ? "缺少库存快照，请先导入余额台账"
      : row.availableWan < 0
      ? `可能卖空 ${formatAmountWan(Math.abs(row.availableWan))}`
      : row.unsettledSellWan > 0
        ? `含未交割卖出 ${formatAmountWan(row.unsettledSellWan)}`
        : "";
  }

  return [...rows.values()].sort((left, right) =>
    (left.warning ? 0 : 1) - (right.warning ? 0 : 1)
    || left.account.localeCompare(right.account)
    || left.shortName.localeCompare(right.shortName)
  );
}

export function pendingCodeTrades(state = {}) {
  return normalizeSecondaryTrades(state.secondaryTrades || [])
    .filter((trade) => !trade.code || trade.codeStatus === "pending")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function pendingSecondaryTrades(state = {}) {
  return normalizeSecondaryTrades(state.secondaryTrades || [])
    .filter((trade) =>
      !trade.frontOfficeDone
      && trade.tradeStage === "negotiated"
      && trade.tradeCategory === "non_protocol"
      && trade.sourceType !== "primary_award"
      && trade.instrumentScope !== "exchange_private"
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function isValidSecondaryNetPrice(value) {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) && number >= 50 && number <= 150;
}

export function secondaryTradesForLedger(state = {}, date = localDate(new Date())) {
  const ledgerDate = normalizeDate(date) || localDate(new Date());
  return normalizeSecondaryTrades(state.secondaryTrades || [])
    .filter((trade) => trade.frontOfficeDone && (trade.ledgerDate || trade.tradeDate) === ledgerDate)
    .sort((left, right) =>
      left.tradeDate.localeCompare(right.tradeDate)
      || left.shortName.localeCompare(right.shortName)
      || left.createdAt.localeCompare(right.createdAt)
    );
}

export function buildSecondaryOfferListText(orders = [], options = {}) {
  const defaultRegion = String(options.defaultRegion || "未分组").trim();
  const groups = [];
  const groupMap = new Map();
  const seen = new Set();
  for (const order of normalizeSecondaryOrders(orders)) {
    if (order.side !== "offer" || !["active", "partial"].includes(order.status)) continue;
    if (isGarbledSecondaryOrder(order)) continue;
    const key = secondaryOrderExportKey(order);
    if (seen.has(key)) continue;
    seen.add(key);
    const region = order.region || defaultRegion;
    if (!groupMap.has(region)) {
      const group = { region, orders: [] };
      groupMap.set(region, group);
      groups.push(group);
    }
    groupMap.get(region).orders.push(order);
  }
  const sections = groups
    .map((group) => [group.region, ...group.orders.map(formatSecondaryOfferListLine)].join("\n"))
    .filter(Boolean);
  return sections.length ? ["OFR", "", sections.join("\n\n")].join("\n") : "OFR";
}

export function applyCodeMappingText(state = {}, text = "") {
  const mappings = parseCodeMappingText(text);
  if (!mappings.length) return { state, updatedCount: 0 };
  let updatedCount = 0;
  const trades = normalizeSecondaryTrades(state.secondaryTrades || []).map((trade) => {
    if (trade.code && trade.codeStatus === "confirmed") return trade;
    const code = mappings.find((item) => item.shortName && namesMatch(item.shortName, trade.shortName))?.code;
    if (!code) return trade;
    updatedCount += 1;
    return normalizeSecondaryTrade({ ...trade, code, codeStatus: "confirmed" });
  });
  return { state: { ...state, secondaryTrades: trades, updatedAt: new Date().toISOString() }, updatedCount };
}

export function secondaryDashboardCounts(state = {}) {
  const rows = calculateShadowInventory(state);
  const orders = normalizeSecondaryOrders(state.secondaryOrders || []);
  const trades = normalizeSecondaryTrades(state.secondaryTrades || []);
  return {
    positions: rows.length,
    activeOffers: orders.filter((item) => item.status === "active" && item.side === "offer").length,
    warnings: rows.filter((item) => !item.needsSnapshot && item.availableWan < 0).length,
    pendingCodes: pendingCodeTrades(state).length,
    unsettledSells: trades.filter((item) => item.side === "sell" && item.settlementDate > localDate(new Date())).length,
  };
}

export function formatAmountWan(value) {
  const number = numberOrNull(value);
  if (!Number.isFinite(number)) return "";
  return Math.abs(number) >= 10000 ? `${formatNumber(number / 10000)}亿` : `${formatNumber(number)}万`;
}

export function positionKey(input = {}) {
  return `${normalizeAccount(input.account)}::${normalizeSecurityCode(input.code) || String(input.shortName || "").trim() || input.id || "unknown"}`;
}

function parseInventorySnapshotLine(rawLine, snapshotDate) {
  const line = normalizeLine(rawLine);
  if (!line || /代码|简称|余额|库存|面额|持仓/.test(line) && !SECURITY_CODE_PATTERN.test(line)) return null;
  const code = extractSecurityCode(line);
  const shortName = extractShortName(line, code);
  const quantityWan = extractAmountWan(line);
  if (!code && !shortName) return null;
  if (!Number.isFinite(quantityWan)) return null;
  return normalizeInventoryPosition({
    account: extractAccount(line),
    code,
    shortName,
    quantityWan,
    snapshotDate,
    sourceText: rawLine,
  });
}

function parseSecondaryOrderLine(rawLine, options = {}) {
  const line = normalizeLine(rawLine);
  if (!line) return null;
  const code = extractSecurityCode(line);
  const shortName = extractShortName(line, code);
  const quantityWan = extractAmountWan(line);
  if (!code && !shortName) return null;
  const hasOrderMarker = /(?:ofr|offer|bid|\bb\b|挂卖|挂买|卖出|买入|收|净价|估值)/i.test(line);
  if (!Number.isFinite(quantityWan) && !hasOrderMarker) return null;
  const side = /(?:bid|买|收|挂B|挂b|\bb\b)/i.test(line) && !/(?:offer|ofr|卖|出给|挂卖)/i.test(line)
    ? "bid"
    : "offer";
  const rate = extractYieldRate(line);
  return normalizeSecondaryOrder({
    side,
    account: extractAccount(line) || options.account || DEFAULT_ACCOUNT,
    code,
    shortName,
    region: options.region || "",
    quantityWan: Number.isFinite(quantityWan) ? quantityWan : 0,
    price: extractPrice(line),
    yieldRate: rate,
    status: "active",
    sourceText: rawLine,
  });
}

function isSecondaryOrderRegionLine(line = "") {
  const text = String(line || "").trim();
  if (!text || /^OFR$/i.test(text)) return false;
  if (SECURITY_CODE_PATTERN.test(text)) return false;
  if (/(?:ofr|offer|bid|\bb\b|挂卖|挂买|卖出|买入|净价|估值|收益率|收益|YTM)/i.test(text)) return false;
  if (/\d+(?:\.\d+)?\s*(?:亿|万|w|kw|k|千万|手)?/i.test(text)) return false;
  return /[\u4e00-\u9fa5]/.test(text) && text.length <= 40;
}

function normalizeRegionHeading(value = "") {
  return String(value || "")
    .replace(/\u00a0|\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function secondaryOrderUpsertKey(order = {}) {
  const normalized = normalizeSecondaryOrder(order);
  if (normalized.code) return `${normalized.side}:${normalized.account}:code:${normalized.code}`;
  return `${normalized.side}:${normalized.account}:name:${normalizeTextKey(normalized.shortName)}:${normalizeTextKey(normalized.price)}:${normalized.yieldRate ?? ""}:${normalized.quantityWan}`;
}

function secondaryOrderExportKey(order = {}) {
  const normalized = normalizeSecondaryOrder(order);
  if (normalized.code) return `code:${normalized.code}`;
  return `name:${normalizeTextKey(normalized.shortName)}:${normalizeTextKey(formatSecondaryOfferQuote(normalized))}:${normalized.quantityWan}`;
}

function isGarbledSecondaryOrder(order = {}) {
  return hasGarbledSecondaryText(order);
}

function normalizeTextKey(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function formatSecondaryOfferListLine(order) {
  const parts = [
    order.code,
    order.shortName,
    order.quantityWan > 0 ? formatNumber(order.quantityWan) : "",
    formatSecondaryOfferQuote(order),
  ].filter(Boolean);
  return parts.join("，");
}

function formatSecondaryOfferQuote(order) {
  const price = normalizePrice(order.price);
  if (price && /(?:净价|估值)/i.test(`${order.sourceText || ""} ${price}`)) return formatSecondaryOfferPriceQuote(price);
  if (Number.isFinite(order.yieldRate)) return `${formatNumber(order.yieldRate)}*ofr`;
  if (!price) return "ofr";
  return formatSecondaryOfferPriceQuote(price);
}

function formatSecondaryOfferPriceQuote(price) {
  if (/^估值$/i.test(price)) return "OFR估值";
  if (/^估值/i.test(price)) return `${price}*ofr`;
  if (/^净价/i.test(price)) return `${price}*ofr`;
  if (Number.isFinite(Number(price)) && Number(price) >= 50) return `净价${formatNumber(price)}*ofr`;
  return /ofr/i.test(price) ? price : `${price}*ofr`;
}

function latestInventoryPositions(positions = []) {
  const latest = new Map();
  for (const position of normalizeSecondaryInventoryPositions(positions)) {
    const key = positionKey(position);
    const current = latest.get(key);
    if (!current || position.snapshotDate >= current.snapshotDate || position.updatedAt > current.updatedAt) latest.set(key, position);
  }
  return [...latest.values()];
}

function baseInventoryRow(input = {}, snapshotQuantityWan = 0) {
  return {
    key: positionKey(input),
    account: normalizeAccount(input.account),
    code: normalizeSecurityCode(input.code),
    shortName: String(input.shortName || "").trim(),
    snapshotDate: input.snapshotDate || "",
    snapshotQuantityWan: numberOrNull(snapshotQuantityWan) ?? 0,
    settledBuyWan: 0,
    pendingBuyWan: 0,
    soldWan: 0,
    unsettledSellWan: 0,
    activeOfferWan: 0,
    activeBidWan: 0,
    shadowQuantityWan: 0,
    availableWan: 0,
    needsSnapshot: false,
    warning: "",
  };
}

function extractRemainingTerm(line = "") {
  return line.match(/(?:^|[\s】])(\d+(?:\.\d+)?\s*[DY](?:\s*\+\s*\d+(?:\.\d+)?\s*[DY])?(?:\([^)]*\))?)(?=\s|$)/i)?.[1]?.replace(/\s+/g, "") || "";
}

function extractContactNote(rawLine = "") {
  const text = String(rawLine || "").replace(/\u00a0|\u3000/g, " ").trim();
  const match = text.match(/(?:联系|对话发给|对话发|发给)\s*([^，,；;]+?)(?=\s+\d{2,3}(?:\.\d+)?\s*$|$)/);
  return match?.[1]?.trim() || "";
}

function classifySecondaryInstrument(line = "", code = "", shortName = "") {
  const text = `${line} ${shortName}`;
  if (/PPN/i.test(text)) return "ppn";
  const exchange = /\.(?:SH|SZ)\b/i.test(code) || /交易所|上交所|深交所/.test(text);
  const explicitPrivate = /私募债|非公开|协议转让/.test(text);
  return exchange && explicitPrivate ? "exchange_private" : "public";
}

function normalizeSecondaryInstrumentScope(value = "", sourceText = "", code = "", shortName = "") {
  if (SECONDARY_INSTRUMENT_SCOPES.has(value)) return value;
  return classifySecondaryInstrument(normalizeLine(sourceText), normalizeSecurityCode(code), shortName);
}

function normalizeSecondaryMarket(value = "", code = "") {
  const market = String(value || "").trim().toUpperCase();
  if (["IB", "SH", "SZ"].includes(market)) return market;
  return normalizeSecurityCode(code).match(/\.(IB|SH|SZ)$/i)?.[1]?.toUpperCase() || "";
}

function parseCodeMappingText(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const code = extractSecurityCode(line);
      const shortName = extractShortName(line, code);
      return code && shortName ? { code, shortName } : null;
    })
    .filter(Boolean);
}

function primaryAwardKey(trade = {}) {
  return trade.sourceType === "primary_award" && trade.sourceProjectId && trade.sourceTrancheId
    ? `${trade.sourceProjectId}:${trade.sourceTrancheId}`
    : "";
}

function namesMatch(left = "", right = "") {
  const a = String(left || "").trim().toUpperCase();
  const b = String(right || "").trim().toUpperCase();
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function normalizeLine(value = "") {
  return String(value)
    .replace(/\u00a0|\u3000/g, " ")
    .replace(/[，,；;]/g, " ")
    .replace(/[（）]/g, (match) => match === "（" ? "(" : ")")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return localDate(value);
  if (typeof value === "object") {
    if (value.text) return String(value.text).trim();
    if (value.result !== undefined) return cellText(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || "").join("").trim();
    if (value.hyperlink && value.text) return String(value.text).trim();
  }
  return String(value).trim();
}

function headerColumn(headers = [], names = []) {
  return headers.findIndex((header) => {
    const value = String(header || "").replace(/\s+/g, "");
    return names.some((name) => value === name || value.includes(name));
  });
}

function principalToWan(value) {
  const number = numberOrNull(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) >= 1000000 ? round(number / 10000, 4) : round(number, 4);
}

function mapLedgerAccount(portfolioInfo = "", accounting = "") {
  const text = `${portfolioInfo} ${accounting}`.toUpperCase();
  if (/\bTHR\b|BK_BD_RC_THR/.test(text)) return "THR";
  if (/\bTX\b|BK_BD_AS_TX/.test(text)) return "TX";
  if (/\bSDR\b|BK_BD_AS_SDR/.test(text)) return "SDR";
  if (/RECEIVABLE/.test(text)) return "THR";
  if (/TRADING/.test(text)) return "TX";
  if (/AFS/.test(text)) return "SDR";
  return DEFAULT_ACCOUNT;
}

function extractAccount(line = "") {
  for (const [alias, account] of ACCOUNT_ALIASES.entries()) {
    if (new RegExp(`(^|\\s)${escapeRegExp(alias)}($|\\s)`, "i").test(line)) return account;
  }
  return DEFAULT_ACCOUNT;
}

function normalizeAccount(value = "") {
  const text = String(value || "").trim();
  return ACCOUNT_ALIASES.get(text.toUpperCase()) || ACCOUNT_ALIASES.get(text) || text || DEFAULT_ACCOUNT;
}

function extractSecurityCode(line = "") {
  const match = line.match(SECURITY_CODE_PATTERN);
  if (!match) return "";
  return normalizeSecurityCode(`${match[1]}${match[2] ? `.${match[2]}` : ""}`);
}

function normalizeSecurityCode(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefixed = text.match(/^(IB|SH|SZ)(\d{6,9})$/i);
  if (prefixed) return `${prefixed[2]}.${prefixed[1].toUpperCase()}`;
  const match = text.match(/^(\d{6,9})(?:\.(IB|SH|SZ))?$/i);
  if (!match) return text;
  if (match[2]) return `${match[1]}.${match[2].toUpperCase()}`;
  if (match[1].length >= 9) return `${match[1]}.IB`;
  return match[1];
}

function extractShortName(line = "", code = "") {
  let text = line;
  if (code) text = text.replace(code.replace(/\.(IB|SH|SZ)$/i, ""), " ").replace(code, " ");
  const token = text.split(/\s+/).find((item) => isShortNameToken(item));
  if (token) return token;
  const match = text.match(SHORT_NAME_PATTERN);
  return match?.[1]?.trim() || "";
}

function isShortNameToken(value = "") {
  const text = String(value || "").trim();
  if (!text || SECURITY_CODE_PATTERN.test(text)) return false;
  if (extractRemainingTerm(text)) return false;
  if (/^(?:ofr|offer|bid|净价|全价|价格|估值|收益|收益率)/i.test(text)) return false;
  if (/^\d+(?:\.\d+)?(?:亿|万|w|kw|k|e|千万|手)?$/i.test(text)) return false;
  return /^\d{2}[\u4e00-\u9fa5A-Za-z0-9()（）/.-]+$/.test(text);
}

function extractAmountWan(line = "") {
  const patterns = [
    /(?:^|\s)(?:面额|余额|库存|持仓|数量|规模|挂卖|挂买|卖出|买入|卖|买|收)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|e|千万|手)?(?=\s|$)/i,
    /%\s*投\s*(\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|e|千万|手)(?=\s|$)/i,
    /(\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|e|千万|手)(?=\s|$)/i,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const amount = amountToWan(match[1], match[2]);
    if (Number.isFinite(amount)) return amount;
  }
  const numbers = [...line.matchAll(/(?:^|\s)(\d{3,6})(?=\s|$)/g)].map((match) => Number(match[1]));
  return numbers.find((item) => item >= 50) ?? null;
}

function amountToWan(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = String(unit || "").toLowerCase();
  if (["亿", "e"].includes(normalized)) return number * 10000;
  if (["kw", "k", "千万"].includes(normalized)) return number * 1000;
  if (["w", "万"].includes(normalized)) return number;
  if (normalized === "手") return number / 10;
  return number;
}

function extractPrice(line = "") {
  const valuation = line.match(/估值\s*[-+]?\s*\d*(?:\.\d+)?/i)?.[0]?.replace(/\s+/g, "");
  if (valuation) return valuation;
  const postfixedNet = line.match(/(?:^|\s)(\d{2,3}(?:\.\d+)?)\s*(?:净价|全价)(?=\s|$)/i)?.[1];
  if (postfixedNet && Number(postfixedNet) >= 50) return postfixedNet;
  const labeledNet = line.match(/(?:净价|全价|价格|price)\s*[:：]?\s*(\d{2,3}(?:\.\d+)?(?:\/\d{2,3}(?:\.\d+)?)?)/i)?.[1];
  if (labeledNet && Number(labeledNet.split("/").at(-1)) >= 50) return labeledNet.includes("/") ? labeledNet.split("/").at(-1) : labeledNet;
  const yieldPricePair = line.match(/(?:^|\s)\d+(?:\.\d+)?\s*\/\s*(\d{2,3}(?:\.\d+)?)(?=\s|$)/)?.[1];
  if (yieldPricePair && Number(yieldPricePair) >= 50) return yieldPricePair;
  const matches = [...line.matchAll(/(?:^|\s)(?:净价|全价|价格|price)?\s*[:：]?\s*(\d{2,3}(?:\.\d+)?(?:\/\d{2,3}(?:\.\d+)?)?)(?=\s|$)/gi)];
  for (const match of matches) {
    const net = match[1];
    if (Number(net.split("/").at(-1)) >= 50) return net.includes("/") ? net.split("/").at(-1) : net;
  }
  return "";
}

function extractYieldRate(line = "") {
  if (/估值\s*[-+]\s*\d+(?:\.\d+)?\s*\*?\s*(?:ofr|offer|bid|\bb\b)/i.test(line)) return null;
  const marked = line.match(/(\d+(?:\.\d+)?)\s*%?\s*\*?\s*(?:ofr|offer|bid|\bb\b)/i)?.[1];
  if (marked) {
    const value = Number(marked);
    if (Number.isFinite(value) && value > 0 && value < 20) return value;
  }
  const explicit = line.match(/(?:收益率|收益|YTM|ytm)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/i)?.[1];
  if (explicit) {
    const value = Number(explicit);
    if (Number.isFinite(value) && value > 0 && value < 20) return value;
  }
  const exercise = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:行权|到期)(?=\s|$)/)?.[1];
  if (exercise) {
    const value = Number(exercise);
    if (Number.isFinite(value) && value > 0 && value < 20) return value;
  }
  const yieldPricePair = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*\/\s*\d{2,3}(?:\.\d+)?(?=\s|$)/)?.[1];
  if (yieldPricePair) {
    const value = Number(yieldPricePair);
    if (Number.isFinite(value) && value > 0 && value < 20) return value;
  }
  for (const match of line.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*%?(?=\s|$)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value < 20) return value;
  }
  return null;
}

function normalizePrice(value = "") {
  return String(value ?? "").trim();
}

function normalizeSecondaryTradeStage(stage, frontOfficeDone, ledgerSentAt) {
  if (ledgerSentAt) return "sent";
  if (SECONDARY_TRADE_STAGES.has(stage)) return stage;
  return frontOfficeDone ? "front_office_done" : "negotiated";
}

function normalizeSecondaryTradeCategory(category, sourceType = "", code = "") {
  if (SECONDARY_TRADE_CATEGORIES.has(category)) return category;
  if (sourceType === "primary_award") return "primary_award";
  if (sourceType === "protocol_transfer") return "protocol";
  return normalizeSecurityCode(code).endsWith(".SH") && sourceType === "protocol" ? "protocol" : "non_protocol";
}

function normalizeSettlementSpeed(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function inferSettlementDate(tradeDate, speed = 0) {
  const date = parseDate(tradeDate) || new Date();
  date.setDate(date.getDate() + normalizeSettlementSpeed(speed));
  return localDate(date);
}

function normalizeDate(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = parseDate(text);
  return date ? localDate(date) : "";
}

function parseDate(value = "") {
  const match = String(value || "").match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDate(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim().replace(/,/g, "").replace(/，/g, "");
    const amount = text.match(/^([-+]?\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|千万|手)$/i);
    if (amount) return amountToWan(amount[1], amount[2]);
    if (/^[-+]?\d+(?:\.\d+)?%?$/.test(text)) return Number(text.replace(/%$/, ""));
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
