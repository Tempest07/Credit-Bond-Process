const PROJECT_STATUSES = new Set([
  "待投标",
  "已投标待结果",
  "部分中标",
  "已中标",
  "未中标",
  "待缴款",
  "已缴款",
  "已结束",
]);

export const PROJECT_STATUS_OPTIONS = [...PROJECT_STATUSES];

export function createProjectRecord(project, issuer, generated, input = {}) {
  const now = new Date().toISOString();
  const tranches = buildTranches(project);
  return normalizeProjectRecord({
    id: input.id || crypto.randomUUID(),
    status: input.status || "待投标",
    shortName: project.shortName,
    issuerId: issuer?.id || "",
    issuerName: issuer?.legalName || "",
    branch: project.branch || issuer?.defaultBranch || "",
    venue: project.venue || "",
    leadUnderwriter: project.leadUnderwriter || "",
    sponsorStatus: project.sponsorStatus || "",
    cutoffAt: input.cutoffAt || "",
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
  const status = PROJECT_STATUSES.has(input.status) ? input.status : "待投标";
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
    opinion: String(input.opinion || "").trim(),
    sourceText: String(input.sourceText || "").trim(),
    notes: String(input.notes || "").trim(),
    tranches: Array.isArray(input.tranches) && input.tranches.length
      ? input.tranches.map(normalizeTranche)
      : [normalizeTranche({ shortName: input.shortName })],
    resultAdvertisement: String(input.resultAdvertisement || "").trim(),
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
  if (!tranches.length) return project.status || "待投标";
  const results = tranches.map((tranche) => tranche.resultStatus);
  const hasBid = tranches.some((tranche) => Number.isFinite(numberOrNull(tranche.bidAmount)) || Number.isFinite(numberOrNull(tranche.bidRate)));
  const notWonCount = results.filter((status) => status === "未中标").length;
  const winningTranches = tranches.filter((tranche) =>
    tranche.resultStatus === "中标"
    || tranche.outsourcedBids?.some((bid) => Number.isFinite(numberOrNull(bid.winningAmountWan))),
  );
  if (winningTranches.length && winningTranches.every((tranche) => tranche.paymentCompleted)) return "已缴款";
  if (winningTranches.some((tranche) => tranche.paymentDate && !tranche.paymentCompleted)) return "待缴款";
  if (winningTranches.length && notWonCount && winningTranches.length < tranches.length) return "部分中标";
  if (winningTranches.length === tranches.length) return "已中标";
  if (notWonCount && notWonCount === tranches.length) return "未中标";
  if (hasBid) return "已投标待结果";
  return project.status === "已结束" ? "已结束" : "待投标";
}

export function dashboardCounts(projects = [], now = new Date()) {
  const date = localDate(now);
  return {
    all: projects.length,
    dueToday: projects.filter((project) => project.status === "待投标" && project.cutoffAt?.slice(0, 10) === date).length,
    toBid: projects.filter((project) => project.status === "待投标").length,
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
    } else if (Number.isFinite(numberOrNull(tranche.winningAmountWan))) {
      lines.push(`表内中标${formatNumber(tranche.winningAmountWan)}万，${formatPricing(tranche.pricingMode, tranche.pricingRate)}，营收${formatBp(tranche.revenueBp)}`);
    }
    for (const outsourced of tranche.outsourcedBids || []) {
      if (Number.isFinite(numberOrNull(outsourced.winningAmountWan))) {
        const prefix = outsourced.managerName ? `${outsourced.managerName}委外` : "委外";
        lines.push(`${prefix}中标${formatNumber(outsourced.winningAmountWan)}万，${formatPricing(outsourced.pricingMode, outsourced.pricingRate)}`);
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
  next.tranches = next.tranches.map((tranche, index) => {
    const match = parsed.items.find((item) => item.shortName === tranche.shortName)
      || parsed.items[index]
      || {};
    return normalizeTranche({
      ...tranche,
      securityCode: match.securityCode || tranche.securityCode,
      durationText: match.durationText || tranche.durationText,
      issueScale: match.issueScale ?? tranche.issueScale,
      fullMarketMultiple: match.fullMarketMultiple ?? tranche.fullMarketMultiple,
      winningRate: match.couponRate ?? tranche.winningRate,
      paymentDate: match.paymentDate || tranche.paymentDate,
      allocationNote: match.allocationNote || tranche.allocationNote,
    });
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
  return { items };
}

function buildTranches(project) {
  const names = project.shortNames?.length ? project.shortNames : [project.shortName];
  const durations = project.durationParts?.length ? project.durationParts : [project.durationText];
  const ranges = project.inquiryRanges?.length
    ? project.inquiryRanges
    : [{ low: project.inquiryLow, high: project.inquiryHigh }];
  const count = Math.max(names.length, durations.length, ranges.length, 1);
  return Array.from({ length: count }, (_, index) => normalizeTranche({
    shortName: names[index] || names[0] || project.shortName,
    durationText: durations[index] || "",
    inquiryLow: ranges[index]?.low,
    inquiryHigh: ranges[index]?.high,
    suggestedRatio: project.suggestedRatios?.[index] ?? project.suggestedRatio,
  }));
}

function normalizeTranche(input = {}) {
  const legacyWinningAmount = numberOrNull(input.winningAmount);
  return {
    id: input.id || crypto.randomUUID(),
    shortName: String(input.shortName || "").trim(),
    durationText: String(input.durationText || "").trim(),
    inquiryLow: numberOrNull(input.inquiryLow),
    inquiryHigh: numberOrNull(input.inquiryHigh),
    suggestedRatio: numberOrNull(input.suggestedRatio),
    bidRate: numberOrNull(input.bidRate),
    bidAmount: numberOrNull(input.bidAmount),
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
    paymentDate: String(input.paymentDate || "").trim(),
    allocationNote: String(input.allocationNote || "").trim(),
    paymentCompleted: Boolean(input.paymentCompleted),
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
  const bid = participation || tranche;
  if (!Number.isFinite(numberOrNull(bid.bidRate)) || !Number.isFinite(numberOrNull(bid.bidAmount))) return "";
  const isOutsourced = Boolean(participation);
  const prefix = isOutsourced
    ? `【委外投标${participation.managerName ? `：${participation.managerName}` : ""}】`
    : project.venue === "银行间" && project.sponsorStatus === "非我行主承"
      ? "【参团+投标】"
      : "【投标】";
  const duration = dual && tranche.durationText ? `，${formatDuration(tranche.durationText)}期` : "";
  const ratio = Number.isFinite(numberOrNull(tranche.suggestedRatio))
    ? `，不超${dual && tranche.durationText ? `${formatDuration(tranche.durationText)}期的` : ""}${formatNumber(tranche.suggestedRatio)}%`
    : "，不超【待补比例】";
  const underwriter = !isOutsourced && project.venue === "银行间" && project.sponsorStatus === "非我行主承"
    ? `，主承${project.leadUnderwriter || "【待补主承】"}`
    : "";
  return `${prefix}${tranche.shortName || project.shortName}${duration}，${formatPercent(bid.bidRate)}投${formatNumber(bid.bidAmount)}亿${ratio}${underwriter}`;
}

function parseAdvertisementBlock(block, headerText, referenceDate) {
  const headerParts = headerText.trim().split(/\s+/);
  const bodyShortName = block.match(/(?:【发行结果】\s*)?([0-9]{2}[A-Za-z0-9\u4e00-\u9fa5]+(?:SCP|CP|MTN|PPN)?\d*[A-Z]?)/i)?.[1] || "";
  const shortName = headerParts.find((part) => /^\d{2}\S+/.test(part)) || bodyShortName;
  const securityCode = headerParts.find((part) => /^\d{6}(?:\.[A-Z]{2})?$/.test(part))
    || block.match(/代码[：:]\s*([0-9.A-Z]+)/i)?.[1]
    || "";
  const issueScale = numberFrom(block, /(?:发行)?规模[：:，,\s]*(\d+(?:\.\d+)?)\s*亿/);
  const fullMarketMultiple = numberFrom(block, /全场倍数[：:，,\s]*(\d+(?:\.\d+)?)\s*倍/);
  const couponRate = numberFrom(block, /(?:票面利率|票面)[：:，,\s]*(\d+(?:\.\d+)?)\s*%/);
  const durationText = block.match(/(?:债券)?期限[：:，,\s]*([^，,\n]+?)(?=\s*[，,]?\s*(?:规模|发行规模|票面|全场倍数|缴款|$))/)?.[1]?.trim() || "";
  const paymentMatch = block.match(/缴款(?:日期)?[：:，,\s]*(?:(\d{1,2})月)?(\d{1,2})日/)
    || block.match(/(?:(\d{1,2})月)?(\d{1,2})日缴款/);
  const allocationNote = block.includes("全部回拨") ? block.match(/全部回拨至[^\n，,]*/)?.[0] || "全部回拨" : "";
  return {
    shortName,
    securityCode,
    issueScale,
    fullMarketMultiple,
    couponRate,
    durationText,
    paymentDate: paymentMatch ? inferPaymentDate(Number(paymentMatch[2]), paymentMatch[1] ? Number(paymentMatch[1]) : null, referenceDate) : "",
    allocationNote,
  };
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
