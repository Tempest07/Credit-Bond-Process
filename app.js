import {
  DEFAULT_STATE,
  applyIssuerCommonFields,
  buildBondFullName,
  durationParts,
  durationToDays,
  findIssuer,
  formatNumber,
  generateOpinion,
  mergeImportedIssuers,
  normalizeIssuer,
  parseProjectBrief,
  splitProjectBriefs,
  upsertIssuer,
} from "./core.js?v=20260617-dynamic-inquiry-ranges";
import {
  FTP_TENORS,
  applyGuidancePricing,
  applyIssuanceAdvertisement,
  buildAwardResultText,
  buildBidPositionText,
  calculateFtpForDuration,
  createProjectRecord,
  dashboardCounts,
  deriveProjectStatus,
  normalizeProjectRecord,
  parseIssuanceAdvertisement,
  removeProject,
  suggestProjectCutoff,
  trancheNeedsPayment,
  updateProjectCutoff,
  upsertProject,
} from "./lifecycle.js?v=20260617-dynamic-inquiry-ranges";
import {
  deriveIssuerAlias,
  extractIssuerLegalName,
  parseCreditText,
  parseHistoryText,
} from "./history-parser.js?v=20260617-dynamic-inquiry-ranges";
import {
  buildProtocolTransferLedgerRows,
  excelDateSerialFromLocalDate,
  markProtocolTransferStep,
  nextProtocolTransferStep,
  normalizeProtocolTransfer,
  normalizeProtocolTransfers,
  parseProtocolTransferText,
  protocolTransferStatus,
  protocolTransferTodos,
  removeProtocolTransfer,
  upsertProtocolTransfer,
} from "./protocol-transfer.js?v=20260617-dynamic-inquiry-ranges";

const LOCAL_KEY = "credit-bond-process-state-v1";
const TOKEN_KEY = "credit-bond-process-api-token";
const API_URL = "./api/state";
const MAILER_URL = "https://credit-bond-mailer.weiqian-yu.workers.dev";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const PDFJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const EXCELJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const PROTOCOL_TRANSFER_TEMPLATE_URL = "./templates/protocol-transfer-ledger-template.xlsx";
const SAMPLE_BRIEF = `26粤交投SCP002 非我行主承 广州分行
270D 规模7亿 AAA(中诚信国际)/隐含AAA
询价区间1.25-1.45 银行间 中信银行

26粤交投SCP002 市场估值约1.46
如需综合定价，指导价约1.48`;
const BLANK_BRIEF_TEMPLATE = `【债券简称】 非我行主承 【分行】分行
【期限】 规模【规模】亿 【主体评级】(【评级机构】)/隐含【隐含评级】
询价区间【询价下限】%-【询价上限】% 【发行场所】 【牵头主承销商】

【债券简称】 市场估值约【估值】
如需综合定价，指导价约【指导价】`;
const BRIEF_PLACEHOLDER_PATTERN = /【([^】]+)】/g;
const ANY_PLACEHOLDER_PATTERN = /【[^】\r\n]{1,60}】/g;
const BRIEF_PLACEHOLDER_LABELS = new Set([
  "债券简称",
  "分行",
  "期限",
  "规模",
  "主体评级",
  "评级机构",
  "隐含评级",
  "询价下限",
  "询价上限",
  "发行场所",
  "牵头主承销商",
  "估值",
  "指导价",
]);

const SAMPLE_ISSUER = {
  id: "sample-yuejiaotou",
  legalName: "广州交通投资集团有限公司",
  aliases: ["粤交投", "广州交投"],
  defaultBranch: "广州分行",
  enterpriseType: "地方国企",
  subjectRating: "AAA",
  ratingAgency: "中诚信国际",
  hiddenRating: "AAA",
  isRealEstate: false,
  credit: {
    approvalLevel: "总行",
    approvedAmount: 20,
    offeringType: "公募",
    approvedRatio: 30,
    investmentTermText: "3年",
    investmentTermDays: 1095,
    rawText: "总行批20亿，公募，30%，3年",
    sourceRank: 1,
  },
};

let state = loadLocalState();
let project = parseProjectBrief("");
let selectedIssuerId = "";
let cloudAvailable = false;
let pendingHistoryImport = null;
let batchItems = [];
let selectedProjectId = "";
let selectedProtocolTransferId = "";
let ledgerFilter = "all";
let projectAutoSaveTimer = null;
let projectRecognitionMarks = {};
let resultRecognitionMarks = {};
let resultRecognitionProjectId = "";
let protocolTransferRecognitionMarks = {};
let protocolTransferRecognitionId = "";

const LEDGER_FILTER_LABELS = {
  all: "全部项目",
  toBid: "待投标",
  awaitingResult: "等待结果",
  won: "中标项目",
  notWon: "未中标",
  dueToday: "今日待投标",
  paymentToday: "今日缴款",
};
const LEDGER_FILTER_SELECT_VALUES = new Set(["all", "toBid", "awaitingResult", "won", "notWon"]);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

if (location.hostname.endsWith(".pages.dev")) {
  location.replace(`https://tempest07.com/bond-centre/${location.search}${location.hash}`);
}

initialize();

async function initialize() {
  bindPlaceholderSelection();
  bindNavigation();
  bindGenerator();
  bindLedger();
  bindProtocolTransfer();
  bindQuickIssuer();
  bindBatch();
  bindDatabase();
  initializeHistoryImport();
  bindDataActions();
  renderIssuerOptions();
  renderIssuerList();
  renderProjectWorkspace();
  renderProtocolTransferWorkspace();
  renderFtpCurveForm();
  clearIssuerForm();
  await loadCloudState();
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTarget));
  });
}

function switchView(viewName) {
  const button = $(`.nav-item[data-view-target="${viewName}"]`);
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  if (button) $("#pageTitle").textContent = button.textContent;
}

function bindPlaceholderSelection() {
  document.addEventListener("mousedown", selectAnyPlaceholderOnMouseDown);
  document.addEventListener("dblclick", selectAnyPlaceholderOnDoubleClick);
}

function bindGenerator() {
  $("#blankTemplateButton").addEventListener("click", loadBlankBriefTemplate);
  $("#briefInput").addEventListener("keydown", handleBriefTemplateKeydown);
  $("#briefInput").addEventListener("mousedown", selectBriefPlaceholderOnMouseDown);
  $("#briefInput").addEventListener("dblclick", selectBriefPlaceholderOnDoubleClick);
  $("#sampleButton").addEventListener("click", () => {
    if (!state.issuers.some((issuer) => issuer.id === SAMPLE_ISSUER.id)) {
      state = upsertIssuer(state, SAMPLE_ISSUER);
      persistState();
      renderIssuerOptions();
      renderIssuerList();
    }
    $("#briefInput").value = SAMPLE_BRIEF;
    parseAndRender();
  });

  $("#parseButton").addEventListener("click", parseAndRender);
  $("#issuerSelect").addEventListener("change", () => {
    delete projectRecognitionMarks.issuerSelect;
    setRecognitionForInput($("#issuerSelect"), null);
    selectedIssuerId = $("#issuerSelect").value;
    const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
    project = applyIssuerCommonFields(project, issuer);
    fillProjectFields();
    regenerate();
  });

  $$("[data-project-field]").forEach((input) => {
    input.addEventListener("input", () => {
      clearRecognitionForInput(input);
      const field = input.dataset.projectField;
      project[field] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
      if (field === "durationText") {
        project.durationDays = durationToDays(project.durationText);
        project.durationParts = durationParts(project.durationText);
        ensureInquiryRangeCapacity(project);
        renderTrancheInquiryFields();
      }
      if (field.startsWith("inquiry")) {
        rebuildInquiryRanges(project);
        renderTrancheInquiryFields();
      }
      if (field === "offeringType") applyOfferingTypeChoice(project, project.offeringType, true);
      if (field === "exchangeIssueNumber") applyExchangeIssueNumberChoice(project, project.exchangeIssueNumber, true);
      regenerate();
    });
  });
  $("#trancheInquiryRows").addEventListener("input", (event) => {
    const input = event.target.closest("[data-inquiry-index]");
    if (!input) return;
    clearRecognitionForInput(input);
    updateDynamicInquiryRange(input);
    regenerate();
  });

  $("#copyButton").addEventListener("click", async () => {
    const value = $("#opinionOutput").value;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    showToast("流程意见已复制。");
  });
  $("#opinionOutput").addEventListener("mousedown", selectBidRateOnMouseDown);
  $("#opinionOutput").addEventListener("dblclick", selectBidRateOnDoubleClick);
  $("#saveProjectButton").addEventListener("click", saveCurrentProject);
}

function saveCurrentProject() {
  const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
  const generated = { ...generateOpinion(project, issuer), opinion: $("#opinionOutput").value };
  if (!project.shortName) {
    showToast("请先解析项目简表，再保存为项目。");
    return;
  }
  const result = upsertParsedProjectToLedger(project, issuer, generated);
  if (!result) return;
  selectedProjectId = result.record.id;
  persistState();
  renderProjectWorkspace();
  switchView("ledger");
  showToast(result.isUpdate ? "已更新现有项目台账。" : "已保存至项目台账。");
}

function upsertParsedProjectToLedger(projectValue, issuer, generated) {
  if (!projectValue?.shortName) return null;
  const existing = (state.projects || []).find((item) => item.shortName === projectValue.shortName && item.status !== "已结束");
  const record = buildLedgerProjectRecord(projectValue, issuer, generated, existing);
  state = upsertProject(state, record);
  return { record, isUpdate: Boolean(existing) };
}

function buildLedgerProjectRecord(projectValue, issuer, generated, existing = null) {
  const suggestedRatios = generated.suggestion.trancheSuggestions.map((item) => item.suggestedRatio);
  const created = createProjectRecord({
    ...projectValue,
    leadUnderwriter: projectValue.sponsorStatus === "牵头" ? "兴业银行" : projectValue.leadUnderwriter,
    suggestedRatios,
  }, issuer, generated, { id: existing?.id });
  return existing
    ? normalizeProjectRecord({
        ...created,
        status: existing.status,
        cutoffAt: existing.cutoffAt || created.cutoffAt,
        cutoffTimeConfirmed: existing.cutoffAt ? existing.cutoffTimeConfirmed : created.cutoffTimeConfirmed,
        cutoffSource: existing.cutoffAt ? existing.cutoffSource : created.cutoffSource,
        cutoffHistory: existing.cutoffHistory || [],
        notes: existing.notes,
        resultAdvertisement: existing.resultAdvertisement,
        resultConfirmed: existing.resultConfirmed,
        comprehensivePricing: existing.comprehensivePricing,
        pricingUnit: existing.pricingUnit,
        afterTaxRevenue: existing.afterTaxRevenue,
        ftpCost: existing.ftpCost,
        tranches: existing.tranches?.length === created.tranches.length
          ? created.tranches.map((tranche, index) => ({
              ...existing.tranches[index],
              shortName: tranche.shortName,
              durationText: tranche.durationText,
              inquiryLow: tranche.inquiryLow,
              inquiryHigh: tranche.inquiryHigh,
              suggestedRatio: tranche.suggestedRatio,
              pricingMode: existing.tranches[index].pricingRate == null && tranche.pricingRate != null
                ? tranche.pricingMode
                : existing.tranches[index].pricingMode,
              pricingRate: existing.tranches[index].pricingRate ?? tranche.pricingRate,
            }))
          : created.tranches,
        createdAt: existing.createdAt,
      })
    : created;
}

function bindLedger() {
  $("#projectSearch").addEventListener("input", renderProjectList);
  $("#projectStatusFilter").addEventListener("change", renderProjectList);
  $("#projectDateFilter").addEventListener("change", renderProjectList);
  $("#projectTodayFilterButton").addEventListener("click", () => {
    $("#projectDateFilter").value = localDate(new Date());
    renderProjectList();
  });
  $("#previewMailButton").addEventListener("click", () => callMailer("preview"));
  $("#sendMailButton").addEventListener("click", () => callMailer("send"));
  $("#collapseMailOutputButton").addEventListener("click", hideMailOutput);
  $("#newProjectButton").addEventListener("click", () => {
    project = parseProjectBrief("");
    selectedIssuerId = "";
    $("#briefInput").value = BLANK_BRIEF_TEMPLATE;
    fillProjectFields();
    renderIssuerOptions();
    regenerate();
    switchView("generator");
    focusFirstBriefPlaceholder();
  });
  $$("[data-ledger-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      setLedgerFilter(button.dataset.ledgerFilter);
    });
  });
  $("#ledgerFilterSelect").addEventListener("change", (event) => {
    setLedgerFilter(event.target.value);
  });
  $("#addTrancheButton").addEventListener("click", () => {
    const draft = readProjectForm();
    draft.tranches.push(normalizeProjectRecord({ shortName: "新品种" }).tranches[0]);
    refillProjectForm(draft);
    saveProjectDraftNow();
  });
  $("#projectForm").addEventListener("input", (event) => {
    clearRecognitionForInput(event.target);
    updateProjectPreviews();
    scheduleProjectAutoSave();
  });
  $("#projectForm").addEventListener("change", (event) => {
    clearRecognitionForInput(event.target);
    updateProjectPreviews();
    scheduleProjectAutoSave();
  });
  $("#projectFtpCost").addEventListener("change", recalculateRevenueFromFtp);
  $("#projectForm").addEventListener("submit", (event) => event.preventDefault());
  $("#projectCutoffAt").addEventListener("change", () => {
    const existing = (state.projects || []).find((item) => item.id === $("#projectId").value) || {};
    const draft = readProjectForm();
    const updated = updateProjectCutoff({
      ...draft,
      cutoffAt: existing.cutoffAt,
      cutoffHistory: existing.cutoffHistory,
    }, $("#projectCutoffAt").value, "手工修改", true);
    refillProjectForm(updated);
    saveProjectRecordNow(updated);
  });
  $$("[data-cutoff-action]").forEach((button) => {
    button.addEventListener("click", () => applyCutoffAction(button.dataset.cutoffAction));
  });
  $("#markUnbidButton").addEventListener("click", () => setProjectActionStatus("未投标"));
  $("#markBidButton").addEventListener("click", () => setProjectActionStatus("已投标待结果"));
  $("#terminateProjectButton").addEventListener("click", () => setProjectActionStatus("已结束"));
  $("#openResultButton").addEventListener("click", () => openResultEntryPanel());
  $("#closeResultButton").addEventListener("click", closeResultEntryPanel);
  $("#resultEntryPanel").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-result]")) closeResultEntryPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#resultEntryPanel").hidden) closeResultEntryPanel();
  });
  $("#copyBidPositionButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#projectBidPosition").value);
    showToast("投标标位已复制。");
  });
  $("#copyResultSummaryButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#projectResultSummary").value);
    showToast("中标汇报已复制。");
  });
  $("#parseAdvertisementButton").addEventListener("click", () => {
    const draft = readProjectForm();
    const advertisement = $("#projectResultAdvertisement").value;
    if (!advertisement.trim()) {
      showToast("请先粘贴发行结果广告。");
      return;
    }
    const parsedAdvertisement = parseIssuanceAdvertisement(advertisement);
    const parsed = applyIssuanceAdvertisement({ ...draft, ftpCurve: state.ftpCurve, resultConfirmed: true }, advertisement);
    parsed.resultConfirmed = true;
    parsed.status = deriveProjectStatus(parsed);
    resultRecognitionMarks = buildResultRecognitionMarks(draft, parsed, parsedAdvertisement);
    resultRecognitionProjectId = parsed.id || draft.id || "";
    fillProjectForm(parsed);
    saveProjectRecordNow(parsed);
    closeResultEntryPanel();
    setResultEntryFieldsVisible(true);
    showToast("已解析发行结果，并按标位自动推算中标量和营收，请复核明细。");
  });
  $("#editProjectOpinionButton").addEventListener("click", () => {
    const record = readProjectForm();
    project = {
      ...parseProjectBrief(record.sourceText),
      shortName: record.shortName,
      branch: record.branch,
      venue: record.venue,
      leadUnderwriter: record.leadUnderwriter,
      sponsorStatus: record.sponsorStatus,
      sourceText: record.sourceText,
    };
    selectedIssuerId = record.issuerId || "";
    $("#briefInput").value = record.sourceText;
    fillProjectFields();
    renderIssuerOptions();
    regenerate();
    $("#opinionOutput").value = record.opinion;
    switchView("generator");
  });
  $("#paymentTodoList").addEventListener("click", (event) => {
    const completeButton = event.target.closest("[data-complete-payment]");
    const openButton = event.target.closest("[data-open-payment-project]");
    if (completeButton) completePaymentTodo(completeButton.dataset.completePayment);
    if (openButton) {
      selectedProjectId = openButton.dataset.openPaymentProject;
      renderProjectWorkspace();
      $("#projectForm").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  $("#cutoffTodoList").addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-cutoff-project]");
    const delayButton = event.target.closest("[data-delay-cutoff]");
    if (delayButton) delayProjectCutoffFromTodo(delayButton.dataset.delayCutoff, Number(delayButton.dataset.delayMinutes));
    if (openButton) {
      selectedProjectId = openButton.dataset.openCutoffProject;
      renderProjectWorkspace();
      $("#projectForm").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  $("#deleteProjectButton").addEventListener("click", () => {
    if (!selectedProjectId || !confirm("确定删除当前项目台账吗？")) return;
    clearTimeout(projectAutoSaveTimer);
    state = removeProject(state, selectedProjectId);
    selectedProjectId = "";
    persistState();
    renderProjectWorkspace();
    showToast("项目已删除。");
  });
}

function parseAndRender() {
  const missing = briefTemplatePlaceholders($("#briefInput").value);
  if (missing.length) {
    clearProjectRecognitionMarks();
    renderWarnings([`请先补全模板占位：${missing.join("、")}。`]);
    focusFirstBriefPlaceholder();
    showToast("项目简表还有占位符未填写。");
    return;
  }
  const parsedProject = parseProjectBrief($("#briefInput").value);
  const matched = findIssuerForProject(parsedProject);
  project = applyIssuerCommonFields(parsedProject, matched);
  selectedIssuerId = matched?.id || "";
  projectRecognitionMarks = buildProjectRecognitionMarks(project, matched);
  resultRecognitionMarks = {};
  fillProjectFields();
  renderIssuerOptions();
  regenerate();
}

function findIssuerForProject(projectValue) {
  return findIssuer(projectValue?.shortName || "", state.issuers)
    || findIssuer(projectValue?.issuerName || "", state.issuers);
}

function loadBlankBriefTemplate() {
  $("#briefInput").value = BLANK_BRIEF_TEMPLATE;
  project = parseProjectBrief("");
  selectedIssuerId = "";
  clearProjectRecognitionMarks();
  fillProjectFields();
  renderIssuerOptions();
  regenerate();
  renderWarnings(["请把 【】 中的占位内容替换为真实要素；不执行综合定价时，删除指导价行或改写为“不执行综合定价”。"]);
  focusFirstBriefPlaceholder();
}

function briefTemplatePlaceholders(value) {
  return [...new Set(briefPlaceholderMatches(value).map((match) => match[1].trim()))];
}

function focusFirstBriefPlaceholder() {
  focusBriefPlaceholder("first");
}

function handleBriefTemplateKeydown(event) {
  if (event.key !== "Tab") return;
  if (!briefTemplatePlaceholders(event.currentTarget.value).length) return;
  event.preventDefault();
  focusBriefPlaceholder(event.shiftKey ? "previous" : "next");
}

function selectBriefPlaceholderOnMouseDown(event) {
  if (event.button !== 0 || event.detail !== 2) return;
  const input = event.currentTarget;
  if (!briefPlaceholderMatches(input.value).length) return;
  requestAnimationFrame(() => {
    const placeholder = findBriefPlaceholderAtSelection(input);
    if (placeholder) selectBriefPlaceholderRange(input, placeholder);
  });
}

function selectBriefPlaceholderOnDoubleClick(event) {
  const input = event.currentTarget;
  const placeholder = findBriefPlaceholderAtSelection(input);
  if (!placeholder) return;
  event.preventDefault();
  selectBriefPlaceholderRange(input, placeholder);
}

function findBriefPlaceholderAtSelection(input) {
  const selectionStart = Math.min(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  const selectionEnd = Math.max(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  return briefPlaceholderMatches(input.value).find((match) => {
    const start = match.index;
    const end = start + match[0].length;
    return selectionStart >= start && selectionEnd <= end;
  }) || null;
}

function briefPlaceholderMatches(value) {
  BRIEF_PLACEHOLDER_PATTERN.lastIndex = 0;
  const matches = [...String(value || "").matchAll(BRIEF_PLACEHOLDER_PATTERN)]
    .filter((match) => BRIEF_PLACEHOLDER_LABELS.has(match[1].trim()));
  BRIEF_PLACEHOLDER_PATTERN.lastIndex = 0;
  return matches;
}

function anyPlaceholderMatches(value) {
  ANY_PLACEHOLDER_PATTERN.lastIndex = 0;
  const matches = [...String(value || "").matchAll(ANY_PLACEHOLDER_PATTERN)];
  ANY_PLACEHOLDER_PATTERN.lastIndex = 0;
  return matches;
}

function selectableTextControl(target) {
  const input = target?.closest?.("textarea,input");
  if (!input) return null;
  if (input instanceof HTMLTextAreaElement) return input;
  if (!(input instanceof HTMLInputElement)) return null;
  const selectableTypes = new Set(["", "text", "search", "url", "tel", "email", "password"]);
  if (!selectableTypes.has(input.type)) return null;
  return input;
}

function selectAnyPlaceholderOnMouseDown(event) {
  if (event.button !== 0 || event.detail !== 2) return;
  const input = selectableTextControl(event.target);
  if (!input) return;
  if (!anyPlaceholderMatches(input.value).length) return;
  requestAnimationFrame(() => {
    const placeholder = findAnyPlaceholderAtSelection(input);
    if (placeholder) selectPlaceholderRange(input, placeholder);
  });
}

function selectAnyPlaceholderOnDoubleClick(event) {
  const input = selectableTextControl(event.target);
  if (!input) return;
  const placeholder = findAnyPlaceholderAtSelection(input);
  if (!placeholder) return;
  event.preventDefault();
  selectPlaceholderRange(input, placeholder);
}

function findAnyPlaceholderAtSelection(input) {
  const selectionStart = Math.min(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  const selectionEnd = Math.max(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  return anyPlaceholderMatches(input.value).find((match) => {
    const start = match.index;
    const end = start + match[0].length;
    return selectionStart >= start && selectionStart <= end && selectionEnd >= start && selectionEnd <= end;
  }) || null;
}

function selectPlaceholderRange(input, placeholder) {
  const start = placeholder.index;
  const end = start + placeholder[0].length;
  input.focus();
  input.setSelectionRange(start, end);
  requestAnimationFrame(() => input.setSelectionRange(start, end));
}

function selectBriefPlaceholderRange(input, placeholder) {
  selectPlaceholderRange(input, placeholder);
}

function selectBidRateOnDoubleClick(event) {
  const input = event.currentTarget;
  const range = findBidRateRangeAtSelection(input);
  if (!range) return;
  event.preventDefault();
  input.focus();
  input.setSelectionRange(range.start, range.end);
  requestAnimationFrame(() => input.setSelectionRange(range.start, range.end));
}

function selectBidRateOnMouseDown(event) {
  if (event.button !== 0 || event.detail !== 2) return;
  const range = findBidRateRangeAtSelection(event.currentTarget);
  if (!range) return;
  event.preventDefault();
  event.currentTarget.focus();
  event.currentTarget.setSelectionRange(range.start, range.end);
  requestAnimationFrame(() => event.currentTarget.setSelectionRange(range.start, range.end));
}

function findBidRateRangeAtSelection(input) {
  const value = String(input.value || "");
  const selectionStart = Math.min(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  const selectionEnd = Math.max(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  const pattern = /一级投标利率不低于(\d+(?:\.\d+)?)(?=%)/g;
  for (const match of value.matchAll(pattern)) {
    const rate = match[1];
    const start = match.index + match[0].lastIndexOf(rate);
    const end = start + rate.length;
    if (selectionStart >= start && selectionEnd <= end) return { start, end };
  }
  return null;
}

function focusBriefPlaceholder(direction = "next") {
  const input = $("#briefInput");
  const placeholders = briefPlaceholderMatches(input.value);
  input.focus();
  if (!placeholders.length) return;

  const selectionStart = input.selectionStart ?? 0;
  let target = placeholders[0];
  if (direction === "first") {
    target = placeholders[0];
  } else if (direction === "previous") {
    target = [...placeholders].reverse().find((match) => match.index < selectionStart) || placeholders.at(-1);
  } else {
    target = placeholders.find((match) => match.index > selectionStart) || placeholders[0];
  }
  input.setSelectionRange(target.index, target.index + target[0].length);
}

function fillProjectFields() {
  $$("[data-project-field]").forEach((input) => {
    const field = input.dataset.projectField;
    input.value = project[field] ?? "";
  });
  ensureInquiryRangeCapacity(project);
  renderTrancheInquiryFields();
  applyProjectRecognitionMarks();
}

function clearProjectRecognitionMarks() {
  projectRecognitionMarks = {};
  resultRecognitionMarks = {};
  resultRecognitionProjectId = "";
  clearRecognitionMarks(document);
}

function buildProjectRecognitionMarks(projectValue, issuer) {
  const marks = {};
  const markAuto = (field, label) => {
    marks[field] = valueHasContent(projectValue[field])
      ? recognitionMark("success", `${label}已识别`)
      : recognitionMark("error", `${label}未识别，请补充`);
  };

  [
    ["shortName", "债券简称"],
    ["sponsorStatus", "主承身份"],
    ["branch", "申报分行"],
    ["durationText", "债券期限"],
    ["issueScale", "发行规模"],
    ["subjectRating", "主体评级"],
    ["ratingAgency", "评级机构"],
    ["hiddenRating", "隐含评级"],
    ["inquiryLow", "询价下限"],
    ["inquiryHigh", "询价上限"],
    ["venue", "发行场所"],
  ].forEach(([field, label]) => markAuto(field, label));

  ["subjectRating", "ratingAgency", "hiddenRating"].forEach((field) => {
    const warning = commonFieldMismatchWarning(projectValue, field);
    if (warning) marks[field] = recognitionMark("attention", warning);
  });

  if (projectValue.sponsorStatus === "牵头") {
    marks.leadUnderwriter = recognitionMark("attention", "牵头项目主承默认兴业银行，如需改写请补充");
  } else {
    markAuto("leadUnderwriter", "牵头主承销商");
  }

  if (valueHasContent(projectValue.offeringType)) {
    marks.offeringType = recognitionMark("success", "发行方式已识别");
  } else if (isExchangeProject(projectValue)) {
    marks.offeringType = recognitionMark("attention", "交易所项目发行方式需确认");
  }

  if (isExchangeProject(projectValue)) {
    marks.exchangeIssueNumber = Number.isInteger(numberOrNull(projectValue.exchangeIssueNumber))
      ? recognitionMark("success", "交易所发行期次已识别")
      : recognitionMark("attention", "交易所发行期次通常需要人工确认");
  }

  const count = inquiryVarietyCount(projectValue);
  if (count > 1) {
    ensureInquiryRangeCapacity(projectValue);
    for (let index = 1; index < count; index += 1) {
      const range = projectValue.inquiryRanges?.[index] || {};
      marks[`inquiryRanges.${index}.low`] = Number.isFinite(numberOrNull(range.low))
        ? recognitionMark("success", `${inquiryVarietyLabel(projectValue, index)}询价下限已识别`)
        : recognitionMark("error", `${inquiryVarietyLabel(projectValue, index)}询价下限未识别，请补充`);
      marks[`inquiryRanges.${index}.high`] = Number.isFinite(numberOrNull(range.high))
        ? recognitionMark("success", `${inquiryVarietyLabel(projectValue, index)}询价上限已识别`)
        : recognitionMark("error", `${inquiryVarietyLabel(projectValue, index)}询价上限未识别，请补充`);
    }
  }

  if (!issuer) {
    marks.issuerSelect = recognitionMark("attention", "未匹配主体资料，请选择或新增主体");
  }
  return marks;
}

function applyProjectRecognitionMarks() {
  $$("[data-project-field]").forEach((input) => {
    setRecognitionForInput(input, projectRecognitionMarks[input.dataset.projectField]);
  });
  $$("[data-inquiry-index][data-inquiry-bound]").forEach((input) => {
    const key = `inquiryRanges.${input.dataset.inquiryIndex}.${input.dataset.inquiryBound}`;
    setRecognitionForInput(input, projectRecognitionMarks[key]);
  });
  const issuerSelect = $("#issuerSelect");
  if (issuerSelect) setRecognitionForInput(issuerSelect, projectRecognitionMarks.issuerSelect);
}

function commonFieldMismatchWarning(projectValue, field) {
  const labels = {
    subjectRating: "主体评级",
    ratingAgency: "评级机构",
    hiddenRating: "市场隐含评级",
  };
  const label = labels[field];
  return (projectValue.warnings || []).find((warning) => label && warning.includes(`主体库要素${label}`)) || "";
}

function regenerate() {
  const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
  if (!project.fullName && issuer) {
    const fullName = buildBondFullName(project.shortName, issuer.legalName, project);
    const input = $('[data-project-field="fullName"]');
    if (fullName && input.value !== fullName) {
      project.fullName = fullName;
      input.value = fullName;
    }
  }

  const generated = generateOpinion(project, issuer);
  $("#opinionOutput").value = generated.opinion;
  $("#matchedIssuerPill").textContent = issuer ? issuer.legalName : "未匹配主体";
  $("#matchedIssuerPill").classList.toggle("accent", Boolean(issuer));

  const suggestion = generated.suggestion;
  $("#suggestionSummary").textContent = Number.isFinite(suggestion.investmentAmount)
    ? `${suggestion.trancheSuggestions.length > 1 ? "建议合计" : "建议"} ${formatSuggestionRatios(suggestion)} / ${formatNumber(suggestion.investmentAmount)}亿元`
    : "建议比例待补充";

  renderWarnings(generated.warnings);
  renderRuleTrace(generated, issuer);
}

function renderWarnings(warnings) {
  const unique = [...new Set(warnings.filter(Boolean))];
  $("#warningBox").hidden = !unique.length;
  $("#warningList").innerHTML = unique.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

function renderRuleTrace(generated, issuer) {
  const suggestion = generated.suggestion;
  const items = [
    issuer ? `已匹配：${issuer.legalName}` : "未匹配主体",
    Number.isFinite(suggestion.approvedRatio) ? `授信比例：${formatNumber(suggestion.approvedRatio)}%` : "授信比例待补",
    ...suggestion.caps.map((cap) => cap.reason),
    Number.isFinite(suggestion.investmentAmount) ? `投资金额：${formatNumber(suggestion.investmentAmount)}亿元` : "投资金额待补",
    generated.approver,
  ];
  $("#ruleTrace").innerHTML = items.map((item, index) =>
    `<span class="trace-item ${index ? "active" : ""}">${escapeHtml(item)}</span>`,
  ).join("");
}

function renderProjectWorkspace() {
  refreshDerivedProjectStatuses();
  const selectedRaw = (state.projects || []).find((item) => item.id === selectedProjectId);
  const selected = ensureProjectCutoff(selectedRaw);
  renderDashboard();
  renderCutoffTodo();
  renderPaymentTodo();
  renderProjectList();
  if (selected) fillProjectForm(selected);
  else clearProjectForm();
}

function refreshDerivedProjectStatuses() {
  let changed = false;
  const projects = (state.projects || []).map((projectValue) => {
    let next = applySourceGuidancePricing(projectValue);
    if (next !== projectValue) changed = true;
    if (!next.resultConfirmed || next.status === "已结束") return next;
    const status = deriveProjectStatus(next);
    if (status === next.status) return next;
    changed = true;
    return normalizeProjectRecord({ ...next, status });
  });
  if (!changed) return;
  state = { ...state, projects };
  persistState();
}

function applySourceGuidancePricing(projectValue) {
  const prices = guidancePricesFromSource(projectValue?.sourceText);
  return prices.length ? applyGuidancePricing(projectValue, prices) : projectValue;
}

function guidancePricesFromSource(sourceText) {
  if (!String(sourceText || "").trim()) return [];
  const parsed = parseProjectBrief(sourceText);
  return parsed.guidancePrices?.length
    ? parsed.guidancePrices
    : Number.isFinite(numberOrNull(parsed.guidancePrice))
      ? [parsed.guidancePrice]
      : [];
}

function ensureProjectCutoff(projectValue) {
  if (!projectValue || projectValue.cutoffAt || !["未投标", "待投标"].includes(projectValue.status)) return projectValue;
  const issuer = state.issuers.find((item) => item.id === projectValue.issuerId) || null;
  const cutoff = suggestProjectCutoff(projectValue, issuer);
  const next = normalizeProjectRecord({ ...projectValue, ...cutoff });
  state = upsertProject(state, next);
  persistState();
  return next;
}

function renderDashboard() {
  const counts = dashboardCounts(state.projects || []);
  $("#dashboardAll").textContent = counts.all;
  $("#dashboardToBid").textContent = counts.toBid;
}

function renderCutoffTodo() {
  const now = new Date();
  const today = localDate(now);
  const todos = (state.projects || [])
    .filter((projectValue) => ["未投标", "待投标"].includes(projectValue.status) && projectValue.cutoffAt)
    .map((projectValue) => {
      const cutoff = new Date(projectValue.cutoffAt);
      const minutes = (cutoff.getTime() - now.getTime()) / 60000;
      const date = projectValue.cutoffAt.slice(0, 10);
      const type = !projectValue.cutoffTimeConfirmed
        ? "unconfirmed"
        : minutes < 0
          ? "overdue"
          : minutes <= 30
            ? "critical"
            : minutes <= 60
            ? "urgent"
            : minutes <= 180
              ? "soon"
            : date === today
              ? "today"
              : "future";
      return { project: projectValue, cutoff, minutes, type };
    })
    .filter((item) => item.type !== "future")
    .sort((left, right) => left.cutoff - right.cutoff);
  $("#cutoffTodoPanel").classList.toggle("empty-state", !todos.length);
  $("#cutoffTodoList").innerHTML = todos.length
    ? todos.map(({ project: projectValue, type }) => {
        const label = type === "unconfirmed"
          ? "时间待确认"
          : type === "overdue"
            ? "已过截标时间"
            : type === "critical"
              ? "不足30分钟"
              : type === "urgent"
                ? "不足1小时"
                : type === "soon"
                  ? "不足3小时"
                  : "今日截标";
        return `
          <article class="cutoff-todo-item ${type}">
            <button class="payment-todo-main" type="button" data-open-cutoff-project="${escapeAttribute(projectValue.id)}">
              <strong>${escapeHtml(projectValue.shortName || "未命名项目")}</strong>
              <span>${escapeHtml(formatCutoff(projectValue.cutoffAt))} · ${escapeHtml(label)}</span>
            </button>
            <div class="cutoff-todo-actions">
              <button class="text-button" type="button" data-delay-cutoff="${escapeAttribute(projectValue.id)}" data-delay-minutes="30">+30分钟</button>
              <button class="text-button" type="button" data-delay-cutoff="${escapeAttribute(projectValue.id)}" data-delay-minutes="60">+1小时</button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="payment-todo-empty">目前没有临近截标或待确认项目。</div>';
}

async function callMailer(action) {
  const token = getApiToken();
  if (!token) {
    showMailOutput("需要云端口令", "warning", "请先点击右上角“设置云端口令”，输入 APP_PASSWORD 后再发送邮件。");
    return;
  }

  const isSend = action === "send";
  const button = isSend ? $("#sendMailButton") : $("#previewMailButton");
  button.disabled = true;
  showMailOutput(
    isSend ? "正在发送" : "正在生成预览",
    "loading",
    isSend ? "正在发送今日流程邮件..." : "正在生成今日邮件预览...",
  );
  try {
    const response = await fetch(`${MAILER_URL}/${isSend ? "send-today" : "preview-today"}`, {
      method: isSend ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      showMailOutput("邮件请求失败", "error", JSON.stringify({
        ok: false,
        httpStatus: response.status,
        ...(payload || { error: text.slice(0, 1000) }),
      }, null, 2));
      showToast(isSend ? "邮件发送失败，请查看输出详情。" : "邮件预览失败，请查看输出详情。");
      return;
    }

    if (isSend) {
      if (payload?.status === "sent") {
        showMailOutput("邮件已发送", "success", buildMailSuccessMessage(payload));
      } else {
        showMailOutput("发送结果", "info", payload?.reason || "邮件发送请求已完成。");
      }
      showToast(payload.status === "sent" ? "今日流程邮件已发送。" : payload.reason || "邮件发送请求已完成。");
    } else {
      showMailOutput("邮件预览", "preview", payload?.text || JSON.stringify(payload, null, 2));
      showToast(`已生成 ${payload?.projectCount ?? 0} 笔项目的邮件预览。`);
    }
  } catch (error) {
    showMailOutput("邮件服务异常", "error", JSON.stringify({
      status: "error",
      error: error.message || String(error),
      hint: "请确认 credit-bond-mailer Worker 已部署，且允许跨域访问。",
    }, null, 2));
    showToast("邮件服务暂时无法访问。");
  } finally {
    button.disabled = false;
  }
}

function buildMailSuccessMessage(payload = {}) {
  const subject = payload.subject ? `主题：${payload.subject}` : "";
  const count = Number.isFinite(Number(payload.projectCount)) ? `项目数量：${payload.projectCount} 笔` : "";
  return ["今日流程意见邮件已成功发送。", subject, count].filter(Boolean).join("\n");
}

function showMailOutput(title, status, text) {
  const panel = $("#mailOutputPanel");
  panel.hidden = false;
  panel.dataset.status = status || "info";
  $("#mailOutputTitle").textContent = title || "邮件输出";
  $("#mailOutput").textContent = text || "";
}

function hideMailOutput() {
  $("#mailOutputPanel").hidden = true;
  $("#mailOutput").textContent = "";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function bindProtocolTransfer() {
  if (!$("#protocolTransferForm")) return;
  $("#protocolTransferParseButton").addEventListener("click", parseProtocolTransferInput);
  $("#protocolTransferSaveButton").addEventListener("click", saveProtocolTransferFromForm);
  $("#protocolTransferNewButton").addEventListener("click", clearProtocolTransferForm);
  $("#protocolTransferDeleteButton").addEventListener("click", deleteSelectedProtocolTransfer);
  $("#protocolTransferExportButton").addEventListener("click", exportProtocolTransferLedger);
  $("#protocolTransferSearch").addEventListener("input", renderProtocolTransferList);
  $("#protocolTransferDateFilter").addEventListener("change", renderProtocolTransferList);
  $("#protocolTransferTodayFilterButton").addEventListener("click", () => {
    $("#protocolTransferDateFilter").value = localDate(new Date());
    renderProtocolTransferList();
  });
  $("#protocolTransferAmount").addEventListener("input", () => syncProtocolTransferAmountFields("amount"));
  $("#protocolTransferQuantity").addEventListener("input", () => syncProtocolTransferAmountFields("hands"));
  $("#protocolTransferForm").addEventListener("input", (event) => clearRecognitionForInput(event.target));
  $("#protocolTransferForm").addEventListener("change", (event) => clearRecognitionForInput(event.target));
  $("#protocolTransferDocxInput").addEventListener("change", parseProtocolTransferDocument);
  $("#protocolTransferList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-protocol-transfer-id]");
    if (!button) return;
    selectedProtocolTransferId = button.dataset.protocolTransferId;
    renderProtocolTransferWorkspace();
  });
  $("#protocolTransferTodoList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-protocol-transfer-step]");
    if (!button) return;
    completeProtocolTransferStep(button.dataset.protocolTransferId, button.dataset.protocolTransferStep);
  });
  initializeProtocolTransferImport();
}

function initializeProtocolTransferImport() {
  const isReady = typeof window.mammoth?.extractRawText === "function";
  $("#protocolTransferDocxInput").disabled = false;
  $("#protocolTransferDocxButton").classList.remove("unavailable");
  $("#protocolTransferDocxButtonText").textContent = isReady ? "上传 Word/PDF/图片" : "上传 PDF/图片";
}

function renderProtocolTransferWorkspace() {
  if (!$("#protocolTransferForm")) return;
  const selected = (state.protocolTransfers || []).find((item) => item.id === selectedProtocolTransferId);
  renderProtocolTransferTodos();
  renderProtocolTransferList();
  if (selected) fillProtocolTransferForm(selected);
  else if (!$("#protocolTransferId").value) clearProtocolTransferForm(false);
}

function renderProtocolTransferTodos() {
  const todos = protocolTransferTodos(state.protocolTransfers || []);
  $("#protocolTransferTodoList").innerHTML = todos.length
    ? todos.map(({ record, step, timing }) => `
      <article class="protocol-todo-item ${timing}">
        <div>
          <strong>${escapeHtml(record.shortName || record.code || "未命名单据")}</strong>
          <span>${escapeHtml(step.dueDate)} · ${escapeHtml(step.label)}</span>
        </div>
        <button class="button subtle" type="button" data-protocol-transfer-id="${escapeAttribute(record.id)}" data-protocol-transfer-step="${escapeAttribute(step.key)}">${escapeHtml(step.label)}</button>
      </article>
    `).join("")
    : '<div class="payment-todo-empty">目前没有待处理的协议转让事项。</div>';
}

function renderProtocolTransferList() {
  const query = $("#protocolTransferSearch").value.trim().toLowerCase();
  const dateFilter = $("#protocolTransferDateFilter").value;
  const records = protocolTransferRecordsForDate(dateFilter)
    .filter((record) =>
      `${record.code} ${record.shortName} ${record.buyer} ${record.seller} ${record.finalBuyer}`.toLowerCase().includes(query),
    )
    .sort((left, right) =>
      right.tradeDate.localeCompare(left.tradeDate)
      || right.createdAt.localeCompare(left.createdAt),
    );
  $("#protocolTransferList").innerHTML = records.length
    ? records.map((record) => `
          <button class="protocol-transfer-item ${record.id === selectedProtocolTransferId ? "active" : ""}" type="button" data-protocol-transfer-id="${escapeAttribute(record.id)}">
            <span class="project-item-head">
              <strong>${escapeHtml(record.shortName || record.code || "未命名单据")}</strong>
              <span class="status-badge">${escapeHtml(protocolTransferStatus(record))}</span>
            </span>
            <span class="project-item-meta project-item-primary">
              <span>${escapeHtml(formatProtocolTransferFlow(record))}</span>
              <span class="project-item-schedule">${escapeHtml(record.tradeDate)}</span>
            </span>
            <span class="project-item-facts">
              <span>${escapeHtml(record.code || "代码待补")}</span>
              <span>${escapeHtml(record.price ? `净价${formatProtocolPrice(record.price)}` : "价格待补")}</span>
              <span>${escapeHtml(record.amountTenThousand ? `${formatNumber(record.amountTenThousand)}万` : "金额待补")}</span>
              <span>${escapeHtml(record.tradeDate ? `交易日${record.tradeDate}` : "交易日待补")}</span>
            </span>
          </button>
        `).join("")
    : '<div class="empty">暂无协议转让记录。</div>';
}

function protocolTransferRecordsForDate(date = "") {
  return normalizeProtocolTransfers(state.protocolTransfers || [])
    .filter((record) => !date || record.tradeDate === date);
}

function parseProtocolTransferInput() {
  const text = $("#protocolTransferInput").value;
  if (!text.trim()) {
    showToast("请先粘贴交易要素，或上传 Word 单据。");
    return;
  }
  const parsed = parseProtocolTransferText(text);
  protocolTransferRecognitionMarks = buildProtocolTransferRecognitionMarks(parsed, text);
  protocolTransferRecognitionId = $("#protocolTransferId").value || parsed.id || "";
  fillProtocolTransferForm({ ...parsed, id: $("#protocolTransferId").value || parsed.id });
  showToast("已识别协议转让要素，请复核后保存。");
}

function formatProtocolPrice(value) {
  return Number.isFinite(Number(value)) ? formatNumber(value) : String(value || "");
}

function formatProtocolTransferFlow(record) {
  const parties = [
    record.seller || "卖方待补",
    record.buyer || "买方/做市商待补",
    record.finalBuyer,
  ].filter(Boolean);
  return parties.join(" → ");
}

function syncProtocolTransferAmountFields(source) {
  const amountInput = $("#protocolTransferAmount");
  const handsInput = $("#protocolTransferQuantity");
  if (source === "amount") {
    const amount = numberOrNull(amountInput.value);
    if (amount !== null) handsInput.value = String(Math.round(amount * 10));
  } else {
    const hands = numberOrNull(handsInput.value);
    if (hands !== null) amountInput.value = formatNumber(hands / 10);
  }
}

async function parseProtocolTransferDocument() {
  const input = $("#protocolTransferDocxInput");
  const file = input.files[0];
  if (!file) return;
  if (!isSupportedProtocolTransferFile(file)) {
    showToast("请上传 Word、PDF 或图片格式的协议转让材料。");
    input.value = "";
    return;
  }
  try {
    setProtocolTransferImportBusy(true, `正在读取 ${file.name}...`);
    const text = await extractProtocolTransferFileText(file);
    if (!text.trim()) throw new Error("未识别到文字，请换清晰图片/PDF或直接粘贴交易要素");
    $("#protocolTransferInput").value = text;
    const parsed = parseProtocolTransferText(text);
    protocolTransferRecognitionMarks = buildProtocolTransferRecognitionMarks(parsed, text);
    protocolTransferRecognitionId = $("#protocolTransferId").value || parsed.id || "";
    fillProtocolTransferForm({ ...parsed, id: $("#protocolTransferId").value || parsed.id });
    setProtocolTransferOcrStatus("识别完成，请复核字段后保存。");
    showToast("单据已识别，请复核后保存。");
  } catch (error) {
    setProtocolTransferOcrStatus(`识别失败：${error.message || "未知错误"}`, true);
    showToast(`单据识别失败：${error.message || "未知错误"}`);
  } finally {
    input.value = "";
    setProtocolTransferImportBusy(false);
  }
}

function isSupportedProtocolTransferFile(file) {
  const name = file.name.toLowerCase();
  return name.endsWith(".docx")
    || name.endsWith(".pdf")
    || file.type.startsWith("image/");
}

async function extractProtocolTransferFileText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    if (!window.mammoth?.extractRawText) throw new Error("Word 解析组件未加载，请刷新页面后重试");
    setProtocolTransferOcrStatus("正在提取 Word 文本...");
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfTextWithOcr(file);
  }
  if (file.type.startsWith("image/")) {
    return extractImageTextWithOcr(file);
  }
  throw new Error("暂不支持该文件格式");
}

async function extractImageTextWithOcr(file) {
  await ensureTesseractReady();
  setProtocolTransferOcrStatus("正在 OCR 图片...");
  const result = await window.Tesseract.recognize(file, "chi_sim+eng", {
    logger: (message) => updateProtocolTransferOcrProgress(message, "图片 OCR"),
  });
  return result?.data?.text || "";
}

async function extractPdfTextWithOcr(file) {
  await ensurePdfJsReady();
  await ensureTesseractReady();
  setProtocolTransferOcrStatus("正在渲染 PDF...");
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(pdf.numPages, 4);
  const texts = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    setProtocolTransferOcrStatus(`正在 OCR PDF 第 ${pageNumber}/${pages} 页...`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const result = await window.Tesseract.recognize(canvas, "chi_sim+eng", {
      logger: (message) => updateProtocolTransferOcrProgress(message, `PDF 第 ${pageNumber}/${pages} 页`),
    });
    texts.push(result?.data?.text || "");
  }
  return texts.join("\n\n").trim();
}

async function ensureTesseractReady() {
  if (window.Tesseract?.recognize) return;
  setProtocolTransferOcrStatus("正在加载 OCR 组件...");
  await loadExternalScript(TESSERACT_SCRIPT_URL);
  if (!window.Tesseract?.recognize) throw new Error("OCR 组件加载失败");
}

async function ensurePdfJsReady() {
  if (window.pdfjsLib?.getDocument) return;
  setProtocolTransferOcrStatus("正在加载 PDF 解析组件...");
  await loadExternalScript(PDFJS_SCRIPT_URL);
  if (!window.pdfjsLib?.getDocument) throw new Error("PDF 解析组件加载失败");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
}

function loadExternalScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`无法加载 ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function setProtocolTransferImportBusy(isBusy, message = "") {
  $("#protocolTransferDocxInput").disabled = isBusy;
  $("#protocolTransferParseButton").disabled = isBusy;
  $("#protocolTransferDocxButton").classList.toggle("busy", isBusy);
  if (message) setProtocolTransferOcrStatus(message);
}

function updateProtocolTransferOcrProgress(message, prefix) {
  if (!message || message.status !== "recognizing text") return;
  const progress = Math.round((message.progress || 0) * 100);
  setProtocolTransferOcrStatus(`${prefix}：${progress}%`);
}

function setProtocolTransferOcrStatus(message, isError = false) {
  const status = $("#protocolTransferOcrStatus");
  if (!status) return;
  status.textContent = message || "";
  status.hidden = !message;
  status.classList.toggle("error", Boolean(isError));
}

function readProtocolTransferForm() {
  const id = $("#protocolTransferId").value;
  const existing = (state.protocolTransfers || []).find((item) => item.id === id) || null;
  return normalizeProtocolTransfer({
    id,
    code: $("#protocolTransferCode").value,
    shortName: $("#protocolTransferShortName").value,
    tradeDate: $("#protocolTransferTradeDate").value,
    materialFirstReceivedDate: existing?.materialFirstReceivedDate,
    materialConfirmedDate: existing?.materialConfirmedDate,
    type: existing?.type,
    buyer: $("#protocolTransferBuyer").value,
    seller: $("#protocolTransferSeller").value,
    finalBuyer: $("#protocolTransferFinalBuyer").value,
    price: $("#protocolTransferPrice").value,
    amountTenThousand: $("#protocolTransferAmount").value,
    quantityHands: $("#protocolTransferQuantity").value,
    remarks: $("#protocolTransferRemarks").value,
    rawText: $("#protocolTransferInput").value,
    counterpartySealDate: $("#protocolTransferCounterpartySealDate").value,
    ownSealDate: $("#protocolTransferOwnSealDate").value,
    counterpartySealed: $("#protocolTransferCounterpartySealed").checked,
    ownSealed: $("#protocolTransferOwnSealed").checked,
    exchangeSubmitted: $("#protocolTransferExchangeSubmitted").checked,
  });
}

function fillProtocolTransferForm(input) {
  const record = normalizeProtocolTransfer(input);
  if (protocolTransferRecognitionId && protocolTransferRecognitionId !== record.id) {
    protocolTransferRecognitionMarks = {};
    protocolTransferRecognitionId = "";
  }
  selectedProtocolTransferId = record.id;
  $("#protocolTransferId").value = record.id;
  $("#protocolTransferCode").value = record.code;
  $("#protocolTransferShortName").value = record.shortName;
  $("#protocolTransferTradeDate").value = record.tradeDate;
  $("#protocolTransferBuyer").value = record.buyer;
  $("#protocolTransferSeller").value = record.seller;
  $("#protocolTransferFinalBuyer").value = record.finalBuyer;
  $("#protocolTransferPrice").value = record.price ?? "";
  $("#protocolTransferAmount").value = record.amountTenThousand ?? "";
  $("#protocolTransferQuantity").value = record.quantityHands ?? "";
  $("#protocolTransferRemarks").value = record.remarks;
  $("#protocolTransferCounterpartySealDate").value = record.counterpartySealDate;
  $("#protocolTransferOwnSealDate").value = record.ownSealDate;
  $("#protocolTransferCounterpartySealed").checked = record.counterpartySealed;
  $("#protocolTransferOwnSealed").checked = record.ownSealed;
  $("#protocolTransferExchangeSubmitted").checked = record.exchangeSubmitted;
  if (record.rawText) $("#protocolTransferInput").value = record.rawText;
  $("#protocolTransferDeleteButton").hidden = !(state.protocolTransfers || []).some((item) => item.id === record.id);
  $("#protocolTransferStatusPill").textContent = protocolTransferStatus(record);
  applyProtocolTransferRecognitionMarks(record);
  renderProtocolTransferList();
}

function buildProtocolTransferRecognitionMarks(record, rawText = "") {
  const marks = {};
  const text = String(rawText || "");
  const tradeDateRecognized = protocolTextHasDate(text);
  const markRequired = (field, label, sourceValue = record[field]) => {
    marks[field] = valueHasContent(sourceValue)
      ? recognitionMark("success", `${label}已识别`)
      : recognitionMark("error", `${label}未识别，请补充`);
  };

  markRequired("code", "债券代码");
  markRequired("shortName", "债券简称");
  marks.tradeDate = valueHasContent(record.tradeDate)
    ? tradeDateRecognized
      ? recognitionMark("success", "交易日已识别")
      : recognitionMark("attention", "交易日为系统默认，请复核")
    : recognitionMark("error", "交易日未识别，请补充");
  markRequired("buyer", "买入方/做市商");
  markRequired("seller", "卖出方");
  marks.finalBuyer = valueHasContent(record.finalBuyer)
    ? recognitionMark("success", "最终买方已识别")
    : recognitionMark("attention", "最终买方未识别，如为过桥交易请补充");
  markRequired("price", "价格");
  markRequired("amountTenThousand", "交易量（万元）");
  markRequired("quantityHands", "交易量（手）");
  marks.counterpartySealDate = valueHasContent(record.counterpartySealDate)
    ? recognitionMark(tradeDateRecognized ? "success" : "attention", tradeDateRecognized ? "对手方用印日已按交易日推导" : "对手方用印日随默认交易日推导，请复核")
    : recognitionMark("attention", "对手方用印日需补充");
  marks.ownSealDate = valueHasContent(record.ownSealDate)
    ? recognitionMark(tradeDateRecognized ? "success" : "attention", tradeDateRecognized ? "本方用印日已按交易日推导" : "本方用印日随默认交易日推导，请复核")
    : recognitionMark("attention", "本方用印日需补充");
  marks.remarks = valueHasContent(record.remarks)
    ? recognitionMark("success", "备注已带入原始要素")
    : recognitionMark("attention", "备注为空，必要时补充联系人或来源信息");
  return marks;
}

function applyProtocolTransferRecognitionMarks(record) {
  if (!protocolTransferRecognitionId || protocolTransferRecognitionId !== record.id) return;
  Object.entries(protocolTransferInputIds()).forEach(([field, id]) => {
    const input = $(`#${id}`);
    if (input) setRecognitionForInput(input, protocolTransferRecognitionMarks[field]);
  });
}

function protocolTransferInputIds() {
  return {
    code: "protocolTransferCode",
    shortName: "protocolTransferShortName",
    tradeDate: "protocolTransferTradeDate",
    buyer: "protocolTransferBuyer",
    seller: "protocolTransferSeller",
    finalBuyer: "protocolTransferFinalBuyer",
    price: "protocolTransferPrice",
    amountTenThousand: "protocolTransferAmount",
    quantityHands: "protocolTransferQuantity",
    counterpartySealDate: "protocolTransferCounterpartySealDate",
    ownSealDate: "protocolTransferOwnSealDate",
    remarks: "protocolTransferRemarks",
  };
}

function protocolTextHasDate(text = "") {
  return /(20\d{2})\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}/.test(text)
    || /(?:^|[^\d])\d{1,2}[./]\d{1,2}(?!\d)/.test(text)
    || /\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text);
}

function clearProtocolTransferForm(resetInput = true) {
  selectedProtocolTransferId = "";
  protocolTransferRecognitionMarks = {};
  protocolTransferRecognitionId = "";
  $("#protocolTransferForm").reset();
  $("#protocolTransferId").value = "";
  if (resetInput) $("#protocolTransferInput").value = "";
  $("#protocolTransferDeleteButton").hidden = true;
  $("#protocolTransferStatusPill").textContent = "待录入";
  renderProtocolTransferList();
}

function saveProtocolTransferFromForm() {
  const record = readProtocolTransferForm();
  if (!record.code || !record.shortName) {
    showToast("请至少补齐债券代码和债券简称。");
    return;
  }
  state = upsertProtocolTransfer(state, record);
  selectedProtocolTransferId = record.id;
  persistState();
  renderProtocolTransferWorkspace();
  showToast("协议转让记录已保存，并纳入台账导出。");
}

function deleteSelectedProtocolTransfer() {
  const id = $("#protocolTransferId").value;
  if (!id) return;
  if (!confirm("确认删除这笔协议转让记录？")) return;
  state = removeProtocolTransfer(state, id);
  selectedProtocolTransferId = "";
  persistState();
  clearProtocolTransferForm();
  renderProtocolTransferWorkspace();
  showToast("协议转让记录已删除。");
}

function completeProtocolTransferStep(id, step) {
  const record = (state.protocolTransfers || []).find((item) => item.id === id);
  if (!record) return;
  const next = markProtocolTransferStep(record, step);
  state = upsertProtocolTransfer(state, next);
  selectedProtocolTransferId = next.id;
  persistState();
  renderProtocolTransferWorkspace();
  showToast(`${next.shortName || next.code} 已完成：${step === "counterparty" ? "对手方用印" : step === "own" ? "本方用印" : "递交上交所"}`);
}

async function exportProtocolTransferLedger() {
  const tradeDate = $("#protocolTransferDateFilter").value;
  if (!tradeDate) {
    showToast("请先选择要导出的交易日。");
    return;
  }
  const rows = buildProtocolTransferLedgerRows(protocolTransferRecordsForDate(tradeDate));
  if (rows.length <= 1) {
    showToast(`${tradeDate} 暂无协议转让记录可导出。`);
    return;
  }

  const button = $("#protocolTransferExportButton");
  if (button) button.disabled = true;
  try {
    await ensureExcelJsReady();
    const workbook = new window.ExcelJS.Workbook();
    const template = await fetch(PROTOCOL_TRANSFER_TEMPLATE_URL, { cache: "no-store" });
    if (!template.ok) throw new Error("协议转让台账模板读取失败");
    await workbook.xlsx.load(await template.arrayBuffer());
    const sheet = workbook.getWorksheet("2024") || workbook.worksheets[0];
    if (!sheet) throw new Error("协议转让台账模板缺少工作表");

    fillProtocolTransferLedgerTemplate(sheet, rows.slice(1));
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(`债券协议转让台账${tradeDate.replaceAll("-", "")}.xlsx`, new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    showToast(`已导出 ${tradeDate} 协议转让 xlsx 台账。`);
  } catch (error) {
    showToast(error.message || "导出台账失败。");
  } finally {
    if (button) button.disabled = false;
  }
}

async function ensureExcelJsReady() {
  if (window.ExcelJS?.Workbook) return;
  await loadExternalScript(EXCELJS_SCRIPT_URL);
  if (!window.ExcelJS?.Workbook) throw new Error("Excel 导出组件加载失败");
}

function fillProtocolTransferLedgerTemplate(sheet, records) {
  const startRowNumber = 2;
  const originalRowCount = sheet.rowCount;
  const endRowNumber = Math.max(originalRowCount, startRowNumber + records.length - 1);
  const templateRow = sheet.getRow(startRowNumber);

  for (let rowNumber = startRowNumber; rowNumber <= endRowNumber; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (rowNumber > originalRowCount) copyProtocolTransferTemplateRow(templateRow, row);
    for (let column = 1; column <= 12; column += 1) row.getCell(column).value = "";
    row.commit?.();
  }

  records.forEach((record, index) => {
    const rowNumber = startRowNumber + index;
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= 12; column += 1) {
      const cell = row.getCell(column);
      cell.value = formatProtocolTransferLedgerCell(record[column - 1], column);
      if ([4, 5, 6].includes(column)) cell.numFmt = "yyyy/m/d";
    }
    row.commit?.();
  });
}

function copyProtocolTransferTemplateRow(sourceRow, targetRow) {
  targetRow.height = sourceRow.height;
  for (let column = 1; column <= 12; column += 1) {
    const sourceCell = sourceRow.getCell(column);
    const targetCell = targetRow.getCell(column);
    targetCell.style = JSON.parse(JSON.stringify(sourceCell.style || {}));
  }
}

function formatProtocolTransferLedgerCell(value, column) {
  if (value === "" || value === null || value === undefined) return "";
  if ([4, 5, 6].includes(column)) return excelDateSerialFromLocalDate(value) ?? value;
  return value;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function delayProjectCutoffFromTodo(projectId, minutes) {
  const projectValue = (state.projects || []).find((item) => item.id === projectId);
  if (!projectValue?.cutoffAt) return;
  const date = new Date(projectValue.cutoffAt);
  date.setMinutes(date.getMinutes() + minutes);
  const next = updateProjectCutoff(projectValue, localDateTime(date), `延期${minutes}分钟`, true);
  state = upsertProject(state, next);
  persistState();
  renderProjectWorkspace();
  showToast(`${next.shortName} 已延期${minutes}分钟。`);
}

function renderPaymentTodo() {
  const today = localDate(new Date());
  const todos = (state.projects || []).flatMap((projectValue) =>
    (projectValue.tranches || []).flatMap((tranche) =>
      projectValue.resultConfirmed && trancheNeedsPayment(tranche, today)
        ? [{ project: projectValue, tranche }]
        : [],
    ),
  ).sort((left, right) => left.tranche.paymentDate.localeCompare(right.tranche.paymentDate));
  $("#paymentTodoPanel").classList.toggle("empty-state", !todos.length);
  $("#paymentTodoList").innerHTML = todos.length
    ? todos.map(({ project: projectValue, tranche }) => {
        const timing = tranche.paymentDate < today ? "overdue" : tranche.paymentDate === today ? "today" : "upcoming";
        const timingLabel = timing === "overdue" ? "已逾期" : timing === "today" ? "今日缴款" : tranche.paymentDate;
        const addBondNote = tranche.paymentDate === today && isAbsOrAbnProject(projectValue, tranche) ? " · 需加券" : "";
        return `
          <article class="payment-todo-item ${timing}">
            <button class="payment-todo-main" type="button" data-open-payment-project="${escapeAttribute(projectValue.id)}">
              <strong>${escapeHtml(tranche.shortName || projectValue.shortName)}</strong>
              <span>${escapeHtml(projectValue.issuerName || projectValue.branch || "主体待补")} · ${escapeHtml(timingLabel)}${escapeHtml(addBondNote)}</span>
            </button>
            <button class="button subtle" type="button" data-complete-payment="${escapeAttribute(`${projectValue.id}:${tranche.id}`)}">缴款</button>
          </article>
        `;
      }).join("")
    : '<div class="payment-todo-empty">目前没有待缴款任务。</div>';
}

function isAbsOrAbnProject(projectValue, tranche = {}) {
  return /(?:ABS|ABN)/i.test(`${projectValue.shortName} ${tranche.shortName} ${projectValue.sourceText}`);
}

function completePaymentTodo(value) {
  const [projectId, trancheId] = value.split(":");
  const projectValue = (state.projects || []).find((item) => item.id === projectId);
  if (!projectValue) return;
  const next = normalizeProjectRecord({
    ...projectValue,
    resultConfirmed: true,
    tranches: projectValue.tranches.map((tranche) =>
      tranche.id === trancheId ? { ...tranche, paymentCompleted: true } : tranche,
    ),
  });
  next.status = deriveProjectStatus(next);
  state = upsertProject(state, next);
  persistState();
  renderProjectWorkspace();
  showToast(`${next.shortName} 已标记完成缴款。`);
}

function setLedgerFilter(nextFilter) {
  ledgerFilter = LEDGER_FILTER_LABELS[nextFilter] ? nextFilter : "all";
  syncLedgerFilterControls();
  renderProjectList();
}

function syncLedgerFilterControls() {
  $$("[data-ledger-filter]").forEach((item) => {
    item.classList.toggle("active", item.dataset.ledgerFilter === ledgerFilter);
  });
  const select = $("#ledgerFilterSelect");
  if (select) {
    const selectValue = LEDGER_FILTER_SELECT_VALUES.has(ledgerFilter) ? ledgerFilter : "all";
    if (select.value !== selectValue) select.value = selectValue;
  }
  const label = LEDGER_FILTER_LABELS[ledgerFilter] || LEDGER_FILTER_LABELS.all;
  $("#ledgerFilterLabel").textContent = `当前：${label}`;
}

function renderProjectList() {
  syncLedgerFilterControls();
  const query = $("#projectSearch").value.trim().toLowerCase();
  const statusFilter = $("#projectStatusFilter").value;
  const dateFilter = $("#projectDateFilter").value;
  const today = localDate(new Date());
  const projects = (state.projects || [])
    .filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (dateFilter && !projectMatchesDateFilter(item, dateFilter)) return false;
      if (ledgerFilter === "dueToday" && !(["未投标", "待投标"].includes(item.status) && item.cutoffAt?.slice(0, 10) === today)) return false;
      if (ledgerFilter === "toBid" && !["未投标", "待投标"].includes(item.status)) return false;
      if (ledgerFilter === "awaitingResult" && item.status !== "已投标待结果") return false;
      if (ledgerFilter === "won" && !["部分中标", "已中标", "待缴款", "已缴款"].includes(item.status)) return false;
      if (ledgerFilter === "notWon" && item.status !== "未中标") return false;
      if (ledgerFilter === "paymentToday" && !(item.resultConfirmed && item.tranches?.some((tranche) => tranche.paymentDate === today && trancheNeedsPayment(tranche, today)))) return false;
      return `${item.shortName} ${item.issuerName} ${item.branch} ${item.leadUnderwriter}`.toLowerCase().includes(query);
    })
    .sort(compareProjects);

  $("#projectList").innerHTML = projects.length
    ? projects.map((item) => `
      <button class="project-item ${item.id === selectedProjectId ? "active" : ""}" data-project-id="${escapeAttribute(item.id)}" ${item.id === selectedProjectId ? 'aria-current="true"' : ""}>
        <span class="project-item-head">
          <strong>${escapeHtml(item.shortName || "未命名项目")}</strong>
          <span class="status-badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>
        </span>
        <span class="project-item-meta project-item-primary">
          <span class="project-item-issuer">${escapeHtml(item.issuerName || item.branch || "未填写主体")}</span>
          <span class="project-item-schedule">${escapeHtml(formatProjectSchedule(item))}</span>
        </span>
        <span class="project-item-facts">
          <span>${escapeHtml(formatTrancheDurationSummary(item))}</span>
          <span>${escapeHtml(formatProjectScaleSummary(item))}</span>
          <span>${escapeHtml(formatInquirySummary(item.tranches))}</span>
          <span>${escapeHtml(formatProjectOfferingSummary(item) || "发行方式待补")}</span>
          <span>${escapeHtml(formatProjectVenueLead(item))}</span>
        </span>
      </button>
    `).join("")
    : '<div class="empty">当前筛选下暂无项目。</div>';

  $$("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedProjectId = button.dataset.projectId;
      renderProjectWorkspace();
    });
  });
}

function projectMatchesDateFilter(projectValue, date) {
  if (!date) return true;
  if (projectValue.cutoffAt?.slice(0, 10) === date) return true;
  return (projectValue.tranches || []).some((tranche) =>
    tranche.paymentDate === date && !tranche.paymentCompleted,
  );
}

function clearProjectForm() {
  $("#projectEmpty").hidden = false;
  $("#projectForm").hidden = true;
  resultRecognitionMarks = {};
  resultRecognitionProjectId = "";
}

function fillProjectForm(input) {
  const record = normalizeProjectRecord(input);
  if (resultRecognitionProjectId && resultRecognitionProjectId !== record.id) {
    resultRecognitionMarks = {};
    resultRecognitionProjectId = "";
  }
  $("#projectEmpty").hidden = true;
  $("#projectForm").hidden = false;
  closeResultEntryPanel();
  setResultEntryFieldsVisible(record.resultConfirmed);
  $("#projectId").value = record.id;
  $("#projectStatus").value = record.status;
  $("#projectSummaryIssuer").textContent = record.issuerName || "主体待补";
  $("#projectSummaryBranch").textContent = record.branch || "分行待补";
  $("#projectSummaryVenue").textContent = record.venue || "场所待补";
  $("#projectSummarySponsor").textContent = record.sponsorStatus || "身份待补";
  $("#projectSummaryLead").textContent = record.leadUnderwriter || "主承待补";
  $("#projectSummaryInquiry").textContent = formatInquirySummary(record.tranches);
  $("#projectCutoffAt").value = record.cutoffAt;
  $("#projectCutoffTimeConfirmed").value = record.cutoffTimeConfirmed ? "true" : "false";
  $("#projectCutoffSource").value = record.cutoffSource;
  $("#projectSourceText").value = record.sourceText;
  $("#projectOpinion").value = record.opinion;
  $("#projectResultAdvertisement").value = record.resultAdvertisement;
  $("#projectFtpCost").value = record.ftpCost ?? "";
  $("#projectBidPosition").value = buildBidPositionText(record);
  $("#projectResultSummary").value = buildAwardResultText(record);
  $("#projectFormTitle").textContent = record.shortName || "项目详情";
  $("#projectStatusPill").textContent = record.status;
  $("#projectAutosaveStatus").textContent = "已实时保存";
  updateProjectActionButtons(record.status);
  renderCutoffHint(record);
  renderTranches(record.tranches);
  applyResultRecognitionMarks(record);
  renderProjectList();
}

function refillProjectForm(input) {
  const showResult = $("#projectForm").classList.contains("show-result-entry");
  const modalOpen = !$("#resultEntryPanel").hidden;
  fillProjectForm(input);
  setResultEntryFieldsVisible(showResult || Boolean(input.resultConfirmed));
  if (modalOpen) openResultEntryPanel(false);
}

function renderBidLevels(tranche, trancheIndex) {
  const levels = bidLevelsForDisplay(tranche);
  return `
    <div class="bid-level-list">
      ${levels.map((level, levelIndex) => `
        <div class="bid-level-card" data-bid-level-index="${levelIndex}" data-bid-level-id="${escapeAttribute(level.id || "")}">
          <div class="outsourced-card-head">
            <strong>表内标位 ${levelIndex + 1}</strong>
            <button class="text-button" type="button" data-remove-bid-level="${trancheIndex}:${levelIndex}" ${levels.length <= 1 ? "hidden" : ""}>移除</button>
          </div>
          <div class="tranche-grid">
            <label>投标利率（%）<input data-bid-level-field="bidRate" type="number" step="0.0001" value="${escapeAttribute(level.bidRate ?? "")}"></label>
            <label>投标量（亿元）<input data-bid-level-field="bidAmount" type="number" step="0.0001" value="${escapeAttribute(level.bidAmount ?? "")}"></label>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function bidLevelsForDisplay(tranche) {
  const levels = Array.isArray(tranche.bidLevels) && tranche.bidLevels.length
    ? tranche.bidLevels
    : [{ id: "", bidRate: tranche.bidRate, bidAmount: tranche.bidAmount }];
  return levels.length ? levels : [{ id: "", bidRate: null, bidAmount: null }];
}

function renderTranches(tranches) {
  $("#trancheList").innerHTML = tranches.map((tranche, index) => `
    <section class="tranche-card" data-tranche-index="${index}">
      <div class="tranche-card-head">
        <strong>品种 ${index + 1}</strong>
        <button class="text-button" type="button" data-remove-tranche="${index}" ${tranches.length <= 1 ? "hidden" : ""}>移除品种</button>
      </div>
      <div class="tranche-section bid-entry-section">
        <div class="tranche-subheading first-subheading">
          <strong>投标标位</strong>
          <div class="tranche-subheading-actions">
            <button class="text-button" type="button" data-add-bid-level="${index}">增加表内标位</button>
            <button class="text-button" type="button" data-add-outsourced="${index}">增加委外标位</button>
          </div>
        </div>
        <div class="tranche-grid">
          <label>债券简称<input data-tranche-field="shortName" value="${escapeAttribute(tranche.shortName)}"></label>
          <label>期限<input data-tranche-field="durationText" value="${escapeAttribute(tranche.durationText)}"></label>
          <label>比例限制（%）<input data-tranche-field="suggestedRatio" type="number" step="0.01" value="${escapeAttribute(tranche.suggestedRatio ?? "")}"></label>
          <label>投标类型
            <select data-tranche-field="bidAction">
              <option value="" ${!tranche.bidAction ? "selected" : ""}>自动</option>
              <option value="投标" ${tranche.bidAction === "投标" ? "selected" : ""}>投标</option>
              <option value="改标" ${tranche.bidAction === "改标" ? "selected" : ""}>改标</option>
              <option value="参团+投标" ${tranche.bidAction === "参团+投标" ? "selected" : ""}>参团+投标</option>
            </select>
          </label>
        </div>
        ${renderBidLevels(tranche, index)}
        <div class="outsourced-list">
          ${(tranche.outsourcedBids || []).map((outsourced, outsourcedIndex) => `
            <div class="outsourced-card" data-outsourced-index="${outsourcedIndex}">
              <div class="outsourced-card-head">
                <strong>委外标位 ${outsourcedIndex + 1}</strong>
                <button class="text-button" type="button" data-remove-outsourced="${index}:${outsourcedIndex}">移除</button>
              </div>
              <div class="tranche-grid">
                <label>委外机构<input data-outsourced-field="managerName" value="${escapeAttribute(outsourced.managerName)}"></label>
                <label>投标利率（%）<input data-outsourced-field="bidRate" type="number" step="0.0001" value="${escapeAttribute(outsourced.bidRate ?? "")}"></label>
                <label>投标量（亿元）<input data-outsourced-field="bidAmount" type="number" step="0.0001" value="${escapeAttribute(outsourced.bidAmount ?? "")}"></label>
              </div>
            </div>
          `).join("") || '<div class="empty compact">暂无委外标位。</div>'}
        </div>
      </div>

      <div class="result-entry-fields tranche-section">
        <div class="tranche-subheading first-subheading"><strong>表内中标结果</strong></div>
        <div class="tranche-grid">
          <label>截标结果
            <select data-tranche-field="resultStatus">
              <option ${tranche.resultStatus === "待出结果" ? "selected" : ""}>待出结果</option>
              <option ${tranche.resultStatus === "中标" ? "selected" : ""}>中标</option>
              <option ${tranche.resultStatus === "未中标" ? "selected" : ""}>未中标</option>
            </select>
          </label>
          <label>票面 / 中标利率（%）<input data-tranche-field="winningRate" type="number" step="0.0001" value="${escapeAttribute(tranche.winningRate ?? "")}"></label>
          <label>表内中标量（万元）<input data-tranche-field="winningAmountWan" type="number" step="0.01" value="${escapeAttribute(tranche.winningAmountWan ?? "")}"></label>
          <label>综合定价
            <select data-tranche-field="pricingMode">
              <option ${tranche.pricingMode === "未综" ? "selected" : ""}>未综</option>
              <option ${tranche.pricingMode === "综合定价" ? "selected" : ""}>综合定价</option>
            </select>
          </label>
          <label>综合定价至（%）<input data-tranche-field="pricingRate" type="number" step="0.0001" value="${escapeAttribute(tranche.pricingRate ?? "")}"></label>
          <label>营收（BP）<input data-tranche-field="revenueBp" type="number" step="0.0001" value="${escapeAttribute(tranche.revenueBp ?? "")}"></label>
        </div>
      </div>

      <div class="result-entry-fields tranche-section">
        <div class="tranche-subheading first-subheading"><strong>委外中标结果</strong></div>
        <div class="outsourced-list">
          ${(tranche.outsourcedBids || []).map((outsourced, outsourcedIndex) => `
            <div class="outsourced-card result-card" data-outsourced-result-index="${outsourcedIndex}">
              <div class="outsourced-card-head">
                <strong>${escapeHtml(outsourced.managerName || `委外 ${outsourcedIndex + 1}`)}</strong>
              </div>
              <div class="tranche-grid">
                <label>中标量（万元）<input data-outsourced-field="winningAmountWan" type="number" step="0.01" value="${escapeAttribute(outsourced.winningAmountWan ?? "")}"></label>
                <label>综合定价
                  <select data-outsourced-field="pricingMode">
                    <option ${outsourced.pricingMode === "未综" ? "selected" : ""}>未综</option>
                    <option ${outsourced.pricingMode === "综合定价" ? "selected" : ""}>综合定价</option>
                  </select>
                </label>
                <label>综合定价至（%）<input data-outsourced-field="pricingRate" type="number" step="0.0001" value="${escapeAttribute(outsourced.pricingRate ?? "")}"></label>
              </div>
            </div>
          `).join("") || '<div class="empty compact">暂无委外中标结果。</div>'}
        </div>
      </div>

      <div class="result-entry-fields tranche-section">
        <div class="tranche-subheading first-subheading"><strong>发行结果与缴款</strong></div>
        <div class="tranche-grid">
          <label>债券代码<input data-tranche-field="securityCode" value="${escapeAttribute(tranche.securityCode)}"></label>
          <label>发行规模（亿元）<input data-tranche-field="issueScale" type="number" step="0.0001" value="${escapeAttribute(tranche.issueScale ?? "")}"></label>
          <label>全场倍数<input data-tranche-field="fullMarketMultiple" type="number" step="0.0001" value="${escapeAttribute(tranche.fullMarketMultiple ?? "")}"></label>
          <label>边际倍数<input data-tranche-field="marginalMultiple" type="number" step="0.0001" value="${escapeAttribute(tranche.marginalMultiple ?? "")}"></label>
          <label>起息日期<input data-tranche-field="startDate" type="date" value="${escapeAttribute(tranche.startDate)}"></label>
          <label>缴款日期<input data-tranche-field="paymentDate" type="date" value="${escapeAttribute(tranche.paymentDate)}"></label>
          <label class="span-3">回拨 / 结果备注<input data-tranche-field="allocationNote" value="${escapeAttribute(tranche.allocationNote)}"></label>
          <label class="checkbox-label compact-checkbox"><input data-tranche-field="paymentCompleted" type="checkbox" ${tranche.paymentCompleted ? "checked" : ""}>已完成缴款</label>
        </div>
      </div>
    </section>
  `).join("");

  $$("[data-remove-tranche]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = readProjectForm();
      draft.tranches.splice(Number(button.dataset.removeTranche), 1);
      refillProjectForm(draft);
      saveProjectDraftNow();
    });
  });
  $$("[data-add-bid-level]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = readProjectForm();
      draft.tranches[Number(button.dataset.addBidLevel)].bidLevels.push({
        id: crypto.randomUUID(),
        bidRate: null,
        bidAmount: null,
      });
      refillProjectForm(draft);
      saveProjectDraftNow();
    });
  });
  $$("[data-remove-bid-level]").forEach((button) => {
    button.addEventListener("click", () => {
      const [trancheIndex, levelIndex] = button.dataset.removeBidLevel.split(":").map(Number);
      const draft = readProjectForm();
      draft.tranches[trancheIndex].bidLevels.splice(levelIndex, 1);
      if (!draft.tranches[trancheIndex].bidLevels.length) {
        draft.tranches[trancheIndex].bidLevels.push({ id: crypto.randomUUID(), bidRate: null, bidAmount: null });
      }
      refillProjectForm(draft);
      saveProjectDraftNow();
    });
  });
  $$("[data-add-outsourced]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = readProjectForm();
      draft.tranches[Number(button.dataset.addOutsourced)].outsourcedBids.push({
        id: crypto.randomUUID(),
        managerName: "",
        bidRate: null,
        bidAmount: null,
        winningAmountWan: null,
        pricingMode: "未综",
        pricingRate: null,
      });
      refillProjectForm(draft);
      saveProjectDraftNow();
    });
  });
  $$("[data-remove-outsourced]").forEach((button) => {
    button.addEventListener("click", () => {
      const [trancheIndex, outsourcedIndex] = button.dataset.removeOutsourced.split(":").map(Number);
      const draft = readProjectForm();
      draft.tranches[trancheIndex].outsourcedBids.splice(outsourcedIndex, 1);
      refillProjectForm(draft);
      saveProjectDraftNow();
    });
  });
}

function buildResultRecognitionMarks(beforeProject, afterProject, parsedAdvertisement) {
  const marks = {};
  const items = parsedAdvertisement?.items || [];
  const tranches = afterProject.tranches || [];
  tranches.forEach((tranche, index) => {
    const item = matchAdvertisementItemForRecognition(tranche, index, items);
    const base = `tranche.${index}`;
    const hasCoupon = Number.isFinite(numberOrNull(item?.couponRate));
    const hasIssueScale = Number.isFinite(numberOrNull(item?.issueScale));
    const hasPaymentDate = valueHasContent(item?.paymentDate);
    const hasStartDate = valueHasContent(item?.startDate);

    marks[`${base}.resultStatus`] = tranche.resultStatus && tranche.resultStatus !== "待出结果"
      ? recognitionMark("success", "截标结果已按票面和标位推算")
      : recognitionMark("attention", "截标结果需要复核或补充标位");
    marks[`${base}.winningRate`] = hasCoupon
      ? recognitionMark("success", "票面/中标利率已识别")
      : recognitionMark("error", "票面/中标利率未识别，请补充");
    marks[`${base}.winningAmountWan`] = Number.isFinite(numberOrNull(tranche.winningAmountWan))
      ? recognitionMark("success", "表内中标量已自动推算")
      : recognitionMark("attention", "表内中标量需复核或补充投标标位");
    marks[`${base}.pricingMode`] = valueHasContent(tranche.pricingMode)
      ? recognitionMark("success", "综合定价状态已带入")
      : recognitionMark("attention", "综合定价状态需确认");
    if (tranche.pricingMode === "综合定价") {
      marks[`${base}.pricingRate`] = Number.isFinite(numberOrNull(tranche.pricingRate))
        ? recognitionMark("success", "综合定价价格已带入")
        : recognitionMark("attention", "综合定价价格需补充");
    }
    if (Number.isFinite(numberOrNull(tranche.winningAmountWan)) && numberOrNull(tranche.winningAmountWan) > 0) {
      marks[`${base}.revenueBp`] = Number.isFinite(numberOrNull(tranche.revenueBp))
        ? recognitionMark("success", "营收已按 FTP 曲线计算")
        : recognitionMark("attention", "营收未计算，请检查 FTP 曲线或期限");
    }

    marks[`${base}.securityCode`] = valueHasContent(item?.securityCode)
      ? recognitionMark("success", "债券代码已识别")
      : recognitionMark("attention", "债券代码未识别，必要时补充");
    marks[`${base}.issueScale`] = hasIssueScale
      ? recognitionMark("success", "发行规模已识别")
      : recognitionMark("error", "发行规模未识别，请补充");
    marks[`${base}.fullMarketMultiple`] = Number.isFinite(numberOrNull(item?.fullMarketMultiple))
      ? recognitionMark("success", "全场倍数已识别")
      : recognitionMark("attention", "全场倍数未披露或未识别");
    if (Number.isFinite(numberOrNull(item?.marginalMultiple))) {
      marks[`${base}.marginalMultiple`] = recognitionMark("success", "边际倍数已识别");
    } else if (hasMarginalBidForRecognition(tranche)) {
      marks[`${base}.marginalMultiple`] = recognitionMark("attention", "标位在边际上，未识别边际倍数时按全中处理，请复核");
    }
    marks[`${base}.startDate`] = hasStartDate
      ? recognitionMark("success", "起息日期已识别")
      : recognitionMark("attention", "起息日期未识别，必要时补充");
    marks[`${base}.paymentDate`] = hasPaymentDate
      ? recognitionMark("success", "缴款日期已识别")
      : valueHasContent(tranche.paymentDate)
        ? recognitionMark("attention", "缴款日期为系统推导，请复核")
        : recognitionMark("error", "缴款日期未识别，请补充");
    if (valueHasContent(item?.allocationNote)) {
      marks[`${base}.allocationNote`] = recognitionMark("success", "回拨/结果备注已识别");
    }

    (tranche.outsourcedBids || []).forEach((outsourced, outsourcedIndex) => {
      const outsourcedBase = `${base}.outsourced.${outsourcedIndex}`;
      if (Number.isFinite(numberOrNull(outsourced.winningAmountWan))) {
        marks[`${outsourcedBase}.winningAmountWan`] = recognitionMark("success", "委外中标量已自动推算");
      } else if (Number.isFinite(numberOrNull(outsourced.bidRate)) && Number.isFinite(numberOrNull(outsourced.bidAmount))) {
        marks[`${outsourcedBase}.winningAmountWan`] = recognitionMark("attention", "委外中标量需复核");
      }
      marks[`${outsourcedBase}.pricingMode`] = valueHasContent(outsourced.pricingMode)
        ? recognitionMark("success", "委外综合定价状态已带入")
        : recognitionMark("attention", "委外综合定价状态需确认");
      if (outsourced.pricingMode === "综合定价") {
        marks[`${outsourcedBase}.pricingRate`] = Number.isFinite(numberOrNull(outsourced.pricingRate))
          ? recognitionMark("success", "委外综合定价价格已带入")
          : recognitionMark("attention", "委外综合定价价格需补充");
      }
    });
  });
  return marks;
}

function applyResultRecognitionMarks(record) {
  if (!resultRecognitionProjectId || resultRecognitionProjectId !== record.id) return;
  $("#projectForm").querySelectorAll("[data-tranche-index]").forEach((card) => {
    const index = Number(card.dataset.trancheIndex);
    card.querySelectorAll("[data-tranche-field]").forEach((input) => {
      const field = input.dataset.trancheField;
      setRecognitionForInput(input, resultRecognitionMarks[`tranche.${index}.${field}`]);
    });
    card.querySelectorAll("[data-outsourced-result-index]").forEach((outsourcedCard) => {
      const outsourcedIndex = Number(outsourcedCard.dataset.outsourcedResultIndex);
      outsourcedCard.querySelectorAll("[data-outsourced-field]").forEach((input) => {
        const field = input.dataset.outsourcedField;
        setRecognitionForInput(input, resultRecognitionMarks[`tranche.${index}.outsourced.${outsourcedIndex}.${field}`]);
      });
    });
  });
}

function matchAdvertisementItemForRecognition(tranche, index, items) {
  const shortName = stripTrancheSuffixForRecognition(tranche.shortName);
  return items.find((item) =>
    item?.shortName
    && (
      item.shortName === tranche.shortName
      || stripTrancheSuffixForRecognition(item.shortName) === shortName
      || tranche.shortName?.includes(item.shortName)
      || item.shortName?.includes(tranche.shortName)
    )
  ) || items[index] || {};
}

function stripTrancheSuffixForRecognition(value = "") {
  return String(value || "").trim().replace(/((?:SCP|CP|MTN|PPN)\d{3})[A-Z]$/i, "$1");
}

function hasMarginalBidForRecognition(tranche) {
  const coupon = numberOrNull(tranche.winningRate);
  if (!Number.isFinite(coupon)) return false;
  return (tranche.bidLevels || [])
    .some((level) => Math.abs(numberOrNull(level.bidRate) - coupon) <= 0.000001);
}

function readProjectForm() {
  const existing = (state.projects || []).find((item) => item.id === $("#projectId").value) || {};
  const tranches = $$("[data-tranche-index]").map((card) => {
    const values = {};
    card.querySelectorAll("[data-tranche-field]").forEach((input) => {
      values[input.dataset.trancheField] = input.type === "checkbox"
        ? input.checked
        : input.type === "number"
          ? numberOrNull(input.value)
          : input.value.trim();
    });
    const trancheIndex = Number(card.dataset.trancheIndex);
    values.id = existing.tranches?.[trancheIndex]?.id;
    values.inquiryLow = existing.tranches?.[trancheIndex]?.inquiryLow;
    values.inquiryHigh = existing.tranches?.[trancheIndex]?.inquiryHigh;
    values.bidLevels = [...card.querySelectorAll("[data-bid-level-index]")].map((levelCard) => {
      const level = {};
      levelCard.querySelectorAll("[data-bid-level-field]").forEach((input) => {
        level[input.dataset.bidLevelField] = numberOrNull(input.value);
      });
      const levelIndex = Number(levelCard.dataset.bidLevelIndex);
      level.id = levelCard.dataset.bidLevelId || existing.tranches?.[trancheIndex]?.bidLevels?.[levelIndex]?.id;
      return level;
    });
    values.outsourcedBids = [...card.querySelectorAll("[data-outsourced-index]")].map((outsourcedCard) => {
      const outsourced = {};
      outsourcedCard.querySelectorAll("[data-outsourced-field]").forEach((input) => {
        outsourced[input.dataset.outsourcedField] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
      });
      const outsourcedIndex = Number(outsourcedCard.dataset.outsourcedIndex);
      const resultCard = card.querySelector(`[data-outsourced-result-index="${outsourcedIndex}"]`);
      resultCard?.querySelectorAll("[data-outsourced-field]").forEach((input) => {
        outsourced[input.dataset.outsourcedField] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
      });
      outsourced.id = existing.tranches?.[trancheIndex]?.outsourcedBids?.[outsourcedIndex]?.id;
      return outsourced;
    });
    return values;
  });
  const record = applySourceGuidancePricing(normalizeProjectRecord({
    ...existing,
    id: $("#projectId").value,
    shortName: existing.shortName,
    status: $("#projectStatus").value,
    issuerName: existing.issuerName,
    branch: existing.branch,
    venue: existing.venue,
    leadUnderwriter: existing.leadUnderwriter,
    sponsorStatus: existing.sponsorStatus,
    cutoffAt: $("#projectCutoffAt").value,
    cutoffTimeConfirmed: $("#projectCutoffTimeConfirmed").value === "true",
    cutoffSource: $("#projectCutoffSource").value,
    notes: existing.notes,
    sourceText: $("#projectSourceText").value,
    opinion: $("#projectOpinion").value,
    resultAdvertisement: $("#projectResultAdvertisement").value,
    ftpCost: numberOrNull($("#projectFtpCost").value),
    tranches,
  }));
  return applyFtpRevenueToProject(record);
}

function applyFtpRevenueToProject(record) {
  const normalized = normalizeProjectRecord(record);
  let changed = false;
  const tranches = normalized.tranches.map((tranche) => {
    const winningRate = numberOrNull(tranche.winningRate);
    const winningAmount = numberOrNull(tranche.winningAmountWan);
    const ftpCost = calculateFtpForDuration(tranche.durationText, state.ftpCurve) ?? normalizeFtpRatePercent(normalized.ftpCost);
    if (!Number.isFinite(winningRate) || !Number.isFinite(winningAmount) || winningAmount <= 0 || !Number.isFinite(ftpCost)) {
      return tranche;
    }
    const revenueBp = calculateRevenueBpFromFtpRate(winningRate, ftpCost);
    if (tranche.revenueBp !== revenueBp) changed = true;
    return { ...tranche, revenueBp };
  });
  return changed ? normalizeProjectRecord({ ...normalized, tranches }) : normalized;
}

function updateProjectPreviews() {
  if ($("#projectForm").hidden) return;
  const draft = readProjectForm();
  $("#projectBidPosition").value = buildBidPositionText(draft);
  $("#projectResultSummary").value = buildAwardResultText(draft);
}

function recalculateRevenueFromFtp() {
  if ($("#projectForm").hidden) return;
  const draft = readProjectForm();
  let changed = false;
  draft.tranches = draft.tranches.map((tranche) => {
    const winningRate = numberOrNull(tranche.winningRate);
    const winningAmount = numberOrNull(tranche.winningAmountWan);
    const ftpCost = calculateFtpForDuration(tranche.durationText, state.ftpCurve) ?? normalizeFtpRatePercent(draft.ftpCost);
    if (!Number.isFinite(winningRate) || !Number.isFinite(winningAmount) || winningAmount <= 0) return tranche;
    if (!Number.isFinite(ftpCost)) return tranche;
    changed = true;
    return { ...tranche, revenueBp: calculateRevenueBpFromFtpRate(winningRate, ftpCost) };
  });
  if (!changed) return;
  refillProjectForm(draft);
  saveProjectRecordNow(draft);
  showToast("已按 FTP 曲线重算表内营收。");
}

function applyCutoffAction(action) {
  const draft = readProjectForm();
  const current = draft.cutoffAt ? new Date(draft.cutoffAt) : new Date();
  const defaultTime = ["上交所", "深交所", "北交所"].includes(draft.venue) ? "19:00" : "18:00";
  let next;
  let reason;
  if (action.startsWith("delay-")) {
    const minutes = Number(action.split("-")[1]);
    next = new Date(current);
    next.setMinutes(next.getMinutes() + minutes);
    reason = `延期${minutes}分钟`;
  } else {
    next = new Date();
    if (action === "tomorrow") next.setDate(next.getDate() + 1);
    if (action === "next-business-day") {
      next.setDate(next.getDate() + 1);
      while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
    }
    const time = draft.cutoffAt?.slice(11, 16) || defaultTime;
    const [hours, minutes] = time.split(":").map(Number);
    next.setHours(hours, minutes, 0, 0);
    reason = action === "today" ? "快捷设置今天" : action === "tomorrow" ? "快捷设置明天" : "快捷设置下一工作日";
  }
  const updated = updateProjectCutoff(draft, localDateTime(next), reason, true);
  refillProjectForm(updated);
  saveProjectRecordNow(updated);
  showToast(`${updated.shortName} 截标时间已更新。`);
}

function renderCutoffHint(projectValue) {
  const issuer = state.issuers.find((item) => item.id === projectValue.issuerId);
  const latest = projectValue.cutoffHistory?.at(-1);
  const privateWarning = issuer?.enterpriseType === "民营企业" && projectValue.venue === "银行间" && !projectValue.cutoffTimeConfirmed
    ? "民企银行间项目可能延期，请确认最终截标时间。"
    : "";
  const unconfirmed = !projectValue.cutoffTimeConfirmed
    ? `截标时间待确认。来源：${projectValue.cutoffSource || "自动建议"}`
    : "";
  const history = latest ? `原 ${formatCutoff(latest.from)}，${latest.reason}至 ${formatCutoff(latest.to)}。` : "";
  $("#projectCutoffHint").textContent = privateWarning || unconfirmed || history || `来源：${projectValue.cutoffSource || "手工填写"}`;
  $("#projectCutoffHint").classList.toggle("warning", Boolean(privateWarning || unconfirmed));
}

function scheduleProjectAutoSave() {
  if ($("#projectForm").hidden) return;
  $("#projectAutosaveStatus").textContent = "正在保存...";
  const draft = readProjectForm();
  if (draft.resultConfirmed) draft.status = deriveProjectStatus(draft);
  clearTimeout(projectAutoSaveTimer);
  projectAutoSaveTimer = setTimeout(() => saveProjectRecordNow(draft), 650);
}

function saveProjectDraftNow() {
  if ($("#projectForm").hidden || !$("#projectId").value) return;
  clearTimeout(projectAutoSaveTimer);
  const draft = readProjectForm();
  if (draft.resultConfirmed) draft.status = deriveProjectStatus(draft);
  saveProjectRecordNow(draft);
}

function saveProjectRecordNow(record) {
  clearTimeout(projectAutoSaveTimer);
  const normalized = applyFtpRevenueToProject(record);
  const isCurrentProject = !$("#projectForm").hidden && $("#projectId").value === normalized.id;
  state = upsertProject(state, normalized);
  if (isCurrentProject) selectedProjectId = normalized.id;
  persistState();
  if (isCurrentProject) {
    $("#projectStatus").value = normalized.status;
    $("#projectStatusPill").textContent = normalized.status;
    $("#projectAutosaveStatus").textContent = "已实时保存";
    updateProjectActionButtons(normalized.status);
  }
  renderDashboard();
  renderCutoffTodo();
  renderPaymentTodo();
  renderProjectList();
}

function setProjectActionStatus(status) {
  const draft = readProjectForm();
  draft.status = status;
  if (["未投标", "已投标待结果", "已结束"].includes(status)) {
    draft.resultConfirmed = false;
  }
  saveProjectRecordNow(draft);
  if (["未投标", "已投标待结果", "已结束"].includes(status)) {
    closeResultEntryPanel();
    setResultEntryFieldsVisible(false);
  }
  const messages = {
    未投标: "项目已撤回为未投标。",
    已投标待结果: "项目已确认投标，等待发行结果。",
    已结束: "项目已终止，不再进入待投标流程。",
  };
  showToast(messages[status] || "项目状态已更新。");
}

function updateProjectActionButtons(status) {
  const resultStatuses = new Set(["部分中标", "已中标", "未中标", "待缴款", "已缴款"]);
  const hasResult = resultStatuses.has(status);
  $("#markUnbidButton").disabled = status === "未投标" || hasResult;
  $("#terminateProjectButton").disabled = status !== "未投标";
  $("#markBidButton").disabled = status !== "未投标";
  $("#openResultButton").disabled = status === "未投标" || status === "已结束";
}

function openResultEntryPanel(shouldFocus = true) {
  $("#resultEntryPanel").hidden = false;
  document.body.classList.add("modal-open");
  setResultEntryFieldsVisible(true);
  if (shouldFocus) $("#projectResultAdvertisement").focus();
}

function closeResultEntryPanel() {
  $("#resultEntryPanel").hidden = true;
  document.body.classList.remove("modal-open");
}

function setResultEntryFieldsVisible(visible) {
  $("#projectForm").classList.toggle("show-result-entry", Boolean(visible));
}

function compareProjects(left, right) {
  const leftCutoff = Date.parse(left.cutoffAt || "") || Number.MAX_SAFE_INTEGER;
  const rightCutoff = Date.parse(right.cutoffAt || "") || Number.MAX_SAFE_INTEGER;
  if (leftCutoff !== rightCutoff) return leftCutoff - rightCutoff;
  return Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0);
}

function formatCutoff(value) {
  if (!value) return "截标时间待补";
  return value.replace("T", " ");
}

function formatProjectSchedule(projectValue) {
  const pendingPayments = (projectValue.tranches || [])
    .filter((tranche) => tranche.paymentDate && !tranche.paymentCompleted)
    .map((tranche) => tranche.paymentDate)
    .sort();
  return pendingPayments.length ? `缴款 ${pendingPayments[0]}` : formatCutoff(projectValue.cutoffAt);
}

function formatInquirySummary(tranches = []) {
  const ranges = tranches
    .map((tranche) => Number.isFinite(numberOrNull(tranche.inquiryLow)) && Number.isFinite(numberOrNull(tranche.inquiryHigh))
      ? `${formatNumber(tranche.inquiryLow)}-${formatNumber(tranche.inquiryHigh)}`
      : "")
    .filter(Boolean);
  return ranges.length ? ranges.join(" / ") : "询价待补";
}

function formatTrancheDurationSummary(projectValue) {
  const durations = (projectValue.tranches || [])
    .map((tranche) => formatDurationSummaryValue(tranche.durationText))
    .filter(Boolean);
  return durations.length ? durations.join(" / ") : "期限待补";
}

function formatProjectScaleSummary(projectValue) {
  const projectScale = numberOrNull(projectValue.issueScale);
  if (Number.isFinite(projectScale) && projectScale > 0) return `${formatNumber(projectScale)}亿`;
  const trancheScales = (projectValue.tranches || [])
    .map((tranche) => numberOrNull(tranche.issueScale))
    .filter((value) => Number.isFinite(value) && value > 0);
  const sourceScale = parseScaleFromSourceText(projectValue.sourceText);
  if (!trancheScales.length && Number.isFinite(sourceScale) && sourceScale > 0) return `${formatNumber(sourceScale)}亿`;
  if (!trancheScales.length) return "待补";
  const total = trancheScales.reduce((sum, value) => sum + value, 0);
  return `${formatNumber(total)}亿`;
}

function parseScaleFromSourceText(text = "") {
  const match = String(text || "").match(/规模(?:合计)?\s*(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)\s*亿/);
  if (!match) return null;
  const total = match[1].split("+").reduce((sum, value) => sum + Number(value.trim()), 0);
  return Number.isFinite(total) ? total : null;
}

function formatProjectVenueLead(projectValue) {
  return [
    projectValue.venue,
    projectValue.leadUnderwriter,
  ].filter(Boolean).join(" · ") || "场所/主承待补";
}

function formatDurationSummaryValue(value = "") {
  const text = String(value || "").trim().replace(/期$/, "");
  if (!text) return "";
  const unit = text.match(/(D|M|Y|天|月|年)$/i)?.[1] || "";
  if (text.includes("/") && unit) {
    return text
      .slice(0, -unit.length)
      .split("/")
      .map((part) => formatDurationPart(`${part}${unit}`))
      .join(" / ");
  }
  return formatDurationPart(text);
}

function formatDurationPart(value = "") {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/^(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*)\s*(D|M|Y|天|月|年)$/i);
  if (!match) return String(value || "").trim();
  const amount = match[1].split("+").map((item) => formatNumber(item)).join("+");
  const unit = { D: "天", M: "个月", Y: "年", 天: "天", 月: "个月", 年: "年" }[match[2].toUpperCase()] || match[2];
  return `${amount}${unit}`;
}

function formatProjectOfferingSummary(projectValue) {
  if (["公募", "私募", "公私募"].includes(projectValue.offeringType)) return projectValue.offeringType;
  const text = `${projectValue.sourceText || ""} ${projectValue.opinion || ""}`;
  if (/(?:非公开|私募)/.test(text)) return "私募";
  if (/公开发行|(?:^|[\s/，,])(?:公开|公募)(?:$|[\s/，,])/.test(text)) return "公募";
  const shortNameText = [
    projectValue.shortName,
    ...(projectValue.tranches || []).map((tranche) => tranche.shortName),
  ].filter(Boolean).join(" ");
  if (/PPN\d*/i.test(shortNameText)) return "私募";
  if (/(SCP|CP|MTN)\d*/i.test(shortNameText)) return "公募";
  return "";
}

function statusBadgeClass(status) {
  if (["未投标", "待投标", "已投标待结果"].includes(status)) return "warning";
  if (["未中标", "已结束"].includes(status)) return "muted";
  return "";
}

function recognitionMark(status, message) {
  return { status, message };
}

function valueHasContent(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

function setRecognitionForInput(input, mark) {
  if (!input) return;
  const target = recognitionTargetForInput(input);
  if (!target) return;
  if (!mark?.status) {
    delete target.dataset.recognitionStatus;
    delete target.dataset.recognitionMessage;
    if (target.dataset.recognitionTitle === "true") {
      target.removeAttribute("title");
      delete target.dataset.recognitionTitle;
    }
    return;
  }
  target.dataset.recognitionStatus = mark.status;
  target.dataset.recognitionMessage = mark.message || "";
  target.title = mark.message || "";
  target.dataset.recognitionTitle = "true";
}

function recognitionTargetForInput(input) {
  return input.closest("label") || input;
}

function clearRecognitionMarks(root = document) {
  root.querySelectorAll("[data-recognition-status]").forEach((target) => {
    delete target.dataset.recognitionStatus;
    delete target.dataset.recognitionMessage;
    if (target.dataset.recognitionTitle === "true") {
      target.removeAttribute("title");
      delete target.dataset.recognitionTitle;
    }
  });
}

function clearRecognitionForInput(target) {
  const input = target?.closest?.("input, select, textarea");
  if (!input) return;
  const protocolField = protocolFieldForInput(input);
  deleteRecognitionStateForInput(input);
  setRecognitionForInput(input, null);
  if (protocolField === "amountTenThousand") setRecognitionForInput($("#protocolTransferQuantity"), null);
  if (protocolField === "quantityHands") setRecognitionForInput($("#protocolTransferAmount"), null);
}

function deleteRecognitionStateForInput(input) {
  if (input.dataset.projectField) {
    delete projectRecognitionMarks[input.dataset.projectField];
    return;
  }
  if (input.dataset.inquiryIndex && input.dataset.inquiryBound) {
    delete projectRecognitionMarks[`inquiryRanges.${input.dataset.inquiryIndex}.${input.dataset.inquiryBound}`];
    return;
  }
  const trancheCard = input.closest("[data-tranche-index]");
  if (trancheCard && input.dataset.trancheField) {
    const key = `tranche.${trancheCard.dataset.trancheIndex}.${input.dataset.trancheField}`;
    delete resultRecognitionMarks[key];
    return;
  }
  const outsourcedResultCard = input.closest("[data-outsourced-result-index]");
  if (trancheCard && outsourcedResultCard && input.dataset.outsourcedField) {
    const key = `tranche.${trancheCard.dataset.trancheIndex}.outsourced.${outsourcedResultCard.dataset.outsourcedResultIndex}.${input.dataset.outsourcedField}`;
    delete resultRecognitionMarks[key];
    return;
  }
  const protocolField = protocolFieldForInput(input);
  if (protocolField) {
    delete protocolTransferRecognitionMarks[protocolField];
    if (protocolField === "amountTenThousand") delete protocolTransferRecognitionMarks.quantityHands;
    if (protocolField === "quantityHands") delete protocolTransferRecognitionMarks.amountTenThousand;
  }
}

function protocolFieldForInput(input) {
  const entry = Object.entries(protocolTransferInputIds()).find(([, id]) => input.id === id);
  return entry?.[0] || "";
}

function localDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function bindQuickIssuer() {
  $("#quickIssuerButton").addEventListener("click", openQuickIssuerPanel);
  $("#cancelQuickIssuerButton").addEventListener("click", () => {
    $("#quickIssuerPanel").hidden = true;
  });
  $("#quickCreditRawText").addEventListener("change", () => {
    fillCreditInputs("quick", parseCreditText($("#quickCreditRawText").value), false);
  });
  $("#quickIssuerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const issuer = readIssuerInput("quick");
      const existing = state.issuers.find((candidate) => candidate.legalName === issuer.legalName);
      if (existing) issuer.id = existing.id;
      state = upsertIssuer(state, issuer);
      selectedIssuerId = issuer.id;
      const saved = state.issuers.find((item) => item.id === issuer.id) || issuer;
      project = applyIssuerCommonFields(project, saved);
      persistState();
      renderIssuerOptions();
      renderIssuerList();
      fillProjectFields();
      regenerate();
      if (batchItems.length) renderBatchResults();
      $("#quickIssuerPanel").hidden = true;
      showToast(`已录入“${issuer.legalName}”并用于当前项目。`);
    } catch (error) {
      showToast(error.message);
    }
  });
}

function openQuickIssuerPanel() {
  const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
  const draft = createIssuerDraft(project, issuer);
  fillIssuerInput("quick", draft);
  const panel = $("#quickIssuerPanel");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindBatch() {
  $("#batchParseButton").addEventListener("click", parseBatchInput);
  $("#batchCopyAllButton").addEventListener("click", async () => {
    const opinions = $$("[data-batch-opinion]").map((textarea) => textarea.value.trim()).filter(Boolean);
    if (!opinions.length) return;
    await navigator.clipboard.writeText(opinions.join("\n\n"));
    showToast(`已复制 ${opinions.length} 笔流程意见。`);
  });
  $("#batchSaveIssuersButton").addEventListener("click", saveBatchIssuers);
  $("#batchSaveProjectsButton").addEventListener("click", saveBatchProjects);
}

function parseBatchInput() {
  const blocks = splitProjectBriefs($("#batchInput").value);
  batchItems = blocks.map((sourceText) => {
    const parsedProject = parseProjectBrief(sourceText);
    const issuer = findIssuerForProject(parsedProject);
    const projectWithIssuerFields = applyIssuerCommonFields(parsedProject, issuer);
    return {
      sourceText,
      project: projectWithIssuerFields,
      selectedIssuerId: issuer?.id || "",
      draft: createIssuerDraft(projectWithIssuerFields, issuer),
    };
  });
  renderBatchResults();
  if (!blocks.length) showToast("未识别到可批量处理的项目简表。");
}

function renderBatchResults() {
  const container = $("#batchResults");
  if (!batchItems.length) {
    container.innerHTML = '<div class="panel empty">粘贴多笔项目简表后，点击“批量解析并生成”。</div>';
    $("#batchSummary").textContent = "等待解析";
    $("#batchCopyAllButton").disabled = true;
    $("#batchSaveIssuersButton").disabled = true;
    $("#batchSaveProjectsButton").disabled = true;
    return;
  }

  let matchedCount = 0;
  let warningCount = 0;
  container.innerHTML = batchItems.map((item, index) => {
    const issuer = state.issuers.find((candidate) => candidate.id === item.selectedIssuerId) || null;
    item.project = applyIssuerCommonFields(item.project, issuer);
    const generated = generateOpinion(item.project, issuer);
    item.generated = generated;
    if (issuer) matchedCount += 1;
    const draft = item.draft || createIssuerDraft(item.project, issuer);
    item.draft = draft;
    const options = [
      '<option value="">未匹配主体</option>',
      ...[...state.issuers]
        .sort((left, right) => left.legalName.localeCompare(right.legalName, "zh-CN"))
        .map((candidate) => `<option value="${escapeAttribute(candidate.id)}" ${candidate.id === item.selectedIssuerId ? "selected" : ""}>${escapeHtml(candidate.legalName)}</option>`),
    ].join("");
    const warnings = [...new Set(generated.warnings.filter(Boolean))];
    if (warnings.length) warningCount += 1;

    return `
      <section class="panel batch-card" data-batch-card="${index}">
        <div class="panel-head">
          <div><span class="step">${index + 1}</span><h2>${escapeHtml(item.project.shortName || `第 ${index + 1} 笔`)}</h2></div>
          <div class="result-actions">
            <span class="pill ${issuer ? "accent" : ""}">${issuer ? escapeHtml(issuer.legalName) : "未匹配主体"}</span>
            <button class="button subtle" data-batch-copy="${index}">复制本笔</button>
          </div>
        </div>
        <div class="batch-card-grid">
          <div>
            <textarea class="batch-source" readonly>${escapeHtml(item.sourceText)}</textarea>
            <label class="batch-issuer-select">匹配主体<select data-batch-select="${index}">${options}</select></label>
            <label class="batch-issuer-select">发行方式<select data-batch-offering="${index}">${projectOfferingTypeOptions(item.project.offeringType)}</select></label>
            ${isExchangeProject(item.project) ? `<label class="batch-issuer-select">交易所发行期次<input type="number" min="1" step="1" data-batch-issue="${index}" value="${escapeAttribute(item.project.exchangeIssueNumber ?? "")}" placeholder="例如：3"></label>` : ""}
            ${warnings.length ? `<div class="warning-box"><strong>需要确认</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
          </div>
          <textarea class="batch-opinion" data-batch-opinion="${index}">${escapeHtml(generated.opinion)}</textarea>
        </div>
        ${renderBatchIssuerEditor(draft, index, !issuer)}
      </section>
    `;
  }).join("");

  $("#batchSummary").textContent = `${batchItems.length} 笔 / 已匹配 ${matchedCount} 笔 / ${warningCount} 笔需确认`;
  $("#batchCopyAllButton").disabled = false;
  $("#batchSaveIssuersButton").disabled = false;
  $("#batchSaveProjectsButton").disabled = false;

  $$("[data-batch-select]").forEach((select) => {
    select.addEventListener("change", () => {
      captureBatchDrafts();
      const index = Number(select.dataset.batchSelect);
      const issuer = state.issuers.find((candidate) => candidate.id === select.value) || null;
      batchItems[index].selectedIssuerId = select.value;
      batchItems[index].project = applyIssuerCommonFields(batchItems[index].project, issuer);
      batchItems[index].draft = createIssuerDraft(batchItems[index].project, issuer);
      renderBatchResults();
    });
  });
  $$("[data-batch-offering]").forEach((select) => {
    select.addEventListener("change", () => {
      captureBatchDrafts();
      const index = Number(select.dataset.batchOffering);
      applyOfferingTypeChoice(batchItems[index].project, select.value);
      renderBatchResults();
    });
  });
  $$("[data-batch-issue]").forEach((input) => {
    input.addEventListener("change", () => {
      captureBatchDrafts();
      const index = Number(input.dataset.batchIssue);
      applyExchangeIssueNumberChoice(batchItems[index].project, numberOrNull(input.value));
      renderBatchResults();
    });
  });
  $$("[data-batch-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const textarea = $(`[data-batch-opinion="${button.dataset.batchCopy}"]`);
      await navigator.clipboard.writeText(textarea.value);
      showToast("本笔流程意见已复制。");
    });
  });
}

function renderBatchIssuerEditor(draft, index, shouldOpen) {
  return `
    <details class="batch-issuer-editor" ${shouldOpen ? "open" : ""}>
      <summary>资料库录入（新主体或授信变化时填写）</summary>
      <div class="batch-issuer-grid">
        <label class="full review-toggle"><input type="checkbox" data-batch-index="${index}" data-batch-field="include" ${draft.include ? "checked" : ""}>录入/更新此主体授信</label>
        <label class="wide">主体正式名称<input data-batch-index="${index}" data-batch-field="legalName" value="${escapeAttribute(draft.legalName)}"></label>
        <label class="wide">常用简称<input data-batch-index="${index}" data-batch-field="aliases" value="${escapeAttribute(draft.aliases)}"></label>
        <label>默认分行<input data-batch-index="${index}" data-batch-field="defaultBranch" value="${escapeAttribute(draft.defaultBranch)}"></label>
        <label>企业性质<select data-batch-index="${index}" data-batch-field="enterpriseType">${enterpriseTypeOptions(draft.enterpriseType)}</select></label>
        <label>主体评级<input data-batch-index="${index}" data-batch-field="subjectRating" value="${escapeAttribute(draft.subjectRating)}"></label>
        <label>评级机构<input data-batch-index="${index}" data-batch-field="ratingAgency" value="${escapeAttribute(draft.ratingAgency)}"></label>
        <label>市场隐含评级<input data-batch-index="${index}" data-batch-field="hiddenRating" value="${escapeAttribute(draft.hiddenRating)}"></label>
        <label>审批层级<input data-batch-index="${index}" data-batch-field="approvalLevel" value="${escapeAttribute(draft.approvalLevel)}"></label>
        <label>公募/通用金额<input type="number" step="0.0001" data-batch-index="${index}" data-batch-field="approvedAmount" value="${escapeAttribute(draft.approvedAmount)}"></label>
        <label>私募金额<input type="number" step="0.0001" data-batch-index="${index}" data-batch-field="privateAmount" value="${escapeAttribute(draft.privateAmount)}"></label>
        <label>发行类型<select data-batch-index="${index}" data-batch-field="offeringType">${offeringTypeOptions(draft.offeringType)}</select></label>
        <label>公募/通用比例（%）<input type="number" step="0.01" data-batch-index="${index}" data-batch-field="approvedRatio" value="${escapeAttribute(draft.approvedRatio)}"></label>
        <label>私募比例（%）<input type="number" step="0.01" data-batch-index="${index}" data-batch-field="privateRatio" value="${escapeAttribute(draft.privateRatio)}"></label>
        <label>投资期限<input data-batch-index="${index}" data-batch-field="investmentTermText" value="${escapeAttribute(draft.investmentTermText)}"></label>
        <label class="full">授信原文<input data-batch-index="${index}" data-batch-field="rawText" value="${escapeAttribute(draft.rawText)}" placeholder="填写后会自动识别金额、比例和期限"></label>
        <label class="full review-toggle"><input type="checkbox" data-batch-index="${index}" data-batch-field="isRealEstate" ${draft.isRealEstate ? "checked" : ""}>房地产主体</label>
      </div>
    </details>
  `;
}

function captureBatchDrafts() {
  batchItems.forEach((item, index) => {
    const card = $(`[data-batch-card="${index}"]`);
    if (!card) return;
    item.draft = readDataFieldIssuerDraft(card, "batchField", item.draft);
  });
}

function saveBatchIssuers() {
  captureBatchDrafts();
  let savedCount = 0;
  let skippedCount = 0;
  for (const item of batchItems) {
    if (!item.draft?.include) continue;
    if (!item.draft.legalName.trim()) {
      skippedCount += 1;
      continue;
    }
    try {
      const issuer = issuerFromDraft(item.draft);
      const existing = state.issuers.find((candidate) => candidate.legalName === issuer.legalName);
      if (existing) issuer.id = existing.id;
      state = upsertIssuer(state, issuer);
      const saved = state.issuers.find((candidate) => candidate.id === issuer.id)
        || state.issuers.find((candidate) => candidate.legalName === issuer.legalName);
      item.selectedIssuerId = saved?.id || "";
      item.draft = createIssuerDraft(item.project, saved);
      savedCount += 1;
    } catch {
      // Invalid drafts remain visible for manual correction.
      skippedCount += 1;
    }
  }
  if (!savedCount) {
    showToast("没有可录入的资料；请勾选并填写主体正式名称。");
    return;
  }
  persistState();
  renderIssuerOptions();
  renderIssuerList();
  renderBatchResults();
  showToast(`已批量录入或更新 ${savedCount} 个主体${skippedCount ? `，另有 ${skippedCount} 个待补充` : ""}。`);
}

function saveBatchProjects() {
  captureBatchDrafts();
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let firstRecordId = "";

  for (const [index, item] of batchItems.entries()) {
    if (!item.project?.shortName) {
      skippedCount += 1;
      continue;
    }
    const issuer = state.issuers.find((candidate) => candidate.id === item.selectedIssuerId) || null;
    const opinion = $(`[data-batch-opinion="${index}"]`)?.value.trim() || item.generated?.opinion || "";
    const generated = { ...(item.generated || generateOpinion(item.project, issuer)), opinion };
    const result = upsertParsedProjectToLedger(item.project, issuer, generated);
    if (!result) {
      skippedCount += 1;
      continue;
    }
    firstRecordId ||= result.record.id;
    if (result.isUpdate) updatedCount += 1;
    else createdCount += 1;
  }

  if (!createdCount && !updatedCount) {
    showToast("没有可加入项目台账的批量结果。");
    return;
  }

  selectedProjectId = firstRecordId;
  persistState();
  renderProjectWorkspace();
  switchView("ledger");
  const parts = [];
  if (createdCount) parts.push(`新增 ${createdCount} 笔`);
  if (updatedCount) parts.push(`更新 ${updatedCount} 笔`);
  if (skippedCount) parts.push(`跳过 ${skippedCount} 笔`);
  showToast(`已批量加入项目台账：${parts.join("，")}。`);
}

function bindDatabase() {
  $("#newIssuerButton").addEventListener("click", clearIssuerForm);
  $("#issuerSearch").addEventListener("input", renderIssuerList);
  $("#ftpCurveForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state = { ...state, ftpCurve: readFtpCurveForm() };
    persistState();
    showToast("FTP 曲线已保存。");
  });
  $("#creditRawText").addEventListener("change", () => {
    const credit = parseCreditText($("#creditRawText").value);
    const fields = {
      approvalLevel: credit.approvalLevel,
      approvedAmount: credit.approvedAmount,
      privateAmount: credit.privateAmount,
      offeringType: credit.offeringType,
      approvedRatio: credit.approvedRatio,
      privateRatio: credit.privateRatio,
      investmentTermText: credit.investmentTermText,
    };
    Object.entries(fields).forEach(([id, value]) => {
      const input = $(`#${id}`);
      if (input && value !== null && value !== undefined && !input.value) input.value = value;
    });
  });
  $("#issuerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const issuer = readIssuerForm();
      state = upsertIssuer(state, issuer);
      selectedIssuerId = issuer.id;
      persistState();
      renderIssuerOptions();
      renderIssuerList();
      fillIssuerForm(state.issuers.find((item) => item.id === issuer.id));
      regenerate();
      if (batchItems.length) renderBatchResults();
      showToast("主体与最新授信已保存。");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#deleteIssuerButton").addEventListener("click", () => {
    const id = $("#issuerId").value;
    const issuer = state.issuers.find((item) => item.id === id);
    if (!issuer || !confirm(`确定删除“${issuer.legalName}”及其授信资料吗？`)) return;
    state = { ...state, issuers: state.issuers.filter((item) => item.id !== id), updatedAt: new Date().toISOString() };
    if (selectedIssuerId === id) selectedIssuerId = "";
    persistState();
    renderIssuerOptions();
    renderIssuerList();
    clearIssuerForm();
    regenerate();
  });

  $("#historyDocxInput").addEventListener("change", parseHistoryDocument);
  $("#cancelHistoryImportButton").addEventListener("click", clearHistoryImport);
  $("#confirmHistoryImportButton").addEventListener("click", () => {
    if (!pendingHistoryImport) return;
    const imported = collectHistoryImportIssuers();
    state = mergeImportedIssuers(state, imported.baseIssuers);
    for (const reviewed of imported.reviewedIssuers.sort((left, right) =>
      Number(right.credit?.sourceRank ?? -1) - Number(left.credit?.sourceRank ?? -1),
    )) {
      const existing = state.issuers.find((issuer) => issuer.legalName === reviewed.legalName);
      state = upsertIssuer(state, {
        ...reviewed,
        id: existing?.id || reviewed.id,
        credit: { ...reviewed.credit, sourceRank: null },
      });
    }
    persistState();
    renderIssuerOptions();
    renderIssuerList();
    regenerate();
    if (batchItems.length) renderBatchResults();
    showToast(`已导入并归并 ${imported.baseIssuers.length + imported.reviewedIssuers.length} 个主体。`);
    clearHistoryImport();
  });
}

function initializeHistoryImport() {
  const isReady = typeof window.mammoth?.extractRawText === "function";
  $("#historyDocxInput").disabled = !isReady;
  $("#historyImportButton").classList.toggle("unavailable", !isReady);
  $("#historyImportButton").title = isReady
    ? "选择历史流程 Word 文档并在浏览器本地解析"
    : "Word 解析组件加载失败，请刷新页面后重试";
  $("#historyImportButtonText").textContent = isReady ? "导入历史 Word" : "Word 组件加载失败";
}

async function parseHistoryDocument() {
  const input = $("#historyDocxInput");
  const file = input.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".docx")) {
    showToast("请选择 .docx 格式的 Word 文档。");
    input.value = "";
    return;
  }

  const panel = $("#historyImportPanel");
  panel.hidden = false;
  setHistoryImportBusy(true);
  setHistoryImportStatus(`已选择“${file.name}”，正在读取文档...`);
  $("#historyReviewList").innerHTML = "";
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("已选择 Word 文档，正在本地解析。");

  // Let the browser render the progress state before parsing the document.
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    if (!window.mammoth?.extractRawText) throw new Error("Word 解析组件未加载，请刷新页面后重试");
    const arrayBuffer = await file.arrayBuffer();
    setHistoryImportStatus("正在提取 Word 文本并识别流程意见...");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = await window.mammoth.extractRawText({ arrayBuffer });
    pendingHistoryImport = parseHistoryText(result.value);
    renderHistoryImport();
    showToast(`解析完成：识别 ${pendingHistoryImport.issuers.length} 个主体。`);
  } catch (error) {
    pendingHistoryImport = null;
    setHistoryImportStatus(`解析失败：${error?.message || "未知错误"}`, true);
    showToast("Word 解析失败，请查看页面中的错误提示。");
  } finally {
    input.value = "";
    setHistoryImportBusy(false);
  }
}

function setHistoryImportStatus(message, isError = false) {
  $("#historyStats").innerHTML = `<div class="history-status ${isError ? "error" : ""}">${escapeHtml(message)}</div>`;
}

function setHistoryImportBusy(isBusy) {
  $("#historyDocxInput").disabled = isBusy || typeof window.mammoth?.extractRawText !== "function";
  $("#historyImportButton").classList.toggle("busy", isBusy);
  $("#historyImportButtonText").textContent = isBusy
    ? "正在解析 Word..."
    : typeof window.mammoth?.extractRawText === "function"
      ? "导入历史 Word"
      : "Word 组件加载失败";
  $("#confirmHistoryImportButton").disabled = isBusy;
  $("#cancelHistoryImportButton").disabled = isBusy;
}

function renderHistoryImport() {
  const result = pendingHistoryImport;
  const stats = [
    [result.paragraphCount, "非空段落"],
    [result.standardRecordCount, "普通信用债意见"],
    [result.issuers.length, "可归并主体"],
    [result.absRecordCount, "ABS意见（排除）"],
    [result.reviewRecords.length, "需人工复核"],
  ];
  $("#historyStats").innerHTML = stats.map(([value, label]) => `
    <div class="history-stat"><strong>${value}</strong><span>${label}</span></div>
  `).join("");

  const reviews = result.reviewRecords.slice(0, 100);
  $("#historyReviewList").innerHTML = reviews.length
    ? reviews.map((record, index) => renderHistoryReviewEditor(record, index)).join("")
    : '<div class="empty">没有需要人工复核的记录。</div>';
}

function renderHistoryReviewEditor(record, index) {
  const draft = createHistoryReviewDraft(record);
  return `
    <div class="review-item" data-review-card="${index}">
      <div class="review-item-head">
        <div>
          <strong>${escapeHtml(record.shortName || record.issuerLegalName || "未识别记录")}</strong>
          <span>${escapeHtml((record.warnings || []).join("；"))}</span>
        </div>
        <label class="review-toggle"><input type="checkbox" data-review-field="include">纳入本次导入</label>
      </div>
      <div class="review-grid">
        <label class="wide">主体正式名称<input data-review-field="legalName" value="${escapeAttribute(draft.legalName)}"></label>
        <label class="wide">常用简称<input data-review-field="aliases" value="${escapeAttribute(draft.aliases)}"></label>
        <label>默认分行<input data-review-field="defaultBranch" value="${escapeAttribute(draft.defaultBranch)}"></label>
        <label>企业性质<select data-review-field="enterpriseType">${enterpriseTypeOptions(draft.enterpriseType)}</select></label>
        <label>主体评级<input data-review-field="subjectRating" value="${escapeAttribute(draft.subjectRating)}"></label>
        <label>评级机构<input data-review-field="ratingAgency" value="${escapeAttribute(draft.ratingAgency)}"></label>
        <label>市场隐含评级<input data-review-field="hiddenRating" value="${escapeAttribute(draft.hiddenRating)}"></label>
        <label>审批层级<input data-review-field="approvalLevel" value="${escapeAttribute(draft.approvalLevel)}"></label>
        <label>公募/通用金额<input type="number" step="0.0001" data-review-field="approvedAmount" value="${escapeAttribute(draft.approvedAmount)}"></label>
        <label>私募金额<input type="number" step="0.0001" data-review-field="privateAmount" value="${escapeAttribute(draft.privateAmount)}"></label>
        <label>发行类型<select data-review-field="offeringType">${offeringTypeOptions(draft.offeringType)}</select></label>
        <label>公募/通用比例（%）<input type="number" step="0.01" data-review-field="approvedRatio" value="${escapeAttribute(draft.approvedRatio)}"></label>
        <label>私募比例（%）<input type="number" step="0.01" data-review-field="privateRatio" value="${escapeAttribute(draft.privateRatio)}"></label>
        <label>投资期限<input data-review-field="investmentTermText" value="${escapeAttribute(draft.investmentTermText)}"></label>
        <label class="full">授信原文<input data-review-field="rawText" value="${escapeAttribute(draft.rawText)}"></label>
        <label class="full review-toggle"><input type="checkbox" data-review-field="isRealEstate" ${draft.isRealEstate ? "checked" : ""}>房地产主体</label>
      </div>
      <details class="review-source">
        <summary>查看原始流程意见</summary>
        <p>${escapeHtml(record.opinion || record.fullName || "无可用原文")}</p>
      </details>
    </div>
  `;
}

function collectHistoryImportIssuers() {
  const reviewLegalNames = new Set(
    pendingHistoryImport.reviewRecords.map((record) => record.issuerLegalName).filter(Boolean),
  );
  const baseIssuers = pendingHistoryImport.issuers.filter((issuer) => !reviewLegalNames.has(issuer.legalName));
  const reviewedIssuers = $$("[data-review-card]").flatMap((card, index) => {
    const draft = readDataFieldIssuerDraft(card, "reviewField", createHistoryReviewDraft(pendingHistoryImport.reviewRecords[index]));
    if (!draft.include || !draft.legalName.trim()) return [];
    try {
      return [issuerFromDraft(draft)];
    } catch {
      return [];
    }
  });
  return { baseIssuers, reviewedIssuers };
}

function clearHistoryImport() {
  pendingHistoryImport = null;
  $("#historyImportPanel").hidden = true;
  $("#historyStats").innerHTML = "";
  $("#historyReviewList").innerHTML = "";
  $("#historyDocxInput").value = "";
  setHistoryImportBusy(false);
}

function createIssuerDraft(projectValue, issuer = null) {
  const derivedAliases = [deriveIssuerAlias(projectValue?.shortName), projectValue?.shortName].filter(Boolean);
  const credit = issuer?.credit || {};
  return {
    id: issuer?.id || "",
    include: !issuer,
    legalName: issuer?.legalName || projectValue?.issuerName || extractIssuerLegalName(projectValue?.fullName || ""),
    aliases: (issuer?.aliases?.length ? issuer.aliases : derivedAliases).join("，"),
    defaultBranch: issuer?.defaultBranch || projectValue?.branch || "",
    enterpriseType: issuer?.enterpriseType || "",
    subjectRating: issuer?.subjectRating || projectValue?.subjectRating || "",
    ratingAgency: issuer?.ratingAgency || projectValue?.ratingAgency || "",
    hiddenRating: issuer?.hiddenRating || projectValue?.hiddenRating || "",
    isRealEstate: Boolean(issuer?.isRealEstate),
    approvalLevel: credit.approvalLevel || "",
    approvedAmount: credit.approvedAmount ?? "",
    privateAmount: credit.privateAmount ?? "",
    offeringType: credit.offeringType || "",
    approvedRatio: credit.approvedRatio ?? "",
    privateRatio: credit.privateRatio ?? "",
    investmentTermText: credit.investmentTermText || "",
    rawText: credit.rawText || "",
    sourceRank: credit.sourceRank ?? null,
  };
}

function createHistoryReviewDraft(record) {
  const credit = record.credit || {};
  return {
    id: "",
    include: false,
    legalName: record.issuerLegalName || "",
    aliases: [record.alias, record.shortName].filter(Boolean).join("，"),
    defaultBranch: record.branch || "",
    enterpriseType: "",
    subjectRating: record.subjectRating || "",
    ratingAgency: record.ratingAgency || "",
    hiddenRating: record.hiddenRating || "",
    isRealEstate: Boolean(record.isRealEstate),
    approvalLevel: credit.approvalLevel || "",
    approvedAmount: credit.approvedAmount ?? "",
    privateAmount: credit.privateAmount ?? "",
    offeringType: credit.offeringType || "",
    approvedRatio: credit.approvedRatio ?? "",
    privateRatio: credit.privateRatio ?? "",
    investmentTermText: credit.investmentTermText || "",
    rawText: credit.rawText || "",
    sourceRank: credit.sourceRank ?? record.sourceRank ?? null,
  };
}

function readDataFieldIssuerDraft(container, datasetName, fallback = {}) {
  const attribute = datasetName === "batchField" ? "data-batch-field" : "data-review-field";
  const draft = { ...fallback };
  container.querySelectorAll(`[${attribute}]`).forEach((input) => {
    const field = input.getAttribute(attribute);
    draft[field] = input.type === "checkbox" ? input.checked : input.value;
  });
  return draft;
}

function issuerFromDraft(draft) {
  const parsed = parseCreditText(draft.rawText || "", draft.sourceRank ?? null);
  const chooseNumber = (value, parsedValue) => numberOrNull(value) ?? parsedValue ?? null;
  const investmentTermText = String(draft.investmentTermText || parsed.investmentTermText || "").trim();
  return {
    id: draft.id || crypto.randomUUID(),
    legalName: String(draft.legalName || "").trim(),
    aliases: String(draft.aliases || "").split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
    defaultBranch: String(draft.defaultBranch || "").trim(),
    enterpriseType: String(draft.enterpriseType || "").trim(),
    subjectRating: String(draft.subjectRating || "").trim().toUpperCase(),
    ratingAgency: String(draft.ratingAgency || "").trim(),
    hiddenRating: String(draft.hiddenRating || "").trim().toUpperCase(),
    isRealEstate: Boolean(draft.isRealEstate),
    credit: {
      approvalLevel: String(draft.approvalLevel || parsed.approvalLevel || "").trim(),
      approvedAmount: chooseNumber(draft.approvedAmount, parsed.approvedAmount),
      privateAmount: chooseNumber(draft.privateAmount, parsed.privateAmount),
      offeringType: String(draft.offeringType || parsed.offeringType || "").trim(),
      approvedRatio: chooseNumber(draft.approvedRatio, parsed.approvedRatio),
      privateRatio: chooseNumber(draft.privateRatio, parsed.privateRatio),
      investmentTermText,
      rawText: String(draft.rawText || "").trim(),
      sourceRank: draft.sourceRank ?? null,
      updatedAt: new Date().toISOString(),
    },
  };
}

function offeringTypeOptions(selected = "") {
  const labels = { "": "待选择", "公募": "公开发行 / 公募", "私募": "非公开发行 / 私募", "公私募": "公私募" };
  return ["", "公募", "私募", "公私募"].map((value) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${labels[value]}</option>`,
  ).join("");
}

function projectOfferingTypeOptions(selected = "") {
  const labels = { "": "待确认", "公募": "公开发行 / 公募", "私募": "非公开发行 / 私募" };
  return ["", "公募", "私募"].map((value) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${labels[value]}</option>`,
  ).join("");
}

function applyOfferingTypeChoice(projectValue, offeringType, updateSingleInput = false) {
  projectValue.offeringType = offeringType;
  projectValue.offeringTypeSource = offeringType ? "manual" : "";
  projectValue.warnings = (projectValue.warnings || []).filter((warning) =>
    !warning.includes("无法仅凭简称可靠判断公开或非公开发行")
    && !warning.startsWith("发行方式根据简称尾部"),
  );
  if (!offeringType && ["上交所", "深交所", "北交所"].includes(projectValue.venue)) {
    projectValue.warnings.push("交易所债券无法仅凭简称可靠判断公开或非公开发行，请在简表中注明“公开/非公开”或手工选择发行方式。");
  }
  clearGeneratedExchangeFullName(projectValue, updateSingleInput);
}

function applyExchangeIssueNumberChoice(projectValue, issueNumber, updateSingleInput = false) {
  projectValue.exchangeIssueNumber = issueNumber;
  projectValue.warnings = (projectValue.warnings || []).filter((warning) =>
    !warning.startsWith("交易所债券简称尾号不等于发行期次"),
  );
  if (!Number.isInteger(issueNumber) && isExchangeProject(projectValue)) {
    projectValue.warnings.push("交易所债券简称尾号不等于发行期次，请在简表中注明“第几期”或手工填写交易所发行期次。");
  }
  clearGeneratedExchangeFullName(projectValue, updateSingleInput);
}

function clearGeneratedExchangeFullName(projectValue, updateSingleInput) {
  if (!projectValue.fullName?.includes("面向专业投资者")) return;
  projectValue.fullName = "";
  if (updateSingleInput) $('[data-project-field="fullName"]').value = "";
}

function rebuildInquiryRanges(projectValue) {
  const existing = Array.isArray(projectValue.inquiryRanges) ? projectValue.inquiryRanges : [];
  const ranges = existing.map((range) => ({
    low: numberOrNull(range?.low),
    high: numberOrNull(range?.high),
  }));
  if (Number.isFinite(projectValue.inquiryLow) && Number.isFinite(projectValue.inquiryHigh)) {
    ranges[0] = { low: projectValue.inquiryLow, high: projectValue.inquiryHigh };
  } else {
    ranges[0] = { low: numberOrNull(projectValue.inquiryLow), high: numberOrNull(projectValue.inquiryHigh) };
  }
  if (Number.isFinite(projectValue.inquiryLow2) || Number.isFinite(projectValue.inquiryHigh2)) {
    ranges[1] = { low: numberOrNull(projectValue.inquiryLow2), high: numberOrNull(projectValue.inquiryHigh2) };
  }
  projectValue.inquiryRanges = ranges
    .map((range) => ({
      low: numberOrNull(range?.low),
      high: numberOrNull(range?.high),
    }))
    .filter((range, index) => index < inquiryVarietyCount(projectValue) || Number.isFinite(range.low) || Number.isFinite(range.high));
  projectValue.inquiryLow2 = projectValue.inquiryRanges[1]?.low ?? null;
  projectValue.inquiryHigh2 = projectValue.inquiryRanges[1]?.high ?? null;
}

function ensureInquiryRangeCapacity(projectValue) {
  const count = inquiryVarietyCount(projectValue);
  if (count <= 1) return;
  const ranges = Array.isArray(projectValue.inquiryRanges) ? [...projectValue.inquiryRanges] : [];
  if (!ranges.length && (Number.isFinite(projectValue.inquiryLow) || Number.isFinite(projectValue.inquiryHigh))) {
    ranges[0] = { low: numberOrNull(projectValue.inquiryLow), high: numberOrNull(projectValue.inquiryHigh) };
  }
  for (let index = 0; index < count; index += 1) {
    ranges[index] = ranges[index] || { low: null, high: null };
  }
  projectValue.inquiryRanges = ranges;
  projectValue.inquiryLow2 = ranges[1]?.low ?? null;
  projectValue.inquiryHigh2 = ranges[1]?.high ?? null;
}

function renderTrancheInquiryFields() {
  const count = inquiryVarietyCount(project);
  const panel = $("#trancheInquiryPanel");
  const rows = $("#trancheInquiryRows");
  panel.hidden = count <= 1;
  if (count <= 1) {
    rows.innerHTML = "";
    return;
  }
  ensureInquiryRangeCapacity(project);
  rows.innerHTML = project.inquiryRanges.slice(1, count).map((range, offset) => {
    const index = offset + 1;
    return `
      <div class="tranche-inquiry-row">
        <span>${escapeHtml(inquiryVarietyLabel(project, index))}</span>
        <label>下限（%）<input type="number" step="0.0001" data-inquiry-index="${index}" data-inquiry-bound="low" value="${escapeAttribute(range?.low ?? "")}"></label>
        <label>上限（%）<input type="number" step="0.0001" data-inquiry-index="${index}" data-inquiry-bound="high" value="${escapeAttribute(range?.high ?? "")}"></label>
      </div>
    `;
  }).join("");
}

function updateDynamicInquiryRange(input) {
  const index = Number(input.dataset.inquiryIndex);
  const bound = input.dataset.inquiryBound;
  if (!Number.isInteger(index) || index < 1 || !["low", "high"].includes(bound)) return;
  ensureInquiryRangeCapacity(project);
  project.inquiryRanges[index] = {
    ...(project.inquiryRanges[index] || { low: null, high: null }),
    [bound]: numberOrNull(input.value),
  };
  project.inquiryLow2 = project.inquiryRanges[1]?.low ?? null;
  project.inquiryHigh2 = project.inquiryRanges[1]?.high ?? null;
}

function inquiryVarietyCount(projectValue) {
  const ranges = Array.isArray(projectValue?.inquiryRanges) ? projectValue.inquiryRanges.length : 0;
  const durations = Array.isArray(projectValue?.durationParts) ? projectValue.durationParts.length : 0;
  const names = Array.isArray(projectValue?.shortNames) ? projectValue.shortNames.length : 0;
  const legacySecond = Number.isFinite(numberOrNull(projectValue?.inquiryLow2)) || Number.isFinite(numberOrNull(projectValue?.inquiryHigh2)) ? 2 : 0;
  return Math.max(ranges, durations, names, legacySecond, 1);
}

function inquiryVarietyLabel(projectValue, index) {
  const duration = projectValue.durationParts?.[index];
  const shortName = projectValue.shortNames?.[index];
  const fallback = `品种${index + 1}`;
  const durationText = duration ? `（${formatDurationSummaryValue(duration)}）` : "";
  return `${shortName || fallback}${durationText}`;
}

function formatSuggestionRatios(suggestion) {
  const ratios = [...new Set(suggestion.trancheSuggestions.map((item) => item.suggestedRatio).filter(Number.isFinite))];
  return ratios.map((ratio) => `${formatNumber(ratio)}%`).join("/") || "比例待补";
}

function isExchangeProject(projectValue) {
  return ["上交所", "深交所", "北交所"].includes(projectValue?.venue);
}

function fillIssuerInput(prefix, draft) {
  const fields = {
    IssuerId: draft.id,
    LegalName: draft.legalName,
    Aliases: draft.aliases,
    DefaultBranch: draft.defaultBranch,
    EnterpriseType: draft.enterpriseType,
    SubjectRating: draft.subjectRating,
    RatingAgency: draft.ratingAgency,
    HiddenRating: draft.hiddenRating,
    ApprovalLevel: draft.approvalLevel,
    ApprovedAmount: draft.approvedAmount,
    PrivateAmount: draft.privateAmount,
    OfferingType: draft.offeringType,
    ApprovedRatio: draft.approvedRatio,
    PrivateRatio: draft.privateRatio,
    InvestmentTermText: draft.investmentTermText,
    CreditRawText: draft.rawText,
  };
  Object.entries(fields).forEach(([suffix, value]) => {
    const input = $(`#${prefix}${suffix}`);
    if (input) input.value = value ?? "";
  });
  $(`#${prefix}IsRealEstate`).checked = Boolean(draft.isRealEstate);
}

function fillCreditInputs(prefix, credit, onlyEmpty = true) {
  const fields = {
    ApprovalLevel: credit.approvalLevel,
    ApprovedAmount: credit.approvedAmount,
    PrivateAmount: credit.privateAmount,
    OfferingType: credit.offeringType,
    ApprovedRatio: credit.approvedRatio,
    PrivateRatio: credit.privateRatio,
    InvestmentTermText: credit.investmentTermText,
  };
  Object.entries(fields).forEach(([suffix, value]) => {
    const input = $(`#${prefix}${suffix}`);
    if (input && value !== null && value !== undefined && (!onlyEmpty || !input.value)) input.value = value;
  });
}

function readIssuerInput(prefix) {
  return issuerFromDraft({
    id: $(`#${prefix}IssuerId`).value,
    legalName: $(`#${prefix}LegalName`).value,
    aliases: $(`#${prefix}Aliases`).value,
    defaultBranch: $(`#${prefix}DefaultBranch`).value,
    enterpriseType: $(`#${prefix}EnterpriseType`).value,
    subjectRating: $(`#${prefix}SubjectRating`).value,
    ratingAgency: $(`#${prefix}RatingAgency`).value,
    hiddenRating: $(`#${prefix}HiddenRating`).value,
    isRealEstate: $(`#${prefix}IsRealEstate`).checked,
    approvalLevel: $(`#${prefix}ApprovalLevel`).value,
    approvedAmount: $(`#${prefix}ApprovedAmount`).value,
    privateAmount: $(`#${prefix}PrivateAmount`).value,
    offeringType: $(`#${prefix}OfferingType`).value,
    approvedRatio: $(`#${prefix}ApprovedRatio`).value,
    privateRatio: $(`#${prefix}PrivateRatio`).value,
    investmentTermText: $(`#${prefix}InvestmentTermText`).value,
    rawText: $(`#${prefix}CreditRawText`).value,
    sourceRank: null,
  });
}

function readIssuerForm() {
  return issuerFromDraft({
    id: $("#issuerId").value,
    legalName: $("#legalName").value,
    aliases: $("#aliases").value,
    defaultBranch: $("#defaultBranch").value,
    enterpriseType: $("#enterpriseType").value,
    subjectRating: $("#subjectRating").value,
    ratingAgency: $("#ratingAgency").value,
    hiddenRating: $("#hiddenRating").value,
    isRealEstate: $("#isRealEstate").checked,
    approvalLevel: $("#approvalLevel").value,
    approvedAmount: $("#approvedAmount").value,
    privateAmount: $("#privateAmount").value,
    offeringType: $("#offeringType").value,
    approvedRatio: $("#approvedRatio").value,
    privateRatio: $("#privateRatio").value,
    investmentTermText: $("#investmentTermText").value,
    rawText: $("#creditRawText").value,
    sourceRank: numberOrNull($("#sourceRank").value),
  });
}

function renderIssuerList() {
  const query = $("#issuerSearch").value.trim().toLowerCase();
  const issuers = state.issuers
    .filter((issuer) => `${issuer.legalName} ${(issuer.aliases || []).join(" ")}`.toLowerCase().includes(query))
    .sort((left, right) => left.legalName.localeCompare(right.legalName, "zh-CN"));

  $("#issuerList").innerHTML = issuers.length
    ? issuers.map((issuer) => `
      <button class="issuer-item ${$("#issuerId").value === issuer.id ? "active" : ""}" data-issuer-id="${escapeAttribute(issuer.id)}">
        <strong>${escapeHtml(issuer.legalName)}</strong>
        <span>${escapeHtml((issuer.aliases || []).join(" / ") || "暂无简称")} · ${escapeHtml(issuer.enterpriseType || "企业性质待补")} · ${escapeHtml(issuerCommonSummary(issuer))} · ${escapeHtml(issuer.credit?.rawText || "暂无授信原文")}</span>
      </button>
    `).join("")
    : '<div class="empty">暂无主体资料。可新增主体，或载入示例。</div>';

  $$("[data-issuer-id]").forEach((button) => {
    button.addEventListener("click", () => fillIssuerForm(state.issuers.find((issuer) => issuer.id === button.dataset.issuerId)));
  });
}

function issuerCommonSummary(issuer) {
  const rating = issuer.subjectRating
    ? `${issuer.subjectRating}${issuer.ratingAgency ? `(${issuer.ratingAgency})` : ""}`
    : "主体评级待补";
  return `${rating} / 隐含${issuer.hiddenRating || "待补"}`;
}

function renderIssuerOptions() {
  $("#issuerSelect").innerHTML = [
    '<option value="">未匹配主体</option>',
    ...state.issuers
      .sort((left, right) => left.legalName.localeCompare(right.legalName, "zh-CN"))
      .map((issuer) => `<option value="${escapeAttribute(issuer.id)}">${escapeHtml(issuer.legalName)}</option>`),
  ].join("");
  $("#issuerSelect").value = selectedIssuerId;
}

function renderFtpCurveForm() {
  $("#ftpCurveGrid").innerHTML = FTP_TENORS.map((tenor) => `
    <label>${tenor.label}（%）<input data-ftp-field="${tenor.key}" type="number" step="0.0001" value="${escapeAttribute(state.ftpCurve?.[tenor.key] ?? "")}" placeholder="%"></label>
  `).join("");
}

function readFtpCurveForm() {
  const curve = normalizeFtpCurve(state.ftpCurve);
  $$("[data-ftp-field]").forEach((input) => {
    curve[input.dataset.ftpField] = numberOrNull(input.value);
  });
  return curve;
}

function clearIssuerForm() {
  $("#issuerForm").reset();
  $("#issuerId").value = "";
  $("#issuerFormTitle").textContent = "新增主体与最新授信";
  $("#deleteIssuerButton").hidden = true;
  renderIssuerList();
}

function fillIssuerForm(issuer) {
  if (!issuer) return clearIssuerForm();
  $("#issuerId").value = issuer.id;
  $("#legalName").value = issuer.legalName || "";
  $("#aliases").value = (issuer.aliases || []).join("，");
  $("#defaultBranch").value = issuer.defaultBranch || "";
  $("#enterpriseType").value = issuer.enterpriseType || "";
  $("#subjectRating").value = issuer.subjectRating || "";
  $("#ratingAgency").value = issuer.ratingAgency || "";
  $("#hiddenRating").value = issuer.hiddenRating || "";
  $("#isRealEstate").checked = Boolean(issuer.isRealEstate);
  $("#approvalLevel").value = issuer.credit?.approvalLevel || "";
  $("#approvedAmount").value = issuer.credit?.approvedAmount ?? "";
  $("#privateAmount").value = issuer.credit?.privateAmount ?? "";
  $("#offeringType").value = issuer.credit?.offeringType || "";
  $("#approvedRatio").value = issuer.credit?.approvedRatio ?? "";
  $("#privateRatio").value = issuer.credit?.privateRatio ?? "";
  $("#investmentTermText").value = issuer.credit?.investmentTermText || "";
  $("#sourceRank").value = issuer.credit?.sourceRank ?? "";
  $("#creditRawText").value = issuer.credit?.rawText || "";
  $("#issuerFormTitle").textContent = `编辑：${issuer.legalName}`;
  $("#deleteIssuerButton").hidden = false;
  renderIssuerList();
}

function bindDataActions() {
  $("#saveCloudButton").addEventListener("click", async () => {
    const ok = await saveCloudState();
    showToast(ok ? "资料库已同步至 Cloudflare D1。" : "D1 未连接，项目中心已锁定。");
  });

  $("#setPasswordButton").addEventListener("click", async () => {
    const value = prompt("请输入 Cloudflare Pages Secret 中配置的 APP_PASSWORD：", "");
    if (value === null) return;
    if (value.trim()) sessionStorage.setItem(TOKEN_KEY, value.trim());
    else sessionStorage.removeItem(TOKEN_KEY);
    await loadCloudState();
  });

  $("#exportDataButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `credit-bond-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $("#importDataInput").addEventListener("change", async () => {
    const file = $("#importDataInput").files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported.issuers)) throw new Error("文件中缺少 issuers 数组。");
      state = normalizeLoadedState({ ...imported, updatedAt: new Date().toISOString() });
      persistState();
      renderIssuerOptions();
      renderIssuerList();
      renderFtpCurveForm();
      renderProjectWorkspace();
      renderProtocolTransferWorkspace();
      regenerate();
      showToast(`已导入 ${state.issuers.length} 个主体和 ${(state.projects || []).length} 个项目。`);
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      $("#importDataInput").value = "";
    }
  });
}

async function loadCloudState() {
  if (!getApiToken()) {
    cloudAvailable = false;
    setSyncStatus("未连接 D1", "请先设置云端口令");
    setCloudGate(true, {
      state: "idle",
      title: "请先连接资料库",
      detail: "点击右上角“设置云端口令”，连接 Cloudflare D1 后使用项目中心。",
    });
    return;
  }
  setSyncStatus("正在连接", "尝试读取 Cloudflare D1");
  setCloudGate(true, {
    state: "connecting",
    title: "正在连接 Cloudflare D1",
    detail: "正在校验口令并读取云端资料库。",
  });
  try {
    const response = await fetch(API_URL, { cache: "no-store", headers: authHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    const shouldMigrateFtpCurve = ftpCurveNeedsMigration(remote.data?.ftpCurve);
    if (remote.data?.issuers) {
      state = normalizeLoadedState(remote.data);
    }
    cloudAvailable = true;
    persistLocal();
    setSyncStatus("D1 已连接", `${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目`);
    setCloudGate(true, {
      state: "success",
      title: "D1 连接成功",
      detail: `已载入 ${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目。`,
    });
    window.setTimeout(() => setCloudGate(false, { state: "success" }), 850);
    if (shouldMigrateFtpCurve) await saveCloudState();
  } catch {
    cloudAvailable = false;
    setSyncStatus("D1 未连接", "请检查口令或重新连接");
    setCloudGate(true, {
      state: "error",
      title: "D1 连接失败",
      detail: "D1 暂时无法连接。请点击右上角“设置云端口令”重新输入口令。",
    });
  }
  renderIssuerOptions();
  renderIssuerList();
  renderFtpCurveForm();
  renderProjectWorkspace();
  renderProtocolTransferWorkspace();
  if (batchItems.length) renderBatchResults();
}

async function saveCloudState() {
  persistLocal();
  if (!getApiToken()) {
    setSyncStatus("未连接 D1", "请先设置云端口令");
    setCloudGate(true, {
      state: "idle",
      title: "请先连接资料库",
      detail: "请先设置云端口令，连接 D1 后再同步。",
    });
    return false;
  }
  try {
    const response = await fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ data: state }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cloudAvailable = true;
    setSyncStatus("D1 已同步", `${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目`);
    setCloudGate(false, { state: "success" });
    return true;
  } catch {
    cloudAvailable = false;
    setSyncStatus("D1 同步失败", "请检查网络或口令");
    setCloudGate(true, {
      state: "error",
      title: "D1 同步失败",
      detail: "为避免本机数据覆盖云端，请重新连接后再继续使用。",
    });
    return false;
  }
}

function persistState() {
  state.updatedAt = new Date().toISOString();
  persistLocal();
  if (cloudAvailable) saveCloudState();
}

function loadLocalState() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return value?.issuers ? normalizeLoadedState(value) : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function enterpriseTypeOptions(selected = "") {
  const values = ["", "央企", "地方国企", "民营企业", "其他"];
  return values.map((value) =>
    `<option value="${value}" ${value === selected ? "selected" : ""}>${value || "待选择"}</option>`,
  ).join("");
}

function localDateTime(value) {
  const date = new Date(value);
  return `${localDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeLoadedState(value) {
  return {
    ...DEFAULT_STATE,
    ...value,
    issuers: (value.issuers || []).filter((issuer) => issuer?.legalName).map(normalizeIssuer),
    ftpCurve: normalizeFtpCurve(value.ftpCurve),
    projects: (value.projects || []).map(normalizeProjectRecord),
    protocolTransfers: normalizeProtocolTransfers(value.protocolTransfers || []),
  };
}

function normalizeFtpCurve(input = {}) {
  return Object.fromEntries(FTP_TENORS.map((tenor) => [tenor.key, normalizeFtpRatePercent(input?.[tenor.key])]));
}

function ftpCurveNeedsMigration(input = {}) {
  return FTP_TENORS.some((tenor) => {
    const value = numberOrNull(input?.[tenor.key]);
    return Number.isFinite(value) && Math.abs(value) > 20;
  });
}

function normalizeFtpRatePercent(value) {
  const number = numberOrNull(value);
  if (!Number.isFinite(number)) return null;
  return Math.abs(number) > 20 ? round(number / 100, 6) : number;
}

function calculateRevenueBpFromFtpRate(winningRate, ftpRatePercent) {
  return round(numberOrNull(winningRate) * 100 * 0.9366 - numberOrNull(ftpRatePercent) * 100, 2);
}

function persistLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

function setSyncStatus(status, detail) {
  $("#syncStatus").textContent = status;
  $("#syncDetail").textContent = detail;
}

function setCloudGate(locked, options = {}) {
  const config = typeof options === "string" ? { detail: options } : options;
  const gate = $("#cloudGate");
  const stateName = config.state || (locked ? "idle" : "success");
  $(".main").classList.toggle("cloud-locked", Boolean(locked));
  $(".main").classList.toggle("cloud-ready", !locked);
  gate.hidden = !locked;
  gate.classList.remove("cloud-gate-idle", "cloud-gate-connecting", "cloud-gate-success", "cloud-gate-error");
  gate.classList.add(`cloud-gate-${stateName}`);
  $("#saveCloudButton").disabled = Boolean(locked);
  $("#exportDataButton").disabled = Boolean(locked);
  $("#importDataInput").disabled = Boolean(locked);
  $("#importDataInput").closest(".file-button")?.classList.toggle("unavailable", Boolean(locked));
  if (config.title) $("#cloudGateTitle").textContent = config.title;
  if (config.detail) $("#cloudGateDetail").textContent = config.detail;
  $("#cloudGateStep").textContent = stateName === "error" ? "ERR" : stateName === "success" ? "OK" : "D1";
  $("#cloudGateSymbol").textContent = stateName === "error" ? "!" : stateName === "success" ? "✓" : "D1";
}

function getApiToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function authHeaders() {
  return { Authorization: `Bearer ${getApiToken()}` };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
