import {
  DEFAULT_STATE,
  buildBondFullName,
  buildUnderwriter,
  durationParts,
  durationToDays,
  findIssuer,
  formatNumber,
  generateOpinion,
  mergeImportedIssuers,
  parseProjectBrief,
  splitProjectBriefs,
  upsertIssuer,
} from "./core.js";
import {
  buildBidResultSummary,
  createProjectRecord,
  dashboardCounts,
  deriveProjectStatus,
  normalizeProjectRecord,
  removeProject,
  upsertProject,
} from "./lifecycle.js";
import {
  deriveIssuerAlias,
  extractIssuerLegalName,
  parseCreditText,
  parseHistoryText,
} from "./history-parser.js";

const LOCAL_KEY = "credit-bond-process-state-v1";
const TOKEN_KEY = "credit-bond-process-api-token";
const API_URL = "./api/state";
const SAMPLE_BRIEF = `26粤交投SCP002 非我行主承 广州分行
270D 规模7亿 AAA(中诚信国际)/隐含AAA
询价区间1.25-1.45 银行间 中信银行

26粤交投SCP002 市场估值约1.46
如需综合定价，指导价约1.48`;

const SAMPLE_ISSUER = {
  id: "sample-yuejiaotou",
  legalName: "广州交通投资集团有限公司",
  aliases: ["粤交投", "广州交投"],
  defaultBranch: "广州分行",
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
let ledgerFilter = "all";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

if (location.hostname.endsWith(".pages.dev")) {
  location.replace(`https://tempest07-gateway.weiqian-yu.workers.dev/credit-bond-process/${location.search}${location.hash}`);
}

initialize();

async function initialize() {
  bindNavigation();
  bindGenerator();
  bindLedger();
  bindQuickIssuer();
  bindBatch();
  bindDatabase();
  initializeHistoryImport();
  bindDataActions();
  renderIssuerOptions();
  renderIssuerList();
  renderProjectWorkspace();
  clearIssuerForm();
  await loadCloudState();
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === button.dataset.viewTarget));
      $("#pageTitle").textContent = button.textContent;
    });
  });
}

function bindGenerator() {
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
    selectedIssuerId = $("#issuerSelect").value;
    regenerate();
  });

  $$("[data-project-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const field = input.dataset.projectField;
      project[field] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
      if (field === "durationText") {
        project.durationDays = durationToDays(project.durationText);
        project.durationParts = durationParts(project.durationText);
      }
      if (field.startsWith("inquiry")) rebuildInquiryRanges(project);
      if (field === "offeringType") applyOfferingTypeChoice(project, project.offeringType, true);
      if (field === "exchangeIssueNumber") applyExchangeIssueNumberChoice(project, project.exchangeIssueNumber, true);
      regenerate();
    });
  });

  $("#copyButton").addEventListener("click", async () => {
    const value = $("#opinionOutput").value;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    showToast("流程意见已复制。");
  });
  $("#saveProjectButton").addEventListener("click", saveCurrentProject);
}

function saveCurrentProject() {
  const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
  const generated = { ...generateOpinion(project, issuer), opinion: $("#opinionOutput").value };
  if (!project.shortName) {
    showToast("请先解析项目简表，再保存为项目。");
    return;
  }
  const existing = (state.projects || []).find((item) => item.shortName === project.shortName && item.status !== "已结束");
  const created = createProjectRecord({ ...project, leadUnderwriter: buildUnderwriter(project) }, issuer, generated, { id: existing?.id });
  const record = existing
    ? {
        ...created,
        status: existing.status,
        cutoffAt: existing.cutoffAt,
        notes: existing.notes,
        tranches: existing.tranches?.length === created.tranches.length ? existing.tranches : created.tranches,
        comprehensivePricing: existing.comprehensivePricing,
        afterTaxRevenue: existing.afterTaxRevenue,
        ftpCost: existing.ftpCost,
        createdAt: existing.createdAt,
      }
    : created;
  state = upsertProject(state, record);
  selectedProjectId = record.id;
  persistState();
  renderProjectWorkspace();
  showToast(existing ? "已更新现有项目台账。" : "已保存至项目台账。");
}

function bindLedger() {
  $("#projectSearch").addEventListener("input", renderProjectList);
  $("#projectStatusFilter").addEventListener("change", renderProjectList);
  $("#newProjectButton").addEventListener("click", () => {
    const record = normalizeProjectRecord({ shortName: "新项目" });
    state = upsertProject(state, record);
    selectedProjectId = record.id;
    persistState();
    renderProjectWorkspace();
  });
  $$("[data-ledger-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      ledgerFilter = button.dataset.ledgerFilter;
      $$("[data-ledger-filter]").forEach((item) => item.classList.toggle("active", item === button));
      renderProjectList();
    });
  });
  $("#addTrancheButton").addEventListener("click", () => {
    const draft = readProjectForm();
    draft.tranches.push(normalizeProjectRecord({ shortName: "新品种" }).tranches[0]);
    fillProjectForm(draft);
  });
  $("#projectAfterTaxRevenue").addEventListener("input", updateNetIncomePreview);
  $("#projectFtpCost").addEventListener("input", updateNetIncomePreview);
  $("#projectForm").addEventListener("input", updateResultSummaryPreview);
  $("#projectForm").addEventListener("change", updateResultSummaryPreview);
  $("#copyResultSummaryButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#projectResultSummary").value);
    showToast("结果摘要已复制。");
  });
  $("#projectForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = readProjectForm();
    const derivedStatus = deriveProjectStatus(draft);
    if (draft.status !== "已结束" && (derivedStatus !== "待投标" || draft.status === "待投标")) {
      draft.status = derivedStatus;
    }
    state = upsertProject(state, draft);
    selectedProjectId = draft.id;
    persistState();
    renderProjectWorkspace();
    showToast("项目、投标与中标结果已保存。");
  });
  $("#deleteProjectButton").addEventListener("click", () => {
    if (!selectedProjectId || !confirm("确定删除当前项目台账吗？")) return;
    state = removeProject(state, selectedProjectId);
    selectedProjectId = "";
    persistState();
    renderProjectWorkspace();
    showToast("项目已删除。");
  });
}

function parseAndRender() {
  project = parseProjectBrief($("#briefInput").value);
  const matched = findIssuer(project.shortName, state.issuers);
  selectedIssuerId = matched?.id || "";
  fillProjectFields();
  renderIssuerOptions();
  regenerate();
}

function fillProjectFields() {
  $$("[data-project-field]").forEach((input) => {
    const field = input.dataset.projectField;
    input.value = project[field] ?? "";
  });
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
  renderDashboard();
  renderProjectList();
  const selected = (state.projects || []).find((item) => item.id === selectedProjectId);
  if (selected) fillProjectForm(selected);
  else clearProjectForm();
}

function renderDashboard() {
  const counts = dashboardCounts(state.projects || []);
  $("#dashboardAll").textContent = counts.all;
  $("#dashboardDueToday").textContent = counts.dueToday;
  $("#dashboardToBid").textContent = counts.toBid;
  $("#dashboardAwaitingResult").textContent = counts.awaitingResult;
  $("#dashboardWon").textContent = counts.won;
  $("#dashboardNotWon").textContent = counts.notWon;
}

function renderProjectList() {
  const query = $("#projectSearch").value.trim().toLowerCase();
  const statusFilter = $("#projectStatusFilter").value;
  const today = localDate(new Date());
  const projects = (state.projects || [])
    .filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (ledgerFilter === "dueToday" && !(item.status === "待投标" && item.cutoffAt?.slice(0, 10) === today)) return false;
      if (ledgerFilter === "toBid" && item.status !== "待投标") return false;
      if (ledgerFilter === "awaitingResult" && item.status !== "已投标待结果") return false;
      if (ledgerFilter === "won" && !["部分中标", "已中标"].includes(item.status)) return false;
      if (ledgerFilter === "notWon" && item.status !== "未中标") return false;
      return `${item.shortName} ${item.issuerName} ${item.branch} ${item.leadUnderwriter}`.toLowerCase().includes(query);
    })
    .sort(compareProjects);

  $("#projectList").innerHTML = projects.length
    ? projects.map((item) => `
      <button class="project-item ${item.id === selectedProjectId ? "active" : ""}" data-project-id="${escapeAttribute(item.id)}">
        <span class="project-item-head">
          <strong>${escapeHtml(item.shortName || "未命名项目")}</strong>
          <span class="status-badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>
        </span>
        <span class="project-item-meta"><span>${escapeHtml(item.issuerName || item.branch || "未填写主体")}</span><span>${escapeHtml(formatCutoff(item.cutoffAt))}</span></span>
        <span class="project-item-meta"><span>${escapeHtml((item.tranches || []).map((tranche) => tranche.durationText).filter(Boolean).join("/") || "期限待补")}</span><span>${escapeHtml(item.leadUnderwriter || "主承待补")}</span></span>
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

function clearProjectForm() {
  $("#projectEmpty").hidden = false;
  $("#projectForm").hidden = true;
}

function fillProjectForm(input) {
  const record = normalizeProjectRecord(input);
  $("#projectEmpty").hidden = true;
  $("#projectForm").hidden = false;
  $("#projectId").value = record.id;
  $("#projectShortName").value = record.shortName;
  $("#projectStatus").value = record.status;
  $("#projectIssuerName").value = record.issuerName;
  $("#projectBranch").value = record.branch;
  $("#projectVenue").value = record.venue;
  $("#projectLeadUnderwriter").value = record.leadUnderwriter;
  $("#projectCutoffAt").value = record.cutoffAt;
  $("#projectNotes").value = record.notes;
  $("#projectComprehensivePricing").checked = record.comprehensivePricing;
  $("#projectPricingUnit").value = record.pricingUnit;
  $("#projectAfterTaxRevenue").value = record.afterTaxRevenue ?? "";
  $("#projectFtpCost").value = record.ftpCost ?? "";
  $("#projectNetIncome").value = record.netIncome ?? "";
  $("#projectOpinion").value = record.opinion;
  $("#projectResultSummary").value = buildBidResultSummary(record);
  $("#projectFormTitle").textContent = record.shortName || "项目详情";
  $("#projectStatusPill").textContent = record.status;
  renderTranches(record.tranches);
  renderProjectList();
}

function renderTranches(tranches) {
  $("#trancheList").innerHTML = tranches.map((tranche, index) => `
    <section class="tranche-card" data-tranche-index="${index}">
      <div class="tranche-card-head">
        <strong>品种 ${index + 1}</strong>
        <button class="text-button" type="button" data-remove-tranche="${index}" ${tranches.length <= 1 ? "hidden" : ""}>移除品种</button>
      </div>
      <div class="tranche-grid">
        <label>债券简称<input data-tranche-field="shortName" value="${escapeAttribute(tranche.shortName)}"></label>
        <label>期限<input data-tranche-field="durationText" value="${escapeAttribute(tranche.durationText)}"></label>
        <label>询价下限（%）<input data-tranche-field="inquiryLow" type="number" step="0.0001" value="${escapeAttribute(tranche.inquiryLow ?? "")}"></label>
        <label>询价上限（%）<input data-tranche-field="inquiryHigh" type="number" step="0.0001" value="${escapeAttribute(tranche.inquiryHigh ?? "")}"></label>
        <label>投标利率（%）<input data-tranche-field="bidRate" type="number" step="0.0001" value="${escapeAttribute(tranche.bidRate ?? "")}"></label>
        <label>投标量（亿元）<input data-tranche-field="bidAmount" type="number" step="0.0001" value="${escapeAttribute(tranche.bidAmount ?? "")}"></label>
        <label>截标结果
          <select data-tranche-field="resultStatus">
            <option ${tranche.resultStatus === "待出结果" ? "selected" : ""}>待出结果</option>
            <option ${tranche.resultStatus === "中标" ? "selected" : ""}>中标</option>
            <option ${tranche.resultStatus === "未中标" ? "selected" : ""}>未中标</option>
          </select>
        </label>
        <label>中标利率（%）<input data-tranche-field="winningRate" type="number" step="0.0001" value="${escapeAttribute(tranche.winningRate ?? "")}"></label>
        <label>中标量（亿元）<input data-tranche-field="winningAmount" type="number" step="0.0001" value="${escapeAttribute(tranche.winningAmount ?? "")}"></label>
      </div>
    </section>
  `).join("");

  $$("[data-remove-tranche]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = readProjectForm();
      draft.tranches.splice(Number(button.dataset.removeTranche), 1);
      fillProjectForm(draft);
    });
  });
}

function readProjectForm() {
  const existing = (state.projects || []).find((item) => item.id === $("#projectId").value) || {};
  const tranches = $$("[data-tranche-index]").map((card) => {
    const values = {};
    card.querySelectorAll("[data-tranche-field]").forEach((input) => {
      values[input.dataset.trancheField] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
    });
    values.id = existing.tranches?.[Number(card.dataset.trancheIndex)]?.id;
    return values;
  });
  return normalizeProjectRecord({
    ...existing,
    id: $("#projectId").value,
    shortName: $("#projectShortName").value,
    status: $("#projectStatus").value,
    issuerName: $("#projectIssuerName").value,
    branch: $("#projectBranch").value,
    venue: $("#projectVenue").value,
    leadUnderwriter: $("#projectLeadUnderwriter").value,
    cutoffAt: $("#projectCutoffAt").value,
    notes: $("#projectNotes").value,
    comprehensivePricing: $("#projectComprehensivePricing").checked,
    pricingUnit: $("#projectPricingUnit").value,
    afterTaxRevenue: numberOrNull($("#projectAfterTaxRevenue").value),
    ftpCost: numberOrNull($("#projectFtpCost").value),
    opinion: $("#projectOpinion").value,
    tranches,
  });
}

function updateNetIncomePreview() {
  const revenue = numberOrNull($("#projectAfterTaxRevenue").value);
  const ftp = numberOrNull($("#projectFtpCost").value);
  $("#projectNetIncome").value = Number.isFinite(revenue) && Number.isFinite(ftp) ? formatNumber(revenue - ftp) : "";
}

function updateResultSummaryPreview() {
  if ($("#projectForm").hidden) return;
  updateNetIncomePreview();
  $("#projectResultSummary").value = buildBidResultSummary(readProjectForm());
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

function statusBadgeClass(status) {
  if (["待投标", "已投标待结果"].includes(status)) return "warning";
  if (["未中标", "已结束"].includes(status)) return "muted";
  return "";
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
      persistState();
      renderIssuerOptions();
      renderIssuerList();
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
}

function parseBatchInput() {
  const blocks = splitProjectBriefs($("#batchInput").value);
  batchItems = blocks.map((sourceText) => {
    const parsedProject = parseProjectBrief(sourceText);
    const issuer = findIssuer(parsedProject.shortName, state.issuers);
    return {
      sourceText,
      project: parsedProject,
      selectedIssuerId: issuer?.id || "",
      draft: createIssuerDraft(parsedProject, issuer),
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
    return;
  }

  let matchedCount = 0;
  let warningCount = 0;
  container.innerHTML = batchItems.map((item, index) => {
    const issuer = state.issuers.find((candidate) => candidate.id === item.selectedIssuerId) || null;
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
    const warnings = [...new Set(generated.warnings.filter((warning) =>
      warning && !warning.startsWith("一级投标利率按规则留空"),
    ))];
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

  $$("[data-batch-select]").forEach((select) => {
    select.addEventListener("change", () => {
      captureBatchDrafts();
      const index = Number(select.dataset.batchSelect);
      const issuer = state.issuers.find((candidate) => candidate.id === select.value) || null;
      batchItems[index].selectedIssuerId = select.value;
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

function bindDatabase() {
  $("#newIssuerButton").addEventListener("click", clearIssuerForm);
  $("#issuerSearch").addEventListener("input", renderIssuerList);
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
    legalName: issuer?.legalName || extractIssuerLegalName(projectValue?.fullName || ""),
    aliases: (issuer?.aliases?.length ? issuer.aliases : derivedAliases).join("，"),
    defaultBranch: issuer?.defaultBranch || projectValue?.branch || "",
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
  projectValue.inquiryRanges = [];
  if (Number.isFinite(projectValue.inquiryLow) && Number.isFinite(projectValue.inquiryHigh)) {
    projectValue.inquiryRanges.push({ low: projectValue.inquiryLow, high: projectValue.inquiryHigh });
  }
  if (Number.isFinite(projectValue.inquiryLow2) && Number.isFinite(projectValue.inquiryHigh2)) {
    projectValue.inquiryRanges.push({ low: projectValue.inquiryLow2, high: projectValue.inquiryHigh2 });
  }
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
        <span>${escapeHtml((issuer.aliases || []).join(" / ") || "暂无简称")} · ${escapeHtml(issuer.credit?.rawText || "暂无授信原文")}</span>
      </button>
    `).join("")
    : '<div class="empty">暂无主体资料。可新增主体，或载入示例。</div>';

  $$("[data-issuer-id]").forEach((button) => {
    button.addEventListener("click", () => fillIssuerForm(state.issuers.find((issuer) => issuer.id === button.dataset.issuerId)));
  });
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
    showToast(ok ? "资料库已同步至 Cloudflare D1。" : "D1 尚未配置，资料仍已保存在本机。");
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
      state = { ...DEFAULT_STATE, ...imported, updatedAt: new Date().toISOString() };
      persistState();
      renderIssuerOptions();
      renderIssuerList();
      renderProjectWorkspace();
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
    setSyncStatus("本机模式", "设置云端口令后连接 D1");
    return;
  }
  setSyncStatus("正在连接", "尝试读取 Cloudflare D1");
  try {
    const response = await fetch(API_URL, { cache: "no-store", headers: authHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (remote.data?.issuers) {
      const remoteTime = Date.parse(remote.data.updatedAt || 0);
      const localTime = Date.parse(state.updatedAt || 0);
      if (remoteTime >= localTime) state = { ...DEFAULT_STATE, ...remote.data };
    }
    cloudAvailable = true;
    persistLocal();
    setSyncStatus("D1 已连接", `${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目`);
  } catch {
    cloudAvailable = false;
    setSyncStatus("本机模式", `${state.issuers.length} 个主体，D1 尚未配置`);
  }
  renderIssuerOptions();
  renderIssuerList();
  renderProjectWorkspace();
  if (batchItems.length) renderBatchResults();
}

async function saveCloudState() {
  persistLocal();
  if (!getApiToken()) {
    setSyncStatus("本机模式", "请先设置云端口令");
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
    return true;
  } catch {
    cloudAvailable = false;
    setSyncStatus("本机模式", "资料已保存在浏览器，D1 同步失败");
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
    return value?.issuers ? { ...DEFAULT_STATE, ...value, projects: value.projects || [] } : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function persistLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

function setSyncStatus(status, detail) {
  $("#syncStatus").textContent = status;
  $("#syncDetail").textContent = detail;
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
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
