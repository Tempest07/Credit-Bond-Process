import {
  DEFAULT_STATE,
  buildBondFullName,
  durationParts,
  durationToDays,
  findIssuer,
  formatNumber,
  generateOpinion,
  mergeImportedIssuers,
  parseProjectBrief,
  splitProjectBriefs,
  upsertIssuer,
} from "./core.js?v=20260611-payment-reminders";
import {
  applyGuidancePricing,
  applyIssuanceAdvertisement,
  buildAwardResultText,
  buildBidPositionText,
  createProjectRecord,
  dashboardCounts,
  deriveProjectStatus,
  normalizeProjectRecord,
  removeProject,
  suggestProjectCutoff,
  trancheNeedsPayment,
  updateProjectCutoff,
  upsertProject,
} from "./lifecycle.js?v=20260611-payment-reminders";
import {
  deriveIssuerAlias,
  extractIssuerLegalName,
  parseCreditText,
  parseHistoryText,
} from "./history-parser.js?v=20260611-payment-reminders";

const LOCAL_KEY = "credit-bond-process-state-v1";
const TOKEN_KEY = "credit-bond-process-api-token";
const API_URL = "./api/state";
const MAILER_URL = "https://credit-bond-mailer.weiqian-yu.workers.dev";
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
  enterpriseType: "地方国企",
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
let projectAutoSaveTimer = null;

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
    button.addEventListener("click", () => switchView(button.dataset.viewTarget));
  });
}

function switchView(viewName) {
  const button = $(`.nav-item[data-view-target="${viewName}"]`);
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  if (button) $("#pageTitle").textContent = button.textContent;
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
  const suggestedRatios = generated.suggestion.trancheSuggestions.map((item) => item.suggestedRatio);
  const created = createProjectRecord({
    ...project,
    leadUnderwriter: project.sponsorStatus === "牵头" ? "兴业银行" : project.leadUnderwriter,
    suggestedRatios,
  }, issuer, generated, { id: existing?.id });
  const record = existing
    ? {
        ...created,
        status: existing.status,
        cutoffAt: existing.cutoffAt || created.cutoffAt,
        cutoffTimeConfirmed: existing.cutoffAt ? existing.cutoffTimeConfirmed : created.cutoffTimeConfirmed,
        cutoffSource: existing.cutoffAt ? existing.cutoffSource : created.cutoffSource,
        cutoffHistory: existing.cutoffHistory || [],
        notes: existing.notes,
        resultAdvertisement: existing.resultAdvertisement,
        resultConfirmed: existing.resultConfirmed,
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
      }
    : created;
  state = upsertProject(state, record);
  selectedProjectId = record.id;
  persistState();
  renderProjectWorkspace();
  switchView("ledger");
  showToast(existing ? "已更新现有项目台账。" : "已保存至项目台账。");
}

function bindLedger() {
  $("#projectSearch").addEventListener("input", renderProjectList);
  $("#projectStatusFilter").addEventListener("change", renderProjectList);
  $("#previewMailButton").addEventListener("click", () => callMailer("preview"));
  $("#sendMailButton").addEventListener("click", () => callMailer("send"));
  $("#newProjectButton").addEventListener("click", () => {
    project = parseProjectBrief("");
    selectedIssuerId = "";
    $("#briefInput").value = "";
    fillProjectFields();
    renderIssuerOptions();
    regenerate();
    switchView("generator");
    $("#briefInput").focus();
  });
  $$("[data-ledger-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      ledgerFilter = button.dataset.ledgerFilter;
      $$("[data-ledger-filter]").forEach((item) => item.classList.toggle("active", item === button));
      updateLedgerFilterLabel(button);
      $("#ledgerFilterDetails").open = false;
      renderProjectList();
    });
  });
  $("#addTrancheButton").addEventListener("click", () => {
    const draft = readProjectForm();
    draft.tranches.push(normalizeProjectRecord({ shortName: "新品种" }).tranches[0]);
    refillProjectForm(draft);
    saveProjectDraftNow();
  });
  $("#projectForm").addEventListener("input", () => {
    updateProjectPreviews();
    scheduleProjectAutoSave();
  });
  $("#projectForm").addEventListener("change", () => {
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
  $("#projectCutoffTimeConfirmed").addEventListener("change", () => {
    $("#projectCutoffSource").value = $("#projectCutoffTimeConfirmed").checked ? "手工确认" : "待确认";
    const draft = readProjectForm();
    renderCutoffHint(draft);
    saveProjectRecordNow(draft);
  });
  $$("[data-cutoff-action]").forEach((button) => {
    button.addEventListener("click", () => applyCutoffAction(button.dataset.cutoffAction));
  });
  $("#markUnbidButton").addEventListener("click", () => setProjectActionStatus("未投标"));
  $("#markBidButton").addEventListener("click", () => setProjectActionStatus("已投标待结果"));
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
    const parsed = applyIssuanceAdvertisement({ ...draft, resultConfirmed: true }, advertisement);
    parsed.resultConfirmed = true;
    parsed.status = deriveProjectStatus(parsed);
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
  $("#dashboardDueToday").textContent = counts.dueToday;
  $("#dashboardToBid").textContent = counts.toBid;
  $("#dashboardAwaitingResult").textContent = counts.awaitingResult;
  $("#dashboardWon").textContent = counts.won;
  $("#dashboardNotWon").textContent = counts.notWon;
  $("#dashboardPaymentToday").textContent = counts.paymentToday;
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
  $("#cutoffTodoCount").textContent = todos.length ? `${todos.length} 项需关注` : "暂无待办";
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
  const output = $("#mailOutput");
  output.hidden = false;
  if (!token) {
    output.textContent = "请先点击右上角“设置云端口令”，输入 APP_PASSWORD 后再发送邮件。";
    return;
  }

  const isSend = action === "send";
  const button = isSend ? $("#sendMailButton") : $("#previewMailButton");
  button.disabled = true;
  output.textContent = isSend ? "正在发送今日流程邮件..." : "正在生成今日邮件预览...";
  try {
    const response = await fetch(`${MAILER_URL}/${isSend ? "send-today" : "preview-today"}`, {
      method: isSend ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      output.textContent = JSON.stringify({
        ok: false,
        httpStatus: response.status,
        ...(payload || { error: text.slice(0, 1000) }),
      }, null, 2);
      showToast(isSend ? "邮件发送失败，请查看输出详情。" : "邮件预览失败，请查看输出详情。");
      return;
    }

    if (isSend) {
      output.textContent = JSON.stringify(payload, null, 2);
      showToast(payload.status === "sent" ? "今日流程邮件已发送。" : payload.reason || "邮件发送请求已完成。");
    } else {
      output.textContent = payload?.text || JSON.stringify(payload, null, 2);
      showToast(`已生成 ${payload?.projectCount ?? 0} 笔项目的邮件预览。`);
    }
  } catch (error) {
    output.textContent = JSON.stringify({
      status: "error",
      error: error.message || String(error),
      hint: "请确认 credit-bond-mailer Worker 已部署，且允许跨域访问。",
    }, null, 2);
    showToast("邮件服务暂时无法访问。");
  } finally {
    button.disabled = false;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  $("#paymentTodoCount").textContent = todos.length ? `${todos.length} 项待处理` : "暂无待办";
  $("#paymentTodoPanel").classList.toggle("empty-state", !todos.length);
  $("#paymentTodoList").innerHTML = todos.length
    ? todos.map(({ project: projectValue, tranche }) => {
        const timing = tranche.paymentDate < today ? "overdue" : tranche.paymentDate === today ? "today" : "upcoming";
        const timingLabel = timing === "overdue" ? "已逾期" : timing === "today" ? "今日缴款" : tranche.paymentDate;
        return `
          <article class="payment-todo-item ${timing}">
            <button class="payment-todo-main" type="button" data-open-payment-project="${escapeAttribute(projectValue.id)}">
              <strong>${escapeHtml(tranche.shortName || projectValue.shortName)}</strong>
              <span>${escapeHtml(projectValue.issuerName || projectValue.branch || "主体待补")} · ${escapeHtml(timingLabel)}</span>
            </button>
            <button class="button subtle" type="button" data-complete-payment="${escapeAttribute(`${projectValue.id}:${tranche.id}`)}">标记已缴款</button>
          </article>
        `;
      }).join("")
    : '<div class="payment-todo-empty">目前没有待缴款任务。</div>';
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

function updateLedgerFilterLabel(button) {
  const label = button?.querySelector("span")?.textContent || "全部项目";
  $("#ledgerFilterLabel").textContent = `当前：${label}`;
}

function renderProjectList() {
  const query = $("#projectSearch").value.trim().toLowerCase();
  const statusFilter = $("#projectStatusFilter").value;
  const today = localDate(new Date());
  const projects = (state.projects || [])
    .filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
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
      <button class="project-item ${item.id === selectedProjectId ? "active" : ""}" data-project-id="${escapeAttribute(item.id)}">
        <span class="project-item-head">
          <strong>${escapeHtml(item.shortName || "未命名项目")}</strong>
          <span class="status-badge ${statusBadgeClass(item.status)}">${escapeHtml(item.status)}</span>
        </span>
        <span class="project-item-meta"><span>${escapeHtml(item.issuerName || item.branch || "未填写主体")}</span><span>${escapeHtml(formatProjectSchedule(item))}</span></span>
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
  $("#projectCutoffTimeConfirmed").checked = record.cutoffTimeConfirmed;
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
  return applySourceGuidancePricing(normalizeProjectRecord({
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
    cutoffTimeConfirmed: $("#projectCutoffTimeConfirmed").checked,
    cutoffSource: $("#projectCutoffSource").value,
    notes: existing.notes,
    sourceText: $("#projectSourceText").value,
    opinion: $("#projectOpinion").value,
    resultAdvertisement: $("#projectResultAdvertisement").value,
    ftpCost: numberOrNull($("#projectFtpCost").value),
    tranches,
  }));
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
  if (!Number.isFinite(numberOrNull(draft.ftpCost))) return;
  let changed = false;
  draft.tranches = draft.tranches.map((tranche) => {
    const winningRate = numberOrNull(tranche.winningRate);
    const winningAmount = numberOrNull(tranche.winningAmountWan);
    if (!Number.isFinite(winningRate) || !Number.isFinite(winningAmount) || winningAmount <= 0) return tranche;
    changed = true;
    return { ...tranche, revenueBp: round(winningRate * 75 - draft.ftpCost, 2) };
  });
  if (!changed) return;
  refillProjectForm(draft);
  saveProjectRecordNow(draft);
  showToast("已按 FTP 重算表内营收。");
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
  const normalized = normalizeProjectRecord(record);
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
  draft.resultConfirmed = status !== "未投标" && status !== "已投标待结果" ? draft.resultConfirmed : false;
  saveProjectRecordNow(draft);
  if (status === "未投标" || status === "已投标待结果") {
    closeResultEntryPanel();
    setResultEntryFieldsVisible(false);
  }
  showToast(status === "未投标" ? "项目已撤回为未投标。" : "项目已确认投标，等待发行结果。");
}

function updateProjectActionButtons(status) {
  $("#markUnbidButton").disabled = status === "未投标";
  $("#markBidButton").disabled = status === "已投标待结果";
  $("#openResultButton").disabled = status === "未投标";
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

function statusBadgeClass(status) {
  if (["未投标", "待投标", "已投标待结果"].includes(status)) return "warning";
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
        <label>企业性质<select data-batch-index="${index}" data-batch-field="enterpriseType">${enterpriseTypeOptions(draft.enterpriseType)}</select></label>
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
        <label>企业性质<select data-review-field="enterpriseType">${enterpriseTypeOptions(draft.enterpriseType)}</select></label>
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
    enterpriseType: issuer?.enterpriseType || "",
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
    EnterpriseType: draft.enterpriseType,
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
        <span>${escapeHtml((issuer.aliases || []).join(" / ") || "暂无简称")} · ${escapeHtml(issuer.enterpriseType || "企业性质待补")} · ${escapeHtml(issuer.credit?.rawText || "暂无授信原文")}</span>
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
  $("#enterpriseType").value = issuer.enterpriseType || "";
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
      state = normalizeLoadedState({ ...imported, updatedAt: new Date().toISOString() });
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
      if (remoteTime >= localTime) state = normalizeLoadedState(remote.data);
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
    projects: (value.projects || []).map(normalizeProjectRecord),
  };
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
