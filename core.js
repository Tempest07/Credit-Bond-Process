export const DEFAULT_STATE = {
  version: 2,
  issuers: [],
  projects: [],
  protocolTransfers: [],
  secondaryInventoryPositions: [],
  secondaryOrders: [],
  secondaryTrades: [],
  ftpCurve: {
    m3: null,
    m4: null,
    m6: null,
    m9: null,
    y1: null,
    y2: null,
    y3: null,
    y4: null,
    y5: null,
    y7: null,
    y10: null,
  },
  updatedAt: null,
};

const BOND_TYPES = {
  SCP: "超短期融资券",
  CP: "短期融资券",
  MTN: "中期票据",
  PPN: "定向债务融资工具",
};

export function normalizeText(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function durationToDays(value = "") {
  const text = String(value).trim().toUpperCase().replace(/期$/, "");
  let match = text.match(/^(\d+(?:\.\d+)?)\s*(D|天)$/i);
  if (match) return Math.round(Number(match[1]));
  match = text.match(/^(\d+(?:\.\d+)?)\s*(M|月)$/i);
  if (match) return Math.round(Number(match[1]) * 30);
  match = text.match(/^([\d.+/]+)\s*(Y|年)$/i);
  if (match) {
    const longestExerciseYears = Math.max(...match[1].split("/").map((part) =>
      Number(part.split("+")[0]),
    ));
    return Number.isFinite(longestExerciseYears) ? Math.round(longestExerciseYears * 365) : null;
  }
  return null;
}

export function durationParts(value = "") {
  const text = String(value).trim().toUpperCase().replace(/期$/, "");
  const unit = text.match(/(D|M|Y|天|月|年)$/i)?.[1] || "";
  if (!unit) return [];
  return text
    .slice(0, -unit.length)
    .split("/")
    .map((part) => `${part}${unit}`)
    .filter((part) => Number.isFinite(durationToDays(part)));
}

export function parseProjectBrief(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const result = {
    shortName: "",
    shortNames: [],
    instrumentType: "",
    fullName: "",
    issuerName: "",
    sponsorStatus: "",
    branch: "",
    durationText: "",
    durationDays: null,
    durationParts: [],
    issueScale: null,
    subjectRating: "",
    ratingAgency: "",
    hiddenRating: "",
    inquiryLow: null,
    inquiryHigh: null,
    inquiryLow2: null,
    inquiryHigh2: null,
    inquiryRanges: [],
    venue: "",
    leadUnderwriter: "",
    offeringType: "",
    offeringTypeSource: "",
    exchangeIssueNumber: null,
    valuation: null,
    valuations: [],
    guidancePrice: null,
    guidancePrices: [],
    absInfo: defaultAbsInfo(),
    sourceText: text,
    warnings: [],
  };

  if (!lines.length) {
    result.warnings.push("请先粘贴项目简表。");
    return result;
  }

  if (isStructuredProjectAdvertisement(lines)) {
    parseStructuredProjectAdvertisement(lines, result);
  } else {
    const headerIndex = lines.findIndex(isProjectHeader);
    const effectiveHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
    parseFirstLine(lines[effectiveHeaderIndex], result);
    result.shortNames = collectShortNames(lines, effectiveHeaderIndex);
    result.shortName = combineShortNames(result.shortNames) || result.shortName;

    const detailLines = lines.slice(effectiveHeaderIndex + 1);
    const termsLine = detailLines.find((line) => /规模\s*/.test(line) || /隐含\s*/.test(line));
    const inquiryLine = detailLines.find((line) => /询价区间/.test(line) || /(银行间|上交所|深交所|北交所)/.test(line));
    if (termsLine) parseSecondLine(termsLine, result);
    if (inquiryLine) parseThirdLine(inquiryLine, result);
  }
  parseOfferingType(text, result);
  result.exchangeIssueNumber = parseExplicitIssueNumber(text);
  parseAbsProjectFields(text, result);

  for (const line of lines) {
    const valuations = parseNumberListAfter(line, /市场估值(?:约)?\s*/);
    if (valuations.length) {
      const repeatedShortName = line.split(/\s+/)[0];
      if (result.shortName && !result.shortNames.includes(repeatedShortName) && repeatedShortName !== result.shortName) {
        result.warnings.push(`估值行简称“${repeatedShortName}”与首行简称不一致。`);
      }
      result.valuations = valuations;
      result.valuation = valuations[0];
    }
    const guidancePrices = /(?:不执行综合定价|不综|未综)/.test(line)
      ? []
      : parseNumberListAfter(line, /指导价(?:约)?\s*/);
    if (guidancePrices.length) {
      result.guidancePrices = guidancePrices;
      result.guidancePrice = guidancePrices[0];
    }
  }

  if (isAbsProject(result)) {
    addAbsParseWarnings(result);
  } else {
    if (!result.shortName) result.warnings.push("未识别债券简称。");
    if (!result.sponsorStatus) result.warnings.push("未识别主承身份（非我行主承、联席或牵头）。");
    if (!result.branch) result.warnings.push("未识别联动分行。");
    if (!result.durationDays) result.warnings.push("未识别债券期限。");
    if (!Number.isFinite(result.issueScale)) result.warnings.push("未识别发行规模。");
    if (!result.hiddenRating) result.warnings.push("未识别隐含评级。");
    if (!Number.isFinite(result.inquiryLow) || !Number.isFinite(result.inquiryHigh)) {
      result.warnings.push("未完整识别询价区间。");
    }
    if (isDualTranche(result) && result.inquiryRanges.length < 2) {
      result.warnings.push("已识别为双品种互拨，但未完整识别两个询价区间。");
    }
    if (!result.leadUnderwriter && result.sponsorStatus !== "牵头") {
      result.warnings.push("未识别牵头主承销商。");
    }
    if (isExchangeVenue(result.venue) && !result.offeringType) {
      result.warnings.push("交易所债券无法仅凭简称可靠判断公开或非公开发行，请在简表中注明“公开/非公开”或手工选择发行方式。");
    }
    if (result.offeringTypeSource === "short-name") {
      result.warnings.push(`发行方式根据简称尾部“${exchangeSeriesMarker(result.shortName)}”推断为${result.offeringType}，请确认。`);
    }
    if (isExchangeVenue(result.venue) && !Number.isInteger(result.exchangeIssueNumber)) {
      result.warnings.push("交易所债券简称尾号不等于发行期次，请在简表中注明“第几期”或手工填写交易所发行期次。");
    }
  }

  return result;
}

export function splitProjectBriefs(rawText) {
  const lines = normalizeText(rawText).split("\n");
  const blocks = [];
  let current = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const isHeader = isProjectHeader(line);
    const isStructuredHeader = isStructuredAdvertisementHeader(line);
    if ((isHeader || isStructuredHeader) && current.length) {
      const pendingShortNames = [];
      while (isHeader && current.length && isStandaloneShortName(current[current.length - 1])) {
        pendingShortNames.unshift(current.pop());
      }
      if (current.length) blocks.push(current.join("\n"));
      current = pendingShortNames;
    }
    current.push(line);
  }

  if (current.length) blocks.push(current.join("\n"));
  return blocks.filter((block) => block.trim());
}

function isProjectHeader(line) {
  return /(?:非我行主承|我行牵头、独立主承|我行牵头主承|我行主承|我行联席主承|联席主承|牵头主承|联席|牵头)/.test(line)
    && line.includes("分行")
    && /\S+\s+/.test(line);
}

function isStandaloneShortName(line) {
  return /^\d{2}\S+$/.test(String(line || "").trim());
}

function isStructuredAdvertisementHeader(line) {
  return /^[【\[]\d{2}[^】\]]+[】\]]/.test(String(line || "").trim());
}

function collectShortNames(lines, headerIndex) {
  const names = lines
    .slice(0, headerIndex)
    .filter(isStandaloneShortName)
    .map((line) => line.trim());
  const headerName = lines[headerIndex]?.match(/^(\S+)/)?.[1];
  if (headerName) names.push(headerName);
  return [...new Set(names)];
}

function combineShortNames(names) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  const first = names[0];
  const letterPair = first.match(/^(.*)([A-Z])$/i);
  if (letterPair) {
    const suffixes = names.map((name) => name.match(new RegExp(`^${escapeRegExp(letterPair[1])}([A-Z])$`, "i"))?.[1]?.toUpperCase());
    const baseCode = letterPair[2].toUpperCase().charCodeAt(0);
    if (suffixes.every((suffix, index) => suffix && suffix.charCodeAt(0) === baseCode + index)) {
      return `${first}/${suffixes.slice(1).join("/")}`;
    }
  }
  const firstNumber = first.match(/^(.*?)(\d+)$/);
  if (firstNumber) {
    const suffixes = names.map((name) => name.match(new RegExp(`^${escapeRegExp(firstNumber[1])}(\\d+)$`))?.[1]);
    if (suffixes.every(Boolean)) {
      return `${firstNumber[1]}${suffixes.join("/")}`;
    }
  }
  return names.join("/");
}

function nextLetter(value) {
  return String.fromCharCode(String(value).toUpperCase().charCodeAt(0) + 1);
}

function parseNumberListAfter(line, prefixPattern) {
  const match = String(line || "").match(prefixPattern);
  if (!match) return [];
  return [...String(line).slice(match.index + match[0].length).matchAll(/\d+(?:\.\d+)?/g)].map((item) => Number(item[0]));
}

function parseExplicitIssueNumber(text) {
  const match = String(text || "").match(/第\s*([一二三四五六七八九十百零〇\d]+)\s*期/);
  if (!match) return null;
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  return chineseTextToNumber(match[1]);
}

function defaultAbsInfo(input = {}) {
  return {
    planName: String(input.planName || "").trim(),
    totalScale: numberOrNull(input.totalScale),
    bookDate: String(input.bookDate || "").trim(),
    selectedClass: String(input.selectedClass || "").trim(),
    underlyingAsset: String(input.underlyingAsset || "").trim(),
    creditEnhancementType: String(input.creditEnhancementType || "").trim(),
    creditEnhancementParty: String(input.creditEnhancementParty || "").trim(),
    creditApprovalText: String(input.creditApprovalText || "").trim(),
    approvalAmount: numberOrNull(input.approvalAmount),
    approvalRatio: numberOrNull(input.approvalRatio),
    approvalTermText: String(input.approvalTermText || "").trim(),
    applicationAmount: numberOrNull(input.applicationAmount),
    recommendedAmount: numberOrNull(input.recommendedAmount),
    tranches: Array.isArray(input.tranches) ? input.tranches.map(normalizeAbsTranche) : [],
    source: String(input.source || "").trim(),
  };
}

function normalizeAbsTranche(input = {}) {
  const shortName = String(input.shortName || "").trim();
  const className = normalizeAbsClassName(
    input.className || input.trancheLevel || input.absClassName || inferAbsClassNameFromShortName(shortName),
  );
  return {
    id: input.id || crypto.randomUUID(),
    className,
    shortName,
    securityId: String(input.securityId || "").trim(),
    scale: numberOrNull(input.scale ?? input.actualScale ?? input.planScale),
    sharePct: numberOrNull(input.sharePct),
    expectedMaturityDate: formatAbsDate(input.expectedMaturityDate || ""),
    expectedTerm: String(input.expectedTerm || input.tenor || "").trim(),
    debtRating: String(input.debtRating || "").trim().toUpperCase(),
    debtRatingAgency: String(input.debtRatingAgency || "").trim(),
    inquiryLow: numberOrNull(input.inquiryLow),
    inquiryHigh: numberOrNull(input.inquiryHigh),
    selected: Boolean(input.selected),
  };
}

function parseAbsProjectFields(text, result) {
  if (!isAbsText(text)) return;
  result.instrumentType = /ABN|资产支持票据/i.test(text) ? "ABN" : "ABS";
  const abs = defaultAbsInfo(result.absInfo);
  abs.planName ||= extractAfterLabel(text, ["专项计划", "产品名称", "计划名称", "债券全称", "债券名称"]) || result.fullName;
  abs.totalScale ??= parseScaleValue(extractAfterLabel(text, ["全专项计划发行规模合计", "发行规模", "规模"]));
  abs.bookDate ||= formatCompactBookDate(text);
  abs.underlyingAsset ||= extractAfterLabel(text, ["基础资产", "底层资产"]);
  abs.creditEnhancementParty ||= extractAfterLabel(text, ["差额支付承诺人", "流动性支持承诺人", "增信主体"]);
  if (!abs.creditEnhancementType && abs.creditEnhancementParty) {
    abs.creditEnhancementType = text.includes("流动性支持承诺人") ? "流动性支持承诺人" : text.includes("增信主体") ? "增信主体" : "差额支付承诺人";
  }
  abs.creditApprovalText ||= extractSentenceAfter(text, "授信方面");
  abs.approvalAmount ??= parseScaleValue(abs.creditApprovalText);
  const ratioMatch = abs.creditApprovalText.match(/(\d+(?:\.\d+)?)\s*%/);
  abs.approvalRatio ??= numberOrNull(ratioMatch?.[1]);
  abs.approvalTermText ||= [...abs.creditApprovalText.matchAll(/(\d+(?:\.\d+)?\s*(?:年|个月|月|天))/g)].at(-1)?.[1]?.replace(/\s+/g, "") || "";
  const parsedTranches = parseAbsTranchesFromText(text);
  if (parsedTranches.length && !abs.tranches.length) abs.tranches = parsedTranches;
  result.absInfo = abs;
  if (!result.fullName && abs.planName) result.fullName = abs.planName;
  if (!Number.isFinite(result.issueScale) && Number.isFinite(abs.totalScale)) result.issueScale = abs.totalScale;
}

function isAbsText(value = "") {
  return /(?:\bABS\b|\bABN\b|资产支持|专项计划|优先[ABC]?\d*级|优先级|次级|劣后)/i.test(String(value || ""));
}

export function isAbsProject(project = {}) {
  return /^(ABS|ABN)$/i.test(String(project.instrumentType || ""))
    || isAbsText(`${project.shortName || ""} ${project.fullName || ""} ${project.sourceText || ""} ${project.absInfo?.planName || ""}`);
}

function extractAfterLabel(text, labels = []) {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*[：:]\\s*([^\\n。；;]+)`);
    const match = String(text || "").match(pattern);
    if (match?.[1]) return trimEndingPunctuation(match[1]);
  }
  return "";
}

function extractSentenceAfter(text, label) {
  const pattern = new RegExp(`${escapeRegExp(label)}[，,:：]?\\s*([^。]+)`);
  return trimEndingPunctuation(String(text || "").match(pattern)?.[1] || "");
}

function formatCompactBookDate(text) {
  const compact = String(text || "").match(/【\s*(20\d{6})\s*簿记\s*】/);
  if (compact) return `${compact[1].slice(0, 4)}-${compact[1].slice(4, 6)}-${compact[1].slice(6, 8)}`;
  const date = String(text || "").match(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}/)?.[0];
  return date ? date.replace(/年|月/g, "-").replace(/日/g, "").replace(/\//g, "-").replace(/-(\d)(?=-|$)/g, "-0$1") : "";
}

function parseAbsTranchesFromText(text) {
  const pattern = /(优先[ABC]?\d*级?|优先级|次级|劣后级?)\s*([\d.]+)\s*亿元?(?:，占比\s*([\d.]+)\s*%)?(?:，预期(?:到期日|期限)为([^；。;]+))?/g;
  return [...String(text || "").matchAll(pattern)].map((match) => normalizeAbsTranche({
    className: normalizeAbsClassName(match[1]),
    scale: numberOrNull(match[2]),
    sharePct: numberOrNull(match[3]),
    expectedMaturityDate: /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(match[4] || "") ? formatAbsDate(match[4]) : "",
    expectedTerm: /\d/.test(match[4] || "") && !/\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(match[4] || "") ? String(match[4] || "").trim() : "",
  }));
}

function normalizeAbsClassName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^优先A$/i.test(text) || /^优先A级$/i.test(text)) return "优先A1级";
  if (/级$/.test(text)) return text;
  return `${text}级`;
}

function inferAbsClassNameFromShortName(shortName = "") {
  const suffix = String(shortName || "").trim().toUpperCase().match(/\d([ABC])$/)?.[1] || "";
  if (suffix === "A") return "优先A1级";
  if (suffix === "B") return "优先A2级";
  if (suffix === "C") return "次级";
  return "";
}

function formatAbsDate(value = "") {
  const match = String(value || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return String(value || "").trim();
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function addAbsParseWarnings(project) {
  if (!project.shortName) project.warnings.push("未识别 ABS 简称。");
  if (!project.branch) project.warnings.push("未识别联动分行。");
  if (!project.absInfo?.planName && !project.fullName) project.warnings.push("未识别专项计划/资产支持产品名称。");
  if (!Number.isFinite(numberOrNull(project.absInfo?.totalScale ?? project.issueScale))) project.warnings.push("未识别全专项计划发行规模。");
  if (!project.absInfo?.tranches?.length) project.warnings.push("未识别 ABS 分档结构，请补充优先/次级分档。");
  if (!project.absInfo?.underlyingAsset) project.warnings.push("未识别基础资产。");
  if (!project.absInfo?.creditEnhancementParty) project.warnings.push("未识别差额支付承诺人/流动性支持承诺人。");
}

function isStructuredProjectAdvertisement(lines) {
  return lines.some((line) =>
    /^(债券名称|债券全称|发行人|发行主体|债券类型|主体评级|隐含评级|发行场所|发行规模|发行期限|债券期限|询价区间|簿记管理人|主承销商|牵头主承销商)\s*[：:]/.test(line),
  );
}

function parseStructuredProjectAdvertisement(lines, result) {
  const shortName = readStructuredField(lines, ["债券简称", "简称"])
    || parseBracketedShortName(lines[0]);
  if (shortName) {
    result.shortName = shortName;
    result.shortNames = [shortName];
  }

  result.fullName = readStructuredField(lines, ["债券名称", "债券全称"]) || "";
  result.issuerName = readStructuredField(lines, ["发行人", "发行主体", "主体"]) || inferIssuerNameFromFullName(result.fullName);

  const sponsorStatus = parseSponsorStatus(readStructuredField(lines, ["主承身份", "承销身份"]));
  if (sponsorStatus) result.sponsorStatus = sponsorStatus;

  const branch = readStructuredField(lines, ["联动分行", "分行", "申报分行"]);
  if (branch) result.branch = normalizeBranchName(branch);

  const durationValue = readStructuredField(lines, ["发行期限", "债券期限", "期限"]);
  applyDurationValue(durationValue, result);

  const scale = parseScaleValue(readStructuredField(lines, ["发行规模", "规模"]));
  if (Number.isFinite(scale)) result.issueScale = scale;

  const rating = parseRatingValue(readStructuredField(lines, ["主体评级", "评级", "主体/债项评级"]));
  if (rating.rating) {
    result.subjectRating = rating.rating;
    result.ratingAgency = rating.agency;
  }

  const hiddenRating = parseRatingValue(readStructuredField(lines, ["隐含评级", "隐含"])).rating;
  if (hiddenRating) result.hiddenRating = hiddenRating;

  const venue = readStructuredField(lines, ["发行场所", "发行市场", "场所", "市场"]);
  const venueMatch = venue.match(/(银行间|上交所|深交所|北交所)/);
  if (venueMatch) result.venue = venueMatch[1];

  const underwriter = readStructuredField(lines, ["簿记管理人", "簿记人", "牵头主承销商", "主承销商", "主承"]);
  if (underwriter) result.leadUnderwriter = underwriter.trim();

  if (!result.sponsorStatus && result.leadUnderwriter) {
    result.sponsorStatus = result.leadUnderwriter.includes("兴业银行") ? "牵头" : "非我行主承";
  }

  applyInquiryValue(readStructuredField(lines, ["询价区间", "利率区间"]), result);

  const valuation = parseNumberListAfter(readStructuredField(lines, ["市场估值", "估值"]), /^/);
  if (valuation.length) {
    result.valuations = valuation;
    result.valuation = valuation[0];
  }

  const guidanceText = readStructuredField(lines, ["指导价", "综合定价指导价"]);
  if (guidanceText && !/(?:不执行综合定价|不综|未综)/.test(guidanceText)) {
    const guidancePrices = parseNumberListAfter(guidanceText, /^/);
    if (guidancePrices.length) {
      result.guidancePrices = guidancePrices;
      result.guidancePrice = guidancePrices[0];
    }
  }
}

function readStructuredField(lines, labels) {
  const pattern = new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})\\s*[：:]\\s*(.+)$`);
  for (const line of lines) {
    const match = String(line || "").trim().match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function parseBracketedShortName(line = "") {
  const match = String(line || "").trim().match(/^[【\[]([^】\]]+)[】\]]/);
  return match?.[1]?.trim() || "";
}

function inferIssuerNameFromFullName(fullName = "") {
  const text = String(fullName || "").trim();
  const match = text.match(/^(.+?)(?:20\d{2}年度|20\d{2}年|202\d年度|202\d年)/);
  return match?.[1]?.trim() || "";
}

function applyDurationValue(value, result) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*(?:\/\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*)*\s*(?:D|M|Y|天|月|年)(?:期)?)/i);
  if (!match) return;
  result.durationText = match[1].replace(/\s+/g, "").toUpperCase();
  result.durationDays = durationToDays(result.durationText);
  result.durationParts = durationParts(result.durationText);
}

function parseScaleValue(value = "") {
  const text = String(value || "");
  const expression = text.match(/(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)\s*亿/);
  if (expression) {
    return expression[1].split("+").reduce((sum, item) => sum + Number(item.trim()), 0);
  }
  const firstNumber = text.match(/\d+(?:\.\d+)?/);
  return firstNumber ? Number(firstNumber[0]) : null;
}

function parseRatingValue(value = "") {
  const match = String(value || "").match(/([A-Z]+[+-]?(?:\(\d+\))?)(?:\(([^)]+)\))?/i);
  return {
    rating: match?.[1]?.toUpperCase() || "",
    agency: match?.[2] || "",
  };
}

function parseSponsorStatus(value = "") {
  if (/联席/.test(value)) return "联席";
  if (/牵头|我行主承|兴业银行/.test(value)) return "牵头";
  if (/非我行主承|非/.test(value)) return "非我行主承";
  return "";
}

function normalizeBranchName(value = "") {
  const branch = String(value || "").trim();
  if (!branch) return "";
  return branch.endsWith("分行") ? branch : `${branch}分行`;
}

function applyInquiryValue(value, result) {
  const inquiryRanges = parseInquiryRanges(value);
  if (!inquiryRanges.length) return;
  result.inquiryRanges = inquiryRanges;
  result.inquiryLow = inquiryRanges[0].low;
  result.inquiryHigh = inquiryRanges[0].high;
  result.inquiryLow2 = inquiryRanges[1]?.low ?? null;
  result.inquiryHigh2 = inquiryRanges[1]?.high ?? null;
}

function parseInquiryRanges(value = "") {
  return [...String(value || "").matchAll(/(\d+(?:\.\d+)?)\s*%?\s*[-—~至]\s*(\d+(?:\.\d+)?)\s*%?/g)]
    .map((match) => ({ low: Number(match[1]), high: Number(match[2]) }));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFirstLine(line, result) {
  const shortName = line.match(/^(\S+)/);
  if (shortName) result.shortName = shortName[1];

  const status = line.match(/(我行牵头、独立主承|我行牵头主承|我行主承|非我行主承|我行联席主承|联席主承|牵头主承|联席|牵头)/);
  if (status) {
    result.sponsorStatus = status[1].includes("联席")
      ? "联席"
      : status[1] === "非我行主承"
        ? "非我行主承"
        : "牵头";
  }

  if (status) {
    const branch = line.slice(status.index + status[1].length)
      .replace(/(?:非公开|公开|公募|私募)/g, "")
      .trim();
    if (branch) result.branch = branch;
  }
}

function parseSecondLine(line, result) {
  const duration = line.match(/(?:^|\s)(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*(?:\/\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*)*\s*(?:D|M|Y|天|月|年)(?:期)?)(?:\s|$)/i);
  if (duration) {
    result.durationText = duration[1].replace(/\s+/g, "").toUpperCase();
    result.durationDays = durationToDays(result.durationText);
    result.durationParts = durationParts(result.durationText);
  }

  const scale = line.match(/规模(?:合计)?\s*(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)\s*亿/);
  if (scale) {
    result.issueScale = scale[1].split("+").reduce((sum, value) => sum + Number(value.trim()), 0);
  }

  const hidden = line.match(/隐含\s*([A-Z]+[+-]?(?:\(\d+\))?)/i);
  if (hidden) result.hiddenRating = hidden[1].toUpperCase();

  const ratingSegment = line
    .replace(duration?.[0] || "", " ")
    .replace(scale?.[0] || "", " ")
    .split("/隐含")[0]
    .trim();
  const rating = ratingSegment.match(/([A-Z]+[+-]?)(?:\(([^)]+)\))?/i);
  if (rating) {
    result.subjectRating = rating[1].toUpperCase();
    result.ratingAgency = rating[2] || "";
  }
}

function parseThirdLine(line, result) {
  const inquiryIndex = line.search(/询价区间/);
  const inquiryText = inquiryIndex >= 0 ? line.slice(inquiryIndex + 4) : line;
  const inquiryRanges = [...inquiryText.matchAll(/(\d+(?:\.\d+)?)\s*%?\s*[-—~至]\s*(\d+(?:\.\d+)?)\s*%?/g)]
    .map((match) => ({ low: Number(match[1]), high: Number(match[2]) }));
  if (inquiryRanges.length) {
    result.inquiryRanges = inquiryRanges;
    result.inquiryLow = inquiryRanges[0].low;
    result.inquiryHigh = inquiryRanges[0].high;
    result.inquiryLow2 = inquiryRanges[1]?.low ?? null;
    result.inquiryHigh2 = inquiryRanges[1]?.high ?? null;
  }

  const venue = line.match(/(银行间|上交所|深交所|北交所)/);
  if (venue) {
    result.venue = venue[1];
    result.leadUnderwriter = line.slice(venue.index + venue[1].length)
      .replace(/(?:非公开|公开|公募|私募)/g, "")
      .trim();
  }
}

function parseOfferingType(text, result) {
  if (/(?:非公开|私募)/.test(text)) {
    result.offeringType = "私募";
    result.offeringTypeSource = "explicit";
    return;
  }
  if (/公开发行/.test(text) || /(?:^|[\s/，,])(?:公开|公募)(?:$|[\s/，,])/.test(text)) {
    result.offeringType = "公募";
    result.offeringTypeSource = "explicit";
    return;
  }
  if (!isExchangeVenue(result.venue)) return;
  const marker = exchangeSeriesMarker(result.shortName);
  if (marker === "G") {
    result.offeringType = "公募";
    result.offeringTypeSource = "short-name";
  } else if (marker === "F") {
    result.offeringType = "私募";
    result.offeringTypeSource = "short-name";
  }
}

const GENERIC_ISSUER_ALIASES = new Set([
  "发展",
  "投资",
  "控股",
  "集团",
  "城投",
  "城建",
  "建设",
  "交通",
  "交投",
  "产投",
  "国投",
  "国资",
  "资本",
  "实业",
  "置业",
  "金控",
  "文旅",
  "水务",
  "能源",
  "开发",
  "运营",
  "管理",
  "城市",
  "市政",
  "高速",
  "铁路",
  "轨交",
  "地铁",
  "地产",
  "资产",
  "产业",
  "公司",
  "有限",
  "股份",
]);

function compactIssuerText(value = "") {
  return String(value || "").replace(/[^\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function issuerTextLength(value = "") {
  return Array.from(value).length;
}

function isSpecificIssuerAlias(alias) {
  const text = compactIssuerText(alias);
  if (!text || GENERIC_ISSUER_ALIASES.has(text)) return false;
  if (/^[a-z0-9]+$/i.test(text)) return text.length >= 4;
  return issuerTextLength(text) >= 2;
}

function issuerMatchScore(queryValue, aliasValue, isLegalName = false) {
  const query = compactIssuerText(queryValue);
  const alias = compactIssuerText(aliasValue);
  if (!query || !alias) return 0;
  const queryLength = issuerTextLength(query);
  const aliasLength = issuerTextLength(alias);
  if (query === alias) return (isLegalName ? 1000 : 900) + aliasLength;
  if (isLegalName) {
    if (query.includes(alias) && aliasLength >= 6) return 800 + aliasLength;
    if (alias.includes(query) && queryLength >= 4) return 700 + queryLength;
    return 0;
  }
  if (!isSpecificIssuerAlias(alias)) return 0;
  return query.includes(alias) ? 500 + aliasLength : 0;
}

export function findIssuer(query, issuers = []) {
  const candidates = issuers.flatMap((issuer) => {
    const legalName = String(issuer.legalName || "").trim();
    const aliases = [...new Set((issuer.aliases || []).map((alias) => String(alias || "").trim()).filter(Boolean))];
    return [
      ...(legalName ? [{ issuer, alias: legalName, isLegalName: true }] : []),
      ...aliases.map((alias) => ({ issuer, alias, isLegalName: false })),
    ];
  });
  return candidates
    .map((candidate) => ({ ...candidate, score: issuerMatchScore(query, candidate.alias, candidate.isLegalName) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.alias.length - left.alias.length)[0]?.issuer || null;
}

export function buildBondFullName(shortName, legalName, project = {}) {
  if (!shortName || !legalName) return "";
  const match = shortName.match(/^(\d{2}).*?(SCP|CP|MTN|PPN)(\d{3})(?:[A-Z](?:\/[A-Z])?)?$/i);
  if (match) {
    const year = 2000 + Number(match[1]);
    const type = BOND_TYPES[match[2].toUpperCase()];
    const issueNumber = chineseNumber(Number(match[3]));
    return `${legalName}${year}年度第${issueNumber}期${type}`;
  }

  if (!isExchangeVenue(project.venue)) return "";
  const exchangeMatch = shortName.match(/^(\d{2})/);
  const seriesMarker = exchangeSeriesMarker(shortName);
  const offeringType = inferOfferingType(project);
  const issueNumber = numberOrNull(project.exchangeIssueNumber);
  if (!exchangeMatch || (seriesMarker && !["G", "F"].includes(seriesMarker)) || !offeringType || !Number.isInteger(issueNumber) || issueNumber < 1) return "";
  const year = 2000 + Number(exchangeMatch[1]);
  const issueNumberText = chineseNumber(issueNumber);
  const issuance = offeringType === "私募" ? "非公开" : "公开";
  return `${legalName}${year}年面向专业投资者${issuance}发行公司债券(第${issueNumberText}期)`;
}

export function normalizeBondFullNameForProject(fullName, project = {}) {
  const text = String(fullName || "").trim();
  if (!text) return "";
  if (!isDualTranche(project)) return text;
  return text
    .replace(/\s*[（(]\s*品种(?:[一二三四五六七八九十]+|\d+)\s*[）)]\s*$/u, "")
    .replace(/\s*品种(?:[一二三四五六七八九十]+|\d+)\s*$/u, "")
    .trim();
}

export function calculateSuggestion(project, issuer) {
  if (isAbsProject(project)) return calculateAbsSuggestion(project, issuer);
  const warnings = [];
  const credit = issuer?.credit || {};
  const offeringType = inferOfferingType(project);
  const exchangeOfferingUnknown = isExchangeVenue(project.venue) && !offeringType;
  const approvedRatio = exchangeOfferingUnknown
    ? null
    : offeringType === "私募" && Number.isFinite(numberOrNull(credit.privateRatio))
      ? numberOrNull(credit.privateRatio)
      : numberOrNull(credit.approvedRatio);
  const commonCaps = [];

  if (["牵头", "联席"].includes(project.sponsorStatus)) {
    commonCaps.push({ value: 20, reason: "兴业银行参与主承，投资比例上限为20%" });
  }

  const parts = projectDurationParts(project);
  const trancheSuggestions = parts.map((durationText, index) => {
    const caps = [...commonCaps];
    const durationDays = parts.length === 1 && Number.isFinite(project.durationDays)
      ? project.durationDays
      : durationToDays(durationText);
    const exceedsCreditTerm =
      Number.isFinite(durationDays) &&
      Number.isFinite(numberOrNull(credit.investmentTermDays)) &&
      durationDays > Number(credit.investmentTermDays);

    caps.push(...overdueRatingCaps(project.hiddenRating, offeringType, durationText, exceedsCreditTerm));

    let ratio = approvedRatio;
    if (Number.isFinite(ratio)) {
      for (const cap of caps) ratio = Math.min(ratio, cap.value);
    }
    return { index, durationText, durationDays, suggestedRatio: ratio, caps, exceedsCreditTerm };
  });
  const caps = uniqueCaps(trancheSuggestions.flatMap((item) => item.caps));
  const suggestedRatios = trancheSuggestions.map((item) => item.suggestedRatio).filter(Number.isFinite);
  const suggestedRatio = suggestedRatios.length ? Math.max(...suggestedRatios) : null;

  if (!Number.isFinite(suggestedRatio)) {
    warnings.push(exchangeOfferingUnknown
      ? "交易所债券发行方式未确认，暂不计算投资比例和金额。"
      : "主体资料中缺少授信投资比例，无法计算建议比例和投资金额。");
  }
  if (trancheSuggestions.some((item) => item.suggestedRatio === 0)) {
    warnings.push("部分期限因超授信期限及隐含评级规则不可投资，建议限投可投期限。");
  }

  const investmentAmount =
    Number.isFinite(project.issueScale) && Number.isFinite(suggestedRatio)
      ? round(project.issueScale * suggestedRatio / 100, 4)
      : null;

  return {
    offeringType,
    approvedRatio,
    suggestedRatio,
    investmentAmount,
    caps,
    trancheSuggestions,
    warnings,
  };
}

export function determineApprover(hiddenRating, investmentAmount, isRealEstate) {
  if (isRealEstate) return "本笔为房地产债业务，由林总终批。";
  if (!Number.isFinite(investmentAmount)) return "【待确认终批层级】";

  if (hiddenRating === "AAA") {
    if (investmentAmount > 10) return "本笔业务由周总终批。";
    if (investmentAmount > 8) return "本笔业务由金处终批。";
    return "本笔业务由处室终批。";
  }

  if (investmentAmount > 4) return "本笔业务由周总终批。";
  if (investmentAmount > 3.2) return "本笔业务由金处终批。";
  return "本笔业务由处室终批。";
}

export function buildUnderwriter(project) {
  const underwriters = parseUnderwriterNames(project.leadUnderwriter);
  if (project.sponsorStatus === "牵头") return "兴业银行";
  if (project.sponsorStatus === "联席") {
    const leadNames = underwriters.filter((name) => !isXingyeUnderwriter(name));
    const names = uniqueNonEmpty([...leadNames, "兴业银行"]);
    return names.length > 1 ? names.join("、") : "【待补充牵头主承销商】、兴业银行";
  }
  return underwriters.length ? underwriters.join("、") : "【待补充主承销商】";
}

function parseUnderwriterNames(value = "") {
  return uniqueNonEmpty(
    String(value || "")
      .split(/[、,，;；/]/)
      .map(formatUnderwriterName),
  );
}

function formatUnderwriterName(value = "") {
  return String(value || "")
    .trim()
    .replace(/^(牵头主承销商|主承销商|簿记管理人|簿记人)[:：]?/, "")
    .replace(/(股份有限公司|有限责任公司|责任有限公司|有限公司)$/u, "")
    .trim();
}

function isXingyeUnderwriter(value = "") {
  return /兴业银行/.test(value);
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function formatCreditTermCoverageSentence(suggestion, branch) {
  if (!suggestion.trancheSuggestions.some((item) => item.exceedsCreditTerm)) return "";
  return `本笔业务期限不覆盖，请${branch || "【待补充联动分行】"}及时续作授信，或在授信到期前三个月通知我部，避免超期限持有。`;
}

export function formatCreditSentence(issuer) {
  const credit = issuer?.credit || {};
  if (credit.rawText?.trim()) return trimEndingPunctuation(credit.rawText);

  const level = credit.approvalLevel || "【待补充审批层级】";
  const amount = Number.isFinite(numberOrNull(credit.approvedAmount))
    ? `${formatNumber(credit.approvedAmount)}亿`
    : "【待补充批复金额】";
  const offeringType = credit.offeringType || "【待补充公募/私募】";
  const ratio = Number.isFinite(numberOrNull(credit.approvedRatio))
    ? `${formatNumber(credit.approvedRatio)}%`
    : "【待补充比例】";
  const term = credit.investmentTermText || daysToTermText(credit.investmentTermDays) || "【待补充投资期限】";
  return `${level}批${amount}，${offeringType}，${ratio}，${term}`;
}

export function generateOpinion(project, issuer) {
  if (isAbsProject(project)) return generateAbsOpinion(project, issuer);
  const suggestion = calculateSuggestion(project, issuer);
  const fullName = normalizeBondFullNameForProject(project.fullName, project)
    || buildBondFullName(project.shortName, issuer?.legalName, project);
  const branch = project.branch || issuer?.linkedBranch || issuer?.defaultBranch || "【待补充联动分行】";
  const underwriter = buildUnderwriter(project);
  const rating = project.subjectRating
    ? `${project.subjectRating}${project.ratingAgency ? `(${project.ratingAgency})` : ""}`
    : "【待补充主体评级】";
  const dualTranche = isDualTranche(project);
  const issueScale = Number.isFinite(project.issueScale)
    ? `${dualTranche ? "合计" : ""}${formatNumber(project.issueScale)}亿元`
    : "【待补充发行规模】";
  const duration = formatProjectDuration(project);
  const inquiry = formatProjectInquiry(project);
  const amount = Number.isFinite(suggestion.investmentAmount)
    ? `${formatNumber(suggestion.investmentAmount)}亿元`
    : "【待补充投资金额】";
  const ratio = formatSuggestionRatio(suggestion, dualTranche);
  const bidRateItems = recommendationTrancheSuggestions(suggestion);
  const bidRateSentence = dualTranche
    ? bidRateItems.map((item) => `${formatDuration(item.durationText)}期一级投标利率不低于${formatBidRate(project, item.index)}%`).join("、")
    : `一级投标利率不低于${formatBidRate(project, 0)}%`;
  const creditSentence = formatCreditSentence(issuer);
  const approver = determineApprover(project.hiddenRating, suggestion.investmentAmount, Boolean(issuer?.isRealEstate));
  const recommendationAmount = formatRecommendationAmount(suggestion, amount, dualTranche);
  const creditTermCoverageSentence = formatCreditTermCoverageSentence(suggestion, branch);

  const opinion = [
    `${branch}申请与资金营运中心一二级联动投资${fullName || "【待补充债券全称】"}。`,
    `预计发行规模${issueScale}，发行期限${duration}，主体信用评级为${rating}，主承销商为${underwriter}，预计利率区间为${inquiry}。`,
    `授信方面，${creditSentence}。`,
    dualTranche
      ? `${branch}拟申请投资金额合计不超过${amount}。`
      : `${branch}拟申请投资金额不超过${amount}、${bidRateSentence}。`,
    dualTranche
      ? `${recommendationAmount}、${ratio}、${bidRateSentence}。`
      : `建议投资金额不超过${amount}、投资比例不超过最终发行规模的${ratio}、${bidRateSentence}。`,
    creditTermCoverageSentence,
    "本流程可用于一级、二级市场投资。",
    "以上妥否，请领导审核。",
    approver,
  ].filter(Boolean).join("");

  const warnings = [...project.warnings, ...suggestion.warnings];
  if (!issuer) warnings.push("未匹配到主体资料，请选择或新增主体。");
  if (!fullName) warnings.push("无法根据简称生成债券全称，请手工填写。");
  if (bidRateItems.some((item) => !Number.isFinite(bidRateValue(project, item.index)))) {
    warnings.push("未识别市场估值，一级投标利率需手工填写。");
  }

  return { opinion, suggestion, approver, fullName, warnings };
}

function calculateAbsSuggestion(project, issuer) {
  const abs = defaultAbsInfo(project.absInfo);
  const credit = issuer?.credit || {};
  const tranches = abs.tranches.map((tranche) => ({
    ...tranche,
    selected: tranche.selected || absTrancheMatchesSelection(tranche, project, abs),
  }));
  const selected = tranches.filter((tranche) => tranche.selected);
  const investable = selected.length ? selected : tranches.filter(isInvestableAbsTranche);
  const ratio = numberOrNull(abs.approvalRatio)
    ?? numberOrNull(credit.approvedRatio)
    ?? 20;
  const approvalAmount = numberOrNull(abs.approvalAmount)
    ?? numberOrNull(credit.approvedAmount)
    ?? numberOrNull(credit.privateAmount);
  const selectedScale = sumNumbers(investable.map((tranche) => tranche.scale));
  const calculatedAmount = Number.isFinite(selectedScale) && Number.isFinite(ratio)
    ? round(selectedScale * ratio / 100, 4)
    : null;
  const applicationAmount = numberOrNull(abs.applicationAmount)
    ?? approvalAmount
    ?? calculatedAmount;
  const recommendedAmount = numberOrNull(abs.recommendedAmount)
    ?? applicationAmount;
  const trancheSuggestions = investable.length
    ? investable.map((tranche, index) => ({
        index,
        durationText: tranche.expectedTerm || tranche.expectedMaturityDate || tranche.className || `分档${index + 1}`,
        suggestedRatio: ratio,
        className: tranche.className,
        shortName: tranche.shortName,
        investmentAmount: Number.isFinite(numberOrNull(tranche.scale)) && Number.isFinite(ratio)
          ? round(numberOrNull(tranche.scale) * ratio / 100, 4)
          : null,
      }))
    : [{ index: 0, durationText: abs.selectedClass || "优先级", suggestedRatio: ratio }];
  const warnings = [];
  if (!Number.isFinite(numberOrNull(abs.approvalRatio)) && !Number.isFinite(numberOrNull(credit.approvedRatio))) {
    warnings.push("ABS 投资比例未从授信或字段中识别，暂按 20% 生成，请复核。");
  }
  if (!Number.isFinite(applicationAmount)) warnings.push("ABS 申请投标金额待补充。");

  return {
    offeringType: "ABS",
    approvedRatio: ratio,
    suggestedRatio: ratio,
    investmentAmount: applicationAmount,
    recommendedAmount,
    applicationAmount,
    caps: Number.isFinite(ratio) ? [{ value: ratio, reason: `ABS 优先档投资比例不超过${formatNumber(ratio)}%` }] : [],
    trancheSuggestions,
    selectedTranches: investable,
    warnings,
  };
}

function generateAbsOpinion(project, issuer) {
  const abs = defaultAbsInfo(project.absInfo);
  const suggestion = calculateAbsSuggestion({ ...project, absInfo: abs }, issuer);
  const branch = project.branch || issuer?.linkedBranch || issuer?.defaultBranch || "【待补充联动分行】";
  const planName = abs.planName || project.fullName || "【待补充专项计划/资产支持产品名称】";
  const totalScale = numberOrNull(abs.totalScale ?? project.issueScale);
  const issueScaleText = Number.isFinite(totalScale) ? `${formatNumber(totalScale)}亿元` : "【待补充发行规模】";
  const tranches = abs.tranches.length ? abs.tranches : suggestion.selectedTranches;
  const descriptiveTranches = tranches.filter(isInvestableAbsTranche);
  const displayedTranches = descriptiveTranches.length ? descriptiveTranches : tranches;
  const selectedTranches = suggestion.selectedTranches?.length ? suggestion.selectedTranches : displayedTranches;
  const selectedClassText = formatAbsClassList(selectedTranches) || abs.selectedClass || "优先级";
  const applicationAmount = Number.isFinite(numberOrNull(suggestion.applicationAmount))
    ? `${formatNumber(suggestion.applicationAmount)}亿元`
    : "【待补充申请金额】";
  const recommendedAmount = Number.isFinite(numberOrNull(suggestion.recommendedAmount))
    ? `${formatNumber(suggestion.recommendedAmount)}亿元`
    : applicationAmount;
  const ratioText = Number.isFinite(numberOrNull(suggestion.suggestedRatio))
    ? `${formatNumber(suggestion.suggestedRatio)}%`
    : "【待补充比例】";
  const creditSentence = abs.creditApprovalText
    ? trimEndingPunctuation(abs.creditApprovalText)
    : formatAbsCreditSentence(abs, issuer, selectedClassText, ratioText);
  const bookPrefix = abs.bookDate ? `【${abs.bookDate.replace(/-/g, "")}簿记】` : "";
  const trancheSentence = formatAbsTrancheSentence(displayedTranches, abs);
  const ratingSentence = formatAbsRatingSentence(displayedTranches);
  const assetSentence = abs.underlyingAsset
    ? `基础资产为：${trimEndingPunctuation(abs.underlyingAsset)}`
    : "基础资产为：【待补充基础资产】";
  const enhancerSentence = abs.creditEnhancementParty
    ? `${abs.creditEnhancementType || "增信/支持主体"}为${trimEndingPunctuation(abs.creditEnhancementParty)}`
    : "【待补充差额支付承诺人/流动性支持承诺人】";
  const rateSentence = formatAbsRateSentence(selectedTranches);
  const ratioSentence = formatAbsRatioSentence(selectedClassText, ratioText, selectedTranches);
  const approver = "本笔业务由处室终批。";

  const opinion = [
    `${bookPrefix}${branch}拟与资金营运中心联动投资“${planName}”，发行规模${issueScaleText}${trancheSentence ? `，其中${trancheSentence}` : ""}。`,
    ratingSentence,
    `${assetSentence}，${enhancerSentence}。`,
    `授信方面，${creditSentence}。`,
    `${branch}拟申请投标${selectedClassText}金额不超过${applicationAmount}。`,
    `拟建议投标${selectedClassText}金额不超过${recommendedAmount}${ratioSentence}。`,
    rateSentence,
    "以上妥否，请领导审核。",
    approver,
  ].filter(Boolean).join("");

  const warnings = [...(project.warnings || []), ...suggestion.warnings];
  if (!abs.planName && !project.fullName) warnings.push("ABS 专项计划/产品名称待补充。");
  if (!displayedTranches.length) warnings.push("ABS 分档结构待补充。");
  if (!abs.underlyingAsset) warnings.push("ABS 基础资产待补充。");
  if (!abs.creditEnhancementParty) warnings.push("ABS 差额支付承诺人/流动性支持承诺人待补充。");
  if (selectedTranches.some((tranche) => !Number.isFinite(numberOrNull(tranche.inquiryLow)) || !Number.isFinite(numberOrNull(tranche.inquiryHigh)))) {
    warnings.push("ABS 优先档投标利率区间待补充。");
  }

  return { opinion, suggestion, approver, fullName: planName, warnings };
}

function absTrancheMatchesSelection(tranche, project, abs) {
  const query = String(project.shortName || "").trim();
  const selected = String(abs.selectedClass || "").trim();
  const values = [tranche.className, tranche.shortName].map((value) => String(value || "").trim()).filter(Boolean);
  if (selected && values.some((value) => value.includes(selected) || selected.includes(value))) return true;
  if (query && values.some((value) => value.includes(query) || query.includes(value))) return true;
  return false;
}

function isInvestableAbsTranche(tranche = {}) {
  const value = `${absTrancheDisplayClassName(tranche, 0, false)} ${tranche.shortName || ""}`;
  return !/(次级|劣后|夹层)/.test(value);
}

function sumNumbers(values = []) {
  const numbers = values.map(numberOrNull).filter(Number.isFinite);
  return numbers.length ? round(numbers.reduce((sum, value) => sum + value, 0), 4) : null;
}

function formatAbsClassList(tranches = []) {
  const names = uniqueNonEmpty(tranches.map((tranche, index) => absTrancheDisplayClassName(tranche, index, false)));
  if (!names.length) return "";
  return names.join("、");
}

function absTrancheDisplayClassName(tranche = {}, index = 0, allowGeneric = true) {
  const className = normalizeAbsClassName(
    tranche.className || tranche.trancheLevel || tranche.absClassName || inferAbsClassNameFromShortName(tranche.shortName),
  );
  if (className) return className;
  if (!allowGeneric) return "";
  return tranche.shortName || `分档${index + 1}`;
}

function formatAbsTrancheSentence(tranches = [], abs = {}) {
  return tranches.map((tranche, index) => {
    const className = absTrancheDisplayClassName(tranche, index);
    const scale = Number.isFinite(numberOrNull(tranche.scale)) ? `${formatNumber(tranche.scale)}亿元` : "【待补充规模】";
    const share = Number.isFinite(numberOrNull(tranche.sharePct)) ? `，占比${formatNumber(tranche.sharePct)}%` : "";
    const expectedMaturityDate = tranche.expectedMaturityDate || inferAbsExpectedMaturityDate(tranche.expectedTerm, abs.bookDate);
    const maturity = expectedMaturityDate
      ? `，预期到期日为${expectedMaturityDate.replace(/-/g, "/")}`
      : tranche.expectedTerm
        ? `，预期期限${tranche.expectedTerm}`
        : "";
    return `${className}${scale}${share}${maturity}`;
  }).join("；");
}

function inferAbsExpectedMaturityDate(expectedTerm = "", bookDate = "") {
  const base = formatAbsDate(bookDate);
  const term = String(expectedTerm || "").trim().toUpperCase();
  if (!base || !term) return "";
  const match = term.match(/^(\d+(?:\.\d+)?)\s*(D|天|M|月|Y|年)$/i);
  if (!match) return "";
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return "";
  const date = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const unit = match[2].toUpperCase();
  if (unit === "D" || unit === "天") {
    date.setUTCDate(date.getUTCDate() + Math.round(value));
  } else if (unit === "M" || unit === "月") {
    date.setUTCMonth(date.getUTCMonth() + Math.round(value));
  } else if (unit === "Y" || unit === "年") {
    date.setUTCFullYear(date.getUTCFullYear() + Math.round(value));
  } else {
    return "";
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatAbsRatingSentence(tranches = []) {
  const rated = tranches.filter((tranche) => tranche.debtRating);
  if (!rated.length) return "";
  const first = rated[0];
  const same = rated.every((tranche) =>
    tranche.debtRating === first.debtRating && (tranche.debtRatingAgency || "") === (first.debtRatingAgency || ""));
  if (same) {
    const names = formatAbsClassList(rated);
    const agency = first.debtRatingAgency ? `（${first.debtRatingAgency}）` : "";
    return `${names}之债项评级均为${first.debtRating}${agency}。`;
  }
  return `${rated.map((tranche, index) => {
    const agency = tranche.debtRatingAgency ? `（${tranche.debtRatingAgency}）` : "";
    return `${absTrancheDisplayClassName(tranche, index)}债项评级为${tranche.debtRating}${agency}`;
  }).join("；")}。`;
}

function formatAbsCreditSentence(abs, issuer, selectedClassText, ratioText) {
  const credit = issuer?.credit || {};
  const level = abs.approvalAmount || credit.approvedAmount ? (credit.approvalLevel || "总行储架") : "【待补充审批层级】";
  const amount = Number.isFinite(numberOrNull(abs.approvalAmount ?? credit.approvedAmount))
    ? `${formatNumber(abs.approvalAmount ?? credit.approvedAmount)}亿`
    : "【待补充批复金额】";
  const term = abs.approvalTermText || credit.investmentTermText || daysToTermText(credit.investmentTermDays) || "【待补充投资期限】";
  return `${level}批${amount}，每期投资金额不超过该期${selectedClassText}发行规模的${ratioText}，投资期限不超过${term}且不超过${selectedClassText}预期到期日`;
}

function formatAbsRatioSentence(selectedClassText, ratioText, tranches = []) {
  if (!ratioText || ratioText.includes("待补充")) return "";
  const scope = tranches.length > 1 ? `${selectedClassText}各档发行规模` : `该期${selectedClassText}发行规模`;
  return `，投资比例不超过${scope}的${ratioText}`;
}

function formatAbsRateSentence(tranches = []) {
  const items = tranches.map((tranche, index) => {
    const low = numberOrNull(tranche.inquiryLow);
    const high = numberOrNull(tranche.inquiryHigh);
    const name = absTrancheDisplayClassName(tranche, index, false) || "优先级";
    if (!Number.isFinite(low) || !Number.isFinite(high)) return "";
    return `${name}投标利率区间为${formatNumber(low)}%-${formatNumber(high)}%`;
  }).filter(Boolean);
  return items.length ? `${items.join("；")}。` : "";
}

export function applyIssuerCommonFields(project, issuer) {
  const sourceCommonFields = project.sourceCommonFields || {
    branch: project.branch || "",
    subjectRating: project.subjectRating || "",
    ratingAgency: project.ratingAgency || "",
    hiddenRating: project.hiddenRating || "",
  };
  if (!issuer) {
    return {
      ...project,
      ...sourceCommonFields,
      sourceCommonFields,
      warnings: (project.warnings || []).filter((warning) => !warning.startsWith("主体库要素")),
    };
  }
  const next = {
    ...project,
    sourceCommonFields,
    warnings: (project.warnings || []).filter((warning) => !warning.startsWith("主体库要素")),
  };

  applyIssuerCommonField(next, { branch: issuer.linkedBranch || issuer.defaultBranch }, "branch", "联动分行", normalizeBranchName);
  applyIssuerCommonField(next, issuer, "subjectRating", "主体评级", normalizeRatingValue);
  applyIssuerCommonField(next, issuer, "ratingAgency", "评级机构", normalizeTextValue);
  applyIssuerCommonField(next, issuer, "hiddenRating", "市场隐含评级", normalizeRatingValue);
  return next;
}

function applyIssuerCommonField(project, issuer, field, label, normalize) {
  const storedRaw = issuer?.[field];
  if (!String(storedRaw || "").trim()) return;
  const storedValue = normalize(storedRaw);
  const inputValue = normalize(project.sourceCommonFields?.[field] ?? project[field]);
  if (inputValue && inputValue !== storedValue) {
    project.warnings.push(`主体库要素${label}为“${storedValue}”，输入简表为“${inputValue}”，已优先使用主体库，请检查。`);
  }
  project[field] = storedValue;
}

function normalizeRatingValue(value = "") {
  return String(value || "").trim().toUpperCase();
}

function normalizeTextValue(value = "") {
  return String(value || "").trim();
}

export function normalizeIssuer(input) {
  const linkedBranch = normalizeBranchName(input.linkedBranch || input.defaultBranch || input.branch || "");
  const issuer = {
    id: input.id || crypto.randomUUID(),
    legalName: String(input.legalName || "").trim(),
    aliases: [...new Set((input.aliases || []).map((value) => String(value).trim()).filter(Boolean))],
    linkedBranch,
    defaultBranch: linkedBranch,
    enterpriseType: ["央企", "地方国企", "民营企业", "其他"].includes(input.enterpriseType) ? input.enterpriseType : "",
    subjectRating: String(input.subjectRating || "").trim().toUpperCase(),
    ratingAgency: String(input.ratingAgency || "").trim(),
    hiddenRating: String(input.hiddenRating || "").trim().toUpperCase(),
    isRealEstate: Boolean(input.isRealEstate),
    credit: {
      approvalLevel: String(input.credit?.approvalLevel || "").trim(),
      approvedAmount: numberOrNull(input.credit?.approvedAmount),
      privateAmount: numberOrNull(input.credit?.privateAmount),
      offeringType: String(input.credit?.offeringType || "").trim(),
      approvedRatio: numberOrNull(input.credit?.approvedRatio),
      privateRatio: numberOrNull(input.credit?.privateRatio),
      investmentTermText: String(input.credit?.investmentTermText || "").trim(),
      investmentTermDays: durationToDays(input.credit?.investmentTermText) ?? numberOrNull(input.credit?.investmentTermDays),
      rawText: String(input.credit?.rawText || "").trim(),
      sourceRank: numberOrNull(input.credit?.sourceRank),
      updatedAt: input.credit?.updatedAt || new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  if (!issuer.legalName) throw new Error("主体正式名称不能为空。");
  return issuer;
}

export function upsertIssuer(state, input) {
  const issuer = normalizeIssuer(input);
  const issuers = [...(state.issuers || [])];
  const index = issuers.findIndex((item) => item.id === issuer.id);
  if (index >= 0) issuers[index] = issuer;
  else issuers.push(issuer);
  return { ...state, issuers, updatedAt: new Date().toISOString() };
}

export function mergeImportedIssuers(state, importedIssuers = []) {
  let next = { ...state, issuers: [...(state.issuers || [])] };
  const ordered = importedIssuers
    .map((issuer, index) => ({
      ...issuer,
      credit: { ...(issuer.credit || {}), sourceRank: issuer.credit?.sourceRank ?? index },
    }))
    .sort((left, right) => Number(left.credit.sourceRank) - Number(right.credit.sourceRank));

  for (const input of ordered) {
    const incoming = normalizeIssuer(input);
    const aliases = new Set([incoming.legalName, ...incoming.aliases]);
    const existingIndex = next.issuers.findIndex((issuer) =>
      [issuer.legalName, ...(issuer.aliases || [])].some((value) => aliases.has(value)),
    );

    if (existingIndex < 0) {
      next.issuers.push(incoming);
      continue;
    }

    const existing = next.issuers[existingIndex];
    const existingRank = numberOrNull(existing.credit?.sourceRank);
    const incomingRank = numberOrNull(incoming.credit?.sourceRank);
    if (existingRank !== null && incomingRank !== null && incomingRank < existingRank) {
      next.issuers[existingIndex] = { ...incoming, id: existing.id };
    }
  }

  return { ...next, updatedAt: new Date().toISOString() };
}

function chineseNumber(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 999) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value];
  if (value < 20) return `十${value % 10 ? digits[value % 10] : ""}`;
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ""}`;
  const hundreds = `${digits[Math.floor(value / 100)]}百`;
  const rest = value % 100;
  if (!rest) return hundreds;
  return `${hundreds}${rest < 10 ? "零" : ""}${chineseNumber(rest)}`;
}

function chineseTextToNumber(value) {
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/[十百]/.test(value)) {
    const number = [...value].reduce((result, character) => result * 10 + digits[character], 0);
    return Number.isFinite(number) ? number : null;
  }
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (character === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else if (character === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else {
      current = digits[character] ?? current;
    }
  }
  return total + current;
}

export function inferOfferingType(project) {
  if (["公募", "私募"].includes(project?.offeringType)) return project.offeringType;
  const fullName = String(project?.fullName || "");
  const shortName = String(project?.shortName || "").toUpperCase();
  if (fullName.includes("非公开") || /PPN\d*/.test(shortName)) return "私募";
  if (fullName.includes("公开") || /(SCP|CP|MTN)\d*/.test(shortName)) return "公募";
  return "";
}

function isExchangeVenue(venue) {
  return ["上交所", "深交所", "北交所"].includes(String(venue || ""));
}

function exchangeSeriesMarker(shortName) {
  return String(shortName || "").match(/[A-Z](?=\d+$)/i)?.[0]?.toUpperCase() || "";
}

function projectDurationParts(project) {
  const parts = Array.isArray(project?.durationParts) && project.durationParts.length
    ? project.durationParts
    : durationParts(project?.durationText);
  return parts.length ? parts : [String(project?.durationText || "")];
}

function isDualTranche(project) {
  return projectDurationParts(project).filter(Boolean).length > 1
    || (project?.shortNames || []).length > 1
    || (project?.inquiryRanges || []).length > 1;
}

function uniqueCaps(caps) {
  return [...new Map(caps.map((cap) => [`${cap.value}:${cap.reason}`, cap])).values()];
}

function overdueRatingCaps(hiddenRating, offeringType, durationText, exceedsCreditTerm) {
  if (!exceedsCreditTerm) return [];
  const rank = hiddenRatingRank(hiddenRating);
  if (!Number.isFinite(rank)) return [];
  const duration = formatDuration(durationText);
  if (rank === 5) {
    return offeringType === "私募"
      ? [{ value: 10, reason: `${duration}超过授信投资期限，隐含评级AA+私募投资比例上限为10%` }]
      : [{ value: 20, reason: `${duration}超过授信投资期限，隐含评级AA+公募投资比例上限为20%` }];
  }
  if (rank <= 4 && offeringType === "私募") {
    return [{ value: 0, reason: `${duration}超过授信投资期限，隐含评级AA及以下不可投资私募债` }];
  }
  if (rank <= 3) {
    return [{ value: 10, reason: `${duration}超过授信投资期限，隐含评级AA(2)及以下公募投资比例上限为10%` }];
  }
  if (rank <= 4) {
    return [{ value: 15, reason: `${duration}超过授信投资期限，隐含评级AA公募投资比例上限为15%` }];
  }
  return [];
}

function hiddenRatingRank(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (text === "AAA") return 7;
  if (text === "AAA-") return 6;
  if (text === "AA+") return 5;
  if (text === "AA") return 4;
  if (text === "AA(2)") return 3;
  if (text === "AA-") return 2;
  if (/^A/.test(text)) return 1;
  return null;
}

function formatProjectDuration(project) {
  const parts = projectDurationParts(project).filter(Boolean);
  if (!parts.length) return "【待补充发行期限】";
  if (isDualTranche(project)) return `${parts.map(formatDuration).join("/")}（双向互拨）`;
  return formatDuration(parts[0]);
}

function projectInquiryRanges(project) {
  if (Array.isArray(project?.inquiryRanges) && project.inquiryRanges.length) {
    return project.inquiryRanges.filter((range) =>
      Number.isFinite(Number(range?.low)) && Number.isFinite(Number(range?.high)),
    );
  }
  const ranges = [];
  if (Number.isFinite(project?.inquiryLow) && Number.isFinite(project?.inquiryHigh)) {
    ranges.push({ low: project.inquiryLow, high: project.inquiryHigh });
  }
  if (Number.isFinite(project?.inquiryLow2) && Number.isFinite(project?.inquiryHigh2)) {
    ranges.push({ low: project.inquiryLow2, high: project.inquiryHigh2 });
  }
  return ranges;
}

function formatProjectInquiry(project) {
  const ranges = projectInquiryRanges(project);
  if (!ranges.length) return "【待补充询价区间】";
  if (!isDualTranche(project)) return formatInquiryRange(ranges[0]);
  const parts = projectDurationParts(project);
  return ranges.map((range, index) =>
    `${parts[index] ? `${formatDuration(parts[index])}期` : `品种${chineseNumber(index + 1)}`}${formatInquiryRange(range)}`,
  ).join("/");
}

function formatInquiryRange(range) {
  return `${formatNumber(range.low)}%-${formatNumber(range.high)}%`;
}

function formatSuggestionRatio(suggestion, dualTranche) {
  if (!dualTranche) {
    return Number.isFinite(suggestion.suggestedRatio)
      ? `${formatNumber(suggestion.suggestedRatio)}%`
      : "【待补充投资比例】";
  }
  const limited = hasNonInvestableTranches(suggestion);
  const items = recommendationTrancheSuggestions(suggestion).filter((item) => item.durationText);
  const ratios = [...new Set(items.map((item) => item.suggestedRatio).filter(Number.isFinite))];
  if (!ratios.length) return "投资比例不超过各期限最终发行规模的【待补充投资比例】";
  if (ratios.length === 1 && !limited) return `投资比例不超过各期限最终发行规模的${formatNumber(ratios[0])}%`;
  if (ratios.length === 1 && items.length === 1) {
    return `投资比例不超过${formatDuration(items[0].durationText)}期最终发行规模的${formatNumber(ratios[0])}%`;
  }
  return `投资比例不超过${items.map((item) =>
    `${formatDuration(item.durationText)}期最终发行规模的${Number.isFinite(item.suggestedRatio) ? `${formatNumber(item.suggestedRatio)}%` : "【待补充投资比例】"}`,
  ).join("和")}`;
}

function formatRecommendationAmount(suggestion, amount, dualTranche) {
  if (!dualTranche || !hasNonInvestableTranches(suggestion)) return `建议投资金额合计不超过${amount}`;
  const items = recommendationTrancheSuggestions(suggestion);
  if (items.length === 1) return `建议限投资${formatDuration(items[0].durationText)}期金额不超过${amount}`;
  return `建议限投资${items.map((item) => `${formatDuration(item.durationText)}期`).join("、")}金额合计不超过${amount}`;
}

function recommendationTrancheSuggestions(suggestion) {
  const items = (suggestion.trancheSuggestions || []).filter((item) => item.durationText);
  const investable = items.filter((item) => Number.isFinite(item.suggestedRatio) && item.suggestedRatio > 0);
  return investable.length ? investable : items;
}

function bidRateValue(project, index = 0) {
  const valuations = Array.isArray(project?.valuations) ? project.valuations : [];
  const value = valuations[index] ?? project?.valuation;
  return numberOrNull(value);
}

function formatBidRate(project, index = 0) {
  const value = bidRateValue(project, index);
  return Number.isFinite(value) ? formatNumber(value) : "【待填写】";
}

function hasNonInvestableTranches(suggestion) {
  const items = (suggestion.trancheSuggestions || []).filter((item) => item.durationText);
  return items.some((item) => item.suggestedRatio === 0)
    && items.some((item) => Number.isFinite(item.suggestedRatio) && item.suggestedRatio > 0);
}

function daysToTermText(days) {
  const value = numberOrNull(days);
  if (!Number.isFinite(value)) return "";
  if (value % 365 === 0) return `${value / 365}年`;
  if (value % 30 === 0) return `${value / 30}个月`;
  return `${value}天`;
}

function formatDuration(value = "") {
  const text = String(value).trim().toUpperCase();
  const match = text.match(/^(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*)\s*(D|M|Y|天|月|年)$/i);
  if (!match) return text;
  const unit = { D: "天", M: "个月", Y: "年", 天: "天", 月: "个月", 年: "年" }[match[2].toUpperCase()] || match[2];
  return `${match[1].split("+").map((item) => formatNumber(item)).join("+")}${unit}`;
}

function trimEndingPunctuation(value) {
  return value.trim().replace(/[。；;，,]+$/, "");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return "";
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}
