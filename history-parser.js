import { durationToDays } from "./core.js?v=20260611-cloud-actions";

const HEADER_STATUS_PATTERNS = [
  ["我行牵头、独立主承", "牵头"],
  ["我行牵头主承", "牵头"],
  ["我行主承", "牵头"],
  ["牵头主承", "牵头"],
  ["我行联席主承", "联席"],
  ["联席主承", "联席"],
  ["非我行主承", "非我行主承"],
];

export function parseHistoryText(rawText) {
  const paragraphs = splitParagraphs(rawText);
  const records = [];
  const absRecords = [];
  const skipped = [];
  let currentHeader = null;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const text = paragraphs[index];
    const header = parseHistoryHeader(text);
    if (header) {
      currentHeader = { ...header, sourceRank: index, rawText: text };
      continue;
    }

    if (isAbsOpinion(text)) {
      absRecords.push({
        sourceRank: index,
        header: currentHeader,
        opinion: text,
        isFinal: text.includes("以上妥否，请领导审核"),
      });
      continue;
    }

    if (!isStandardOpinion(text)) continue;
    const parsed = parseStandardOpinion(text, currentHeader, index);
    if (parsed.issuerLegalName && parsed.credit.rawText) records.push(parsed);
    else skipped.push(parsed);
  }

  const grouped = groupNewestIssuerRecords(records);
  return {
    paragraphCount: paragraphs.length,
    standardRecordCount: records.length,
    absRecordCount: absRecords.length,
    skippedCount: skipped.length,
    issuers: grouped.issuers,
    reviewRecords: [...grouped.reviewRecords, ...skipped],
    absRecords,
  };
}

export function splitParagraphs(rawText) {
  return String(rawText || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseHistoryHeader(text) {
  if (text.length > 220 || !text.includes("分行")) return null;
  const matchedStatus = HEADER_STATUS_PATTERNS.find(([pattern]) => text.includes(pattern));
  if (!matchedStatus) return null;

  const [pattern, sponsorStatus] = matchedStatus;
  const shortName = text.split(/\s+/)[0] || "";
  const rest = text.slice(text.indexOf(pattern) + pattern.length).trim();
  const branch = rest.match(/(\S*分行)/)?.[1] || "";
  return {
    shortName,
    alias: deriveIssuerAlias(shortName),
    sponsorStatus,
    branch,
    isRealEstate: /房地产项目|房地产债/.test(text),
  };
}

export function isStandardOpinion(text) {
  return /分行申请与资金(?:营运|运营)中心(?:一二级)?联动投资/.test(text) && text.includes("授信方面");
}

export function isAbsOpinion(text) {
  return /【[^】]*簿记】.*分行拟与资金营运中心联动投资/.test(text);
}

export function parseStandardOpinion(text, header = null, sourceRank = 0) {
  const fullName = text.match(/联动投资[“"]?(.+?)[”"]?。预计/)?.[1] || "";
  const issuerLegalName = extractIssuerLegalName(fullName);
  const creditRaw = text.match(/授信方面[，,](.+?)。(?:[^。]*分行拟申请|建议|本笔业务|本流程|以上妥否)/)?.[1]?.trim() || "";
  const credit = parseCreditText(creditRaw, sourceRank);
  const warnings = [];

  if (!header) warnings.push("未找到对应的项目简表首行。");
  if (!issuerLegalName) warnings.push("未识别发行主体正式名称。");
  if (!creditRaw) warnings.push("未识别授信信息。");
  if (/[XxＸ？?]{2,}/.test(creditRaw)) warnings.push("授信信息包含占位符。");
  if (!Number.isFinite(credit.approvedRatio) && !Number.isFinite(credit.privateRatio)) {
    warnings.push("未识别有效投资比例。");
  }

  return {
    sourceRank,
    shortName: header?.shortName || "",
    alias: header?.alias || "",
    branch: header?.branch || "",
    isRealEstate: Boolean(header?.isRealEstate) || /房地产债业务/.test(text),
    fullName,
    issuerLegalName,
    credit,
    opinion: text,
    warnings,
    confidence: warnings.length ? "review" : "high",
  };
}

export function parseCreditText(rawText, sourceRank = null) {
  const text = String(rawText || "").trim();
  const approvalLevel = text.match(/^(总行|分行)/)?.[1] || "";
  const amount = text.match(/(?:储架)?批\s*([\d.]+)\s*亿/);
  const privateAmount = text.match(/私募\s*([\d.]+)\s*亿/);
  const percentages = [...text.matchAll(/([\d.]+)\s*%/g)].map((match) => Number(match[1]));
  const privateRatioMatch = text.match(/私募\s*([\d.]+)\s*%/);
  const parentheticalPrivateRatio = text.match(/[（(]私募\s*([\d.]+)\s*%/);
  const privateRatio = numberOrNull(privateRatioMatch?.[1] ?? parentheticalPrivateRatio?.[1]);
  const approvedRatio = percentages.find((value) => value !== privateRatio) ?? percentages[0] ?? null;
  const termText = [...text.matchAll(/(\d+(?:\.\d+)?\s*(?:年|个月|月|天))/g)].at(-1)?.[1]?.replace(/\s+/g, "") || "";
  const offeringType = text.includes("公私募") ? "公私募" : text.includes("私募") ? "私募" : text.includes("公募") ? "公募" : "";

  return {
    approvalLevel,
    approvedAmount: numberOrNull(amount?.[1]),
    privateAmount: numberOrNull(privateAmount?.[1]),
    offeringType,
    approvedRatio: numberOrNull(approvedRatio),
    privateRatio,
    investmentTermText: termText,
    investmentTermDays: durationToDays(termText),
    rawText: text,
    sourceRank,
  };
}

export function extractIssuerLegalName(fullName) {
  const value = String(fullName || "").replace(/^关于投资/, "").trim();
  return value.match(/^(.+?(?:股份有限公司|有限责任公司|有限公司|集团公司))/)?.[1]?.trim()
    || value.match(/^(.+?)(?=20\d{2}\s*(?:年度|年))/)?.[1]?.trim()
    || "";
}

export function deriveIssuerAlias(shortName) {
  let value = String(shortName || "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/^\d{2}/, "")
    .split("/")[0];
  value = value.replace(/(?:SCP|CP|MTN|PPN|ABN).*$/i, "");
  value = value.replace(/[A-Z]+\d+.*$/i, "");
  value = value.replace(/\d+.*$/, "");
  return value.trim();
}

export function groupNewestIssuerRecords(records) {
  const byIssuer = new Map();
  const reviewRecords = [];

  for (const record of [...records].sort((left, right) => left.sourceRank - right.sourceRank)) {
    if (!record.issuerLegalName) {
      reviewRecords.push(record);
      continue;
    }

    const current = byIssuer.get(record.issuerLegalName);
    const aliases = [record.alias, record.shortName].filter(Boolean);
    if (!current) {
      byIssuer.set(record.issuerLegalName, {
        id: crypto.randomUUID(),
        legalName: record.issuerLegalName,
        aliases: [...new Set(aliases)],
        defaultBranch: record.branch,
        isRealEstate: record.isRealEstate,
        credit: record.credit,
        sourceOpinion: record.opinion,
        importWarnings: record.warnings,
      });
      if (record.warnings.length) reviewRecords.push(record);
      continue;
    }

    current.aliases = [...new Set([...current.aliases, ...aliases])];
    current.isRealEstate ||= record.isRealEstate;

    const currentHasPlaceholder = /[XxＸ？?]{2,}/.test(current.credit.rawText || "");
    const incomingHasConcreteRatio = Number.isFinite(record.credit.approvedRatio) || Number.isFinite(record.credit.privateRatio);
    if (currentHasPlaceholder && incomingHasConcreteRatio && !/[XxＸ？?]{2,}/.test(record.credit.rawText || "")) {
      current.credit = record.credit;
      current.sourceOpinion = record.opinion;
      current.importWarnings = record.warnings;
    }
  }

  return { issuers: [...byIssuer.values()], reviewRecords };
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
