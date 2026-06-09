import {
  DEFAULT_STATE,
  buildBondFullName,
  durationToDays,
  findIssuer,
  formatNumber,
  generateOpinion,
  parseProjectBrief,
  upsertIssuer,
} from "./core.js";

const LOCAL_KEY = "credit-bond-process-state-v1";
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

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

if (location.hostname.endsWith(".pages.dev")) {
  location.replace(`https://tempest07-gateway.weiqian-yu.workers.dev/credit-bond-process/${location.search}${location.hash}`);
}

initialize();

async function initialize() {
  bindNavigation();
  bindGenerator();
  bindDatabase();
  bindDataActions();
  renderIssuerOptions();
  renderIssuerList();
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
      if (field === "durationText") project.durationDays = durationToDays(project.durationText);
      regenerate();
    });
  });

  $("#copyButton").addEventListener("click", async () => {
    const value = $("#opinionOutput").value;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    showToast("流程意见已复制。");
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
    const fullName = buildBondFullName(project.shortName, issuer.legalName);
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
    ? `建议 ${formatNumber(suggestion.suggestedRatio)}% / ${formatNumber(suggestion.investmentAmount)}亿元`
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

function bindDatabase() {
  $("#newIssuerButton").addEventListener("click", clearIssuerForm);
  $("#issuerSearch").addEventListener("input", renderIssuerList);
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
}

function readIssuerForm() {
  return {
    id: $("#issuerId").value || crypto.randomUUID(),
    legalName: $("#legalName").value,
    aliases: $("#aliases").value.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
    defaultBranch: $("#defaultBranch").value,
    isRealEstate: $("#isRealEstate").checked,
    credit: {
      approvalLevel: $("#approvalLevel").value,
      approvedAmount: $("#approvedAmount").value,
      offeringType: $("#offeringType").value,
      approvedRatio: $("#approvedRatio").value,
      investmentTermText: $("#investmentTermText").value,
      rawText: $("#creditRawText").value,
      sourceRank: $("#sourceRank").value,
      updatedAt: new Date().toISOString(),
    },
  };
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
  $("#offeringType").value = issuer.credit?.offeringType || "";
  $("#approvedRatio").value = issuer.credit?.approvedRatio ?? "";
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
      regenerate();
      showToast(`已导入 ${state.issuers.length} 个主体。`);
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      $("#importDataInput").value = "";
    }
  });
}

async function loadCloudState() {
  setSyncStatus("正在连接", "尝试读取 Cloudflare D1");
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (remote.data?.issuers) {
      const remoteTime = Date.parse(remote.data.updatedAt || 0);
      const localTime = Date.parse(state.updatedAt || 0);
      if (remoteTime >= localTime) state = remote.data;
    }
    cloudAvailable = true;
    persistLocal();
    setSyncStatus("D1 已连接", `${state.issuers.length} 个主体`);
  } catch {
    cloudAvailable = false;
    setSyncStatus("本机模式", `${state.issuers.length} 个主体，D1 尚未配置`);
  }
  renderIssuerOptions();
  renderIssuerList();
}

async function saveCloudState() {
  persistLocal();
  try {
    const response = await fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: state }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cloudAvailable = true;
    setSyncStatus("D1 已同步", `${state.issuers.length} 个主体`);
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
    return value?.issuers ? { ...DEFAULT_STATE, ...value } : structuredClone(DEFAULT_STATE);
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
