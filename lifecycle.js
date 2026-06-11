const PROJECT_STATUSES = new Set([
  "未投标",
  "已投标待结果",
  "部分中标",
  "已中标",
  "未中标",
  "待缴款",
  "已缴款",
  "已结束",
]);

export const PROJECT_STATUS_OPTIONS = [...PROJECT_STATUSES];
const EXCHANGE_VENUES = new Set(["上交所", "深交所", "北交所"]);
const RATE_EPSILON = 0.00001;
const BID_ACTIONS = new Set(["投标", "改标", "参团+投标"]);

export function createProjectRecord(project, issuer, generated, input = {}) {
  const now = new Date().toISOString();
  const tranches = buildTranches(project);
  const cutoff = input.cutoffAt
    ? {
        cutoffAt: input.cutoffAt,
        cutoffTimeConfirmed: input.cutoffTimeConfirmed,
        cutoffSource: input.cutoffSource,
      }
    : suggestProjectCutoff(project, issuer);
  return normalizeProjectRecord({
    id: input.id || crypto.randomUUID(),
    status: input.status || "未投标",
    shortName: project.shortName,
    issuerId: issuer?.id || "",
    issuerName: issuer?.legalName || "",
    branch: project.branch || issuer?.defaultBranch || "",
    venue: project.venue || "",
    leadUnderwriter: project.leadUnderwriter || "",
    sponsorStatus: project.sponsorStatus || "",
    cutoffAt: cutoff.cutoffAt,
    cutoffTimeConfirmed: cutoff.cutoffTimeConfirmed,
    cutoffSource: cutoff.cutoffSource,
    cutoffHistory: input.cutoffHistory || [],
    opinion: generated?.opinion || "",
    sourceText: project.sourceText || "",
    notes: input.notes || "",
    tranches,
    resultAdvertisement: "",
    comprehensivePricing: false,
    pricingUnit: "万元",
    afterTaxRevenue: null,
    ftpCost: null,
    createdAt: now,
    updatedAt: now,
  });
}

export function normalizeProjectRecord(input = {}) {
  const migratedStatus = input.status === "待投标" ? "未投标" : input.status;
  const status = PROJECT_STATUSES.has(migratedStatus) ? migratedStatus : "未投标";
  const afterTaxRevenue = numberOrNull(input.afterTaxRevenue);
  const ftpCost = numberOrNull(input.ftpCost);
  return {
    id: input.id || crypto.randomUUID(),
    status,
    shortName: String(input.shortName || "").trim(),
    issuerId: String(input.issuerId || "").trim(),
    issuerName: String(input.issuerName || "").trim(),
    branch: String(input.branch || "").trim(),
    venue: String(input.venue || "").trim(),
    leadUnderwriter: String(input.leadUnderwriter || "").trim(),
    sponsorStatus: String(input.sponsorStatus || "").trim(),
    cutoffAt: String(input.cutoffAt || "").trim(),
    cutoffTimeConfirmed: input.cutoffTimeConfirmed === undefined ? Boolean(input.cutoffAt) : Boolean(input.cutoffTimeConfirmed),
    cutoffSource: String(input.cutoffSource || "").trim(),
    cutoffHistory: Array.isArray(input.cutoffHistory) ? input.cutoffHistory.map(normalizeCutoffHistoryItem) : [],
    opinion: String(input.opinion || "").trim(),
    sourceText: String(input.sourceText || "").trim(),
    notes: String(input.notes || "").trim(),
    tranches: Array.isArray(input.tranches) && input.tranches.length
      ? input.tranches.map(normalizeTranche)
      : [normalizeTranche({ shortName: input.shortName })],
    resultAdvertisement: String(input.resultAdvertisement || "").trim(),
    resultConfirmed: Boolean(input.resultConfirmed || ["部分中标", "已中标", "未中标", "待缴款", "已缴款"].includes(status)),
    comprehensivePricing: Boolean(input.comprehensivePricing),
    pricingUnit: ["万元", "亿元", "元"].includes(input.pricingUnit) ? input.pricingUnit : "万元",
    afterTaxRevenue,
    ftpCost,
    netIncome: Number.isFinite(afterTaxRevenue) && Number.isFinite(ftpCost)
      ? round(afterTaxRevenue - ftpCost, 6)
      : null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function upsertProject(state, input) {
  const project = normalizeProjectRecord({ ...input, updatedAt: new Date().toISOString() });
  const projects = [...(state.projects || [])];
  const index = projects.findIndex((item) => item.id === project.id);
  if (index >= 0) projects[index] = project;
  else projects.unshift(project);
  return { ...state, projects, updatedAt: new Date().toISOString() };
}

export function removeProject(state, id) {
  return {
    ...state,
    projects: (state.projects || []).filter((project) => project.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

export function deriveProjectStatus(project) {
  const tranches = project.tranches || [];
  if (project.status === "已结束") return "已结束";
  if (!project.resultConfirmed) {
    return project.status === "已投标待结果" ? "已投标待结果" : "未投标";
  }
  if (!tranches.length) return project.status || "已投标待结果";
  const results = tranches.map((tranche) => tranche.resultStatus);
  const notWonCount = results.filter((status) => status === "未中标").length;
  const winningTranches = tranches.filter((tranche) =>
    tranche.resultStatus === "中标"
    || tranche.outsourcedBids?.some((bid) => positiveNumber(bid.winningAmountWan)),
  );
  if (winningTranches.length && winningTranches.every((tranche) => tranche.paymentCompleted)) return "已缴款";
  if (winningTranches.some((tranche) => tranche.paymentDate && !tranche.paymentCompleted)) return "待缴款";
  if (winningTranches.length && notWonCount && winningTranches.length < tranches.length) return "部分中标";
  if (winningTranches.length === tranches.length) return "已中标";
  if (notWonCount && notWonCount === tranches.length) return "未中标";
  return project.status === "已结束" ? "已结束" : "已投标待结果";
}

export function dashboardCounts(projects = [], now = new Date()) {
  const date = localDate(now);
  return {
    all: projects.length,
    dueToday: projects.filter((project) => ["未投标", "待投标"].includes(project.status) && project.cutoffAt?.slice(0, 10) === date).length,
    toBid: projects.filter((project) => ["未投标", "待投标"].includes(project.status)).length,
    awaitingResult: projects.filter((project) => project.status === "已投标待结果").length,
    won: projects.filter((project) => ["部分中标", "已中标", "待缴款", "已缴款"].includes(project.status)).length,
    notWon: projects.filter((project) => project.status === "未中标").length,
    duePayment: projects.filter((project) => project.status === "待缴款").length,
    paymentToday: projects.filter((project) =>
      project.status === "待缴款"
      && project.tranches?.some((tranche) => tranche.paymentDate === date && !tranche.paymentCompleted),
    ).length,
  };
}

export function suggestProjectCutoff(project = {}, issuer = null, referenceDate = new Date()) {
  const venue = String(project.venue || "");
  const defaultTime = EXCHANGE_VENUES.has(venue) ? "19:00" : "18:00";
  const explicit = parseExplicitCutoff(project.sourceText || "", referenceDate, defaultTime);
  if (explicit) {
    return {
      cutoffAt: explicit,
      cutoffTimeConfirmed: true,
      cutoffSource: "项目简表",
    };
  }

  const date = nextBusinessDay(referenceDate);
  const isPrivateInterbank = venue === "银行间" && issuer?.enterpriseType === "民营企业";
  const venueKnown = venue === "银行间" || EXCHANGE_VENUES.has(venue);
  return {
    cutoffAt: `${localDate(date)}T${defaultTime}`,
    cutoffTimeConfirmed: venueKnown && !isPrivateInterbank,
    cutoffSource: EXCHANGE_VENUES.has(venue) ? "交易所默认19:00" : venue === "银行间" ? "银行间默认18:00" : "默认18:00，场所待确认",
  };
}

export function updateProjectCutoff(project, cutoffAt, reason = "手工调整", confirmed = true) {
  const previous = String(project.cutoffAt || "").trim();
  const next = String(cutoffAt || "").trim();
  const history = [...(project.cutoffHistory || [])];
  if (previous && next && previous !== next) {
    history.push({
      from: previous,
      to: next,
      reason,
      changedAt: new Date().toISOString(),
    });
  }
  return normalizeProjectRecord({
    ...project,
    cutoffAt: next,
    cutoffTimeConfirmed: confirmed,
    cutoffSource: reason,
    cutoffHistory: history,
  });
}

export function buildBidResultSummary(project) {
  return buildAwardResultText(project);
}

export function buildBidPositionText(project) {
  const dual = (project.tranches || []).length > 1;
  const lines = [];
  for (const tranche of project.tranches || []) {
    lines.push(formatBidLine(project, tranche, null, dual));
    for (const outsourced of tranche.outsourcedBids || []) {
      lines.push(formatBidLine(project, tranche, outsourced, dual));
    }
  }
  return lines.filter(Boolean).join("\n");
}

export function buildAwardResultText(project) {
  const lines = [];
  for (const tranche of project.tranches || []) {
    const name = tranche.shortName || tranche.durationText || "本品种";
    if (tranche.resultStatus === "未中标") {
      lines.push(`表内未中标（${name}）`);
    } else if (positiveNumber(tranche.winningAmountWan)) {
      lines.push(`表内中标${formatWanAmount(tranche.winningAmountWan)}，${formatPricing(tranche.pricingMode, tranche.pricingRate)}，营收${formatBp(tranche.revenueBp)}`);
    }
    for (const outsourced of tranche.outsourcedBids || []) {
      if (positiveNumber(outsourced.winningAmountWan)) {
        const prefix = outsourced.managerName ? `${outsourced.managerName}委外` : "委外";
        lines.push(`${prefix}中标${formatWanAmount(outsourced.winningAmountWan)}，${formatPricing(outsourced.pricingMode, outsourced.pricingRate)}`);
      }
    }
  }
  const report = lines.join("\n");
  return project.resultAdvertisement
    ? `${project.resultAdvertisement.trim()}${report ? `\n\n${report}` : ""}`
    : report;
}

export function applyIssuanceAdvertisement(project, advertisement, referenceDate = new Date()) {
  const parsed = parseIssuanceAdvertisement(advertisement, referenceDate);
  const next = normalizeProjectRecord({ ...project, resultAdvertisement: advertisement });
  if (!next.issuerName && parsed.issuerName) next.issuerName = parsed.issuerName;
  next.tranches = next.tranches.map((tranche, index) => {
    const match = parsed.items.find((item) => item.shortName === tranche.shortName)
      || parsed.items[index]
      || {};
    return applyAutoAward(normalizeTranche({
      ...tranche,
      securityCode: match.securityCode || tranche.securityCode,
      durationText: match.durationText || tranche.durationText,
      issueScale: match.issueScale ?? tranche.issueScale,
      fullMarketMultiple: match.fullMarketMultiple ?? tranche.fullMarketMultiple,
      marginalMultiple: match.marginalMultiple ?? tranche.marginalMultiple,
      winningRate: match.couponRate ?? tranche.winningRate,
      paymentDate: match.paymentDate || tranche.paymentDate,
      startDate: match.startDate || tranche.startDate,
      allocationNote: match.allocationNote || tranche.allocationNote,
    }), next);
  });
  return next;
}

export function parseIssuanceAdvertisement(text, referenceDate = new Date()) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  const headers = [...normalized.matchAll(/【([^】]+)】/g)];
  const items = [];
  if (headers.length) {
    headers.forEach((header, index) => {
      const block = normalized.slice(header.index, headers[index + 1]?.index ?? normalized.length);
      items.push(parseAdvertisementBlock(block, header[1], referenceDate));
    });
  } else if (normalized) {
    items.push(parseAdvertisementBlock(normalized, "", referenceDate));
  }
  return { issuerName: parseIssuerName(normalized), items };
}

function buildTranches(project) {
  const names = project.shortNames?.length ? project.shortNames : [project.shortName];
  const durations = project.durationParts?.length ? project.durationParts : [project.durationText];
  const ranges = project.inquiryRanges?.length
    ? project.inquiryRanges
    : [{ low: project.inquiryLow, high: project.inquiryHigh }];
  const guidancePrices = project.guidancePrices?.length
    ? project.guidancePrices
    : [project.guidancePrice].filter((value) => Number.isFinite(numberOrNull(value)));
  const count = Math.max(names.length, durations.length, ranges.length, 1);
  return Array.from({ length: count }, (_, index) => {
    const pricingRate = numberOrNull(guidancePrices[index] ?? guidancePrices[0]);
    return normalizeTranche({
      shortName: names[index] || names[0] || project.shortName,
      durationText: durations[index] || "",
      inquiryLow: ranges[index]?.low,
      inquiryHigh: ranges[index]?.high,
      suggestedRatio: project.suggestedRatios?.[index] ?? project.suggestedRatio,
      pricingMode: Number.isFinite(pricingRate) ? "综合定价" : "未综",
      pricingRate,
    });
  });
}

function normalizeTranche(input = {}) {
  const legacyWinningAmount = numberOrNull(input.winningAmount);
  const bidLevels = normalizeBidLevels(input);
  const primaryBid = bidLevels.find(hasAnyBidLevelValue) || {};
  return {
    id: input.id || crypto.randomUUID(),
    shortName: String(input.shortName || "").trim(),
    durationText: String(input.durationText || "").trim(),
    inquiryLow: numberOrNull(input.inquiryLow),
    inquiryHigh: numberOrNull(input.inquiryHigh),
    suggestedRatio: numberOrNull(input.suggestedRatio),
    bidAction: BID_ACTIONS.has(input.bidAction) ? input.bidAction : "",
    bidLevels,
    bidRate: numberOrNull(primaryBid.bidRate),
    bidAmount: numberOrNull(primaryBid.bidAmount),
    resultStatus: ["待出结果", "中标", "未中标"].includes(input.resultStatus) ? input.resultStatus : "待出结果",
    winningRate: numberOrNull(input.winningRate),
    winningAmountWan: numberOrNull(input.winningAmountWan) ?? (Number.isFinite(legacyWinningAmount) ? legacyWinningAmount * 10000 : null),
    pricingMode: ["综合定价", "未综"].includes(input.pricingMode) ? input.pricingMode : "未综",
    pricingRate: numberOrNull(input.pricingRate),
    revenueBp: numberOrNull(input.revenueBp),
    outsourcedBids: Array.isArray(input.outsourcedBids) ? input.outsourcedBids.map(normalizeOutsourcedBid) : [],
    securityCode: String(input.securityCode || "").trim(),
    issueScale: numberOrNull(input.issueScale),
    fullMarketMultiple: numberOrNull(input.fullMarketMultiple),
    marginalMultiple: numberOrNull(input.marginalMultiple),
    paymentDate: String(input.paymentDate || "").trim(),
    startDate: String(input.startDate || "").trim(),
    allocationNote: String(input.allocationNote || "").trim(),
    paymentCompleted: Boolean(input.paymentCompleted),
  };
}

function normalizeBidLevels(input = {}) {
  const source = Array.isArray(input.bidLevels) && input.bidLevels.length
    ? input.bidLevels
    : [];
  const levels = source.map(normalizeBidLevel);
  const legacyRate = numberOrNull(input.bidRate);
  const legacyAmount = numberOrNull(input.bidAmount);
  if (!levels.length && (Number.isFinite(legacyRate) || Number.isFinite(legacyAmount))) {
    levels.push(normalizeBidLevel({ bidRate: legacyRate, bidAmount: legacyAmount }));
  }
  return levels.length ? levels : [normalizeBidLevel({})];
}

function normalizeBidLevel(input = {}) {
  return {
    id: input.id || crypto.randomUUID(),
    bidRate: numberOrNull(input.bidRate),
    bidAmount: numberOrNull(input.bidAmount),
  };
}

function normalizeCutoffHistoryItem(input = {}) {
  return {
    from: String(input.from || "").trim(),
    to: String(input.to || "").trim(),
    reason: String(input.reason || "").trim(),
    changedAt: input.changedAt || new Date().toISOString(),
  };
}

function normalizeOutsourcedBid(input = {}) {
  return {
    id: input.id || crypto.randomUUID(),
    managerName: String(input.managerName || "").trim(),
    bidRate: numberOrNull(input.bidRate),
    bidAmount: numberOrNull(input.bidAmount),
    winningAmountWan: numberOrNull(input.winningAmountWan),
    pricingMode: ["综合定价", "未综"].includes(input.pricingMode) ? input.pricingMode : "未综",
    pricingRate: numberOrNull(input.pricingRate),
  };
}

function formatBidLine(project, tranche, participation, dual) {
  const isOutsourced = Boolean(participation);
  const bidLevels = isOutsourced ? [participation].filter(hasCompleteBidLevel) : ownBidLevels(tranche);
  if (!bidLevels.length) return "";
  const prefix = formatBidPrefix(project, tranche, participation);
  const duration = dual && tranche.durationText ? `，${formatDuration(tranche.durationText)}期` : "";
  const bids = bidLevels
    .map((bid) => `${formatPercent(bid.bidRate)}投${formatNumber(bid.bidAmount)}亿`)
    .join("，");
  const ratio = formatBidRatio(tranche, dual, !isOutsourced && bidLevels.length > 1);
  const underwriter = shouldShowUnderwriter(project, tranche, isOutsourced)
    ? `，主承${project.leadUnderwriter || "【待补主承】"}`
    : "";
  return `${prefix}${tranche.shortName || project.shortName}${duration}，${bids}${ratio}${underwriter}`;
}

function formatBidPrefix(project, tranche, participation) {
  if (participation) {
    return `【委外投标${participation.managerName ? `：${participation.managerName}` : ""}】`;
  }
  const action = BID_ACTIONS.has(tranche.bidAction)
    ? tranche.bidAction
    : project.venue === "银行间" && project.sponsorStatus === "非我行主承"
      ? "参团+投标"
      : "投标";
  return `【${action}】`;
}

function formatBidRatio(tranche, dual, aggregate) {
  const prefix = aggregate ? "合计不超" : "不超";
  const duration = dual && tranche.durationText ? `${formatDuration(tranche.durationText)}期的` : "";
  const ratio = Number.isFinite(numberOrNull(tranche.suggestedRatio))
    ? `${formatNumber(tranche.suggestedRatio)}%`
    : "【待补比例】";
  return `，${prefix}${duration}${ratio}`;
}

function shouldShowUnderwriter(project, tranche, isOutsourced) {
  return !isOutsourced
    && project.venue === "银行间"
    && (project.sponsorStatus === "非我行主承" || ["改标", "参团+投标"].includes(tranche.bidAction));
}

function ownBidLevels(tranche = {}) {
  const source = Array.isArray(tranche.bidLevels) && tranche.bidLevels.length
    ? tranche.bidLevels
    : [{ bidRate: tranche.bidRate, bidAmount: tranche.bidAmount }];
  return source.map(normalizeBidLevel).filter(hasCompleteBidLevel);
}

function hasCompleteBidLevel(level = {}) {
  const rate = numberOrNull(level.bidRate);
  const amount = numberOrNull(level.bidAmount);
  return Number.isFinite(rate) && Number.isFinite(amount) && amount > 0;
}

function hasAnyBidLevelValue(level = {}) {
  return Number.isFinite(numberOrNull(level.bidRate)) || Number.isFinite(numberOrNull(level.bidAmount));
}

function parseAdvertisementBlock(block, headerText, referenceDate) {
  const headerParts = headerText.trim().split(/\s+/);
  const labeledShortName = block.match(/简称(?:代码)?[：:\s]*([^\s（(，,]+)/)?.[1] || "";
  const bodyShortName = block.match(/(?:【发行结果】\s*)?([0-9]{2}[A-Za-z0-9\u4e00-\u9fa5]+(?:SCP|CP|MTN|PPN)?\d*[A-Z]?)/i)?.[1] || "";
  const shortName = headerParts.find((part) => /^\d{2}\S+/.test(part)) || labeledShortName || bodyShortName;
  const securityCode = headerParts.find((part) => /^\d{6,9}(?:\.[A-Z]{2})?$/.test(part))
    || block.match(/简称(?:代码)?[：:][^\n（(]*[（(]\s*([0-9]{6,9}(?:\.[A-Z]{2})?)/i)?.[1]
    || block.match(/代码[：:]\s*([0-9]{6,9}(?:\.[A-Z]{2})?)/i)?.[1]
    || "";
  const issueScale = numberFrom(block, /(?:发行)?规模[：:，,\s]*(\d+(?:\.\d+)?)\s*亿/);
  const fullMarketMultiple = numberFrom(block, /全场倍数[：:，,\s]*(\d+(?:\.\d+)?)\s*倍/);
  const marginalMultiple = numberFrom(block, /(?:边际倍数|边际)[：:，,\s]*(\d+(?:\.\d+)?)\s*倍/);
  const couponRate = numberFrom(block, /(?:票面利率|票面)[：:，,\s]*(\d+(?:\.\d+)?)\s*%/);
  const durationText = block.match(/(?:债券)?期限[：:，,\s]*([^，,\n]+?)(?=\s*[，,]?\s*(?:规模|发行规模|票面|全场倍数|缴款|$))/)?.[1]?.trim() || "";
  const allocationNote = block.includes("全部回拨") ? block.match(/全部回拨至[^\n，,]*/)?.[0] || "全部回拨" : "";
  return {
    shortName,
    securityCode,
    issueScale,
    fullMarketMultiple,
    marginalMultiple,
    couponRate,
    durationText,
    paymentDate: parseLabeledDate(block, "缴款", referenceDate),
    startDate: parseLabeledDate(block, "起息", referenceDate),
    allocationNote,
  };
}

function applyAutoAward(tranche, project = {}) {
  const next = { ...tranche };
  const forcedNoIssue = /全部回拨/.test(next.allocationNote);
  const estimatedOwn = forcedNoIssue
    ? 0
    : estimateOwnWinningAmountWan(next);

  if (estimatedOwn !== null) {
    next.winningAmountWan = estimatedOwn;
    next.resultStatus = estimatedOwn > 0 ? "中标" : "未中标";
    if (estimatedOwn > 0 && Number.isFinite(numberOrNull(next.winningRate)) && Number.isFinite(numberOrNull(project.ftpCost))) {
      next.revenueBp = calculateRevenueBp(next.winningRate, project.ftpCost);
    }
  }

  next.outsourcedBids = (next.outsourcedBids || []).map((outsourced) => {
    const estimatedOutsourced = forcedNoIssue
      ? 0
      : estimateWinningAmountWan(outsourced.bidRate, outsourced.bidAmount, next.winningRate, next.marginalMultiple);
    if (estimatedOutsourced === null) return outsourced;
    return {
      ...outsourced,
      winningAmountWan: estimatedOutsourced,
      pricingMode: next.pricingMode,
      pricingRate: next.pricingRate,
    };
  });

  return next;
}

function estimateOwnWinningAmountWan(tranche) {
  const levels = ownBidLevels(tranche);
  if (!levels.length) return null;
  const estimates = levels.map((level) =>
    estimateWinningAmountWan(level.bidRate, level.bidAmount, tranche.winningRate, tranche.marginalMultiple),
  );
  if (estimates.some((value) => value === null)) return null;
  return round(estimates.reduce((sum, value) => sum + value, 0), 2);
}

function estimateWinningAmountWan(bidRate, bidAmountYi, couponRate, marginalMultiple) {
  const rate = numberOrNull(bidRate);
  const amountYi = numberOrNull(bidAmountYi);
  const coupon = numberOrNull(couponRate);
  if (!Number.isFinite(rate) || !Number.isFinite(amountYi) || amountYi <= 0 || !Number.isFinite(coupon)) return null;
  if (rate - coupon > RATE_EPSILON) return 0;
  const isMarginal = Math.abs(rate - coupon) <= RATE_EPSILON;
  const marginal = numberOrNull(marginalMultiple);
  const divisor = isMarginal && Number.isFinite(marginal) && marginal > 0
    ? marginal
    : 1;
  return round((amountYi / divisor) * 10000, 2);
}

function calculateRevenueBp(winningRate, ftpCost) {
  return round(numberOrNull(winningRate) * 75 - numberOrNull(ftpCost), 2);
}

function parseIssuerName(text) {
  return text.match(/^([^\n。；;]+?(?:集团|公司|有限责任公司|股份有限公司))20\d{2}/m)?.[1]?.trim() || "";
}

function parseLabeledDate(text, label, referenceDate) {
  const line = text.match(new RegExp(`${label}(?:日期)?[：:\\s]*([^\\n，,]+)`))?.[1] || "";
  const iso = line.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const monthDay = line.match(/(?:(\d{1,2})月)?(\d{1,2})日/)
    || text.match(new RegExp(`(?:(\\d{1,2})月)?(\\d{1,2})日${label}`));
  return monthDay
    ? inferPaymentDate(Number(monthDay[2]), monthDay[1] ? Number(monthDay[1]) : null, referenceDate)
    : "";
}

function inferPaymentDate(day, month, referenceDate) {
  const reference = new Date(referenceDate);
  let year = reference.getFullYear();
  let targetMonth = month || (day < reference.getDate() ? reference.getMonth() + 2 : reference.getMonth() + 1);
  if (targetMonth > 12) {
    targetMonth -= 12;
    year += 1;
  }
  if (month && month < reference.getMonth() + 1) year += 1;
  return `${year}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseExplicitCutoff(text, referenceDate, defaultTime) {
  const normalized = String(text || "");
  const relevantLine = normalized.split(/\r?\n/).find((line) => /(截标|簿记)/.test(line)) || "";
  if (!relevantLine) return "";
  const timeMatch = relevantLine.match(/([01]?\d|2[0-3])[:：](\d{2})/);
  const time = timeMatch ? `${String(timeMatch[1]).padStart(2, "0")}:${timeMatch[2]}` : defaultTime;
  const iso = relevantLine.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}T${time}`;
  const monthDay = relevantLine.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDay) {
    let year = new Date(referenceDate).getFullYear();
    if (Number(monthDay[1]) < new Date(referenceDate).getMonth() + 1) year += 1;
    return `${year}-${String(monthDay[1]).padStart(2, "0")}-${String(monthDay[2]).padStart(2, "0")}T${time}`;
  }
  const relative = relevantLine.match(/(今天|今日|明天|明日)/)?.[1];
  if (relative) {
    const date = new Date(referenceDate);
    if (["明天", "明日"].includes(relative)) date.setDate(date.getDate() + 1);
    return `${localDate(date)}T${time}`;
  }
  return timeMatch ? `${localDate(nextBusinessDay(referenceDate))}T${time}` : "";
}

function nextBusinessDay(referenceDate) {
  const date = new Date(referenceDate);
  date.setDate(date.getDate() + 1);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return date;
}

function numberFrom(text, pattern) {
  const value = text.match(pattern)?.[1];
  return value === undefined ? null : Number(value);
}

function formatPricing(mode, rate) {
  return mode === "综合定价" && Number.isFinite(numberOrNull(rate))
    ? `综合定价至${formatPercent(rate)}`
    : "未综";
}

function formatBp(value) {
  return Number.isFinite(numberOrNull(value)) ? `${formatNumber(value)}BP` : "【待补】BP";
}

function formatWanAmount(value) {
  const amountWan = numberOrNull(value);
  if (!Number.isFinite(amountWan)) return "【待补】";
  return amountWan >= 10000
    ? `${formatNumber(amountWan / 10000)}亿`
    : `${formatNumber(amountWan)}万`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

function formatDuration(value) {
  return String(value || "").replace(/期$/, "");
}

function formatNumber(value) {
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = numberOrNull(value);
  return Number.isFinite(number) && number > 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function localDate(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
