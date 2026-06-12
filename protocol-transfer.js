const DEFAULT_TYPE = "商业银行";
const DATE_PATTERN = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;
const MONTH_DAY_PATTERN = /(\d{1,2})月(\d{1,2})日/;

export function normalizeProtocolTransfers(input = []) {
  return Array.isArray(input) ? input.map(normalizeProtocolTransfer) : [];
}

export function normalizeProtocolTransfer(input = {}, referenceDate = new Date()) {
  const tradeDate = normalizeDate(input.tradeDate) || localDate(referenceDate);
  const materialFirstReceivedDate = normalizeDate(input.materialFirstReceivedDate) || tradeDate;
  const materialConfirmedDate = normalizeDate(input.materialConfirmedDate) || tradeDate;
  const counterpartySealDate = normalizeDate(input.counterpartySealDate) || tradeDate;
  const ownSealDate = normalizeDate(input.ownSealDate) || addBusinessDays(tradeDate, 1);
  const exchangeSubmitDate = normalizeDate(input.exchangeSubmitDate) || addBusinessDays(tradeDate, 2);
  const counterpartySealed = Boolean(input.counterpartySealed);
  const ownSealed = Boolean(input.ownSealed);
  const exchangeSubmitted = Boolean(input.exchangeSubmitted || input.completed);
  const completed = Boolean(input.completed || exchangeSubmitted);

  return {
    id: input.id || crypto.randomUUID(),
    code: String(input.code || "").trim().toUpperCase(),
    shortName: String(input.shortName || "").trim(),
    materialFirstReceivedDate,
    materialConfirmedDate,
    tradeDate,
    type: String(input.type || DEFAULT_TYPE).trim() || DEFAULT_TYPE,
    remarks: String(input.remarks || "").trim(),
    buyer: String(input.buyer || "").trim(),
    seller: String(input.seller || "").trim(),
    price: numberOrNull(input.price),
    quantityHands: numberOrNull(input.quantityHands),
    rawText: String(input.rawText || "").trim(),
    counterpartySealDate,
    ownSealDate,
    exchangeSubmitDate,
    counterpartySealed,
    ownSealed,
    exchangeSubmitted,
    completed,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function upsertProtocolTransfer(state, input) {
  const transfer = normalizeProtocolTransfer({ ...input, updatedAt: new Date().toISOString() });
  const records = [...(state.protocolTransfers || [])];
  const index = records.findIndex((item) => item.id === transfer.id);
  if (index >= 0) records[index] = transfer;
  else records.unshift(transfer);
  return { ...state, protocolTransfers: records, updatedAt: new Date().toISOString() };
}

export function removeProtocolTransfer(state, id) {
  return {
    ...state,
    protocolTransfers: (state.protocolTransfers || []).filter((item) => item.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

export function parseProtocolTransferText(rawText = "", referenceDate = new Date()) {
  const text = String(rawText || "").trim();
  const compact = text.replace(/\s+/g, " ");
  const code = firstMatch(compact, /(\d{6}\.SH)\b/i)?.toUpperCase() || "";
  const tradeDate = parseDateFromText(compact, referenceDate) || localDate(referenceDate);
  const shortName = parseShortName(text, code);
  const sides = parseTradeSides(text);

  return normalizeProtocolTransfer({
    code,
    shortName,
    tradeDate,
    type: inferTransferType(compact, sides),
    buyer: firstMatch(compact, /(?:买入方|买方|受让方)[:：\s]*([^，,；;\n]+)/) || sides.buyer,
    seller: firstMatch(compact, /(?:卖出方|卖方|转让方)[:：\s]*([^，,；;\n]+)/) || sides.seller,
    price: firstNumber(compact, /(?:交易净价|价格|成交价|全价|净价)(?:（元）|\(元\))?(?:\s*\([^)]*\))?[:：\s]*(\d+(?:\.\d+)?)/),
    quantityHands: firstNumber(compact, /(?:交易数量|数量|成交数量|券面|面额)(?:（手）|\(手\))?[:：\s]*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:手|张)?/),
    remarks: firstMatch(compact, /(?:备注)[:：\s]*([^，,；;\n]+)/),
    rawText: text,
  }, referenceDate);
}

export function protocolTransferStatus(record) {
  const transfer = normalizeProtocolTransfer(record);
  if (transfer.completed || transfer.exchangeSubmitted) return "已递交";
  if (transfer.ownSealed) return "待递交上交所";
  if (transfer.counterpartySealed) return "待本方用印";
  return "待对手方用印";
}

export function nextProtocolTransferStep(record) {
  const transfer = normalizeProtocolTransfer(record);
  if (transfer.completed || transfer.exchangeSubmitted) return null;
  if (!transfer.counterpartySealed) {
    return { key: "counterparty", label: "对手方用印", dueDate: transfer.counterpartySealDate };
  }
  if (!transfer.ownSealed) return { key: "own", label: "本方用印", dueDate: transfer.ownSealDate };
  return { key: "submit", label: "递交上交所", dueDate: transfer.exchangeSubmitDate };
}

export function protocolTransferTodos(records = [], referenceDate = new Date()) {
  const today = localDate(referenceDate);
  return normalizeProtocolTransfers(records)
    .map((record) => ({ record, step: nextProtocolTransferStep(record) }))
    .filter((item) => item.step)
    .map((item) => ({
      ...item,
      timing: item.step.dueDate < today ? "overdue" : item.step.dueDate === today ? "today" : "upcoming",
    }))
    .sort((left, right) =>
      left.step.dueDate.localeCompare(right.step.dueDate)
      || left.record.shortName.localeCompare(right.record.shortName, "zh-CN"),
    );
}

export function buildProtocolTransferLedgerRows(records = []) {
  const header = ["序号", "代码", "简称", "材料首次收悉日期", "材料确认日期", "交易日", "类型", "备注", "买入方", "卖出方", "价格（全价请标注）", "数量（手）"];
  const body = normalizeProtocolTransfers(records)
    .sort((left, right) =>
      right.tradeDate.localeCompare(left.tradeDate)
      || right.createdAt.localeCompare(left.createdAt),
    )
    .map((record, index) => [
      index + 1,
      record.code,
      record.shortName,
      record.materialFirstReceivedDate,
      record.materialConfirmedDate,
      record.tradeDate,
      record.type,
      record.remarks,
      record.buyer,
      record.seller,
      record.price ?? "",
      record.quantityHands ?? "",
    ]);
  return [header, ...body];
}

export function markProtocolTransferStep(record, step) {
  const transfer = normalizeProtocolTransfer(record);
  if (step === "counterparty") return normalizeProtocolTransfer({ ...transfer, counterpartySealed: true });
  if (step === "own") return normalizeProtocolTransfer({ ...transfer, counterpartySealed: true, ownSealed: true });
  if (step === "submit") {
    return normalizeProtocolTransfer({
      ...transfer,
      counterpartySealed: true,
      ownSealed: true,
      exchangeSubmitted: true,
      completed: true,
    });
  }
  return transfer;
}

function parseShortName(text, code) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (code && line.toUpperCase().includes(code)) {
      const beforeCode = line.slice(0, line.toUpperCase().indexOf(code)).replace(/[【】\[\]（）()]/g, " ").trim();
      const tokens = beforeCode.split(/\s+/).filter(Boolean);
      const candidate = tokens.at(-1) || "";
      if (candidate && !/代码/.test(candidate)) return candidate;
    }
    const labelled = line.match(/(?:简称|债券简称)[:：\s]*([A-Za-z0-9\u4e00-\u9fa5]+(?:\d{2})?)/);
    if (labelled) return labelled[1];
  }
  const compact = String(text || "").replace(/\s+/g, " ");
  const labelMatch = compact.match(/债券简称\s+([A-Za-z0-9\u4e00-\u9fa5]+(?:\d{2})?)/);
  if (labelMatch) return labelMatch[1];
  return firstMatch(String(text || ""), /([0-9]{2}[\u4e00-\u9fa5A-Za-z]{1,12}[0-9A-Za-z]{1,4})/) || "";
}

function parseTradeSides(text) {
  const result = { buyer: "", seller: "" };
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/交易机构\s*[12]/.test(line) || !/交易方向/.test(line)) continue;
    const direction = firstMatch(line, /交易方向\s*(买入|卖出)/);
    if (!direction) continue;
    const traderName = firstMatch(line, /交易商名称\s*([^\s]+)/);
    const institution = firstMatch(line, /交易机构\s*[12]\s+(.+?)\s+交易方向/);
    const name = traderName || simplifyInstitutionName(institution);
    if (!name) continue;
    if (direction === "买入") result.buyer = name;
    if (direction === "卖出") result.seller = name;
  }
  return result;
}

function simplifyInstitutionName(name = "") {
  return String(name)
    .replace(/股份有限公司|有限责任公司|有限公司|证券股份|证券有限/g, "")
    .trim();
}

function inferTransferType(text, sides) {
  const explicit = firstMatch(text, /(商业银行|证券公司|券商|基金|保险|理财|其他)/);
  if (explicit) return explicit === "券商" ? "证券公司" : explicit;
  const joined = `${sides.buyer || ""} ${sides.seller || ""}`;
  if (/银行/.test(joined)) return "商业银行";
  if (/证券|券商/.test(joined)) return "证券公司";
  return DEFAULT_TYPE;
}

function parseDateFromText(text, referenceDate) {
  const applicationDate = String(text || "").match(/申请日期[:：\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/);
  if (applicationDate) return normalizeDate(applicationDate[1]);
  const labelled = String(text || "").match(/(?:交易日|成交日|T日)[:：\s]*/);
  if (labelled) {
    const tail = text.slice(labelled.index + labelled[0].length);
    return normalizeDate(firstDateText(tail))
      || parseMonthDay(tail, referenceDate)
      || (/今天|今日/.test(tail) ? localDate(referenceDate) : null);
  }
  return normalizeDate(firstDateText(text))
    || parseMonthDay(text, referenceDate)
    || (/今天|今日/.test(text) ? localDate(referenceDate) : null);
}

function parseMonthDay(text, referenceDate) {
  const match = String(text || "").match(MONTH_DAY_PATTERN);
  if (!match) return null;
  const year = referenceDate.getFullYear();
  return localDate(new Date(year, Number(match[1]) - 1, Number(match[2])));
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDate(value);
  const text = String(value).trim();
  const match = text.match(DATE_PATTERN);
  if (match) return localDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return "";
}

function addBusinessDays(value, days) {
  const date = dateFromLocal(value);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (![0, 6].includes(date.getDay())) remaining -= 1;
  }
  return localDate(date);
}

function dateFromLocal(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match?.[1]?.trim() || "";
}

function firstDateText(text) {
  return String(text || "").match(DATE_PATTERN)?.[0] || "";
}

function firstNumber(text, pattern) {
  const value = firstMatch(text, pattern).replace(/,/g, "");
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
