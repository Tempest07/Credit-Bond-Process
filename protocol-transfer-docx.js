import {
  matchesProtocolTransferParty,
  normalizeProtocolTransferParty,
} from "./protocol-transfer-templates.js";

const OWN_BANK_ALIASES = Object.freeze(["兴业银行股份有限公司", "兴业银行", "兴业"]);
const ROW_PATTERN = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
const CELL_PATTERN = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
const PARAGRAPH_PATTERN = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const TEXT_PATTERN = /<w:t\b([^>]*)>[\s\S]*?<\/w:t>/g;

export function resolveProtocolTransferMarketMakerDirection(record = {}) {
  if (["buy", "sell"].includes(record.marketMakerDirection)) return record.marketMakerDirection;
  if (isOwnBank(record.seller)) return "buy";
  if (isOwnBank(record.buyer)) return "sell";
  if (matchesProtocolTransferParty(record.marketMaker, record.buyer)) return "buy";
  if (matchesProtocolTransferParty(record.marketMaker, record.seller)) return "sell";
  return "";
}

export function buildProtocolTransferApplicationValues(record = {}, template = {}) {
  const marketMakerDirection = resolveProtocolTransferMarketMakerDirection(record);
  const applicationDate = normalizeDate(record.tradeDate);
  const price = formatNetPrice(record.price);
  const quantityHands = normalizeQuantityHands(record.quantityHands, record.amountTenThousand);
  return {
    applicationDate,
    applicationDateText: formatChineseDate(applicationDate),
    code: String(record.code || "").trim().toUpperCase(),
    shortName: String(record.shortName || "").trim(),
    price,
    quantityHands,
    marketMaker: String(record.marketMaker || template?.marketMakerName || "").trim(),
    marketMakerDirection,
    ownBankDirection: marketMakerDirection === "buy" ? "sell" : marketMakerDirection === "sell" ? "buy" : "",
    makerInstitutionNumber: Number(template?.makerInstitutionNumber || 1) === 2 ? 2 : 1,
  };
}

export function validateProtocolTransferApplication(record = {}, template = {}) {
  const values = buildProtocolTransferApplicationValues(record, template);
  const errors = [];
  if (!template?.id) errors.push("未匹配到做市商 Word 模板");
  if (!values.marketMaker) errors.push("未识别做市商");
  if (template?.id && values.marketMaker && ![
    template.marketMakerName,
    template.label,
    ...(template.aliases || []),
  ].some((alias) => matchesProtocolTransferParty(values.marketMaker, alias))) {
    errors.push(`做市商“${values.marketMaker}”与所选 ${template.label} 模板不一致`);
  }
  if (!values.marketMakerDirection) errors.push("无法判断做市商方向，请确认我行是买入还是卖出");
  if (!/^\d{6}\.SH$/i.test(values.code)) errors.push("上交所协议转让申请单需要 6 位 .SH 债券代码");
  if (!values.shortName) errors.push("未识别债券简称");
  if (!values.applicationDate) errors.push("未识别交易日");
  if (!values.price) errors.push("未识别交易净价");
  if (!values.quantityHands) errors.push("未识别交易数量（手）");
  if (values.marketMakerDirection === "buy" && !isOwnBank(record.seller)) {
    errors.push("做市商买入时，卖方应为兴业银行");
  }
  if (values.marketMakerDirection === "sell" && !isOwnBank(record.buyer)) {
    errors.push("做市商卖出时，买方应为兴业银行");
  }
  return { ok: errors.length === 0, errors, values };
}

export function patchProtocolTransferDocumentXml(xml = "", record = {}, template = {}) {
  const validation = validateProtocolTransferApplication(record, template);
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const values = validation.values;
  let output = replaceApplicationDate(String(xml), values.applicationDateText);
  const makerNumber = values.makerInstitutionNumber;
  const ownNumber = makerNumber === 1 ? 2 : 1;
  output = replaceSemanticRowValue(output, `交易机构${makerNumber}`, "交易方向", directionLabel(values.marketMakerDirection));
  output = replaceSemanticRowValue(output, `交易机构${ownNumber}`, "交易方向", directionLabel(values.ownBankDirection));
  output = replaceSemanticRowValue(output, "债券代码", "债券代码", values.code);
  output = replaceSemanticRowValue(output, "债券简称", "债券简称", values.shortName);
  output = replaceSemanticRowValue(output, "交易净价", "交易净价", values.price);
  output = replaceSemanticRowValue(output, "交易数量", "交易数量", values.quantityHands);
  return output;
}

export function extractProtocolTransferTemplateMetadata(xml = "", input = {}) {
  const rows = [...String(xml).matchAll(ROW_PATTERN)].map((match) => match[0]);
  const institutions = { 1: {}, 2: {} };
  let currentInstitution = 0;
  const sample = {};

  for (const row of rows) {
    const cells = row.match(CELL_PATTERN) || [];
    const texts = cells.map(cellText);
    const institutionMatch = texts[0]?.replace(/\s+/g, "").match(/^交易机构([12])$/);
    if (institutionMatch) {
      currentInstitution = Number(institutionMatch[1]);
      institutions[currentInstitution].institutionName = texts[1] || "";
      institutions[currentInstitution].direction = normalizeDirection(texts[3]);
      institutions[currentInstitution].traderName = texts[5] || "";
    }
    if (currentInstitution) {
      assignFollowingCell(texts, "交易商名称", institutions[currentInstitution], "traderName");
      assignFollowingCell(texts, "交易商代码", institutions[currentInstitution], "traderCode");
      assignFollowingCell(texts, "股东账号", institutions[currentInstitution], "shareholderAccount");
      assignFollowingCell(texts, "席位号", institutions[currentInstitution], "seatNumber");
      assignFollowingCell(texts, "联系电话", institutions[currentInstitution], "phone");
    }
    assignFollowingCell(texts, "债券代码", sample, "code");
    assignFollowingCell(texts, "债券简称", sample, "shortName");
    assignFollowingCell(texts, "交易净价（元）(特定转让债券为全价)", sample, "price");
    assignFollowingCell(texts, "交易数量（手）", sample, "quantityHands");
  }

  const makerNumbers = [1, 2].filter((number) =>
    institutions[number].institutionName && !isOwnBank(institutions[number].institutionName),
  );
  if (makerNumbers.length !== 1) {
    throw new Error("模板必须包含一侧兴业银行和一侧做市商的固定信息");
  }
  const makerInstitutionNumber = makerNumbers[0];
  const maker = institutions[makerInstitutionNumber];
  const required = ["institutionName", "traderName", "traderCode", "shareholderAccount", "seatNumber", "phone"];
  const missing = required.filter((key) => !maker[key]);
  if (missing.length) throw new Error(`做市商模板缺少固定字段：${missing.join("、")}`);
  if (!sample.code || !sample.shortName || !sample.price || !sample.quantityHands) {
    throw new Error("模板缺少债券代码、简称、净价或交易数量行");
  }

  const dateText = paragraphsText(xml).find((text) => text.includes("申请日期")) || "";
  const applicationDate = normalizeChineseDate(dateText);
  const marketMakerName = maker.institutionName;
  const aliases = [...new Set([
    marketMakerName,
    maker.traderName,
    marketMakerName.replace(/股份有限公司|有限责任公司|有限公司/g, ""),
  ].filter(Boolean))];
  return {
    id: String(input.id || "").trim(),
    label: String(input.label || maker.traderName || marketMakerName).trim(),
    marketMakerName,
    aliases,
    makerInstitutionNumber,
    fixedFields: { ...maker },
    sourceSample: { applicationDate, ...sample },
    sourceFileName: String(input.sourceFileName || "").trim(),
    sourceUpdatedAt: String(input.sourceUpdatedAt || new Date().toISOString()),
    custom: Boolean(input.custom),
  };
}

export function protocolTransferApplicationFilename(record = {}, template = {}) {
  const date = normalizeDate(record.tradeDate).slice(5).replaceAll("-", "") || "待定日期";
  const bond = sanitizeFilename(record.shortName || record.code || "待定债券");
  const maker = protocolTransferMakerFilenameAlias(record, template);
  const amount = protocolTransferFilenameAmount(record);
  return `上交所协议转让N${date} 兴业${maker} ${bond} ${amount}.docx`;
}

function protocolTransferMakerFilenameAlias(record = {}, template = {}) {
  const archivedAlias = String(template.sourceFileName || "").match(/\s兴业([^\s.]+)\s/)?.[1];
  const value = archivedAlias || template.label || record.marketMaker || "做市商";
  return sanitizeFilename(String(value)
    .replace(/证券股份有限公司|证券有限责任公司|证券有限公司|股份有限公司|有限责任公司|有限公司/g, "")
    .replace(/证券$/g, "")
    .trim());
}

function protocolTransferFilenameAmount(record = {}) {
  const amount = Number(record.amountTenThousand);
  if (Number.isFinite(amount) && amount > 0) return sanitizeFilename(String(amount));
  const hands = Number(record.quantityHands);
  if (Number.isFinite(hands) && hands > 0) return sanitizeFilename(String(hands / 10));
  return "待定金额";
}

function replaceApplicationDate(xml, dateText) {
  let replaced = false;
  return xml.replace(PARAGRAPH_PATTERN, (paragraph) => {
    if (replaced || !cellText(paragraph).includes("申请日期")) return paragraph;
    let afterLabel = false;
    let wroteDate = false;
    const next = paragraph.replace(TEXT_PATTERN, (node, attributes) => {
      const text = decodeXml(node.replace(/^<w:t\b[^>]*>|<\/w:t>$/g, ""));
      if (!afterLabel) {
        if (text.includes("申请日期")) afterLabel = true;
        return node;
      }
      if (!wroteDate) {
        wroteDate = true;
        return textNode(attributes, `     ${dateText}`);
      }
      return textNode(attributes, "");
    });
    if (!wroteDate) throw new Error("模板申请日期段落不可写入");
    replaced = true;
    return next;
  });
}

function replaceSemanticRowValue(xml, rowLabel, fieldLabel, value) {
  let replaced = false;
  const output = xml.replace(ROW_PATTERN, (row) => {
    if (replaced) return row;
    const cells = row.match(CELL_PATTERN) || [];
    const texts = cells.map(cellText);
    if (!texts.some((text) => normalizedLabel(text).includes(normalizedLabel(rowLabel)))) return row;
    const fieldIndex = texts.findIndex((text) => normalizedLabel(text).includes(normalizedLabel(fieldLabel)));
    if (fieldIndex < 0 || !cells[fieldIndex + 1]) return row;
    const nextCell = replaceCellText(cells[fieldIndex + 1], value);
    replaced = true;
    return replaceNthCell(row, fieldIndex + 1, nextCell);
  });
  if (!replaced) throw new Error(`模板缺少“${fieldLabel}”字段`);
  return output;
}

function replaceCellText(cell, value) {
  let wrote = false;
  const output = cell.replace(TEXT_PATTERN, (node, attributes) => {
    if (!wrote) {
      wrote = true;
      return textNode(attributes, value);
    }
    return textNode(attributes, "");
  });
  if (!wrote) throw new Error("模板字段单元格不可写入");
  return output;
}

function replaceNthCell(row, targetIndex, replacement) {
  let index = -1;
  return row.replace(CELL_PATTERN, (cell) => {
    index += 1;
    return index === targetIndex ? replacement : cell;
  });
}

function textNode(attributes, value) {
  let nextAttributes = attributes || "";
  if (/^\s|\s$/.test(value) && !/xml:space=/.test(nextAttributes)) nextAttributes += ' xml:space="preserve"';
  return `<w:t${nextAttributes}>${escapeXml(value)}</w:t>`;
}

function cellText(fragment = "") {
  return [...String(fragment).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("")
    .trim();
}

function paragraphsText(xml = "") {
  return [...String(xml).matchAll(PARAGRAPH_PATTERN)].map((match) => cellText(match[0]));
}

function assignFollowingCell(texts, label, target, key) {
  const index = texts.findIndex((text) => normalizedLabel(text) === normalizedLabel(label));
  if (index >= 0 && texts[index + 1]) target[key] = texts[index + 1];
}

function normalizedLabel(value = "") {
  return String(value).replace(/[\s（）()]/g, "");
}

function directionLabel(value) {
  return value === "buy" ? "买入" : value === "sell" ? "卖出" : "";
}

function normalizeDirection(value) {
  if (String(value).includes("买")) return "buy";
  if (String(value).includes("卖")) return "sell";
  return "";
}

function isOwnBank(value = "") {
  return OWN_BANK_ALIASES.some((alias) => matchesProtocolTransferParty(value, alias));
}

function normalizeQuantityHands(quantityHands, amountTenThousand) {
  const hands = Number(quantityHands);
  if (Number.isFinite(hands) && hands > 0) return String(Math.round(hands));
  const amount = Number(amountTenThousand);
  return Number.isFinite(amount) && amount > 0 ? String(Math.round(amount * 10)) : "";
}

function formatNetPrice(value) {
  if (value === "" || value === null || value === undefined) return "";
  const values = String(value).split("/").map((item) => Number(item.trim())).filter(Number.isFinite);
  if (!values.length) return "";
  return Math.min(...values).toFixed(3);
}

function formatChineseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}年 ${Number(match[2])}月${Number(match[3])}日` : "";
}

function normalizeChineseDate(value = "") {
  const match = String(value).match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : "";
}

function normalizeDate(value = "") {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return "";
  return match[0];
}

function sanitizeFilename(value = "") {
  return String(value).replace(/[\\/:*?"<>|\r\n]+/g, "-").trim() || "未命名";
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value = "") {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function protocolTransferTemplateKey(template = {}) {
  return normalizeProtocolTransferParty(template.marketMakerName || template.label || template.id || "");
}
