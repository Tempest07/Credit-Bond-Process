export const DEFAULT_STATE = {
  version: 2,
  issuers: [],
  projects: [],
  protocolTransfers: [],
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
    const longestYears = Math.max(...match[1].split("/").map((part) =>
      part.split("+").reduce((sum, value) => sum + Number(value), 0),
    ));
    return Number.isFinite(longestYears) ? Math.round(longestYears * 365) : null;
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

  if (!result.shortName) result.warnings.push("未识别债券简称。");
  if (!result.sponsorStatus) result.warnings.push("未识别主承身份（非我行主承、联席或牵头）。");
  if (!result.branch) result.warnings.push("未识别申报分行。");
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
  const second = names[1];
  const letterPair = first.match(/^(.*)([A-Z])$/i);
  if (letterPair && second === `${letterPair[1]}${nextLetter(letterPair[2])}`) {
    return `${first}/${second.slice(-1)}`;
  }
  const firstNumber = first.match(/^(.*?)(\d+)$/);
  const secondNumber = second.match(/^(.*?)(\d+)$/);
  if (firstNumber && secondNumber && firstNumber[1] === secondNumber[1]) {
    return `${firstNumber[1]}${firstNumber[2]}/${secondNumber[2]}`;
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

  const branch = readStructuredField(lines, ["分行", "申报分行"]);
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

export function findIssuer(shortName, issuers = []) {
  const candidates = issuers.flatMap((issuer) =>
    [...new Set([issuer.legalName, ...(issuer.aliases || [])])]
      .filter(Boolean)
      .map((alias) => ({ issuer, alias })),
  );
  return candidates
    .filter(({ alias }) => shortName.includes(alias))
    .sort((left, right) => right.alias.length - left.alias.length)[0]?.issuer || null;
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

export function calculateSuggestion(project, issuer) {
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
    return { index, durationText, durationDays, suggestedRatio: ratio, caps };
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
  if (project.sponsorStatus === "牵头") return "兴业银行";
  if (project.sponsorStatus === "联席") {
    if (!project.leadUnderwriter || project.leadUnderwriter.includes("兴业银行")) return "兴业银行";
    return `${project.leadUnderwriter}、兴业银行`;
  }
  return project.leadUnderwriter || "【待补充主承销商】";
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
  const suggestion = calculateSuggestion(project, issuer);
  const fullName = project.fullName || buildBondFullName(project.shortName, issuer?.legalName, project);
  const branch = project.branch || issuer?.defaultBranch || "【待补充分行】";
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
  const bidRate = "【待填写】";
  const bidRateItems = recommendationTrancheSuggestions(suggestion);
  const bidRateSentence = dualTranche
    ? bidRateItems.map((item) => `${formatDuration(item.durationText)}期一级投标利率不低于${bidRate}%`).join("、")
    : `一级投标利率不低于${bidRate}%`;
  const creditSentence = formatCreditSentence(issuer);
  const approver = determineApprover(project.hiddenRating, suggestion.investmentAmount, Boolean(issuer?.isRealEstate));
  const recommendationAmount = formatRecommendationAmount(suggestion, amount, dualTranche);

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
    "本流程可用于一级、二级市场投资。",
    "以上妥否，请领导审核。",
    approver,
  ].join("");

  const warnings = [...project.warnings, ...suggestion.warnings];
  if (!issuer) warnings.push("未匹配到主体资料，请选择或新增主体。");
  if (!fullName) warnings.push("无法根据简称生成债券全称，请手工填写。");
  warnings.push("一级投标利率按规则留空，提交前请填写。");

  return { opinion, suggestion, approver, fullName, warnings };
}

export function normalizeIssuer(input) {
  const issuer = {
    id: input.id || crypto.randomUUID(),
    legalName: String(input.legalName || "").trim(),
    aliases: [...new Set((input.aliases || []).map((value) => String(value).trim()).filter(Boolean))],
    defaultBranch: String(input.defaultBranch || "").trim(),
    enterpriseType: ["央企", "地方国企", "民营企业", "其他"].includes(input.enterpriseType) ? input.enterpriseType : "",
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
  if (Array.isArray(project?.inquiryRanges) && project.inquiryRanges.length) return project.inquiryRanges;
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
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(D|M|Y|天|月|年)$/i);
  if (!match) return text;
  const unit = { D: "天", M: "个月", Y: "年", 天: "天", 月: "个月", 年: "年" }[match[2].toUpperCase()] || match[2];
  return `${formatNumber(match[1])}${unit}`;
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
