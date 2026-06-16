const DEFAULT_TYPE = "商业银行";
const DATE_PATTERN = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;
const CHINESE_MONTH_DAY_PATTERN = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
const NUMERIC_MONTH_DAY_PATTERN = /(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?!\d)/g;
const BOND_SHORT_NAME_PATTERN = /^[0-9]{2}[\u4e00-\u9fa5A-Za-z]{1,12}[0-9A-Za-z]{1,4}$/;

export function normalizeProtocolTransfers(input = []) {
  return Array.isArray(input) ? input.map(normalizeProtocolTransfer) : [];
}

export function normalizeProtocolTransfer(input = {}, referenceDate = new Date()) {
  const tradeDate = normalizeDate(input.tradeDate) || localDate(referenceDate);
  const materialFirstReceivedDate = normalizeDate(input.materialFirstReceivedDate) || tradeDate;
  const materialConfirmedDate = normalizeDate(input.materialConfirmedDate) || tradeDate;
  const counterpartySealDate = normalizeDate(input.counterpartySealDate) || addBusinessDays(tradeDate, -2);
  const ownSealDate = normalizeDate(input.ownSealDate) || addBusinessDays(tradeDate, -1);
  const exchangeSubmitDate = tradeDate;
  const counterpartySealed = Boolean(input.counterpartySealed);
  const ownSealed = Boolean(input.ownSealed);
  const exchangeSubmitted = Boolean(input.exchangeSubmitted || input.completed);
  const completed = Boolean(input.completed || exchangeSubmitted);
  const inputAmountTenThousand = numberOrNull(input.amountTenThousand);
  const inputQuantityHands = numberOrNull(input.quantityHands);
  const amountTenThousand = inputAmountTenThousand ?? (inputQuantityHands !== null ? inputQuantityHands / 10 : null);
  const quantityHands = inputQuantityHands ?? (inputAmountTenThousand !== null ? Math.round(inputAmountTenThousand * 10) : null);

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
    finalBuyer: String(input.finalBuyer || "").trim(),
    price: normalizePrice(input.price),
    amountTenThousand,
    quantityHands,
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
  const text = normalizeText(rawText);
  const chatStyle = parseChatStyleTradeElements(text, referenceDate);
  if (chatStyle) return normalizeProtocolTransfer({ ...chatStyle, rawText: text }, referenceDate);

  const compact = text.replace(/\s+/g, " ");
  const code = firstMatch(compact, /(\d{6}\.SH)\b/i).toUpperCase();
  const shortName = parseShortName(text, code);
  const sides = parseTradeSides(text);
  const tradeDate = parseDateFromText(compact, referenceDate) || localDate(referenceDate);

  return normalizeProtocolTransfer({
    code,
    shortName,
    tradeDate,
    type: inferTransferType(compact, sides),
    buyer: firstMatch(compact, /(?:买入方|买方|受让方)[:：\s]*([^，,；;\n]+)/) || sides.buyer,
    seller: firstMatch(compact, /(?:卖出方|卖方|转让方)[:：\s]*([^，,；;\n]+)/) || sides.seller,
    finalBuyer: "",
    price: parsePrice(compact),
    quantityHands: parseQuantityHands(compact),
    remarks: parseRemarks(text),
    rawText: text,
  }, referenceDate);
}

function parseChatStyleTradeElements(text, referenceDate) {
  const line = String(text || "").split(/\n/).map((item) => item.trim()).find((item) =>
    /\b\d{6}(?:\.(?:SH|SZ|IB))?\b/i.test(item) && /(出给|to|发)/i.test(item),
  );
  if (!line) return null;

  const codeMatch = line.match(/\b(\d{6})(?:\.(SH|SZ|IB))?\b/i);
  if (!codeMatch) return null;
  const code = `${codeMatch[1]}.${(codeMatch[2] || "SH").toUpperCase()}`;
  const afterCode = line.slice(codeMatch.index + codeMatch[0].length);
  const shortName = extractShortNameAfterCode(afterCode);
  const sides = parseOperatorSides(line);
  const bridgeBuyer = parseBridgeBuyer(text, sides);
  const actualSides = { ...sides, buyer: bridgeBuyer || sides.buyer };
  const finalBuyer = actualSides.buyer && sides.buyer && actualSides.buyer !== sides.buyer ? sides.buyer : "";
  const price = parsePrice(line);
  const amountTenThousand = parseChatAmountTenThousand(line);
  const quantityHands = amountTenThousand !== null ? Math.round(amountTenThousand * 10) : parseQuantityHands(line);
  const tradeDate = parseDateFromText(line, referenceDate) || localDate(referenceDate);

  return {
    code,
    shortName,
    tradeDate,
    type: inferTransferType(line, actualSides),
    buyer: actualSides.buyer,
    seller: actualSides.seller,
    finalBuyer,
    price,
    amountTenThousand,
    quantityHands,
    remarks: parseRemarks(text),
  };
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
  const numberedRecords = normalizeProtocolTransfers(records)
    .sort((left, right) =>
      right.tradeDate.localeCompare(left.tradeDate)
      || right.createdAt.localeCompare(left.createdAt),
    )
    .map((record, index) => ({ record, serial: index + 1 }));
  const duplicateRemarks = buildDuplicateProtocolTransferRemarks(numberedRecords);
  const body = numberedRecords.map(({ record, serial }) => [
    serial,
    record.code,
    record.shortName,
    record.tradeDate,
    record.tradeDate,
    record.tradeDate,
    record.type,
    duplicateRemarks.get(serial) || "",
    record.buyer,
    record.seller,
    record.price ?? "",
    record.quantityHands ?? "",
  ]);
  return [header, ...body];
}

export function excelDateSerialFromLocalDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const utcDate = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const excelEpoch = Date.UTC(1899, 11, 30);
  return Math.round((utcDate - excelEpoch) / 86400000);
}

function buildDuplicateProtocolTransferRemarks(numberedRecords) {
  const groups = new Map();
  numberedRecords.forEach(({ record, serial }) => {
    const key = JSON.stringify([
      record.tradeDate,
      record.code,
      record.shortName,
      record.type,
      record.buyer,
      record.seller,
      record.finalBuyer,
      record.price ?? "",
      record.quantityHands ?? "",
    ]);
    const group = groups.get(key) || [];
    group.push(serial);
    groups.set(key, group);
  });

  const remarks = new Map();
  groups.forEach((serials) => {
    if (serials.length < 2) return;
    const countText = serials.length === 2 ? "两笔" : `${serials.length}笔`;
    const remark = `序号${serials.join("、")}是${countText}不同的交易`;
    serials.forEach((serial) => remarks.set(serial, remark));
  });
  return remarks;
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

function normalizeText(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function parseShortName(text, code) {
  const compact = String(text || "").replace(/\s+/g, " ");
  const labelled = compact.match(/(?:债券简称|简称)[:：\s]*([A-Za-z0-9\u4e00-\u9fa5]+(?:\d{2})?)/);
  if (labelled && BOND_SHORT_NAME_PATTERN.test(labelled[1])) return labelled[1];

  const lines = String(text || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!code || !line.toUpperCase().includes(code)) continue;
    const afterCode = line.slice(line.toUpperCase().indexOf(code) + code.length);
    const afterCandidate = afterCode.split(/\s+/).find((token) => BOND_SHORT_NAME_PATTERN.test(cleanToken(token)));
    if (afterCandidate) return cleanToken(afterCandidate);

    const beforeCode = line.slice(0, line.toUpperCase().indexOf(code)).replace(/[【】\[\]（）()]/g, " ").trim();
    const beforeCandidate = beforeCode.split(/\s+/).reverse().find((token) => BOND_SHORT_NAME_PATTERN.test(cleanToken(token)));
    if (beforeCandidate) return cleanToken(beforeCandidate);
  }

  return firstMatch(String(text || ""), /([0-9]{2}[\u4e00-\u9fa5A-Za-z]{1,12}[0-9A-Za-z]{1,4})/);
}

function extractShortNameAfterCode(text) {
  const tokens = normalizeText(text).split(/\s+/).map(cleanToken).filter(Boolean);
  return tokens.find((token) =>
    BOND_SHORT_NAME_PATTERN.test(token)
    && !/^(?:休|远|近)\d*$/i.test(token)
    && !/(?:私募债|公募债|公司债|企业债|交易所)$/.test(token),
  ) || "";
}

function parseOperatorSides(text) {
  const result = { buyer: "", seller: "" };
  const match = /(出给|to)/i.exec(text);
  if (!match) return result;
  const left = text.slice(0, match.index).trim();
  const right = text.slice(match.index + match[0].length).trim();
  result.seller = lastPartyBeforeOperator(left);
  result.buyer = firstPartyAfterOperator(right);
  return result;
}

function parseBridgeBuyer(text, sides) {
  const sentByParty = parseSentByParty(text);
  if (sentByParty && sentByParty !== sides.seller) return sentByParty;

  const excluded = new Set([sides.seller, sides.buyer].filter(Boolean));
  const contacts = parseContactParties(text);
  return contacts.find((party) => !excluded.has(party))
    || contacts.find((party) => party !== sides.seller)
    || "";
}

function parseSentByParty(text) {
  const match = String(text || "").match(/(?:^|[\s，,；;])([\u4e00-\u9fa5A-Za-z]{2,24})\s*发\s*\d{2,3}(?:\.\d+)?(?:\s*\/\s*\d{2,3}(?:\.\d+)?)?/m);
  return match ? cleanPartyName(match[1]) : "";
}

function parseContactParties(text) {
  return String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /\d{8,}/.test(line))
    .map((line) => cleanPartyName(line.split(/\s+/)[0]))
    .filter(Boolean);
}

function firstPartyAfterOperator(text) {
  const value = normalizeText(text);
  if (!value) return "";
  const stop = value.split(/[，,；;]/)[0];
  return cleanPartyName(stop.split(/\s+/)[0]);
}

function lastPartyBeforeOperator(text) {
  const value = normalizeText(text);
  if (!value) return "";
  const tokens = value.split(/\s+/).map(cleanPartyName).filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (isIgnoredTradeToken(token)) continue;
    return token;
  }
  return "";
}

function cleanPartyName(name = "") {
  return cleanToken(name)
    .replace(/^(出给|to)$/i, "")
    .trim();
}

function isIgnoredTradeToken(token) {
  return !token
    || token === "交易所"
    || /^(?:买入|卖出)$/.test(token)
    || /^(?:私募债|公募债|公司债|企业债)$/.test(token)
    || BOND_SHORT_NAME_PATTERN.test(token)
    || /\d{6}\.(?:SH|SZ|IB)/i.test(token)
    || /^\d+(?:\.\d+)?Y/i.test(token)
    || /^\d+(?:\.\d+)?$/.test(token)
    || /^\d+(?:\.\d+)?(?:k|kw|w|e|万|千万|亿)$/i.test(token)
    || /^\d{1,2}[./]\d{1,2}/.test(token);
}

function parseTradeSides(text) {
  const result = { buyer: "", seller: "" };
  const lines = String(text || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
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

  const compact = String(text || "").replace(/\s+/g, " ");
  const directional = compact.match(/(?:^|[，,；;\s])([\u4e00-\u9fa5A-Za-z]{2,20})\s*出给\s*([\u4e00-\u9fa5A-Za-z]{2,20})(?=[，,；;\s]|$)/);
  if (directional) {
    result.seller ||= directional[1].trim();
    result.buyer ||= directional[2].trim();
  }
  return result;
}

function simplifyInstitutionName(name = "") {
  return String(name)
    .replace(/股份有限公司|有限责任公司|有限公司|证券股份|证券有限/g, "")
    .trim();
}

function inferTransferType(text, sides) {
  const joined = `${sides.buyer || ""} ${sides.seller || ""} ${text || ""}`;
  if (/银行/.test(joined)) return "商业银行";
  if (/证券|券商/.test(joined)) return "证券公司";
  const explicit = firstMatch(text, /(商业银行|证券公司|券商|基金|保险|理财|其他)/);
  if (explicit) return explicit === "券商" ? "证券公司" : explicit;
  return DEFAULT_TYPE;
}

function parsePrice(text) {
  const labelled = firstMatch(text, /(?:交易净价|价格|成交价|全价|净价)(?:（元）|\(元\))?(?:\s*\([^)]*\))?[:：\s]*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/);
  if (labelled) return labelled.replace(/\s+/g, "");

  const sentBy = firstMatch(text, /(?:^|[，,；;\s])[\u4e00-\u9fa5A-Za-z]{2,20}\s*发\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/);
  if (sentBy) return sentBy.replace(/\s+/g, "");

  const slashPrice = firstMatch(text, /(\d{2,3}\.\d{3}\s*\/\s*\d{2,3}\.\d{3})/);
  if (slashPrice) return slashPrice.replace(/\s+/g, "");

  return firstMatch(text, /\b((?:9\d|10\d)\.\d{3})\b/);
}

function parseQuantityHands(text) {
  const labelled = firstMatch(text, /(?:交易数量|数量|成交数量|券面|面额)(?:（手）|\(手\))?[:：\s]*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:手|张)?/);
  if (labelled) return numberOrNull(labelled);

  const chatAmount = parseChatAmountTenThousand(text);
  if (chatAmount !== null) return Math.round(chatAmount * 10);
  return null;
}

function parseChatAmountTenThousand(text) {
  const tokens = normalizeText(text).split(/\s+/).map(cleanToken).filter(Boolean);
  for (const token of tokens) {
    const amountTenThousand = parseAmountTenThousand(token);
    if (amountTenThousand !== null) return amountTenThousand;
  }
  return null;
}

function parseAmountTenThousand(token) {
  const value = normalizeText(token).toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(千万|kw|k|w|e|万|亿)?$/.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  const unit = match[2] || "";
  if (unit === "e" || unit === "亿") return Math.round(number * 10000);
  if (unit === "kw" || unit === "k" || unit === "千万") return Math.round(number * 1000);
  if (unit === "w" || unit === "万") return Math.round(number);
  if (number >= 50 && Number.isInteger(number)) return number;
  return null;
}

function parseRemarks(text) {
  const compact = String(text || "").replace(/\s+/g, " ");
  const explicit = firstMatch(compact, /(?:备注)[:：\s]*([^，,；;\n]+)/);
  const parts = [];
  if (explicit) parts.push(explicit);

  const city = firstMatch(text, /【([^】]+)】/);
  const duration = firstMatch(compact, /(\d+(?:\.\d+)?Y(?:\([^)]*\)|（[^）]*）)?)/i);
  const bondType = firstMatch(compact, /(私募债|公募债|公司债|企业债|ABS|ABN)/i);
  const sentBy = compact.match(/(?:^|[，,；;\s])([\u4e00-\u9fa5A-Za-z]{2,20})\s*发\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/);
  const contacts = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /\d{8,}/.test(line));

  if (city) parts.push(city);
  if (duration) parts.push(duration);
  if (bondType) parts.push(bondType);
  if (sentBy) {
    const bridgeQuote = sentBy[2].replace(/\s+/g, "");
    parts.push(`${sentBy[1]}发 ${bridgeQuote}`);
  }
  if (contacts.length) parts.push(`联系人：${contacts.join("；")}`);
  return [...new Set(parts)].join("；");
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
  const chinese = String(text || "").match(CHINESE_MONTH_DAY_PATTERN);
  if (chinese) return localDateFromParts(referenceDate.getFullYear(), Number(chinese[1]), Number(chinese[2]), referenceDate);

  const source = String(text || "");
  for (const match of source.matchAll(NUMERIC_MONTH_DAY_PATTERN)) {
    const date = localDateFromParts(referenceDate.getFullYear(), Number(match[1]), Number(match[2]), referenceDate);
    if (date) return date;
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDate(value);
  const text = String(value).trim();
  const match = text.match(DATE_PATTERN);
  if (match) return localDateFromParts(Number(match[1]), Number(match[2]), Number(match[3])) || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return "";
}

function addBusinessDays(value, days) {
  const date = dateFromLocal(value);
  const direction = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    if (![0, 6].includes(date.getDay())) remaining -= 1;
  }
  return localDate(date);
}

function localDateFromParts(year, month, day, referenceDate = null) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (referenceDate && date < addCalendarDays(referenceDate, -60)) {
    const nextYear = new Date(year + 1, month - 1, day);
    return localDate(nextYear);
  }
  return localDate(date);
}

function addCalendarDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
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

function cleanToken(value = "") {
  return String(value).replace(/[【】\[\]（）(),，；;]/g, "").trim();
}

function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match?.[1]?.trim() || "";
}

function firstDateText(text) {
  return String(text || "").match(DATE_PATTERN)?.[0] || "";
}

function normalizePrice(value) {
  if (value === "" || value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, "");
  if (!text) return null;
  if (text.includes("/")) {
    const prices = text.split("/").map((item) => Number(item)).filter(Number.isFinite);
    return prices.length ? Math.min(...prices) : text;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
