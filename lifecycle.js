const PROJECT_STATUSES = new Set([
  "待投标",
  "已投标待结果",
  "部分中标",
  "已中标",
  "未中标",
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
    cutoffAt: input.cutoffAt || "",
    opinion: generated?.opinion || "",
    sourceText: project.sourceText || "",
    notes: input.notes || "",
    tranches,
    comprehensivePricing: false,
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
    cutoffAt: String(input.cutoffAt || "").trim(),
    opinion: String(input.opinion || "").trim(),
    sourceText: String(input.sourceText || "").trim(),
    notes: String(input.notes || "").trim(),
    tranches: Array.isArray(input.tranches) && input.tranches.length
      ? input.tranches.map(normalizeTranche)
      : [normalizeTranche({ shortName: input.shortName })],
    comprehensivePricing: Boolean(input.comprehensivePricing),
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
  const wonCount = results.filter((status) => status === "中标").length;
  const notWonCount = results.filter((status) => status === "未中标").length;
  if (wonCount && notWonCount) return "部分中标";
  if (wonCount && wonCount === tranches.length) return "已中标";
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
    won: projects.filter((project) => ["部分中标", "已中标"].includes(project.status)).length,
    notWon: projects.filter((project) => project.status === "未中标").length,
  };
}

export function buildBidResultSummary(project) {
  const tranches = project.tranches || [];
  const bidText = tranches.map((tranche) => {
    const rate = Number.isFinite(numberOrNull(tranche.bidRate)) ? `${tranche.bidRate}%` : "利率待补";
    const amount = Number.isFinite(numberOrNull(tranche.bidAmount)) ? `${tranche.bidAmount}亿元` : "投标量待补";
    return `${tranche.shortName || tranche.durationText || "品种"}投标${rate}/${amount}`;
  }).join("；");
  const resultText = tranches.map((tranche) => {
    if (tranche.resultStatus === "未中标") return `${tranche.shortName || tranche.durationText || "品种"}未中标`;
    if (tranche.resultStatus !== "中标") return `${tranche.shortName || tranche.durationText || "品种"}待出结果`;
    const rate = Number.isFinite(numberOrNull(tranche.winningRate)) ? `，中标利率${tranche.winningRate}%` : "";
    const amount = Number.isFinite(numberOrNull(tranche.winningAmount)) ? `${tranche.winningAmount}亿元` : "金额待补";
    return `${tranche.shortName || tranche.durationText || "品种"}中标${amount}${rate}`;
  }).join("；");
  const pricingText = project.comprehensivePricing
    ? `综合定价：扣税后营收${formatValue(project.afterTaxRevenue)}，FTP${formatValue(project.ftpCost)}，扣除FTP后收益${formatValue(project.netIncome)}。`
    : "";
  return `${project.shortName || "本项目"}。投标情况：${bidText || "待录入"}。截标结果：${resultText || "待录入"}。${pricingText}`.trim();
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
  }));
}

function normalizeTranche(input = {}) {
  return {
    id: input.id || crypto.randomUUID(),
    shortName: String(input.shortName || "").trim(),
    durationText: String(input.durationText || "").trim(),
    inquiryLow: numberOrNull(input.inquiryLow),
    inquiryHigh: numberOrNull(input.inquiryHigh),
    bidRate: numberOrNull(input.bidRate),
    bidAmount: numberOrNull(input.bidAmount),
    resultStatus: ["待出结果", "中标", "未中标"].includes(input.resultStatus) ? input.resultStatus : "待出结果",
    winningRate: numberOrNull(input.winningRate),
    winningAmount: numberOrNull(input.winningAmount),
  };
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

function formatValue(value) {
  return Number.isFinite(numberOrNull(value)) ? String(value) : "待补";
}
