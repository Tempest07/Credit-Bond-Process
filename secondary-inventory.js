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

export function normalizeSecondaryInventoryPositions(input = []) {
  return Array.isArray(input) ? input.map(normalizeInventoryPosition).filter((item) => item.code || item.shortName) : [];
}

export function normalizeSecondaryOrders(input = []) {
  return Array.isArray(input) ? input.map(normalizeSecondaryOrder).filter((item) => item.code || item.shortName) : [];
}

export function normalizeSecondaryTrades(input = []) {
  return Array.isArray(input) ? input.map(normalizeSecondaryTrade).filter((item) => item.code || item.shortName) : [];
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
  return {
    id: input.id || crypto.randomUUID(),
    side: ["buy", "sell"].includes(input.side) ? input.side : "sell",
    account: normalizeAccount(input.account),
    code: normalizeSecurityCode(input.code),
    shortName: String(input.shortName || "").trim(),
    quantityWan: numberOrNull(input.quantityWan ?? input.quantity) ?? 0,
    price: normalizePrice(input.price),
    yieldRate: numberOrNull(input.yieldRate),
    negotiationDate: normalizeDate(input.negotiationDate) || localDate(new Date()),
    tradeDate,
    settlementSpeed,
    settlementDate,
    counterparty: String(input.counterparty || "").trim(),
    intermediary: String(input.intermediary || "").trim(),
    sourceType: String(input.sourceType || "manual").trim(),
    sourceProjectId: String(input.sourceProjectId || "").trim(),
    sourceTrancheId: String(input.sourceTrancheId || "").trim(),
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
  const headerIndex = matrix.findIndex((row) =>
    headerColumn(row, ["债券代码"]) >= 0
    && headerColumn(row, ["债券简称"]) >= 0
    && headerColumn(row, ["名义本金", "本金", "持仓面额"]) >= 0
  );
  if (headerIndex < 0) return [];

  const headers = matrix[headerIndex];
  const codeIndex = headerColumn(headers, ["债券代码", "代码"]);
  const standardCodeIndex = headerColumn(headers, ["债券标准代码", "标准代码"]);
  const shortNameIndex = headerColumn(headers, ["债券简称", "简称"]);
  const principalIndex = headerColumn(headers, ["名义本金", "本金", "持仓面额"]);
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
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => parseSecondaryOrderLine(line, options))
    .filter(Boolean);
}

export function parseSecondaryTradeText(text = "", options = {}) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => parseSecondaryTradeLine(line, options))
    .filter(Boolean);
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
  for (const order of incoming) {
    const index = existing.findIndex((item) => item.id === order.id);
    if (index >= 0) existing[index] = order;
    else existing.unshift(order);
  }
  return { ...state, secondaryOrders: existing, updatedAt: new Date().toISOString() };
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
    } else {
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
    row.warning = row.availableWan < 0
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
    warnings: rows.filter((item) => item.availableWan < 0).length,
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
    quantityWan: Number.isFinite(quantityWan) ? quantityWan : 0,
    price: extractPrice(line),
    yieldRate: rate,
    status: "active",
    sourceText: rawLine,
  });
}

function parseSecondaryTradeLine(rawLine, options = {}) {
  const line = normalizeLine(rawLine);
  if (!line) return null;
  const code = extractSecurityCode(line);
  const shortName = extractShortName(line, code);
  const quantityWan = extractAmountWan(line);
  if (!code && !shortName) return null;
  if (!Number.isFinite(quantityWan)) return null;

  const bankName = options.bankName || "兴业银行";
  const isSell = new RegExp(`${escapeRegExp(bankName)}\\s*(?:出给|to)`, "i").test(line)
    || /(?:卖出|出给)/.test(line) && line.includes(bankName);
  const isBuy = new RegExp(`(?:出给|to)\\s*${escapeRegExp(bankName)}`, "i").test(line)
    || /(?:买入|收)/.test(line) && line.includes(bankName);
  const side = isBuy && !isSell ? "buy" : "sell";
  const tradeDateInfo = extractTradeDateAndSpeed(line, {
    referenceDate: options.referenceDate || new Date(),
    defaultSpeed: options.defaultSettlementSpeed ?? 1,
  });
  return normalizeSecondaryTrade({
    side,
    account: extractAccount(line) || options.account || DEFAULT_ACCOUNT,
    code,
    shortName,
    quantityWan,
    price: extractPrice(line),
    yieldRate: extractYieldRate(line),
    negotiationDate: normalizeDate(options.negotiationDate) || localDate(new Date()),
    tradeDate: tradeDateInfo.tradeDate || localDate(new Date()),
    settlementSpeed: tradeDateInfo.speed,
    settlementDate: inferSettlementDate(tradeDateInfo.tradeDate || localDate(new Date()), tradeDateInfo.speed),
    counterparty: extractCounterparty(line, bankName, side),
    intermediary: line.match(/【([^】]+)】/)?.[1]?.trim() || "",
    sourceType: "manual",
    sourceText: rawLine,
  });
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
    warning: "",
  };
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
  const match = text.match(SHORT_NAME_PATTERN);
  return match?.[1]?.trim() || "";
}

function extractAmountWan(line = "") {
  const patterns = [
    /(?:^|\s)(?:面额|余额|库存|持仓|数量|规模|挂卖|挂买|卖出|买入|卖|买|收)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|千万|手)?(?=\s|$)/i,
    /%\s*投\s*(\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|千万|手)(?=\s|$)/i,
    /(\d+(?:\.\d+)?)\s*(亿|万|w|kw|k|千万|手)(?=\s|$)/i,
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
  if (normalized === "亿") return number * 10000;
  if (["kw", "k", "千万"].includes(normalized)) return number * 1000;
  if (["w", "万"].includes(normalized)) return number;
  if (normalized === "手") return number / 10;
  return number;
}

function extractPrice(line = "") {
  const valuation = line.match(/估值\s*[-+]?\s*\d*(?:\.\d+)?/i)?.[0]?.replace(/\s+/g, "");
  if (valuation) return valuation;
  const labeledNet = line.match(/(?:净价|全价|价格|price)\s*[:：]?\s*(\d{2,3}(?:\.\d+)?(?:\/\d{2,3}(?:\.\d+)?)?)/i)?.[1];
  if (labeledNet && Number(labeledNet.split("/").at(-1)) >= 50) return labeledNet.includes("/") ? labeledNet.split("/").at(-1) : labeledNet;
  const matches = [...line.matchAll(/(?:净价|全价|价格|price)?\s*[:：]?\s*(\d{2,3}(?:\.\d+)?(?:\/\d{2,3}(?:\.\d+)?)?)(?=\s|$)/gi)];
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
  for (const match of line.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*%?(?=\s|$)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value < 20) return value;
  }
  return null;
}

function normalizePrice(value = "") {
  return String(value ?? "").trim();
}

function extractTradeDateAndSpeed(line = "", options = {}) {
  const referenceDate = options.referenceDate || new Date();
  const defaultSpeed = Number.isFinite(Number(options.defaultSpeed)) ? Number(options.defaultSpeed) : 1;
  const explicitSameDay = /(?:\+0|T\+0|当天|今日|立即)(?:交割|点交易|交易)?/i.test(line);
  const explicitNextDay = /(?:\+1|T\+1|明天|次日|下一工作日)(?:交割|点交易|交易)?/i.test(line);
  const fallbackSpeed = explicitSameDay ? 0 : explicitNextDay ? 1 : defaultSpeed;
  const year = new Date(referenceDate).getFullYear();
  const match = line.match(/(\d{1,2})[./](\d{1,2})(?:\s*\+?\s*([01]))?/);
  if (match) {
    const tradeDate = `${year}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
    return { tradeDate, speed: Number(match[3] ?? fallbackSpeed) };
  }
  const iso = line.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (iso) {
    return {
      tradeDate: `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`,
      speed: fallbackSpeed,
    };
  }
  return { tradeDate: localDate(new Date(referenceDate)), speed: fallbackSpeed };
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

function extractCounterparty(line = "", bankName = "兴业银行", side = "sell") {
  const escaped = escapeRegExp(bankName);
  const sellMatch = line.match(new RegExp(`${escaped}\\s*(?:出给|to)\\s*([^，,;；]+)`, "i"));
  if (sellMatch && side === "sell") return sellMatch[1].trim().split(/\s+/)[0];
  const buyMatch = line.match(new RegExp(`([^，,;；]+?)\\s*(?:出给|to)\\s*${escaped}`, "i"));
  if (buyMatch && side === "buy") return buyMatch[1].trim().split(/\s+/).at(-1);
  return "";
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
