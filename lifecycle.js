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
export const FTP_TENORS = [
  { key: "m3", label: "3个月", years: 0.25 },
  { key: "m4", label: "4个月", years: 4 / 12 },
  { key: "m6", label: "6个月", years: 0.5 },
  { key: "m9", label: "9个月", years: 0.75 },
  { key: "y1", label: "1年", years: 1 },
  { key: "y2", label: "2年", years: 2 },
  { key: "y3", label: "3年", years: 3 },
  { key: "y4", label: "4年", years: 4 },
  { key: "y5", label: "5年", years: 5 },
  { key: "y7", label: "7年", years: 7 },
  { key: "y10", label: "10年", years: 10 },
];

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
    issuerName: issuer?.legalName || project.issuerName || "",
    subjectRating: project.subjectRating || issuer?.subjectRating || "",
    ratingAgency: project.ratingAgency || issuer?.ratingAgency || "",
    hiddenRating: project.hiddenRating || issuer?.hiddenRating || "",
    branch: project.branch || issuer?.defaultBranch || "",
    venue: project.venue || "",
    offeringType: project.offeringType || "",
    leadUnderwriter: project.leadUnderwriter || "",
    sponsorStatus: project.sponsorStatus || "",
    cutoffAt: cutoff.cutoffAt,
    cutoffTimeConfirmed: cutoff.cutoffTimeConfirmed,
    cutoffSource: cutoff.cutoffSource,
    cutoffHistory: input.cutoffHistory || [],
    opinion: generated?.opinion || "",
    sourceText: project.sourceText || "",
    issueScale: project.issueScale,
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
  const normalized = {
    id: input.id || crypto.randomUUID(),
    status,
    shortName: String(input.shortName || "").trim(),
    issuerId: String(input.issuerId || "").trim(),
    issuerName: String(input.issuerName || "").trim(),
    subjectRating: String(input.subjectRating || "").trim().toUpperCase(),
    ratingAgency: String(input.ratingAgency || "").trim(),
    hiddenRating: String(input.hiddenRating || "").trim().toUpperCase(),
    branch: String(input.branch || "").trim(),
    venue: String(input.venue || "").trim(),
    offeringType: ["公募", "私募", "公私募"].includes(input.offeringType) ? input.offeringType : "",
    leadUnderwriter: String(input.leadUnderwriter || "").trim(),
    sponsorStatus: String(input.sponsorStatus || "").trim(),
    cutoffAt: String(input.cutoffAt || "").trim(),
    cutoffTimeConfirmed: input.cutoffTimeConfirmed === undefined ? Boolean(input.cutoffAt) : Boolean(input.cutoffTimeConfirmed),
    cutoffSource: String(input.cutoffSource || "").trim(),
    cutoffHistory: Array.isArray(input.cutoffHistory) ? input.cutoffHistory.map(normalizeCutoffHistoryItem) : [],
    opinion: String(input.opinion || "").trim(),
    sourceText: String(input.sourceText || "").trim(),
    issueScale: numberOrNull(input.issueScale),
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
  return fillMissingDefaultPaymentDates(normalized);
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

export function applyGuidancePricing(project, guidancePrices = []) {
  const prices = (Array.isArray(guidancePrices) ? guidancePrices : [guidancePrices])
    .map(numberOrNull)
    .filter(Number.isFinite);
  if (!prices.length) return project;

  const normalized = normalizeProjectRecord(project);
  let changed = false;
  const tranches = normalized.tranches.map((tranche, index) => {
    const pricingRate = numberOrNull(prices[index] ?? prices[0]);
    if (!Number.isFinite(pricingRate) || Number.isFinite(numberOrNull(tranche.pricingRate))) return tranche;
    changed = true;
    return {
      ...tranche,
      pricingMode: "综合定价",
      pricingRate,
    };
  });

  return changed ? normalizeProjectRecord({ ...normalized, tranches }) : project;
}

export function deriveProjectStatus(project, referenceDate = new Date()) {
  const tranches = project.tranches || [];
  const date = referenceDateKey(referenceDate);
  if (project.status === "已结束") return "已结束";
  if (!project.resultConfirmed) {
    return project.status === "已投标待结果" ? "已投标待结果" : "未投标";
  }
  if (!tranches.length) return project.status || "已投标待结果";
  const results = tranches.map((tranche) => tranche.resultStatus);
  const notWonCount = results.filter((status) => status === "未中标").length;
  const winningTranches = tranches.filter(isWinningTranche);
  if (winningTranches.length && winningTranches.every((tranche) => tranche.paymentCompleted)) return "已缴款";
  if (winningTranches.some((tranche) => trancheNeedsPayment(tranche, date))) return "待缴款";
  if (winningTranches.length && notWonCount && winningTranches.length < tranches.length) return "部分中标";
  if (winningTranches.length === tranches.length) return "已中标";
  if (notWonCount && notWonCount === tranches.length) return "未中标";
  return project.status === "已结束" ? "已结束" : "已投标待结果";
}

export function trancheNeedsPayment(tranche, referenceDate = new Date()) {
  return isWinningTranche(tranche)
    && Boolean(tranche.paymentDate)
    && !tranche.paymentCompleted;
}

export function dashboardCounts(projects = [], now = new Date()) {
  const date = localDate(now);
  const duePaymentProjects = projects.filter((project) =>
    project.resultConfirmed && project.tranches?.some((tranche) => trancheNeedsPayment(tranche, date)),
  );
  return {
    all: projects.length,
    dueToday: projects.filter((project) => ["未投标", "待投标"].includes(project.status) && project.cutoffAt?.slice(0, 10) === date).length,
    toBid: projects.filter((project) => ["未投标", "待投标"].includes(project.status)).length,
    awaitingResult: projects.filter((project) => project.status === "已投标待结果").length,
    won: projects.filter((project) => ["部分中标", "已中标", "待缴款", "已缴款"].includes(project.status)).length,
    notWon: projects.filter((project) => project.status === "未中标").length,
    duePayment: duePaymentProjects.length,
    paymentToday: projects.filter((project) =>
      project.resultConfirmed
      && project.tranches?.some((tranche) => tranche.paymentDate === date && trancheNeedsPayment(tranche)),
    ).length,
  };
}

function isWinningTranche(tranche = {}) {
  return tranche.resultStatus === "中标"
    || positiveNumber(tranche.winningAmountWan)
    || tranche.outsourcedBids?.some((bid) => positiveNumber(bid.winningAmountWan));
}

function fillMissingDefaultPaymentDates(project) {
  if (!project.cutoffAt) return project;
  const paymentDate = inferDefaultPaymentDate(project, project.cutoffAt);
  if (!paymentDate) return project;
  let changed = false;
  const tranches = project.tranches.map((tranche) => {
    if (!isWinningTranche(tranche) || tranche.paymentDate || tranche.paymentCompleted) return tranche;
    changed = true;
    return { ...tranche, paymentDate };
  });
  return changed ? { ...project, tranches } : project;
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
  const next = {
    ...normalizeProjectRecord({ ...project, resultAdvertisement: advertisement }),
    ftpCurve: project.ftpCurve,
  };
  if (!next.issuerName && parsed.issuerName) next.issuerName = parsed.issuerName;
  next.tranches = next.tranches.map((tranche, index) => {
    const match = findAdvertisementMatch(next.tranches, tranche, index, parsed.items);
    const awarded = applyAutoAward(normalizeTranche({
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
    if (!awarded.paymentDate && isWinningTranche(awarded)) {
      awarded.paymentDate = inferDefaultPaymentDate(next, referenceDate);
    }
    return awarded;
  });
  return next;
}

export function parseIssuanceAdvertisement(text, referenceDate = new Date()) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  const headers = [...normalized.matchAll(/【([^】]+)】/g)]
    .filter((header) => isAdvertisementBlockHeader(header[1]));
  const items = [];
  if (headers.length) {
    headers.forEach((header, index) => {
      const block = normalized.slice(header.index, headers[index + 1]?.index ?? normalized.length);
      items.push(...parseAdvertisementBlockItems(block, header[1], referenceDate));
    });
  } else if (normalized) {
    items.push(...parseAdvertisementBlockItems(normalized, "", referenceDate));
  }
  return { issuerName: parseIssuerName(normalized), items };
}

function parseAdvertisementBlockItems(block, headerText, referenceDate) {
  const numberedRows = splitNumberedAdvertisementRows(block);
  if (numberedRows.length > 1) {
    return numberedRows.map((itemBlock) => parseAdvertisementBlock(itemBlock, headerText, referenceDate));
  }
  return [parseAdvertisementBlock(block, headerText, referenceDate)];
}

function splitNumberedAdvertisementRows(block) {
  const lines = String(block || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rowIndexes = [];
  lines.forEach((line, index) => {
    if (/^(?:\d+[.、．)]|[（(]\d+[）)])\s*[0-9]{2}\S+/.test(line)) {
      rowIndexes.push(index);
    }
  });
  if (rowIndexes.length <= 1) return [];

  const leadingSharedLines = lines.slice(0, rowIndexes[0]);
  const trailingSharedStart = rowIndexes.at(-1) + 1;
  const trailingSharedLines = lines.slice(trailingSharedStart);
  return rowIndexes.map((lineIndex, index) => {
    const nextIndex = rowIndexes[index + 1] ?? trailingSharedStart;
    const rowLines = lines.slice(lineIndex, nextIndex);
    const rowText = rowLines.join("\n").replace(/^(?:\d+[.、．)]|[（(]\d+[）)])\s*/, "");
    return [rowText, ...leadingSharedLines, ...trailingSharedLines].join("\n");
  });
}

function isAdvertisementBlockHeader(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(?:规模|发行规模|期限|债券期限|利率|票面|票面利率|全场|全场倍数|边际|边际倍数|起息|起息日期|缴款|缴款日期|代码|简称|简称代码)$/i.test(text)) {
    return false;
  }
  return /^(?:发行结果|结果|截标通知|簿记结果)/.test(text)
    || /^\d{2}\S+/.test(text);
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
  const winningAmountWan = numberOrNull(input.winningAmountWan) ?? (Number.isFinite(legacyWinningAmount) ? legacyWinningAmount * 10000 : null);
  const inputResultStatus = ["待出结果", "中标", "未中标"].includes(input.resultStatus) ? input.resultStatus : "待出结果";
  const resultStatus = inputResultStatus === "待出结果" && positiveNumber(winningAmountWan)
    ? "中标"
    : inputResultStatus;
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
    resultStatus,
    winningRate: numberOrNull(input.winningRate),
    winningAmountWan,
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
  if (!levels.some(hasAnyBidLevelValue) && (Number.isFinite(legacyRate) || Number.isFinite(legacyAmount))) {
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
    && project.sponsorStatus === "非我行主承";
}

function ownBidLevels(tranche = {}) {
  const source = Array.isArray(tranche.bidLevels) && tranche.bidLevels.length
    ? tranche.bidLevels
    : [{ bidRate: tranche.bidRate, bidAmount: tranche.bidAmount }];
  const levels = source.map(normalizeBidLevel).filter(hasCompleteBidLevel);
  if (levels.length) return levels;
  const legacyLevel = normalizeBidLevel({ bidRate: tranche.bidRate, bidAmount: tranche.bidAmount });
  return hasCompleteBidLevel(legacyLevel) ? [legacyLevel] : [];
}

function hasCompleteBidLevel(level = {}) {
  const rate = numberOrNull(level.bidRate);
  const amount = numberOrNull(level.bidAmount);
  return Number.isFinite(rate) && Number.isFinite(amount) && amount > 0;
}

function hasAnyBidLevelValue(level = {}) {
  return Number.isFinite(numberOrNull(level.bidRate)) || Number.isFinite(numberOrNull(level.bidAmount));
}

function findAdvertisementMatch(tranches, tranche, index, items = []) {
  const exact = items.find((item) => item.shortName && item.shortName === tranche.shortName);
  if (exact) return exact;

  const single = items.length === 1 ? items[0] : null;
  if (single) {
    const shortNameMatches = !single.shortName || single.shortName === stripVarietySuffix(tranche.shortName);
    const singleDuration = durationMatchKey(single.durationText);
    if (singleDuration) {
      if (shortNameMatches && singleDuration === durationMatchKey(tranche.durationText)) return single;
      if (tranches.length > 1 && shortNameMatches) return {};
    }
    if (tranches.length === 1 && shortNameMatches) return single;
  }

  return items[index] || {};
}

function stripVarietySuffix(shortName) {
  return String(shortName || "").trim().replace(/((?:SCP|CP|MTN|PPN)\d{3})[A-Z]$/i, "$1");
}

function durationMatchKey(value) {
  return String(value || "").replace(/\s+/g, "").replace(/期$/, "").toUpperCase();
}

function parseAdvertisementBlock(block, headerText, referenceDate) {
  const headerParts = headerText.trim().split(/\s+/);
  const labeledShortName = block.match(/简称(?:代码)?[：:\s]*([^\s（(，,]+)/)?.[1] || "";
  const bodyShortName = extractAdvertisementShortName(headerText, block);
  const shortName = headerParts.find((part) => /^\d{2}\S+/.test(part)) || labeledShortName || bodyShortName;
  const securityCode = headerParts.find((part) => /^[A-Z]?\d{6,9}(?:\.[A-Z]{2})?$/.test(part))
    || extractAdvertisementSecurityCode(headerText)
    || block.match(/简称(?:代码)?[：:][^\n（(]*[（(]\s*([0-9]{6,9}(?:\.[A-Z]{2})?)/i)?.[1]
    || block.match(/代码[：:]\s*([A-Z]?\d{6,9}(?:\.[A-Z]{2})?)/i)?.[1]
    || "";
  const issueScale = numberFrom(block, /(?:发行)?规模(?:调整为|调整至|为|[】：:，,\s])*(?:不超过|约|合计)?\s*(\d+(?:\.\d+)?)\s*亿/)
    ?? numberFrom(block, /(?:^|[，,\s])(\d+(?:\.\d+)?)\s*亿(?:元)?(?=[，,\s]|$)/);
  const fullMarketMultiple = numberFrom(block, /全场倍数[：:，,\s]*(\d+(?:\.\d+)?)\s*倍/)
    ?? numberFrom(block, /全场[：:，,\s]*(\d+(?:\.\d+)?)\s*倍/);
  const marginalMultiple = numberFrom(block, /(?:边际倍数|边际)[：:，,\s]*(\d+(?:\.\d+)?)\s*倍/);
  const couponRate = numberFrom(block, /(?:票面利率|票面)[】：:，,\s]*(\d+(?:\.\d+)?)\s*%/)
    ?? numberFrom(block, /(?:边际利率|边际)[】：:，,\s]*(\d+(?:\.\d+)?)\s*%/)
    ?? numberFrom(block, /(?:^|[\n【\s])利率[】：:，,\s]*(\d+(?:\.\d+)?)\s*%/);
  const durationText = block.match(/(?:债券)?期限[】：:，,\s]*([^，,\n]+?)(?=\s*[，,]?\s*(?:【|规模|发行规模|票面|利率|全场倍数|缴款|$))/)?.[1]?.trim()
    || block.match(/(?:^|[，,\s])(\d+(?:\.\d+)?\s*(?:D|天|日|M|月|Y|年)(?:期)?)(?=[，,\s]|$)/i)?.[1]?.replace(/\s+/g, "").trim()
    || "";
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

function extractAdvertisementShortName(headerText, block) {
  const source = `${headerText}\n${block}`;
  const explicit = source.match(/(?:简称(?:代码)?|债券简称)[：:\s]*([0-9]{2}[A-Za-z0-9\u4e00-\u9fa5]+(?:SCP|CP|MTN|PPN)?\d*[A-Z]?)/i)?.[1];
  if (explicit) return explicit;
  const resultHeader = headerText.match(/(?:结果|发行结果|截标通知)[-_：:\s]*([0-9]{2}[A-Za-z0-9\u4e00-\u9fa5]+(?:SCP|CP|MTN|PPN)?\d*[A-Z]?)/i)?.[1];
  if (resultHeader) return resultHeader;
  return source.match(/([0-9]{2}[A-Za-z0-9\u4e00-\u9fa5]+(?:SCP|CP|MTN|PPN)?\d*[A-Z]?)/i)?.[1] || "";
}

function extractAdvertisementSecurityCode(headerText) {
  return headerText.match(/(?:^|[-_\s])([A-Z]?\d{6,9}(?:\.[A-Z]{2})?)(?=$|[-_\s])/i)?.[1] || "";
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
    const ftpCost = resolveFtpCost(project, next);
    if (estimatedOwn > 0 && Number.isFinite(numberOrNull(next.winningRate)) && Number.isFinite(ftpCost)) {
      next.revenueBp = calculateRevenueBp(next.winningRate, ftpCost);
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
  if (!levels.length) {
    return tranche.resultStatus === "待出结果" && Number.isFinite(numberOrNull(tranche.winningRate)) ? 0 : null;
  }
  const estimated = estimateWinningLevelsWan(levels, tranche.winningRate, tranche.marginalMultiple, trancheAwardCapWan(tranche));
  return estimated === null ? null : roundToNearest(estimated, 1000);
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

function estimateWinningLevelsWan(levels = [], couponRate, marginalMultiple, capWan = null) {
  const coupon = numberOrNull(couponRate);
  if (!Number.isFinite(coupon)) return null;
  const cap = numberOrNull(capWan);
  let remainingCap = Number.isFinite(cap) && cap > 0 ? cap : Infinity;
  let total = 0;
  for (const level of levels) {
    const rate = numberOrNull(level.bidRate);
    const amountYi = numberOrNull(level.bidAmount);
    if (!Number.isFinite(rate) || !Number.isFinite(amountYi) || amountYi <= 0) return null;
    if (rate - coupon > RATE_EPSILON) continue;
    if (remainingCap <= 0) continue;

    const requestedWan = amountYi * 10000;
    const cappedWan = Math.min(requestedWan, remainingCap);
    const isMarginal = Math.abs(rate - coupon) <= RATE_EPSILON;
    const marginal = numberOrNull(marginalMultiple);
    const divisor = isMarginal && Number.isFinite(marginal) && marginal > 0
      ? marginal
      : 1;
    total += cappedWan / divisor;
    remainingCap -= cappedWan;
  }
  return round(total, 2);
}

function trancheAwardCapWan(tranche = {}) {
  const issueScale = numberOrNull(tranche.issueScale);
  const ratio = numberOrNull(tranche.suggestedRatio);
  if (!Number.isFinite(issueScale) || issueScale <= 0 || !Number.isFinite(ratio) || ratio <= 0) return null;
  return round(issueScale * 10000 * ratio / 100, 2);
}

export function calculateFtpForDuration(durationText, ftpCurve = {}) {
  const years = durationYearsForFtp(durationText);
  if (!Number.isFinite(years)) return null;
  const target = Math.min(Math.max(years, FTP_TENORS[0].years), FTP_TENORS.at(-1).years);
  const exact = FTP_TENORS.find((tenor) => Math.abs(tenor.years - target) < 0.000001);
  if (exact) return normalizeFtpRatePercent(ftpCurve[exact.key]);

  const upperIndex = FTP_TENORS.findIndex((tenor) => tenor.years > target);
  if (upperIndex <= 0) return null;
  const lower = FTP_TENORS[upperIndex - 1];
  const upper = FTP_TENORS[upperIndex];
  const lowerValue = normalizeFtpRatePercent(ftpCurve[lower.key]);
  const upperValue = normalizeFtpRatePercent(ftpCurve[upper.key]);
  if (!Number.isFinite(lowerValue) || !Number.isFinite(upperValue)) return null;
  const weight = (target - lower.years) / (upper.years - lower.years);
  return round(lowerValue + (upperValue - lowerValue) * weight, 4);
}

function resolveFtpCost(project, tranche) {
  const curveFtp = calculateFtpForDuration(tranche.durationText, project.ftpCurve);
  return Number.isFinite(curveFtp) ? curveFtp : normalizeFtpRatePercent(project.ftpCost);
}

function calculateRevenueBp(winningRate, ftpCost) {
  return round(numberOrNull(winningRate) * 100 * 0.9366 - numberOrNull(ftpCost) * 100, 2);
}

function durationYearsForFtp(durationText) {
  const text = String(durationText || "").trim().toUpperCase().replace(/期$/, "");
  if (!text) return null;
  const firstPart = text.split("/")[0].trim();
  const unit = firstPart.match(/(D|天|日|M|月|Y|年)/i)?.[1];
  if (!unit) return null;
  const firstSegment = firstPart.split("+")[0];
  const value = Number(firstSegment.match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(value)) return null;
  if (/^(D|天|日)$/i.test(unit)) return value / 365;
  if (/^(M|月)$/i.test(unit)) return value / 12;
  return value;
}

function parseIssuerName(text) {
  return text.match(/^([^\n。；;]+?(?:集团|公司|有限责任公司|股份有限公司))20\d{2}/m)?.[1]?.trim() || "";
}

function parseLabeledDate(text, label, referenceDate) {
  const line = text.match(new RegExp(`${label}(?:日期)?[：:\\s]*([^\\n，,]+)`))?.[1] || "";
  const relative = line.match(/(今天|今日|明天|明日)/)?.[1]
    || text.match(new RegExp(`(今天|今日|明天|明日)${label}`))?.[1]
    || text.match(new RegExp(`${label}(?:日期)?[：:\\s]*(今天|今日|明天|明日)`))?.[1];
  if (relative) return inferRelativeDate(relative, referenceDate);
  const iso = line.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  const monthDay = line.match(/(?:(\d{1,2})月)?(\d{1,2})日/)
    || text.match(new RegExp(`(?:(\\d{1,2})月)?(\\d{1,2})日${label}`));
  return monthDay
    ? inferPaymentDate(Number(monthDay[2]), monthDay[1] ? Number(monthDay[1]) : null, referenceDate)
    : "";
}

function inferRelativeDate(value, referenceDate) {
  const date = new Date(referenceDate);
  if (["明天", "明日"].includes(value)) date.setDate(date.getDate() + 1);
  return localDate(date);
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

function inferDefaultPaymentDate(project, referenceDate) {
  const base = new Date(project.cutoffAt || referenceDate);
  if (Number.isNaN(base.getTime())) return "";
  const days = EXCHANGE_VENUES.has(project.venue) ? 2 : 1;
  return localDate(addBusinessDays(base, days));
}

function addBusinessDays(value, days) {
  const date = new Date(value);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (![0, 6].includes(date.getDay())) remaining -= 1;
  }
  return date;
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
  const bp = numberOrNull(value);
  if (!Number.isFinite(bp)) return "【待补】BP";
  const rounded = bp < 0 ? -Math.round(Math.abs(bp)) : Math.round(bp);
  return `${rounded}BP`;
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

function roundToNearest(value, unit) {
  return Math.round(value / unit) * unit;
}

function normalizeFtpRatePercent(value) {
  const number = numberOrNull(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) > 20 ? round(number / 100, 6) : number;
}

function localDate(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function referenceDateKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  return localDate(value);
}
