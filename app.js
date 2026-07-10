import {
  DEFAULT_STATE,
  applyIssuerCommonFields,
  buildBondFullName,
  buildUnderwriter,
  durationParts,
  durationToDays,
  findIssuer,
  formatNumber,
  generateOpinion,
  isAbsProject,
  mergeImportedIssuers,
  normalizeBondFullNameForProject,
  normalizeIssuer,
  parseProjectBrief,
  splitProjectBriefs,
  upsertIssuer,
} from "./core.js?v=20260710-unified-command-system";
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
} from "./lifecycle.js?v=20260710-unified-command-system";
import {
  deriveIssuerAlias,
  extractIssuerLegalName,
  parseCreditText,
  parseHistoryText,
} from "./history-parser.js?v=20260710-unified-command-system";
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
} from "./protocol-transfer.js?v=20260710-unified-command-system";
import {
  buildUnifiedReminders,
  markDailyMailSent,
  normalizeReminderState,
} from "./reminders.js?v=20260710-unified-command-system";
import {
  applyCodeMappingText,
  buildPrimaryAwardTrades,
  calculateShadowInventory,
  formatAmountWan,
  markSecondaryOrderStatus,
  normalizeSecondaryInventoryPositions,
  normalizeSecondaryOrders,
  normalizeSecondaryTrades,
  parseInventoryLedgerRows,
  parseInventorySnapshotText,
  parseSecondaryOrderText,
  parseSecondaryTradeText,
  pendingCodeTrades,
  positionKey,
  secondaryDashboardCounts,
  upsertInventoryPositions,
  upsertSecondaryOrders,
  upsertSecondaryTrades,
} from "./secondary-inventory.js?v=20260710-unified-command-system";

const LOCAL_KEY = "credit-bond-process-state-v1";
const PROJECT_DM_HISTORY_KEY = "credit-bond-process-project-dm-history-v1";
const PROJECT_DM_HISTORY_LIMIT = 12;
const API_URL = "./api/state";
const DM_VALUATION_URL = "./api/dm/valuation";
const MAILER_URL = "./api/mail/today";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const PDFJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const EXCELJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const PROTOCOL_TRANSFER_TEMPLATE_URL = "./templates/protocol-transfer-ledger-template.xlsx";
const PROJECT_SCREENSHOT_BRANCHES = ["广州分行", "武汉分行", "青岛分行", "兰州分行", "苏州分行", "太原分行", "西安分行"];
const PROJECT_SCREENSHOT_BRANCH_PATTERNS = [
  { branch: "广州分行", pattern: /[广廣厂][州卅]分行/g },
  { branch: "武汉分行", pattern: /[武式]汉分行/g },
  { branch: "青岛分行", pattern: /青[岛島鸟鳥]分行/g },
  { branch: "兰州分行", pattern: /[兰蘭]州分行/g },
  { branch: "苏州分行", pattern: /[苏蘇]州分行/g },
  { branch: "太原分行", pattern: /[太大]原分行/g },
  { branch: "西安分行", pattern: /西安分行/g },
];
const PROJECT_SCREENSHOT_BOND_TYPE_PATTERN = "(?:超短期融资券|短期融资券|中期票据|定向债务融资工具|定向工具|公司债券|企业债券|资产支持票据|资产支持证券|资产支持专项计划|SCP|MTN|PPN|ABN|ABS)";
const PROJECT_SCREENSHOT_LEFT_CROP_RATIO = 0.31;
const PROJECT_SCREENSHOT_MIN_OCR_WIDTH = 2600;
const PROJECT_SCREENSHOT_ROW_GAP = 18;
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
const REQUIRED_PROJECT_ISSUER_FIELDS = [
  { key: "legalName", label: "主体正式名称", inputId: "quickLegalName" },
  { key: "defaultBranch", label: "联动分行", inputId: "quickDefaultBranch" },
  { key: "subjectRating", label: "主体评级", inputId: "quickSubjectRating" },
  { key: "ratingAgency", label: "评级机构", inputId: "quickRatingAgency" },
  { key: "hiddenRating", label: "市场隐含评级", inputId: "quickHiddenRating" },
];

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
let currentGatewayUser = null;
let pendingHistoryImport = null;
let batchItems = [];
let selectedProjectId = "";
let selectedProtocolTransferId = "";
let protocolTransferEditMode = false;
let ledgerFilter = "all";
let reminderFilter = "all";
let projectAutoSaveTimer = null;
let projectRecognitionMarks = {};
let resultRecognitionMarks = {};
let resultRecognitionProjectId = "";
let protocolTransferRecognitionMarks = {};
let protocolTransferRecognitionId = "";
let dmLastPayload = null;
let projectDmHistory = loadProjectDmHistory();
let projectDmHistorySaveTimer = null;
let valuationAssistTimer = null;
let valuationAssistController = null;
let valuationAssistRequestKey = "";
let projectScreenshotRows = [];
let projectScreenshotBusy = false;
let projectScreenshotDragDepth = 0;

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
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

if (location.hostname === "credit-bond-process.pages.dev") {
  location.replace(`https://tempest07.com/bond-centre/${location.search}${location.hash}`);
}

initialize();

async function initialize() {
  bindPlaceholderSelection();
  bindNavigation();
  bindRouteHashNavigation();
  bindProjectScreenshotTool();
  bindGenerator();
  bindLedger();
  bindReminders();
  bindProtocolTransfer();
  bindSecondaryInventory();
  bindQuickIssuer();
  bindBatch();
  bindDatabase();
  bindDmTest();
  initializeHistoryImport();
  bindDataActions();
  resetProjectDmWorkspace({ preserveCurrentAsHistory: false, showToastMessage: false });
  renderProjectDmHistoryControls();
  renderIssuerOptions();
  renderIssuerList();
  renderProjectWorkspace();
  renderProtocolTransferWorkspace();
  renderSecondaryInventoryWorkspace();
  renderFtpCurveForm();
  clearIssuerForm();
  updateAuthUi();
  applyRouteFromHash();
  await loadCloudState();
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTarget, { updateHash: true }));
  });
}

function bindReminders() {
  $("#unifiedReminderList")?.addEventListener("click", handleUnifiedReminderClick);
  $("#reminderFilters")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reminder-filter]");
    if (!button) return;
    const filter = button.dataset.reminderFilter;
    if (!["all", "critical", "warning", "info"].includes(filter)) return;
    reminderFilter = filter;
    renderUnifiedReminders();
  });
}

function bindRouteHashNavigation() {
  window.addEventListener("hashchange", applyRouteFromHash);
}

function applyRouteFromHash() {
  const route = parseRouteFromHash();
  if (!route?.view) return;
  if (!$(`.view[data-view="${route.view}"]`)) return;
  applyRouteSelection(route);
  switchView(route.view, { updateHash: false });
  applyRouteFocus(route);
}

function parseRouteFromHash() {
  const raw = String(window.location.hash || "").replace(/^#\/?/, "");
  if (!raw) return null;
  const [viewPart, queryPart = ""] = raw.split("?");
  const view = decodeURIComponent(viewPart || "").split(/[&]/)[0];
  const params = new URLSearchParams(queryPart);
  return {
    view,
    target: params.get("target") || "",
    step: params.get("step") || "",
    trancheId: params.get("trancheId") || "",
    kind: params.get("kind") || "",
  };
}

function applyRouteSelection(route = {}) {
  if (route.view === "ledger" && route.target && route.target !== "mail") {
    selectedProjectId = route.target;
  }
  if (route.view === "protocol-transfer" && route.target) {
    selectedProtocolTransferId = route.target;
    protocolTransferEditMode = true;
  }
}

function applyRouteFocus(route = {}) {
  if (route.view === "ledger") {
    renderProjectWorkspace();
    if (route.target === "mail") {
      $("#mailPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (route.target) {
      if (route.step === "result" || route.kind === "project-result") openResultEntryPanel(false);
      $("#projectForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  if (route.view === "protocol-transfer") {
    renderProtocolTransferWorkspace();
    $("#protocolTransferForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function switchView(viewName, options = {}) {
  const button = $(`.nav-item[data-view-target="${viewName}"]`);
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  if (button) $("#pageTitle").textContent = button.textContent;
  if (viewName === "reminders") renderUnifiedReminders();
  if (options.updateHash && window.location.hash !== `#${viewName}`) {
    history.replaceState(null, "", `#${viewName}`);
  }
}

function bindProjectScreenshotTool() {
  const input = $("#projectScreenshotInput");
  const dropzone = $("#projectScreenshotDropzone");
  const dropTarget = $("#projectScreenshotTool") || dropzone;
  input?.addEventListener("change", handleProjectScreenshotUpload);
  $("#copyProjectScreenshotShortNamesButton")?.addEventListener("click", copyProjectScreenshotShortNames);
  if (!dropzone) return;
  dropzone.addEventListener("click", () => {
    if (!projectScreenshotBusy) input?.click();
  });
  dropzone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (projectScreenshotBusy) return;
    input?.click();
  });
  dropTarget?.addEventListener("dragenter", handleProjectScreenshotDragEnter);
  dropTarget?.addEventListener("dragover", handleProjectScreenshotDragOver);
  dropTarget?.addEventListener("dragleave", handleProjectScreenshotDragLeave);
  dropTarget?.addEventListener("drop", handleProjectScreenshotDrop);
  dropTarget?.addEventListener("paste", handleProjectScreenshotPaste);
}

async function handleProjectScreenshotUpload(event) {
  const input = event.target;
  const file = projectScreenshotImageFileFromList(input.files);
  await processProjectScreenshotFile(file, input);
}

async function handleProjectScreenshotDrop(event) {
  event.preventDefault();
  projectScreenshotDragDepth = 0;
  setProjectScreenshotDragging(false);
  const file = projectScreenshotImageFileFromDataTransfer(event.dataTransfer);
  await processProjectScreenshotFile(file);
}

async function handleProjectScreenshotPaste(event) {
  const file = projectScreenshotImageFileFromDataTransfer(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  await processProjectScreenshotFile(file);
}

function handleProjectScreenshotDragEnter(event) {
  event.preventDefault();
  if (projectScreenshotBusy) return;
  projectScreenshotDragDepth += 1;
  setProjectScreenshotDragging(true);
}

function handleProjectScreenshotDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleProjectScreenshotDragLeave(event) {
  event.preventDefault();
  projectScreenshotDragDepth = Math.max(0, projectScreenshotDragDepth - 1);
  if (!projectScreenshotDragDepth) setProjectScreenshotDragging(false);
}

async function processProjectScreenshotFile(file, input = null) {
  if (!file) return;
  if (projectScreenshotBusy) {
    showToast("上一张截图还在识别。");
    if (input) input.value = "";
    return;
  }
  if (!isProjectScreenshotImageFile(file)) {
    showToast("请上传项目表截图图片。");
    if (input) input.value = "";
    return;
  }

  projectScreenshotRows = [];
  renderProjectScreenshotResults(projectScreenshotRows);
  setProjectScreenshotBusy(true, "正在 OCR 图片...");
  try {
    await ensureTesseractReady();
    const entries = await recognizeProjectScreenshotEntries(file);
    if (!entries.length) {
      setProjectScreenshotStatus("未识别到七家目标分行的债券名称。");
      showToast("未识别到目标分行项目，请换一张更清晰的截图。");
      return;
    }

    projectScreenshotRows = entries.map((entry) => ({ ...entry, status: "pending" }));
    renderProjectScreenshotResults(projectScreenshotRows);
    for (let index = 0; index < entries.length; index += 1) {
      setProjectScreenshotStatus(`已识别 ${entries.length} 条，正在查 DM ${index + 1}/${entries.length}...`);
      const resolved = await lookupProjectScreenshotEntry(entries[index]);
      projectScreenshotRows[index] = resolved;
      renderProjectScreenshotResults(projectScreenshotRows);
    }
    const copiedCount = projectScreenshotResolvedShortNames().length;
    setProjectScreenshotStatus(copiedCount
      ? `完成：${copiedCount}/${entries.length} 条已匹配简称。`
      : `完成：${entries.length} 条均未匹配到 DM 简称。`);
  } catch (error) {
    projectScreenshotRows = [];
    renderProjectScreenshotResults(projectScreenshotRows);
    setProjectScreenshotStatus(error.message || "截图识别失败。");
    showToast(error.message || "截图识别失败。");
  } finally {
    setProjectScreenshotBusy(false);
    setProjectScreenshotDragging(false);
    if (input) input.value = "";
  }
}

function projectScreenshotImageFileFromDataTransfer(dataTransfer) {
  const itemFiles = Array.from(dataTransfer?.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
  return projectScreenshotImageFileFromList(itemFiles.length ? itemFiles : dataTransfer?.files);
}

function projectScreenshotImageFileFromList(files) {
  return Array.from(files || []).find(isProjectScreenshotImageFile) || null;
}

function isProjectScreenshotImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith("image/")) return true;
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)$/i.test(file.name || "")) return true;
  return !file.type && Number(file.size) > 0;
}

async function recognizeProjectScreenshotEntries(file) {
  const image = await loadProjectScreenshotImage(file);
  try {
    const targets = createProjectScreenshotOcrTargets(image);
    let combinedText = "";
    let bestEntries = [];
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      setProjectScreenshotStatus(`正在 OCR ${target.label} ${index + 1}/${targets.length}...`);
      const result = await window.Tesseract.recognize(target.canvas, "chi_sim+eng", {
        logger: (message) => updateProjectScreenshotOcrProgress(message, target.label),
      });
      combinedText = `${combinedText}\n${result?.data?.text || ""}`;
      const entries = parseProjectScreenshotOcrText(combinedText);
      if (entries.length > bestEntries.length) bestEntries = entries;
      if (bestEntries.length >= PROJECT_SCREENSHOT_BRANCHES.length) break;
    }
    return bestEntries;
  } finally {
    if (typeof image.close === "function") image.close();
  }
}

async function loadProjectScreenshotImage(file) {
  if (window.createImageBitmap) return window.createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片读取失败"));
    });
    image.src = url;
    return await loaded;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function createProjectScreenshotOcrTargets(image) {
  const rowBands = detectProjectScreenshotRowBands(image);
  const columns = detectProjectScreenshotKeyColumns(image);
  const targets = [];
  const columnCanvas = rowBands.length >= 3 && columns ? createProjectScreenshotColumnCanvas(image, rowBands, columns) : null;
  if (columnCanvas) targets.push({ label: "分行债券列", canvas: columnCanvas });
  const rowCanvas = rowBands.length >= 3 ? createProjectScreenshotRowCanvas(image, rowBands) : null;
  if (rowCanvas) targets.push({ label: "表格行", canvas: rowCanvas });
  targets.push({ label: "左侧两列", canvas: createProjectScreenshotLeftCropCanvas(image) });
  return targets;
}

function createProjectScreenshotLeftCropCanvas(image) {
  const cropWidth = projectScreenshotCropWidth(image);
  const scale = projectScreenshotScaleForWidth(cropWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropWidth * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, cropWidth, image.height, 0, 0, canvas.width, canvas.height);
  enhanceProjectScreenshotCanvas(canvas);
  return canvas;
}

function createProjectScreenshotRowCanvas(image, rowBands = []) {
  const cropWidth = projectScreenshotCropWidth(image);
  const scale = projectScreenshotScaleForWidth(cropWidth);
  const scaledRows = rowBands
    .map((band) => ({
      y: Math.max(0, band.y + 2),
      height: Math.max(1, band.height - 4),
      targetHeight: Math.max(96, Math.round(Math.max(1, band.height - 4) * scale)),
    }))
    .filter((band) => band.height >= 20);
  if (!scaledRows.length) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropWidth * scale);
  canvas.height = scaledRows.reduce((sum, band) => sum + band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP, PROJECT_SCREENSHOT_ROW_GAP);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  let targetY = PROJECT_SCREENSHOT_ROW_GAP;
  for (const band of scaledRows) {
    context.drawImage(image, 0, band.y, cropWidth, band.height, 0, targetY, canvas.width, band.targetHeight);
    targetY += band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP;
  }
  enhanceProjectScreenshotCanvas(canvas);
  return canvas;
}

function createProjectScreenshotColumnCanvas(image, rowBands = [], columns) {
  const scale = projectScreenshotScaleForWidth(columns.branch.width + columns.name.width);
  const gap = Math.max(18, Math.round(10 * scale));
  const padding = Math.max(16, Math.round(8 * scale));
  const branchWidth = Math.round(columns.branch.width * scale);
  const nameWidth = Math.round(columns.name.width * scale);
  const scaledRows = rowBands
    .map((band) => ({
      y: Math.max(0, band.y + 2),
      height: Math.max(1, band.height - 4),
      targetHeight: Math.max(108, Math.round(Math.max(1, band.height - 4) * scale)),
    }))
    .filter((band) => band.height >= 20);
  if (!scaledRows.length) return null;

  const canvas = document.createElement("canvas");
  canvas.width = padding * 2 + branchWidth + gap + nameWidth;
  canvas.height = scaledRows.reduce((sum, band) => sum + band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP, PROJECT_SCREENSHOT_ROW_GAP);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  let targetY = PROJECT_SCREENSHOT_ROW_GAP;
  for (const band of scaledRows) {
    context.drawImage(
      image,
      columns.branch.x,
      band.y,
      columns.branch.width,
      band.height,
      padding,
      targetY,
      branchWidth,
      band.targetHeight
    );
    context.drawImage(
      image,
      columns.name.x,
      band.y,
      columns.name.width,
      band.height,
      padding + branchWidth + gap,
      targetY,
      nameWidth,
      band.targetHeight
    );
    targetY += band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP;
  }
  enhanceProjectScreenshotCanvas(canvas, "soft");
  return canvas;
}

function projectScreenshotCropWidth(image) {
  return Math.min(image.width, Math.max(720, Math.round(image.width * PROJECT_SCREENSHOT_LEFT_CROP_RATIO)));
}

function projectScreenshotScaleForWidth(width) {
  if (!Number.isFinite(width) || width <= 0) return 2;
  return Math.min(4, Math.max(1.8, PROJECT_SCREENSHOT_MIN_OCR_WIDTH / width));
}

function detectProjectScreenshotRowBands(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sampleStep = Math.max(6, Math.floor(canvas.width / 420));
  const sampleCount = Math.ceil(canvas.width / sampleStep);
  const lineYs = [];
  for (let y = 0; y < canvas.height; y += 1) {
    let dark = 0;
    for (let x = 0; x < canvas.width; x += sampleStep) {
      const offset = (y * canvas.width + x) * 4;
      if (data[offset] < 120 && data[offset + 1] < 120 && data[offset + 2] < 120) dark += 1;
    }
    if (dark / sampleCount > 0.42) lineYs.push(y);
  }
  const lines = mergeProjectScreenshotLineYs(lineYs);
  const bands = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const top = lines[index];
    const bottom = lines[index + 1];
    const height = bottom - top - 1;
    if (height >= Math.max(28, image.height * 0.025)) {
      bands.push({ y: top + 1, height });
    }
  }
  return bands;
}

function detectProjectScreenshotKeyColumns(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sampleStep = Math.max(4, Math.floor(canvas.height / 220));
  const sampleCount = Math.ceil(canvas.height / sampleStep);
  const lineXs = [];
  for (let x = 0; x < canvas.width; x += 1) {
    let dark = 0;
    for (let y = 0; y < canvas.height; y += sampleStep) {
      const offset = (y * canvas.width + x) * 4;
      if (data[offset] < 145 && data[offset + 1] < 145 && data[offset + 2] < 145) dark += 1;
    }
    if (dark / sampleCount > 0.35) lineXs.push(x);
  }
  const rawLines = mergeProjectScreenshotLinePositions(lineXs);
  const lines = normalizeProjectScreenshotTableLines(rawLines, canvas.width);
  const minBranchWidth = Math.max(44, canvas.width * 0.015);
  const maxBranchWidth = Math.max(140, canvas.width * 0.08);
  const minNameWidth = Math.max(180, canvas.width * 0.065);
  const maxNameWidth = Math.max(520, canvas.width * 0.18);
  let best = null;
  for (let index = 0; index < lines.length - 2; index += 1) {
    const left = lines[index];
    const branchRight = lines[index + 1];
    const nameRight = lines[index + 2];
    const branchWidth = branchRight - left;
    const nameWidth = nameRight - branchRight;
    if (left > canvas.width * 0.08) continue;
    if (branchWidth < minBranchWidth || branchWidth > maxBranchWidth) continue;
    if (nameWidth < minNameWidth || nameWidth > maxNameWidth) continue;
    const score = Math.abs(left) + Math.abs(branchWidth - canvas.width * 0.025) + Math.abs(nameWidth - canvas.width * 0.09);
    if (!best || score < best.score) best = { left, branchRight, nameRight, score };
  }
  if (!best) return null;
  return {
    branch: projectScreenshotInsetColumn(best.left, best.branchRight, canvas.width),
    name: projectScreenshotInsetColumn(best.branchRight, best.nameRight, canvas.width),
  };
}

function normalizeProjectScreenshotTableLines(lines = [], width = 0) {
  const normalized = Array.from(new Set(lines))
    .filter((line) => Number.isFinite(line))
    .sort((left, right) => left - right);
  if (!normalized.length || normalized[0] > Math.max(6, width * 0.004)) normalized.unshift(0);
  if (normalized.at(-1) < width - Math.max(6, width * 0.004)) normalized.push(width - 1);
  return normalized;
}

function projectScreenshotInsetColumn(left, right, imageWidth) {
  const inset = Math.max(2, Math.round(imageWidth * 0.0007));
  const x = Math.max(0, left + inset);
  const maxRight = Math.max(x + 1, right - inset);
  return { x, width: maxRight - x };
}

function mergeProjectScreenshotLineYs(lineYs = []) {
  return mergeProjectScreenshotLinePositions(lineYs);
}

function mergeProjectScreenshotLinePositions(lineYs = []) {
  const lines = [];
  let group = [];
  for (const y of lineYs) {
    if (!group.length || y <= group.at(-1) + 1) {
      group.push(y);
    } else {
      lines.push(Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
      group = [y];
    }
  }
  if (group.length) lines.push(Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
  return lines;
}

function enhanceProjectScreenshotCanvas(canvas, mode = "binary") {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const value = mode === "soft"
      ? Math.max(0, Math.min(255, gray > 242 ? 255 : (gray - 32) * 1.45))
      : gray < 205 ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
}

function parseProjectScreenshotOcrText(text = "") {
  const compact = normalizeProjectScreenshotOcrText(text);
  if (!compact) return [];
  const matches = findProjectScreenshotBranchMatches(compact);

  const entries = [];
  const seen = new Set();
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const nextIndex = matches[index + 1]?.index ?? compact.length;
    const segmentEnd = Math.min(nextIndex, current.index + 280);
    const segment = compact.slice(current.index + current.branch.length, segmentEnd);
    const fullName = extractProjectScreenshotBondFullName(segment);
    if (!fullName) continue;
    const key = `${current.branch}|${normalizeProjectScreenshotOcrText(fullName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ branch: current.branch, fullName });
  }
  return entries;
}

function findProjectScreenshotBranchMatches(compact = "") {
  const matches = [];
  for (const { branch, pattern } of PROJECT_SCREENSHOT_BRANCH_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(compact))) {
      matches.push({ branch, index: match.index, length: match[0].length });
    }
  }
  return matches
    .sort((left, right) => left.index - right.index || right.length - left.length)
    .filter((match, index, list) => !index || match.index !== list[index - 1].index || match.branch !== list[index - 1].branch);
}

function normalizeProjectScreenshotOcrText(text = "") {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[|｜]/g, "")
    .replace(/\s+/g, "");
}

function extractProjectScreenshotBondFullName(segment = "") {
  const text = normalizeProjectScreenshotOcrText(segment);
  if (!text) return "";
  const fullNamePattern = new RegExp(`([\\u4e00-\\u9fffA-Za-z0-9()（）]{4,140}?20\\d{2}(?:年度|年)[\\u4e00-\\u9fffA-Za-z0-9()（）]{0,90}?${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}(?:[()（）][^()（）]{1,24}[()（）])?)`, "i");
  const fallbackPattern = new RegExp(`([\\u4e00-\\u9fffA-Za-z0-9()（）]{8,160}?${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}(?:[()（）][^()（）]{1,24}[()（）])?)`, "i");
  const match = text.match(fullNamePattern) || text.match(fallbackPattern);
  return cleanProjectScreenshotBondFullName(match?.[1] || "");
}

function cleanProjectScreenshotBondFullName(value = "") {
  let text = normalizeProjectScreenshotOcrText(value)
    .replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, "")
    .replace(/[,:;，。；：].*$/, "");
  const endPattern = new RegExp(`^(.+?${PROJECT_SCREENSHOT_BOND_TYPE_PATTERN}(?:[()（）][^()（）]{1,24}[()（）])?)`, "i");
  const endMatch = text.match(endPattern);
  if (endMatch) text = endMatch[1];
  return text.length >= 8 ? text : "";
}

async function lookupProjectScreenshotEntry(entry) {
  const params = new URLSearchParams({ fullName: entry.fullName });
  try {
    const response = await fetch(`./api/dm/lookup?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = { ok: false, error: `HTTP ${response.status}: 返回不是 JSON` };
    }
    if (!response.ok || !payload.ok) {
      const suggestion = Array.isArray(payload.suggestions) ? payload.suggestions[0] : null;
      return {
        ...entry,
        status: "error",
        shortName: "",
        candidateShortName: suggestion?.shortName || "",
        securityId: suggestion?.securityId || "",
        error: payload?.noResult ? "DM 无结果" : payload?.error || `HTTP ${response.status}`,
      };
    }
    const normalized = payload.normalized || {};
    return {
      ...entry,
      status: normalized.shortName ? "ok" : "error",
      shortName: normalized.shortName || "",
      securityId: normalized.securityId || "",
      issuerName: normalized.issuerName || "",
      error: normalized.shortName ? "" : "DM 未返回简称",
    };
  } catch (error) {
    return { ...entry, status: "error", shortName: "", error: error.message || "DM 查询失败" };
  }
}

function renderProjectScreenshotResults(rows = projectScreenshotRows) {
  const output = $("#projectScreenshotOutput");
  const copyButton = $("#copyProjectScreenshotShortNamesButton");
  if (!output || !copyButton) return;
  const copyText = projectScreenshotResolvedShortNames().join("\n");
  copyButton.disabled = !copyText;
  if (!rows.length) {
    output.hidden = true;
    output.innerHTML = "";
    return;
  }

  const groups = PROJECT_SCREENSHOT_BRANCHES
    .map((branch) => ({ branch, rows: rows.filter((row) => row.branch === branch) }))
    .filter((group) => group.rows.length);
  const groupHtml = groups.map((group) => {
    const matched = group.rows.filter((row) => row.status === "ok" && row.shortName).length;
    const items = group.rows.map((row) => {
      const title = row.shortName || row.candidateShortName || (row.status === "pending" ? "正在查询..." : "未查到简称");
      const detail = row.status === "ok"
        ? [row.securityId, row.issuerName].filter(Boolean).join(" · ")
        : row.status === "pending"
        ? "正在用债券全称查询 DM"
        : `${row.error || "查询失败"}${row.candidateShortName ? " · 仅作候选参考" : ""}`;
      return `
        <div class="project-screenshot-item${row.status === "ok" ? "" : " is-error"}">
          <strong>${escapeHtml(title)}</strong>
          <em>${escapeHtml(row.fullName)}</em>
          <span>${escapeHtml(detail)}</span>
        </div>
      `;
    }).join("");
    return `
      <section class="project-screenshot-branch">
        <h3>${escapeHtml(group.branch)} <span>${matched}/${group.rows.length}</span></h3>
        ${items}
      </section>
    `;
  }).join("");

  output.hidden = false;
  output.innerHTML = `${groupHtml}${copyText ? `<textarea class="project-screenshot-copy-box" readonly>${escapeHtml(copyText)}</textarea>` : ""}`;
}

function projectScreenshotResolvedShortNames() {
  return projectScreenshotRows
    .filter((row) => row.status === "ok" && row.shortName)
    .map((row) => row.shortName);
}

async function copyProjectScreenshotShortNames() {
  const text = projectScreenshotResolvedShortNames().join("\n");
  if (!text) {
    showToast("暂无可复制的 DM 简称。");
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast("已复制简称清单。");
}

function setProjectScreenshotBusy(isBusy, message = "") {
  projectScreenshotBusy = isBusy;
  const input = $("#projectScreenshotInput");
  const upload = $(".project-screenshot-upload");
  const dropzone = $("#projectScreenshotDropzone");
  const copyButton = $("#copyProjectScreenshotShortNamesButton");
  if (input) input.disabled = isBusy;
  upload?.classList.toggle("busy", isBusy);
  dropzone?.classList.toggle("is-busy", isBusy);
  dropzone?.setAttribute("aria-disabled", isBusy ? "true" : "false");
  if (copyButton) copyButton.disabled = isBusy || !projectScreenshotResolvedShortNames().length;
  if (message) setProjectScreenshotStatus(message);
}

function setProjectScreenshotDragging(isDragging) {
  $("#projectScreenshotDropzone")?.classList.toggle("is-dragging", isDragging);
}

function setProjectScreenshotStatus(message) {
  const status = $("#projectScreenshotStatus");
  if (status) status.textContent = message || "";
}

function updateProjectScreenshotOcrProgress(message = {}) {
  const status = String(message.status || "").replace(/_/g, " ");
  const progress = Number(message.progress);
  const percent = Number.isFinite(progress) ? ` ${Math.round(progress * 100)}%` : "";
  setProjectScreenshotStatus(status ? `OCR ${status}${percent}` : "正在 OCR 图片...");
}

function bindPlaceholderSelection() {
  document.addEventListener("mousedown", selectAnyPlaceholderOnMouseDown);
  document.addEventListener("dblclick", selectAnyPlaceholderOnDoubleClick);
}

function bindGenerator() {
  $("#blankTemplateButton")?.addEventListener("click", loadBlankBriefTemplate);
  $("#briefInput")?.addEventListener("keydown", handleBriefTemplateKeydown);
  $("#briefInput")?.addEventListener("mousedown", selectBriefPlaceholderOnMouseDown);
  $("#briefInput")?.addEventListener("dblclick", selectBriefPlaceholderOnDoubleClick);
  $("#sampleButton")?.addEventListener("click", () => {
    if (!state.issuers.some((issuer) => issuer.id === SAMPLE_ISSUER.id)) {
      state = upsertIssuer(state, SAMPLE_ISSUER);
      persistState();
      renderIssuerOptions();
      renderIssuerList();
    }
    $("#briefInput").value = SAMPLE_BRIEF;
    parseAndRender();
  });

  $("#parseButton")?.addEventListener("click", parseAndRender);
  $("#projectDmEntryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await runProjectDmLookup();
  });
  $("#projectDmClearButton")?.addEventListener("click", () => resetProjectDmWorkspace());
  $("#projectDmPreviousButton")?.addEventListener("click", restorePreviousProjectDmHistory);
  $("#projectDmHistorySelect")?.addEventListener("change", (event) => {
    const id = event.target.value;
    if (id) restoreProjectDmHistoryItem(id);
  });
  $("#projectDmSeedInput").addEventListener("input", () => {
    project.shortName = $("#projectDmSeedInput").value.trim();
    $('[data-project-field="shortName"]').value = project.shortName;
    regenerate();
  });
  $("#projectValuationInput").addEventListener("input", () => {
    updateProjectPricingFromInputs();
    regenerate();
    scheduleProjectDmHistorySave();
  });
  $("#projectGuidancePriceInput").addEventListener("input", () => {
    updateProjectPricingFromInputs();
    regenerate();
    scheduleProjectDmHistorySave();
  });
  $("#projectDmAssist").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-project-dm-query]");
    if (!button) return;
    const query = button.dataset.projectDmQuery?.trim();
    if (!query) return;
    await runProjectDmLookup(query);
  });
  $("#projectDmAssist").addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest("button")) return;
    const card = event.target.closest(".dm-issue-tranche[data-project-dm-query]");
    if (!card) return;
    const query = card.dataset.projectDmQuery?.trim();
    if (!query) return;
    event.preventDefault();
    await runProjectDmLookup(query);
  });
  $("#issuerSelect").addEventListener("change", () => {
    delete projectRecognitionMarks.issuerSelect;
    setRecognitionForInput($("#issuerSelect"), null);
    selectedIssuerId = $("#issuerSelect").value;
    const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
    project = applyIssuerCommonFields(project, issuer);
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
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
      if (field === "venue" || field === "instrumentType") syncProjectConditionalFields();
      if (field === "shortName" && $("#projectDmSeedInput")) $("#projectDmSeedInput").value = project.shortName || "";
      project.sourceText = buildDmProjectSourceText(project);
      $("#briefInput").value = project.sourceText;
      regenerate();
      scheduleProjectDmHistorySave();
    });
  });
  $$("[data-abs-field]").forEach((input) => {
    input.addEventListener("input", () => {
      clearRecognitionForInput(input);
      updateAbsInfoFromInputs();
      project.sourceText = buildDmProjectSourceText(project);
      $("#briefInput").value = project.sourceText;
      regenerate();
      scheduleProjectDmHistorySave();
    });
  });
  $("#addAbsTrancheButton")?.addEventListener("click", () => {
    ensureAbsInfo(project);
    project.instrumentType = project.instrumentType || "ABS";
    project.absInfo.tranches.push(defaultAbsTranche());
    renderAbsTrancheFields();
    syncProjectConditionalFields();
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
    regenerate();
    scheduleProjectDmHistorySave();
  });
  $("#absTrancheRows")?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-abs-tranche-field]");
    if (!input) return;
    clearRecognitionForInput(input);
    if (input.dataset.absTrancheField === "selected") {
      input.closest(".abs-tranche-row")?.classList.toggle("is-selected", input.checked);
    }
    updateAbsTranchesFromInputs();
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
    regenerate();
    scheduleProjectDmHistorySave();
  });
  $("#absTrancheRows")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-abs-tranche]");
    if (!remove) return;
    ensureAbsInfo(project);
    project.absInfo.tranches.splice(Number(remove.dataset.removeAbsTranche), 1);
    renderAbsTrancheFields();
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
    regenerate();
    scheduleProjectDmHistorySave();
  });
  $("#trancheInquiryRows").addEventListener("input", (event) => {
    const input = event.target.closest("[data-inquiry-index]");
    if (!input) return;
    clearRecognitionForInput(input);
    updateDynamicInquiryRange(input);
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
    regenerate();
    scheduleProjectDmHistorySave();
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
  if (!project.shortName) {
    showToast("请先解析项目简表，再保存为项目。");
    return;
  }
  const issuerStatus = projectIssuerSaveStatus(project, issuer);
  if (!issuerStatus.ok) {
    if (issuerStatus.reason === "incompleteAbs") {
      showToast(`ABS要素缺少：${issuerStatus.missing.map((item) => item.label).join("、")}。请先补全后再保存项目。`);
    } else {
      openQuickIssuerPanel({ enforceRequired: true, missing: issuerStatus.missing });
      showToast(issuerStatus.reason === "missingIssuer"
        ? "请先将主体录入主体授信库，并补全联动分行、评级、评级机构和隐含评级。"
        : `主体资料缺少：${issuerStatus.missing.map((item) => item.label).join("、")}。请先补全后再保存项目。`);
    }
    return;
  }
  const generated = { ...generateOpinion(project, issuer), opinion: $("#opinionOutput").value };
  const result = upsertParsedProjectToLedger(project, issuer, generated);
  if (!result) return;
  selectedProjectId = result.record.id;
  persistState();
  renderProjectWorkspace();
  switchView("ledger");
  showToast(result.isUpdate ? "已更新现有项目台账。" : "已保存至项目台账。");
}

function resetProjectDmWorkspace(options = {}) {
  const { preserveCurrentAsHistory = true, showToastMessage = true } = options;
  if (preserveCurrentAsHistory) pushProjectDmHistoryFromCurrent();
  clearTimeout(projectDmHistorySaveTimer);
  projectDmHistorySaveTimer = null;
  project = parseProjectBrief("");
  project.warnings = [];
  selectedIssuerId = "";
  clearProjectRecognitionMarks();
  clearTimeout(valuationAssistTimer);
  if (valuationAssistController) valuationAssistController.abort();
  valuationAssistController = null;
  valuationAssistRequestKey = "";
  $("#briefInput").value = "";
  $("#projectDmStatus").textContent = "未读取 DM";
  $("#projectDmStatus").className = "pill muted";
  $("#projectDmAssist").hidden = true;
  $("#projectDmAssist").innerHTML = "";
  $("#valuationAssist").hidden = true;
  $("#valuationAssist").innerHTML = "";
  $("#opinionOutput").value = "";
  $("#suggestionSummary").textContent = "建议比例待补充";
  $("#ruleTrace").innerHTML = "";
  $("#matchedIssuerPill").textContent = "未匹配主体";
  $("#matchedIssuerPill").className = "pill";
  $("#quickIssuerPanel").hidden = true;
  renderWarnings([]);
  fillProjectFields();
  renderIssuerOptions();
  renderProjectDmHistoryControls();
  if (showToastMessage) showToast("已清空当前 DM 建项草稿。");
}

function pushProjectDmHistoryFromCurrent() {
  const item = projectDmHistoryItemFromCurrent();
  if (!item) return;
  const key = projectDmHistoryKey(item);
  projectDmHistory = [
    item,
    ...projectDmHistory.filter((entry) => projectDmHistoryKey(entry) !== key),
  ].slice(0, PROJECT_DM_HISTORY_LIMIT);
  saveProjectDmHistory();
  renderProjectDmHistoryControls();
}

function scheduleProjectDmHistorySave() {
  clearTimeout(projectDmHistorySaveTimer);
  if (!projectDmHasContent(project, $("#projectDmSeedInput")?.value || "")) return;
  projectDmHistorySaveTimer = setTimeout(() => {
    projectDmHistorySaveTimer = null;
    pushProjectDmHistoryFromCurrent();
  }, 450);
}

function projectDmHistoryItemFromCurrent() {
  const seed = $("#projectDmSeedInput")?.value?.trim() || "";
  const query = seed || project.shortName || project.fullName || "";
  if (!projectDmHasContent(project, query)) return null;
  const snapshot = clonePlain({
    ...project,
    sourceText: project.sourceText || buildDmProjectSourceText(project),
  });
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query,
    shortName: snapshot.shortName || query,
    issuerName: snapshot.issuerName || "",
    durationText: snapshot.durationText || "",
    valuationText: formatRateListInput(snapshot.valuations?.length ? snapshot.valuations : [snapshot.valuation]),
    guidanceText: formatRateListInput(snapshot.guidancePrices?.length ? snapshot.guidancePrices : [snapshot.guidancePrice]),
    selectedIssuerId,
    project: snapshot,
    updatedAt: new Date().toISOString(),
  };
}

function projectDmHasContent(projectValue, query = "") {
  return Boolean(String(query || "").trim()
    || projectValue?.shortName
    || projectValue?.fullName
    || projectValue?.instrumentType
    || projectValue?.absInfo?.planName
    || projectValue?.absInfo?.tranches?.length
    || projectValue?.issuerName
    || projectValue?.durationText
    || projectValue?.issueScale
    || projectValue?.valuation
    || projectValue?.guidancePrice
    || projectValue?.valuations?.length
    || projectValue?.guidancePrices?.length);
}

function restorePreviousProjectDmHistory() {
  if (!projectDmHistory.length) return;
  const currentKey = projectDmHistoryKey(projectDmHistoryItemFromCurrent() || {});
  const item = projectDmHistory.find((entry) => projectDmHistoryKey(entry) !== currentKey) || projectDmHistory[0];
  restoreProjectDmHistoryItem(item.id);
}

function restoreProjectDmHistoryItem(id) {
  const item = projectDmHistory.find((entry) => entry.id === id);
  if (!item?.project) return;
  pushProjectDmHistoryFromCurrent();
  project = clonePlain(item.project);
  project.warnings = Array.isArray(project.warnings) ? project.warnings : [];
  selectedIssuerId = state.issuers.some((issuer) => issuer.id === item.selectedIssuerId)
    ? item.selectedIssuerId
    : (findIssuerForProject(project)?.id || "");
  if (!project.sourceText) project.sourceText = buildDmProjectSourceText(project);
  clearProjectRecognitionMarks();
  $("#briefInput").value = project.sourceText || "";
  $("#projectDmStatus").textContent = "已恢复历史";
  $("#projectDmStatus").className = "pill accent";
  $("#projectDmAssist").hidden = true;
  $("#projectDmAssist").innerHTML = "";
  fillProjectFields();
  renderIssuerOptions();
  regenerate();
  renderProjectDmHistoryControls(item.id);
  showToast(`已恢复 ${item.shortName || item.query || "上一条历史"}。`);
}

function renderProjectDmHistoryControls(selectedId = "") {
  const previousButton = $("#projectDmPreviousButton");
  const select = $("#projectDmHistorySelect");
  if (!select) return;
  if (previousButton) previousButton.disabled = projectDmHistory.length === 0;
  select.disabled = projectDmHistory.length === 0;
  select.innerHTML = projectDmHistory.length
    ? `<option value="">选择历史搜索</option>${projectDmHistory.map((item) => `
      <option value="${escapeAttribute(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(projectDmHistoryLabel(item))}</option>
    `).join("")}`
    : `<option value="">暂无历史</option>`;
}

function projectDmHistoryLabel(item) {
  const facts = [
    item.shortName || item.query,
    item.durationText,
    item.valuationText ? `估值${item.valuationText}` : "",
  ].filter(Boolean);
  return facts.join(" · ") || "未命名历史";
}

function projectDmHistoryKey(item = {}) {
  const value = item.shortName || item.query || item.project?.shortName || item.project?.fullName || "";
  return String(value || "").toUpperCase().replace(/\s+/g, "").trim();
}

function loadProjectDmHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_DM_HISTORY_KEY));
    return Array.isArray(value) ? value.filter((item) => item?.project).slice(0, PROJECT_DM_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveProjectDmHistory() {
  localStorage.setItem(PROJECT_DM_HISTORY_KEY, JSON.stringify(projectDmHistory));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function upsertParsedProjectToLedger(projectValue, issuer, generated) {
  if (!projectValue?.shortName) return null;
  if (!projectIssuerSaveStatus(projectValue, issuer).ok) return null;
  const existing = (state.projects || []).find((item) => item.shortName === projectValue.shortName && item.status !== "已结束");
  const record = buildLedgerProjectRecord(projectValue, issuer, generated, existing);
  state = upsertProject(state, record);
  return { record, isUpdate: Boolean(existing) };
}

function projectIssuerSaveStatus(projectValue, issuer) {
  if (isAbsProject(projectValue)) return absProjectSaveStatus(projectValue);
  const draft = createIssuerDraft(projectValue, issuer);
  const missing = missingRequiredProjectIssuerFields(draft);
  if (!issuer) return { ok: false, reason: "missingIssuer", missing };
  if (missing.length) return { ok: false, reason: "incompleteIssuer", missing };
  return { ok: true, reason: "", missing: [] };
}

function absProjectSaveStatus(projectValue) {
  const absInfo = normalizeProjectAbsInfo(projectValue.absInfo);
  const missing = [];
  if (!String(projectValue.shortName || "").trim()) missing.push({ key: "shortName", label: "ABS简称" });
  if (!String(projectValue.branch || "").trim()) missing.push({ key: "branch", label: "联动分行" });
  if (!String(absInfo.planName || projectValue.fullName || "").trim()) missing.push({ key: "abs.planName", label: "专项计划/产品名称" });
  if (!absInfo.tranches.length) missing.push({ key: "abs.tranches", label: "ABS分档结构" });
  return missing.length
    ? { ok: false, reason: "incompleteAbs", missing }
    : { ok: true, reason: "", missing: [] };
}

function missingRequiredProjectIssuerFields(draft = {}) {
  return REQUIRED_PROJECT_ISSUER_FIELDS.filter((field) => !String(draft[field.key] || "").trim());
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
        instrumentType: created.instrumentType,
        absInfo: created.absInfo,
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
              issueScale: tranche.issueScale ?? existing.tranches[index].issueScale,
              securityCode: tranche.securityCode || existing.tranches[index].securityCode,
              absClassName: tranche.absClassName || existing.tranches[index].absClassName,
              sharePct: tranche.sharePct ?? existing.tranches[index].sharePct,
              expectedMaturityDate: tranche.expectedMaturityDate || existing.tranches[index].expectedMaturityDate,
              debtRating: tranche.debtRating || existing.tranches[index].debtRating,
              debtRatingAgency: tranche.debtRatingAgency || existing.tranches[index].debtRatingAgency,
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
    resetProjectDmWorkspace({ preserveCurrentAsHistory: false, showToastMessage: false });
    switchView("generator");
    $("#projectDmSeedInput").focus();
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
    clearTimeout(projectAutoSaveTimer);
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
    saveProjectRecordNow(parsed);
    fillProjectForm(parsed);
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
      instrumentType: record.instrumentType,
      absInfo: record.absInfo,
      issueScale: record.issueScale,
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

async function runProjectDmLookup(queryOverride = "") {
  const seedInput = $("#projectDmSeedInput");
  const fieldInput = $('[data-project-field="shortName"]');
  const query = String(queryOverride || seedInput?.value || fieldInput?.value || project.shortName || "").trim();
  if (!query || briefTemplatePlaceholders(query).length) {
    showToast("请先填写债券简称或代码。");
    return;
  }
  if (seedInput) seedInput.value = query;
  if (fieldInput && !looksLikeSecurityId(query)) fieldInput.value = query;

  const params = new URLSearchParams();
  if (looksLikeSecurityId(query)) params.set("securityId", query);
  else params.set("shortName", query);

  setProjectDmLookupBusy(true);
  try {
    const response = await fetch(`./api/dm/lookup?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    const payload = await response.json();
    renderProjectDmAssist(payload);
    if (!payload.ok) {
      $("#projectDmStatus").textContent = payload.noResult ? "DM 无结果" : "DM 查询失败";
      $("#projectDmStatus").className = "pill warning";
      showToast(payload.noResult ? "DM 无结果，可查看相近候选。" : "DM 查询失败，请看提示。");
      return;
    }
    applyDmLookupToCurrentProject(payload);
    const sourceLabel = dmPayloadSourceLabel(payload);
    $("#projectDmStatus").textContent = `已读取 ${sourceLabel}`;
    $("#projectDmStatus").className = "pill accent";
    pushProjectDmHistoryFromCurrent();
    showToast(`已用 ${sourceLabel} 预填新增项目，请复核后保存。`);
  } catch (error) {
    renderProjectDmAssist({ ok: false, error: error.message || "DM 查询失败" });
    $("#projectDmStatus").textContent = "DM 查询失败";
    $("#projectDmStatus").className = "pill warning";
    showToast(error.message || "DM 查询失败。");
  } finally {
    setProjectDmLookupBusy(false);
  }
}

function setProjectDmLookupBusy(isBusy) {
  const button = $("#projectDmLookupButton");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "读取中..." : "读取 DM";
  if (isBusy) {
    $("#projectDmStatus").textContent = "正在读取 DM";
    $("#projectDmStatus").className = "pill";
  }
}

function applyDmLookupToCurrentProject(payload) {
  const patch = projectPatchFromDmLookup(payload);
  const { sourceMap: _sourceMap, ...projectPatch } = patch;
  const warnings = [...(project.warnings || []), ...(patch.warnings || [])];
  project = {
    ...project,
    ...projectPatch,
    warnings,
  };
  updateProjectPricingFromInputs(false);
  const matched = findIssuerForProject(project)
    || findIssuer(patch.issuerName || "", state.issuers)
    || null;
  selectedIssuerId = matched?.id || "";
  project = applyIssuerCommonFields(project, matched);
  project.sourceText = buildDmProjectSourceText(project);
  $("#briefInput").value = project.sourceText;
  const genericMarks = buildProjectRecognitionMarks(project, matched);
  const dmMarks = buildProjectDmRecognitionMarks(patch);
  projectRecognitionMarks = {
    ...genericMarks,
    ...dmMarks,
    ...buildIssuerCloudRecognitionMarks(project, matched, dmMarks),
  };
  fillProjectFields();
  renderIssuerOptions();
  regenerate();
}

function updateProjectPricingFromInputs(updateSourceText = true) {
  const valuations = parseRateListInput($("#projectValuationInput")?.value || "");
  const guidancePrices = parseRateListInput($("#projectGuidancePriceInput")?.value || "");
  project.valuations = valuations;
  project.valuation = valuations[0] ?? null;
  project.guidancePrices = guidancePrices;
  project.guidancePrice = guidancePrices[0] ?? null;
  if (updateSourceText) {
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
  }
}

function projectPatchFromDmLookup(payload) {
  const normalized = payload?.normalized || {};
  const issueGroup = payload?.issueGroup || normalized.issueGroup || null;
  const tranches = projectDmUsableTranches(issueGroup);
  const patch = {};
  const warnings = [];
  const sourceMap = {};
  const markSource = (field, source) => {
    if (!source) return;
    if (source === "cloud" || !sourceMap[field]) sourceMap[field] = source;
  };
  const groupSource = projectSourceFromDmIssueGroup(issueGroup);
  const dmAbs = normalized?.isAbs || normalized?.absInfo || /^(ABS|ABN)$/i.test(String(issueGroup?.instrumentType || ""));

  if (dmAbs) {
    patch.instrumentType = normalized.instrumentType || normalized.absInfo?.type || issueGroup?.instrumentType || "ABS";
    markSource("instrumentType", "dm");
    patch.absInfo = projectAbsInfoFromDm(normalized, issueGroup);
    markAbsInfoSources(patch.absInfo, sourceMap, groupSource);
    if (patch.absInfo.planName) {
      patch.fullName = patch.absInfo.planName;
      markSource("fullName", "dm");
    }
    if (Number.isFinite(numberOrNull(patch.absInfo.totalScale))) {
      patch.issueScale = patch.absInfo.totalScale;
      markSource("issueScale", groupSource);
    }
  }

  if (tranches.length && !dmAbs) {
    const names = uniqueNonEmpty(tranches.map((tranche) => tranche.shortName || tranche.securityId));
    const durations = tranches.map((tranche) => normalizeDmTenor(tranche.tenor)).filter(Boolean);
    const ranges = tranches.map((tranche) => parseDmInquiryRange(tranche.inquiryRange));
    const scale = sumFinite(tranches.map((tranche) => numberOrNull(tranche.actualScale) ?? numberOrNull(tranche.planScale)));
    if (names.length) {
      patch.shortNames = names;
      patch.shortName = compactProjectShortNames(names);
      markSource("shortName", groupSource);
    }
    if (durations.length) {
      patch.durationParts = durations;
      patch.durationText = compactProjectDurations(durations);
      patch.durationDays = durationToDays(patch.durationText);
      markSource("durationText", groupSource);
    }
    if (Number.isFinite(scale)) {
      patch.issueScale = scale;
      markSource("issueScale", groupSource);
    }
    const completeRanges = ranges.filter((range) => Number.isFinite(range.low) && Number.isFinite(range.high));
    if (completeRanges.length) {
      patch.inquiryRanges = completeRanges;
      patch.inquiryLow = completeRanges[0].low;
      patch.inquiryHigh = completeRanges[0].high;
      patch.inquiryLow2 = completeRanges[1]?.low ?? null;
      patch.inquiryHigh2 = completeRanges[1]?.high ?? null;
      markSource("inquiryLow", groupSource);
      markSource("inquiryHigh", groupSource);
      completeRanges.forEach((range, index) => {
        markSource(`inquiryRanges.${index}.low`, groupSource);
        markSource(`inquiryRanges.${index}.high`, groupSource);
      });
    }
  }

  assignProjectDmValueWithSource(patch, sourceMap, "shortName", normalized.shortName);
  assignProjectDmValueWithSource(patch, sourceMap, "fullName", dmProjectFullNameForProject(normalized.fullName, patch, issueGroup));
  assignProjectDmValueWithSource(patch, sourceMap, "issuerName", normalized.issuerName);
  assignProjectDmValueWithSource(patch, sourceMap, "societyCode", normalized.societyCode);
  assignProjectDmValueWithSource(patch, sourceMap, "durationText", normalizeDmTenor(normalized.durationText));
  assignProjectDmValueWithSource(patch, sourceMap, "issueScale", normalized.issueScaleYi);
  assignProjectDmValueWithSource(patch, sourceMap, "venue", normalized.venue);
  assignProjectDmValueWithSource(patch, sourceMap, "offeringType", normalized.offeringType);
  assignProjectDmValueWithSource(patch, sourceMap, "leadUnderwriter", normalized.leadUnderwriter);
  assignProjectDmValueWithSource(patch, sourceMap, "sponsorStatus", normalized.sponsorStatus);
  assignProjectDmValueWithSource(patch, sourceMap, "subjectRating", normalized.subjectRating, normalizedProjectFieldSource(normalized, "subjectRating"));
  assignProjectDmValueWithSource(patch, sourceMap, "ratingAgency", normalized.ratingAgency, normalizedProjectFieldSource(normalized, "ratingAgency"));
  assignProjectDmValueWithSource(patch, sourceMap, "hiddenRating", normalized.impliedRating, normalizedProjectFieldSource(normalized, "impliedRating"));

  if (!patch.inquiryRanges?.length) {
    const range = parseDmInquiryRange(normalized.inquiryRange);
    if (Number.isFinite(range.low) && Number.isFinite(range.high)) {
      patch.inquiryLow = range.low;
      patch.inquiryHigh = range.high;
      patch.inquiryRanges = [range];
      markSource("inquiryLow", "dm");
      markSource("inquiryHigh", "dm");
      markSource("inquiryRanges.0.low", "dm");
      markSource("inquiryRanges.0.high", "dm");
    }
  }
  if (patch.durationText && !patch.durationParts?.length) {
    patch.durationParts = durationParts(patch.durationText);
    patch.durationDays = durationToDays(patch.durationText);
  }

  const reallocated = (issueGroup?.tranches || []).filter((tranche) => tranche.status === "reallocated");
  const confirmed = reallocated.filter((tranche) => tranche.reallocationTargetShortName || tranche.reallocationTargetSecurityId);
  if (confirmed.length) {
    warnings.push(...confirmed.map((tranche) =>
      `${tranche.shortName || "本期债券"}已全部回拨至${tranche.reallocationTargetShortName || tranche.reallocationTargetSecurityId}，新增项目已默认使用回拨目标。`,
    ));
  } else if (reallocated.length) {
    warnings.push("同次发行组中存在待确认回拨期限，保存前请确认最终入项品种。");
  }

  patch.sourceMap = sourceMap;
  patch.warnings = warnings;
  return patch;
}

function projectAbsInfoFromDm(normalized = {}, issueGroup = null) {
  const base = normalizeProjectAbsInfo(normalized.absInfo || {});
  const tranches = Array.isArray(issueGroup?.tranches) ? issueGroup.tranches : [];
  const absTranches = tranches.length
    ? tranches.map((tranche) => {
        const range = parseDmInquiryRange(tranche.inquiryRange);
        return normalizeProjectAbsTranche({
          className: tranche.trancheLevel,
          shortName: tranche.shortName,
          securityId: tranche.securityId,
          scale: numberOrNull(tranche.actualScale) ?? numberOrNull(tranche.planScale),
          sharePct: tranche.sharePct,
          expectedMaturityDate: tranche.expectedMaturityDate,
          expectedTerm: normalizeDmTenor(tranche.tenor),
          debtRating: tranche.debtRating,
          debtRatingAgency: tranche.debtRatingAgency,
          inquiryLow: range.low,
          inquiryHigh: range.high,
          selected: Boolean(tranche.isQueriedInput),
        });
      })
    : base.tranches;
  const totalScale = numberOrNull(base.totalScale)
    ?? numberOrNull(issueGroup?.totalScale)
    ?? sumFinite(absTranches.map((tranche) => tranche.scale));
  return normalizeProjectAbsInfo({
    ...base,
    planName: base.planName || issueGroup?.issueName || normalized.fullName || "",
    totalScale,
    bookDate: base.bookDate || issueGroup?.subscribeDate || normalized.subscribeDate || "",
    tranches: absTranches,
  });
}

function markAbsInfoSources(absInfo, sourceMap, source) {
  if (!absInfo) return;
  [
    "planName",
    "totalScale",
    "bookDate",
    "underlyingAsset",
    "creditEnhancementType",
    "creditEnhancementParty",
    "creditApprovalText",
    "approvalAmount",
    "approvalRatio",
    "approvalTermText",
    "applicationAmount",
    "recommendedAmount",
  ].forEach((field) => {
    if (valueHasContent(absInfo[field])) sourceMap[`abs.${field}`] = source || "dm";
  });
}

function assignProjectDmValueWithSource(target, sourceMap, field, value, source = "dm") {
  if (assignProjectDmValue(target, field, value)) {
    sourceMap[field] = source;
  }
}

function projectSourceFromDmIssueGroup(issueGroup) {
  const sources = [
    issueGroup?.source,
    ...(Array.isArray(issueGroup?.tranches) ? issueGroup.tranches.map((tranche) => tranche.source) : []),
  ];
  return sources.some((source) => source === "cloud-db" || source === "mixed") ? "cloud" : "dm";
}

function normalizedProjectFieldSource(normalized, key) {
  const source = normalized?.ratingSource?.[key] || "";
  return source === "issuer-db" || source === "local-issuer-db" ? "cloud" : "dm";
}

function dmProjectFullNameForProject(fullName, patch, issueGroup) {
  const text = String(fullName || "").trim();
  if (!text) return "";
  const tranches = Array.isArray(issueGroup?.tranches) ? issueGroup.tranches : [];
  const projectLike = tranches.length > 1
    ? {
        ...patch,
        durationParts: patch.durationParts?.length ? patch.durationParts : tranches.map((tranche) => normalizeDmTenor(tranche.tenor)).filter(Boolean),
        shortNames: patch.shortNames?.length ? patch.shortNames : uniqueNonEmpty(tranches.map((tranche) => tranche.shortName)),
      }
    : patch;
  return normalizeBondFullNameForProject(text, projectLike);
}

function assignProjectDmValue(target, field, value) {
  if (value === null || value === undefined || value === "") return false;
  if (valueHasContent(target[field])) return false;
  target[field] = value;
  return true;
}

function buildProjectDmRecognitionMarks(patch) {
  const marks = {};
  const sourceMap = patch.sourceMap || {};
  const dmFields = [
    ["instrumentType", "项目类型"],
    ["shortName", "债券简称"],
    ["durationText", "债券期限"],
    ["issueScale", "发行规模"],
    ["subjectRating", "主体评级"],
    ["ratingAgency", "评级机构"],
    ["hiddenRating", "隐含评级"],
    ["inquiryLow", "询价区间"],
    ["inquiryHigh", "询价区间"],
    ["venue", "发行场所"],
    ["offeringType", "发行方式"],
    ["leadUnderwriter", "牵头主承销商"],
    ["fullName", "债券全称"],
  ];
  for (const [field, label] of dmFields) {
    if (valueHasContent(patch[field])) marks[field] = sourcedRecognitionMark(label, sourceMap[field]);
  }
  if (patch.absInfo) {
    const absInfo = normalizeProjectAbsInfo(patch.absInfo);
    const absFields = [
      ["planName", "专项计划/产品名称"],
      ["totalScale", "全专项计划规模"],
      ["bookDate", "簿记日期"],
      ["underlyingAsset", "基础资产"],
      ["creditEnhancementType", "增信/支持类型"],
      ["creditEnhancementParty", "增信/支持主体"],
      ["creditApprovalText", "授信表述"],
      ["approvalAmount", "授信批复金额"],
      ["approvalRatio", "投资比例上限"],
      ["approvalTermText", "投资期限上限"],
    ];
    for (const [field, label] of absFields) {
      if (valueHasContent(absInfo[field])) marks[`abs.${field}`] = sourcedRecognitionMark(label, sourceMap[`abs.${field}`] || "dm");
    }
    absInfo.tranches.forEach((tranche, index) => {
      [
        ["className", "分档级别"],
        ["shortName", "分档简称"],
        ["scale", "分档规模"],
        ["sharePct", "分档占比"],
        ["expectedMaturityDate", "预期到期日"],
        ["expectedTerm", "预期期限"],
        ["debtRating", "债项评级"],
        ["debtRatingAgency", "债项评级机构"],
        ["inquiryLow", "分档利率下限"],
        ["inquiryHigh", "分档利率上限"],
      ].forEach(([field, label]) => {
        if (valueHasContent(tranche[field])) marks[`abs.tranches.${index}.${field}`] = sourcedRecognitionMark(label, "dm");
      });
    });
  }
  if (Array.isArray(patch.inquiryRanges)) {
    patch.inquiryRanges.forEach((range, index) => {
      if (!index) return;
      if (Number.isFinite(numberOrNull(range.low))) marks[`inquiryRanges.${index}.low`] = sourcedRecognitionMark("询价下限", sourceMap[`inquiryRanges.${index}.low`]);
      if (Number.isFinite(numberOrNull(range.high))) marks[`inquiryRanges.${index}.high`] = sourcedRecognitionMark("询价上限", sourceMap[`inquiryRanges.${index}.high`]);
    });
  }
  return marks;
}

function sourcedRecognitionMark(label, source) {
  if (source === "cloud") return recognitionMark("success", `${label}已由云端数据库预填`, "cloud");
  return recognitionMark("success", `${label}已由 DM 预填`, "dm");
}

function buildIssuerCloudRecognitionMarks(projectValue, issuer, existingMarks = {}) {
  if (!issuer) return {};
  const marks = {};
  const fields = [
    { field: "branch", label: "联动分行", value: issuer.linkedBranch || issuer.defaultBranch },
    { field: "subjectRating", label: "主体评级", value: issuer.subjectRating },
    { field: "ratingAgency", label: "评级机构", value: issuer.ratingAgency },
    { field: "hiddenRating", label: "隐含评级", value: issuer.hiddenRating },
  ];
  for (const item of fields) {
    if (existingMarks[item.field]?.source === "dm") continue;
    if (!valueHasContent(item.value) || !valueHasContent(projectValue[item.field])) continue;
    if (normalizeSourceComparable(projectValue[item.field]) !== normalizeSourceComparable(item.value)) continue;
    marks[item.field] = recognitionMark("success", `${item.label}已由云端数据库预填`, "cloud");
  }
  return marks;
}

function normalizeSourceComparable(value) {
  return String(value || "").trim().toUpperCase();
}

function projectDmUsableTranches(issueGroup) {
  const tranches = Array.isArray(issueGroup?.tranches) ? issueGroup.tranches : [];
  if (!tranches.length) return [];
  const usable = tranches.filter((tranche) => tranche.status !== "reallocated");
  return sortProjectDmTranches(usable.length ? usable : tranches);
}

function sortProjectDmTranches(tranches) {
  return [...(tranches || [])].sort((left, right) => compareProjectShortNameOrder(
    left?.shortName || left?.securityId || "",
    right?.shortName || right?.securityId || "",
  ));
}

function buildDmProjectSourceText(projectValue) {
  if (isAbsProject(projectValue)) return buildAbsProjectSourceText(projectValue);
  const rating = projectValue.subjectRating
    ? `${projectValue.subjectRating}${projectValue.ratingAgency ? `(${projectValue.ratingAgency})` : ""}`
    : "主体评级待补";
  const hidden = projectValue.hiddenRating ? `/隐含${projectValue.hiddenRating}` : "";
  const scale = Number.isFinite(numberOrNull(projectValue.issueScale)) ? `规模${formatNumber(projectValue.issueScale)}亿` : "规模待补";
  const inquiry = Number.isFinite(numberOrNull(projectValue.inquiryLow)) && Number.isFinite(numberOrNull(projectValue.inquiryHigh))
    ? `询价区间${formatNumber(projectValue.inquiryLow)}-${formatNumber(projectValue.inquiryHigh)}`
    : "询价区间待补";
  const valuationText = formatRateListInput(projectValue.valuations?.length ? projectValue.valuations : [projectValue.valuation]);
  const guidanceText = formatRateListInput(projectValue.guidancePrices?.length ? projectValue.guidancePrices : [projectValue.guidancePrice]);
  const lines = [
    `${projectValue.shortName || "债券简称待补"} ${projectValue.sponsorStatus || "主承身份待补"} ${projectValue.branch || "联动分行待补"}`,
    `${projectValue.durationText || "期限待补"} ${scale} ${rating}${hidden}`,
    `${inquiry} ${projectValue.venue || "发行场所待补"} ${projectValue.leadUnderwriter || "牵头主承待补"}`,
  ];
  if (valuationText) lines.push(`${projectValue.shortName || "债券简称待补"} 市场估值约${valuationText}`);
  if (guidanceText) lines.push(`如需综合定价，指导价约${guidanceText}`);
  return lines.join("\n");
}

function buildAbsProjectSourceText(projectValue) {
  const absInfo = normalizeProjectAbsInfo(projectValue.absInfo);
  const tranches = absInfo.tranches.map((tranche) => {
    const facts = [
      tranche.className || tranche.shortName || "分档",
      Number.isFinite(numberOrNull(tranche.scale)) ? `规模${formatNumber(tranche.scale)}亿` : "",
      Number.isFinite(numberOrNull(tranche.sharePct)) ? `占比${formatNumber(tranche.sharePct)}%` : "",
      tranche.expectedMaturityDate ? `预期到期${tranche.expectedMaturityDate}` : tranche.expectedTerm ? `预期期限${tranche.expectedTerm}` : "",
      tranche.debtRating ? `债项${tranche.debtRating}${tranche.debtRatingAgency ? `(${tranche.debtRatingAgency})` : ""}` : "",
      Number.isFinite(numberOrNull(tranche.inquiryLow)) && Number.isFinite(numberOrNull(tranche.inquiryHigh))
        ? `利率区间${formatNumber(tranche.inquiryLow)}-${formatNumber(tranche.inquiryHigh)}`
        : "",
      tranche.selected ? "本次投资" : "",
    ].filter(Boolean);
    return `分档：${facts.join(" ")}`;
  });
  return [
    `${projectValue.shortName || "ABS简称待补"} ${projectValue.sponsorStatus || "主承身份待补"} ${projectValue.branch || "联动分行待补"} ${projectValue.instrumentType || "ABS"}`,
    `专项计划：${absInfo.planName || projectValue.fullName || "专项计划/产品名称待补"}`,
    `发行规模：${Number.isFinite(numberOrNull(absInfo.totalScale ?? projectValue.issueScale)) ? `${formatNumber(absInfo.totalScale ?? projectValue.issueScale)}亿` : "待补"} ${projectValue.venue || "发行场所待补"} ${projectValue.leadUnderwriter || "牵头主承待补"}`,
    `基础资产：${absInfo.underlyingAsset || "待补"}`,
    `增信支持：${absInfo.creditEnhancementType || "类型待补"} ${absInfo.creditEnhancementParty || "主体待补"}`,
    absInfo.creditApprovalText ? `授信方面：${absInfo.creditApprovalText}` : "",
    ...tranches,
  ].filter(Boolean).join("\n");
}

function renderProjectDmAssist(payload) {
  const output = $("#projectDmAssist");
  if (!output) return;
  output.hidden = false;
  if (!payload?.ok) {
    const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
    output.innerHTML = `
      <div class="project-dm-assist-head">
        <strong>${escapeHtml(payload?.noResult ? "未查询到匹配债券" : "DM 查询失败")}</strong>
        <span>${escapeHtml(payload?.hint || payload?.error || "请检查简称、代码或查询窗口。")}</span>
      </div>
      ${suggestions.length ? `<div class="dm-suggestion-list">${suggestions.map(renderProjectDmSuggestion).join("")}</div>` : ""}
    `;
    return;
  }

  const issueGroup = payload.issueGroup || payload.normalized?.issueGroup || null;
  const normalized = payload.normalized || {};
  const abs = Boolean(normalized.isAbs || normalized.absInfo || /^(ABS|ABN)$/i.test(String(issueGroup?.instrumentType || "")));
  const facts = [
    abs ? (normalized.instrumentType || normalized.absInfo?.type || "ABS") : "",
    normalized.shortName,
    abs ? (normalized.absInfo?.planName || issueGroup?.issueName || "") : normalized.issuerName,
    !abs && normalized.durationText ? `期限 ${normalized.durationText}` : "",
    Number.isFinite(numberOrNull(normalized.absInfo?.totalScale ?? issueGroup?.totalScale ?? normalized.issueScaleYi)) ? `规模 ${formatNumber(normalized.absInfo?.totalScale ?? issueGroup?.totalScale ?? normalized.issueScaleYi)}亿` : "",
    normalized.inquiryRange ? `区间 ${normalized.inquiryRange}` : "",
  ].filter(Boolean);
  output.innerHTML = `
    <div class="project-dm-assist-head">
      <strong>DM 已带入${abs ? " ABS/ABN" : ""}新增项目</strong>
      <span>${escapeHtml(facts.join(" · ") || "已读取结构化字段，请复核后保存。")}</span>
    </div>
    ${renderProjectDmIssueGroup(issueGroup)}
  `;
}

function renderProjectDmSuggestion(item) {
  const query = item.shortName || item.securityId || "";
  const facts = [
    item.matchReason || "",
    item.securityId ? `代码 ${item.securityId}` : "",
    item.issuerName || "",
    item.tenor ? `期限 ${item.tenor}` : "",
    Number.isFinite(numberOrNull(item.issueScaleYi)) ? `规模 ${formatNumber(item.issueScaleYi)}亿` : "",
    item.inquiryRange ? `区间 ${item.inquiryRange}` : "",
  ].filter(Boolean);
  return `
    <button class="dm-suggestion-card" type="button" data-project-dm-query="${escapeAttribute(query)}" aria-label="读取 ${escapeAttribute(query || "候选债券")}">
      <span>${escapeHtml(item.shortName || item.securityId || "未命名候选")}</span>
      <small>${escapeHtml(facts.join(" · ") || "点击用该候选继续读取 DM")}</small>
    </button>
  `;
}

function renderProjectDmIssueGroup(issueGroup) {
  const tranches = Array.isArray(issueGroup?.tranches) ? issueGroup.tranches : [];
  if (tranches.length < 2) return "";
  const usable = projectDmUsableTranches(issueGroup);
  const abs = /^(ABS|ABN)$/i.test(String(issueGroup.instrumentType || ""));
  const summary = [
    `${tranches.length} 个${abs ? "分档" : "期限"}`,
    dmIssueGroupSourceLabel(issueGroup.source),
    usable.length !== tranches.length ? `默认入项 ${usable.length} 个可发行${abs ? "分档" : "期限"}` : "",
  ].filter(Boolean).join(" · ");
  return `
    <div class="project-dm-issue-group">
      <div class="project-dm-assist-head compact">
        <strong>${abs ? "ABS分档组" : "同次发行组"}</strong>
        <span>${escapeHtml(summary)}</span>
      </div>
      <div class="dm-issue-group-list">
        ${tranches.map(renderProjectDmIssueTranche).join("")}
      </div>
    </div>
  `;
}

function renderProjectDmIssueTranche(tranche) {
  const status = dmIssueTrancheStatusMeta(tranche);
  const targetQuery = tranche.reallocationTargetShortName || tranche.reallocationTargetSecurityId || "";
  const query = targetQuery || tranche.shortName || tranche.securityId || "";
  const facts = [
    tranche.trancheLevel ? `级别 ${tranche.trancheLevel}` : "",
    tranche.tenor ? `期限 ${tranche.tenor}` : "",
    Number.isFinite(numberOrNull(tranche.planScale)) ? `计划 ${formatNumber(tranche.planScale)}亿` : "",
    Number.isFinite(numberOrNull(tranche.actualScale)) ? `发行 ${formatNumber(tranche.actualScale)}亿` : "",
    Number.isFinite(numberOrNull(tranche.sharePct)) ? `占比 ${formatNumber(tranche.sharePct)}%` : "",
    tranche.expectedMaturityDate ? `预期到期 ${tranche.expectedMaturityDate}` : "",
    tranche.debtRating ? `债项 ${tranche.debtRating}${tranche.debtRatingAgency ? `(${tranche.debtRatingAgency})` : ""}` : "",
    tranche.inquiryRange ? `区间 ${tranche.inquiryRange}` : "",
    Number.isFinite(numberOrNull(tranche.couponRate)) ? `票面 ${formatNumber(tranche.couponRate)}%` : "",
  ].filter(Boolean);
  return `
    <article class="dm-issue-tranche ${tranche.isQueriedInput ? "queried" : ""} ${tranche.status === "reallocated" ? "attention" : ""}" role="button" tabindex="0" data-project-dm-query="${escapeAttribute(query)}" aria-label="读取 ${escapeAttribute(query || "该品种")}">
      <div class="dm-issue-tranche-head">
        <strong>${escapeHtml(tranche.shortName || "未命名品种")}</strong>
        <span class="status-badge ${status.className}">${escapeHtml(status.label)}</span>
      </div>
      <div class="dm-issue-tranche-tags">
        ${tranche.isQueriedInput ? `<span>当前查询</span>` : ""}
        ${tranche.isDmMatched ? `<span>DM命中</span>` : ""}
        <span>${escapeHtml(dmIssueGroupSourceLabel(tranche.source))}</span>
      </div>
      <p>${facts.length ? escapeHtml(facts.join(" · ")) : "暂无结构化发行要素"}</p>
      ${renderProjectDmReallocationReason(tranche)}
    </article>
  `;
}

function renderProjectDmReallocationReason(tranche) {
  const target = tranche?.reallocationTargetShortName || tranche?.reallocationTargetSecurityId || "";
  if (tranche?.status === "reallocated" && target) {
    return `
      <small class="dm-reallocation-note">
        <span>本期债券已全部回拨至${escapeHtml(target)}，请点击</span>
        <button class="dm-reallocation-target" type="button" data-project-dm-query="${escapeAttribute(target)}">${escapeHtml(target)}</button>
        <span>查看详情</span>
      </small>
    `;
  }
  return tranche?.statusReason ? `<small>${escapeHtml(tranche.statusReason)}</small>` : "";
}

function dmPayloadSourceLabel(payload) {
  const fields = Object.values(payload?.normalized?.ratingSource || {});
  if (fields.includes("issuer-db")) return "DM+云端数据库";
  if (payload?.issueGroup?.source === "cloud-db") return "云端数据库";
  if (payload?.issueGroup?.source === "mixed") return "DM+云端数据库";
  return "DM";
}

function parseDmInquiryRange(value = "") {
  const numbers = String(value || "").match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (!numbers.length) return { low: null, high: null };
  if (numbers.length === 1) return { low: numbers[0], high: numbers[0] };
  return { low: Math.min(numbers[0], numbers[1]), high: Math.max(numbers[0], numbers[1]) };
}

function parseRateListInput(value = "") {
  return (String(value || "").match(/\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter(Number.isFinite);
}

function formatRateListInput(values = []) {
  const numbers = (Array.isArray(values) ? values : [values])
    .map(numberOrNull)
    .filter(Number.isFinite);
  return numbers.map(formatNumber).join("/");
}

function normalizeDmTenor(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d+(?:\.\d+)?)(D|M|Y)$/i);
  if (!match) return text;
  const unit = match[2].toUpperCase() === "D" ? "D" : match[2].toUpperCase() === "M" ? "M" : "Y";
  return `${match[1]}${unit}`;
}

function compactProjectDurations(values) {
  const durations = uniqueNonEmpty(values);
  if (!durations.length) return "";
  if (durations.length === 1) return durations[0];
  const units = durations.map((item) => item.match(/(D|M|Y|天|月|年)$/i)?.[1] || "");
  if (units.every((unit) => unit && unit.toUpperCase() === units[0].toUpperCase())) {
    const unit = units[0];
    return `${durations.map((item) => item.slice(0, -unit.length)).join("/")}${unit}`;
  }
  return durations.join("/");
}

function compactProjectShortNames(names) {
  const values = uniqueNonEmpty(names).sort(compareProjectShortNameOrder);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  const parsed = values.map(projectCompactShortNameParts);
  const sharedLabel = parsed.every((item) => item.label === parsed[0].label) ? parsed[0].label : "";
  const cores = sharedLabel ? parsed.map((item) => item.core) : values;
  const first = cores[0];
  const letter = first.match(/^(.*?)([A-Z])$/i);
  if (letter) {
    const suffixes = cores.map((name) => name.match(new RegExp(`^${escapeRegExpForPattern(letter[1])}([A-Z])$`, "i"))?.[1]?.toUpperCase());
    if (suffixes.every(Boolean)) return `${first}/${suffixes.slice(1).join("/")}${sharedLabel}`;
  }
  const number = first.match(/^(.*?)(\d+)$/);
  if (number) {
    const suffixes = cores.map((name) => name.match(new RegExp(`^${escapeRegExpForPattern(number[1])}(\\d+)$`))?.[1]);
    if (suffixes.every(Boolean)) return `${number[1]}${suffixes.join("/")}${sharedLabel}`;
  }
  return values.join("/");
}

function projectCompactShortNameParts(value) {
  const text = String(value || "").trim();
  const label = text.match(/(\([^()]*\)|（[^（）]*）)$/)?.[1] || "";
  return {
    text,
    core: label ? text.slice(0, -label.length) : text,
    label,
  };
}

function compareProjectShortNameOrder(left, right) {
  const a = projectShortNameSortParts(left);
  const b = projectShortNameSortParts(right);
  return a.groupKey.localeCompare(b.groupKey, "zh-Hans-CN")
    || a.variant - b.variant
    || a.text.localeCompare(b.text, "zh-Hans-CN");
}

function projectShortNameSortParts(value) {
  const text = normalizeProjectShortNameForSort(value);
  const product = text.match(/^(\d{2})(.*?)(SCP|CP|MTN|PPN|ABN|PRN)(\d{1,3})([A-Z])?$/i);
  if (product) {
    return {
      groupKey: `${product[1]}-${product[3].toUpperCase()}-${product[4].padStart(3, "0")}`,
      variant: projectLetterSortValue(product[5]),
      text,
    };
  }
  const letter = text.match(/^(.*\d)([A-Z])$/i);
  if (letter) return { groupKey: letter[1], variant: projectLetterSortValue(letter[2]), text };
  const number = text.match(/^(.*?)(\d+)$/);
  if (number) return { groupKey: number[1], variant: Number(number[2]), text };
  return { groupKey: text, variant: 0, text };
}

function normalizeProjectShortNameForSort(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[\(（][^\)）]*[\)）]/g, "")
    .replace(/[\[\{][^\]\}]*[\]\}]/g, "")
    .replace(/_BC$/i, "")
    .replace(/[·.,，。:：;；"'`]/g, "");
}

function projectLetterSortValue(letter = "") {
  const text = String(letter || "").toUpperCase();
  if (!text) return 0;
  const code = text.charCodeAt(0);
  return code >= 65 && code <= 90 ? code - 64 : 99;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sumFinite(values) {
  const numbers = values.map(numberOrNull).filter(Number.isFinite);
  return numbers.length ? round(numbers.reduce((sum, value) => sum + value, 0), 4) : null;
}

function escapeRegExpForPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findIssuerForProject(projectValue) {
  return findIssuer(projectValue?.issuerName || "", state.issuers)
    || findIssuer(projectValue?.shortName || "", state.issuers);
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
  ensureAbsInfo(project);
  $$("[data-project-field]").forEach((input) => {
    const field = input.dataset.projectField;
    input.value = project[field] ?? "";
  });
  fillAbsFields();
  if ($("#projectDmSeedInput")) $("#projectDmSeedInput").value = project.shortName || "";
  if ($("#projectValuationInput")) $("#projectValuationInput").value = formatRateListInput(project.valuations?.length ? project.valuations : [project.valuation]);
  if ($("#projectGuidancePriceInput")) $("#projectGuidancePriceInput").value = formatRateListInput(project.guidancePrices?.length ? project.guidancePrices : [project.guidancePrice]);
  ensureInquiryRangeCapacity(project);
  renderTrancheInquiryFields();
  syncProjectConditionalFields();
  applyProjectRecognitionMarks();
}

function syncProjectConditionalFields() {
  const abs = isAbsProject(project);
  $$("[data-standard-project-field]").forEach((item) => {
    if (item.id === "trancheInquiryPanel") return;
    item.hidden = abs;
  });
  const absPanel = $("#absFieldPanel");
  if (absPanel) absPanel.hidden = !abs;
  const exchangeIssueField = $("#exchangeIssueNumberField");
  if (exchangeIssueField) exchangeIssueField.hidden = abs || !isExchangeProject(project);
  if (abs) {
    $("#trancheInquiryPanel").hidden = true;
  } else {
    $("#trancheInquiryPanel").hidden = inquiryVarietyCount(project) <= 1;
  }
}

function ensureAbsInfo(projectValue) {
  projectValue.absInfo = normalizeProjectAbsInfo(projectValue.absInfo);
  return projectValue.absInfo;
}

function normalizeProjectAbsInfo(input = {}) {
  return {
    planName: String(input.planName || "").trim(),
    totalScale: numberOrNull(input.totalScale),
    bookDate: String(input.bookDate || "").trim(),
    selectedClass: String(input.selectedClass || "").trim(),
    underlyingAsset: String(input.underlyingAsset || "").trim(),
    creditEnhancementType: String(input.creditEnhancementType || "").trim(),
    creditEnhancementParty: String(input.creditEnhancementParty || "").trim(),
    creditApprovalText: String(input.creditApprovalText || "").trim(),
    approvalAmount: numberOrNull(input.approvalAmount),
    approvalRatio: numberOrNull(input.approvalRatio),
    approvalTermText: String(input.approvalTermText || "").trim(),
    applicationAmount: numberOrNull(input.applicationAmount),
    recommendedAmount: numberOrNull(input.recommendedAmount),
    source: String(input.source || "").trim(),
    tranches: Array.isArray(input.tranches) ? input.tranches.map(normalizeProjectAbsTranche) : [],
  };
}

function normalizeProjectAbsTranche(input = {}) {
  return {
    id: input.id || crypto.randomUUID(),
    className: String(input.className || input.trancheLevel || input.absClassName || "").trim(),
    shortName: String(input.shortName || "").trim(),
    securityId: String(input.securityId || input.securityCode || "").trim(),
    scale: numberOrNull(input.scale ?? input.actualScale ?? input.planScale ?? input.issueScale),
    sharePct: numberOrNull(input.sharePct),
    expectedMaturityDate: String(input.expectedMaturityDate || "").trim(),
    expectedTerm: String(input.expectedTerm || input.tenor || "").trim(),
    debtRating: String(input.debtRating || "").trim().toUpperCase(),
    debtRatingAgency: String(input.debtRatingAgency || "").trim(),
    inquiryLow: numberOrNull(input.inquiryLow),
    inquiryHigh: numberOrNull(input.inquiryHigh),
    selected: Boolean(input.selected),
  };
}

function defaultAbsTranche() {
  return normalizeProjectAbsTranche({ className: "优先级", selected: true });
}

function fillAbsFields() {
  const absInfo = ensureAbsInfo(project);
  $$("[data-abs-field]").forEach((input) => {
    const field = input.dataset.absField;
    input.value = absInfo[field] ?? "";
  });
  renderAbsTrancheFields();
}

function updateAbsInfoFromInputs() {
  const absInfo = ensureAbsInfo(project);
  $$("[data-abs-field]").forEach((input) => {
    const field = input.dataset.absField;
    absInfo[field] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
  });
  project.instrumentType = project.instrumentType || "ABS";
  if (absInfo.planName && !project.fullName) project.fullName = absInfo.planName;
  if (Number.isFinite(numberOrNull(absInfo.totalScale)) && !Number.isFinite(numberOrNull(project.issueScale))) {
    project.issueScale = absInfo.totalScale;
  }
}

function renderAbsTrancheFields() {
  const rows = $("#absTrancheRows");
  if (!rows) return;
  const absInfo = ensureAbsInfo(project);
  rows.innerHTML = absInfo.tranches.length
    ? absInfo.tranches.map((tranche, index) => `
      <div class="abs-tranche-row ${tranche.selected ? "is-selected" : ""}" data-abs-tranche-index="${index}">
        <div class="abs-tranche-row-head">
          <label class="abs-invest-switch">
            <input data-abs-tranche-field="selected" type="checkbox" ${tranche.selected ? "checked" : ""}>
            <span>本次投资</span>
          </label>
          <div class="abs-tranche-title">
            <strong>${escapeHtml(tranche.shortName || tranche.className || `分档 ${index + 1}`)}</strong>
            <span>${escapeHtml([tranche.className, tranche.securityId].filter(Boolean).join(" · ") || "补充分档要素")}</span>
          </div>
          <button class="text-button" type="button" data-remove-abs-tranche="${index}">移除</button>
        </div>
        <div class="abs-tranche-main">
          <label class="abs-tranche-field is-wide">分档级别<input data-abs-tranche-field="className" value="${escapeAttribute(tranche.className)}" placeholder="优先A1级"></label>
          <label class="abs-tranche-field">简称<input data-abs-tranche-field="shortName" value="${escapeAttribute(tranche.shortName)}"></label>
          <label class="abs-tranche-field">代码<input data-abs-tranche-field="securityId" value="${escapeAttribute(tranche.securityId)}"></label>
        </div>
        <div class="abs-tranche-secondary">
          <label class="abs-tranche-field">规模（亿元）<input data-abs-tranche-field="scale" type="number" step="0.0001" value="${escapeAttribute(tranche.scale ?? "")}"></label>
          <label class="abs-tranche-field">占比（%）<input data-abs-tranche-field="sharePct" type="number" step="0.01" value="${escapeAttribute(tranche.sharePct ?? "")}"></label>
          <label class="abs-tranche-field">预期到期日<input data-abs-tranche-field="expectedMaturityDate" type="date" value="${escapeAttribute(tranche.expectedMaturityDate)}"></label>
          <label class="abs-tranche-field">预期期限<input data-abs-tranche-field="expectedTerm" value="${escapeAttribute(tranche.expectedTerm)}" placeholder="如 1+1+1年"></label>
          <label class="abs-tranche-field">债项评级<input data-abs-tranche-field="debtRating" value="${escapeAttribute(tranche.debtRating)}"></label>
          <label class="abs-tranche-field">评级机构<input data-abs-tranche-field="debtRatingAgency" value="${escapeAttribute(tranche.debtRatingAgency)}"></label>
          <label class="abs-tranche-field">利率下限（%）<input data-abs-tranche-field="inquiryLow" type="number" step="0.0001" value="${escapeAttribute(tranche.inquiryLow ?? "")}"></label>
          <label class="abs-tranche-field">利率上限（%）<input data-abs-tranche-field="inquiryHigh" type="number" step="0.0001" value="${escapeAttribute(tranche.inquiryHigh ?? "")}"></label>
        </div>
      </div>
    `).join("")
    : '<div class="empty compact">暂无 ABS 分档，读取 DM 后会自动带入，也可手工增加。</div>';
}

function updateAbsTranchesFromInputs() {
  const absInfo = ensureAbsInfo(project);
  absInfo.tranches = [...$("#absTrancheRows").querySelectorAll("[data-abs-tranche-index]")].map((card, index) => {
    const existing = absInfo.tranches[index] || {};
    const values = { id: existing.id };
    card.querySelectorAll("[data-abs-tranche-field]").forEach((input) => {
      values[input.dataset.absTrancheField] = input.type === "checkbox"
        ? input.checked
        : input.type === "number"
          ? numberOrNull(input.value)
          : input.value.trim();
    });
    return normalizeProjectAbsTranche(values);
  });
  project.instrumentType = project.instrumentType || "ABS";
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

  if (isAbsProject(projectValue)) {
    const absInfo = normalizeProjectAbsInfo(projectValue.absInfo);
    [
      ["instrumentType", "项目类型"],
      ["shortName", "ABS 简称"],
      ["branch", "联动分行"],
      ["issueScale", "发行规模"],
      ["venue", "发行场所"],
      ["leadUnderwriter", "牵头主承销商"],
      ["fullName", "专项计划/产品全称"],
    ].forEach(([field, label]) => markAuto(field, label));
    marks["abs.planName"] = valueHasContent(absInfo.planName)
      ? recognitionMark("success", "专项计划/产品名称已识别")
      : recognitionMark("error", "专项计划/产品名称未识别，请补充");
    marks["abs.totalScale"] = Number.isFinite(numberOrNull(absInfo.totalScale))
      ? recognitionMark("success", "全专项计划规模已识别")
      : recognitionMark("attention", "全专项计划规模待补充");
    marks["abs.underlyingAsset"] = valueHasContent(absInfo.underlyingAsset)
      ? recognitionMark("success", "基础资产已识别")
      : recognitionMark("error", "基础资产未识别，请补充");
    marks["abs.creditEnhancementParty"] = valueHasContent(absInfo.creditEnhancementParty)
      ? recognitionMark("success", "增信/支持主体已识别")
      : recognitionMark("attention", "增信/支持主体待补充");
    marks["abs.creditApprovalText"] = valueHasContent(absInfo.creditApprovalText)
      ? recognitionMark("success", "授信表述已识别")
      : recognitionMark("attention", "授信表述待补充");
    absInfo.tranches.forEach((tranche, index) => {
      const base = `abs.tranches.${index}`;
      marks[`${base}.className`] = valueHasContent(tranche.className)
        ? recognitionMark("success", "分档级别已识别")
        : recognitionMark("error", "分档级别未识别，请补充");
      marks[`${base}.scale`] = Number.isFinite(numberOrNull(tranche.scale))
        ? recognitionMark("success", "分档规模已识别")
        : recognitionMark("attention", "分档规模待补充");
      marks[`${base}.debtRating`] = valueHasContent(tranche.debtRating)
        ? recognitionMark("success", "债项评级已识别")
        : recognitionMark("attention", "债项评级待补充");
    });
    if (!issuer) marks.issuerSelect = recognitionMark("attention", "ABS 项目可先保存结构化要素；如需绑定承诺人/原始权益人，可补录主体资料");
    return marks;
  }

  [
    ["shortName", "债券简称"],
    ["sponsorStatus", "主承身份"],
    ["branch", "联动分行"],
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
  $$("[data-abs-field]").forEach((input) => {
    setRecognitionForInput(input, projectRecognitionMarks[`abs.${input.dataset.absField}`]);
  });
  $$("[data-abs-tranche-index]").forEach((card) => {
    const index = Number(card.dataset.absTrancheIndex);
    card.querySelectorAll("[data-abs-tranche-field]").forEach((input) => {
      setRecognitionForInput(input, projectRecognitionMarks[`abs.tranches.${index}.${input.dataset.absTrancheField}`]);
    });
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
  const normalizedFullName = normalizeBondFullNameForProject(project.fullName, project);
  if (project.fullName && normalizedFullName && normalizedFullName !== project.fullName) {
    project.fullName = normalizedFullName;
    const input = $('[data-project-field="fullName"]');
    if (input) input.value = normalizedFullName;
  }
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

  scheduleDmValuationAssist(project, issuer);
  renderWarnings(generated.warnings);
  renderRuleTrace(generated, issuer);
}

function scheduleDmValuationAssist(projectValue, issuer) {
  const output = $("#valuationAssist");
  if (!output) return;
  if (isAbsProject(projectValue)) {
    clearTimeout(valuationAssistTimer);
    if (valuationAssistController) valuationAssistController.abort();
    valuationAssistController = null;
    valuationAssistRequestKey = "";
    output.hidden = true;
    output.innerHTML = "";
    return;
  }
  const issuerName = issuer?.legalName || projectValue?.issuerName || "";
  if (!issuerName || !projectValue?.durationText || !projectValue?.shortName) {
    clearTimeout(valuationAssistTimer);
    if (valuationAssistController) valuationAssistController.abort();
    valuationAssistController = null;
    valuationAssistRequestKey = "";
    output.hidden = true;
    output.innerHTML = "";
    return;
  }

  const key = JSON.stringify({
    issuerName,
    societyCode: projectValue.societyCode || "",
    durationText: projectValue.durationText || "",
    shortName: projectValue.shortName || "",
    fullName: projectValue.fullName || "",
    offeringType: projectValue.offeringType || "",
    venue: projectValue.venue || "",
    hiddenRating: projectValue.hiddenRating || "",
  });
  if (valuationAssistRequestKey === key) return;
  valuationAssistRequestKey = key;
  clearTimeout(valuationAssistTimer);
  valuationAssistTimer = setTimeout(() => fetchDmValuationAssist(key, projectValue, issuerName), 420);
  output.hidden = false;
  output.innerHTML = `
    <div class="valuation-assist-head">
      <strong>估值助手</strong>
      <span>正在读取 DM 存续债上一日估值...</span>
    </div>
  `;
}

async function fetchDmValuationAssist(key, projectValue, issuerName) {
  if (valuationAssistController) valuationAssistController.abort();
  valuationAssistController = new AbortController();
  const params = new URLSearchParams({
    issuerName,
    societyCode: projectValue.societyCode || "",
    durationText: projectValue.durationText || "",
    shortName: projectValue.shortName || "",
    fullName: projectValue.fullName || "",
    offeringType: projectValue.offeringType || "",
    venue: projectValue.venue || "",
    hiddenRating: projectValue.hiddenRating || "",
  });
  try {
    const response = await fetch(`${DM_VALUATION_URL}?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
      signal: valuationAssistController.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = { ok: false, reason: "badResponse", hint: `DM 估值接口返回不是 JSON（HTTP ${response.status}）。` };
    }
    if (valuationAssistRequestKey !== key) return;
    if (payload.ok) renderDmValuationAssist(payload);
    else renderDmValuationEmpty(payload);
  } catch (error) {
    if (error.name === "AbortError" || valuationAssistRequestKey !== key) return;
    renderDmValuationEmpty({ ok: false, reason: "requestFailed", hint: error.message || "DM 估值助手请求失败。" });
  } finally {
    if (valuationAssistRequestKey === key) valuationAssistController = null;
  }
}

function renderDmValuationEmpty(payload) {
  const output = $("#valuationAssist");
  if (!output) return;
  output.hidden = false;
  output.innerHTML = `
    <div class="valuation-assist-head">
      <strong>估值助手</strong>
      <span>${escapeHtml(payload?.hint || "暂无 DM 存续债可比估值。")}</span>
    </div>
  `;
}

function renderDmValuationAssist(payload) {
  const output = $("#valuationAssist");
  if (!output) return;
  const suggestions = Array.isArray(payload.trancheSuggestions) ? payload.trancheSuggestions : [];
  if (!suggestions.length) {
    renderDmValuationEmpty({ hint: payload?.hint || "暂无 DM 存续债可比估值。" });
    return;
  }
  const summary = `${suggestions.length} 个期限 · ${payload.pricedCandidateCount || 0}/${payload.candidateCount || 0} 条 DM 可比券 · ${payload.valuationDate || "上一日"}`;
  output.hidden = false;
  output.innerHTML = `
    <div class="valuation-assist-head">
      <strong>估值助手</strong>
      <span>${escapeHtml(summary)}</span>
    </div>
    <div class="valuation-assist-list">
      ${suggestions.map(renderValuationSuggestionCard).join("")}
    </div>
  `;
}

function renderValuationSuggestionCard(item) {
  const range = item.low === item.high
    ? formatValuationRate(item.center)
    : `${formatValuationRate(item.low)}-${formatValuationRate(item.high)}`;
  const confidenceText = [item.confidence, item.clusterNote].filter(Boolean).join(" · ");
  return `
    <article class="valuation-suggestion-card">
      <div class="valuation-suggestion-main">
        <div>
          <strong>${escapeHtml(item.durationText || "目标期限")} 参考 ${formatValuationRate(item.center)}</strong>
          <span>${escapeHtml(item.profileLabel || "同类债券")} · 置信度${escapeHtml(confidenceText)}</span>
        </div>
        <span>${escapeHtml(range)}</span>
      </div>
      <p>${escapeHtml(item.method)}。建议值仅作框旁提示，估值和综合定价仍由手工填写。</p>
      <div class="valuation-comparable-list">
        ${item.comparableItems.map(renderValuationComparable).join("")}
      </div>
    </article>
  `;
}

function renderValuationComparable(item) {
  const adjustmentBp = round((item.adjustment || 0) * 100, 1);
  const adjustmentText = Math.abs(adjustmentBp) < 0.1
    ? "同期限"
    : `${adjustmentBp > 0 ? "+" : ""}${formatNumber(adjustmentBp)}bp`;
  const facts = [
    item.durationText,
    `${formatValuationRate(item.rate)} ${item.source}`,
    Number.isFinite(numberOrNull(item.curveResidualBp)) ? `曲线偏离${item.curveResidualBp > 0 ? "+" : ""}${formatNumber(item.curveResidualBp)}bp` : "",
    item.reliability ? `推荐度${item.reliability}` : "",
    adjustmentText,
  ].filter(Boolean);
  return `
    <span title="${escapeAttribute(`${item.shortName || ""} ${facts.join(" · ")}`)}">
      ${escapeHtml(item.shortName || "可比券")} · ${escapeHtml(facts.join(" · "))}
    </span>
  `;
}

function formatValuationRate(value) {
  return Number.isFinite(numberOrNull(value)) ? `${formatNumber(value)}%` : "待补";
}

function renderWarnings(warnings) {
  const unique = [...new Set(warnings.filter(Boolean))];
  $("#warningBox").hidden = !unique.length;
  $("#warningList").innerHTML = unique.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
}

function renderRuleTrace(generated, issuer) {
  const suggestion = generated.suggestion;
  const items = isAbsProject(project)
    ? [
        `类型：${project.instrumentType || "ABS"}`,
        project.absInfo?.planName ? `产品：${project.absInfo.planName}` : "专项计划待补",
        ...(suggestion.trancheSuggestions || []).map((item) => `${item.className || item.shortName || item.durationText}：${Number.isFinite(item.suggestedRatio) ? `${formatNumber(item.suggestedRatio)}%` : "比例待补"}`),
        Number.isFinite(suggestion.investmentAmount) ? `申请金额：${formatNumber(suggestion.investmentAmount)}亿元` : "申请金额待补",
        generated.approver,
      ]
    : [
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
  renderUnifiedReminders();
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

function renderUnifiedReminders() {
  const panel = $("#unifiedReminderPanel");
  if (!panel) return;
  const referenceDate = new Date();
  const reminders = buildUnifiedReminders(state, referenceDate);
  const visibleReminders = reminderFilter === "all"
    ? reminders
    : reminders.filter((item) => item.severity === reminderFilter);
  const urgentCount = reminders.filter((item) => item.severity === "critical").length;
  const warningCount = reminders.filter((item) => item.severity === "warning").length;
  const dailyCount = reminders.filter((item) => item.pushPolicy === "daily").length;
  const focusReminder = reminders[0] || null;
  $("#reminderDateLabel").textContent = formatReminderDateLabel(referenceDate);
  $("#unifiedReminderSummary").textContent = [
    `${reminders.length} 项`,
    urgentCount ? `${urgentCount} 急` : "",
    warningCount ? `${warningCount} 需关注` : "",
  ].filter(Boolean).join(" · ");
  $("#reminderCriticalCount").textContent = urgentCount;
  $("#reminderWarningCount").textContent = warningCount;
  $("#reminderDailyCount").textContent = dailyCount;
  $("#reminderFocusTitle").textContent = focusReminder?.subject || "暂无待办";
  $("#reminderFocusDetail").textContent = focusReminder
    ? [focusReminder.moduleLabel, focusReminder.title, focusReminder.detail].filter(Boolean).join(" · ")
    : "今日无待处理事项";
  $("#reminderFocusCard").className = `reminder-focus-card ${focusReminder?.severity || "empty"}`;
  panel.classList.toggle("empty-state", !reminders.length);
  $("#reminderQueueCount").textContent = reminderFilter === "all"
    ? `${reminders.length} 项`
    : `${visibleReminders.length} / ${reminders.length} 项`;
  $$("[data-reminder-filter]").forEach((button) => {
    const active = button.dataset.reminderFilter === reminderFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncAndroidReminders(reminders);
  $("#unifiedReminderList").innerHTML = visibleReminders.length
    ? visibleReminders.map(renderUnifiedReminderItem).join("")
    : renderReminderEmptyState(Boolean(reminders.length));
}

function renderUnifiedReminderItem(item) {
  const subject = item.subject || item.detail || item.title || "待办事项";
  const task = item.moduleLabel || "待办";
  const detail = [item.title, item.detail].filter(Boolean).join(" · ");
  const severity = item.severity || "info";
  const policy = [reminderSeverityLabel(severity), reminderPolicyLabel(item.pushPolicy)].filter(Boolean).join(" · ");
  return `
    <article class="unified-reminder-item ${escapeAttribute(severity)}" data-reminder-severity="${escapeAttribute(severity)}">
      <button class="unified-reminder-main" type="button" aria-label="打开 ${escapeAttribute(subject)}" data-reminder-source="${escapeAttribute(item.sourceType)}" data-reminder-target="${escapeAttribute(item.sourceId || "")}" data-reminder-kind="${escapeAttribute(item.kind || "")}">
        <span class="reminder-item-icon" aria-hidden="true">${renderReminderIcon(item.kind)}</span>
        <span class="reminder-item-copy">
          <span class="reminder-item-kicker">
            <span class="unified-reminder-task">${escapeHtml(task)}</span>
            ${policy ? `<span class="reminder-policy-chip">${escapeHtml(policy)}</span>` : ""}
          </span>
          <strong>${escapeHtml(subject)}</strong>
          <span class="unified-reminder-detail">${escapeHtml(detail)}</span>
        </span>
      </button>
      <div class="unified-reminder-side">
        <span class="unified-reminder-meta">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          ${escapeHtml(formatReminderDueLabel(item.dueAt))}
        </span>
        <button class="button subtle unified-reminder-action" type="button" data-reminder-source="${escapeAttribute(item.sourceType)}" data-reminder-target="${escapeAttribute(item.sourceId || "")}" data-reminder-kind="${escapeAttribute(item.kind || "")}">
          ${escapeHtml(item.actionLabel || "打开")}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </article>
  `;
}

function renderReminderIcon(kind = "") {
  if (kind === "flow-mail") {
    return '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>';
  }
  if (kind === "project-payment") {
    return '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg>';
  }
  if (kind === "project-result") {
    return '<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6"/><path d="M16 7h3v3"/></svg>';
  }
  if (String(kind).startsWith("protocol-")) {
    return '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
}

function renderReminderEmptyState(filtered = false) {
  return `
    <div class="reminder-empty-state">
      <div>
        <span class="reminder-empty-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M9 11l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
        </span>
        <strong>${filtered ? "此分类下暂无任务" : "今日事项已全部清空"}</strong>
        <p>${filtered ? "切换其他筛选，查看剩余行动。" : "新的业务提醒出现后，会自动进入行动队列。"}</p>
      </div>
    </div>
  `;
}

function formatReminderDateLabel(value) {
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(value);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(value);
  return `${date} · ${weekday} · 工作台已就绪`;
}

function formatReminderDueLabel(value) {
  if (!value) return "持续跟进";
  const raw = String(value);
  const date = raw.slice(0, 10);
  const time = raw.includes("T") ? raw.slice(11, 16) : "";
  const today = localDate(new Date());
  const tomorrowValue = new Date();
  tomorrowValue.setDate(tomorrowValue.getDate() + 1);
  const suffix = time ? ` ${time}` : "";
  if (date === today) return `今天${suffix}`;
  if (date === localDate(tomorrowValue)) return `明天${suffix}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日${suffix}`;
  return raw.replace("T", " ");
}

function syncAndroidReminders(reminders) {
  const bridge = window.Tempest07Android;
  if (!bridge || typeof bridge.syncReminders !== "function") return;
  try {
    bridge.syncReminders(JSON.stringify({
      generatedAt: new Date().toISOString(),
      reminders: reminders.map((item) => ({
        id: item.id,
        kind: item.kind,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        moduleLabel: item.moduleLabel,
        subject: item.subject,
        title: item.title,
        detail: item.detail,
        severity: item.severity,
        timing: item.timing,
        pushPolicy: item.pushPolicy,
        dueAt: item.dueAt,
        actionLabel: item.actionLabel,
        route: item.route,
      })),
    }));
  } catch {
    // Android bridge is best-effort; normal browsers should continue silently.
  }
}

function reminderSeverityLabel(severity) {
  if (severity === "critical") return "紧急";
  if (severity === "warning") return "需关注";
  return "日常";
}

function reminderPolicyLabel(policy) {
  if (policy === "immediate") return "即时";
  if (policy === "daily") return "早报";
  return "";
}

function handleUnifiedReminderClick(event) {
  const target = event.target.closest("[data-reminder-source]");
  if (!target) return;
  const source = target.dataset.reminderSource;
  const sourceId = target.dataset.reminderTarget;
  const kind = target.dataset.reminderKind;
  if (source === "mail") {
    switchView("ledger");
    renderProjectWorkspace();
    $("#mailPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    callMailer("preview");
    return;
  }
  if (source === "protocol") {
    selectedProtocolTransferId = sourceId;
    protocolTransferEditMode = true;
    switchView("protocol-transfer");
    renderProtocolTransferWorkspace();
    $("#protocolTransferForm").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (source === "project") {
    selectedProjectId = sourceId;
    switchView("ledger");
    renderProjectWorkspace();
    if (kind === "project-result") openResultEntryPanel(false);
    $("#projectForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
  if (!getCurrentUser() && !isLocalApiMode()) {
    showMailOutput("请先登录", "warning", "请先通过 tempest07.com 统一登录后再预览或发送邮件。");
    redirectToGatewayLogin();
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
    const params = new URLSearchParams({ action: isSend ? "send" : "preview" });
    const response = await fetch(`${MAILER_URL}?${params.toString()}`, {
      method: isSend ? "POST" : "GET",
      credentials: "same-origin",
      headers: authHeaders(),
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
        state = {
          ...state,
          reminderState: markDailyMailSent(state.reminderState, payload.date || localDate(new Date())),
          updatedAt: new Date().toISOString(),
        };
        persistState();
        renderUnifiedReminders();
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
  $("#protocolTransferInput").addEventListener("input", prepareProtocolTransferInputDraft);
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
    protocolTransferEditMode = true;
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
  renderUnifiedReminders();
  renderProtocolTransferTodos();
  renderProtocolTransferList();
  if (selected) fillProtocolTransferForm(selected);
  else if (!$("#protocolTransferId").value) clearProtocolTransferForm(false);
  updateProtocolTransferModeControls();
}

function protocolTransferRecordExists(id) {
  return Boolean(id && (state.protocolTransfers || []).some((item) => item.id === id));
}

function protocolTransferParseTargetId() {
  const currentId = $("#protocolTransferId").value;
  if (protocolTransferEditMode && protocolTransferRecordExists(currentId)) return currentId;
  if (!protocolTransferEditMode && currentId && !protocolTransferRecordExists(currentId)) return currentId;
  return "";
}

function prepareProtocolTransferInputDraft() {
  if (protocolTransferEditMode) return;
  const currentId = $("#protocolTransferId").value;
  if (!protocolTransferRecordExists(currentId) && !protocolTransferRecordExists(selectedProtocolTransferId)) return;
  clearProtocolTransferForm(false);
}

function updateProtocolTransferModeControls() {
  const button = $("#protocolTransferParseButton");
  if (!button) return;
  const editingExisting = protocolTransferEditMode && protocolTransferRecordExists($("#protocolTransferId").value);
  button.textContent = editingExisting ? "识别并更新当前记录" : "识别为新记录";
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
  const targetId = protocolTransferParseTargetId();
  const next = { ...parsed, id: targetId || parsed.id };
  protocolTransferRecognitionMarks = buildProtocolTransferRecognitionMarks(parsed, text);
  protocolTransferRecognitionId = next.id || "";
  fillProtocolTransferForm(next);
  showToast(targetId ? "已识别并填入当前协议转让记录，请复核后保存。" : "已识别为新的协议转让记录，请复核后保存。");
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
    const targetId = protocolTransferParseTargetId();
    const next = { ...parsed, id: targetId || parsed.id };
    protocolTransferRecognitionMarks = buildProtocolTransferRecognitionMarks(parsed, text);
    protocolTransferRecognitionId = next.id || "";
    fillProtocolTransferForm(next);
    setProtocolTransferOcrStatus("识别完成，请复核字段后保存。");
    showToast(targetId ? "单据已识别并填入当前记录，请复核后保存。" : "单据已识别为新记录，请复核后保存。");
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
  updateProtocolTransferModeControls();
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
  protocolTransferEditMode = false;
  protocolTransferRecognitionMarks = {};
  protocolTransferRecognitionId = "";
  $("#protocolTransferForm").reset();
  $("#protocolTransferId").value = "";
  if (resetInput) $("#protocolTransferInput").value = "";
  $("#protocolTransferDeleteButton").hidden = true;
  $("#protocolTransferStatusPill").textContent = "待录入";
  renderProtocolTransferList();
  updateProtocolTransferModeControls();
}

function saveProtocolTransferFromForm() {
  const record = readProtocolTransferForm();
  if (!record.code || !record.shortName) {
    showToast("请至少补齐债券代码和债券简称。");
    return;
  }
  state = upsertProtocolTransfer(state, record);
  selectedProtocolTransferId = record.id;
  protocolTransferEditMode = false;
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

function bindSecondaryInventory() {
  if (!$("#secondaryInput")) return;
  $("#secondarySnapshotDate").value = localDate(new Date());
  $("#secondaryImportSnapshotButton").addEventListener("click", importSecondarySnapshot);
  $("#secondaryUploadSnapshotButton").addEventListener("click", () => $("#secondarySnapshotFileInput").click());
  $("#secondarySnapshotFileInput").addEventListener("change", importSecondarySnapshotFile);
  $("#secondaryParseOrdersButton").addEventListener("click", importSecondaryOrders);
  $("#secondaryParseTradesButton").addEventListener("click", importSecondaryTrades);
  $("#secondarySyncPrimaryButton").addEventListener("click", syncPrimaryAwardsToSecondaryInventory);
  $("#secondaryApplyCodesButton").addEventListener("click", applySecondaryCodeMappings);
  $("#secondaryOrderList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-secondary-order-action]");
    if (!button) return;
    updateSecondaryOrderStatus(button.dataset.secondaryOrderId, button.dataset.secondaryOrderAction);
  });
}

function renderSecondaryInventoryWorkspace() {
  if (!$("#secondaryInput")) return;
  renderSecondaryDashboard();
  renderSecondaryOrders();
  renderSecondaryInventory();
  renderSecondaryPendingCodes();
  renderSecondaryTrades();
}

function renderSecondaryDashboard() {
  const counts = secondaryDashboardCounts(state);
  $("#secondaryPositionCount").textContent = counts.positions;
  $("#secondaryOfferCount").textContent = counts.activeOffers;
  $("#secondaryWarningCount").textContent = counts.warnings;
  $("#secondaryPendingCodeCount").textContent = counts.pendingCodes;
}

function renderSecondaryOrders() {
  const inventoryRows = new Map(calculateShadowInventory(state).map((row) => [positionKey(row), row]));
  const orders = normalizeSecondaryOrders(state.secondaryOrders || [])
    .filter((order) => ["active", "partial"].includes(order.status))
    .slice(0, 80);
  $("#secondaryOrderList").innerHTML = orders.length
    ? orders.map((order) => {
        const row = inventoryRows.get(positionKey(order));
        const remaining = Math.max(0, order.quantityWan - order.filledWan);
        const risk = order.side === "offer" && row && row.availableWan < 0 ? row.warning : "";
        return `
          <article class="secondary-card ${risk ? "warning" : ""}">
            <div class="secondary-card-head">
              <strong>${escapeHtml(order.shortName || order.code || "未命名挂单")}</strong>
              <span class="status-badge ${order.side === "offer" ? "warning" : ""}">${order.side === "offer" ? "挂卖" : "挂买"}</span>
            </div>
            <div class="secondary-meta">
              <span>${escapeHtml(order.account)}</span>
              <span>${escapeHtml(order.code || "代码待补")}</span>
              <span>${escapeHtml(remaining > 0 ? formatAmountWan(remaining) : "数量待定")}</span>
              <span>${escapeHtml(order.price ? formatSecondaryOrderPrice(order.price) : order.yieldRate ? `${formatNumber(order.yieldRate)}%` : "价格待补")}</span>
              ${risk ? `<span>${escapeHtml(risk)}</span>` : ""}
            </div>
            <div class="secondary-card-actions">
              <button class="button subtle" type="button" data-secondary-order-id="${escapeAttribute(order.id)}" data-secondary-order-action="filled">成交</button>
              <button class="button subtle" type="button" data-secondary-order-id="${escapeAttribute(order.id)}" data-secondary-order-action="cancelled">撤单</button>
              <button class="button subtle" type="button" data-secondary-order-id="${escapeAttribute(order.id)}" data-secondary-order-action="expired">过期</button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="empty">暂无有效挂单。粘贴每日 list 后点“解析为挂单”。</div>';
}

function formatSecondaryOrderPrice(price) {
  const text = String(price || "").trim();
  return Number.isFinite(Number(text)) ? `净价${text}` : text;
}

function renderSecondaryInventory() {
  const rows = calculateShadowInventory(state);
  $("#secondaryInventoryList").innerHTML = rows.length
    ? rows.map((row) => `
        <article class="secondary-card ${row.availableWan < 0 ? "warning" : row.unsettledSellWan > 0 ? "attention" : ""}">
          <div class="secondary-card-head">
            <strong>${escapeHtml(row.shortName || row.code || "未命名库存")}</strong>
            <span class="status-badge ${row.availableWan < 0 ? "warning" : ""}">${escapeHtml(formatAmountWan(row.availableWan))}可卖</span>
          </div>
          <div class="secondary-meta">
            <span>${escapeHtml(row.account)}</span>
            <span>${escapeHtml(row.code || "代码待补")}</span>
            <span>快照 ${escapeHtml(row.snapshotDate || "无")}: ${escapeHtml(formatAmountWan(row.snapshotQuantityWan))}</span>
            <span>已卖 ${escapeHtml(formatAmountWan(row.soldWan))}</span>
            <span>挂卖 ${escapeHtml(formatAmountWan(row.activeOfferWan))}</span>
            ${row.pendingBuyWan ? `<span>未交割买入 ${escapeHtml(formatAmountWan(row.pendingBuyWan))}</span>` : ""}
            ${row.warning ? `<span>${escapeHtml(row.warning)}</span>` : ""}
          </div>
        </article>
      `).join("")
    : '<div class="empty">暂无库存。请先导入内网余额台账快照。</div>';
}

function renderSecondaryPendingCodes() {
  const trades = pendingCodeTrades(state);
  $("#secondaryPendingCodeList").innerHTML = trades.length
    ? trades.map((trade) => `
        <article class="secondary-card attention">
          <div class="secondary-card-head">
            <strong>${escapeHtml(trade.shortName || "简称待补")}</strong>
            <span class="status-badge warning">待补代码</span>
          </div>
          <div class="secondary-meta">
            <span>${escapeHtml(trade.account)}</span>
            <span>${escapeHtml(formatAmountWan(trade.quantityWan))}</span>
            <span>${escapeHtml(trade.sourceType === "primary_award" ? "一级中标入库" : "手工流水")}</span>
            <span>交割 ${escapeHtml(trade.settlementDate)}</span>
          </div>
        </article>
      `).join("")
    : '<div class="empty">暂无待补代码记录。</div>';
}

function renderSecondaryTrades() {
  const trades = normalizeSecondaryTrades(state.secondaryTrades || []).slice(0, 120);
  $("#secondaryTradeList").innerHTML = trades.length
    ? trades.map((trade) => `
        <article class="secondary-card ${trade.codeStatus === "pending" ? "attention" : ""}">
          <div class="secondary-card-head">
            <strong>${escapeHtml(trade.shortName || trade.code || "未命名流水")}</strong>
            <span class="status-badge ${trade.side === "sell" ? "warning" : ""}">${trade.side === "sell" ? "卖出" : "买入"}</span>
          </div>
          <div class="secondary-meta">
            <span>${escapeHtml(trade.account)}</span>
            <span>${escapeHtml(trade.code || "代码待补")}</span>
            <span>${escapeHtml(formatAmountWan(trade.quantityWan))}</span>
            <span>谈判 ${escapeHtml(trade.negotiationDate)}</span>
            <span>交易 ${escapeHtml(trade.tradeDate)}+${escapeHtml(trade.settlementSpeed)}</span>
            <span>交割 ${escapeHtml(trade.settlementDate)}</span>
            ${trade.sourceType === "primary_award" ? "<span>一级中标</span>" : ""}
          </div>
        </article>
      `).join("")
    : '<div class="empty">暂无成交流水。成交后粘贴要素并点“录入成交”。</div>';
}

function importSecondarySnapshot() {
  const text = $("#secondaryInput").value;
  const positions = parseInventorySnapshotText(text, { snapshotDate: $("#secondarySnapshotDate").value });
  if (!positions.length) {
    showToast("没有识别到库存快照。请确认包含代码/简称和持仓面额。");
    return;
  }
  state = upsertInventoryPositions(state, positions);
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast(`已导入 ${positions.length} 条库存快照，以实际库存为准。`);
}

async function importSecondarySnapshotFile() {
  const input = $("#secondarySnapshotFileInput");
  const file = input.files?.[0];
  if (!file) return;
  const button = $("#secondaryUploadSnapshotButton");
  if (button) button.disabled = true;
  try {
    await ensureExcelJsReady();
    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("余额台账没有可读取的工作表");
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      rows.push(row.values.slice(1).map((value) => value?.result ?? value?.text ?? value));
    });
    const positions = parseInventoryLedgerRows(rows, { snapshotDate: $("#secondarySnapshotDate").value });
    if (!positions.length) throw new Error("未识别到债券代码、简称和名义本金列");
    state = upsertInventoryPositions(state, positions);
    persistState();
    renderSecondaryInventoryWorkspace();
    showToast(`已从 ${file.name} 导入 ${positions.length} 条余额台账库存。`);
  } catch (error) {
    showToast(error.message || "余额台账导入失败。");
  } finally {
    input.value = "";
    if (button) button.disabled = false;
  }
}

function importSecondaryOrders() {
  const orders = parseSecondaryOrderText($("#secondaryInput").value);
  if (!orders.length) {
    showToast("没有识别到挂单。请确认包含代码/简称、方向和数量。");
    return;
  }
  state = upsertSecondaryOrders(state, orders);
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast(`已加入 ${orders.length} 条二级挂单。`);
}

function importSecondaryTrades() {
  const trades = parseSecondaryTradeText($("#secondaryInput").value);
  if (!trades.length) {
    showToast("没有识别到成交流水。请确认包含代码/简称、数量和买卖方向。");
    return;
  }
  state = upsertSecondaryTrades(state, trades);
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast(`已录入 ${trades.length} 条成交流水，卖出已锁定影子库存。`);
}

function syncPrimaryAwardsToSecondaryInventory() {
  const trades = buildPrimaryAwardTrades(state.projects || [], state.secondaryTrades || []);
  if (!trades.length) {
    showToast("没有新的一级中标可同步，或已同步过。");
    return;
  }
  state = upsertSecondaryTrades(state, trades);
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast(`已同步 ${trades.length} 条一级中标入库草稿，缺代码的已进入待补代码池。`);
}

function applySecondaryCodeMappings() {
  const result = applyCodeMappingText(state, $("#secondaryInput").value);
  if (!result.updatedCount) {
    showToast("没有匹配到可补全的代码。请粘贴“简称 + 代码”格式文本。");
    return;
  }
  state = result.state;
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast(`已补全 ${result.updatedCount} 条待代码库存。`);
}

function updateSecondaryOrderStatus(id, status) {
  const orders = normalizeSecondaryOrders(state.secondaryOrders || []);
  const order = orders.find((item) => item.id === id);
  if (!order) return;
  const today = localDate(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextState = {
    ...state,
    secondaryOrders: orders.map((item) => item.id === id ? markSecondaryOrderStatus(item, status, item.quantityWan) : item),
    updatedAt: new Date().toISOString(),
  };
  const remaining = Math.max(0, order.quantityWan - order.filledWan);
  state = status === "filled" && remaining > 0
    ? upsertSecondaryTrades(nextState, [{
        side: order.side === "offer" ? "sell" : "buy",
        account: order.account,
        code: order.code,
        shortName: order.shortName,
        quantityWan: remaining,
        price: order.price,
        yieldRate: order.yieldRate,
        negotiationDate: today,
        tradeDate: today,
        settlementSpeed: 1,
        settlementDate: localDate(tomorrow),
        sourceType: "order_fill",
        codeStatus: order.code ? "confirmed" : "pending",
        sourceText: order.sourceText || "",
      }])
    : nextState;
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast(status === "filled" ? "挂单已成交并生成二级流水，影子库存已锁定。" : "挂单状态已更新。");
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
  return isAbsProject(projectValue) || /(?:ABS|ABN|资产支持)/i.test(`${projectValue.shortName} ${tranche.shortName} ${projectValue.sourceText}`);
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
          <span class="project-offering-badge ${projectOfferingBadgeClass(item)}">${escapeHtml(formatProjectOfferingSummary(item) || "发行方式待补")}</span>
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
  $("#projectSummaryBranch").textContent = record.branch || "联动分行待补";
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
    values.absClassName = existing.tranches?.[trancheIndex]?.absClassName;
    values.sharePct = existing.tranches?.[trancheIndex]?.sharePct;
    values.expectedMaturityDate = existing.tranches?.[trancheIndex]?.expectedMaturityDate;
    values.debtRating = existing.tranches?.[trancheIndex]?.debtRating;
    values.debtRatingAgency = existing.tranches?.[trancheIndex]?.debtRatingAgency;
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
  renderUnifiedReminders();
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
    formatProjectLeadForDisplay(projectValue),
  ].filter(Boolean).join(" · ") || "场所/主承待补";
}

function formatProjectLeadForDisplay(projectValue) {
  const value = buildUnderwriter(projectValue || {});
  return value.includes("【") ? "" : value;
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
  if (isAbsProject(projectValue)) return projectValue.instrumentType || "ABS";
  if (["公募", "私募"].includes(projectValue.offeringType)) return projectValue.offeringType;
  const text = `${projectValue.sourceText || ""} ${projectValue.opinion || ""}`.replace(/公私募/g, "");
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

function projectOfferingBadgeClass(projectValue) {
  const offering = formatProjectOfferingSummary(projectValue);
  if (offering === "公募") return "is-public";
  if (offering === "私募") return "is-private";
  if (/^(ABS|ABN)$/i.test(offering)) return "is-structured";
  return "is-unknown";
}

function statusBadgeClass(status) {
  if (["未投标", "待投标", "已投标待结果"].includes(status)) return "warning";
  if (["未中标", "已结束"].includes(status)) return "muted";
  return "";
}

function recognitionMark(status, message, source = "") {
  return { status, message, source };
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
    delete target.dataset.recognitionSource;
    if (target.dataset.recognitionTitle === "true") {
      target.removeAttribute("title");
      delete target.dataset.recognitionTitle;
    }
    return;
  }
  target.dataset.recognitionStatus = mark.status;
  target.dataset.recognitionMessage = mark.message || "";
  if (mark.source) target.dataset.recognitionSource = mark.source;
  else delete target.dataset.recognitionSource;
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
    delete target.dataset.recognitionSource;
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
  $("#quickIssuerForm").addEventListener("input", (event) => {
    clearRecognitionForInput(event.target);
  });
  $("#quickIssuerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const draft = readIssuerDraftInput("quick");
      const missing = missingRequiredProjectIssuerFields(draft);
      if (missing.length) {
        applyQuickIssuerRequiredMarks(missing);
        focusFirstQuickIssuerMissingField(missing);
        showToast(`请先补全主体入库字段：${missing.map((item) => item.label).join("、")}。`);
        return;
      }
      const issuer = issuerFromDraft(draft);
      const existing = state.issuers.find((candidate) => candidate.legalName === issuer.legalName);
      if (existing) issuer.id = existing.id;
      state = upsertIssuer(state, issuer);
      selectedIssuerId = issuer.id;
      const saved = state.issuers.find((item) => item.id === issuer.id) || issuer;
      project = applyIssuerCommonFields(project, saved);
      project.sourceText = buildDmProjectSourceText(project);
      $("#briefInput").value = project.sourceText;
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

function openQuickIssuerPanel(options = {}) {
  const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
  const draft = createIssuerDraft(project, issuer);
  fillIssuerInput("quick", draft);
  applyQuickIssuerRequiredMarks(options.enforceRequired ? (options.missing || missingRequiredProjectIssuerFields(draft)) : []);
  const panel = $("#quickIssuerPanel");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  if (options.enforceRequired) focusFirstQuickIssuerMissingField(options.missing || missingRequiredProjectIssuerFields(draft));
}

function applyQuickIssuerRequiredMarks(missingFields = []) {
  for (const field of REQUIRED_PROJECT_ISSUER_FIELDS) {
    const input = $(`#${field.inputId}`);
    if (!input) continue;
    const missing = missingFields.some((item) => item.key === field.key);
    setRecognitionForInput(input, missing ? recognitionMark("error", `${field.label}为项目入库必填项`) : null);
  }
}

function focusFirstQuickIssuerMissingField(missingFields = []) {
  const first = missingFields[0];
  if (!first) return;
  const input = $(`#${first.inputId}`);
  if (input) input.focus();
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
        <label>联动分行<input data-batch-index="${index}" data-batch-field="defaultBranch" value="${escapeAttribute(draft.defaultBranch)}"></label>
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

function bindDmTest() {
  const form = $("#dmLookupForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runDmLookup();
  });
  $("#dmLookupClearButton").addEventListener("click", clearDmLookup);
  $("#dmLookupCopyButton").addEventListener("click", async () => {
    if (!dmLastPayload) return;
    await navigator.clipboard.writeText(JSON.stringify(dmLastPayload, null, 2));
    showToast("DM 返回 JSON 已复制。");
  });
  $("#dmIssueGroupOutput").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-dm-issue-query]");
    if (!button) return;
    const query = button.dataset.dmIssueQuery?.trim();
    if (!query) return;
    $("#dmLookupInput").value = query;
    await runDmLookup();
  });
  $("#dmIssueGroupOutput").addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest("button")) return;
    const card = event.target.closest(".dm-issue-tranche[data-dm-issue-query]");
    if (!card) return;
    const query = card.dataset.dmIssueQuery?.trim();
    if (!query) return;
    event.preventDefault();
    $("#dmLookupInput").value = query;
    await runDmLookup();
  });
  $("#dmNormalizedOutput").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-dm-suggestion-query]");
    if (!button) return;
    const query = button.dataset.dmSuggestionQuery?.trim();
    if (!query) return;
    $("#dmLookupInput").value = query;
    await runDmLookup();
  });
}

async function runDmLookup() {
  const query = $("#dmLookupInput").value.trim();
  if (!query) {
    showToast("请先输入债券简称或代码。");
    return;
  }

  const params = new URLSearchParams();
  if (looksLikeSecurityId(query)) params.set("securityId", query);
  else params.set("shortName", query);
  const startDate = $("#dmLookupStartDate").value;
  const endDate = $("#dmLookupEndDate").value;
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  setDmLookupBusy(true);
  const startedAt = performance.now();
  try {
    const response = await fetch(`./api/dm/lookup?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = { ok: false, error: `HTTP ${response.status}: 返回不是 JSON` };
    }
    await renderDmLookupResult({ ...payload, httpStatus: response.status, elapsedMs });
    const hasSuggestions = Array.isArray(payload.suggestions) && payload.suggestions.length > 0;
    showToast(payload.ok ? "DM 查询成功。" : payload.noResult ? (hasSuggestions ? "DM 无结果，可查看相近候选。" : "DM 无结果。") : "DM 查询失败，请看诊断信息。");
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    await renderDmLookupResult({
      ok: false,
      error: error.message || "DM 查询请求失败",
      diagnostic: { responsePreview: "浏览器请求失败，未收到接口响应。" },
      elapsedMs,
    });
    showToast("DM 查询请求失败。");
  } finally {
    setDmLookupBusy(false);
  }
}

function clearDmLookup() {
  dmLastPayload = null;
  $("#dmLookupInput").value = "";
  $("#dmLookupStartDate").value = "";
  $("#dmLookupEndDate").value = "";
  $("#dmLookupStatus").textContent = "等待查询";
  $("#dmLookupStatus").className = "status-badge muted";
  $("#dmNormalizedOutput").innerHTML = `<div class="empty">暂无查询结果。</div>`;
  $("#dmIssueGroupPanel").hidden = true;
  $("#dmIssueGroupSummary").textContent = "未识别";
  $("#dmIssueGroupOutput").innerHTML = "";
  $("#dmDiagnosticOutput").textContent = "暂无诊断。";
  $("#dmCandidateOutput").innerHTML = `<div class="empty">暂无候选字段。</div>`;
  $("#dmCandidateCount").textContent = "0 项";
  $("#dmRawOutput").textContent = "暂无返回。";
  $("#dmLookupCopyButton").disabled = true;
}

function setDmLookupBusy(isBusy) {
  $("#dmLookupButton").disabled = isBusy;
  $("#dmLookupButton").textContent = isBusy ? "查询中..." : "查询 DM";
}

async function renderDmLookupResult(payload) {
  const enrichedPayload = await enrichDmLookupWithLocalIssuer(payload);
  dmLastPayload = enrichedPayload;
  $("#dmLookupCopyButton").disabled = false;

  const ok = Boolean(enrichedPayload?.ok);
  const statusParts = [
    ok ? "查询成功" : enrichedPayload?.noResult ? "无结果" : "查询失败",
    enrichedPayload?.httpStatus ? `HTTP ${enrichedPayload.httpStatus}` : "",
    Number.isFinite(enrichedPayload?.elapsedMs) ? `${enrichedPayload.elapsedMs}ms` : "",
  ].filter(Boolean);
  $("#dmLookupStatus").textContent = statusParts.join(" · ");
  $("#dmLookupStatus").className = `status-badge ${ok ? "" : "warning"}`;

  renderDmNormalized(enrichedPayload || null);
  renderDmIssueGroup(enrichedPayload?.issueGroup || enrichedPayload?.normalized?.issueGroup || null);
  renderDmDiagnostic(enrichedPayload);
  renderDmCandidates(enrichedPayload?.fieldCandidates || []);
  $("#dmRawOutput").textContent = JSON.stringify(enrichedPayload, null, 2);
}

async function enrichDmLookupWithLocalIssuer(payload) {
  const normalized = payload?.normalized;
  if (!payload?.ok || !normalized) return payload;
  if (normalized.subjectRating && normalized.ratingAgency && normalized.impliedRating) return payload;

  const localRating = findLocalRatingForDmNormalized(normalized) || await findCloudRatingForDmNormalized(normalized);
  if (!localRating) return payload;

  const nextNormalized = { ...normalized };
  const ratingSource = { ...(nextNormalized.ratingSource || {}) };
  let changed = false;
  if (!nextNormalized.subjectRating && localRating.subjectRating) {
    nextNormalized.subjectRating = localRating.subjectRating;
    ratingSource.subjectRating = "local-issuer-db";
    changed = true;
  }
  if (!nextNormalized.ratingAgency && localRating.ratingAgency) {
    nextNormalized.ratingAgency = localRating.ratingAgency;
    ratingSource.ratingAgency = "local-issuer-db";
    changed = true;
  }
  if (!nextNormalized.impliedRating && localRating.hiddenRating) {
    nextNormalized.impliedRating = localRating.hiddenRating;
    ratingSource.impliedRating = "local-issuer-db";
    changed = true;
  }
  if (!changed) return payload;

  nextNormalized.ratingSource = ratingSource;
  return {
    ...payload,
    normalized: nextNormalized,
    diagnostic: {
      ...(payload.diagnostic || {}),
      localIssuerRating: {
        matchedIssuer: localRating.legalName || "",
        matchedRecordType: localRating.recordType || "",
        filled: Object.keys(ratingSource).filter((key) => ratingSource[key] === "local-issuer-db"),
      },
    },
  };
}

function findLocalRatingForDmNormalized(normalized) {
  return findProjectRatingForDmNormalized(normalized) || findIssuerForDmNormalized(normalized);
}

async function findCloudRatingForDmNormalized(normalized) {
  try {
    const response = await fetch(API_URL, { cache: "no-store", credentials: "same-origin", headers: authHeaders() });
    if (!response.ok) return null;
    const remote = await response.json();
    if (!remote.data?.issuers) return null;
    state = normalizeLoadedState(remote.data);
    persistLocal();
    return findLocalRatingForDmNormalized(normalized);
  } catch {
    return null;
  }
}

function findProjectRatingForDmNormalized(normalized) {
  const querySecurityId = normalizeDmSecurityId(normalized.securityId);
  const queryNames = [normalized.shortName, normalized.fullName].filter(Boolean);
  const issuerTargets = [normalized.issuerName, normalized.fullName].filter(Boolean);
  let best = null;
  for (const projectRecord of state.projects || []) {
    const ratingFields = projectDmRatingFields(projectRecord);
    if (!ratingFields.subjectRating && !ratingFields.ratingAgency && !ratingFields.hiddenRating) continue;
    const codeScore = querySecurityId && projectDmSecurityIds(projectRecord).some((value) => normalizeDmSecurityId(value) === querySecurityId) ? 120 : 0;
    const nameScore = projectDmShortNames(projectRecord).reduce((score, name) => {
      const normalizedName = normalizeDmIssuerMatchText(name);
      const coreName = dmIssuerCoreMatchText(name);
      const matched = queryNames.reduce((innerScore, target) => Math.max(
        innerScore,
        dmIssuerMatchScore(normalizedName, normalizeDmIssuerMatchText(target), coreName, dmIssuerCoreMatchText(target)),
      ), 0);
      return Math.max(score, matched);
    }, 0);
    const issuerScore = [projectRecord.issuerName].filter(Boolean).reduce((score, name) => {
      const normalizedName = normalizeDmIssuerMatchText(name);
      const coreName = dmIssuerCoreMatchText(name);
      const matched = issuerTargets.reduce((innerScore, target) => Math.max(
        innerScore,
        dmIssuerMatchScore(normalizedName, normalizeDmIssuerMatchText(target), coreName, dmIssuerCoreMatchText(target)),
      ), 0);
      return Math.max(score, matched);
    }, 0);
    const score = Math.max(codeScore, nameScore, issuerScore > 0 ? issuerScore - 20 : 0);
    if (score > (best?.score || 0)) best = { projectRecord, ratingFields, score };
  }
  return best?.projectRecord ? {
    legalName: best.projectRecord.issuerName || "",
    subjectRating: best.ratingFields.subjectRating || "",
    ratingAgency: best.ratingFields.ratingAgency || "",
    hiddenRating: best.ratingFields.hiddenRating || "",
    recordType: "project",
  } : null;
}

function projectDmRatingFields(projectRecord) {
  const parsed = parseProjectDmRatingText(`${projectRecord?.sourceText || ""}\n${projectRecord?.opinion || ""}\n${projectRecord?.notes || ""}`);
  return {
    subjectRating: String(projectRecord?.subjectRating || parsed.subjectRating || "").trim().toUpperCase(),
    ratingAgency: String(projectRecord?.ratingAgency || parsed.ratingAgency || "").trim(),
    hiddenRating: String(projectRecord?.hiddenRating || parsed.hiddenRating || "").trim().toUpperCase(),
  };
}

function parseProjectDmRatingText(text = "") {
  const value = String(text || "");
  const ratingPattern = "(AAA|AA\\+|AA\\(2\\)|AA-|AA|A\\+|A-|A|BBB\\+|BBB-|BBB|BB\\+|BB-|BB|B\\+|B-|B)";
  const compact = value.match(new RegExp(`${ratingPattern}\\s*[（(]\\s*([^）)\\n]+?)\\s*[）)]\\s*[/／]\\s*隐含\\s*${ratingPattern}`, "i"));
  if (compact) {
    return {
      subjectRating: compact[1].toUpperCase(),
      ratingAgency: compact[2].trim(),
      hiddenRating: compact[3].toUpperCase(),
    };
  }
  const subject = value.match(new RegExp(`主体(?:信用)?评级(?:为|[:：\\s])*${ratingPattern}(?:\\s*[（(]\\s*([^）)\\n]+?)\\s*[）)])?`, "i"));
  const agency = value.match(/评级机构(?:为|[:：\s])*([^\s,，;；/／。]+)/);
  const hidden = value.match(new RegExp(`(?:隐含|市场隐含评级)(?:评级)?(?:为|[:：\\s])*${ratingPattern}`, "i"));
  return {
    subjectRating: subject?.[1]?.toUpperCase() || "",
    ratingAgency: subject?.[2]?.trim() || agency?.[1]?.trim() || "",
    hiddenRating: hidden?.[1]?.toUpperCase() || "",
  };
}

function findIssuerForDmNormalized(normalized) {
  const targets = [normalized.issuerName, normalized.fullName, normalized.shortName].filter(Boolean);
  for (const target of targets) {
    const issuer = findIssuer(String(target), state.issuers || []);
    if (issuer) return issuer;
  }
  return findIssuerForDmByCoreName(targets);
}

function findIssuerForDmByCoreName(targets) {
  let best = null;
  for (const issuer of state.issuers || []) {
    const names = [issuer.legalName, ...(issuer.aliases || [])].filter(Boolean);
    for (const name of names) {
      const normalizedName = normalizeDmIssuerMatchText(name);
      const coreName = dmIssuerCoreMatchText(name);
      for (const target of targets) {
        const normalizedTarget = normalizeDmIssuerMatchText(target);
        const coreTarget = dmIssuerCoreMatchText(target);
        const score = dmIssuerMatchScore(normalizedName, normalizedTarget, coreName, coreTarget);
        if (score > (best?.score || 0)) best = { issuer, score };
      }
    }
  }
  return best?.issuer || null;
}

function dmIssuerMatchScore(name, target, coreName, coreTarget) {
  if (!name || !target) return 0;
  if (name === target) return 100 + name.length;
  if (name.length >= 4 && target.includes(name)) return 80 + name.length;
  if (target.length >= 4 && name.includes(target)) return 60 + target.length;
  if (coreName && coreTarget) {
    if (coreName === coreTarget) return 90 + coreName.length;
    if (coreName.length >= 4 && coreTarget.includes(coreName)) return 70 + coreName.length;
    if (coreTarget.length >= 4 && coreName.includes(coreTarget)) return 50 + coreTarget.length;
  }
  return 0;
}

function normalizeDmIssuerMatchText(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]{}]/g, "")
    .toUpperCase();
}

function dmIssuerCoreMatchText(value = "") {
  let text = normalizeDmIssuerMatchText(value);
  const suffixes = ["股份有限公司", "有限责任公司", "责任有限公司", "集团有限公司", "有限公司", "股份公司", "集团公司", "控股公司", "公司"];
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (text.endsWith(suffix) && text.length - suffix.length >= 4) {
        text = text.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return text;
}

function normalizeDmSecurityId(value = "") {
  return String(value || "").trim().toUpperCase();
}

function projectDmSecurityIds(projectRecord) {
  return [
    projectRecord.securityId,
    projectRecord.security_id,
    projectRecord.bondCode,
    projectRecord.code,
    ...(projectRecord.tranches || []).flatMap((tranche) => [tranche.securityId, tranche.security_id, tranche.bondCode, tranche.code]),
  ].filter(Boolean);
}

function projectDmShortNames(projectRecord) {
  return [
    projectRecord.shortName,
    ...(projectRecord.shortNames || []),
    ...(projectRecord.tranches || []).map((tranche) => tranche.shortName),
  ].filter(Boolean);
}

const DM_RATING_SOURCE_FIELDS = new Set(["subjectRating", "ratingAgency", "impliedRating"]);

function dmNormalizedSourceBadge(normalized, key, isMissing) {
  if (isMissing || !DM_RATING_SOURCE_FIELDS.has(key)) return null;
  const source = normalized?.ratingSource?.[key] || "";
  const isCloudDb = source === "issuer-db" || source === "local-issuer-db";
  return {
    label: isCloudDb ? "云端数据库" : "DM",
    className: isCloudDb ? "cloud" : "dm",
  };
}

function renderDmNormalized(payload) {
  const fields = [
    ["securityId", "债券代码"],
    ["instrumentType", "项目类型"],
    ["shortName", "债券简称"],
    ["fullName", "债券全称"],
    ["issuerName", "发行人"],
    ["durationText", "期限"],
    ["durationSource", "期限来源"],
    ["specialItem", "特殊条款"],
    ["nextOptionDate", "下一行权日"],
    ["issueScaleYi", "规模（亿）"],
    ["inquiryRange", "询价区间"],
    ["venue", "发行场所"],
    ["offeringType", "发行方式"],
    ["leadUnderwriter", "主承销商"],
    ["sponsorStatus", "我行主承身份"],
    ["subjectRating", "主体评级"],
    ["ratingAgency", "评级机构"],
    ["impliedRating", "市场隐含评级"],
    ["subscribeDate", "簿记日期"],
    ["subscribeTime", "簿记时间"],
    ["paymentDate", "缴款日"],
    ["absInfo", "ABS/ABN要素"],
  ];
  if (!payload) {
    $("#dmNormalizedOutput").innerHTML = `<div class="empty">暂无结构化字段。</div>`;
    return;
  }
  if (payload.noResult) {
    renderDmNoResult(payload);
    return;
  }
  const normalized = payload.normalized || payload;
  if (!normalized) {
    $("#dmNormalizedOutput").innerHTML = `<div class="empty">暂无结构化字段。</div>`;
    return;
  }
  $("#dmNormalizedOutput").innerHTML = fields.map(([key, label]) => {
    const value = normalized[key];
    const isMissing = value === null || value === undefined || value === "";
    const text = isMissing ? "未返回" : formatDmNormalizedFieldValue(key, value);
    const sourceBadge = dmNormalizedSourceBadge(normalized, key, isMissing);
    return `
      <div class="dm-normalized-item ${isMissing ? "empty-field" : ""} ${sourceBadge?.className === "cloud" ? "source-cloud" : ""}">
        <div class="dm-normalized-label">
          <span>${escapeHtml(label)}</span>
          ${sourceBadge ? `<small class="dm-source-badge ${escapeAttribute(sourceBadge.className)}">${escapeHtml(sourceBadge.label)}</small>` : ""}
        </div>
        <strong>${escapeHtml(text)}</strong>
      </div>
    `;
  }).join("");
}

function formatDmNormalizedFieldValue(key, value) {
  if (key === "durationSource") {
    return {
      bond_matu: "基础资料：债券期限",
      special_item: "基础资料：特殊条款",
      next_option_date: "基础资料：下一行权日",
      bond_issue_tenor: "发行数据：发行期限",
    }[value] || String(value);
  }
  if (key === "absInfo" && value && typeof value === "object") {
    const facts = [
      value.planName,
      Number.isFinite(numberOrNull(value.totalScale)) ? `规模${formatNumber(value.totalScale)}亿` : "",
      value.underlyingAsset ? `基础资产：${value.underlyingAsset}` : "",
      value.creditEnhancementParty ? `${value.creditEnhancementType || "增信"}：${value.creditEnhancementParty}` : "",
    ].filter(Boolean);
    return facts.join(" · ") || JSON.stringify(value);
  }
  return String(value);
}

function renderDmNoResult(payload) {
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  $("#dmNormalizedOutput").innerHTML = `
    <div class="dm-no-result">
      <strong>${escapeHtml(payload?.error || "未查询到匹配债券")}</strong>
      <p>${escapeHtml(payload?.hint || "请确认债券简称、债券代码或查询日期窗口。")}</p>
      ${suggestions.length ? `
        <div class="dm-suggestion-list">
          ${suggestions.map(renderDmSuggestion).join("")}
        </div>
      ` : `<small>暂无相近候选。</small>`}
    </div>
  `;
}

function renderDmSuggestion(item) {
  const query = item.shortName || item.securityId || "";
  const facts = [
    item.matchReason || "",
    item.securityId ? `代码 ${item.securityId}` : "",
    item.issuerName || "",
    item.tenor ? `期限 ${item.tenor}` : "",
    Number.isFinite(numberOrNull(item.issueScaleYi)) ? `规模 ${formatNumber(item.issueScaleYi)}亿` : "",
    item.inquiryRange ? `区间 ${item.inquiryRange}` : "",
    item.subscribeDate ? `日期 ${item.subscribeDate}` : "",
    item.issueStatus || "",
  ].filter(Boolean);
  return `
    <button class="dm-suggestion-card" type="button" data-dm-suggestion-query="${escapeAttribute(query)}" aria-label="查询 ${escapeAttribute(query || "该候选")}">
      <span>${escapeHtml(item.shortName || item.securityId || "未命名候选")}</span>
      <small>${escapeHtml(facts.join(" · ") || "点击使用该候选继续查询")}</small>
    </button>
  `;
}

function renderDmIssueGroup(issueGroup) {
  const panel = $("#dmIssueGroupPanel");
  const output = $("#dmIssueGroupOutput");
  const summary = $("#dmIssueGroupSummary");
  const tranches = Array.isArray(issueGroup?.tranches) ? issueGroup.tranches : [];
  if (!issueGroup || tranches.length < 2) {
    panel.hidden = true;
    summary.textContent = "未识别";
    output.innerHTML = "";
    return;
  }
  panel.hidden = false;
  const sourceLabel = dmIssueGroupSourceLabel(issueGroup.source);
  const abs = /^(ABS|ABN)$/i.test(String(issueGroup.instrumentType || ""));
  const confirmedReallocatedCount = tranches.filter((tranche) => tranche.status === "reallocated" && (tranche.reallocationTargetShortName || tranche.reallocationTargetSecurityId)).length;
  const uncertainReallocatedCount = tranches.filter((tranche) => tranche.status === "reallocated" && !tranche.reallocationTargetShortName && !tranche.reallocationTargetSecurityId).length;
  summary.textContent = [
    `${tranches.length} 个${abs ? "分档" : "期限"}`,
    sourceLabel,
    confirmedReallocatedCount ? `${confirmedReallocatedCount} 个已回拨` : "",
    uncertainReallocatedCount ? `${uncertainReallocatedCount} 个待确认回拨` : "",
  ].filter(Boolean).join(" · ");
  output.innerHTML = tranches.map((tranche) => {
    const status = dmIssueTrancheStatusMeta(tranche);
    const targetQuery = tranche.reallocationTargetShortName || tranche.reallocationTargetSecurityId || "";
    const queryValue = (tranche.status === "reallocated" && targetQuery) ? targetQuery : (tranche.shortName || tranche.securityId || "");
    const facts = [
      tranche.trancheLevel ? `级别 ${tranche.trancheLevel}` : "",
      tranche.tenor ? `期限 ${tranche.tenor}` : "",
      Number.isFinite(numberOrNull(tranche.planScale)) ? `计划 ${formatNumber(tranche.planScale)}亿` : "",
      Number.isFinite(numberOrNull(tranche.actualScale)) ? `发行 ${formatNumber(tranche.actualScale)}亿` : "",
      Number.isFinite(numberOrNull(tranche.sharePct)) ? `占比 ${formatNumber(tranche.sharePct)}%` : "",
      tranche.expectedMaturityDate ? `预期到期 ${tranche.expectedMaturityDate}` : "",
      tranche.debtRating ? `债项 ${tranche.debtRating}${tranche.debtRatingAgency ? `(${tranche.debtRatingAgency})` : ""}` : "",
      tranche.inquiryRange ? `区间 ${tranche.inquiryRange}` : "",
      Number.isFinite(numberOrNull(tranche.couponRate)) ? `票面 ${formatNumber(tranche.couponRate)}%` : "",
      tranche.securityId ? `代码 ${tranche.securityId}` : "",
    ].filter(Boolean);
    return `
      <article class="dm-issue-tranche ${tranche.isQueriedInput ? "queried" : ""} ${tranche.status === "reallocated" ? "attention" : ""}" role="button" tabindex="0" data-dm-issue-query="${escapeAttribute(queryValue)}" aria-label="查询 ${escapeAttribute(queryValue || "该品种")}">
        <div class="dm-issue-tranche-head">
          <strong>${escapeHtml(tranche.shortName || "未命名品种")}</strong>
          <span class="status-badge ${status.className}">${escapeHtml(status.label)}</span>
        </div>
        <div class="dm-issue-tranche-tags">
          ${tranche.isQueriedInput ? `<span>当前查询</span>` : ""}
          ${tranche.isDmMatched ? `<span>DM命中</span>` : ""}
          <span>${escapeHtml(dmIssueGroupSourceLabel(tranche.source))}</span>
        </div>
        <p>${facts.length ? escapeHtml(facts.join(" · ")) : "暂无结构化发行要素"}</p>
        ${renderDmReallocationReason(tranche)}
      </article>
    `;
  }).join("");
}

function renderDmReallocationReason(tranche) {
  const target = tranche?.reallocationTargetShortName || tranche?.reallocationTargetSecurityId || "";
  if (tranche?.status === "reallocated" && target) {
    return `
      <small class="dm-reallocation-note">
        <span>本期债券已全部回拨至${escapeHtml(target)}，请点击</span>
        <button class="dm-reallocation-target" type="button" data-dm-issue-query="${escapeAttribute(target)}">${escapeHtml(target)}</button>
        <span>查看详情</span>
      </small>
    `;
  }
  return tranche?.statusReason ? `<small>${escapeHtml(tranche.statusReason)}</small>` : "";
}

function dmIssueTrancheStatusMeta(trancheOrStatus) {
  const status = typeof trancheOrStatus === "string" ? trancheOrStatus : trancheOrStatus?.status;
  if (status === "issued") return { label: "已发行", className: "" };
  if (status === "reallocated") {
    return {
      label: (trancheOrStatus?.reallocationTargetShortName || trancheOrStatus?.reallocationTargetSecurityId) ? "已回拨" : "待确认回拨",
      className: "warning",
    };
  }
  return { label: "待确认", className: "muted" };
}

function dmIssueGroupSourceLabel(source) {
  if (source === "cloud-db") return "云端数据库";
  if (source === "dm") return "DM";
  if (source === "mixed") return "DM+云端数据库";
  if (source === "inferred") return "推断";
  return "未知来源";
}

function renderDmDiagnostic(payload) {
  const diagnostic = payload?.diagnostic || null;
  if (!payload) {
    $("#dmDiagnosticOutput").textContent = "暂无诊断。";
    return;
  }
  const summary = {
    ok: payload.ok,
    error: payload.error || "",
    hint: payload.hint || "",
    diagnostic,
  };
  $("#dmDiagnosticOutput").textContent = JSON.stringify(summary, null, 2);
}

function renderDmCandidates(candidates) {
  $("#dmCandidateCount").textContent = `${candidates.length} 项`;
  if (!candidates.length) {
    $("#dmCandidateOutput").innerHTML = `<div class="empty">暂无候选字段。</div>`;
    return;
  }
  $("#dmCandidateOutput").innerHTML = candidates.slice(0, 120).map((item) => `
    <div class="dm-candidate-item">
      <span>${escapeHtml(item.key || "")}</span>
      <strong>${escapeHtml(formatDmCandidateValue(item.value))}</strong>
    </div>
  `).join("");
}

function formatDmCandidateValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function looksLikeSecurityId(value) {
  return /^\d{6,9}\.(IB|SH|SZ)$/i.test(String(value || "").trim());
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
        <label>联动分行<input data-review-field="defaultBranch" value="${escapeAttribute(draft.defaultBranch)}"></label>
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
    defaultBranch: issuer?.linkedBranch || issuer?.defaultBranch || projectValue?.branch || "",
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
  const labels = { "": "待选择", "公募": "公开发行 / 公募", "私募": "非公开发行 / 私募" };
  return ["", "公募", "私募"].map((value) =>
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
  return issuerFromDraft(readIssuerDraftInput(prefix));
}

function readIssuerDraftInput(prefix) {
  return {
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
  };
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
    .filter((issuer) => `${issuer.legalName} ${(issuer.aliases || []).join(" ")} ${issuer.linkedBranch || issuer.defaultBranch || ""}`.toLowerCase().includes(query))
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
  const branch = issuer.linkedBranch || issuer.defaultBranch || "";
  return `${branch ? `联动${branch} / ` : ""}${rating} / 隐含${issuer.hiddenRating || "待补"}`;
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
  $("#defaultBranch").value = issuer.linkedBranch || issuer.defaultBranch || "";
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

function getCurrentUser() {
  return currentGatewayUser;
}

function setCurrentUser(user) {
  currentGatewayUser = user?.username ? user : null;
}

function clearAuthSession() {
  currentGatewayUser = null;
  updateAuthUi();
}

function updateAuthUi() {
  const user = getCurrentUser();
  const welcomeLine = $("#welcomeLine");
  const welcomeNickname = $("#welcomeNickname");
  if (welcomeLine) welcomeLine.hidden = !user;
  if (welcomeNickname) welcomeNickname.textContent = user?.nickname || user?.username || "";
}

async function loadCloudState() {
  setSyncStatus("正在连接", isLocalApiMode() ? "尝试读取本地 D1" : "尝试读取 Cloudflare D1");
  setCloudGate(true, {
    state: "connecting",
    title: isLocalApiMode() ? "正在连接本地 D1" : "正在连接 Cloudflare D1",
    detail: isLocalApiMode() ? "正在读取本地开发数据库。" : "正在校验登录状态并读取云端资料库。",
  });
  try {
    const response = await fetch(API_URL, { cache: "no-store", credentials: "same-origin", headers: authHeaders() });
    if (!response.ok) {
      if (response.status === 401) {
        clearAuthSession();
        redirectToGatewayLogin();
        setSyncStatus("未登录", "请先登录管理员账号");
        setCloudGate(true, {
          state: "idle",
          title: "请先登录",
          detail: "登录后即可读取云端资料库，并进入项目中心各个子界面。",
        });
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const remote = await response.json();
    const shouldMigrateFtpCurve = ftpCurveNeedsMigration(remote.data?.ftpCurve);
    const shouldMigrateIssuerBranch = issuerBranchNeedsMigration(remote.data);
    if (remote.data?.issuers) {
      state = normalizeLoadedState(remote.data);
    }
    if (remote.user) {
      setCurrentUser(remote.user);
      updateAuthUi();
    }
    cloudAvailable = true;
    persistLocal();
    setSyncStatus(isLocalApiMode() ? "本地 D1 已连接" : "D1 已连接", `${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目`);
    setCloudGate(true, {
      state: "success",
      title: isLocalApiMode() ? "本地 D1 连接成功" : "D1 连接成功",
      detail: `已载入 ${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目。`,
    });
    window.setTimeout(() => setCloudGate(false, { state: "success" }), 850);
    if (shouldMigrateFtpCurve || shouldMigrateIssuerBranch) await saveCloudState();
  } catch {
    cloudAvailable = false;
    setSyncStatus(isLocalApiMode() ? "本地 D1 未连接" : "D1 未连接", isLocalApiMode() ? "请确认本地 wrangler 正在运行" : "请检查登录状态或重新登录");
    setCloudGate(true, {
      state: "error",
      title: isLocalApiMode() ? "本地 D1 连接失败" : "D1 连接失败",
      detail: isLocalApiMode() ? "请确认 npm run dev:local 仍在运行。" : "D1 暂时无法连接。请在下方重新登录或稍后再试。",
    });
  }
  renderIssuerOptions();
  renderIssuerList();
  renderFtpCurveForm();
  renderProjectWorkspace();
  renderProtocolTransferWorkspace();
  renderSecondaryInventoryWorkspace();
  renderUnifiedReminders();
  if (batchItems.length) renderBatchResults();
}

async function saveCloudState() {
  persistLocal();
  try {
    const response = await fetch(API_URL, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ data: state }),
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearAuthSession();
        redirectToGatewayLogin();
      }
      throw new Error(`HTTP ${response.status}`);
    }
    cloudAvailable = true;
    setSyncStatus(isLocalApiMode() ? "本地 D1 已同步" : "D1 已同步", `${state.issuers.length} 个主体 / ${(state.projects || []).length} 个项目`);
    setCloudGate(false, { state: "success" });
    return true;
  } catch {
    cloudAvailable = false;
    setSyncStatus("D1 同步失败", "请检查网络或登录状态");
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
    secondaryInventoryPositions: normalizeSecondaryInventoryPositions(value.secondaryInventoryPositions || []),
    secondaryOrders: normalizeSecondaryOrders(value.secondaryOrders || []),
    secondaryTrades: normalizeSecondaryTrades(value.secondaryTrades || []),
    reminderState: normalizeReminderState(value.reminderState),
  };
}

function issuerBranchNeedsMigration(data = {}) {
  return (data.issuers || []).some((issuer) =>
    issuer?.legalName
    && !String(issuer.linkedBranch || "").trim()
    && String(issuer.defaultBranch || issuer.branch || "").trim(),
  );
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
  const gatewayLoginLink = $("#gatewayLoginLink");
  if (gatewayLoginLink) gatewayLoginLink.hidden = !locked || isLocalApiMode() || stateName === "success" || stateName === "connecting";
  if (config.title) $("#cloudGateTitle").textContent = config.title;
  if (config.detail) $("#cloudGateDetail").textContent = config.detail;
  $("#cloudGateStep").textContent = stateName === "error" ? "ERR" : stateName === "success" ? "OK" : stateName === "connecting" ? "WAIT" : "LOGIN";
  $("#cloudGateSymbol").textContent = stateName === "error" ? "!" : stateName === "success" ? "✓" : stateName === "connecting" ? "..." : "T7";
}

function authHeaders() {
  return {};
}

function isLocalApiMode() {
  return LOCAL_HOSTS.has(location.hostname);
}

function redirectToGatewayLogin() {
  if (isLocalApiMode()) return;
  location.assign("https://tempest07.com/login/?next=%2Fbond-centre%2F");
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
