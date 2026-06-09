export const DEFAULT_STATE = {
  version: 1,
  issuers: [],
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
  const text = String(value).trim().toUpperCase();
  let match = text.match(/^(\d+(?:\.\d+)?)\s*(D|天)$/i);
  if (match) return Math.round(Number(match[1]));
  match = text.match(/^(\d+(?:\.\d+)?)\s*(M|月)$/i);
  if (match) return Math.round(Number(match[1]) * 30);
  match = text.match(/^(\d+(?:\.\d+)?)\s*(Y|年)$/i);
  if (match) return Math.round(Number(match[1]) * 365);
  return null;
}

export function parseProjectBrief(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const result = {
    shortName: "",
    sponsorStatus: "",
    branch: "",
    durationText: "",
    durationDays: null,
    issueScale: null,
    subjectRating: "",
    ratingAgency: "",
    hiddenRating: "",
    inquiryLow: null,
    inquiryHigh: null,
    venue: "",
    leadUnderwriter: "",
    valuation: null,
    guidancePrice: null,
    sourceText: text,
    warnings: [],
  };

  if (!lines.length) {
    result.warnings.push("请先粘贴项目简表。");
    return result;
  }

  parseFirstLine(lines[0], result);
  if (lines[1]) parseSecondLine(lines[1], result);
  if (lines[2]) parseThirdLine(lines[2], result);

  for (const line of lines.slice(3)) {
    const valuation = line.match(/市场估值(?:约)?\s*(\d+(?:\.\d+)?)/);
    if (valuation) {
      const repeatedShortName = line.split(/\s+/)[0];
      if (result.shortName && repeatedShortName !== result.shortName) {
        result.warnings.push(`估值行简称“${repeatedShortName}”与首行简称不一致。`);
      }
      result.valuation = Number(valuation[1]);
    }
    const guidance = line.match(/指导价(?:约)?\s*(\d+(?:\.\d+)?)/);
    if (guidance) result.guidancePrice = Number(guidance[1]);
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
  if (!result.leadUnderwriter && result.sponsorStatus !== "牵头") {
    result.warnings.push("未识别牵头主承销商。");
  }

  return result;
}

function parseFirstLine(line, result) {
  const shortName = line.match(/^(\S+)/);
  if (shortName) result.shortName = shortName[1];

  const status = line.match(/(非我行主承|联席|牵头)/);
  if (status) result.sponsorStatus = status[1];

  if (status) {
    const branch = line.slice(status.index + status[1].length).trim();
    if (branch) result.branch = branch;
  }
}

function parseSecondLine(line, result) {
  const duration = line.match(/(?:^|\s)(\d+(?:\.\d+)?\s*(?:D|M|Y|天|月|年))(?:\s|$)/i);
  if (duration) {
    result.durationText = duration[1].replace(/\s+/g, "").toUpperCase();
    result.durationDays = durationToDays(result.durationText);
  }

  const scale = line.match(/规模\s*(\d+(?:\.\d+)?)\s*亿/);
  if (scale) result.issueScale = Number(scale[1]);

  const hidden = line.match(/隐含\s*([A-Z]+(?:\(\d+\))?)/i);
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
  const inquiry = line.match(/询价区间\s*(\d+(?:\.\d+)?)\s*[-—~至]\s*(\d+(?:\.\d+)?)/);
  if (inquiry) {
    result.inquiryLow = Number(inquiry[1]);
    result.inquiryHigh = Number(inquiry[2]);
  }

  const venue = line.match(/(银行间|上交所|深交所|北交所)/);
  if (venue) {
    result.venue = venue[1];
    result.leadUnderwriter = line.slice(venue.index + venue[1].length).trim();
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

export function buildBondFullName(shortName, legalName) {
  if (!shortName || !legalName) return "";
  const match = shortName.match(/^(\d{2}).*?(SCP|CP|MTN|PPN)(\d{3})$/i);
  if (!match) return "";
  const year = 2000 + Number(match[1]);
  const type = BOND_TYPES[match[2].toUpperCase()];
  const issueNumber = chineseNumber(Number(match[3]));
  return `${legalName}${year}年度第${issueNumber}期${type}`;
}

export function calculateSuggestion(project, issuer) {
  const warnings = [];
  const credit = issuer?.credit || {};
  const approvedRatio = numberOrNull(credit.approvedRatio);
  let suggestedRatio = approvedRatio;
  const caps = [];

  if (["牵头", "联席"].includes(project.sponsorStatus)) {
    caps.push({ value: 20, reason: "兴业银行参与主承，投资比例上限为20%" });
  }

  const exceedsCreditTerm =
    Number.isFinite(project.durationDays) &&
    Number.isFinite(numberOrNull(credit.investmentTermDays)) &&
    project.durationDays > Number(credit.investmentTermDays);

  if (exceedsCreditTerm && project.hiddenRating === "AA") {
    caps.push({ value: 15, reason: "隐含评级AA且债券期限超过授信投资期限，投资比例上限为15%" });
  }
  if (exceedsCreditTerm && project.hiddenRating === "AA(2)") {
    caps.push({ value: 10, reason: "隐含评级AA(2)且债券期限超过授信投资期限，投资比例上限为10%" });
  }

  if (suggestedRatio === null) {
    warnings.push("主体资料中缺少授信投资比例，无法计算建议比例和投资金额。");
  } else {
    for (const cap of caps) suggestedRatio = Math.min(suggestedRatio, cap.value);
  }

  const investmentAmount =
    Number.isFinite(project.issueScale) && Number.isFinite(suggestedRatio)
      ? round(project.issueScale * suggestedRatio / 100, 4)
      : null;

  return {
    approvedRatio,
    suggestedRatio,
    investmentAmount,
    caps,
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
  const fullName = project.fullName || buildBondFullName(project.shortName, issuer?.legalName);
  const branch = project.branch || issuer?.defaultBranch || "【待补充分行】";
  const underwriter = buildUnderwriter(project);
  const rating = project.subjectRating
    ? `${project.subjectRating}${project.ratingAgency ? `(${project.ratingAgency})` : ""}`
    : "【待补充主体评级】";
  const issueScale = Number.isFinite(project.issueScale) ? `${formatNumber(project.issueScale)}亿元` : "【待补充发行规模】";
  const duration = formatDuration(project.durationText) || "【待补充发行期限】";
  const inquiry = Number.isFinite(project.inquiryLow) && Number.isFinite(project.inquiryHigh)
    ? `${formatNumber(project.inquiryLow)}%-${formatNumber(project.inquiryHigh)}%`
    : "【待补充询价区间】";
  const amount = Number.isFinite(suggestion.investmentAmount)
    ? `${formatNumber(suggestion.investmentAmount)}亿元`
    : "【待补充投资金额】";
  const ratio = Number.isFinite(suggestion.suggestedRatio)
    ? `${formatNumber(suggestion.suggestedRatio)}%`
    : "【待补充投资比例】";
  const bidRate = "【待填写】";
  const creditSentence = formatCreditSentence(issuer);
  const approver = determineApprover(project.hiddenRating, suggestion.investmentAmount, Boolean(issuer?.isRealEstate));

  const opinion = [
    `${branch}申请与资金营运中心一二级联动投资${fullName || "【待补充债券全称】"}。`,
    `预计发行规模${issueScale}，发行期限${duration}，主体信用评级为${rating}，主承销商为${underwriter}，预计利率区间为${inquiry}。`,
    `授信方面，${creditSentence}。`,
    `${branch}拟申请投资金额不超过${amount}、一级投标利率不低于${bidRate}%。`,
    `建议投资金额不超过${amount}、投资比例不超过最终发行规模的${ratio}、一级投标利率不低于${bidRate}%。`,
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
    isRealEstate: Boolean(input.isRealEstate),
    credit: {
      approvalLevel: String(input.credit?.approvalLevel || "").trim(),
      approvedAmount: numberOrNull(input.credit?.approvedAmount),
      offeringType: String(input.credit?.offeringType || "").trim(),
      approvedRatio: numberOrNull(input.credit?.approvedRatio),
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
    if (existingRank === null || (incomingRank !== null && incomingRank < existingRank)) {
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
