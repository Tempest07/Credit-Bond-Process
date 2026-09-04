import {
  ABS_CREDIT_CODE,
  ABS_CREDIT_SCOPE_PROJECT,
  ABS_CREDIT_SCOPE_SHELF,
  DEFAULT_STATE,
  ORDINARY_CREDIT_CODE,
  absCreditApprovalAppliesToProject,
  applicableAbsCreditApprovals,
  applyAbsCreditApproval,
  applyIssuerCommonFields,
  buildBondFullName,
  buildUnderwriter,
  calculateAbsTrancheSharePct,
  compactSelectedAbsShortNames,
  durationParts,
  durationToDays,
  findIssuer,
  formatNumber,
  formatProjectValuationSummary,
  generateOpinion,
  inferAbsClassNameFromShortName,
  isAbsProject,
  mergeImportedIssuers,
  normalizeAbsCreditApproval,
  normalizeBondFullNameForProject,
  normalizeGuaranteeInfo,
  normalizeIssuer,
  normalizeRatingAgency,
  parseProjectBrief,
  removeAbsCreditApproval,
  replaceProjectWithDmLookup,
  splitProjectBriefs,
  linkAbsCreditApprovalToProject,
  upsertAbsCreditApproval,
  upsertIssuer,
} from "./core.js?v=20260904-bond-name-wrap";
import {
  FTP_TENORS,
  PROJECT_STATUS_OPTIONS,
  appendBidSubmission,
  applyGuidancePricing,
  applySemanticIssuanceResult,
  buildAwardResultText,
  buildBidPositionText,
  buildPrepaymentNumber,
  calculateFtpForDuration,
  createProjectRecord,
  dashboardCounts,
  deriveProjectStatus,
  finalizeProjectBid,
  hasUnsubmittedBidChanges,
  normalizeProjectRecord,
  projectCardBidSummary,
  projectMatchesDateFilter,
  projectMatchesStatusFilter,
  removeProject,
  reopenProjectBid,
  resolveNewProjectCutoff,
  suggestProjectCutoff,
  trancheNeedsPayment,
  updateProjectCutoff,
  upsertProject,
} from "./lifecycle.js?v=20260904-bond-name-wrap";
import { ISSUANCE_FIELDS, ISSUANCE_OUTCOMES, validateRecognitionRequest } from "./issuance-recognition.js?v=20260904-bond-name-wrap";
import { createSequentialIssuanceQueue, ISSUANCE_QUEUE_STATUS } from "./issuance-queue.js?v=20260904-bond-name-wrap";
import {
  deriveIssuerAlias,
  extractIssuerLegalName,
  parseCreditText,
  parseHistoryText,
} from "./history-parser.js?v=20260904-bond-name-wrap";
import {
  buildProtocolTransferLedgerRows,
  excelDateSerialFromLocalDate,
  markProtocolTransferStep,
  nextProtocolTransferStep,
  normalizeProtocolTransfer,
  normalizeProtocolTransfers,
  parseProtocolTransferText,
  parseProtocolTransferTradeDate,
  protocolTransferApplicationParties,
  protocolTransferFromSecondaryTrade,
  protocolTransferStatus,
  protocolTransferTodos,
  removeProtocolTransfer,
  setProtocolTransferStep,
  upsertProtocolTransfer,
} from "./protocol-transfer.js?v=20260904-bond-name-wrap";
import {
  BUILTIN_PROTOCOL_TRANSFER_TEMPLATES,
  matchProtocolTransferTemplate,
  protocolTransferTemplateById,
} from "./protocol-transfer-templates.js?v=20260904-bond-name-wrap";
import {
  extractProtocolTransferTemplateMetadata,
  patchProtocolTransferDocumentXml,
  protocolTransferApplicationFilename,
  validateProtocolTransferApplication,
} from "./protocol-transfer-docx.js?v=20260904-bond-name-wrap";
import {
  buildUnifiedReminders,
  markDailyMailSent,
  normalizeReminderState,
} from "./reminders.js?v=20260904-bond-name-wrap";
import {
  applySecondaryPendingDraftRows,
  applyCodeMappingText,
  buildSecondaryOfferListText,
  buildPrimaryAwardTrades,
  calculateShadowInventory,
  formatAmountWan,
  markSecondaryOrderStatus,
  markSecondaryTradeFrontOffice,
  markSecondaryTradesLedgerSent,
  normalizeSecondaryInventoryPositions,
  normalizeSecondaryOrders,
  normalizeSecondaryTrades,
  parseInventoryLedgerRows,
  parseInventorySnapshotText,
  parseSecondaryOrderText,
  parseSecondaryTradeIntake,
  pendingCodeTrades,
  pendingSecondaryTrades,
  positionKey,
  removeSecondaryTrade,
  secondaryTradeMissingFields,
  secondaryTradesForLedger,
  updateSecondaryPendingTrade,
  upsertInventoryPositions,
  upsertSecondaryOrders,
  upsertSecondaryTrades,
} from "./secondary-inventory.js?v=20260904-bond-name-wrap";
import {
  TRADE_RECORD_COLUMNS,
  TRADE_RECORD_FORMULA_COLUMNS,
} from "./trade-record-converter.js?v=20260904-bond-name-wrap";
import {
  cloneTradeRecordDraftRows,
  createTradeRecordDraftRows,
  mergeTradeRecordDmResults,
  pasteTradeRecordDraftCells,
  isTradeRecordCellValueValid,
  tradeRecordDirtyCellCount,
  tradeRecordDmRequestRows,
  updateTradeRecordDraftCell,
  validateTradeRecordDraftRows,
} from "./trade-record-grid.js?v=20260904-bond-name-wrap";
import {
  applyTradeRecordRowsToState,
  buildTradeRecordRows,
  buildTradeRecordTableText,
} from "./trade-record-ledger.js?v=20260904-bond-name-wrap";
import { initializeDatePickers } from "./date-picker.js?v=20260904-bond-name-wrap";
import { initializeRealtimeQuotes } from "./realtime-quotes.js?v=20260904-bond-name-wrap";
import {
  PROJECT_SCREENSHOT_BRANCHES,
  cleanProjectScreenshotBondFullName,
  collapseProjectScreenshotRowsWithVerifiedMatches,
  groupProjectScreenshotOcrPhysicalRows,
  mergeProjectScreenshotOcrPasses,
  parseProjectScreenshotOcrText,
  selectReliableProjectScreenshotSuggestion,
} from "./project-screenshot-ocr.js?v=20260904-bond-name-wrap";
import {
  buildProjectScreenshotAnalysisTiles,
  detectProjectScreenshotKeyColumns,
  projectScreenshotLineCoverageMatches,
} from "./project-screenshot-layout.js?v=20260904-bond-name-wrap";
import {
  inspectProjectScreenshotImageHeader,
  projectScreenshotCompositeBackground,
  projectScreenshotResizeDimensions,
  projectScreenshotResizeRetainsReadableWidth,
} from "./project-screenshot-image.js?v=20260904-bond-name-wrap";
import {
  buildPaymentReceiptOriginalFileTree,
  normalizePaymentReceiptPageGroups,
} from "./payment-receipts.js?v=20260904-bond-name-wrap";
import {
  buildIssuerSearchIndex,
  searchIssuerIndex,
} from "./issuer-search.js?v=20260904-bond-name-wrap";
import {
  formatStateChangeSummary,
  statePayloadEquals,
} from "./state-history.js?v=20260904-bond-name-wrap";

const LOCAL_KEY = "credit-bond-process-state-v1";
const CLIENT_ID_KEY = "credit-bond-process-client-id-v1";
const LOCAL_CACHE_VERSION = 2;
const PROJECT_DM_HISTORY_KEY = "credit-bond-process-project-dm-history-v1";
const PROJECT_DM_HISTORY_LIMIT = 12;
const ISSUER_PICKER_RESULT_LIMIT = 40;
const NEW_PROJECT_CUTOFF_MODES = new Set(["auto", "today", "next-business-day"]);
const POLICY_CURVE_TERMS = ["0.1Y", "0.2Y", "0.25Y", "0.3Y", "0.4Y", "0.5Y", "0.6Y", "0.7Y", "0.75Y", "0.8Y", "0.9Y", "1Y", "3Y", "5Y"];
const POLICY_CURVE_KEY_TERMS = new Set(["0.1Y", "0.25Y", "0.3Y", "0.5Y", "0.75Y", "1Y", "3Y", "5Y"]);
const API_URL = "./api/state";
const STATE_HISTORY_URL = "./api/state-history";
const PAYMENT_RECEIPTS_URL = "./api/payment-receipts";
const PAYMENT_RECEIPT_COVERAGE_URL = "./api/payment-receipt-coverage";
const DM_VALUATION_URL = "./api/dm/valuation";
const DM_TRADE_RECORDS_URL = "./api/dm/trade-records";
const DM_POLICY_CURVE_URL = "./api/dm/curve?curve=cdb";
const MAILER_URL = "./api/mail/today";
const SECONDARY_MAILER_URL = "./api/mail/secondary-ledger";
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const PDFJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const EXCELJS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
const PROTOCOL_TRANSFER_TEMPLATE_URL = "./templates/protocol-transfer-ledger-template.xlsx";
const PROTOCOL_TRANSFER_TEMPLATE_DB = "tempest07-protocol-transfer-templates";
const PROTOCOL_TRANSFER_TEMPLATE_STORE = "templates";
const PROJECT_SCREENSHOT_MIN_OCR_WIDTH = 2600;
const PROJECT_SCREENSHOT_ROW_GAP = 18;
const PROJECT_SCREENSHOT_MAX_FILE_BYTES = 30 * 1024 * 1024;
const PROJECT_SCREENSHOT_IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff",
  "image/heic", "image/heif", "image/avif",
]);
const PROJECT_SCREENSHOT_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;
const IDLE_WARNING_AFTER_MS = 15 * 60 * 1000;
const IDLE_EXIT_COUNTDOWN_SECONDS = 60;
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

const initialLocalCache = loadLocalState();
let state = initialLocalCache.data;
let localStateDirty = initialLocalCache.dirty;
let localBaseRevision = initialLocalCache.baseRevision;
let localChangeGeneration = localStateDirty ? 1 : 0;
let localDirtyAt = initialLocalCache.dirtyAt;
let cloudRevision = Number.isInteger(localBaseRevision) ? localBaseRevision : 0;
let cloudUpdatedAt = null;
let syncConflictActive = false;
let activeStateSnapshotId = "";
let stateHistoryEntries = [];
let stateHistorySelectedId = "";
let stateHistorySelectedSnapshot = null;
let stateHistoryTrigger = null;
let idleLastActivityAt = Date.now();
let idleWarningTimer = null;
let idleCountdownTimer = null;
let idleCountdownRemaining = IDLE_EXIT_COUNTDOWN_SECONDS;
let idleExitInProgress = false;
let bondActivityChannel = null;
const stateClientId = loadStateClientId();
let project = parseProjectBrief("");
let newProjectCutoffMode = "auto";
let newProjectCutoffPreview = null;
let selectedIssuerId = "";
let databaseCreditModule = "";
let issuerSearchEntries = [];
let issuerPickerVisibleEntries = [];
let issuerPickerActiveIndex = -1;
let issuerPickerOpen = false;
let cloudAvailable = false;
let currentGatewayUser = null;
let pendingHistoryImport = null;
let batchItems = [];
let selectedProjectId = "";
let ledgerMobilePane = "list";
let ledgerMobileListScrollY = null;
let selectedProtocolTransferId = "";
let protocolTransferEditMode = false;
let ledgerFilter = "all";
let reminderFilter = "all";
let paymentReceipts = [];
let paymentReceiptPendingFiles = [];
let paymentReceiptPendingBatches = [];
let paymentReceiptCoverage = { expected: 0, covered: 0, missing: 0, targets: [] };
let paymentReceiptCoverageFilter = "missing";
let paymentReceiptCoverageError = "";
let paymentReceiptsLoading = false;
let paymentReceiptsError = "";
let paymentReceiptArchiveController = null;
let paymentReceiptArchiveRequestId = 0;
let activePaymentReceiptRegroupFileId = "";
let paymentReceiptRegroupData = null;
let paymentReceiptRegroupTrigger = null;
let paymentReceiptRegroupController = null;
let paymentReceiptExplorerTree = buildPaymentReceiptOriginalFileTree();
let paymentReceiptExplorerLevel = "root";
let paymentReceiptExplorerDate = "";
let paymentReceiptExplorerLoading = false;
let paymentReceiptExplorerError = "";
let paymentReceiptExplorerController = null;
let paymentReceiptExplorerTrigger = null;
const projectPaymentReceiptCache = new Map();
const projectPaymentReceiptLoads = new Map();
const projectPaymentReceiptErrors = new Map();
let projectAutoSaveTimer = null;
let projectRecognitionMarks = {};
let resultRecognitionMarks = {};
let resultRecognitionProjectId = "";
const issuanceQueueAnnouncedStatus = new Map();
const dismissedIssuanceQueueTaskIds = new Set();
let activeIssuanceQueueTaskId = "";
const issuanceRecognitionQueue = createSequentialIssuanceQueue(requestQueuedIssuanceRecognition, handleIssuanceQueueChange);
let activePrepaymentTarget = null;
let protocolTransferRecognitionMarks = {};
let protocolTransferRecognitionId = "";
let customProtocolTransferTemplates = [];
let dmLastPayload = null;
let projectDmHistory = loadProjectDmHistory();
let projectDmHistorySaveTimer = null;
let valuationAssistTimer = null;
let valuationAssistController = null;
let valuationAssistRequestKey = "";
let policyCurveController = null;
let projectScreenshotRows = [];
let projectScreenshotBusy = false;
let projectScreenshotDragDepth = 0;
let projectScreenshotSessionId = 0;
let projectScreenshotRowSequence = 0;
let projectScreenshotWorker = null;
let projectScreenshotWorkerPromise = null;
let projectScreenshotWorkerGeneration = 0;
let projectScreenshotOcrProgressContext = null;
let projectScreenshotOcrPassBudget = null;
const projectScreenshotCanvasBackgrounds = new WeakMap();
let liquidMotionFrame = null;
let liquidMotionObserver = null;
let liquidResizeObserver = null;

const LIQUID_TRACK_CONFIGS = [
  { container: "#ledgerMobileNav", active: ".ledger-mobile-tab[aria-pressed=\"true\"]" },
  { container: ".ledger-filter-tabs", active: ".ledger-filter-chip.active" },
  { container: ".reminder-filter-tabs", active: ".reminder-filter.active" },
  { container: ".project-list", active: ".project-item.active" },
];
const liquidMotionTimers = new WeakMap();
let activeSecondaryWorkspacePanel = "intake";
let secondaryIntakeCollapsed = false;
let secondaryIntakeCollapseTouched = false;
let secondaryPendingDraftSignature = "";
let secondaryPendingDraftRows = [];
let secondaryPendingUndoStack = [];
let secondaryPendingEditSnapshot = null;
let secondaryPendingDmLoading = false;
let secondaryPendingDmAttemptKey = "";
let secondaryPendingSavePending = false;
let secondaryPendingShowAllColumns = false;
let secondaryPendingQuickDelete = false;
let secondaryPendingDeleteConfirmId = "";
let secondaryLedgerDraftDate = "";
let secondaryLedgerDraftRows = [];
let secondaryLedgerUndoStack = [];
let secondaryLedgerEditSnapshot = null;
let secondaryLedgerDmLoading = false;
let secondaryLedgerDmAttemptKey = "";
let secondaryLedgerSavePending = false;
let cloudSaveQueue = Promise.resolve(true);
let realtimeQuoteController = null;

const LEDGER_FILTER_LABELS = {
  all: "全部项目",
  toBid: "未投标",
  bidding: "已投标",
  bidFinal: "已投标结束",
  resulted: "已出结果",
};
const LEDGER_MOBILE_BREAKPOINT = "(max-width: 760px)";
const LEDGER_MOBILE_PANES = new Set(["list", "detail", "overview"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

if (location.hostname === "credit-bond-process.pages.dev") {
  location.replace(`https://tempest07.com/bond-centre/${location.search}${location.hash}`);
}

async function initialize() {
  initializeAndroidAppShell();
  bindPlaceholderSelection();
  bindNavigation();
  realtimeQuoteController = initializeRealtimeQuotes({ onToast: showToast });
  bindRouteHashNavigation();
  bindProjectScreenshotTool();
  bindIssuerPicker();
  bindGenerator();
  bindLedger();
  bindReminders();
  bindPaymentReceipts();
  bindProtocolTransfer();
  bindSecondaryInventory();
  bindQuickIssuer();
  bindBatch();
  bindDatabase();
  bindDmTest();
  initializeDatePickers();
  initializeHistoryImport();
  bindDataActions();
  bindStateHistory();
  initializeIdleExit();
  initializeLiquidMotion();
  resetProjectDmWorkspace({ preserveCurrentAsHistory: false, showToastMessage: false });
  renderProjectDmHistoryControls();
  renderIssuerOptions();
  renderIssuerList();
  renderAbsCreditEnhancerOptions();
  renderAbsCreditApprovalList();
  renderProjectWorkspace();
  renderProtocolTransferWorkspace();
  renderSecondaryInventoryWorkspace();
  renderFtpCurveForm();
  clearIssuerForm({ openEditor: false });
  clearAbsCreditApprovalForm();
  updateAuthUi();
  applyRouteFromHash();
  await Promise.all([loadCloudState(), loadPolicyCurve()]);
  await loadPaymentReceipts({ silent: true });
}

function initializeAndroidAppShell() {
  const root = document.documentElement;
  const isAndroidApp = root.classList.contains("android-app")
    || navigator.userAgent.includes("Tempest07Android/");
  if (!isAndroidApp) return;

  root.classList.add("android-app");
  const screenshotMount = $("#androidScreenshotMount");
  const screenshotTool = $("#projectScreenshotTool");
  const dataActionsMount = $("#androidDataActionsMount");
  const dataActions = $(".top-actions");
  if (screenshotMount && screenshotTool) screenshotMount.append(screenshotTool);
  if (dataActionsMount && dataActions) dataActionsMount.append(dataActions);

  const panel = $("#androidMorePanel");
  const trigger = $("#androidMoreButton");
  const closeButton = $("#androidMoreCloseButton");
  const closePanel = ({ restoreFocus = true } = {}) => {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.classList.remove("android-more-open");
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  };
  const openPanel = () => {
    if (!panel) return;
    panel.hidden = false;
    document.body.classList.add("android-more-open");
    trigger?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  };

  trigger?.addEventListener("click", openPanel);
  $$("[data-close-android-more]").forEach((button) => {
    button.addEventListener("click", () => closePanel());
  });
  panel?.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => closePanel({ restoreFocus: false }));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel && !panel.hidden) closePanel();
  });
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.viewTarget === "ledger" && isCompactLedger()) {
        navigateLedgerMobilePane("list", { replace: true });
        return;
      }
      switchView(button.dataset.viewTarget, { updateHash: true });
    });
  });
}

function initializeLiquidMotion() {
  const containers = LIQUID_TRACK_CONFIGS
    .map(({ container }) => $(container))
    .filter(Boolean);
  if (!containers.length) return;

  containers.forEach((container) => container.classList.add("liquid-track"));
  liquidMotionObserver = new MutationObserver(scheduleLiquidMotionSync);
  containers.forEach((container) => {
    liquidMotionObserver.observe(container, {
      attributes: true,
      attributeFilter: ["class", "aria-pressed", "aria-current"],
      characterData: true,
      childList: true,
      subtree: true,
    });
  });

  if ("ResizeObserver" in window) {
    liquidResizeObserver = new ResizeObserver(scheduleLiquidMotionSync);
    containers.forEach((container) => liquidResizeObserver.observe(container));
  } else {
    window.addEventListener("resize", scheduleLiquidMotionSync);
  }

  scheduleLiquidMotionSync();
}

function scheduleLiquidMotionSync() {
  if (liquidMotionFrame) cancelAnimationFrame(liquidMotionFrame);
  liquidMotionFrame = requestAnimationFrame(() => {
    liquidMotionFrame = null;
    LIQUID_TRACK_CONFIGS.forEach(syncLiquidTrack);
  });
}

function syncLiquidTrack({ container: containerSelector, active: activeSelector }) {
  const container = $(containerSelector);
  const active = container?.querySelector(activeSelector);
  if (!container || !active || !active.offsetWidth || !active.offsetHeight) {
    container?.classList.remove("liquid-ready", "is-liquid-moving");
    if (container) delete container.dataset.liquidPosition;
    return;
  }

  const x = active.offsetLeft;
  const y = active.offsetTop;
  const width = active.offsetWidth;
  const height = active.offsetHeight;
  const nextPosition = `${x}:${y}:${width}:${height}`;
  const previousPosition = container.dataset.liquidPosition || "";

  container.style.setProperty("--liquid-x", `${x}px`);
  container.style.setProperty("--liquid-y", `${y}px`);
  container.style.setProperty("--liquid-width", `${width}px`);
  container.style.setProperty("--liquid-height", `${height}px`);
  container.dataset.liquidPosition = nextPosition;
  container.classList.add("liquid-ready");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!previousPosition || previousPosition === nextPosition || reduceMotion) return;

  container.classList.remove("is-liquid-moving");
  requestAnimationFrame(() => container.classList.add("is-liquid-moving"));
  clearTimeout(liquidMotionTimers.get(container));
  liquidMotionTimers.set(container, setTimeout(() => {
    container.classList.remove("is-liquid-moving");
  }, 560));
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

function bindPaymentReceipts() {
  $("#paymentReceiptRefreshButton")?.addEventListener("click", () => loadPaymentReceipts());
  $("#paymentReceiptExplorerButton")?.addEventListener("click", (event) => {
    void openPaymentReceiptExplorer(event.currentTarget);
  });
  $("#paymentReceiptArchive")?.addEventListener("click", handlePaymentReceiptArchiveClick);
  $("#paymentReceiptArchive")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-receipt-regroup]");
    if (button?.dataset.receiptRegroup) void openPaymentReceiptRegroup(button.dataset.receiptRegroup, button);
  });
  $("#paymentReceiptCoverageSummary")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-receipt-coverage-filter]");
    const filter = button?.dataset.receiptCoverageFilter;
    if (!button || !["all", "covered", "missing"].includes(filter)) return;
    paymentReceiptCoverageFilter = filter;
    renderPaymentReceiptCoverage();
  });
  $("#paymentReceiptCoverage")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-receipt-coverage-project]");
    if (!button?.dataset.receiptCoverageProject) return;
    openLedgerProject(button.dataset.receiptCoverageProject, { scrollOnDesktop: true });
  });
  $("#paymentReceiptDateFilter")?.addEventListener("change", () => loadPaymentReceipts({ silent: true }));
  $("#paymentReceiptStatusFilter")?.addEventListener("change", () => loadPaymentReceipts({ silent: true }));
  $("#paymentReceiptTodayButton")?.addEventListener("click", () => {
    $("#paymentReceiptDateFilter").value = localDate(new Date());
    loadPaymentReceipts({ silent: true });
  });
  $("#paymentReceiptAllDatesButton")?.addEventListener("click", () => {
    $("#paymentReceiptDateFilter").value = "";
    loadPaymentReceipts({ silent: true });
  });
  $("#paymentReceiptRegroupForm")?.addEventListener("submit", savePaymentReceiptRegroup);
  $("#paymentReceiptRegroupPanel")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-receipt-regroup]")) closePaymentReceiptRegroup();
  });
  $("#paymentReceiptExplorerPanel")?.addEventListener("click", handlePaymentReceiptExplorerClick);
  $("#paymentReceiptExplorerBack")?.addEventListener("click", navigatePaymentReceiptExplorerBack);
  $("#paymentReceiptExplorerRefresh")?.addEventListener("click", () => {
    void loadPaymentReceiptExplorer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#paymentReceiptExplorerPanel")?.hidden) {
      closePaymentReceiptExplorer();
    } else if (!$("#paymentReceiptRegroupPanel")?.hidden) {
      closePaymentReceiptRegroup();
    }
  });
}

async function handlePaymentReceiptArchiveClick(event) {
  const button = event.target.closest("[data-receipt-match], [data-receipt-assign], [data-receipt-unlink], [data-receipt-delete]");
  if (!button) return;
  const receiptId = button.dataset.receiptMatch || button.dataset.receiptAssign || button.dataset.receiptUnlink || button.dataset.receiptDelete;
  if (!receiptId) return;

  if (button.dataset.receiptDelete) {
    await deleteDuplicatePaymentReceipt(receiptId, button);
    return;
  }
  if (button.dataset.receiptUnlink) {
    await unlinkPaymentReceipt(receiptId, button);
    return;
  }

  let projectId = button.dataset.projectId || "";
  let trancheId = button.dataset.trancheId || "";
  if (button.dataset.receiptAssign) {
    const select = button.closest(".payment-receipt-manual")?.querySelector("[data-receipt-target]");
    try {
      [projectId, trancheId] = JSON.parse(select?.value || "[]");
    } catch {
      projectId = "";
      trancheId = "";
    }
  }
  if (!projectId || !trancheId) {
    showToast("请先选择要对应的项目品种。");
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(`${PAYMENT_RECEIPTS_URL}/${encodeURIComponent(receiptId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ projectId, trancheId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    invalidateProjectPaymentReceiptCache(receiptId, projectId);
    await loadPaymentReceipts({ silent: true });
    if (selectedProjectId) await loadProjectPaymentReceipts(selectedProjectId, { refresh: true });
    showToast("已人工确认缴款单对应关系；缴款状态未改变。");
  } catch (error) {
    button.disabled = false;
    showToast(`对应失败：${error.message || "请稍后重试"}`);
  }
}

async function unlinkPaymentReceipt(receiptId, button) {
  button.disabled = true;
  try {
    const response = await fetch(`${PAYMENT_RECEIPTS_URL}/${encodeURIComponent(receiptId)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    invalidateProjectPaymentReceiptCache(receiptId);
    await loadPaymentReceipts({ silent: true });
    if (selectedProjectId) await loadProjectPaymentReceipts(selectedProjectId, { refresh: true });
    showToast("已解除缴款单对应关系；缴款状态未改变。");
  } catch (error) {
    button.disabled = false;
    showToast(`解除对应失败：${error.message || "请稍后重试"}`);
  }
}

async function deleteDuplicatePaymentReceipt(receiptId, button) {
  const confirmed = window.confirm("确定删除这张重复缴款单吗？被判定为原件的缴款单不会删除，项目缴款状态也不会改变。");
  if (!confirmed) return;
  button.disabled = true;
  try {
    const response = await fetch(`${PAYMENT_RECEIPTS_URL}/${encodeURIComponent(receiptId)}?action=delete-duplicate`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    invalidateProjectPaymentReceiptCache(receiptId);
    await loadPaymentReceipts({ silent: true });
    showToast(payload.storageCleanup === false
      ? "重复单据记录已删除，但存储文件清理失败，请稍后告知管理员。"
      : "重复单据已删除；原件和项目缴款状态未改变。");
  } catch (error) {
    button.disabled = false;
    showToast(`删除失败：${error.message || "请稍后重试"}`);
  }
}

function invalidateProjectPaymentReceiptCache(receiptId, nextProjectId = "") {
  const current = paymentReceipts.find((receipt) => receipt.id === receiptId);
  if (current?.projectId) projectPaymentReceiptCache.delete(current.projectId);
  if (nextProjectId) projectPaymentReceiptCache.delete(nextProjectId);
}

async function loadPaymentReceipts(options = {}) {
  const requestId = ++paymentReceiptArchiveRequestId;
  paymentReceiptArchiveController?.abort();
  const controller = new AbortController();
  paymentReceiptArchiveController = controller;
  paymentReceiptsLoading = true;
  paymentReceiptsError = "";
  paymentReceipts = [];
  paymentReceiptPendingFiles = [];
  paymentReceiptPendingBatches = [];
  paymentReceiptCoverage = { expected: 0, covered: 0, missing: 0, targets: [] };
  paymentReceiptCoverageError = "";
  renderPaymentReceiptArchive();
  renderPaymentReceiptCoverage();
  const date = $("#paymentReceiptDateFilter")?.value || "";
  const status = $("#paymentReceiptStatusFilter")?.value || "";
  try {
    const archive = await fetchPaymentReceiptArchivePages({ date, status, signal: controller.signal });
    if (requestId !== paymentReceiptArchiveRequestId) return;
    paymentReceipts = archive.receipts;
    paymentReceiptPendingFiles = archive.pendingFiles;
    paymentReceiptPendingBatches = archive.pendingBatches;
    try {
      paymentReceiptCoverage = await fetchPaymentReceiptCoverage(date, controller.signal);
    } catch (coverageError) {
      if (coverageError.name === "AbortError") throw coverageError;
      paymentReceiptCoverageError = coverageError.message || "读取应收单据对账失败";
      if (!options.silent) showToast(`单据归档已刷新，但对账读取失败：${paymentReceiptCoverageError}`);
    }
    if (selectedProjectId) {
      projectPaymentReceiptCache.delete(selectedProjectId);
      void loadProjectPaymentReceipts(selectedProjectId, { refresh: true });
    }
    if (!options.silent) showToast(`已刷新 ${paymentReceipts.length} 张缴款单。`);
  } catch (error) {
    if (error.name === "AbortError" || requestId !== paymentReceiptArchiveRequestId) return;
    paymentReceiptsError = error.message || "读取缴款单失败";
    if (!paymentReceiptCoverageError) paymentReceiptCoverageError = "归档读取失败，暂时无法完成缺单对账";
    if (!options.silent) showToast(`缴款单读取失败：${paymentReceiptsError}`);
  } finally {
    if (requestId === paymentReceiptArchiveRequestId) {
      paymentReceiptsLoading = false;
      paymentReceiptArchiveController = null;
      renderPaymentReceiptArchive();
      renderPaymentReceiptCoverage();
    }
  }
}

async function fetchPaymentReceiptArchivePages({ date = "", status = "", signal } = {}) {
  const receipts = [];
  const pendingFiles = [];
  const pendingBatches = [];
  const seenReceiptIds = new Set();
  const seenFileIds = new Set();
  const seenBatchIds = new Set();
  for (let offset = 0; ; offset += 200) {
    const params = new URLSearchParams({ limit: "200", offset: String(offset) });
    if (date) params.set("date", date);
    if (status) params.set("status", status);
    const response = await fetch(`${PAYMENT_RECEIPTS_URL}?${params}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        clearAuthSession();
        redirectToGatewayLogin();
      }
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    const page = Array.isArray(payload.receipts) ? payload.receipts : [];
    const filePage = Array.isArray(payload.pendingFiles) ? payload.pendingFiles : [];
    const batchPage = Array.isArray(payload.pendingBatches) ? payload.pendingBatches : [];
    const unseen = page.filter((receipt) => receipt?.id && !seenReceiptIds.has(receipt.id));
    const unseenFiles = filePage.filter((file) => file?.id && !seenFileIds.has(file.id));
    const unseenBatches = batchPage.filter((batch) => batch?.id && !seenBatchIds.has(batch.id));
    unseen.forEach((receipt) => seenReceiptIds.add(receipt.id));
    unseenFiles.forEach((file) => seenFileIds.add(file.id));
    unseenBatches.forEach((batch) => seenBatchIds.add(batch.id));
    receipts.push(...unseen);
    pendingFiles.push(...unseenFiles);
    pendingBatches.push(...unseenBatches);
    if (Math.max(page.length, filePage.length, batchPage.length) < 200) break;
    if (!unseen.length && !unseenFiles.length && !unseenBatches.length) throw new Error("缴款单分页未推进，请刷新后重试");
  }
  return { receipts, pendingFiles, pendingBatches };
}

async function fetchPaymentReceiptCoverage(date, signal) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  const response = await fetch(`${PAYMENT_RECEIPT_COVERAGE_URL}${params.size ? `?${params}` : ""}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: authHeaders(),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return {
    expected: Number(payload.expected) || 0,
    covered: Number(payload.covered) || 0,
    missing: Number(payload.missing) || 0,
    targets: Array.isArray(payload.targets) ? payload.targets : [],
  };
}

async function loadProjectPaymentReceipts(projectId, options = {}) {
  if (!projectId) return [];
  if (!options.refresh && projectPaymentReceiptCache.has(projectId)) return projectPaymentReceiptCache.get(projectId);
  if (projectPaymentReceiptLoads.has(projectId)) return projectPaymentReceiptLoads.get(projectId);

  projectPaymentReceiptErrors.delete(projectId);
  const load = (async () => {
    const collected = [];
    const seen = new Set();
    for (let offset = 0; ; offset += 200) {
      const params = new URLSearchParams({ projectId, limit: "200", offset: String(offset) });
      const response = await fetch(`${PAYMENT_RECEIPTS_URL}?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: authHeaders(),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      const page = Array.isArray(payload.receipts) ? payload.receipts : [];
      const unseen = page.filter((receipt) => receipt?.id && !seen.has(receipt.id));
      unseen.forEach((receipt) => seen.add(receipt.id));
      collected.push(...unseen);
      if (page.length < 200) break;
      if (!unseen.length) throw new Error("项目缴款单分页未推进");
    }
    projectPaymentReceiptCache.set(projectId, collected);
    return collected;
  })();
  projectPaymentReceiptLoads.set(projectId, load);
  refreshVisibleProjectReceiptPanels();
  try {
    return await load;
  } catch (error) {
    projectPaymentReceiptErrors.set(projectId, error.message || "读取缴款单失败");
    return [];
  } finally {
    projectPaymentReceiptLoads.delete(projectId);
    refreshVisibleProjectReceiptPanels();
  }
}

function renderPaymentReceiptArchive() {
  const archive = $("#paymentReceiptArchive");
  const summary = $("#paymentReceiptSummary");
  const refreshButton = $("#paymentReceiptRefreshButton");
  if (!archive || !summary) return;
  if (refreshButton) refreshButton.disabled = paymentReceiptsLoading;

  const matched = paymentReceipts.filter((receipt) => receipt.matchStatus === "matched").length;
  const review = paymentReceipts.filter((receipt) => receipt.matchStatus === "review").length;
  const unmatched = paymentReceipts.filter((receipt) => receipt.matchStatus === "unmatched").length;
  summary.innerHTML = `
    <span><strong>${paymentReceipts.length}</strong> 张单据</span>
    <span><strong>${matched}</strong> 已对应</span>
    <span><strong>${review + unmatched}</strong> 待确认或未对应</span>
    ${paymentReceiptPendingFiles.length ? `<span><strong>${paymentReceiptPendingFiles.length}</strong> 个附件仍在处理或失败</span>` : ""}
    ${paymentReceiptPendingBatches.length ? `<span><strong>${paymentReceiptPendingBatches.length}</strong> 封邮件未提取到附件</span>` : ""}
    <span>当前筛选不会影响项目的人工缴款状态</span>
  `;

  if (paymentReceiptsLoading) {
    archive.innerHTML = '<div class="empty payment-receipt-empty">正在读取邮箱识别结果……</div>';
    return;
  }
  if (paymentReceiptsError && !paymentReceipts.length) {
    archive.innerHTML = `<div class="empty payment-receipt-empty error">读取失败：${escapeHtml(paymentReceiptsError)}</div>`;
    return;
  }
  if (!paymentReceipts.length && !paymentReceiptPendingFiles.length && !paymentReceiptPendingBatches.length) {
    archive.innerHTML = '<div class="empty payment-receipt-empty">当前日期和状态下暂无缴款单。</div>';
    return;
  }

  const groups = new Map();
  const entries = [
    ...paymentReceipts.map((value) => ({ kind: "receipt", value })),
    ...paymentReceiptPendingFiles.map((value) => ({ kind: "file", value })),
    ...paymentReceiptPendingBatches.map((value) => ({ kind: "batch", value })),
  ];
  entries.forEach((entry) => {
    const key = entry.value.archiveDate || "缴款日期待识别";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  archive.innerHTML = [...groups.entries()].map(([date, entriesForDate]) => `
    <section class="payment-receipt-date-group">
      <header><strong>${escapeHtml(date)}</strong><span>${entriesForDate.length} 项</span></header>
      <div class="payment-receipt-card-list">
        ${entriesForDate.map((entry) => entry.kind === "receipt"
          ? renderPaymentReceiptCard(entry.value)
          : entry.kind === "file"
            ? renderPendingPaymentReceiptFile(entry.value)
            : renderPendingPaymentReceiptBatch(entry.value)).join("")}
      </div>
    </section>
  `).join("");
}

function renderPaymentReceiptCoverage() {
  const summary = $("#paymentReceiptCoverageSummary");
  const container = $("#paymentReceiptCoverage");
  if (!summary || !container) return;
  const coverage = paymentReceiptCoverage;
  const summaryFilters = [
    { value: "all", count: coverage.expected, label: "个应有单据的品种" },
    { value: "covered", count: coverage.covered, label: "已有对应单据" },
    { value: "missing", count: coverage.missing, label: "缺少单据", warning: coverage.missing > 0 },
  ];
  summary.innerHTML = summaryFilters.map((filter) => `
    <button
      class="payment-receipt-summary-filter ${filter.warning ? "is-warning" : ""}"
      type="button"
      data-receipt-coverage-filter="${filter.value}"
      aria-pressed="${paymentReceiptCoverageFilter === filter.value}"
      aria-controls="paymentReceiptCoverage"
    ><strong>${filter.count}</strong> ${filter.label}</button>
  `).join("");
  if (paymentReceiptsLoading) {
    container.innerHTML = '<div class="empty payment-receipt-coverage-empty">正在核对应收单据……</div>';
    return;
  }
  if (paymentReceiptCoverageError) {
    container.innerHTML = `<div class="empty payment-receipt-coverage-empty error">对账读取失败：${escapeHtml(paymentReceiptCoverageError)}</div>`;
    return;
  }
  const targets = coverage.targets.filter((target) => (
    paymentReceiptCoverageFilter === "all"
      || (paymentReceiptCoverageFilter === "covered" && target.covered)
      || (paymentReceiptCoverageFilter === "missing" && !target.covered)
  ));
  if (!targets.length) {
    const message = paymentReceiptCoverageFilter === "missing"
      ? "当前范围内，应有缴款单的项目品种均已建立单据对应。"
      : paymentReceiptCoverageFilter === "covered"
        ? "当前范围内还没有已对应单据的项目品种。"
        : "当前范围内没有应收缴款单的项目品种。";
    container.innerHTML = `<div class="payment-receipt-coverage-ok">${message}</div>`;
    return;
  }
  container.innerHTML = targets.map((target) => `
    <article class="payment-receipt-coverage-item ${target.covered ? "covered" : target.paymentCompleted ? "paid" : "unpaid"}">
      <div>
        <strong>${escapeHtml(target.shortName || target.projectShortName || "未命名品种")}</strong>
        <span>${escapeHtml([target.paymentDate, target.issuerName].filter(Boolean).join(" · "))}</span>
      </div>
      <span class="payment-receipt-coverage-state">${escapeHtml(target.covered ? "已有对应单据" : target.paymentCompleted ? "已人工确认缴款，但缺单" : "未缴款，且缺单")}</span>
      <button class="button subtle" type="button" data-receipt-coverage-project="${escapeAttribute(target.projectId)}">查看项目</button>
    </article>
  `).join("");
}

function renderPendingPaymentReceiptBatch(batch) {
  return `
    <article class="payment-receipt-card pending-file">
      <div class="payment-receipt-card-main">
        <div class="payment-receipt-card-title">
          <strong>${escapeHtml(batch.subject || "未提取到 PDF 的缴款单邮件")}</strong>
          <span class="payment-receipt-status error">${escapeHtml(paymentReceiptFileStatusLabel(batch.processingStatus))}</span>
        </div>
        <p>${escapeHtml(batch.errorMessage || "邮件已保留，但尚未提取到可归档的 PDF 附件")}</p>
        <div class="payment-receipt-meta">
          <span>${escapeHtml(formatPaymentReceiptReceivedAt(batch.receivedAt))}</span>
          ${batch.sender ? `<span>${escapeHtml(batch.sender)}</span>` : ""}
        </div>
      </div>
      <div class="payment-receipt-file-actions">
        <a class="text-button" href="${paymentReceiptPendingBatchEmailUrl(batch.id)}">原始邮件</a>
      </div>
    </article>
  `;
}

function renderPendingPaymentReceiptFile(file) {
  const status = paymentReceiptFileStatusLabel(file.processingStatus);
  return `
    <article class="payment-receipt-card pending-file">
      <div class="payment-receipt-card-main">
        <div class="payment-receipt-card-title">
          <strong>${escapeHtml(file.sourceFilename || file.subject || "待处理 PDF")}</strong>
          <span class="payment-receipt-status ${file.processingStatus === "error" ? "error" : "review"}">${escapeHtml(status)}</span>
        </div>
        <p>${escapeHtml(file.errorMessage || "邮件已归档，正在等待拆分或识别")}</p>
        <div class="payment-receipt-meta">
          <span>${escapeHtml(formatPaymentReceiptReceivedAt(file.receivedAt))}</span>
          ${file.sender ? `<span>${escapeHtml(file.sender)}</span>` : ""}
          ${file.pageCount ? `<span>${escapeHtml(`${file.pageCount} 页`)}</span>` : ""}
        </div>
      </div>
      <div class="payment-receipt-file-actions">
        <a class="button subtle" href="${paymentReceiptPendingFileUrl(file.id)}" target="_blank" rel="noopener">原始 PDF</a>
        ${file.pageCount && ["processed", "review", "error"].includes(file.processingStatus) ? `<button class="button subtle" type="button" data-receipt-regroup="${escapeAttribute(file.id)}">修正拆页</button>` : ""}
        <a class="text-button" href="${paymentReceiptPendingEmailUrl(file.id)}">原始邮件</a>
      </div>
    </article>
  `;
}

function paymentReceiptFileStatusLabel(status) {
  return ({
    received: "已收件",
    queued: "等待识别",
    processing: "识别中",
    regrouping: "人工修正拆页中",
    processed: "处理完成（未提取到单据）",
    review: "待复核",
    error: "处理失败",
  })[status] || "处理中";
}

function renderPaymentReceiptCard(receipt) {
  const target = paymentReceiptTarget(receipt);
  const title = receipt.bondShortName || target?.tranche?.shortName || receipt.subject || "未识别项目缴款单";
  const amount = formatPaymentReceiptAmount(receipt.amountFen);
  const identity = [receipt.securityCode, receipt.prepaymentNumber, amount].filter(Boolean).join(" · ");
  const source = [
    receipt.sourceFilename,
    receipt.sourcePageLabel ? `原附件第 ${receipt.sourcePageLabel} 页` : "",
    receipt.blankPages?.length ? `空白页 ${receipt.blankPages.join("、")}` : "",
  ].filter(Boolean).join(" · ");
  return `
    <article class="payment-receipt-card">
      <div class="payment-receipt-card-main">
        <div class="payment-receipt-card-title">
          <strong>${escapeHtml(title)}</strong>
          ${paymentReceiptStatusBadge(receipt.matchStatus)}
        </div>
        <p>${escapeHtml(identity || "金额或债券代码待识别")}</p>
        <div class="payment-receipt-meta">
          <span>${escapeHtml(source || "邮件附件")}</span>
          <span>${escapeHtml(formatPaymentReceiptReceivedAt(receipt.receivedAt))}</span>
          ${receipt.sender ? `<span>${escapeHtml(receipt.sender)}</span>` : ""}
        </div>
        ${renderPaymentReceiptTargetLine(receipt, target)}
        ${renderPaymentReceiptCandidates(receipt)}
        ${renderPaymentReceiptManualAssignment(receipt)}
        ${receipt.errorMessage ? `<p class="payment-receipt-error">${escapeHtml(receipt.errorMessage)}</p>` : ""}
      </div>
      <div class="payment-receipt-file-actions">
        <a class="button subtle payment-receipt-open" href="${paymentReceiptFileUrl(receipt.id)}" target="_blank" rel="noopener">拆分单据</a>
        <a class="button subtle" href="${paymentReceiptSourceUrl(receipt.id)}" target="_blank" rel="noopener">原始 PDF</a>
        <button class="button subtle" type="button" data-receipt-regroup="${escapeAttribute(receipt.fileId)}">修正拆页</button>
        <a class="text-button" href="${paymentReceiptEmailUrl(receipt.id)}">原始邮件</a>
        ${receipt.matchStatus === "duplicate" ? `<button class="button subtle danger-button" type="button" data-receipt-delete="${escapeAttribute(receipt.id)}">删除重复单据</button>` : ""}
      </div>
    </article>
  `;
}

function renderPaymentReceiptCandidates(receipt) {
  if (receipt.matchStatus === "matched" || !Array.isArray(receipt.candidates) || !receipt.candidates.length) return "";
  return `
    <div class="payment-receipt-candidates">
      <span>候选项目</span>
      ${receipt.candidates.map((candidate) => `
        <button class="button subtle" type="button" data-receipt-match="${escapeAttribute(receipt.id)}" data-project-id="${escapeAttribute(candidate.projectId)}" data-tranche-id="${escapeAttribute(candidate.trancheId)}">
          对应到 ${escapeHtml(candidate.shortName || "未命名品种")} · ${escapeHtml(candidate.paymentCompleted ? "已缴款" : "未缴款")}
        </button>
      `).join("")}
    </div>
  `;
}

function renderPaymentReceiptManualAssignment(receipt) {
  if (["duplicate", "error"].includes(receipt.matchStatus)) return "";
  const options = paymentReceiptTargetOptions(receipt);
  return `
    <details class="payment-receipt-manual">
      <summary>${receipt.matchStatus === "matched" ? "更正或解除对应" : "从全部项目中人工选择"}</summary>
      <div>
        <select data-receipt-target aria-label="选择缴款单对应项目品种">
          <option value="">请选择项目品种</option>
          ${options}
        </select>
        <button class="button subtle" type="button" data-receipt-assign="${escapeAttribute(receipt.id)}">确认对应</button>
        ${receipt.matchStatus === "matched" ? `<button class="button subtle danger-button" type="button" data-receipt-unlink="${escapeAttribute(receipt.id)}">解除对应</button>` : ""}
      </div>
    </details>
  `;
}

function paymentReceiptTargetOptions(receipt) {
  const rows = (state.projects || []).flatMap((projectValue) =>
    (projectValue.tranches || []).flatMap((tranche) => {
      if (!projectValue.id || !tranche.id) return [];
      return [{ project: projectValue, tranche }];
    }),
  ).sort((left, right) => {
    const leftSameDate = Boolean(receipt.paymentDate && left.tranche.paymentDate === receipt.paymentDate);
    const rightSameDate = Boolean(receipt.paymentDate && right.tranche.paymentDate === receipt.paymentDate);
    if (leftSameDate !== rightSameDate) return Number(rightSameDate) - Number(leftSameDate);
    return `${right.tranche.paymentDate || ""}:${right.project.shortName || ""}`.localeCompare(`${left.tranche.paymentDate || ""}:${left.project.shortName || ""}`);
  });
  return rows.map(({ project: projectValue, tranche }) => {
    const value = JSON.stringify([String(projectValue.id), String(tranche.id)]);
    const selected = receipt.projectId === projectValue.id && receipt.trancheId === tranche.id;
    const label = [
      tranche.paymentDate || "日期待补",
      tranche.shortName || projectValue.shortName || "未命名品种",
      projectValue.issuerName || projectValue.branch || "主体待补",
      tranche.paymentCompleted ? "已缴款" : "未缴款",
    ].join(" · ");
    return `<option value="${escapeAttribute(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function renderPaymentReceiptTargetLine(receipt, target = paymentReceiptTarget(receipt)) {
  if (receipt.matchStatus !== "matched") {
    return `<div class="payment-receipt-target pending"><strong>${escapeHtml(paymentReceiptStatusLabel(receipt.matchStatus))}</strong><span>${escapeHtml(receipt.matchReason || "等待更多业务标识或人工确认")}</span></div>`;
  }
  if (!target) {
    return '<div class="payment-receipt-target pending"><strong>已建立对应</strong><span>对应项目当前未载入</span></div>';
  }
  const paymentLabel = target.tranche.paymentCompleted ? "已缴款（人工确认）" : "未缴款（仍需人工点击）";
  return `
    <div class="payment-receipt-target matched">
      <strong>${escapeHtml(target.project.shortName || target.tranche.shortName || "已对应项目")}</strong>
      <span>${escapeHtml(target.tranche.shortName || "品种")} · ${escapeHtml(paymentLabel)}</span>
    </div>
  `;
}

function paymentReceiptTarget(receipt) {
  if (!receipt?.projectId || !receipt?.trancheId) return null;
  const projectValue = (state.projects || []).find((item) => item.id === receipt.projectId);
  const tranche = projectValue?.tranches?.find((item) => item.id === receipt.trancheId);
  return projectValue && tranche ? { project: projectValue, tranche } : null;
}

function paymentReceiptStatusBadge(status) {
  return `<span class="payment-receipt-status ${escapeAttribute(status || "unmatched")}">${escapeHtml(paymentReceiptStatusLabel(status))}</span>`;
}

function paymentReceiptStatusLabel(status) {
  return ({
    matched: "已对应项目",
    review: "待人工确认",
    unmatched: "未对应",
    duplicate: "重复单据",
    error: "识别失败",
  })[status] || "处理中";
}

function formatPaymentReceiptAmount(amountFen) {
  const amount = Number(amountFen);
  if (!Number.isSafeInteger(amount)) return "";
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(amount / 100)} 元`;
}

function formatPaymentReceiptReceivedAt(value) {
  if (!value) return "收件时间待记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `收件 ${date.toLocaleString("zh-CN", { hour12: false })}`;
}

function paymentReceiptFileUrl(receiptId) {
  return `${PAYMENT_RECEIPTS_URL}/${encodeURIComponent(receiptId)}/file`;
}

function paymentReceiptSourceUrl(receiptId) {
  return `${PAYMENT_RECEIPTS_URL}/${encodeURIComponent(receiptId)}/source`;
}

function paymentReceiptEmailUrl(receiptId) {
  return `${PAYMENT_RECEIPTS_URL}/${encodeURIComponent(receiptId)}/email`;
}

function paymentReceiptPendingFileUrl(fileId) {
  return `./api/payment-receipt-files/${encodeURIComponent(fileId)}/file`;
}

function paymentReceiptPendingEmailUrl(fileId) {
  return `./api/payment-receipt-files/${encodeURIComponent(fileId)}/email`;
}

function paymentReceiptPendingBatchEmailUrl(batchId) {
  return `./api/payment-receipt-batches/${encodeURIComponent(batchId)}/email`;
}

async function openPaymentReceiptExplorer(trigger) {
  paymentReceiptExplorerTrigger = trigger || null;
  paymentReceiptExplorerLevel = "root";
  paymentReceiptExplorerDate = "";
  paymentReceiptExplorerError = "";
  const panel = $("#paymentReceiptExplorerPanel");
  panel.hidden = false;
  syncModalOpenState();
  renderPaymentReceiptExplorer();
  requestAnimationFrame(() => $("#paymentReceiptExplorerDialog")?.focus({ preventScroll: true }));
  await loadPaymentReceiptExplorer();
}

async function loadPaymentReceiptExplorer() {
  paymentReceiptExplorerController?.abort();
  const controller = new AbortController();
  paymentReceiptExplorerController = controller;
  paymentReceiptExplorerLoading = true;
  paymentReceiptExplorerError = "";
  renderPaymentReceiptExplorer();
  try {
    const archive = await fetchPaymentReceiptArchivePages({ signal: controller.signal });
    if (paymentReceiptExplorerController !== controller) return;
    paymentReceiptExplorerTree = buildPaymentReceiptOriginalFileTree(archive.receipts, archive.pendingFiles);
  } catch (error) {
    if (error.name === "AbortError" || paymentReceiptExplorerController !== controller) return;
    paymentReceiptExplorerError = error.message || "读取原始 PDF 失败";
  } finally {
    if (paymentReceiptExplorerController === controller) {
      paymentReceiptExplorerController = null;
      paymentReceiptExplorerLoading = false;
      renderPaymentReceiptExplorer();
    }
  }
}

function renderPaymentReceiptExplorer() {
  const panel = $("#paymentReceiptExplorerPanel");
  const content = $("#paymentReceiptExplorerContent");
  const breadcrumb = $("#paymentReceiptExplorerBreadcrumb");
  const status = $("#paymentReceiptExplorerStatus");
  const back = $("#paymentReceiptExplorerBack");
  const refresh = $("#paymentReceiptExplorerRefresh");
  if (!panel || panel.hidden || !content || !breadcrumb || !status || !back || !refresh) return;

  const selectedFolder = paymentReceiptExplorerFolder();
  back.disabled = paymentReceiptExplorerLevel === "root";
  refresh.disabled = paymentReceiptExplorerLoading;
  breadcrumb.innerHTML = renderPaymentReceiptExplorerBreadcrumb(selectedFolder);

  if (paymentReceiptExplorerLoading) {
    status.textContent = "正在读取全部原始 PDF……";
    content.innerHTML = '<div class="empty payment-receipt-explorer-empty">正在整理缴款日期文件夹……</div>';
    return;
  }
  if (paymentReceiptExplorerError) {
    status.textContent = "读取失败";
    content.innerHTML = `<div class="empty payment-receipt-explorer-empty error">读取失败：${escapeHtml(paymentReceiptExplorerError)}</div>`;
    return;
  }

  if (paymentReceiptExplorerLevel === "root") {
    status.textContent = "1 个文件夹";
    content.innerHTML = `
      <div class="payment-receipt-explorer-grid">
        <button class="payment-receipt-explorer-item folder" type="button" data-receipt-explorer-open="receipts">
          <span class="payment-receipt-explorer-icon folder" aria-hidden="true"></span>
          <span class="payment-receipt-explorer-item-copy">
            <strong>${escapeHtml(paymentReceiptExplorerTree.rootLabel)}</strong>
            <span>${paymentReceiptExplorerTree.folderCount} 个日期文件夹 · ${paymentReceiptExplorerTree.physicalFileCount} 个原始 PDF</span>
          </span>
          <span class="payment-receipt-explorer-open-label">打开</span>
        </button>
      </div>
    `;
    return;
  }

  if (paymentReceiptExplorerLevel === "dates") {
    status.textContent = `${paymentReceiptExplorerTree.folderCount} 个日期文件夹 · ${paymentReceiptExplorerTree.physicalFileCount} 个原始 PDF`;
    if (!paymentReceiptExplorerTree.folders.length) {
      content.innerHTML = '<div class="empty payment-receipt-explorer-empty">暂时没有原始缴款单 PDF。</div>';
      return;
    }
    content.innerHTML = `
      <div class="payment-receipt-explorer-grid">
        ${paymentReceiptExplorerTree.folders.map((folder) => `
          <button class="payment-receipt-explorer-item folder" type="button" data-receipt-explorer-date="${escapeAttribute(folder.key)}">
            <span class="payment-receipt-explorer-icon folder" aria-hidden="true"></span>
            <span class="payment-receipt-explorer-item-copy">
              <strong>${escapeHtml(folder.label)}</strong>
              <span>${folder.fileCount} 个原始 PDF${folder.receiptCount ? ` · ${folder.receiptCount} 张拆分单据` : ""}</span>
            </span>
            <span class="payment-receipt-explorer-open-label">打开</span>
          </button>
        `).join("")}
      </div>
    `;
    return;
  }

  if (!selectedFolder) {
    paymentReceiptExplorerLevel = "dates";
    renderPaymentReceiptExplorer();
    return;
  }
  status.textContent = `${selectedFolder.fileCount} 个原始 PDF`;
  if (!selectedFolder.files.length) {
    content.innerHTML = '<div class="empty payment-receipt-explorer-empty">这个日期文件夹中没有原始 PDF。</div>';
    return;
  }
  content.innerHTML = `
    <div class="payment-receipt-explorer-file-list">
      ${selectedFolder.files.map(renderPaymentReceiptExplorerFile).join("")}
    </div>
  `;
}

function renderPaymentReceiptExplorerBreadcrumb(selectedFolder) {
  const parts = ['<button type="button" data-receipt-explorer-path="root">此电脑</button>'];
  if (paymentReceiptExplorerLevel !== "root") {
    parts.push('<span aria-hidden="true">›</span>', '<button type="button" data-receipt-explorer-path="dates">缴款单</button>');
  }
  if (paymentReceiptExplorerLevel === "files" && selectedFolder) {
    parts.push('<span aria-hidden="true">›</span>', `<strong>${escapeHtml(selectedFolder.label)}</strong>`);
  }
  return parts.join("");
}

function renderPaymentReceiptExplorerFile(file) {
  const metadata = [
    file.receiptCount ? `${file.receiptCount} 张拆分单据` : paymentReceiptFileStatusLabel(file.processingStatus),
    file.sourcePageLabels.length ? `相关页 ${file.sourcePageLabels.join("、")}` : "",
    file.pageCount ? `${file.pageCount} 页` : "",
    formatPaymentReceiptReceivedAt(file.receivedAt),
  ].filter(Boolean).join(" · ");
  const crossDateNote = file.otherPaymentDates.length
    ? `<span class="payment-receipt-explorer-cross-date">此原件同时包含：${escapeHtml(file.otherPaymentDates.join("、"))}</span>`
    : "";
  return `
    <a class="payment-receipt-explorer-file" href="${paymentReceiptPendingFileUrl(file.fileId)}" target="_blank" rel="noopener">
      <span class="payment-receipt-explorer-icon pdf" aria-hidden="true"></span>
      <span class="payment-receipt-explorer-item-copy">
        <strong>${escapeHtml(file.name)}</strong>
        <span>${escapeHtml(metadata)}</span>
        ${crossDateNote}
      </span>
      <span class="payment-receipt-explorer-open-label">打开 PDF ↗</span>
    </a>
  `;
}

function paymentReceiptExplorerFolder() {
  if (paymentReceiptExplorerLevel !== "files") return null;
  return paymentReceiptExplorerTree.folders.find((folder) => folder.paymentDate === paymentReceiptExplorerDate) || null;
}

function handlePaymentReceiptExplorerClick(event) {
  if (event.target.closest("[data-close-receipt-explorer]")) {
    closePaymentReceiptExplorer();
    return;
  }
  const rootFolder = event.target.closest('[data-receipt-explorer-open="receipts"]');
  if (rootFolder) {
    paymentReceiptExplorerLevel = "dates";
    paymentReceiptExplorerDate = "";
    renderPaymentReceiptExplorer();
    return;
  }
  const dateFolder = event.target.closest("[data-receipt-explorer-date]");
  if (dateFolder) {
    const folder = paymentReceiptExplorerTree.folders.find((item) => item.key === dateFolder.dataset.receiptExplorerDate);
    if (!folder) return;
    paymentReceiptExplorerLevel = "files";
    paymentReceiptExplorerDate = folder.paymentDate;
    renderPaymentReceiptExplorer();
    return;
  }
  const path = event.target.closest("[data-receipt-explorer-path]")?.dataset.receiptExplorerPath;
  if (path === "root" || path === "dates") {
    paymentReceiptExplorerLevel = path;
    paymentReceiptExplorerDate = "";
    renderPaymentReceiptExplorer();
  }
}

function navigatePaymentReceiptExplorerBack() {
  if (paymentReceiptExplorerLevel === "files") {
    paymentReceiptExplorerLevel = "dates";
    paymentReceiptExplorerDate = "";
  } else if (paymentReceiptExplorerLevel === "dates") {
    paymentReceiptExplorerLevel = "root";
  }
  renderPaymentReceiptExplorer();
}

function closePaymentReceiptExplorer({ restoreFocus = true } = {}) {
  const trigger = paymentReceiptExplorerTrigger;
  paymentReceiptExplorerController?.abort();
  paymentReceiptExplorerController = null;
  paymentReceiptExplorerLoading = false;
  paymentReceiptExplorerTrigger = null;
  const panel = $("#paymentReceiptExplorerPanel");
  if (panel) panel.hidden = true;
  syncModalOpenState();
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

async function openPaymentReceiptRegroup(fileId, trigger) {
  if (!fileId) return;
  paymentReceiptRegroupController?.abort();
  const controller = new AbortController();
  paymentReceiptRegroupController = controller;
  activePaymentReceiptRegroupFileId = fileId;
  paymentReceiptRegroupData = null;
  paymentReceiptRegroupTrigger = trigger || null;
  const panel = $("#paymentReceiptRegroupPanel");
  panel.hidden = false;
  syncModalOpenState();
  $("#paymentReceiptRegroupTitle").textContent = "修正 PDF 拆页";
  $("#paymentReceiptRegroupPages").innerHTML = '<div class="empty payment-receipt-regroup-loading">正在读取页级识别结果……</div>';
  $("#paymentReceiptRegroupGroups").value = "";
  $("#paymentReceiptRegroupBlankPages").value = "";
  $("#paymentReceiptRegroupSubmit").disabled = true;
  $("#paymentReceiptRegroupSource").href = paymentReceiptPendingFileUrl(fileId);
  try {
    const response = await fetch(`./api/payment-receipt-files/${encodeURIComponent(fileId)}/pages`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (activePaymentReceiptRegroupFileId !== fileId) return;
    const blankPages = Array.isArray(payload.blankPages) ? payload.blankPages : [];
    let groups = Array.isArray(payload.groups) ? payload.groups.filter((group) => Array.isArray(group) && group.length) : [];
    if (!groups.length && payload.file?.pageCount && blankPages.length < payload.file.pageCount) {
      groups = [Array.from({ length: payload.file.pageCount }, (_, index) => index + 1).filter((page) => !blankPages.includes(page))];
    }
    paymentReceiptRegroupData = { ...payload, groups, blankPages };
    $("#paymentReceiptRegroupTitle").textContent = payload.file?.filename || "修正 PDF 拆页";
    $("#paymentReceiptRegroupGroups").value = formatPaymentReceiptPageGroups(groups);
    $("#paymentReceiptRegroupBlankPages").value = formatPaymentReceiptPageList(blankPages);
    $("#paymentReceiptRegroupPages").innerHTML = renderPaymentReceiptRegroupPages(payload.pages || []);
    $("#paymentReceiptRegroupSubmit").disabled = false;
    $("#paymentReceiptRegroupGroups").focus({ preventScroll: true });
  } catch (error) {
    if (error.name === "AbortError") return;
    $("#paymentReceiptRegroupPages").innerHTML = `<div class="empty payment-receipt-regroup-loading error">读取失败：${escapeHtml(error.message || "未知错误")}</div>`;
    showToast(`拆页信息读取失败：${error.message || "请稍后重试"}`);
  } finally {
    if (paymentReceiptRegroupController === controller) paymentReceiptRegroupController = null;
  }
}

function renderPaymentReceiptRegroupPages(pages) {
  const labels = {
    blank: "空白页",
    receipt_start: "新单据首页",
    continuation: "续页/附件",
    uncertain: "边界待确认",
  };
  return pages.map((page) => `
    <article class="payment-receipt-regroup-page ${escapeAttribute(page.classification || "uncertain")}">
      <header><strong>第 ${escapeHtml(page.pageNumber)} 页</strong><span>${escapeHtml(labels[page.classification] || "待确认")} · ${escapeHtml(`${Math.round((Number(page.confidence) || 0) * 100)}%`)}</span></header>
      ${page.boundaryEvidence ? `<p>${escapeHtml(page.boundaryEvidence)}</p>` : ""}
      <details><summary>查看识别文字</summary><pre>${escapeHtml(page.recognizedText || "未识别到文字")}</pre></details>
    </article>
  `).join("");
}

async function savePaymentReceiptRegroup(event) {
  event.preventDefault();
  if (!activePaymentReceiptRegroupFileId || !paymentReceiptRegroupData?.file?.pageCount) return;
  let normalized;
  try {
    normalized = normalizePaymentReceiptPageGroups({
      groups: parsePaymentReceiptPageGroups($("#paymentReceiptRegroupGroups").value),
      blankPages: parsePaymentReceiptPageList($("#paymentReceiptRegroupBlankPages").value),
    }, paymentReceiptRegroupData.file.pageCount);
  } catch (error) {
    showToast(`页码设置有误：${error.message}`);
    return;
  }
  const boundariesChanged = JSON.stringify(normalized.groups) !== JSON.stringify(paymentReceiptRegroupData.groups)
    || JSON.stringify(normalized.blankPages) !== JSON.stringify(paymentReceiptRegroupData.blankPages);
  const hasMatchedReceipt = paymentReceiptRegroupData.receipts?.some((receipt) => receipt.matchStatus === "matched");
  if (boundariesChanged && hasMatchedReceipt && !window.confirm("变更拆页边界会解除受影响单据的项目对应；页组完全不变的对应关系会保留。是否继续？")) return;

  const button = $("#paymentReceiptRegroupSubmit");
  button.disabled = true;
  try {
    const response = await fetch(`./api/payment-receipt-files/${encodeURIComponent(activePaymentReceiptRegroupFileId)}/regroup`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ ...normalized, expectedUpdatedAt: paymentReceiptRegroupData.file.updatedAt }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    closePaymentReceiptRegroup({ restoreFocus: false });
    await loadPaymentReceipts({ silent: true });
    showToast(`已按人工设置生成 ${payload.receiptCount} 张单据；保留 ${payload.preservedMatchCount} 个未变页组的项目对应。`);
  } catch (error) {
    button.disabled = false;
    showToast(`拆页修正失败：${error.message || "请稍后重试"}`);
  }
}

function closePaymentReceiptRegroup({ restoreFocus = true } = {}) {
  const trigger = paymentReceiptRegroupTrigger;
  paymentReceiptRegroupController?.abort();
  paymentReceiptRegroupController = null;
  activePaymentReceiptRegroupFileId = "";
  paymentReceiptRegroupData = null;
  paymentReceiptRegroupTrigger = null;
  $("#paymentReceiptRegroupPanel").hidden = true;
  syncModalOpenState();
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function parsePaymentReceiptPageGroups(value) {
  const text = String(value || "").trim();
  return text ? text.split(/[;；]+/).filter((part) => part.trim()).map(parsePaymentReceiptPageList) : [];
}

function parsePaymentReceiptPageList(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const pages = [];
  for (const token of text.split(/[,，、\s]+/).filter(Boolean)) {
    const range = token.match(/^(\d+)(?:\s*[-—~至]\s*(\d+))?$/);
    if (!range) throw new Error(`无法识别页码“${token}”`);
    const start = Number(range[1]);
    const end = Number(range[2] || range[1]);
    if (end < start) throw new Error(`页码范围“${token}”顺序相反`);
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  return pages;
}

function formatPaymentReceiptPageGroups(groups) {
  return (groups || []).map(formatPaymentReceiptPageList).join("; ");
}

function formatPaymentReceiptPageList(values) {
  const pages = [...new Set((values || []).map(Number).filter(Number.isInteger))].sort((left, right) => left - right);
  const parts = [];
  for (let index = 0; index < pages.length; index += 1) {
    const start = pages[index];
    let end = start;
    while (index + 1 < pages.length && pages[index + 1] === end + 1) end = pages[++index];
    parts.push(end === start ? String(start) : `${start}-${end}`);
  }
  return parts.join(",");
}

function receiptsForTranche(projectId, trancheId) {
  const projectReceipts = projectPaymentReceiptCache.get(projectId)
    || paymentReceipts.filter((receipt) => receipt.projectId === projectId);
  return projectReceipts.filter((receipt) => receipt.trancheId === trancheId);
}

function renderTranchePaymentReceipts(projectId, tranche) {
  return `
    <section class="tranche-payment-receipts" data-tranche-receipts data-project-id="${escapeAttribute(projectId)}" data-tranche-id="${escapeAttribute(tranche.id)}">
      ${renderTranchePaymentReceiptContent(projectId, tranche.id)}
    </section>
  `;
}

function renderTranchePaymentReceiptContent(projectId, trancheId) {
  const receipts = receiptsForTranche(projectId, trancheId);
  if (projectPaymentReceiptLoads.has(projectId) && !projectPaymentReceiptCache.has(projectId)) {
    return '<div class="tranche-payment-receipt-empty"><strong>缴款单</strong><span>正在读取对应单据……</span></div>';
  }
  if (projectPaymentReceiptErrors.has(projectId) && !projectPaymentReceiptCache.has(projectId)) {
    return `<div class="tranche-payment-receipt-empty error"><strong>缴款单读取失败</strong><span>${escapeHtml(projectPaymentReceiptErrors.get(projectId))}</span></div>`;
  }
  if (!receipts.length) {
    return '<div class="tranche-payment-receipt-empty"><strong>缴款单</strong><span>尚未收到或尚未对应</span></div>';
  }
  return `
    <div class="tranche-payment-receipt-head"><strong>缴款单</strong><span>${receipts.length} 张已对应</span></div>
    <div class="tranche-payment-receipt-list">
      ${receipts.map((receipt) => `
        <a href="${paymentReceiptFileUrl(receipt.id)}" target="_blank" rel="noopener">
          <span>${escapeHtml(receipt.paymentDate || receipt.archiveDate || "缴款日期待识别")} · ${escapeHtml(receipt.sourcePageLabel ? `原附件第 ${receipt.sourcePageLabel} 页` : receipt.sourceFilename || "PDF")}</span>
          <strong>查看缴款单</strong>
        </a>
      `).join("")}
    </div>
  `;
}

function refreshVisibleProjectReceiptPanels() {
  $$('[data-tranche-receipts]').forEach((panel) => {
    panel.innerHTML = renderTranchePaymentReceiptContent(panel.dataset.projectId, panel.dataset.trancheId);
  });
}

function bindRouteHashNavigation() {
  window.addEventListener("hashchange", applyRouteFromHash);
  window.matchMedia(LEDGER_MOBILE_BREAKPOINT).addEventListener?.("change", () => {
    syncLedgerMobilePane();
    scheduleLiquidMotionSync();
  });
}

function applyRouteFromHash() {
  const route = parseRouteFromHash();
  if (!route?.view) {
    if (isCompactLedger()) {
      ledgerMobilePane = "list";
      switchView("ledger", { updateHash: false });
      renderProjectWorkspace();
      restoreLedgerMobileViewport();
    }
    return;
  }
  if (["protocol-transfer", "secondary-inventory"].includes(route.view)) route.view = "secondary-trading";
  if (!$(`.view[data-view="${route.view}"]`)) return;
  if (route.view === "ledger") ledgerMobilePane = ledgerMobilePaneFromRoute(route);
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
    pane: params.get("pane") || "",
  };
}

function isCompactLedger() {
  return window.matchMedia(LEDGER_MOBILE_BREAKPOINT).matches;
}

function ledgerMobilePaneFromRoute(route = {}) {
  if (route.target === "mail") return "overview";
  if (LEDGER_MOBILE_PANES.has(route.pane)) return route.pane;
  return route.target ? "detail" : "list";
}

function navigateLedgerMobilePane(pane, options = {}) {
  const { projectId = "", kind = "", step = "", replace = false, focusSelected = false } = options;
  if (projectId) selectedProjectId = projectId;
  const normalizedPane = LEDGER_MOBILE_PANES.has(pane) ? pane : "list";
  ledgerMobilePane = normalizedPane === "detail" && !selectedProjectId ? "list" : normalizedPane;

  const params = new URLSearchParams();
  params.set("pane", ledgerMobilePane);
  if (ledgerMobilePane === "detail" && selectedProjectId) params.set("target", selectedProjectId);
  if (kind) params.set("kind", kind);
  if (step) params.set("step", step);
  const nextHash = `#ledger?${params.toString()}`;
  if (window.location.hash !== nextHash) {
    history[replace ? "replaceState" : "pushState"](null, "", nextHash);
  }
  applyRouteFromHash();

  if (focusSelected && ledgerMobilePane === "list") {
    requestAnimationFrame(() => {
      $$('[data-project-id]').find((button) => button.dataset.projectId === selectedProjectId)?.focus({ preventScroll: true });
    });
  }
}

function openLedgerProject(projectId, options = {}) {
  const { kind = "", step = "", replace = false, scrollOnDesktop = false } = options;
  if (!projectId) return;
  selectedProjectId = projectId;
  if (isCompactLedger()) {
    if (ledgerMobilePane === "list" && $('.view[data-view="ledger"]')?.classList.contains("active")) {
      ledgerMobileListScrollY = window.scrollY;
    }
    navigateLedgerMobilePane("detail", { projectId, kind, step, replace });
    return;
  }
  switchView("ledger");
  renderProjectWorkspace();
  if (kind === "project-result" || step === "result") openResultEntryPanel(false);
  if (scrollOnDesktop) $("#projectForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeLedgerProjectDetail() {
  navigateLedgerMobilePane("list", { replace: true, focusSelected: true });
}

function restoreLedgerMobileViewport() {
  if (!isCompactLedger()) return;
  requestAnimationFrame(() => {
    const ledgerView = $('.view[data-view="ledger"]');
    if (!ledgerView?.classList.contains("active")) return;
    if (ledgerMobilePane === "list") {
      if (Number.isFinite(ledgerMobileListScrollY)) {
        window.scrollTo({ top: ledgerMobileListScrollY, behavior: "auto" });
      } else {
        ledgerView.querySelector(".project-list-panel")?.scrollIntoView({ behavior: "auto", block: "start" });
      }
      return;
    }
    ledgerView.scrollIntoView({ behavior: "auto", block: "start" });
  });
}

function setLedgerMobileSectionVisibility(element, visible, compact) {
  if (!element) return;
  if (!compact) {
    element.inert = false;
    element.removeAttribute("aria-hidden");
    return;
  }
  element.inert = !visible;
  element.setAttribute("aria-hidden", String(!visible));
}

function syncLedgerMobilePane() {
  const ledgerView = $('.view[data-view="ledger"]');
  if (!ledgerView) return;
  const compact = isCompactLedger();
  const pane = LEDGER_MOBILE_PANES.has(ledgerMobilePane) ? ledgerMobilePane : "list";
  ledgerMobilePane = pane;
  ledgerView.dataset.mobilePane = pane;

  $$("[data-ledger-mobile-pane]").forEach((button) => {
    const active = button.dataset.ledgerMobilePane === "overview"
      ? pane === "overview"
      : pane === "list" || pane === "detail";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  setLedgerMobileSectionVisibility(ledgerView.querySelector(":scope > .ledger-command-panel"), pane === "overview", compact);
  setLedgerMobileSectionVisibility(ledgerView.querySelector(":scope > .ledger-todo-zone"), pane === "overview", compact);
  setLedgerMobileSectionVisibility(ledgerView.querySelector(".project-list-panel"), pane === "list", compact);
  setLedgerMobileSectionVisibility(ledgerView.querySelector(".project-detail-panel"), pane === "detail", compact);

  const selected = (state.projects || []).find((item) => item.id === selectedProjectId);
  const detailTitle = $("#mobileProjectDetailTitle");
  if (detailTitle) detailTitle.textContent = selected?.shortName || "项目详情";
}

function applyRouteSelection(route = {}) {
  if (route.view === "ledger" && route.target && route.target !== "mail") {
    selectedProjectId = route.target;
  }
  if (route.view === "secondary-trading" && route.target) {
    selectedProtocolTransferId = route.target;
    protocolTransferEditMode = true;
    activeSecondaryWorkspacePanel = "protocol";
  }
}

function applyRouteFocus(route = {}) {
  if (route.view === "ledger") {
    renderProjectWorkspace();
    if (isCompactLedger()) {
      const ledgerView = $('.view[data-view="ledger"]');
      if (ledgerMobilePane === "detail") {
        const opensResultEntry = route.step === "result" || route.kind === "project-result";
        if (opensResultEntry) openResultEntryPanel(false);
        requestAnimationFrame(() => {
          ledgerView?.scrollIntoView({ behavior: "auto", block: "start" });
          $(opensResultEntry ? "#resultEntryDialog" : "#mobileProjectDetailTitle")?.focus({ preventScroll: true });
        });
      } else if (ledgerMobilePane === "list") {
        restoreLedgerMobileViewport();
      } else {
        requestAnimationFrame(() => ledgerView?.scrollIntoView({ behavior: "auto", block: "start" }));
      }
      return;
    }
    if (route.target === "mail") {
      $("#mailPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (route.target) {
      if (route.step === "result" || route.kind === "project-result") openResultEntryPanel(false);
      $("#projectForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  if (route.view === "secondary-trading" && route.target) {
    switchSecondaryWorkspacePanel("protocol");
    renderProtocolTransferWorkspace();
    $("#protocolTransferForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function switchView(viewName, options = {}) {
  const buttons = $$(`.nav-item[data-view-target="${viewName}"]`);
  const button = buttons[0];
  $$(".nav-item").forEach((item) => {
    const active = item.dataset.viewTarget === viewName;
    item.classList.toggle("active", active);
    if (item.classList.contains("android-app-nav-item")) {
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  });
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  $(".main")?.classList.toggle("realtime-mode", viewName === "realtime-quotes");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", viewName === "realtime-quotes" ? "#070a10" : "#f4f6fb");
  realtimeQuoteController?.setActive(viewName === "realtime-quotes");
  if (button) $("#pageTitle").textContent = button.dataset.viewLabel || button.textContent.trim();
  if (viewName === "reminders") renderUnifiedReminders();
  if (viewName === "payment-receipts") renderPaymentReceiptArchive();
  if (viewName === "ledger") syncLedgerMobilePane();
  if (viewName === "database") {
    renderAbsCreditEnhancerOptions();
    renderAbsCreditApprovalList();
    syncIssuerCreditWorkspace();
  }
  if (options.updateHash && window.location.hash !== `#${viewName}`) {
    history.replaceState(null, "", `#${viewName}`);
  }
}

function bindProjectScreenshotTool() {
  const input = $("#projectScreenshotInput");
  const dropzone = $("#projectScreenshotDropzone");
  const dropTarget = $("#projectScreenshotTool") || dropzone;
  const output = $("#projectScreenshotOutput");
  input?.addEventListener("change", handleProjectScreenshotUpload);
  $("#copyProjectScreenshotShortNamesButton")?.addEventListener("click", copyProjectScreenshotShortNames);
  output?.addEventListener("submit", handleProjectScreenshotCorrectionSubmit);
  output?.addEventListener("input", handleProjectScreenshotCorrectionInput);
  output?.addEventListener("change", handleProjectScreenshotBranchChange);
  output?.addEventListener("click", handleProjectScreenshotCorrectionClick);
  window.addEventListener("pagehide", releaseProjectScreenshotWorker, { once: true });
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
  if (!file && input.files?.length) notifyProjectScreenshotFileRequired();
  await processProjectScreenshotFile(file, input);
}

async function handleProjectScreenshotDrop(event) {
  event.preventDefault();
  projectScreenshotDragDepth = 0;
  setProjectScreenshotDragging(false);
  const file = projectScreenshotImageFileFromDataTransfer(event.dataTransfer);
  if (!file) {
    notifyProjectScreenshotFileRequired();
    return;
  }
  await processProjectScreenshotFile(file);
}

async function handleProjectScreenshotPaste(event) {
  const file = projectScreenshotImageFileFromDataTransfer(event.clipboardData);
  if (!file) {
    const containsFile = Array.from(event.clipboardData?.items || []).some((item) => item.kind === "file");
    if (containsFile) notifyProjectScreenshotFileRequired();
    return;
  }
  event.preventDefault();
  await processProjectScreenshotFile(file);
}

function notifyProjectScreenshotFileRequired() {
  const message = "没有找到可识别的图片，请拖入 PNG、JPG 或直接粘贴截图。";
  setProjectScreenshotStatus(message);
  showToast(message);
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
  const validationError = projectScreenshotImageFileValidationError(file);
  if (validationError) {
    showToast(validationError);
    if (input) input.value = "";
    return;
  }

  const sessionId = ++projectScreenshotSessionId;
  projectScreenshotRows = [];
  renderProjectScreenshotResults(projectScreenshotRows);
  setProjectScreenshotBusy(true, "正在 OCR 图片...");
  try {
    await ensureTesseractReady();
    const entries = await recognizeProjectScreenshotEntries(file);
    if (!entries.length) {
      projectScreenshotRows = [createManualProjectScreenshotRow(sessionId)];
      renderProjectScreenshotResults(projectScreenshotRows);
      setProjectScreenshotStatus("未识别到项目，可在下方补录并单条查询。");
      showToast("没有可靠识别结果，已打开补录框。" );
      return;
    }

    projectScreenshotRows = entries.map((entry, index) => ({
      ...entry,
      id: `ocr-${sessionId}-${index}`,
      sessionId,
      revision: 0,
      originalBranch: entry.branch,
      ocrFullName: entry.fullName,
      draftFullName: entry.fullName,
      verifiedFullName: "",
      status: "pending",
      isEditing: false,
    }));
    renderProjectScreenshotResults(projectScreenshotRows);
    const initialRowIds = projectScreenshotRows.map((row) => row.id);
    for (let index = 0; index < initialRowIds.length; index += 1) {
      setProjectScreenshotStatus(`已识别 ${initialRowIds.length} 条，正在查 DM ${index + 1}/${initialRowIds.length}...`);
      const requested = projectScreenshotRows.find((row) => row.id === initialRowIds[index]);
      if (!requested) continue;
      const requestedRevision = requested.revision;
      const lookupController = new AbortController();
      requested.lookupController = lookupController;
      const resolved = await lookupProjectScreenshotEntry(
        { ...requested, lookupController: null, fullName: requested.draftFullName },
        { signal: lookupController.signal },
      );
      const currentIndex = projectScreenshotRows.findIndex((row) => row.id === requested.id);
      const current = projectScreenshotRows[currentIndex];
      if (sessionId !== projectScreenshotSessionId || !current || current.revision !== requestedRevision) continue;
      current.lookupController = null;
      projectScreenshotRows[currentIndex] = finalizeProjectScreenshotLookupRow(current, resolved);
      renderProjectScreenshotResults(projectScreenshotRows);
    }
    projectScreenshotRows = collapseProjectScreenshotRowsWithVerifiedMatches(projectScreenshotRows);
    renderProjectScreenshotResults(projectScreenshotRows);
    const copiedCount = projectScreenshotResolvedShortNames().length;
    const finalCount = projectScreenshotRows.length;
    setProjectScreenshotStatus(copiedCount
      ? `完成：${copiedCount}/${finalCount} 条已匹配简称。`
      : `完成：${finalCount} 条均未匹配到 DM 简称。`);
  } catch (error) {
    if (sessionId === projectScreenshotSessionId) {
      projectScreenshotRows = [createManualProjectScreenshotRow(sessionId)];
      renderProjectScreenshotResults(projectScreenshotRows);
      setProjectScreenshotStatus(`${error.message || "截图识别失败"}，可在下方补录。`);
      showToast("OCR 未完成，已保留手工补录入口。" );
    }
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
  const list = Array.from(files || []);
  return list.find(isProjectScreenshotImageFile) || list[0] || null;
}

function isProjectScreenshotImageFile(file) {
  return !projectScreenshotImageFileValidationError(file);
}

function projectScreenshotImageFileValidationError(file) {
  if (!file || !Number(file.size)) return "图片文件为空，请重新选择。";
  if (Number(file.size) > PROJECT_SCREENSHOT_MAX_FILE_BYTES) return "图片超过 30MB，请先裁剪或分段上传。";
  const type = String(file.type || "").toLowerCase();
  if (type && !PROJECT_SCREENSHOT_IMAGE_MIME_TYPES.has(type)) return "请上传 PNG、JPEG、WebP、HEIC 等项目表图片。";
  if (!type && !PROJECT_SCREENSHOT_IMAGE_EXTENSIONS.test(file.name || "")) return "无法确认图片格式，请改用 PNG 或 JPEG。";
  return "";
}

async function recognizeProjectScreenshotEntries(file) {
  const image = await loadProjectScreenshotImage(file);
  const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
  projectScreenshotOcrPassBudget = compact ? 72 : 120;
  try {
    const originalLayout = analyzeProjectScreenshotLayout(image);
    const originalEntries = await recognizeProjectScreenshotImage(image, "", { layout: originalLayout });
    let bestEntries = originalEntries;

    if (!projectScreenshotLayoutIsStructured(originalLayout)) {
      let bestDeskew = null;
      const originalLayoutScore = projectScreenshotLayoutScore(originalLayout);
      for (const degrees of [-3, -2, -1, 1, 2, 3]) {
        let rotated = null;
        try {
          rotated = createProjectScreenshotRotatedCanvas(image, degrees);
          const layout = analyzeProjectScreenshotLayout(rotated);
          const score = projectScreenshotLayoutScore(layout);
          if (!bestDeskew || score > bestDeskew.score) {
            bestDeskew = { degrees, score, structured: projectScreenshotLayoutIsStructured(layout) };
          }
        } catch {
          // A failed deskew canvas/probe must not block the original OCR result.
        } finally {
          if (rotated) {
            rotated.width = 1;
            rotated.height = 1;
          }
        }
      }
      if (bestDeskew?.score > originalLayoutScore + 10) {
        let rotated = null;
        try {
          rotated = createProjectScreenshotRotatedCanvas(image, bestDeskew.degrees);
          const layout = analyzeProjectScreenshotLayout(rotated);
          const probe = await recognizeProjectScreenshotImage(rotated, `校正 ${bestDeskew.degrees}° 探测`, { probeOnly: true, layout });
          if (probe.length) {
            const entries = await recognizeProjectScreenshotImage(rotated, `校正 ${bestDeskew.degrees}°`, { layout });
            if (projectScreenshotOcrResultScore(entries) > projectScreenshotOcrResultScore(bestEntries)) bestEntries = entries;
            if (bestDeskew.structured && isReliableProjectScreenshotOcrResult(bestEntries)) return bestEntries;
          }
        } catch {
          // Keep the best completed result.
        } finally {
          if (rotated) {
            rotated.width = 1;
            rotated.height = 1;
          }
        }
      }
      if (isStrongUnstructuredProjectScreenshotOcrResult(bestEntries)) return bestEntries;
    }

    if (projectScreenshotLayoutIsStructured(originalLayout) && isReliableProjectScreenshotOcrResult(bestEntries)) {
      return bestEntries;
    }

    for (const degrees of [90, 270, 180]) {
      let rotated = null;
      try {
        rotated = createProjectScreenshotRotatedCanvas(image, degrees);
        const layout = analyzeProjectScreenshotLayout(rotated);
        const probe = await recognizeProjectScreenshotImage(rotated, `旋转 ${degrees}° 探测`, { probeOnly: true, layout });
        if (!probe.length) continue;
        const entries = await recognizeProjectScreenshotImage(rotated, `旋转 ${degrees}°`, { layout });
        if (projectScreenshotOcrResultScore(entries) > projectScreenshotOcrResultScore(bestEntries)) bestEntries = entries;
        if (isReliableProjectScreenshotOcrResult(entries)) return entries;
      } catch {
        // Continue to the next orientation when a canvas cannot be allocated.
      } finally {
        if (rotated) {
          rotated.width = 1;
          rotated.height = 1;
        }
      }
    }
    return bestEntries;
  } finally {
    projectScreenshotOcrProgressContext = null;
    projectScreenshotOcrPassBudget = null;
    releaseProjectScreenshotImage(image);
  }
}

async function recognizeProjectScreenshotImage(image, orientationLabel = "", { probeOnly = false, layout = null } = {}) {
  const availableTargets = createProjectScreenshotOcrTargets(image, layout || analyzeProjectScreenshotLayout(image));
  const requestedTargets = probeOnly
    ? selectProjectScreenshotOrientationProbes(availableTargets)
    : limitProjectScreenshotOcrTargets(availableTargets);
  const targets = requestedTargets.slice(0, Math.max(0, projectScreenshotOcrPassBudget ?? requestedTargets.length));
  const passes = [];
  const passErrors = [];
  let successfulPasses = 0;
  const worker = await getProjectScreenshotWorker();
  for (let index = 0; index < targets.length; index += 1) {
    if (projectScreenshotOcrPassBudget !== null) {
      if (projectScreenshotOcrPassBudget <= 0) break;
      projectScreenshotOcrPassBudget -= 1;
    }
    const target = targets[index];
    const label = [orientationLabel, target.label].filter(Boolean).join(" · ");
    projectScreenshotOcrProgressContext = { label, index, total: targets.length };
    setProjectScreenshotStatus(`正在 OCR ${label} ${index + 1}/${targets.length}...`);
    let canvas = null;
    try {
      canvas = target.createCanvas();
      if (!canvas) continue;
      const pageSegMode = window.Tesseract.PSM?.[target.pageSegMode]
        || { SINGLE_BLOCK: "6", SINGLE_LINE: "7", SPARSE_TEXT: "11" }[target.pageSegMode]
        || "6";
      if (worker?.setParameters) {
        await worker.setParameters({
          tessedit_pageseg_mode: pageSegMode,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
      }
      const result = worker
        ? await worker.recognize(canvas)
        : await window.Tesseract.recognize(canvas, "chi_sim+eng", {
          logger: (message) => updateProjectScreenshotOcrProgress(message, label, index, targets.length),
          tessedit_pageseg_mode: pageSegMode,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
      const physicalRows = groupProjectScreenshotOcrPhysicalRows(result?.data?.lines || []);
      if (physicalRows.length) {
        const baseSourceKey = target.sourceKey || `target:${index}`;
        const sourceKeyForPhysicalRow = (row) => target.kind === "row"
          ? baseSourceKey
          : target.sourceRowKeyForBbox?.(row.bbox)
            || `${baseSourceKey}:y:${Math.round((row.bbox.y0 + row.bbox.y1) / 20)}`;
        physicalRows.forEach((row, rowIndex) => passes.push({
          label: `${label} 物理行 ${rowIndex + 1}`,
          voteKey: baseSourceKey,
          sourceKey: sourceKeyForPhysicalRow(row),
          text: row.text,
          confidence: row.confidence || result?.data?.confidence,
        }));
        for (let rowIndex = 0; rowIndex + 1 < physicalRows.length; rowIndex += 1) {
          const firstLine = physicalRows[rowIndex].text;
          if (parseProjectScreenshotOcrText(firstLine).length) continue;
          if (!/20\d{2}/.test(firstLine) && !PROJECT_SCREENSHOT_BRANCHES.some((branch) => firstLine.includes(branch))) continue;
          const windowRows = physicalRows.slice(rowIndex, rowIndex + 3);
          passes.push({
            label: `${label} 连续行 ${rowIndex + 1}`,
            voteKey: baseSourceKey,
            sourceKey: sourceKeyForPhysicalRow(windowRows[0]),
            text: windowRows.map((row) => row.text).join("\n"),
            confidence: Math.round(windowRows.reduce((sum, row) => sum + (row.confidence || 0), 0) / windowRows.length),
          });
        }
        if (Number(result?.data?.confidence) >= 82) {
          passes.push({
            label: `${label} 行序`,
            voteKey: baseSourceKey,
            sourceKey: target.kind === "row" ? baseSourceKey : `${baseSourceKey}:layout`,
            text: physicalRows.map((row) => row.text).join("\n"),
            confidence: result?.data?.confidence,
          });
        }
      } else {
        passes.push({
          label,
          voteKey: target.sourceKey || `target:${index}`,
          sourceKey: target.sourceKey || "",
          text: result?.data?.text || "",
          confidence: result?.data?.confidence,
        });
      }
      successfulPasses += 1;
    } catch (error) {
      passErrors.push(`${label}: ${error?.message || "识别失败"}`);
    } finally {
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
  }
  if (!successfulPasses && passErrors.length) throw new Error(`OCR 识别失败：${passErrors[0]}`);
  return mergeProjectScreenshotOcrPasses(passes);
}

function selectProjectScreenshotOrientationProbes(targets = []) {
  const priorityGroups = [
    targets.filter((target) => target.sourceKey?.startsWith("column:")),
    targets.filter((target) => target.sourceKey?.startsWith("region:0:")),
    targets.filter((target) => target.kind === "row"),
    targets,
  ];
  const candidates = priorityGroups.find((group) => group.length) || [];
  const indexes = [...new Set([0, Math.floor((candidates.length - 1) / 2), candidates.length - 1])];
  return indexes.map((index) => candidates[index]).filter(Boolean);
}

function limitProjectScreenshotOcrTargets(targets = []) {
  const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
  const limit = compact ? 72 : 96;
  if (targets.length <= limit) return targets;
  const sampleEvenly = (items, count) => {
    if (items.length <= count) return items;
    return Array.from({ length: count }, (_, index) => (
      items[Math.round(index * (items.length - 1) / Math.max(1, count - 1))]
    )).filter(Boolean);
  };
  const selected = [];
  const selectedSet = new Set();
  const addTargets = (items, count = items.length) => {
    for (const target of sampleEvenly(items, Math.max(0, count))) {
      if (!selectedSet.has(target) && selected.length < limit) {
        selected.push(target);
        selectedSet.add(target);
      }
    }
  };

  // Column chunks and the primary fallback region are continuous vertical
  // coverage. Preserve them before sampling per-row/secondary variants.
  addTargets(targets.filter((target) => target.sourceKey?.startsWith("column:")));
  addTargets(targets.filter((target) => target.sourceKey?.startsWith("region:0:")));
  const remaining = () => Math.max(0, limit - selected.length);
  addTargets(
    targets.filter((target) => target.kind === "row" && !selectedSet.has(target)),
    Math.min(remaining(), Math.floor(limit / 3)),
  );
  addTargets(targets.filter((target) => !selectedSet.has(target)), remaining());
  return selected;
}

function isReliableProjectScreenshotOcrResult(entries = []) {
  return entries.length >= 3 || entries.some((entry) => Number(entry.ocrVotes) >= 2);
}

function projectScreenshotOcrResultScore(entries = []) {
  return entries.length * 100
    + entries.reduce((sum, entry) => sum + Math.min(10, Number(entry.ocrVotes) || 0), 0);
}

function projectScreenshotLayoutIsStructured(layout) {
  return Boolean(layout?.columns && layout?.rowBands?.length >= 2);
}

function projectScreenshotLayoutScore(layout) {
  return (layout?.columns ? 100 : 0) + Math.min(80, Number(layout?.rowBands?.length || 0) * 8);
}

function isStrongUnstructuredProjectScreenshotOcrResult(entries = []) {
  return entries.length >= 5 && entries.filter((entry) => Number(entry.ocrVotes) >= 2).length >= 2;
}

function createProjectScreenshotRotatedCanvas(image, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const rotatedWidth = Math.ceil(image.width * cosine + image.height * sine);
  const rotatedHeight = Math.ceil(image.width * sine + image.height * cosine);
  const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
  const maxPixels = compact ? 9_000_000 : 18_000_000;
  const maxDimension = compact ? 16_000 : 24_000;
  const scale = Math.min(
    1,
    Math.sqrt(maxPixels / Math.max(1, rotatedWidth * rotatedHeight)),
    maxDimension / Math.max(1, rotatedWidth, rotatedHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rotatedWidth * scale));
  canvas.height = Math.max(1, Math.round(rotatedHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器无法分配 OCR 画布，请分段上传截图。");
  context.fillStyle = projectScreenshotCanvasBackground(image);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(
    image,
    -Math.round(image.width * scale) / 2,
    -Math.round(image.height * scale) / 2,
    Math.round(image.width * scale),
    Math.round(image.height * scale),
  );
  return canvas;
}

function releaseProjectScreenshotImage(image) {
  if (typeof image?.close === "function") {
    image.close();
    return;
  }
  if (typeof image?.getContext === "function") {
    image.width = 1;
    image.height = 1;
  }
}

async function getProjectScreenshotWorker() {
  if (!window.Tesseract?.createWorker) return null;
  if (projectScreenshotWorker) return projectScreenshotWorker;
  if (!projectScreenshotWorkerPromise) {
    const generation = projectScreenshotWorkerGeneration;
    projectScreenshotWorkerPromise = window.Tesseract.createWorker("chi_sim+eng", window.Tesseract.OEM?.LSTM_ONLY, {
      logger: (message) => {
        const context = projectScreenshotOcrProgressContext || {};
        updateProjectScreenshotOcrProgress(message, context.label, context.index, context.total);
      },
    }).then((worker) => {
      if (generation !== projectScreenshotWorkerGeneration) {
        worker?.terminate?.();
        throw new Error("OCR worker was released during initialization");
      }
      projectScreenshotWorker = worker;
      return worker;
    });
  }
  const pendingWorker = projectScreenshotWorkerPromise;
  try {
    return await pendingWorker;
  } catch (error) {
    if (projectScreenshotWorkerPromise === pendingWorker) projectScreenshotWorkerPromise = null;
    throw error;
  }
}

function releaseProjectScreenshotWorker() {
  projectScreenshotWorkerGeneration += 1;
  const worker = projectScreenshotWorker;
  projectScreenshotWorker = null;
  projectScreenshotWorkerPromise = null;
  try {
    worker?.terminate?.();
  } catch {
    // Page teardown must not block navigation.
  }
}

async function loadProjectScreenshotImage(file) {
  const header = inspectProjectScreenshotImageHeader(await file.slice(0, 512 * 1024).arrayBuffer());
  if (!header?.width || !header?.height) {
    throw new Error("无法安全读取图片尺寸，请转为 PNG 或 JPEG 后重试");
  }
  const limits = projectScreenshotDecodedImageLimits();
  const planned = projectScreenshotResizeDimensions(header.width, header.height, limits);
  if (planned?.scale < 1 && !projectScreenshotResizeRetainsReadableWidth(header.width, planned.width)) {
    throw new Error("长截图压缩后文字会过小，请按页面上、中、下分段上传，避免静默识别错误。");
  }
  let bitmapError = null;
  if (window.createImageBitmap) {
    try {
      const options = planned && planned.scale < 1
        ? {
          imageOrientation: "from-image",
          resizeWidth: planned.width,
          resizeHeight: planned.height,
          resizeQuality: "high",
        }
        : { imageOrientation: "from-image" };
      const bitmap = await window.createImageBitmap(file, options);
      return await constrainProjectScreenshotDecodedImage(bitmap, limits);
    } catch (error) {
      bitmapError = error;
    }
  }
  if (planned && planned.scale < 1) {
    throw new Error("图片尺寸过大，当前浏览器无法安全压缩；请裁剪或分段上传");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(
        /heic|heif/i.test(`${file.type} ${file.name}`)
          ? "当前浏览器无法读取 HEIC，请转为 PNG 或 JPEG"
          : `图片读取失败${bitmapError?.message ? `：${bitmapError.message}` : ""}`,
      ));
    });
    image.src = url;
    return await constrainProjectScreenshotDecodedImage(await loaded, limits);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function projectScreenshotDecodedImageLimits() {
  const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
  return compact
    ? { maxPixels: 18_000_000, maxDimension: 16_000 }
    : { maxPixels: 36_000_000, maxDimension: 24_000 };
}

async function constrainProjectScreenshotDecodedImage(image, limits) {
  const planned = projectScreenshotResizeDimensions(image.width, image.height, limits);
  if (!planned || planned.scale >= 1 || !window.createImageBitmap) return image;
  try {
    const resized = await window.createImageBitmap(image, {
      resizeWidth: planned.width,
      resizeHeight: planned.height,
      resizeQuality: "high",
    });
    image.close?.();
    return resized;
  } catch {
    image.close?.();
    throw new Error("图片像素过大，请裁剪或分段上传");
  }
}

function createProjectScreenshotOcrTargets(image, layout = analyzeProjectScreenshotLayout(image)) {
  const { rowBands, columns, contentBounds } = layout;
  const targets = [];
  const rowTargets = rowBands.length >= 2 && columns
    ? createProjectScreenshotCellRowTargets(image, rowBands, columns)
    : [];
  targets.push(...rowTargets);
  const rowChunks = chunkProjectScreenshotRowBands(rowBands);
  const primaryRegion = projectScreenshotPrimaryOcrRegion(image, columns, contentBounds);
  if (rowBands.length >= 2 && columns) {
    rowChunks.forEach((chunk, index) => targets.push({
      label: `分行债券列 ${index + 1}/${rowChunks.length}`,
      sourceKey: `column:${index}`,
      pageSegMode: "SINGLE_BLOCK",
      sourceRowKeyForBbox: (bbox) => projectScreenshotChunkSourceRowKey(
        bbox,
        chunk,
        columns.branch.width + columns.name.width,
        50,
      ),
      createCanvas: () => createProjectScreenshotColumnCanvas(image, chunk, columns),
    }));
  }
  if (rowBands.length >= 3) {
    rowChunks.forEach((chunk, index) => targets.push({
      label: `表格行 ${index + 1}/${rowChunks.length}`,
      sourceKey: `rows:${index}`,
      pageSegMode: "SINGLE_BLOCK",
      sourceRowKeyForBbox: (bbox) => projectScreenshotChunkSourceRowKey(
        bbox,
        chunk,
        primaryRegion.width,
        0,
      ),
      createCanvas: () => createProjectScreenshotRowCanvas(image, chunk, primaryRegion),
    }));
  }
  targets.push(...createProjectScreenshotFallbackTargets(image, {
    columns,
    contentBounds,
    primaryRegion,
    rowBands,
  }));
  return targets;
}

function chunkProjectScreenshotRowBands(rowBands = []) {
  const chunkSize = window.matchMedia?.("(max-width: 760px)")?.matches ? 10 : 14;
  const chunks = [];
  for (let index = 0; index < rowBands.length; index += chunkSize) chunks.push(rowBands.slice(index, index + chunkSize));
  return chunks;
}

function createProjectScreenshotCellRowTargets(image, rowBands = [], columns) {
  const maxRows = window.matchMedia?.("(max-width: 760px)")?.matches ? 24 : 32;
  const selectedRows = rowBands.length <= maxRows
    ? rowBands.map((band, rowIndex) => ({ band, rowIndex }))
    : Array.from({ length: maxRows }, (_, index) => {
        const rowIndex = Math.round(index * (rowBands.length - 1) / (maxRows - 1));
        return { band: rowBands[rowIndex], rowIndex };
      });
  return selectedRows.map(({ band, rowIndex }) => ({
    label: `表格第 ${rowIndex + 1} 行`,
    sourceKey: `source-y:${Math.round(band.y + band.height / 2)}:${Math.round(band.height)}`,
    pageSegMode: band.height / Math.max(1, columns.name.width) >= 0.14
      ? "SINGLE_BLOCK"
      : "SINGLE_LINE",
    kind: "row",
    createCanvas: () => createProjectScreenshotCellRowCanvas(image, band, columns),
  }));
}

function projectScreenshotPrimaryOcrRegion(image, columns, contentBounds) {
  const bounds = contentBounds || { x: 0, y: 0, width: image.width, height: image.height };
  if (!columns) {
    return {
      x: bounds.x,
      y: bounds.y,
      width: Math.max(1, Math.min(bounds.width, Math.round(bounds.width * 0.7))),
      height: bounds.height,
    };
  }
  const margin = Math.max(8, Math.round(image.width * 0.006));
  const left = Math.max(bounds.x, Math.min(columns.branch.x, columns.name.x) - margin);
  const right = Math.min(
    bounds.x + bounds.width,
    Math.max(columns.branch.x + columns.branch.width, columns.name.x + columns.name.width) + margin,
  );
  return { x: left, y: bounds.y, width: Math.max(1, right - left), height: bounds.height };
}

function createProjectScreenshotFallbackTargets(image, { columns, contentBounds, primaryRegion, rowBands = [] }) {
  const bounds = contentBounds || { x: 0, y: 0, width: image.width, height: image.height };
  const regions = [];
  const addRegion = (region) => {
    const normalized = {
      x: Math.max(0, Math.round(region.x)),
      y: Math.max(0, Math.round(region.y)),
      width: Math.max(1, Math.min(image.width - Math.max(0, Math.round(region.x)), Math.round(region.width))),
      height: Math.max(1, Math.min(image.height - Math.max(0, Math.round(region.y)), Math.round(region.height))),
    };
    const duplicate = regions.some((existing) => (
      Math.abs(existing.x - normalized.x) < 8
      && Math.abs(existing.width - normalized.width) < 12
      && Math.abs(existing.y - normalized.y) < 8
      && Math.abs(existing.height - normalized.height) < 12
    ));
    if (!duplicate) regions.push(normalized);
  };

  addRegion(primaryRegion);
  if (!columns) {
    addRegion({
      x: bounds.x + Math.round(bounds.width * 0.1),
      y: bounds.y,
      width: Math.round(bounds.width * 0.72),
      height: bounds.height,
    });
  }
  if (!columns || primaryRegion.width < bounds.width * 0.78) addRegion(bounds);

  const targets = [];
  regions.forEach((region, regionIndex) => {
    const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
    const maxSlices = regionIndex === 0 ? (compact ? 8 : 10) : 2;
    const slices = splitProjectScreenshotRegionVertically(region, maxSlices);
    slices.forEach((slice, sliceIndex) => targets.push({
      label: `内容区 ${regionIndex + 1}.${sliceIndex + 1}/${slices.length}`,
      sourceKey: `region:${regionIndex}:${sliceIndex}`,
      pageSegMode: "SPARSE_TEXT",
      sourceRowKeyForBbox: (bbox) => projectScreenshotRegionSourceRowKey(bbox, slice, rowBands),
      createCanvas: () => createProjectScreenshotRegionCanvas(image, slice),
    }));
  });
  return targets;
}

function projectScreenshotRegionSourceRowKey(bbox, region, rowBands = []) {
  if (!bbox || !rowBands.length) return "";
  const padding = 16;
  const scale = projectScreenshotUniformScale(region.width, region.height, padding * 2, padding * 2);
  const canvasCenter = (Number(bbox.y0) + Number(bbox.y1)) / 2;
  if (!Number.isFinite(canvasCenter) || !Number.isFinite(scale) || scale <= 0) return "";
  const sourceCenter = region.y + (canvasCenter - padding) / scale;
  let best = null;
  rowBands.forEach((band, rowIndex) => {
    const bandCenter = band.y + band.height / 2;
    const distance = Math.abs(sourceCenter - bandCenter);
    if (!best || distance < best.distance) best = { rowIndex, band, distance };
  });
  if (!best) return "";
  const tolerance = Math.max(24, best.band.height * 0.7);
  return best.distance <= tolerance
    ? `source-y:${Math.round(best.band.y + best.band.height / 2)}:${Math.round(best.band.height)}`
    : "";
}

function projectScreenshotChunkSourceRowKey(bbox, rowBands = [], sourceWidth = 1, overheadWidth = 0) {
  if (!bbox || !rowBands.length) return "";
  const sourceHeight = rowBands.reduce((sum, band) => sum + Math.max(1, band.height - 4), 0);
  const scale = projectScreenshotUniformScale(
    sourceWidth,
    sourceHeight,
    overheadWidth,
    PROJECT_SCREENSHOT_ROW_GAP * (rowBands.length + 1),
  );
  const center = (Number(bbox.y0) + Number(bbox.y1)) / 2;
  if (!Number.isFinite(center)) return "";
  let targetY = PROJECT_SCREENSHOT_ROW_GAP;
  let best = null;
  for (const band of rowBands) {
    const height = Math.max(1, band.height - 4);
    if (height < 20) continue;
    const targetHeight = Math.max(1, Math.round(height * scale));
    const distance = Math.abs(center - (targetY + targetHeight / 2));
    if (!best || distance < best.distance) best = { band, distance, targetHeight };
    targetY += targetHeight + PROJECT_SCREENSHOT_ROW_GAP;
  }
  if (!best || best.distance > best.targetHeight * 0.75 + PROJECT_SCREENSHOT_ROW_GAP) return "";
  return `source-y:${Math.round(best.band.y + best.band.height / 2)}:${Math.round(best.band.height)}`;
}

function splitProjectScreenshotRegionVertically(region, maxSlices = 8) {
  const padding = 16;
  const { maxPixels, maxWidth, maxHeight } = projectScreenshotCanvasLimits();
  const scale = Math.min(
    projectScreenshotDesiredScale(region.width),
    Math.max(0.01, (maxWidth - padding * 2) / region.width),
  );
  const targetWidth = region.width * scale + padding * 2;
  const maxTargetHeight = Math.max(
    180,
    Math.min(maxHeight - padding * 2, maxPixels / Math.max(1, targetWidth) - padding * 2),
  );
  const naturalSourceHeight = Math.max(160, Math.floor(maxTargetHeight / Math.max(Number.EPSILON, scale)));
  if (region.height <= naturalSourceHeight) return [region];

  // Keep text at a legible scale even for full-page mobile screenshots. The
  // caller's maxSlices is a preference, not a reason to crush 30,000px into a
  // handful of unreadable canvases; a bounded expanded budget is safer.
  const sliceLimit = Math.max(12, Math.min(48, Math.floor(maxSlices) * 6));
  const minimumCappedHeight = Math.ceil(region.height / Math.max(1, sliceLimit * 0.9 + 0.1));
  const maxSourceHeight = Math.max(naturalSourceHeight, minimumCappedHeight);
  const overlap = Math.min(Math.round(maxSourceHeight * 0.1), Math.max(60, Math.round(region.height * 0.02)));
  const stride = Math.max(1, maxSourceHeight - overlap);
  const slices = [];
  for (let y = region.y; y < region.y + region.height; y += stride) {
    const remaining = region.y + region.height - y;
    const height = Math.min(maxSourceHeight, remaining);
    slices.push({ x: region.x, y, width: region.width, height });
    if (height >= remaining) break;
  }
  return slices;
}

function createProjectScreenshotCellRowCanvas(image, band, columns) {
  const combinedWidth = columns.branch.width + columns.name.width;
  const y = Math.max(0, band.y + 2);
  const height = Math.max(1, band.height - 4);
  if (height < 20) return null;
  const gap = 18;
  const padding = 16;
  const scale = projectScreenshotUniformScale(combinedWidth, height, padding * 2 + gap, padding * 2);
  const branchWidth = Math.max(1, Math.round(columns.branch.width * scale));
  const nameWidth = Math.max(1, Math.round(columns.name.width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = padding * 2 + branchWidth + gap + nameWidth;
  canvas.height = Math.max(108, targetHeight + padding * 2);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = projectScreenshotCanvasBackground(image);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const targetY = Math.round((canvas.height - targetHeight) / 2);
  context.drawImage(image, columns.branch.x, y, columns.branch.width, height, padding, targetY, branchWidth, targetHeight);
  context.drawImage(image, columns.name.x, y, columns.name.width, height, padding + branchWidth + gap, targetY, nameWidth, targetHeight);
  enhanceProjectScreenshotCanvas(canvas, "soft");
  return canvas;
}

function createProjectScreenshotRegionCanvas(image, region) {
  const padding = 16;
  const scale = projectScreenshotUniformScale(region.width, region.height, padding * 2, padding * 2);
  const canvas = document.createElement("canvas");
  const targetWidth = Math.max(1, Math.round(region.width * scale));
  const targetHeight = Math.max(1, Math.round(region.height * scale));
  canvas.width = targetWidth + padding * 2;
  canvas.height = targetHeight + padding * 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = projectScreenshotCanvasBackground(image);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, region.x, region.y, region.width, region.height, padding, padding, targetWidth, targetHeight);
  enhanceProjectScreenshotCanvas(canvas, "soft");
  return canvas;
}

function createProjectScreenshotRowCanvas(image, rowBands = [], region) {
  const cropX = Math.max(0, region?.x || 0);
  const cropWidth = Math.max(1, Math.min(image.width - cropX, region?.width || image.width));
  const sourceHeight = rowBands.reduce((sum, band) => sum + Math.max(1, band.height - 4), 0);
  const scale = projectScreenshotUniformScale(
    cropWidth,
    sourceHeight,
    0,
    PROJECT_SCREENSHOT_ROW_GAP * (rowBands.length + 1),
  );
  const scaledRows = rowBands
    .map((band) => ({
      y: Math.max(0, band.y + 2),
      height: Math.max(1, band.height - 4),
      targetHeight: Math.max(1, Math.round(Math.max(1, band.height - 4) * scale)),
    }))
    .filter((band) => band.height >= 20);
  if (!scaledRows.length) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = scaledRows.reduce((sum, band) => sum + band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP, PROJECT_SCREENSHOT_ROW_GAP);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = projectScreenshotCanvasBackground(image);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  let targetY = PROJECT_SCREENSHOT_ROW_GAP;
  for (const band of scaledRows) {
    context.drawImage(image, cropX, band.y, cropWidth, band.height, 0, targetY, canvas.width, band.targetHeight);
    targetY += band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP;
  }
  enhanceProjectScreenshotCanvas(canvas, "binary");
  return canvas;
}

function createProjectScreenshotColumnCanvas(image, rowBands = [], columns) {
  const combinedWidth = columns.branch.width + columns.name.width;
  const sourceHeight = rowBands.reduce((sum, band) => sum + Math.max(1, band.height - 4), 0);
  const gap = 18;
  const padding = 16;
  const scale = projectScreenshotUniformScale(
    combinedWidth,
    sourceHeight,
    padding * 2 + gap,
    PROJECT_SCREENSHOT_ROW_GAP * (rowBands.length + 1),
  );
  const branchWidth = Math.max(1, Math.round(columns.branch.width * scale));
  const nameWidth = Math.max(1, Math.round(columns.name.width * scale));
  const scaledRows = rowBands
    .map((band) => ({
      y: Math.max(0, band.y + 2),
      height: Math.max(1, band.height - 4),
      targetHeight: Math.max(1, Math.round(Math.max(1, band.height - 4) * scale)),
    }))
    .filter((band) => band.height >= 20);
  if (!scaledRows.length) return null;

  const canvas = document.createElement("canvas");
  canvas.width = padding * 2 + branchWidth + gap + nameWidth;
  canvas.height = scaledRows.reduce((sum, band) => sum + band.targetHeight + PROJECT_SCREENSHOT_ROW_GAP, PROJECT_SCREENSHOT_ROW_GAP);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = projectScreenshotCanvasBackground(image);
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

function projectScreenshotDesiredScale(width) {
  if (!Number.isFinite(width) || width <= 0) return 2;
  return Math.min(4, Math.max(1.8, PROJECT_SCREENSHOT_MIN_OCR_WIDTH / width));
}

function projectScreenshotUniformScale(width, height, overheadWidth = 0, overheadHeight = 0) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return 1;
  const { maxPixels, maxWidth, maxHeight } = projectScreenshotCanvasLimits();
  let scale = Math.min(
    projectScreenshotDesiredScale(width),
    Math.max(Number.EPSILON, (maxWidth - overheadWidth) / width),
    Math.max(Number.EPSILON, (maxHeight - overheadHeight) / height),
  );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvasPixels = (width * scale + overheadWidth) * (height * scale + overheadHeight);
    if (canvasPixels <= maxPixels) break;
    scale *= Math.sqrt(maxPixels / canvasPixels) * 0.995;
  }
  return Math.max(Number.EPSILON, scale);
}

function projectScreenshotCanvasLimits() {
  const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
  return compact
    ? { maxPixels: 4_500_000, maxWidth: 2_100, maxHeight: 2_800 }
    : { maxPixels: 9_000_000, maxWidth: 3_050, maxHeight: 5_200 };
}

function analyzeProjectScreenshotLayout(image) {
  const limits = projectScreenshotAnalysisLimits();
  const tiles = buildProjectScreenshotAnalysisTiles(image.width, image.height, limits);
  const layouts = [];
  for (const tile of tiles) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * tile.scale));
    canvas.height = Math.max(1, Math.round(tile.height * tile.scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    try {
      context.fillStyle = projectScreenshotCanvasBackground(image);
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, tile.y, image.width, tile.height, 0, 0, canvas.width, canvas.height);
      normalizeProjectScreenshotCanvasPolarity(canvas);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const scaleX = image.width / canvas.width;
      const scaleY = tile.height / canvas.height;
      const analysisBounds = detectProjectScreenshotContentBounds(data, canvas.width, canvas.height);
      const rowBands = detectProjectScreenshotRowBands(data, canvas.width, canvas.height, analysisBounds)
        .map((band) => ({
          y: Math.max(0, Math.round(tile.y + band.y * scaleY)),
          height: Math.max(1, Math.round(band.height * scaleY)),
        }));
      const analysisColumns = detectProjectScreenshotKeyColumns(data, canvas.width, canvas.height, analysisBounds);
      const columns = analysisColumns ? {
        branch: {
          x: Math.max(0, Math.round(analysisColumns.branch.x * scaleX)),
          width: Math.max(1, Math.round(analysisColumns.branch.width * scaleX)),
        },
        name: {
          x: Math.max(0, Math.round(analysisColumns.name.x * scaleX)),
          width: Math.max(1, Math.round(analysisColumns.name.width * scaleX)),
        },
      } : null;
      layouts.push({
        rowBands,
        columns,
        contentBounds: {
          x: Math.max(0, Math.round(analysisBounds.x * scaleX)),
          y: Math.max(0, Math.round(tile.y + analysisBounds.y * scaleY)),
          width: Math.max(1, Math.round(analysisBounds.width * scaleX)),
          height: Math.max(1, Math.round(analysisBounds.height * scaleY)),
        },
      });
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
  return mergeProjectScreenshotAnalysisLayouts(layouts, image.width, image.height);
}

function mergeProjectScreenshotAnalysisLayouts(layouts = [], imageWidth = 1, imageHeight = 1) {
  const rowBands = mergeProjectScreenshotAnalysisRowBands(layouts.flatMap((layout) => layout.rowBands || []));
  const columnCandidates = layouts.map((layout) => layout.columns).filter(Boolean);
  const median = (values) => {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const columns = columnCandidates.length ? {
    branch: {
      x: Math.max(0, Math.round(median(columnCandidates.map((item) => item.branch.x)))),
      width: Math.max(1, Math.round(median(columnCandidates.map((item) => item.branch.width)))),
    },
    name: {
      x: Math.max(0, Math.round(median(columnCandidates.map((item) => item.name.x)))),
      width: Math.max(1, Math.round(median(columnCandidates.map((item) => item.name.width)))),
    },
  } : null;
  const bounds = layouts.map((layout) => layout.contentBounds).filter(Boolean);
  const left = bounds.length ? Math.min(...bounds.map((item) => item.x)) : 0;
  const top = bounds.length ? Math.min(...bounds.map((item) => item.y)) : 0;
  const right = bounds.length ? Math.max(...bounds.map((item) => item.x + item.width)) : imageWidth;
  const bottom = bounds.length ? Math.max(...bounds.map((item) => item.y + item.height)) : imageHeight;
  return {
    rowBands,
    columns,
    contentBounds: {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(1, Math.min(imageWidth, right) - Math.max(0, left)),
      height: Math.max(1, Math.min(imageHeight, bottom) - Math.max(0, top)),
    },
  };
}

function mergeProjectScreenshotAnalysisRowBands(bands = []) {
  const merged = [];
  const sorted = bands
    .filter((band) => Number.isFinite(band?.y) && Number.isFinite(band?.height) && band.height > 0)
    .sort((left, right) => left.y - right.y || right.height - left.height);
  for (const band of sorted) {
    const existingIndex = merged.findIndex((candidate) => {
      const overlap = Math.max(0, Math.min(candidate.y + candidate.height, band.y + band.height) - Math.max(candidate.y, band.y));
      return overlap / Math.max(1, Math.min(candidate.height, band.height)) >= 0.55;
    });
    if (existingIndex < 0) {
      merged.push({ ...band });
    } else if (band.height > merged[existingIndex].height) {
      merged[existingIndex] = { ...band };
    }
  }
  return merged.sort((left, right) => left.y - right.y);
}

function detectProjectScreenshotContentBounds(data, width, height) {
  const columnInk = new Uint32Array(width);
  const rowInk = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      if (gray >= 238) continue;
      columnInk[x] += 1;
      rowInk[y] += 1;
    }
  }
  const minimumColumnInk = Math.max(2, Math.round(height * 0.002));
  const minimumRowInk = Math.max(2, Math.round(width * 0.002));
  let left = 0;
  let right = width - 1;
  let top = 0;
  let bottom = height - 1;
  while (left < right && columnInk[left] < minimumColumnInk) left += 1;
  while (right > left && columnInk[right] < minimumColumnInk) right -= 1;
  while (top < bottom && rowInk[top] < minimumRowInk) top += 1;
  while (bottom > top && rowInk[bottom] < minimumRowInk) bottom -= 1;
  if (right - left < width * 0.12 || bottom - top < height * 0.08) {
    return { x: 0, y: 0, width, height };
  }
  const marginX = Math.max(4, Math.round(width * 0.012));
  const marginY = Math.max(4, Math.round(height * 0.008));
  const x = Math.max(0, left - marginX);
  const y = Math.max(0, top - marginY);
  return {
    x,
    y,
    width: Math.min(width, right + marginX + 1) - x,
    height: Math.min(height, bottom + marginY + 1) - y,
  };
}

function projectScreenshotAnalysisLimits() {
  const compact = window.matchMedia?.("(max-width: 760px)")?.matches;
  return compact
    ? { maxPixels: 1_600_000, maxWidth: 1_300, maxHeight: 1_900 }
    : { maxPixels: 2_800_000, maxWidth: 1_800, maxHeight: 2_600 };
}

function detectProjectScreenshotRowBands(data, width, height, bounds = { x: 0, y: 0, width, height }) {
  const startX = Math.max(0, bounds.x);
  const endX = Math.min(width, bounds.x + bounds.width);
  const startY = Math.max(0, bounds.y);
  const endY = Math.min(height, bounds.y + bounds.height);
  const regionWidth = Math.max(1, endX - startX);
  const regionHeight = Math.max(1, endY - startY);
  const sampleStep = Math.max(3, Math.floor(regionWidth / 420));
  const sampleCount = Math.ceil(regionWidth / sampleStep);
  const binCount = Math.min(8, Math.max(1, sampleCount));
  const edgeOffset = 3;
  const lineYs = [];
  for (let y = startY; y < endY; y += 1) {
    let strong = 0;
    let light = 0;
    const strongBins = new Uint16Array(binCount);
    const lightBins = new Uint16Array(binCount);
    const totalBins = new Uint16Array(binCount);
    let sampleIndex = 0;
    for (let x = startX; x < endX; x += sampleStep) {
      const bin = Math.min(binCount - 1, Math.floor(sampleIndex * binCount / sampleCount));
      const offset = (y * width + x) * 4;
      const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      const topOffset = (Math.max(startY, y - edgeOffset) * width + x) * 4;
      const bottomOffset = (Math.min(endY - 1, y + edgeOffset) * width + x) * 4;
      const topGray = data[topOffset] * 0.299 + data[topOffset + 1] * 0.587 + data[topOffset + 2] * 0.114;
      const bottomGray = data[bottomOffset] * 0.299 + data[bottomOffset + 1] * 0.587 + data[bottomOffset + 2] * 0.114;
      const localContrast = Math.max(topGray, bottomGray) - gray;
      totalBins[bin] += 1;
      if (gray < 155 || localContrast >= 42) {
        strong += 1;
        strongBins[bin] += 1;
      }
      if (gray < 232 || localContrast >= 12) {
        light += 1;
        lightBins[bin] += 1;
      }
      sampleIndex += 1;
    }
    if (projectScreenshotLineCoverageMatches({
      strong,
      light,
      sampleCount,
      strongBins,
      lightBins,
      totalBins,
      strongThreshold: 0.34,
      lightThreshold: 0.72,
    })) lineYs.push(y);
  }
  const lines = mergeProjectScreenshotLineYs(lineYs);
  if (lines.length >= 2) {
    if (lines[0] > startY + regionHeight * 0.03) lines.unshift(startY);
    if (lines.at(-1) < endY - regionHeight * 0.03) lines.push(endY - 1);
  }
  const bands = [];
  const minRowHeight = Math.max(10, Math.min(24, Math.round(regionHeight * 0.008)));
  for (let index = 0; index < lines.length - 1; index += 1) {
    const top = lines[index];
    const bottom = lines[index + 1];
    const bandHeight = bottom - top - 1;
    if (bandHeight >= minRowHeight) {
      bands.push({ y: top + 1, height: bandHeight });
    }
  }
  return bands;
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

function projectScreenshotCanvasBackground(image) {
  if (!image || (typeof image !== "object" && typeof image !== "function")) return "#fff";
  const cached = projectScreenshotCanvasBackgrounds.get(image);
  if (cached) return cached;
  let background = "#fff";
  const canvas = document.createElement("canvas");
  try {
    const sampleSize = 192;
    const cropSize = Math.max(1, Math.min(image.width, image.height));
    const isPortrait = image.height >= image.width;
    const travel = Math.max(0, (isPortrait ? image.height : image.width) - cropSize);
    const positions = travel > cropSize * 0.2 ? [0, travel / 2, travel] : [travel / 2];
    canvas.width = sampleSize;
    canvas.height = sampleSize * positions.length;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return background;
    positions.forEach((position, index) => {
      const sourceX = isPortrait ? 0 : position;
      const sourceY = isPortrait ? position : 0;
      context.drawImage(
        image,
        sourceX,
        sourceY,
        cropSize,
        cropSize,
        0,
        index * sampleSize,
        sampleSize,
        sampleSize,
      );
    });
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Uint32Array(256);
    let transparent = 0;
    let visible = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 32) {
        transparent += 1;
        continue;
      }
      const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
      histogram[gray] += 1;
      visible += 1;
    }
    const median = projectScreenshotHistogramPercentile(histogram, visible, 0.5);
    const transparentRatio = transparent / Math.max(1, transparent + visible);
    background = visible ? projectScreenshotCompositeBackground(transparentRatio, median) : "#fff";
  } catch {
    background = "#fff";
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
  projectScreenshotCanvasBackgrounds.set(image, background);
  return background;
}

function projectScreenshotHistogramPercentile(histogram, totalPixels, percentile) {
  if (!totalPixels) return 255;
  const target = Math.max(1, totalPixels * percentile);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return 255;
}

function normalizeProjectScreenshotCanvasPolarity(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    histogram[gray] += 1;
  }
  const invert = projectScreenshotHistogramPercentile(histogram, data.length / 4, 0.5) < 128;
  if (!invert) return false;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255 - data[index];
    data[index + 1] = 255 - data[index + 1];
    data[index + 2] = 255 - data[index + 2];
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return true;
}

function enhanceProjectScreenshotCanvas(canvas, mode = "binary") {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const rawHistogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    rawHistogram[gray] += 1;
  }
  const totalPixels = data.length / 4;
  const invert = projectScreenshotHistogramPercentile(rawHistogram, totalPixels, 0.5) < 128;
  const histogram = invert ? new Uint32Array(256) : rawHistogram;
  if (invert) {
    for (let value = 0; value < 256; value += 1) histogram[255 - value] = rawHistogram[value];
  }
  const adaptiveThreshold = Math.max(100, Math.min(235, projectScreenshotOtsuThreshold(histogram, totalPixels)));
  const backgroundLevel = Math.max(
    adaptiveThreshold + 18,
    projectScreenshotHistogramPercentile(histogram, totalPixels, 0.98),
  );
  const contrastRange = Math.max(18, backgroundLevel - adaptiveThreshold);
  for (let index = 0; index < data.length; index += 4) {
    const rawGray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const gray = invert ? 255 - rawGray : rawGray;
    const dynamicValue = Math.max(0, Math.min(255, (gray - adaptiveThreshold) * 255 / contrastRange));
    const legacyValue = Math.max(0, Math.min(255, gray > 248 ? 255 : (gray - 128) * 1.2 + 128));
    const value = mode === "soft"
      ? gray >= backgroundLevel
        ? 255
        : dynamicValue * 0.35 + legacyValue * 0.65
      : gray < adaptiveThreshold ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  eraseProjectScreenshotTableLines(canvas, mode === "binary" ? 0.58 : 0.72);
}

function projectScreenshotOtsuThreshold(histogram, totalPixels) {
  let weightedTotal = 0;
  for (let value = 0; value < histogram.length; value += 1) weightedTotal += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 205;
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = totalPixels - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function eraseProjectScreenshotTableLines(canvas, coverageThreshold) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const isDark = (x, y) => data[(y * canvas.width + x) * 4] < 215;
  const rows = [];
  const columns = [];
  const xStep = Math.max(1, Math.floor(canvas.width / 700));
  const yStep = Math.max(1, Math.floor(canvas.height / 500));
  for (let y = 0; y < canvas.height; y += 1) {
    let dark = 0;
    let sampled = 0;
    for (let x = 0; x < canvas.width; x += xStep) {
      dark += isDark(x, y) ? 1 : 0;
      sampled += 1;
    }
    if (dark / sampled >= coverageThreshold) rows.push(y);
  }
  for (let x = 0; x < canvas.width; x += 1) {
    let dark = 0;
    let sampled = 0;
    for (let y = 0; y < canvas.height; y += yStep) {
      dark += isDark(x, y) ? 1 : 0;
      sampled += 1;
    }
    if (dark / sampled >= coverageThreshold) columns.push(x);
  }
  context.fillStyle = "#fff";
  for (const y of rows) context.fillRect(0, Math.max(0, y - 1), canvas.width, 3);
  for (const x of columns) context.fillRect(Math.max(0, x - 1), 0, 3, canvas.height);
}

async function lookupProjectScreenshotEntry(entry, { signal } = {}) {
  try {
    const { response, payload } = await requestProjectScreenshotDmLookup({ fullName: entry.fullName }, { signal });
    if (!response.ok || !payload.ok) {
      const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      const suggestion = suggestions[0] || null;
      const reliableSuggestion = payload?.noResult
        ? selectReliableProjectScreenshotSuggestion(entry.fullName, suggestions)
        : null;
      if (reliableSuggestion) {
        const exactQuery = reliableSuggestion.securityId
          ? { securityId: reliableSuggestion.securityId }
          : { shortName: reliableSuggestion.shortName };
        const exact = await requestProjectScreenshotDmLookup(exactQuery, { signal });
        const exactNormalized = exact.payload?.normalized || {};
        if (exact.response.ok && exact.payload?.ok && exact.payload?.diagnostic?.dmMatched === true && exactNormalized.shortName) {
          return {
            ...entry,
            status: "ok",
            dmVerified: true,
            shortName: exactNormalized.shortName,
            securityId: exactNormalized.securityId || reliableSuggestion.securityId || "",
            issuerName: exactNormalized.issuerName || reliableSuggestion.issuerName || "",
            correctedFullName: exactNormalized.fullName || reliableSuggestion.fullName || "",
            correctionSource: "DM 高置信全称校正",
            error: "",
          };
        }
      }
      return {
        ...entry,
        status: "error",
        dmVerified: false,
        shortName: "",
        candidateShortName: suggestion?.shortName || "",
        securityId: "",
        candidateSecurityId: suggestion?.securityId || "",
        error: payload?.noResult ? "DM 无结果" : payload?.error || `HTTP ${response.status}`,
      };
    }
    const normalized = payload.normalized || {};
    const dmMatched = payload?.diagnostic?.dmMatched === true;
    return {
      ...entry,
      status: dmMatched && normalized.shortName ? "ok" : "error",
      dmVerified: Boolean(dmMatched && normalized.shortName),
      shortName: dmMatched ? normalized.shortName || "" : "",
      securityId: normalized.securityId || "",
      issuerName: normalized.issuerName || "",
      correctedFullName: dmMatched ? normalized.fullName || "" : "",
      error: dmMatched && normalized.shortName ? "" : dmMatched ? "DM 未返回简称" : "DM 未匹配到该债券",
    };
  } catch (error) {
    return { ...entry, status: "error", dmVerified: false, shortName: "", error: error.message || "DM 查询失败" };
  }
}

function finalizeProjectScreenshotLookupRow(current, resolved) {
  const verified = resolved.status === "ok" && resolved.dmVerified && resolved.shortName;
  const verifiedFullName = verified
    ? resolved.correctedFullName || current.draftFullName
    : current.verifiedFullName || "";
  const previousVerifiedShortName = current.verifiedShortName || (current.dmVerified ? current.shortName : "");
  const previousVerifiedSecurityId = current.verifiedSecurityId || (current.dmVerified ? current.securityId : "");
  const previousVerifiedIssuerName = current.verifiedIssuerName || (current.dmVerified ? current.issuerName : "");
  return {
    ...current,
    ...resolved,
    id: current.id,
    sessionId: current.sessionId,
    revision: current.revision,
    ocrFullName: current.ocrFullName,
    draftFullName: verified ? verifiedFullName : current.draftFullName,
    fullName: verified ? verifiedFullName : current.draftFullName,
    verifiedFullName,
    verifiedShortName: verified ? resolved.shortName : previousVerifiedShortName,
    verifiedSecurityId: verified ? resolved.securityId || "" : previousVerifiedSecurityId,
    verifiedIssuerName: verified ? resolved.issuerName || "" : previousVerifiedIssuerName,
    isEditing: verified ? false : current.isEditing,
    editSnapshot: verified ? null : current.editSnapshot,
    correctionDismissed: verified ? false : current.correctionDismissed,
    dmVerified: Boolean(verified),
    candidateShortName: verified ? "" : resolved.candidateShortName || "",
  };
}

async function requestProjectScreenshotDmLookup(query = {}, { signal } = {}) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12_000);
  try {
    const response = await fetch(`./api/dm/lookup?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = { ok: false, error: `HTTP ${response.status}: 返回不是 JSON` };
    }
    return { response, payload };
  } catch (error) {
    if (error?.name === "AbortError" && timedOut) throw new Error("DM 查询超过 12 秒，已跳过本条");
    if (error?.name === "AbortError") throw new Error("本条旧查询已取消");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function handleProjectScreenshotCorrectionInput(event) {
  const input = event.target.closest("[data-project-screenshot-correction-input]");
  if (!input) return;
  const row = projectScreenshotRows.find((item) => item.id === input.dataset.projectScreenshotRowId);
  if (!row) return;
  const nextValue = input.value;
  if (nextValue === row.draftFullName) return;
  if (!row.editSnapshot) row.editSnapshot = projectScreenshotRowSnapshot(row);
  cancelProjectScreenshotRowLookup(row);
  row.draftFullName = nextValue;
  row.fullName = nextValue;
  row.revision += 1;
  row.status = "draft";
  row.dmVerified = false;
  row.isEditing = true;
  row.error = "已修改，待重查";
  row.correctionDismissed = false;
  const card = input.closest(".project-screenshot-item");
  card?.classList.remove("is-error", "is-pending");
  card?.classList.add("is-draft");
  const status = card?.querySelector("[data-project-screenshot-row-status]");
  if (status) status.textContent = row.error;
  const submit = card?.querySelector(".project-screenshot-correction button[type=\"submit\"]");
  if (submit) submit.disabled = false;
  syncProjectScreenshotCopyControls();
  setProjectScreenshotStatus("本条已修改，可直接重查。" );
}

function handleProjectScreenshotBranchChange(event) {
  const select = event.target.closest("[data-project-screenshot-branch-select]");
  if (!select || !PROJECT_SCREENSHOT_BRANCHES.includes(select.value)) return;
  const row = projectScreenshotRows.find((item) => item.id === select.dataset.projectScreenshotRowId);
  if (!row || row.branch === select.value) return;
  if (!row.editSnapshot) row.editSnapshot = projectScreenshotRowSnapshot(row);
  row.branch = select.value;
  if (row.dmVerified) {
    row.editSnapshot = null;
    row.isEditing = false;
  } else {
    row.isEditing = true;
  }
  renderProjectScreenshotResults();
  requestAnimationFrame(() => keepProjectScreenshotRowVisible(row.id, row.dmVerified ? "card" : "select"));
}

function projectScreenshotRowSnapshot(row) {
  return {
    branch: row.branch,
    draftFullName: row.draftFullName,
    fullName: row.fullName,
    status: row.status,
    dmVerified: row.dmVerified,
    shortName: row.shortName || "",
    securityId: row.securityId || "",
    issuerName: row.issuerName || "",
    candidateShortName: row.candidateShortName || "",
    candidateSecurityId: row.candidateSecurityId || "",
    error: row.error || "",
    correctionDismissed: Boolean(row.correctionDismissed),
  };
}

function cancelProjectScreenshotRowLookup(row) {
  try {
    row?.lookupController?.abort();
  } catch {
    // A stale lookup is already isolated by session and revision.
  }
  if (row) row.lookupController = null;
}

function createManualProjectScreenshotRow(sessionId = projectScreenshotSessionId) {
  projectScreenshotRowSequence += 1;
  return {
    id: `manual-${sessionId}-${projectScreenshotRowSequence}`,
    sessionId,
    revision: 0,
    branch: PROJECT_SCREENSHOT_BRANCHES[0],
    originalBranch: PROJECT_SCREENSHOT_BRANCHES[0],
    fullName: "",
    ocrFullName: "",
    draftFullName: "",
    verifiedFullName: "",
    status: "draft",
    dmVerified: false,
    isEditing: true,
    isManual: true,
    error: "填写债券全称后重查",
  };
}

function handleProjectScreenshotCorrectionClick(event) {
  const button = event.target.closest("[data-project-screenshot-action]");
  if (!button) return;
  const action = button.dataset.projectScreenshotAction;
  if (action === "add") {
    if (!projectScreenshotSessionId) projectScreenshotSessionId += 1;
    const rowToAdd = createManualProjectScreenshotRow();
    projectScreenshotRows.push(rowToAdd);
    renderProjectScreenshotResults();
    requestAnimationFrame(() => keepProjectScreenshotRowVisible(rowToAdd.id, "input"));
    return;
  }
  const row = projectScreenshotRows.find((item) => item.id === button.dataset.projectScreenshotRowId);
  if (!row) return;
  if (action === "edit") {
    row.editSnapshot = projectScreenshotRowSnapshot(row);
    row.correctionDismissed = false;
    row.isEditing = true;
    renderProjectScreenshotResults();
    requestAnimationFrame(() => {
      const input = $("#projectScreenshotOutput")?.querySelector(`[data-project-screenshot-row-id="${CSS.escape(row.id)}"][data-project-screenshot-correction-input]`);
      input?.focus({ preventScroll: true });
      input?.setSelectionRange?.(input.value.length, input.value.length);
    });
    return;
  }
  if (action === "cancel") {
    cancelProjectScreenshotRowLookup(row);
    if (row.isManual && !row.verifiedFullName) {
      projectScreenshotRows = projectScreenshotRows.filter((item) => item.id !== row.id);
      let replacement = null;
      if (!projectScreenshotRows.length) {
        replacement = createManualProjectScreenshotRow(row.sessionId || projectScreenshotSessionId);
        projectScreenshotRows = [replacement];
      }
      renderProjectScreenshotResults();
      setProjectScreenshotStatus(replacement ? "补录内容已清空，可继续填写。" : "已移除补录行。" );
      if (replacement) requestAnimationFrame(() => keepProjectScreenshotRowVisible(replacement.id, "input"));
      return;
    }
    row.revision += 1;
    const snapshot = row.editSnapshot || {
      branch: row.originalBranch || row.branch,
      draftFullName: row.verifiedFullName || row.ocrFullName,
      fullName: row.verifiedFullName || row.ocrFullName,
      status: row.verifiedFullName && row.verifiedShortName ? "ok" : "error",
      dmVerified: Boolean(row.verifiedFullName && row.verifiedShortName),
      shortName: row.verifiedShortName || "",
      securityId: row.verifiedSecurityId || "",
      issuerName: row.verifiedIssuerName || "",
      candidateShortName: "",
      candidateSecurityId: "",
      error: row.verifiedFullName ? "" : "DM 无结果",
      correctionDismissed: true,
    };
    Object.assign(row, snapshot);
    row.editSnapshot = null;
    row.isEditing = false;
    row.correctionDismissed = row.status !== "ok";
    renderProjectScreenshotResults();
    setProjectScreenshotStatus(row.status === "ok" ? "已取消校正，恢复 DM 核验结果。" : "已取消校正，恢复原识别内容。" );
    requestAnimationFrame(() => keepProjectScreenshotRowVisible(row.id, "edit"));
    return;
  }
}

function keepProjectScreenshotRowVisible(rowId, control = "input") {
  const output = $("#projectScreenshotOutput");
  const card = Array.from(output?.querySelectorAll(".project-screenshot-item") || [])
    .find((item) => item.dataset.projectScreenshotRowId === rowId);
  if (!card) return;
  card.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (control === "card") return;
  const selector = control === "select"
    ? "[data-project-screenshot-branch-select]"
    : control === "edit"
      ? "[data-project-screenshot-action=\"edit\"]"
      : "[data-project-screenshot-correction-input]";
  card.querySelector(selector)?.focus({ preventScroll: true });
}

async function handleProjectScreenshotCorrectionSubmit(event) {
  const form = event.target.closest("[data-project-screenshot-correction-form]");
  if (!form) return;
  event.preventDefault();
  const rowId = form.dataset.projectScreenshotRowId;
  const rowIndex = projectScreenshotRows.findIndex((item) => item.id === rowId);
  if (rowIndex < 0) return;
  const row = projectScreenshotRows[rowIndex];
  if (!row.editSnapshot) row.editSnapshot = projectScreenshotRowSnapshot(row);
  const draft = cleanProjectScreenshotBondFullName(row.draftFullName);
  if (!draft) {
    row.error = "请填写完整债券全称";
    renderProjectScreenshotResults();
    return;
  }

  row.draftFullName = draft;
  row.fullName = draft;
  row.revision += 1;
  const revision = row.revision;
  const sessionId = row.sessionId;
  row.status = "pending";
  row.dmVerified = false;
  row.isEditing = true;
  row.correctionDismissed = false;
  row.error = "";
  cancelProjectScreenshotRowLookup(row);
  const lookupController = new AbortController();
  row.lookupController = lookupController;
  renderProjectScreenshotResults(projectScreenshotRows, { force: true });
  setProjectScreenshotStatus(`正在重查：${draft}`);
  const resolved = await lookupProjectScreenshotEntry(
    { ...row, lookupController: null, fullName: draft },
    { signal: lookupController.signal },
  );
  const currentIndex = projectScreenshotRows.findIndex((item) => item.id === rowId);
  const current = projectScreenshotRows[currentIndex];
  if (sessionId !== projectScreenshotSessionId || !current || current.revision !== revision) return;
  current.lookupController = null;
  projectScreenshotRows[currentIndex] = finalizeProjectScreenshotLookupRow(current, resolved);
  if (projectScreenshotRows[currentIndex].dmVerified) {
    projectScreenshotRows = collapseProjectScreenshotRowsWithVerifiedMatches(projectScreenshotRows);
  }
  renderProjectScreenshotResults();
  setProjectScreenshotStatus(resolved.status === "ok" && resolved.dmVerified
    ? `已核验：${resolved.shortName}`
    : `本条仍未匹配：${resolved.error || "DM 无结果"}`);
}

function syncProjectScreenshotCopyControls() {
  const copyButton = $("#copyProjectScreenshotShortNamesButton");
  const output = $("#projectScreenshotOutput");
  const copyText = projectScreenshotResolvedShortNames().join("\n");
  if (copyButton) copyButton.disabled = !copyText;
  const copyBox = output?.querySelector(".project-screenshot-copy-box");
  if (copyBox && copyText) copyBox.value = copyText;
  else if (copyBox) copyBox.remove();
}

function renderProjectScreenshotResults(rows = projectScreenshotRows, { force = false } = {}) {
  const output = $("#projectScreenshotOutput");
  const copyButton = $("#copyProjectScreenshotShortNamesButton");
  if (!output || !copyButton) return;
  const activeEditor = document.activeElement?.closest?.(
    "[data-project-screenshot-correction-input], [data-project-screenshot-branch-select]",
  );
  if (!force && activeEditor && output.contains(activeEditor)) {
    syncProjectScreenshotCopyControls();
    if (output.dataset.projectScreenshotRenderPending !== "true") {
      output.dataset.projectScreenshotRenderPending = "true";
      activeEditor.addEventListener("blur", () => {
        delete output.dataset.projectScreenshotRenderPending;
        renderProjectScreenshotResults(projectScreenshotRows, { force: true });
      }, { once: true });
    }
    return;
  }
  delete output.dataset.projectScreenshotRenderPending;
  const previousScrollTop = output.scrollTop;
  const activeCorrection = document.activeElement?.matches?.("[data-project-screenshot-correction-input]")
    ? {
        rowId: document.activeElement.dataset.projectScreenshotRowId,
        start: document.activeElement.selectionStart,
        end: document.activeElement.selectionEnd,
      }
    : null;
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
    const matched = group.rows.filter((row) => row.status === "ok" && row.dmVerified && row.verifiedShortName).length;
    const items = group.rows.map((row) => {
      const title = row.status === "ok" && row.dmVerified && row.shortName
        ? row.shortName
        : row.status === "pending"
          ? "正在查询..."
          : row.candidateShortName
            ? `未验证候选：${row.candidateShortName}`
            : "未查到简称";
      const detail = row.status === "ok"
        ? [row.securityId, "DM 已核验"].filter(Boolean).join(" · ")
        : row.status === "pending"
        ? "正在查询 DM"
        : row.error || "查询失败";
      const showCorrection = row.isEditing
        || row.status === "draft"
        || (row.status === "error" && !row.correctionDismissed);
      const branchOptions = PROJECT_SCREENSHOT_BRANCHES
        .map((branch) => `<option value="${escapeAttribute(branch)}"${branch === row.branch ? " selected" : ""}>${escapeHtml(branch)}</option>`)
        .join("");
      const correctionForm = showCorrection ? `
        <form class="project-screenshot-correction" data-project-screenshot-correction-form data-project-screenshot-row-id="${escapeAttribute(row.id)}">
          <select aria-label="所属分行" data-project-screenshot-branch-select data-project-screenshot-row-id="${escapeAttribute(row.id)}">
            ${branchOptions}
          </select>
          <input
            type="text"
            value="${escapeAttribute(row.draftFullName || row.fullName)}"
            aria-label="校正债券全称"
            autocomplete="off"
            data-project-screenshot-correction-input
            data-project-screenshot-row-id="${escapeAttribute(row.id)}"
          >
          <div class="project-screenshot-correction-actions">
            <button type="submit"${row.status === "pending" ? " disabled" : ""}>重查本条</button>
            ${row.verifiedFullName || row.ocrFullName || row.isManual || row.editSnapshot ? `<button type="button" data-project-screenshot-action="cancel" data-project-screenshot-row-id="${escapeAttribute(row.id)}">${row.isManual && !row.verifiedFullName ? "移除" : "取消"}</button>` : ""}
          </div>
        </form>
      ` : "";
      return `
        <div class="project-screenshot-item${row.status === "error" ? " is-error" : row.status === "pending" ? " is-pending" : row.status === "draft" ? " is-draft" : ""}" data-project-screenshot-row-id="${escapeAttribute(row.id)}">
          <div class="project-screenshot-item-head">
            <strong>${escapeHtml(title)}</strong>
            ${row.status !== "pending" && !showCorrection ? `<button type="button" data-project-screenshot-action="edit" data-project-screenshot-row-id="${escapeAttribute(row.id)}">${row.status === "ok" ? "校正" : "修改"}</button>` : ""}
          </div>
          <em>${escapeHtml(row.draftFullName || row.fullName)}</em>
          <span role="status" aria-live="polite" data-project-screenshot-row-status>${escapeHtml(detail)}</span>
          ${correctionForm}
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
  output.innerHTML = `${groupHtml}<button class="project-screenshot-add-button" type="button" data-project-screenshot-action="add">补录一条</button>${copyText ? `<textarea class="project-screenshot-copy-box" aria-label="已匹配的 DM 简称清单" readonly>${escapeHtml(copyText)}</textarea>` : ""}`;
  output.scrollTop = previousScrollTop;
  if (activeCorrection?.rowId) {
    requestAnimationFrame(() => {
      const replacement = Array.from(output.querySelectorAll("[data-project-screenshot-correction-input]"))
        .find((input) => input.dataset.projectScreenshotRowId === activeCorrection.rowId);
      if (!replacement) return;
      replacement.focus({ preventScroll: true });
      replacement.setSelectionRange?.(activeCorrection.start, activeCorrection.end);
      output.scrollTop = previousScrollTop;
    });
  }
}

function projectScreenshotResolvedShortNames() {
  return projectScreenshotRows
    .filter((row) => row.status === "ok" && row.dmVerified && row.verifiedFullName && row.verifiedShortName)
    .map((row) => row.verifiedShortName);
}

async function copyProjectScreenshotShortNames() {
  const text = projectScreenshotResolvedShortNames().join("\n");
  if (!text) {
    showToast("暂无可复制的 DM 简称。");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制简称清单。");
  } catch {
    showToast("浏览器未允许自动复制，请在下方清单中长按复制。");
  }
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
  $("#projectScreenshotTool")?.setAttribute("aria-busy", isBusy ? "true" : "false");
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

function updateProjectScreenshotOcrProgress(message = {}, label = "", passIndex = 0, passTotal = 0) {
  const status = String(message.status || "").replace(/_/g, " ");
  const progress = Number(message.progress);
  const total = Number(passTotal);
  const index = Number(passIndex);
  const overallProgress = Number.isFinite(progress) && Number.isFinite(total) && total > 0
    ? Math.min(1, (Math.max(0, index) + Math.max(0, Math.min(1, progress))) / total)
    : null;
  const percent = Number.isFinite(overallProgress)
    ? ` ${Math.round(overallProgress * 100)}%`
    : Number.isFinite(progress)
      ? ` ${Math.round(progress * 100)}%`
      : "";
  const prefix = label ? `${label} · ` : "";
  setProjectScreenshotStatus(status ? `${prefix}${status}${percent}` : "正在 OCR 图片...");
}

function bindPlaceholderSelection() {
  document.addEventListener("mousedown", selectAnyPlaceholderOnMouseDown);
  document.addEventListener("dblclick", selectAnyPlaceholderOnDoubleClick);
}

function bindIssuerPicker() {
  const picker = $("#issuerPicker");
  const control = $("#issuerPickerControl");
  const input = $("#issuerSearchInput");
  const results = $("#issuerSearchResults");
  const clear = $("#issuerPickerClear");
  if (!picker || !control || !input || !results || !clear) return;

  input.addEventListener("focus", openIssuerPicker);
  input.addEventListener("input", () => {
    issuerPickerActiveIndex = 0;
    openIssuerPicker();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!issuerPickerOpen) openIssuerPicker();
      moveIssuerPickerActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && issuerPickerOpen && issuerPickerActiveIndex >= 0) {
      event.preventDefault();
      const entry = issuerPickerVisibleEntries[issuerPickerActiveIndex];
      if (entry) selectIssuerFromPicker(entry.issuer.id);
      return;
    }
    if (event.key === "Escape" && issuerPickerOpen) {
      event.preventDefault();
      closeIssuerPicker();
    }
  });
  control.addEventListener("click", (event) => {
    if (event.target.closest("#issuerPickerClear")) return;
    input.focus({ preventScroll: true });
    openIssuerPicker();
  });
  clear.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectIssuerFromPicker("");
    input.focus({ preventScroll: true });
    openIssuerPicker();
  });
  results.addEventListener("pointerdown", (event) => event.preventDefault());
  results.addEventListener("click", (event) => {
    const option = event.target.closest("[data-issuer-option]");
    if (!option) return;
    selectIssuerFromPicker(option.dataset.issuerOption);
  });
  results.addEventListener("mouseover", (event) => {
    const option = event.target.closest("[data-issuer-option-index]");
    if (!option) return;
    issuerPickerActiveIndex = Number(option.dataset.issuerOptionIndex);
    syncIssuerPickerActiveOption();
  });
  document.addEventListener("pointerdown", (event) => {
    if (issuerPickerOpen && !picker.contains(event.target)) closeIssuerPicker();
  });
}

function openIssuerPicker() {
  const picker = $("#issuerPicker");
  const input = $("#issuerSearchInput");
  const results = $("#issuerSearchResults");
  if (!picker || !input || !results) return;
  issuerPickerOpen = true;
  picker.classList.add("is-open");
  input.setAttribute("aria-expanded", "true");
  results.hidden = false;
  renderIssuerPickerResults();
}

function closeIssuerPicker() {
  const picker = $("#issuerPicker");
  const input = $("#issuerSearchInput");
  const results = $("#issuerSearchResults");
  if (!picker || !input || !results) return;
  issuerPickerOpen = false;
  issuerPickerActiveIndex = -1;
  issuerPickerVisibleEntries = [];
  picker.classList.remove("is-open");
  input.value = "";
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  results.hidden = true;
  syncIssuerPickerSelection();
}

function renderIssuerPickerResults() {
  const results = $("#issuerSearchResults");
  const input = $("#issuerSearchInput");
  if (!results || !input || !issuerPickerOpen) return;
  issuerPickerVisibleEntries = searchIssuerIndex(issuerSearchEntries, input.value)
    .slice(0, ISSUER_PICKER_RESULT_LIMIT);
  if (!issuerPickerVisibleEntries.length) {
    issuerPickerActiveIndex = -1;
    input.removeAttribute("aria-activedescendant");
    results.innerHTML = '<div class="issuer-picker-empty">没有找到匹配主体</div>';
    return;
  }
  if (issuerPickerActiveIndex < 0 || issuerPickerActiveIndex >= issuerPickerVisibleEntries.length) {
    const selectedIndex = issuerPickerVisibleEntries.findIndex((entry) => entry.issuer.id === selectedIssuerId);
    issuerPickerActiveIndex = selectedIndex >= 0 ? selectedIndex : 0;
  }
  results.innerHTML = issuerPickerVisibleEntries.map((entry, index) => {
    const issuer = entry.issuer;
    const selected = issuer.id === selectedIssuerId;
    return `
      <button
        class="issuer-picker-option ${selected ? "is-selected" : ""}"
        id="issuerSearchOption${index}"
        type="button"
        role="option"
        aria-selected="${selected}"
        data-issuer-option="${escapeAttribute(issuer.id)}"
        data-issuer-option-index="${index}"
      >
        <span class="issuer-picker-option-head">
          <strong>${escapeHtml(issuer.legalName)}</strong>
          ${selected ? '<span class="issuer-picker-check" aria-hidden="true">✓</span>' : ""}
        </span>
        <span class="issuer-picker-option-meta">${escapeHtml(issuerPickerMeta(issuer))}</span>
      </button>
    `;
  }).join("");
  syncIssuerPickerActiveOption();
}

function moveIssuerPickerActive(delta) {
  if (!issuerPickerVisibleEntries.length) return;
  const length = issuerPickerVisibleEntries.length;
  issuerPickerActiveIndex = (issuerPickerActiveIndex + delta + length) % length;
  syncIssuerPickerActiveOption();
}

function syncIssuerPickerActiveOption() {
  const input = $("#issuerSearchInput");
  const options = $$("#issuerSearchResults [data-issuer-option-index]");
  options.forEach((option, index) => option.classList.toggle("is-active", index === issuerPickerActiveIndex));
  const active = options[issuerPickerActiveIndex];
  if (!input || !active) {
    input?.removeAttribute("aria-activedescendant");
    return;
  }
  input.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function selectIssuerFromPicker(issuerId) {
  const select = $("#issuerSelect");
  const input = $("#issuerSearchInput");
  if (!select || !input) return;
  select.value = (state.issuers || []).some((issuer) => issuer.id === issuerId) ? issuerId : "";
  input.value = "";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  syncIssuerPickerSelection();
  closeIssuerPicker();
}

function syncIssuerPickerSelection() {
  const issuer = (state.issuers || []).find((item) => item.id === selectedIssuerId) || null;
  const selection = $("#issuerPickerSelection");
  const input = $("#issuerSearchInput");
  const clear = $("#issuerPickerClear");
  if (!selection || !input || !clear) return;
  selection.hidden = !issuer;
  selection.textContent = issuer?.legalName || "";
  selection.title = issuer?.legalName || "";
  clear.hidden = !issuer;
  input.placeholder = issuer ? "继续搜索主体" : "输入中文、全拼或简拼";
}

function issuerPickerMeta(issuer) {
  const aliases = (issuer.aliases || []).join(" / ");
  const branch = issuer.linkedBranch || issuer.defaultBranch || "";
  const rating = issuer.subjectRating
    ? `${issuer.subjectRating}${issuer.ratingAgency ? ` · ${issuer.ratingAgency}` : ""}`
    : "";
  return [aliases, branch, rating].filter(Boolean).join(" · ") || "主体资料";
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
  $$('[data-new-project-cutoff-mode]').forEach((button) => {
    button.addEventListener("click", () => setNewProjectCutoffMode(button.dataset.newProjectCutoffMode));
  });
  $("#projectDmSeedInput").addEventListener("input", () => {
    project.shortName = $("#projectDmSeedInput").value.trim();
    $('[data-project-field="shortName"]').value = project.shortName;
    regenerate();
  });
  $("#projectPricingRows").addEventListener("input", (event) => {
    const input = event.target.closest("[data-pricing-index][data-pricing-field]");
    if (!input) return;
    updateDynamicPricingField(input);
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
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
    setRecognitionForInput($("#issuerSearchInput"), null);
    selectedIssuerId = $("#issuerSelect").value;
    const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
    project = applyIssuerCommonFields(project, issuer);
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
    fillProjectFields();
    syncIssuerPickerSelection();
    regenerate();
  });

  $$("[data-project-field]").forEach((input) => {
    input.addEventListener("input", () => {
      clearRecognitionForInput(input);
      const field = input.dataset.projectField;
      project[field] = input.type === "number" ? numberOrNull(input.value) : input.value.trim();
      if (field === "hiddenRating") {
        project.hiddenRatingSource = "manual";
        project.hiddenRatingAsOf = "";
      }
      if (field === "durationText") {
        project.durationDays = durationToDays(project.durationText);
        project.durationParts = durationParts(project.durationText);
        ensureInquiryRangeCapacity(project);
        ensureProjectPricingCapacity(project);
        renderTrancheInquiryFields();
        renderProjectPricingFields();
      }
      if (field.startsWith("inquiry")) {
        rebuildInquiryRanges(project);
        renderTrancheInquiryFields();
      }
      if (field === "offeringType") applyOfferingTypeChoice(project, project.offeringType, true);
      if (field === "exchangeIssueNumber") applyExchangeIssueNumberChoice(project, project.exchangeIssueNumber, true);
      if (field === "venue" || field === "instrumentType") syncProjectConditionalFields();
      if (field === "shortName") {
        if ($("#projectDmSeedInput")) $("#projectDmSeedInput").value = project.shortName || "";
        renderTrancheInquiryFields();
        renderProjectPricingFields();
      }
      project.sourceText = buildDmProjectSourceText(project);
      $("#briefInput").value = project.sourceText;
      regenerate();
      scheduleProjectDmHistorySave();
    });
    input.addEventListener("change", () => {
      if (input.dataset.projectField !== "ratingAgency") return;
      project.ratingAgency = normalizeRatingAgency(input.value);
      input.value = project.ratingAgency;
      project.sourceText = buildDmProjectSourceText(project);
      $("#briefInput").value = project.sourceText;
      regenerate();
      scheduleProjectDmHistorySave();
    });
  });
  $("#projectGuaranteeMethod")?.addEventListener("input", (event) => {
    clearRecognitionForInput(event.currentTarget);
    ensureProjectGuaranteeInfo(project).method = event.currentTarget.value.trim();
    syncProjectGuaranteeDraft();
  });
  $("#addProjectGuarantorButton")?.addEventListener("click", () => {
    ensureProjectGuaranteeInfo(project).guarantors.push({ name: "", subjectRating: "", ratingAgency: "", source: "manual" });
    renderProjectGuarantorFields();
    $("#projectGuarantorRows .guarantor-row:last-child [data-guarantor-field='name']")?.focus();
  });
  $("#projectGuarantorRows")?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-guarantor-index][data-guarantor-field]");
    if (!input) return;
    clearRecognitionForInput(input);
    const index = Number(input.dataset.guarantorIndex);
    const field = input.dataset.guarantorField;
    const info = ensureProjectGuaranteeInfo(project);
    if (!info.guarantors[index]) return;
    info.guarantors[index][field] = field === "subjectRating" ? input.value.trim().toUpperCase() : input.value.trim();
    info.guarantors[index].source = "manual";
    syncProjectGuaranteeDraft();
  });
  $("#projectGuarantorRows")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-guarantor-index][data-guarantor-field='ratingAgency']");
    if (!input) return;
    const info = ensureProjectGuaranteeInfo(project);
    const guarantor = info.guarantors[Number(input.dataset.guarantorIndex)];
    if (!guarantor) return;
    guarantor.ratingAgency = normalizeRatingAgency(input.value);
    input.value = guarantor.ratingAgency;
    syncProjectGuaranteeDraft();
  });
  $("#projectGuarantorRows")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-guarantor]");
    if (!button) return;
    const index = Number(button.dataset.removeGuarantor);
    const info = ensureProjectGuaranteeInfo(project);
    info.guarantors.splice(index, 1);
    renderProjectGuarantorFields();
    syncProjectGuaranteeDraft();
  });
  $$("[data-abs-field]").forEach((input) => {
    input.addEventListener("input", () => {
      clearRecognitionForInput(input);
      updateAbsInfoFromInputs();
      if (["creditEnhancementParty", "planName"].includes(input.dataset.absField)) {
        syncAbsCreditEnhancerIdentity();
        clearInapplicableAbsCreditApproval();
        renderAbsCreditApprovalOptions();
      }
      if (input.dataset.absField === "creditApprovalId") {
        applySelectedAbsCreditApprovalToProject();
      }
      if (input.dataset.absField === "totalScale") {
        refreshDerivedAbsTrancheFields(project.absInfo);
        syncDerivedAbsTrancheInputs();
      }
      project.sourceText = buildDmProjectSourceText(project);
      $("#briefInput").value = project.sourceText;
      regenerate();
      scheduleProjectDmHistorySave();
    });
  });
  $("#openAbsCreditLibraryButton")?.addEventListener("click", () => {
    openQuickAbsCreditPanel();
  });
  $$('[data-close-quick-abs-credit]').forEach((button) => {
    button.addEventListener("click", closeQuickAbsCreditPanel);
  });
  $("#quickAbsCreditEnhancerIssuerId")?.addEventListener("change", syncQuickAbsNewEnhancerFields);
  $("#quickAbsCreditScopeType")?.addEventListener("change", syncQuickAbsCreditScopeFields);
  $("#quickAbsCreditRawText")?.addEventListener("change", () => {
    fillParsedAbsCreditFields("quickAbsCredit");
    syncQuickAbsCreditScopeFields();
  });
  $("#quickAbsCreditForm")?.addEventListener("submit", saveQuickAbsCreditApproval);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#quickAbsCreditPanel")?.hidden) closeQuickAbsCreditPanel();
  });
  $("#addAbsTrancheButton")?.addEventListener("click", () => {
    ensureAbsInfo(project);
    project.instrumentType = project.instrumentType || "ABS";
    project.absInfo.tranches.push(defaultAbsTranche());
    syncAbsProjectSelectionScope();
    renderAbsTrancheFields();
    renderProjectPricingFields();
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
    updateAbsTranchesFromInputs(input);
    refreshDerivedAbsTrancheFields(project.absInfo);
    syncDerivedAbsTrancheInputs();
    syncAbsProjectSelectionScope();
    renderProjectPricingFields();
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
    syncAbsProjectSelectionScope();
    renderAbsTrancheFields();
    renderProjectPricingFields();
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
  const result = upsertParsedProjectToLedger(project, issuer, generated, newProjectCutoffPreview);
  if (!result) return;
  persistState();
  openLedgerProject(result.record.id);
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

function findExistingLedgerProject(projectValue) {
  const activeProjects = (state.projects || []).filter((item) => item.status !== "已结束");
  return activeProjects.find((item) => item.shortName === projectValue.shortName)
    || (isAbsProject(projectValue) ? findExistingAbsProject(activeProjects, projectValue) : null);
}

function upsertParsedProjectToLedger(projectValue, issuer, generated, cutoffPreview = null) {
  if (!projectValue?.shortName) return null;
  if (!projectIssuerSaveStatus(projectValue, issuer).ok) return null;
  const existing = findExistingLedgerProject(projectValue);
  const record = buildLedgerProjectRecord(projectValue, issuer, generated, existing, cutoffPreview);
  state = upsertProject(state, record);
  state = linkAbsCreditApprovalToProject(state, record);
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
  if (!absInfo.creditApprovalId && absInfo.creditApprovalSource !== "legacy-snapshot") {
    missing.push({ key: "abs.creditApprovalId", label: "50217 授信批单" });
  }
  if (absInfo.creditApprovalId) {
    const approval = (state.absCreditApprovals || []).find((item) => item.id === absInfo.creditApprovalId);
    if (!approval || approval.businessCode !== ABS_CREDIT_CODE || !absCreditApprovalAppliesToProject(approval, { ...projectValue, absInfo })) {
      missing.push({ key: "abs.creditApprovalId", label: "有效且适用的 50217 授信批单" });
    }
  }
  return missing.length
    ? { ok: false, reason: "incompleteAbs", missing }
    : { ok: true, reason: "", missing: [] };
}

function missingRequiredProjectIssuerFields(draft = {}) {
  return REQUIRED_PROJECT_ISSUER_FIELDS.filter((field) => !String(draft[field.key] || "").trim());
}

function buildLedgerProjectRecord(projectValue, issuer, generated, existing = null, cutoffPreview = null) {
  const suggestedRatios = generated.suggestion.trancheSuggestions.map((item) => item.suggestedRatio);
  const cutoff = cutoffPreview || resolveNewProjectCutoff(projectValue, issuer, new Date(), {
    // Batch updates have no displayed single-project date choice to confirm.
    dayMode: existing ? "auto" : newProjectCutoffMode,
    existingProject: existing,
  });
  const created = createProjectRecord({
    ...projectValue,
    leadUnderwriter: projectValue.sponsorStatus === "牵头" ? "兴业银行" : projectValue.leadUnderwriter,
    suggestedRatios,
  }, issuer, generated, {
    id: existing?.id,
    ...cutoff,
  });
  return existing
    ? normalizeProjectRecord({
        ...created,
        status: existing.status,
        instrumentType: created.instrumentType,
        absInfo: created.absInfo,
        notes: existing.notes,
        resultAdvertisement: existing.resultAdvertisement,
        resultConfirmed: existing.resultConfirmed,
        bidSubmissions: existing.bidSubmissions,
        finalBidSubmissionId: existing.finalBidSubmissionId,
        comprehensivePricing: existing.comprehensivePricing,
        pricingUnit: existing.pricingUnit,
        afterTaxRevenue: existing.afterTaxRevenue,
        ftpCost: existing.ftpCost,
        tranches: mergeExistingProjectTranches(existing, created, projectValue),
        createdAt: existing.createdAt,
      })
    : created;
}

function mergeExistingProjectTranches(existing, created, projectValue) {
  const existingTranches = existing.tranches || [];
  if (isAbsProject(projectValue)) {
    return created.tranches.map((tranche) => {
      const previous = existingTranches.find((item) => (
        normalizeSourceComparable(item.shortName) === normalizeSourceComparable(tranche.shortName)
      ));
      return mergeExistingProjectTranche(previous, tranche);
    });
  }
  return existingTranches.length === created.tranches.length
    ? created.tranches.map((tranche, index) => mergeExistingProjectTranche(existingTranches[index], tranche))
    : created.tranches;
}

function mergeExistingProjectTranche(existing, created) {
  if (!existing) return created;
  return {
    ...existing,
    shortName: created.shortName,
    durationText: created.durationText,
    inquiryLow: created.inquiryLow,
    inquiryHigh: created.inquiryHigh,
    suggestedRatio: created.suggestedRatio,
    marketValuation: created.marketValuation,
    issueScale: created.issueScale ?? existing.issueScale,
    securityCode: created.securityCode || existing.securityCode,
    absClassName: created.absClassName || existing.absClassName,
    sharePct: created.sharePct ?? existing.sharePct,
    expectedMaturityDate: created.expectedMaturityDate || existing.expectedMaturityDate,
    debtRating: created.debtRating || existing.debtRating,
    debtRatingAgency: created.debtRatingAgency || existing.debtRatingAgency,
    pricingMode: existing.pricingRate == null && created.pricingRate != null
      ? created.pricingMode
      : existing.pricingMode,
    pricingRate: existing.pricingRate ?? created.pricingRate,
  };
}

function bindLedger() {
  $$("[data-ledger-mobile-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPane = button.dataset.ledgerMobilePane;
      if (nextPane === "list" && ledgerMobilePane === "list") return;
      if (nextPane === "list" && ledgerMobilePane === "detail") {
        closeLedgerProjectDetail();
        return;
      }
      navigateLedgerMobilePane(nextPane);
    });
  });
  $("#mobileProjectBackButton")?.addEventListener("click", closeLedgerProjectDetail);
  $("#projectSearch").addEventListener("input", renderProjectList);
  $("#projectStatusFilter").addEventListener("change", (event) => setLedgerFilter(event.target.value || "all"));
  $("#projectDateFilter").addEventListener("change", renderProjectList);
  $("#projectTodayFilterButton").addEventListener("click", () => {
    $("#projectDateFilter").value = localDate(new Date());
    renderProjectList();
  });
  $("#previewMailButton").addEventListener("click", () => callMailer("preview"));
  $("#sendMailButton").addEventListener("click", () => callMailer("send"));
  $("#collapseMailOutputButton").addEventListener("click", hideMailOutput);
  $("#policyCurveRetry").addEventListener("click", () => loadPolicyCurve({ refresh: true }));
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
  $("#addTrancheButton").addEventListener("click", () => {
    const draft = readProjectForm();
    draft.tranches.push(normalizeProjectRecord({ shortName: "新品种" }).tranches[0]);
    refillProjectForm(draft);
    saveProjectDraftNow();
  });
  $("#projectForm").addEventListener("input", (event) => {
    if (event.target.closest("#resultEntryPanel")) return;
    clearRecognitionForInput(event.target);
    updateProjectPreviews();
    scheduleProjectAutoSave();
  });
  $("#projectForm").addEventListener("change", (event) => {
    if (event.target.closest("#resultEntryPanel")) return;
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
  $("#markBidButton").addEventListener("click", submitProjectBidRound);
  $("#finalizeBidButton").addEventListener("click", () => changeProjectBidFinalization(false));
  $("#reopenBidButton").addEventListener("click", () => changeProjectBidFinalization(true));
  $("#terminateProjectButton").addEventListener("click", () => setProjectActionStatus("已结束"));
  $("#openResultButton").addEventListener("click", () => openResultEntryPanel());
  $("#closeResultButton").addEventListener("click", closeResultEntryPanel);
  document.addEventListener("pointerdown", handleResultEntryOutsidePointer);
  window.addEventListener("resize", positionResultEntryPanel, { passive: true });
  $("#prepaymentEntryForm").addEventListener("submit", savePrepaymentEntry);
  $("#prepaymentEntryPanel").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-prepayment]")) closePrepaymentEntry();
  });
  $("#prepaymentSuffixInput").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 3);
    renderPrepaymentNumberPreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#prepaymentEntryPanel").hidden) closePrepaymentEntry();
    else if (!$("#resultEntryPanel").hidden) closeResultEntryPanel();
  });
  $("#copyBidPositionButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#projectBidPosition").value);
    showToast("投标标位已复制。");
  });
  $("#copyResultSummaryButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#projectResultSummary").value);
    showToast("中标汇报已复制。");
  });
  $("#parseAdvertisementButton").addEventListener("click", queueIssuanceResultRecognition);
  $("#confirmIssuanceResultButton").addEventListener("click", confirmIssuanceResult);
  $("#issuanceQueueNotifications").addEventListener("click", handleIssuanceQueueNotificationClick);
  for (const selector of ["#projectResultAdvertisement", "#issuanceNoticeDate"]) {
    for (const event of ["input", "change"]) $(selector).addEventListener(event, () => resetIssuanceReview());
  }
  $("#editProjectOpinionButton").addEventListener("click", () => {
    const record = readProjectForm();
    // Entering an existing project must not reuse another project's explicit date choice.
    newProjectCutoffMode = "auto";
    const recordTranches = isAbsProject(record) ? [] : (record.tranches || []);
    project = {
      ...parseProjectBrief(record.sourceText),
      shortName: record.shortName,
      shortNames: recordTranches.map((tranche) => tranche.shortName).filter(Boolean),
      branch: record.branch,
      venue: record.venue,
      leadUnderwriter: record.leadUnderwriter,
      sponsorStatus: record.sponsorStatus,
      instrumentType: record.instrumentType,
      guaranteeInfo: record.guaranteeInfo,
      absInfo: record.absInfo,
      issueScale: record.issueScale,
      durationText: recordTranches.length > 1
        ? compactProjectDurations(recordTranches.map((tranche) => tranche.durationText).filter(Boolean))
        : recordTranches[0]?.durationText || "",
      durationParts: recordTranches.map((tranche) => tranche.durationText).filter(Boolean),
      inquiryRanges: recordTranches.map((tranche) => ({ low: tranche.inquiryLow, high: tranche.inquiryHigh })),
      inquiryLow: recordTranches[0]?.inquiryLow ?? null,
      inquiryHigh: recordTranches[0]?.inquiryHigh ?? null,
      inquiryLow2: recordTranches[1]?.inquiryLow ?? null,
      inquiryHigh2: recordTranches[1]?.inquiryHigh ?? null,
      valuations: recordTranches.map((tranche) => tranche.marketValuation ?? null),
      valuation: recordTranches[0]?.marketValuation ?? null,
      guidancePrices: recordTranches.map((tranche) => tranche.pricingRate ?? null),
      guidancePrice: recordTranches[0]?.pricingRate ?? null,
      tranchePricing: recordTranches.map((tranche) => ({
        shortName: tranche.shortName,
        durationText: tranche.durationText,
        marketValuation: tranche.marketValuation ?? null,
        guidancePrice: tranche.pricingRate ?? null,
      })),
      sourceText: record.sourceText,
    };
    if (isAbsProject(project)) syncAbsProjectSelectionScope({ updateField: false });
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
    const prepaymentButton = event.target.closest("[data-prepayment-payment]");
    const openButton = event.target.closest("[data-open-payment-project]");
    if (completeButton) completePaymentTodo(completeButton.dataset.completePayment);
    if (prepaymentButton) openPrepaymentEntry(prepaymentButton.dataset.prepaymentPayment, prepaymentButton);
    if (openButton) {
      openLedgerProject(openButton.dataset.openPaymentProject, { scrollOnDesktop: true });
    }
  });
  $("#cutoffTodoList").addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-cutoff-project]");
    const delayButton = event.target.closest("[data-delay-cutoff]");
    if (delayButton) delayProjectCutoffFromTodo(delayButton.dataset.delayCutoff, Number(delayButton.dataset.delayMinutes));
    if (openButton) {
      openLedgerProject(openButton.dataset.openCutoffProject, { scrollOnDesktop: true });
    }
  });
  $("#deleteProjectButton").addEventListener("click", () => {
    if (!selectedProjectId || !confirm("确定删除当前项目台账吗？")) return;
    clearTimeout(projectAutoSaveTimer);
    state = removeProject(state, selectedProjectId);
    selectedProjectId = "";
    persistState();
    if (isCompactLedger()) navigateLedgerMobilePane("list", { replace: true });
    else renderProjectWorkspace();
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
    $("#projectDmStatus").textContent = payload.noDmBondResult
      ? "DM 无本期数据 · 已读主体库"
      : `已读取 ${sourceLabel}`;
    $("#projectDmStatus").className = payload.noDmBondResult ? "pill warning" : "pill accent";
    pushProjectDmHistoryFromCurrent();
    showToast(payload.noDmBondResult
      ? "DM 未返回本期债券，已从云端主体库预填发行人资料；本期发行要素请继续填写。"
      : `已用 ${sourceLabel} 预填新增项目，请复核后保存。`);
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
  project = replaceProjectWithDmLookup(project, projectPatch);
  if (isAbsProject(project)) syncAbsProjectSelectionScope({ updateField: false });
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
  ensureProjectPricingCapacity(project);
  $$("#projectPricingRows [data-pricing-index][data-pricing-field]").forEach((input) => {
    updateDynamicPricingField(input);
  });
  if (updateSourceText) {
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
  }
}

function updateDynamicPricingField(input) {
  const index = Number(input.dataset.pricingIndex);
  const field = input.dataset.pricingField;
  if (!Number.isInteger(index) || index < 0 || !["marketValuation", "guidancePrice"].includes(field)) return;
  ensureProjectPricingCapacity(project);
  project.tranchePricing[index] = {
    ...project.tranchePricing[index],
    [field]: numberOrNull(input.value),
  };
  syncProjectPricingMirrors(project);
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
    const hasCompleteRange = ranges.some((range) => Number.isFinite(range.low) && Number.isFinite(range.high));
    if (hasCompleteRange) {
      patch.inquiryRanges = ranges;
      patch.inquiryLow = ranges[0]?.low ?? null;
      patch.inquiryHigh = ranges[0]?.high ?? null;
      patch.inquiryLow2 = ranges[1]?.low ?? null;
      patch.inquiryHigh2 = ranges[1]?.high ?? null;
      markSource("inquiryLow", groupSource);
      markSource("inquiryHigh", groupSource);
      ranges.forEach((range, index) => {
        if (!Number.isFinite(range.low) || !Number.isFinite(range.high)) return;
        markSource(`inquiryRanges.${index}.low`, groupSource);
        markSource(`inquiryRanges.${index}.high`, groupSource);
      });
    }
  }

  assignProjectDmValueWithSource(patch, sourceMap, "shortName", normalized.shortName);
  assignProjectDmValueWithSource(patch, sourceMap, "fullName", dmProjectFullNameForProject(normalized.fullName, patch, issueGroup));
  assignProjectDmValueWithSource(patch, sourceMap, "issuerName", normalized.issuerName, normalizedProjectFieldSource(normalized, "issuerName"));
  assignProjectDmValueWithSource(patch, sourceMap, "societyCode", normalized.societyCode);
  assignProjectDmValueWithSource(patch, sourceMap, "durationText", normalizeDmTenor(normalized.durationText));
  assignProjectDmValueWithSource(patch, sourceMap, "issueScale", normalized.issueScaleYi);
  assignProjectDmValueWithSource(patch, sourceMap, "subscribeDate", normalized.subscribeDate || issueGroup?.subscribeDate);
  assignProjectDmValueWithSource(patch, sourceMap, "venue", normalized.venue);
  assignProjectDmValueWithSource(patch, sourceMap, "offeringType", normalized.offeringType);
  assignProjectDmValueWithSource(patch, sourceMap, "leadUnderwriter", normalized.leadUnderwriter);
  assignProjectDmValueWithSource(patch, sourceMap, "sponsorStatus", normalized.sponsorStatus);
  assignProjectDmValueWithSource(patch, sourceMap, "subjectRating", normalized.subjectRating, normalizedProjectFieldSource(normalized, "subjectRating"));
  assignProjectDmValueWithSource(patch, sourceMap, "ratingAgency", normalized.ratingAgency, normalizedProjectFieldSource(normalized, "ratingAgency"));
  assignProjectDmValueWithSource(patch, sourceMap, "hiddenRating", normalized.impliedRating, normalizedProjectFieldSource(normalized, "impliedRating"));
  const dmGuaranteeInfo = normalizeGuaranteeInfo(normalized.guaranteeInfo);
  if (dmGuaranteeInfo.guarantors.length) {
    patch.guaranteeInfo = {
      ...dmGuaranteeInfo,
      guarantors: dmGuaranteeInfo.guarantors.map((guarantor) => {
        const issuer = findIssuer(guarantor.name, state.issuers || []);
        return {
          ...guarantor,
          subjectRating: guarantor.subjectRating || issuer?.subjectRating || "",
          ratingAgency: guarantor.ratingAgency || issuer?.ratingAgency || "",
          source: guarantor.source || normalized.guaranteeInfo?.source || "dm",
        };
      }),
    };
    sourceMap["guarantee.method"] = dmGuaranteeInfo.method ? "dm" : "";
    patch.guaranteeInfo.guarantors.forEach((guarantor, index) => {
      sourceMap[`guarantee.guarantors.${index}.name`] = "dm";
      if (guarantor.subjectRating) sourceMap[`guarantee.guarantors.${index}.subjectRating`] = guarantor.ratingSource === "dm-company-rating" ? "dm" : "cloud";
      if (guarantor.ratingAgency) sourceMap[`guarantee.guarantors.${index}.ratingAgency`] = guarantor.ratingSource === "dm-company-rating" ? "dm" : "cloud";
    });
    warnings.push(...(Array.isArray(normalized.guaranteeInfo?.warnings) ? normalized.guaranteeInfo.warnings : []));
  }
  if (patch.hiddenRating) {
    patch.hiddenRatingSource = normalized.ratingSource?.impliedRating || "dm";
    patch.hiddenRatingAsOf = normalized.impliedRatingAsOf || payload?.diagnostic?.rating?.windImpliedRating?.asOf || "";
  }

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
          classNameSource: tranche.trancheLevel ? "dm" : "",
          shortName: tranche.shortName,
          securityId: tranche.securityId,
          scale: numberOrNull(tranche.actualScale) ?? numberOrNull(tranche.planScale),
          sharePct: tranche.sharePct,
          sharePctSource: Number.isFinite(numberOrNull(tranche.sharePct)) ? "dm" : "",
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
  const enrichedTranches = absTranches.map((tranche) => {
    if (Number.isFinite(numberOrNull(tranche.sharePct))) return tranche;
    const derivedSharePct = calculateAbsTrancheSharePct(tranche.scale, totalScale);
    return Number.isFinite(derivedSharePct)
      ? normalizeProjectAbsTranche({ ...tranche, sharePct: derivedSharePct, sharePctSource: "derived" })
      : tranche;
  });
  return normalizeProjectAbsInfo({
    ...base,
    planName: base.planName || issueGroup?.issueName || normalized.fullName || "",
    totalScale,
    bookDate: base.bookDate || issueGroup?.subscribeDate || normalized.subscribeDate || "",
    tranches: enrichedTranches,
  });
}

function findExistingAbsProject(projects, projectValue) {
  const target = normalizeProjectAbsInfo(projectValue.absInfo);
  const planName = normalizeSourceComparable(target.planName || projectValue.fullName);
  if (!planName) return null;
  return projects.find((item) => {
    if (!isAbsProject(item)) return false;
    const candidate = normalizeProjectAbsInfo(item.absInfo);
    if (normalizeSourceComparable(candidate.planName) !== planName) return false;
    return !target.bookDate || !candidate.bookDate || target.bookDate === candidate.bookDate;
  }) || null;
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
  const source = normalized?.fieldSource?.[key] || normalized?.ratingSource?.[key] || "";
  if (source === "wind-analytics") return "wind";
  return ["issuer-db", "local-issuer-db", "cloud-db", "cloud-project-index"].includes(source) ? "cloud" : "dm";
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
  if (patch.guaranteeInfo) {
    const info = normalizeGuaranteeInfo(patch.guaranteeInfo);
    if (info.method) marks["guarantee.method"] = sourcedRecognitionMark("担保方式", sourceMap["guarantee.method"] || "dm");
    info.guarantors.forEach((guarantor, index) => {
      [
        ["name", "担保人"],
        ["subjectRating", "担保人评级"],
        ["ratingAgency", "担保人评级机构"],
      ].forEach(([field, label]) => {
        if (valueHasContent(guarantor[field])) {
          marks[`guarantee.guarantors.${index}.${field}`] = sourcedRecognitionMark(label, sourceMap[`guarantee.guarantors.${index}.${field}`] || "dm");
        }
      });
    });
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
        if (!valueHasContent(tranche[field])) return;
        const source = field === "className"
          ? tranche.classNameSource || "dm"
          : field === "sharePct"
            ? tranche.sharePctSource || "dm"
            : "dm";
        marks[`abs.tranches.${index}.${field}`] = sourcedRecognitionMark(label, source);
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
  if (source === "wind") return recognitionMark("success", `${label}已由 Wind 预填`, "wind");
  if (source === "derived") return recognitionMark("success", `${label}已由系统推导`, "derived");
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
    if (["dm", "wind"].includes(existingMarks[item.field]?.source)) continue;
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
  const unusableStatuses = new Set(["reallocated", "cancelled", "failed"]);
  const usable = tranches.filter((tranche) => !unusableStatuses.has(tranche.status));
  const fallback = tranches.filter((tranche) => !["cancelled", "failed"].includes(tranche.status));
  return sortProjectDmTranches(usable.length ? usable : fallback);
}

function sortProjectDmTranches(tranches) {
  return [...(tranches || [])].sort((left, right) => compareProjectShortNameOrder(
    left?.shortName || left?.securityId || "",
    right?.shortName || right?.securityId || "",
  ));
}

function buildDmProjectSourceText(projectValue) {
  if (isAbsProject(projectValue)) return buildAbsProjectSourceText(projectValue);
  const guaranteeInfo = normalizeGuaranteeInfo(projectValue.guaranteeInfo);
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
  if (guaranteeInfo.guarantors.length) {
    lines.push(`担保人：${guaranteeInfo.guarantors.map(formatProjectGuarantor).join("；")}`);
  }
  if (guaranteeInfo.method) lines.push(`担保方式：${guaranteeInfo.method}`);
  if (valuationText) lines.push(`${projectValue.shortName || "债券简称待补"} 市场估值约${valuationText}`);
  if (guidanceText) lines.push(`如需综合定价，指导价约${guidanceText}`);
  return lines.join("\n");
}

function formatProjectGuarantor(guarantor = {}) {
  const details = [guarantor.subjectRating, guarantor.ratingAgency].filter(Boolean).join("，");
  return `${guarantor.name || "担保人待补"}${details ? `(${details})` : ""}`;
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
  if (payload.noDmBondResult) {
    const filled = [
      normalized.subjectRating ? `主体评级 ${normalized.subjectRating}` : "",
      normalized.ratingAgency ? `评级机构 ${normalized.ratingAgency}` : "",
      normalized.impliedRating ? `隐含评级 ${normalized.impliedRating}` : "",
    ].filter(Boolean);
    output.innerHTML = `
      <div class="project-dm-assist-head">
        <strong>DM 未返回本期债券</strong>
        <span>${escapeHtml([
          normalized.issuerName ? `已识别发行人 ${normalized.issuerName}` : "已识别云端主体资料",
          filled.length ? `云端主体库补充：${filled.join("、")}` : "主体资料来自云端数据库",
          "本期债券要素未沿用历史项目，请继续填写",
        ].join(" · "))}</span>
      </div>
    `;
    return;
  }
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
  const fieldSources = Object.values(payload?.normalized?.fieldSource || {});
  const hasWind = fields.includes("wind-analytics");
  const hasCloud = [...fields, ...fieldSources].some((source) => [
    "issuer-db",
    "local-issuer-db",
    "cloud-db",
    "cloud-project-index",
  ].includes(source));
  if (payload?.noDmBondResult && hasCloud) return "云端主体库";
  if (hasWind && hasCloud) return "DM+Wind+云端数据库";
  if (hasWind) return "DM+Wind";
  if (hasCloud) return "DM+云端数据库";
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

function ensureProjectGuaranteeInfo(projectValue) {
  const current = projectValue?.guaranteeInfo;
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    projectValue.guaranteeInfo = normalizeGuaranteeInfo(current || {});
    return projectValue.guaranteeInfo;
  }
  current.method = String(current.method || "").trim();
  current.rawText = String(current.rawText || "").trim();
  current.source = String(current.source || "").trim();
  if (!Array.isArray(current.guarantors)) current.guarantors = [];
  current.guarantors.forEach((guarantor) => {
    guarantor.ratingAgency = normalizeRatingAgency(guarantor.ratingAgency);
  });
  if (current.guarantors.length && !current.method) current.method = "不可撤销连带责任保证担保";
  return current;
}

function renderProjectGuarantorFields() {
  const rows = $("#projectGuarantorRows");
  if (!rows) return;
  const info = ensureProjectGuaranteeInfo(project);
  $("#projectGuaranteeMethod").value = info.method || "";
  rows.innerHTML = info.guarantors.map((guarantor, index) => `
    <div class="guarantor-row" data-guarantor-row="${index}">
      <label>担保人全称<input data-guarantor-index="${index}" data-guarantor-field="name" value="${escapeAttribute(guarantor.name || "")}"></label>
      <label>主体评级<input data-guarantor-index="${index}" data-guarantor-field="subjectRating" value="${escapeAttribute(guarantor.subjectRating || "")}"></label>
      <label>评级机构<input data-guarantor-index="${index}" data-guarantor-field="ratingAgency" value="${escapeAttribute(guarantor.ratingAgency || "")}"></label>
      <button class="text-button guarantor-remove" type="button" data-remove-guarantor="${index}">移除</button>
    </div>
  `).join("");
}

function syncProjectGuaranteeDraft() {
  project.sourceText = buildDmProjectSourceText(project);
  $("#briefInput").value = project.sourceText;
  regenerate();
  scheduleProjectDmHistorySave();
}

function fillProjectFields() {
  ensureAbsInfo(project);
  ensureProjectGuaranteeInfo(project);
  project.ratingAgency = normalizeRatingAgency(project.ratingAgency);
  $$("[data-project-field]").forEach((input) => {
    const field = input.dataset.projectField;
    input.value = project[field] ?? "";
  });
  fillAbsFields();
  renderProjectGuarantorFields();
  if ($("#projectDmSeedInput")) $("#projectDmSeedInput").value = project.shortName || "";
  ensureProjectPricingCapacity(project);
  renderProjectPricingFields();
  ensureInquiryRangeCapacity(project);
  renderTrancheInquiryFields();
  syncProjectConditionalFields();
  renderNewProjectCutoffControl(state.issuers.find((item) => item.id === selectedIssuerId) || null);
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
    $("#trancheInquiryPanel").hidden = false;
  }
}

function ensureAbsInfo(projectValue) {
  projectValue.absInfo = normalizeProjectAbsInfo(projectValue.absInfo);
  return projectValue.absInfo;
}

function normalizeProjectAbsInfo(input = {}) {
  const creditApprovalId = String(input.creditApprovalId || "").trim();
  return {
    planName: String(input.planName || "").trim(),
    totalScale: numberOrNull(input.totalScale),
    bookDate: String(input.bookDate || "").trim(),
    selectedClass: String(input.selectedClass || "").trim(),
    underlyingAsset: String(input.underlyingAsset || "").trim(),
    creditEnhancementType: String(input.creditEnhancementType || "").trim(),
    creditEnhancementParty: String(input.creditEnhancementParty || "").trim(),
    creditEnhancementIssuerId: String(input.creditEnhancementIssuerId || "").trim(),
    creditApprovalId,
    creditApprovalCode: String(input.creditApprovalCode || "").trim(),
    creditApprovalScopeType: String(input.creditApprovalScopeType || "").trim(),
    creditApprovalScopeName: String(input.creditApprovalScopeName || "").trim(),
    creditApprovalNo: String(input.creditApprovalNo || "").trim(),
    creditApprovalLevel: String(input.creditApprovalLevel || "").trim(),
    creditApprovalSource: String(input.creditApprovalSource || "").trim(),
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
  const shortName = String(input.shortName || "").trim();
  const explicitClassName = String(input.className || input.trancheLevel || input.absClassName || "").trim();
  const inferredClassName = !explicitClassName || explicitClassName === "优先级"
    ? inferAbsClassNameFromShortName(shortName)
    : "";
  return {
    id: input.id || crypto.randomUUID(),
    className: explicitClassName || inferredClassName,
    classNameSource: String(inferredClassName ? "derived" : input.classNameSource || "").trim(),
    shortName,
    securityId: String(input.securityId || input.securityCode || "").trim(),
    scale: numberOrNull(input.scale ?? input.actualScale ?? input.planScale ?? input.issueScale),
    sharePct: numberOrNull(input.sharePct),
    sharePctSource: String(input.sharePctSource || "").trim(),
    expectedMaturityDate: String(input.expectedMaturityDate || "").trim(),
    expectedTerm: String(input.expectedTerm || input.tenor || "").trim(),
    debtRating: String(input.debtRating || "").trim().toUpperCase(),
    debtRatingAgency: String(input.debtRatingAgency || "").trim(),
    inquiryLow: numberOrNull(input.inquiryLow),
    inquiryHigh: numberOrNull(input.inquiryHigh),
    selected: Boolean(input.selected),
  };
}

function syncAbsProjectSelectionScope(options = {}) {
  const { updateField = true } = options;
  const absInfo = ensureAbsInfo(project);
  const selectedTranches = absInfo.tranches.filter((tranche) => tranche.selected && tranche.shortName);
  const scopedTranches = selectedTranches.length
    ? selectedTranches
    : absInfo.tranches.filter((tranche) => tranche.shortName).slice(0, 1);
  const fallback = scopedTranches[0]?.shortName || project.shortName || "";
  const compactName = compactSelectedAbsShortNames(selectedTranches, fallback);
  if (compactName) project.shortName = compactName;
  project.shortNames = scopedTranches.map((tranche) => tranche.shortName);
  project.durationParts = scopedTranches.map((tranche) => tranche.expectedTerm || tranche.expectedMaturityDate || "");
  project.durationText = compactProjectDurations(project.durationParts.filter(Boolean));
  syncAbsProjectPricingScope(scopedTranches);
  if (updateField) {
    const shortNameInput = $('[data-project-field="shortName"]');
    if (shortNameInput) shortNameInput.value = project.shortName;
  }
  const aggregated = scopedTranches.length > 1;
  if (aggregated) {
    projectRecognitionMarks.shortName = recognitionMark("success", "项目简称已按本次投资分档聚合", "derived");
    if (updateField) setRecognitionForInput($('[data-project-field="shortName"]'), projectRecognitionMarks.shortName);
  }
}

function syncAbsProjectPricingScope(scopedTranches) {
  const existingRows = Array.isArray(project.tranchePricing) ? project.tranchePricing : [];
  const pricingByName = new Map(existingRows.map((row) => [String(row.shortName || "").trim(), row]));
  project.tranchePricing = scopedTranches.map((tranche) => {
    const existing = pricingByName.get(tranche.shortName) || {};
    return {
      shortName: tranche.shortName,
      durationText: tranche.expectedTerm || tranche.expectedMaturityDate || "",
      marketValuation: numberOrNull(existing.marketValuation),
      guidancePrice: numberOrNull(existing.guidancePrice),
    };
  });
  syncProjectPricingMirrors(project);
}

function defaultAbsTranche() {
  return normalizeProjectAbsTranche({ className: "优先级", selected: true });
}

function fillAbsFields() {
  const absInfo = ensureAbsInfo(project);
  syncAbsCreditEnhancerIdentity();
  renderAbsCreditApprovalOptions();
  $$("[data-abs-field]").forEach((input) => {
    const field = input.dataset.absField;
    input.value = absInfo[field] ?? "";
  });
  renderAbsTrancheFields();
  syncAbsCreditSnapshotReadOnly();
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

function syncAbsCreditEnhancerIdentity() {
  const absInfo = ensureAbsInfo(project);
  const current = (state.issuers || []).find((issuer) => issuer.id === absInfo.creditEnhancementIssuerId);
  const matched = findIssuer(absInfo.creditEnhancementParty, state.issuers || []);
  absInfo.creditEnhancementIssuerId = matched?.id
    || (current?.legalName === absInfo.creditEnhancementParty ? current.id : "");
}

function clearInapplicableAbsCreditApproval() {
  const absInfo = ensureAbsInfo(project);
  if (!absInfo.creditApprovalId) return;
  const approval = (state.absCreditApprovals || []).find((item) => item.id === absInfo.creditApprovalId);
  if (approval && absCreditApprovalAppliesToProject(approval, project)) return;
  Object.assign(absInfo, {
    creditApprovalId: "",
    creditApprovalCode: "",
    creditApprovalScopeType: "",
    creditApprovalScopeName: "",
    creditApprovalNo: "",
    creditApprovalLevel: "",
    creditApprovalSource: "",
    creditApprovalText: "",
    approvalAmount: null,
    approvalRatio: null,
    approvalTermText: "",
  });
  syncAbsCreditSnapshotInputs();
  syncAbsCreditSnapshotReadOnly();
}

function renderAbsCreditApprovalOptions() {
  const select = $("#absCreditApprovalSelect");
  if (!select) return;
  const absInfo = ensureAbsInfo(project);
  const approvals = applicableAbsCreditApprovals(project, state.absCreditApprovals || []);
  select.innerHTML = [
    '<option value="">未关联 50217 批单</option>',
    ...approvals.map((approval) => {
      const scope = approval.scopeType === ABS_CREDIT_SCOPE_SHELF
        ? `储架 · ${approval.shelfName}`
        : `单项目 · ${approval.projectName}`;
      const facts = [
        scope,
        approval.approvalNo || "无批单号",
        Number.isFinite(approval.approvedAmount) ? `${formatNumber(approval.approvedAmount)}亿` : "",
      ].filter(Boolean).join(" · ");
      return `<option value="${escapeAttribute(approval.id)}">${escapeHtml(facts)}</option>`;
    }),
  ].join("");
  select.value = approvals.some((approval) => approval.id === absInfo.creditApprovalId) ? absInfo.creditApprovalId : "";
  const hint = $("#absCreditApprovalHint");
  if (!hint) return;
  if (!absInfo.creditEnhancementParty) {
    hint.textContent = "请先填写增信 / 支持主体；ABS 不会使用普通信用债 50206 授信。";
  } else if (!absInfo.creditEnhancementIssuerId) {
    hint.textContent = "该增信方尚未进入主体库；点击“即时新增 50217”可同时新增主体和批单。";
  } else if (!approvals.length) {
    hint.textContent = "没有适用于该增信方及专项计划的 50217 批单；可新增单项目批或储架批。";
  } else if (absInfo.creditApprovalId) {
    const selected = approvals.find((approval) => approval.id === absInfo.creditApprovalId);
    hint.textContent = selected?.scopeType === ABS_CREDIT_SCOPE_SHELF
      ? `已关联总行储架批：${selected.shelfName}；该批单可覆盖多个 ABS 项目。`
      : `已关联总行批：${selected?.projectName || absInfo.planName}；仅适用于本项目。`;
  } else {
    hint.textContent = `找到 ${approvals.length} 张可用 50217 批单，请选择；ABS 不会使用 50206。`;
  }
}

function applySelectedAbsCreditApprovalToProject() {
  const select = $("#absCreditApprovalSelect");
  const approvalId = String(select?.value || "").trim();
  if (!approvalId) {
    Object.assign(ensureAbsInfo(project), {
      creditApprovalId: "",
      creditApprovalCode: "",
      creditApprovalScopeType: "",
      creditApprovalScopeName: "",
      creditApprovalNo: "",
      creditApprovalLevel: "",
      creditApprovalSource: "",
      creditApprovalText: "",
      approvalAmount: null,
      approvalRatio: null,
      approvalTermText: "",
    });
    syncAbsCreditSnapshotInputs();
    renderAbsCreditApprovalOptions();
    syncAbsCreditSnapshotReadOnly();
    return;
  }
  const approval = (state.absCreditApprovals || []).find((item) => item.id === approvalId);
  if (!approval || !absCreditApprovalAppliesToProject(approval, project)) {
    showToast("这张 50217 批单不适用于当前增信方或专项计划。");
    renderAbsCreditApprovalOptions();
    return;
  }
  project = applyAbsCreditApproval(project, approval);
  syncAbsCreditSnapshotInputs();
  renderAbsCreditApprovalOptions();
  syncAbsCreditSnapshotReadOnly();
}

function openQuickAbsCreditPanel() {
  const absInfo = ensureAbsInfo(project);
  project.instrumentType = project.instrumentType || "ABS";
  const form = $("#quickAbsCreditForm");
  if (!form) return;
  form.reset();
  renderQuickAbsCreditEnhancerOptions();
  $("#quickAbsCreditApprovalLevel").value = "总行";
  $("#quickAbsCreditScopeType").value = ABS_CREDIT_SCOPE_PROJECT;
  $("#quickAbsCreditProjectName").value = absInfo.planName || project.fullName || "";
  $("#quickAbsEnhancerLegalName").value = absInfo.creditEnhancementParty || "";
  $("#quickAbsEnhancerAliases").value = "";
  $("#quickAbsEnhancerDefaultBranch").value = project.branch || "";
  $("#quickAbsEnhancerEnterpriseType").value = "";
  $("#quickAbsEnhancerSubjectRating").value = "";
  $("#quickAbsEnhancerRatingAgency").value = "";
  $("#quickAbsEnhancerHiddenRating").value = "";
  syncQuickAbsNewEnhancerFields();
  syncQuickAbsCreditScopeFields();
  const panel = $("#quickAbsCreditPanel");
  panel.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    const select = $("#quickAbsCreditEnhancerIssuerId");
    (select.value === "__new__" ? $("#quickAbsEnhancerLegalName") : select)?.focus();
  });
}

function closeQuickAbsCreditPanel() {
  const panel = $("#quickAbsCreditPanel");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove("modal-open");
  $("#openAbsCreditLibraryButton")?.focus();
}

function renderQuickAbsCreditEnhancerOptions() {
  const select = $("#quickAbsCreditEnhancerIssuerId");
  if (!select) return;
  const absInfo = ensureAbsInfo(project);
  const matched = (state.issuers || []).find((issuer) => issuer.id === absInfo.creditEnhancementIssuerId)
    || findIssuer(absInfo.creditEnhancementParty, state.issuers || []);
  select.innerHTML = [
    '<option value="">请选择已有主体</option>',
    ...(state.issuers || [])
      .slice()
      .sort((left, right) => left.legalName.localeCompare(right.legalName, "zh-CN"))
      .map((issuer) => `<option value="${escapeAttribute(issuer.id)}">${escapeHtml(issuer.legalName)}</option>`),
    '<option value="__new__">＋ 增信方未入库，就地新增主体</option>',
  ].join("");
  select.value = matched?.id || (absInfo.creditEnhancementParty ? "__new__" : "");
}

function syncQuickAbsNewEnhancerFields() {
  const creating = $("#quickAbsCreditEnhancerIssuerId")?.value === "__new__";
  const panel = $("#quickAbsNewEnhancerFields");
  if (panel) panel.hidden = !creating;
  [
    "quickAbsEnhancerLegalName",
    "quickAbsEnhancerDefaultBranch",
    "quickAbsEnhancerSubjectRating",
    "quickAbsEnhancerRatingAgency",
    "quickAbsEnhancerHiddenRating",
  ].forEach((id) => {
    if ($(`#${id}`)) $(`#${id}`).required = creating;
  });
}

function syncQuickAbsCreditScopeFields() {
  const shelf = $("#quickAbsCreditScopeType")?.value === ABS_CREDIT_SCOPE_SHELF;
  $("#quickAbsCreditProjectNameField").hidden = shelf;
  $("#quickAbsCreditShelfNameField").hidden = !shelf;
  $("#quickAbsCreditProjectName").required = !shelf;
  $("#quickAbsCreditShelfName").required = shelf;
}

function fillParsedAbsCreditFields(prefix) {
  const rawText = $(`#${prefix}RawText`)?.value.trim() || "";
  const parsed = parseCreditText(rawText);
  if (/储架批/.test(rawText)) $(`#${prefix}ScopeType`).value = ABS_CREDIT_SCOPE_SHELF;
  const fields = {
    [`${prefix}ApprovalLevel`]: parsed.approvalLevel,
    [`${prefix}ApprovedAmount`]: parsed.approvedAmount,
    [`${prefix}ApprovedRatio`]: parsed.approvedRatio,
    [`${prefix}InvestmentTermText`]: parsed.investmentTermText,
  };
  Object.entries(fields).forEach(([id, value]) => {
    const input = $(`#${id}`);
    if (input && value !== null && value !== undefined && !input.value) input.value = value;
  });
}

function readQuickAbsEnhancer() {
  const selectedId = $("#quickAbsCreditEnhancerIssuerId").value;
  if (selectedId !== "__new__") {
    const existing = (state.issuers || []).find((issuer) => issuer.id === selectedId);
    if (!existing) throw new Error("请选择 50217 的增信方主体。");
    return existing;
  }
  const draft = {
    legalName: $("#quickAbsEnhancerLegalName").value,
    aliases: $("#quickAbsEnhancerAliases").value,
    defaultBranch: $("#quickAbsEnhancerDefaultBranch").value,
    enterpriseType: $("#quickAbsEnhancerEnterpriseType").value,
    subjectRating: $("#quickAbsEnhancerSubjectRating").value,
    ratingAgency: $("#quickAbsEnhancerRatingAgency").value,
    hiddenRating: $("#quickAbsEnhancerHiddenRating").value,
  };
  const required = [
    ["legalName", "主体正式名称", "quickAbsEnhancerLegalName"],
    ["defaultBranch", "联动分行", "quickAbsEnhancerDefaultBranch"],
    ["subjectRating", "主体评级", "quickAbsEnhancerSubjectRating"],
    ["ratingAgency", "评级机构", "quickAbsEnhancerRatingAgency"],
    ["hiddenRating", "市场隐含评级", "quickAbsEnhancerHiddenRating"],
  ];
  const missing = required.filter(([key]) => !String(draft[key] || "").trim());
  if (missing.length) {
    $(`#${missing[0][2]}`)?.focus();
    throw new Error(`新增增信方主体还需填写：${missing.map(([, label]) => label).join("、")}。`);
  }
  const duplicate = (state.issuers || []).find((issuer) => issuer.legalName === draft.legalName.trim());
  if (duplicate) return duplicate;
  return issuerFromDraft(draft);
}

function saveQuickAbsCreditApproval(event) {
  event.preventDefault();
  try {
    fillParsedAbsCreditFields("quickAbsCredit");
    syncQuickAbsCreditScopeFields();
    const enhancer = readQuickAbsEnhancer();
    const approval = normalizeAbsCreditApproval({
      businessCode: ABS_CREDIT_CODE,
      enhancerIssuerId: enhancer.id,
      enhancerName: enhancer.legalName,
      approvalNo: $("#quickAbsCreditApprovalNo").value,
      approvalLevel: $("#quickAbsCreditApprovalLevel").value,
      scopeType: $("#quickAbsCreditScopeType").value,
      projectName: $("#quickAbsCreditProjectName").value,
      shelfName: $("#quickAbsCreditShelfName").value,
      approvedAmount: $("#quickAbsCreditApprovedAmount").value,
      approvedRatio: $("#quickAbsCreditApprovedRatio").value,
      investmentTermText: $("#quickAbsCreditInvestmentTermText").value,
      rawText: $("#quickAbsCreditRawText").value,
    });
    const stateWithEnhancer = (state.issuers || []).some((issuer) => issuer.id === enhancer.id)
      ? state
      : upsertIssuer(state, enhancer);
    state = upsertAbsCreditApproval(stateWithEnhancer, approval);
    const saved = (state.absCreditApprovals || []).find((item) => item.id === approval.id) || approval;
    project = applyAbsCreditApproval(project, saved);
    project.sourceText = buildDmProjectSourceText(project);
    $("#briefInput").value = project.sourceText;
    persistState();
    renderIssuerOptions();
    renderIssuerList();
    renderAbsCreditEnhancerOptions();
    renderAbsCreditApprovalList();
    syncIssuerCreditWorkspace();
    fillProjectFields();
    regenerate();
    scheduleProjectDmHistorySave();
    closeQuickAbsCreditPanel();
    showToast(`50217 批单已新增，并已关联当前 ABS 项目。`);
  } catch (error) {
    showToast(error.message);
  }
}

function syncAbsCreditSnapshotInputs() {
  const absInfo = ensureAbsInfo(project);
  ["approvalAmount", "approvalRatio", "approvalTermText", "creditApprovalText"].forEach((field) => {
    const input = `[data-abs-field="${field}"]`;
    if ($(input)) $(input).value = absInfo[field] ?? "";
  });
}

function syncAbsCreditSnapshotReadOnly() {
  const linked = Boolean(ensureAbsInfo(project).creditApprovalId);
  ["approvalAmount", "approvalRatio", "approvalTermText", "creditApprovalText"].forEach((field) => {
    const input = `[data-abs-field="${field}"]`;
    if ($(input)) $(input).readOnly = linked;
  });
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

function updateAbsTranchesFromInputs(changedInput = null) {
  const absInfo = ensureAbsInfo(project);
  const changedCard = changedInput?.closest?.("[data-abs-tranche-index]");
  const changedIndex = Number(changedCard?.dataset?.absTrancheIndex);
  const changedField = changedInput?.dataset?.absTrancheField || "";
  absInfo.tranches = [...$("#absTrancheRows").querySelectorAll("[data-abs-tranche-index]")].map((card, index) => {
    const existing = absInfo.tranches[index] || {};
    const values = {
      id: existing.id,
      classNameSource: existing.classNameSource || "",
      sharePctSource: existing.sharePctSource || "",
    };
    card.querySelectorAll("[data-abs-tranche-field]").forEach((input) => {
      values[input.dataset.absTrancheField] = input.type === "checkbox"
        ? input.checked
        : input.type === "number"
          ? numberOrNull(input.value)
          : input.value.trim();
    });
    if (index === changedIndex && changedField === "className") values.classNameSource = "manual";
    if (index === changedIndex && changedField === "sharePct") values.sharePctSource = "manual";
    return normalizeProjectAbsTranche(values);
  });
  project.instrumentType = project.instrumentType || "ABS";
}

function refreshDerivedAbsTrancheFields(absInfo) {
  const totalScale = numberOrNull(absInfo?.totalScale);
  absInfo.tranches = (absInfo?.tranches || []).map((tranche) => {
    const inferredClassName = inferAbsClassNameFromShortName(tranche.shortName);
    const classPatch = (!tranche.className || tranche.classNameSource === "derived") && inferredClassName
      ? { className: inferredClassName, classNameSource: "derived" }
      : {};
    const derivedSharePct = calculateAbsTrancheSharePct(tranche.scale, totalScale);
    const sharePatch = (!Number.isFinite(numberOrNull(tranche.sharePct)) || tranche.sharePctSource === "derived")
      && Number.isFinite(derivedSharePct)
      ? { sharePct: derivedSharePct, sharePctSource: "derived" }
      : {};
    return normalizeProjectAbsTranche({ ...tranche, ...classPatch, ...sharePatch });
  });
}

function syncDerivedAbsTrancheInputs() {
  const cards = [...$("#absTrancheRows").querySelectorAll("[data-abs-tranche-index]")];
  cards.forEach((card, index) => {
    const tranche = project.absInfo?.tranches?.[index];
    if (!tranche) return;
    const classInput = card.querySelector('[data-abs-tranche-field="className"]');
    const shareInput = card.querySelector('[data-abs-tranche-field="sharePct"]');
    if (classInput && tranche.classNameSource === "derived") {
      classInput.value = tranche.className;
      const mark = recognitionMark("success", "分档级别已由简称推导", "derived");
      projectRecognitionMarks[`abs.tranches.${index}.className`] = mark;
      setRecognitionForInput(classInput, mark);
    }
    if (shareInput && tranche.sharePctSource === "derived") {
      shareInput.value = tranche.sharePct ?? "";
      const mark = recognitionMark("success", "分档占比已按分档规模与总规模计算", "derived");
      projectRecognitionMarks[`abs.tranches.${index}.sharePct`] = mark;
      setRecognitionForInput(shareInput, mark);
    }
  });
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

  const guaranteeInfo = normalizeGuaranteeInfo(projectValue.guaranteeInfo);
  if (guaranteeInfo.guarantors.length || guaranteeInfo.method) {
    marks["guarantee.method"] = guaranteeInfo.method
      ? recognitionMark("success", "担保方式已识别")
      : recognitionMark("attention", "DM 未提供担保方式，请根据发行文件确认");
    guaranteeInfo.guarantors.forEach((guarantor, index) => {
      marks[`guarantee.guarantors.${index}.name`] = recognitionMark("success", "担保人已识别");
      marks[`guarantee.guarantors.${index}.subjectRating`] = guarantor.subjectRating
        ? recognitionMark("success", "担保人评级已识别")
        : recognitionMark("attention", "担保人评级待补充");
      marks[`guarantee.guarantors.${index}.ratingAgency`] = guarantor.ratingAgency
        ? recognitionMark("success", "担保人评级机构已识别")
        : recognitionMark("attention", "担保人评级机构待补充");
    });
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
  ensureInquiryRangeCapacity(projectValue);
  for (let index = 0; index < count; index += 1) {
    const range = projectValue.inquiryRanges?.[index] || {};
    marks[`inquiryRanges.${index}.low`] = index === 0 && marks.inquiryLow
      ? marks.inquiryLow
      : Number.isFinite(numberOrNull(range.low))
        ? recognitionMark("success", `${inquiryVarietyLabel(projectValue, index)}询价下限已识别`)
        : recognitionMark("error", `${inquiryVarietyLabel(projectValue, index)}询价下限未识别，请补充`);
    marks[`inquiryRanges.${index}.high`] = index === 0 && marks.inquiryHigh
      ? marks.inquiryHigh
      : Number.isFinite(numberOrNull(range.high))
        ? recognitionMark("success", `${inquiryVarietyLabel(projectValue, index)}询价上限已识别`)
        : recognitionMark("error", `${inquiryVarietyLabel(projectValue, index)}询价上限未识别，请补充`);
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
  const guaranteeMethod = $("#projectGuaranteeMethod");
  if (guaranteeMethod) setRecognitionForInput(guaranteeMethod, projectRecognitionMarks["guarantee.method"]);
  $$("[data-guarantor-index][data-guarantor-field]").forEach((input) => {
    const key = `guarantee.guarantors.${input.dataset.guarantorIndex}.${input.dataset.guarantorField}`;
    setRecognitionForInput(input, projectRecognitionMarks[key]);
  });
  $$("[data-inquiry-index][data-inquiry-bound]").forEach((input) => {
    const key = `inquiryRanges.${input.dataset.inquiryIndex}.${input.dataset.inquiryBound}`;
    setRecognitionForInput(input, projectRecognitionMarks[key]);
  });
  const issuerSearchInput = $("#issuerSearchInput");
  if (issuerSearchInput) setRecognitionForInput(issuerSearchInput, projectRecognitionMarks.issuerSelect);
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
  renderNewProjectCutoffControl(issuer);
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

function setNewProjectCutoffMode(mode) {
  if (!NEW_PROJECT_CUTOFF_MODES.has(mode)) return;
  newProjectCutoffMode = mode;
  const issuer = state.issuers.find((item) => item.id === selectedIssuerId) || null;
  renderNewProjectCutoffControl(issuer);
}

function renderNewProjectCutoffControl(issuer = null, referenceDate = new Date()) {
  const preview = $("#newProjectCutoffPreview");
  if (!preview) return;
  const existing = findExistingLedgerProject(project);
  const suggestion = resolveNewProjectCutoff(project, issuer, referenceDate, {
    dayMode: newProjectCutoffMode,
    existingProject: existing,
  });
  // Save exactly the deadline currently displayed, including across a time/day boundary.
  newProjectCutoffPreview = suggestion;
  const date = suggestion.cutoffAt?.slice(0, 10) || "";
  const time = suggestion.cutoffAt?.slice(11, 16) || "";
  const today = localDate(referenceDate);
  const dayLabel = date === today
    ? "今天"
    : /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
      : "日期待确认";
  const sourcePrefix = existing?.cutoffAt && newProjectCutoffMode === "auto"
    ? "台账已存"
    : suggestion.cutoffSource === "项目简表"
    ? "简表"
    : suggestion.cutoffSource === "簿记日期"
      ? "簿记日"
      : newProjectCutoffMode === "auto"
        ? "智能"
        : newProjectCutoffMode === "today"
          ? "已选今天"
          : "已选下一工作日";
  preview.textContent = `${sourcePrefix} · ${dayLabel}${time ? ` ${time}` : ""}`;
  const hint = $("#newProjectCutoffHint");
  hint.hidden = !existing;
  hint.textContent = existing
    ? newProjectCutoffMode === "auto" && existing.cutoffAt
      ? "同名项目已存在，保留已存截标时间；选择今天或下一工作日可改期。"
      : "将按上方时间更新已有项目，并保留改期记录。"
    : "";
  $$('[data-new-project-cutoff-mode]').forEach((button) => {
    const active = button.dataset.newProjectCutoffMode === newProjectCutoffMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
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
      <span>正在读取 DM 存续债最近可用估值...</span>
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
  const actualValuationDate = payload.actualValuationDate || payload.valuationDate || "上一日";
  const dateText = payload.actualValuationDate && payload.valuationDate && payload.actualValuationDate !== payload.valuationDate
    ? `${actualValuationDate}（最近可用）`
    : actualValuationDate;
  const summary = `${suggestions.length} 个期限 · ${payload.pricedCandidateCount || 0}/${payload.candidateCount || 0} 条 DM 可比券 · ${dateText}`;
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
  const referenceOnly = Boolean(item.referenceOnly);
  const range = referenceOnly
    ? "仅列参考券"
    : item.low === item.high
      ? formatValuationRate(item.center)
      : `${formatValuationRate(item.low)}-${formatValuationRate(item.high)}`;
  const confidenceText = [item.confidence, item.clusterNote].filter(Boolean).join(" · ");
  const headline = referenceOnly
    ? `${item.durationText || "目标期限"} 暂无可靠建议`
    : `${item.durationText || "目标期限"} 参考 ${formatValuationRate(item.center)}`;
  return `
    <article class="valuation-suggestion-card">
      <div class="valuation-suggestion-main">
        <div>
          <strong>${escapeHtml(headline)}</strong>
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
    item.yieldBasis || "",
    item.valuationDate || "",
    Number.isFinite(numberOrNull(item.curveResidualBp)) ? `曲线偏离${item.curveResidualBp > 0 ? "+" : ""}${formatNumber(item.curveResidualBp)}bp` : "",
    Number(item.sourceSpreadBp) >= 1 ? `多源差${formatNumber(item.sourceSpreadBp)}bp` : "",
    item.stale ? `滞后${formatNumber(item.ageDays)}天` : "",
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
  const route = parseRouteFromHash();
  if (selected && route?.view === "ledger" && route.target === selected.id
    && (route.step === "result" || route.kind === "project-result")) {
    openResultEntryPanel(false);
  }
  syncLedgerMobilePane();
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
  $("#dashboardBidding").textContent = counts.bidding;
  $("#dashboardBidFinal").textContent = counts.bidFinal;
  $("#dashboardResulted").textContent = counts.resulted;
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
    if (isCompactLedger()) navigateLedgerMobilePane("overview");
    else {
      switchView("ledger");
      renderProjectWorkspace();
      $("#mailPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    callMailer("preview");
    return;
  }
  if (source === "protocol") {
    selectedProtocolTransferId = sourceId;
    protocolTransferEditMode = true;
    switchView("secondary-trading");
    switchSecondaryWorkspacePanel("protocol");
    renderProtocolTransferWorkspace();
    $("#protocolTransferForm").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (source === "project") {
    openLedgerProject(sourceId, { kind, scrollOnDesktop: true });
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

async function loadPolicyCurve({ refresh = false } = {}) {
  const card = $("#policyCurveCard");
  const retry = $("#policyCurveRetry");
  if (!card || !retry) return;

  if (policyCurveController) policyCurveController.abort();
  const controller = new AbortController();
  policyCurveController = controller;
  renderPolicyCurveMessage("loading", refresh ? "正在刷新 DM 曲线" : "正在读取 DM 曲线");
  retry.disabled = true;

  try {
    const response = await fetch(DM_POLICY_CURVE_URL, {
      credentials: "same-origin",
      headers: { ...authHeaders(), Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      renderPolicyCurveMessage("error", payload?.hint || "曲线读取失败");
      return;
    }
    if (!payload?.ok || !Array.isArray(payload.nodes)) {
      renderPolicyCurveMessage("empty", payload?.hint || "暂无可用曲线数据");
      return;
    }
    renderPolicyCurve(payload);
  } catch (error) {
    if (error.name !== "AbortError") renderPolicyCurveMessage("error", "曲线读取失败");
  } finally {
    if (policyCurveController === controller) {
      policyCurveController = null;
      retry.disabled = false;
    }
  }
}

function renderPolicyCurve(payload) {
  const card = $("#policyCurveCard");
  const points = $("#policyCurvePoints");
  const updatedAt = $("#policyCurveUpdatedAt");
  const nodes = new Map((payload.nodes || []).map((node) => [String(node.tenor || "").toUpperCase(), node]));
  card.dataset.curveState = payload.stale ? "stale" : "ready";
  card.setAttribute("aria-busy", "false");
  points.innerHTML = POLICY_CURVE_TERMS.map((tenor) => {
    const node = nodes.get(tenor);
    const rawValue = node?.yieldPct;
    const value = rawValue === null || rawValue === undefined || rawValue === "" ? Number.NaN : Number(rawValue);
    const available = Number.isFinite(value);
    const derived = available && node?.method === "derived-linear";
    const keyTerm = POLICY_CURVE_KEY_TERMS.has(tenor);
    return `
      <span class="policy-curve-point ${available ? "" : "is-missing"} ${derived ? "is-derived" : ""} ${keyTerm ? "is-key" : ""}" data-curve-term="${tenor}">
        <span>${tenor}</span><strong>${available ? `${derived ? "≈" : ""}${value.toFixed(3)}%` : "—"}</strong>
      </span>
    `;
  }).join("");
  const labels = [
    payload.actualValuationDate ? `估值日 ${formatPolicyCurveDate(payload.actualValuationDate)}` : "",
    payload.retrievedAt ? `查询 ${formatPolicyCurveQueryTime(payload.retrievedAt)}` : "",
    payload.derivedTerms?.length ? "含线性插值" : "",
    payload.partial ? "部分档位" : "",
    payload.stale ? "旧数据" : "",
  ].filter(Boolean);
  updatedAt.textContent = labels.join(" · ");
}

function renderPolicyCurveMessage(stateName, message) {
  const card = $("#policyCurveCard");
  const points = $("#policyCurvePoints");
  const updatedAt = $("#policyCurveUpdatedAt");
  if (!card || !points || !updatedAt) return;
  card.dataset.curveState = stateName;
  card.setAttribute("aria-busy", String(stateName === "loading"));
  points.innerHTML = stateName === "loading"
    ? POLICY_CURVE_TERMS.map(() => '<span class="policy-curve-placeholder"></span>').join("")
    : `<span class="policy-curve-message">${escapeHtml(message)}</span>`;
  updatedAt.textContent = stateName === "loading" ? message : "DM · 中债国开债收益率曲线";
}

function formatPolicyCurveDate(value = "") {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "—";
}

function formatPolicyCurveQueryTime(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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
  $("#protocolTransferMarketMaker").addEventListener("input", syncProtocolTransferTemplateMatch);
  $("#protocolTransferTemplateSelect").addEventListener("change", renderProtocolTransferTemplateSummary);
  $("#protocolTransferGenerateDocxButton").addEventListener("click", generateProtocolTransferApplicationDocx);
  $("#protocolTransferTemplateInput").addEventListener("change", addCustomProtocolTransferTemplate);
  $("#protocolTransferDeleteTemplateButton").addEventListener("click", deleteSelectedProtocolTransferTemplate);
  $("#protocolTransferStepActions").addEventListener("click", handleProtocolTransferFormStep);
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
    const stepButton = event.target.closest("[data-protocol-transfer-step]");
    if (stepButton) {
      completeProtocolTransferStep(stepButton.dataset.protocolTransferId, stepButton.dataset.protocolTransferStep);
      return;
    }
    const recordButton = event.target.closest("[data-protocol-transfer-open]");
    if (!recordButton) return;
    openProtocolTransferRecord(recordButton.dataset.protocolTransferId);
  });
  initializeProtocolTransferImport();
  loadCustomProtocolTransferTemplates().then(() => {
    renderProtocolTransferTemplateOptions();
    syncProtocolTransferTemplateMatch();
  }).catch(() => renderProtocolTransferTemplateOptions());
}

function initializeProtocolTransferImport() {
  const isReady = typeof window.mammoth?.extractRawText === "function";
  $("#protocolTransferDocxInput").disabled = false;
  $("#protocolTransferDocxButton").classList.remove("unavailable");
  $("#protocolTransferDocxButtonText").textContent = isReady ? "上传 Word/PDF/图片" : "上传 PDF/图片";
}

function allProtocolTransferTemplates() {
  return [...BUILTIN_PROTOCOL_TRANSFER_TEMPLATES, ...customProtocolTransferTemplates];
}

function selectedProtocolTransferTemplate() {
  const selectedId = $("#protocolTransferTemplateSelect")?.value || "";
  if (selectedId) return protocolTransferTemplateById(selectedId, allProtocolTransferTemplates());
  return matchProtocolTransferTemplate($("#protocolTransferMarketMaker")?.value || "", allProtocolTransferTemplates());
}

function renderProtocolTransferTemplateOptions(preferredId = "") {
  const select = $("#protocolTransferTemplateSelect");
  if (!select) return;
  const current = preferredId || select.value;
  const builtins = BUILTIN_PROTOCOL_TRANSFER_TEMPLATES.map((template) =>
    `<option value="${escapeAttribute(template.id)}">${escapeHtml(template.label)} · 归档模板</option>`,
  ).join("");
  const customs = customProtocolTransferTemplates.map((template) =>
    `<option value="${escapeAttribute(template.id)}">${escapeHtml(template.label)} · 自定义模板</option>`,
  ).join("");
  select.innerHTML = `<option value="">按做市商自动匹配</option>${builtins}${customs}`;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  renderProtocolTransferTemplateSummary();
}

function syncProtocolTransferTemplateMatch() {
  const select = $("#protocolTransferTemplateSelect");
  if (!select) return;
  const matched = matchProtocolTransferTemplate($("#protocolTransferMarketMaker").value, allProtocolTransferTemplates());
  select.value = matched?.id || "";
  renderProtocolTransferTemplateSummary();
}

function renderProtocolTransferTemplateSummary() {
  const summary = $("#protocolTransferTemplateSummary");
  const deleteButton = $("#protocolTransferDeleteTemplateButton");
  if (!summary || !deleteButton) return;
  const template = selectedProtocolTransferTemplate();
  deleteButton.hidden = !template?.custom;
  if (!template) {
    summary.textContent = "尚未匹配做市商模板。请补充做市商，或添加一份其他做市商的标准申请单。";
    summary.dataset.status = "attention";
    return;
  }
  const fixed = template.fixedFields || {};
  summary.textContent = [
    template.label,
    fixed.traderCode ? `交易商代码 ${fixed.traderCode}` : "",
    fixed.shareholderAccount ? `股东账号 ${fixed.shareholderAccount}` : "",
    fixed.seatNumber ? `席位 ${fixed.seatNumber}` : "",
    fixed.phone ? `电话 ${fixed.phone}` : "",
    template.custom ? "仅保存在当前浏览器" : "来自 X 盘最新归档",
  ].filter(Boolean).join(" · ");
  summary.dataset.status = "ready";
}

async function generateProtocolTransferApplicationDocx() {
  const button = $("#protocolTransferGenerateDocxButton");
  const summary = $("#protocolTransferTemplateSummary");
  const record = readProtocolTransferForm();
  const template = selectedProtocolTransferTemplate();
  const validation = validateProtocolTransferApplication(record, template);
  if (!validation.ok) {
    summary.textContent = validation.errors.join("；");
    summary.dataset.status = "error";
    showToast(validation.errors[0]);
    return;
  }
  button.disabled = true;
  button.classList.add("busy");
  summary.textContent = `正在按 ${template.label} 模板生成申请单…`;
  summary.dataset.status = "working";
  try {
    if (typeof window.PizZip !== "function") throw new Error("Word 生成组件未加载，请刷新页面后重试");
    const templateBuffer = await protocolTransferTemplateArrayBuffer(template);
    const zip = new window.PizZip(templateBuffer);
    const documentPart = zip.file("word/document.xml");
    if (!documentPart) throw new Error("模板缺少 word/document.xml");
    const nextXml = patchProtocolTransferDocumentXml(documentPart.asText(), record, template);
    zip.file("word/document.xml", nextXml);
    const output = zip.generate({
      type: "uint8array",
      compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    downloadBlob(
      protocolTransferApplicationFilename(record, template),
      new Blob([output], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    );
    $("#protocolTransferTemplateSelect").value = template.id;
    summary.textContent = `${template.label} 申请单已生成；最终买方未写入 Word。`;
    summary.dataset.status = "ready";
    showToast("协议转让申请单已生成，可发送做市商用印。");
  } catch (error) {
    summary.textContent = `生成失败：${error.message || "未知错误"}`;
    summary.dataset.status = "error";
    showToast(`Word 生成失败：${error.message || "未知错误"}`);
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
  }
}

async function protocolTransferTemplateArrayBuffer(template) {
  if (template.custom && template.arrayBuffer) return template.arrayBuffer.slice(0);
  const build = document.querySelector('meta[name="application-build"]')?.content || "latest";
  const response = await fetch(`${template.url}?v=${encodeURIComponent(build)}`);
  if (!response.ok) throw new Error(`${template.label} 模板读取失败`);
  return response.arrayBuffer();
}

async function addCustomProtocolTransferTemplate() {
  const input = $("#protocolTransferTemplateInput");
  const file = input.files[0];
  if (!file) return;
  try {
    if (!file.name.toLowerCase().endsWith(".docx")) throw new Error("请上传标准 .docx 申请单");
    if (typeof window.PizZip !== "function") throw new Error("Word 模板组件未加载，请刷新页面后重试");
    const arrayBuffer = await file.arrayBuffer();
    const zip = new window.PizZip(arrayBuffer);
    const xml = zip.file("word/document.xml")?.asText();
    if (!xml) throw new Error("该文件不是有效的 Word 模板");
    const draft = extractProtocolTransferTemplateMetadata(xml, {
      id: `custom-${crypto.randomUUID()}`,
      sourceFileName: file.name,
      sourceUpdatedAt: new Date(file.lastModified || Date.now()).toISOString(),
      custom: true,
    });
    const builtInMatch = matchProtocolTransferTemplate(draft.marketMakerName, BUILTIN_PROTOCOL_TRANSFER_TEMPLATES);
    if (builtInMatch) throw new Error(`${builtInMatch.label} 已有 X 盘归档模板，无需重复添加`);
    const existing = matchProtocolTransferTemplate(draft.marketMakerName, customProtocolTransferTemplates);
    if (existing) draft.id = existing.id;
    const stored = { ...draft, arrayBuffer };
    await putProtocolTransferTemplate(stored);
    customProtocolTransferTemplates = [
      ...customProtocolTransferTemplates.filter((template) => template.id !== stored.id),
      stored,
    ].sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    $("#protocolTransferMarketMaker").value = stored.marketMakerName;
    renderProtocolTransferTemplateOptions(stored.id);
    showToast(`已添加 ${stored.label} 模板，仅保存在当前浏览器。`);
  } catch (error) {
    showToast(`模板添加失败：${error.message || "未知错误"}`);
  } finally {
    input.value = "";
  }
}

async function deleteSelectedProtocolTransferTemplate() {
  const template = selectedProtocolTransferTemplate();
  if (!template?.custom) return;
  if (!confirm(`确认删除当前浏览器中的 ${template.label} 模板？`)) return;
  await deleteProtocolTransferTemplate(template.id);
  customProtocolTransferTemplates = customProtocolTransferTemplates.filter((item) => item.id !== template.id);
  renderProtocolTransferTemplateOptions();
  syncProtocolTransferTemplateMatch();
  showToast(`${template.label} 模板已删除。`);
}

async function loadCustomProtocolTransferTemplates() {
  if (!window.indexedDB) return [];
  const db = await openProtocolTransferTemplateDb();
  const transaction = db.transaction(PROTOCOL_TRANSFER_TEMPLATE_STORE, "readonly");
  const request = transaction.objectStore(PROTOCOL_TRANSFER_TEMPLATE_STORE).getAll();
  customProtocolTransferTemplates = (await indexedDbRequest(request))
    .filter((template) => template?.id && template?.arrayBuffer)
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  db.close();
  return customProtocolTransferTemplates;
}

async function putProtocolTransferTemplate(template) {
  const db = await openProtocolTransferTemplateDb();
  const transaction = db.transaction(PROTOCOL_TRANSFER_TEMPLATE_STORE, "readwrite");
  transaction.objectStore(PROTOCOL_TRANSFER_TEMPLATE_STORE).put(template);
  await indexedDbTransaction(transaction);
  db.close();
}

async function deleteProtocolTransferTemplate(id) {
  const db = await openProtocolTransferTemplateDb();
  const transaction = db.transaction(PROTOCOL_TRANSFER_TEMPLATE_STORE, "readwrite");
  transaction.objectStore(PROTOCOL_TRANSFER_TEMPLATE_STORE).delete(id);
  await indexedDbTransaction(transaction);
  db.close();
}

function openProtocolTransferTemplateDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(PROTOCOL_TRANSFER_TEMPLATE_DB, 1);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROTOCOL_TRANSFER_TEMPLATE_STORE)) {
        db.createObjectStore(PROTOCOL_TRANSFER_TEMPLATE_STORE, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("浏览器模板库打开失败")), { once: true });
  });
}

function indexedDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("浏览器模板读取失败")), { once: true });
  });
}

function indexedDbTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("浏览器模板保存失败")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("浏览器模板保存失败")), { once: true });
  });
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
      <article class="protocol-todo-item ${timing} ${record.id === selectedProtocolTransferId ? "active" : ""}">
        <button class="protocol-todo-record" type="button" data-protocol-transfer-id="${escapeAttribute(record.id)}" data-protocol-transfer-open>
          <strong>${escapeHtml(record.shortName || record.code || "未命名单据")}</strong>
          <span>${escapeHtml(step.dueDate)} · ${escapeHtml(step.label)}</span>
        </button>
        <button class="button subtle" type="button" data-protocol-transfer-id="${escapeAttribute(record.id)}" data-protocol-transfer-step="${escapeAttribute(step.key)}">${escapeHtml(step.label)}</button>
      </article>
    `).join("")
    : '<div class="payment-todo-empty">目前没有待处理的协议转让事项。</div>';
}

function openProtocolTransferRecord(id) {
  if (!protocolTransferRecordExists(id)) return;
  const scrollPosition = { left: window.scrollX, top: window.scrollY };
  selectedProtocolTransferId = id;
  protocolTransferEditMode = true;
  renderProtocolTransferWorkspace();
  requestAnimationFrame(() => window.scrollTo({ ...scrollPosition, behavior: "auto" }));
}

function renderProtocolTransferList() {
  const query = $("#protocolTransferSearch").value.trim().toLowerCase();
  const dateFilter = $("#protocolTransferDateFilter").value;
  const records = protocolTransferRecordsForDate(dateFilter)
    .filter((record) =>
      `${record.code} ${record.shortName} ${record.buyer} ${record.seller} ${record.marketMaker}`.toLowerCase().includes(query),
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
  const parties = protocolTransferApplicationParties(record);
  const applicationFlow = [parties.seller || "卖方待补", parties.buyer || "买方待补"].join(" → ");
  return record.marketMaker && record.buyer && !record.buyer.includes(record.marketMaker)
    ? `${applicationFlow} · 最终买方 ${record.buyer}`
    : applicationFlow;
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
    marketMaker: $("#protocolTransferMarketMaker").value,
    marketMakerDirection: $("#protocolTransferMarketMakerDirection").value,
    templateId: $("#protocolTransferTemplateSelect").value,
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

const PROTOCOL_TRANSFER_FORM_STEPS = [
  { key: "counterparty", inputId: "protocolTransferCounterpartySealed", action: "确认对手方用印", complete: "对手方已用印" },
  { key: "own", inputId: "protocolTransferOwnSealed", action: "确认本方用印", complete: "本方已用印" },
  { key: "submit", inputId: "protocolTransferExchangeSubmitted", action: "确认递交上交所", complete: "已递交上交所" },
];

function renderProtocolTransferStepActions() {
  let previousComplete = true;
  PROTOCOL_TRANSFER_FORM_STEPS.forEach((step) => {
    const input = $(`#${step.inputId}`);
    const button = $(`[data-protocol-form-step="${step.key}"]`);
    if (!input || !button) return;
    const complete = input.checked;
    const available = complete || previousComplete;
    button.disabled = !available;
    button.classList.toggle("is-complete", complete);
    button.classList.toggle("is-current", available && !complete);
    button.setAttribute("aria-pressed", String(complete));
    button.querySelector("[data-protocol-step-label]").textContent = complete ? step.complete : step.action;
    previousComplete = previousComplete && complete;
  });
}

function handleProtocolTransferFormStep(event) {
  const button = event.target.closest("[data-protocol-form-step]");
  if (!button || button.disabled) return;
  const step = PROTOCOL_TRANSFER_FORM_STEPS.find((item) => item.key === button.dataset.protocolFormStep);
  if (!step) return;
  const completing = !$("#" + step.inputId).checked;
  const next = setProtocolTransferStep(readProtocolTransferForm(), step.key, completing);
  $("#protocolTransferCounterpartySealed").checked = next.counterpartySealed;
  $("#protocolTransferOwnSealed").checked = next.ownSealed;
  $("#protocolTransferExchangeSubmitted").checked = next.exchangeSubmitted;
  $("#protocolTransferStatusPill").textContent = protocolTransferStatus(next);
  renderProtocolTransferStepActions();

  if (protocolTransferRecordExists(next.id)) {
    state = upsertProtocolTransfer(state, next);
    selectedProtocolTransferId = next.id;
    protocolTransferEditMode = true;
    persistState();
    renderProtocolTransferWorkspace();
    renderSecondaryLedger();
    showToast(`${next.shortName || next.code} ${completing ? "已完成" : "已撤回"}：${step.complete}`);
    return;
  }
  showToast(`${step.complete}${completing ? "已确认" : "已撤回"}，保存记录后生效。`);
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
  $("#protocolTransferMarketMaker").value = record.marketMaker;
  $("#protocolTransferMarketMakerDirection").value = record.marketMakerDirection;
  $("#protocolTransferPrice").value = record.price ?? "";
  $("#protocolTransferAmount").value = record.amountTenThousand ?? "";
  $("#protocolTransferQuantity").value = record.quantityHands ?? "";
  $("#protocolTransferRemarks").value = record.remarks;
  $("#protocolTransferCounterpartySealDate").value = record.counterpartySealDate;
  $("#protocolTransferOwnSealDate").value = record.ownSealDate;
  $("#protocolTransferCounterpartySealed").checked = record.counterpartySealed;
  $("#protocolTransferOwnSealed").checked = record.ownSealed;
  $("#protocolTransferExchangeSubmitted").checked = record.exchangeSubmitted;
  renderProtocolTransferStepActions();
  if (record.rawText) $("#protocolTransferInput").value = record.rawText;
  $("#protocolTransferDeleteButton").hidden = !(state.protocolTransfers || []).some((item) => item.id === record.id);
  $("#protocolTransferStatusPill").textContent = protocolTransferStatus(record);
  renderProtocolTransferTemplateOptions(record.templateId);
  if (!record.templateId) syncProtocolTransferTemplateMatch();
  applyProtocolTransferRecognitionMarks(record);
  renderProtocolTransferList();
  updateProtocolTransferModeControls();
}

function buildProtocolTransferRecognitionMarks(record, rawText = "") {
  const marks = {};
  const text = String(rawText || "");
  const tradeDateRecognized = Boolean(parseProtocolTransferTradeDate(text));
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
  markRequired("buyer", "买方/最终买方");
  markRequired("seller", "卖出方");
  markRequired("marketMaker", "做市商");
  marks.marketMakerDirection = valueHasContent(record.marketMakerDirection)
    ? recognitionMark("success", "做市商方向已识别")
    : recognitionMark("attention", "做市商方向未识别，请复核");
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
    marketMaker: "protocolTransferMarketMaker",
    marketMakerDirection: "protocolTransferMarketMakerDirection",
    price: "protocolTransferPrice",
    amountTenThousand: "protocolTransferAmount",
    quantityHands: "protocolTransferQuantity",
    counterpartySealDate: "protocolTransferCounterpartySealDate",
    ownSealDate: "protocolTransferOwnSealDate",
    remarks: "protocolTransferRemarks",
  };
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
  renderProtocolTransferStepActions();
  renderProtocolTransferTemplateOptions();
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
  renderSecondaryLedger();
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
  renderSecondaryLedger();
  showToast("协议转让记录已删除。");
}

function completeProtocolTransferStep(id, step) {
  const record = (state.protocolTransfers || []).find((item) => item.id === id);
  if (!record) return;
  const next = markProtocolTransferStep(record, step);
  state = upsertProtocolTransfer(state, next);
  persistState();
  openProtocolTransferRecord(next.id);
  renderSecondaryLedger();
  showToast(`${next.shortName || next.code} 已完成：${step === "counterparty" ? "对手方用印" : step === "own" ? "本方用印" : "递交上交所"}`);
}

function bindSecondaryInventory() {
  if (!$("#secondaryInput")) return;
  $("#secondaryNegotiationDate").value = localDate(new Date());
  $("#secondaryLedgerDate").value = localDate(new Date());
  $$(".secondary-workspace-tab").forEach((button) => {
    button.addEventListener("click", () => switchSecondaryWorkspacePanel(button.dataset.secondaryWorkspaceTab));
  });
  $("#secondaryParseTradesButton").addEventListener("click", importSecondaryTrades);
  $("#secondaryClearInputButton").addEventListener("click", clearSecondaryIntake);
  $("#secondaryIntakeToggleButton").addEventListener("click", () => {
    setSecondaryIntakeCollapsed(!secondaryIntakeCollapsed);
  });
  $("#secondaryLedgerDate").addEventListener("change", () => {
    resetSecondaryLedgerDraft();
    renderSecondaryLedger();
  });
  $("#secondaryLedgerTodayButton").addEventListener("click", () => {
    $("#secondaryLedgerDate").value = localDate(new Date());
    resetSecondaryLedgerDraft();
    renderSecondaryLedger();
  });
  $("#secondaryLedgerDmButton").addEventListener("click", () => enrichSecondaryLedgerFromDm({ refresh: true }));
  $("#secondaryLedgerUndoButton").addEventListener("click", undoSecondaryLedgerEdit);
  $("#secondaryLedgerSaveButton").addEventListener("click", () => saveSecondaryLedgerDraft());
  $("#secondaryLedgerPreviewButton").addEventListener("click", () => callSecondaryLedgerMailer("preview"));
  $("#secondaryLedgerCopyButton").addEventListener("click", copySecondaryLedgerRows);
  $("#secondaryLedgerSendButton").addEventListener("click", () => callSecondaryLedgerMailer("send"));
  $("#secondaryLedgerOutputCloseButton").addEventListener("click", hideSecondaryLedgerOutput);
  $("#secondaryPendingDmButton").addEventListener("click", () => enrichSecondaryPendingFromDm({ refresh: true }));
  $("#secondaryPendingUndoButton").addEventListener("click", undoSecondaryPendingEdit);
  $("#secondaryPendingCopyButton").addEventListener("click", copySecondaryPendingRows);
  $("#secondaryPendingColumnsButton").addEventListener("click", () => {
    secondaryPendingShowAllColumns = !secondaryPendingShowAllColumns;
    renderSecondaryTrades();
  });
  $("#secondaryPendingQuickDeleteButton").addEventListener("click", () => {
    secondaryPendingQuickDelete = !secondaryPendingQuickDelete;
    closeSecondaryPendingDeleteConfirm();
    updateSecondaryPendingControls();
    showToast(secondaryPendingQuickDelete
      ? "本次页面已开启免确认删除。"
      : "待成交删除已恢复气泡确认。");
  });
  $("#secondaryPendingSaveButton").addEventListener("click", () => saveSecondaryPendingDraft());
  $("#secondaryLedgerList").addEventListener("input", handleSecondaryLedgerCellInput);
  $("#secondaryLedgerList").addEventListener("focusin", handleSecondaryLedgerCellFocus);
  $("#secondaryLedgerList").addEventListener("focusout", handleSecondaryLedgerCellBlur);
  $("#secondaryLedgerList").addEventListener("paste", handleSecondaryLedgerPaste);
  $("#secondaryLedgerList").addEventListener("keydown", handleSecondaryLedgerKeydown);
  $("#secondaryTradeList").addEventListener("input", handleSecondaryPendingCellInput);
  $("#secondaryTradeList").addEventListener("focusin", handleSecondaryPendingCellFocus);
  $("#secondaryTradeList").addEventListener("focusout", handleSecondaryPendingCellBlur);
  $("#secondaryTradeList").addEventListener("paste", handleSecondaryPendingPaste);
  $("#secondaryTradeList").addEventListener("keydown", handleSecondaryPendingKeydown);
  $("#secondaryTradeList").addEventListener("click", (event) => {
    const deleteConfirmButton = event.target.closest("[data-secondary-delete-confirm-action]");
    if (deleteConfirmButton) {
      if (deleteConfirmButton.dataset.secondaryDeleteConfirmAction === "confirm") {
        removePendingSecondaryTrade(deleteConfirmButton.dataset.secondaryTradeId);
      } else {
        closeSecondaryPendingDeleteConfirm({ returnFocus: true });
      }
      return;
    }
    const button = event.target.closest("[data-secondary-trade-action]");
    if (!button) return;
    if (button.dataset.secondaryTradeAction === "remove") {
      requestRemovePendingSecondaryTrade(button.dataset.secondaryTradeId);
      return;
    }
    confirmSecondaryFrontOffice(button.dataset.secondaryTradeId);
  });
  document.addEventListener("click", (event) => {
    if (
      secondaryPendingDeleteConfirmId
      && !event.target.closest("[data-secondary-delete-confirm-popover]")
      && !event.target.closest('[data-secondary-trade-action="remove"]')
    ) {
      closeSecondaryPendingDeleteConfirm();
    }
  });
}

function switchSecondaryWorkspacePanel(panelName) {
  activeSecondaryWorkspacePanel = panelName || "intake";
  $$(".secondary-workspace-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.secondaryWorkspaceTab === activeSecondaryWorkspacePanel);
  });
  $$(".secondary-workspace-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.secondaryWorkspacePanel === activeSecondaryWorkspacePanel);
  });
}

function renderSecondaryInventoryWorkspace() {
  if (!$("#secondaryInput")) return;
  if (!secondaryIntakeCollapseTouched && pendingSecondaryTrades(state).length) {
    secondaryIntakeCollapsed = true;
  }
  renderSecondaryIntakeCollapse();
  switchSecondaryWorkspacePanel(activeSecondaryWorkspacePanel);
  renderSecondaryDashboard();
  renderSecondaryTrades();
  renderSecondaryLedger();
}

function renderSecondaryDashboard() {
  const trades = normalizeSecondaryTrades(state.secondaryTrades || [])
    .filter((trade) => trade.tradeCategory === "non_protocol" && trade.sourceType !== "primary_award");
  $("#secondaryPendingTradeCount").textContent = pendingSecondaryTrades(state).length;
  $("#secondaryCompletedTradeCount").textContent = trades.filter((trade) => trade.frontOfficeDone).length;
  $("#secondaryProtocolCount").textContent = normalizeProtocolTransfers(state.protocolTransfers || []).length;
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
              ${order.region ? `<span>${escapeHtml(order.region)}</span>` : ""}
              <span>${escapeHtml(remaining > 0 ? formatAmountWan(remaining) : "数量待定")}</span>
              <span>${escapeHtml(order.price ? formatSecondaryOrderPrice(order.price) : order.yieldRate ? `${formatNumber(order.yieldRate)}%` : "价格待补")}</span>
              ${risk ? `<span>${escapeHtml(risk)}</span>` : ""}
            </div>
            <div class="secondary-card-actions">
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
    ? rows.map((row) => {
        const needsSnapshot = Boolean(row.needsSnapshot);
        const cardClass = needsSnapshot ? "attention" : row.availableWan < 0 ? "warning" : row.unsettledSellWan > 0 ? "attention" : "";
        const badgeClass = !needsSnapshot && row.availableWan < 0 ? "warning" : needsSnapshot ? "muted" : "";
        const badgeText = needsSnapshot ? "待核库存" : `${formatAmountWan(row.availableWan)}可卖`;
        const snapshotText = row.snapshotDate
          ? `快照 ${row.snapshotDate}: ${formatAmountWan(row.snapshotQuantityWan)}`
          : "快照 待导入";
        return `
        <article class="secondary-card ${cardClass}">
          <div class="secondary-card-head">
            <strong>${escapeHtml(row.shortName || row.code || "未命名库存")}</strong>
            <span class="status-badge ${badgeClass}">${escapeHtml(badgeText)}</span>
          </div>
          <div class="secondary-meta">
            <span>${escapeHtml(row.account)}</span>
            <span>${escapeHtml(row.code || "代码待补")}</span>
            <span>${escapeHtml(snapshotText)}</span>
            <span>已卖 ${escapeHtml(formatAmountWan(row.soldWan))}</span>
            <span>挂卖 ${escapeHtml(formatAmountWan(row.activeOfferWan))}</span>
            ${row.pendingBuyWan ? `<span>未交割买入 ${escapeHtml(formatAmountWan(row.pendingBuyWan))}</span>` : ""}
            ${row.warning ? `<span>${escapeHtml(row.warning)}</span>` : ""}
          </div>
        </article>
      `;
      }).join("")
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

const SECONDARY_PENDING_COLUMN_FIELDS = Object.freeze({
  谈判日: "negotiationDate",
  交易日: "tradeDate",
  债券代码: "code",
  债券简称: "shortName",
  债券类型: "bondType",
  净价: "frontOfficePrice",
  "收益率(%)": "yieldRate",
  估值收益率: "valuationYield",
  我行方向: "side",
  "面值（万元）": "quantityWan",
  真实交易对手: "counterparty",
  交易对手: "tradeCounterparty",
  组合: "portfolio",
  中介: "intermediary",
  "清算速度(0/1)": "settlementSpeed",
  成本: "cost",
  价差: "spread",
  清算速度: "settlementSpeedText",
  结算方式: "settlementMethod",
});

const SECONDARY_PENDING_COLUMN_CLASSES = Object.freeze({
  谈判日: "date-column",
  交易日: "date-column",
  债券代码: "code-column",
  债券简称: "name-column",
  债券类型: "bond-type-column",
  净价: "price-column",
  "收益率(%)": "yield-column",
  估值收益率: "valuation-column",
  我行方向: "side-column",
  "面值（万元）": "amount-column",
  真实交易对手: "party-column",
  交易对手: "trade-party-column",
  组合: "portfolio-column",
  中介: "intermediary-column",
  "清算速度(0/1)": "speed-code-column",
  成本: "cost-column",
  价差: "spread-column",
  清算速度: "speed-text-column",
  结算方式: "settlement-method-column",
});

const SECONDARY_PENDING_OPTIONAL_COLUMNS = new Set([
  "交易对手",
  "组合",
  "成本",
  "价差",
  "清算速度",
  "结算方式",
]);

function secondaryPendingDraftUpdates(record = {}) {
  return {
    negotiationDate: record["谈判日"],
    tradeDate: record["交易日"],
    code: record["债券代码"],
    shortName: record["债券简称"],
    bondType: record["债券类型"],
    frontOfficePrice: record["净价"],
    yieldRate: record["收益率(%)"],
    valuationYield: record["估值收益率"],
    side: record["我行方向"] === "买入" ? "buy" : record["我行方向"] === "卖出" ? "sell" : "unknown",
    quantityWan: record["面值（万元）"],
    counterparty: record["真实交易对手"],
    tradeCounterparty: record["交易对手"],
    portfolio: record["组合"],
    intermediary: record["中介"],
    settlementSpeed: record["清算速度(0/1)"],
    cost: record["成本"],
    spread: record["价差"],
    settlementSpeedText: record["清算速度"],
    settlementMethod: record["结算方式"],
  };
}

function setSecondaryIntakeCollapsed(collapsed) {
  secondaryIntakeCollapsed = Boolean(collapsed);
  secondaryIntakeCollapseTouched = true;
  renderSecondaryIntakeCollapse();
}

function renderSecondaryIntakeCollapse() {
  const panel = $(".secondary-input-panel");
  const button = $("#secondaryIntakeToggleButton");
  panel?.classList.toggle("collapsed", secondaryIntakeCollapsed);
  if (button) button.textContent = secondaryIntakeCollapsed ? "展开录入区" : "收起录入区";
}

function secondaryPendingTradeFromDraftRow(trade, row) {
  return updateSecondaryPendingTrade({
    ...trade,
    tradeRecordSources: row.fieldSources,
    tradeRecordDm: row.dmLookup,
  }, secondaryPendingDraftUpdates(row.record));
}

function secondaryPendingSourceRows(trades = pendingSecondaryTrades(state)) {
  return trades.map((trade) => ({
    id: trade.id,
    source: "secondary",
    record: trade.tradeRecord,
    fieldSources: trade.tradeRecordSources,
    dmLookup: trade.tradeRecordDm,
  }));
}

function secondaryPendingStateSignature(trades = pendingSecondaryTrades(state)) {
  return trades.map((trade) => `${trade.id}:${trade.updatedAt}`).join("|");
}

function ensureSecondaryPendingDraft() {
  const trades = pendingSecondaryTrades(state);
  const signature = secondaryPendingStateSignature(trades);
  if (secondaryPendingDraftSignature === signature) return secondaryPendingDraftRows;
  secondaryPendingDraftSignature = signature;
  secondaryPendingDraftRows = createTradeRecordDraftRows(secondaryPendingSourceRows(trades));
  secondaryPendingUndoStack = [];
  secondaryPendingEditSnapshot = null;
  return secondaryPendingDraftRows;
}

function resetSecondaryPendingDraft({ keepDmAttempt = false } = {}) {
  secondaryPendingDraftSignature = "";
  secondaryPendingDraftRows = [];
  secondaryPendingUndoStack = [];
  secondaryPendingEditSnapshot = null;
  if (!keepDmAttempt) secondaryPendingDmAttemptKey = "";
}

function secondaryPendingDmRequestKey(rows = secondaryPendingDraftRows) {
  return tradeRecordDmRequestRows(rows)
    .map((row) => `${row.id}:${row.securityId}:${row.negotiationDate}`)
    .join("|");
}

function tradeRecordDmDependencyKey(rows = []) {
  return rows.map((row) => `${row.id}:${row.securityId}:${row.negotiationDate}`).join("|");
}

function markTradeRecordDmErrors(rows = [], ids = []) {
  const failedIds = new Set(ids);
  if (!failedIds.size) return rows;
  return rows.map((row) => failedIds.has(row.key)
    ? { ...row, dmLookup: { ...(row.dmLookup || {}), status: "error" } }
    : row);
}

function secondaryPendingVisibleColumns() {
  return secondaryPendingShowAllColumns
    ? TRADE_RECORD_COLUMNS
    : TRADE_RECORD_COLUMNS.filter((column) => !SECONDARY_PENDING_OPTIONAL_COLUMNS.has(column));
}

function renderSecondaryPendingCell(row, column, rowIndex, missingKeys) {
  const source = row.fieldSources[column] || "";
  const sourceLabel = source === "dm" ? "DM" : source === "manual" && TRADE_RECORD_FORMULA_COLUMNS.has(column) ? "人工" : "";
  const title = source === "dm"
    ? secondaryLedgerDmCellTitle(row, column)
    : source === "manual" ? "人工编辑" : "";
  const field = SECONDARY_PENDING_COLUMN_FIELDS[column];
  const value = row.record[column] || "";
  const valid = isTradeRecordCellValueValid(column, value) && !missingKeys.has(field);
  const optionalClass = SECONDARY_PENDING_OPTIONAL_COLUMNS.has(column) ? " secondary-pending-optional" : "";
  return `
    <td class="${TRADE_RECORD_FORMULA_COLUMNS.has(column) ? "dm-cell" : ""}${optionalClass}" data-source="${escapeAttribute(source)}">
      <div class="secondary-ledger-cell-wrap">
        <input
          class="secondary-pending-cell ${valid ? "" : "invalid"}"
          type="text"
          value="${escapeAttribute(value)}"
          data-secondary-trade-id="${escapeAttribute(row.id)}"
          data-secondary-trade-field="${escapeAttribute(field)}"
          data-pending-key="${escapeAttribute(row.key)}"
          data-pending-column="${escapeAttribute(column)}"
          data-pending-row-index="${rowIndex}"
          data-pending-column-index="${secondaryPendingVisibleColumns().indexOf(column)}"
          inputmode="${secondaryLedgerInputMode(column)}"
          spellcheck="false"
          autocomplete="off"
          aria-invalid="${valid ? "false" : "true"}"
          aria-label="第${rowIndex + 1}行 ${escapeAttribute(column)}"
        >
        ${sourceLabel ? `<span class="secondary-ledger-cell-source" title="${escapeAttribute(title)}">${sourceLabel}</span>` : ""}
      </div>
    </td>
  `;
}

function renderSecondaryTrades() {
  const trades = pendingSecondaryTrades(state);
  const rows = ensureSecondaryPendingDraft();
  const tradeById = new Map(trades.map((trade) => [trade.id, trade]));
  $("#secondaryPendingCountPill").textContent = `${trades.length}笔`;
  $("#secondaryTradeList").innerHTML = rows.length
    ? `
      <div class="secondary-pending-sheet">
        <table class="secondary-pending-table ${secondaryPendingShowAllColumns ? "show-all-columns" : ""}" aria-label="待成交工作表">
          <colgroup>
            <col class="secondary-pending-row-number-column">
            ${TRADE_RECORD_COLUMNS.map((column) => `<col class="${SECONDARY_PENDING_COLUMN_CLASSES[column]}${SECONDARY_PENDING_OPTIONAL_COLUMNS.has(column) ? " secondary-pending-optional" : ""}">`).join("")}
            <col class="action-column">
          </colgroup>
          <thead>
            <tr>
              <th class="secondary-pending-row-number" scope="col">#</th>
              ${TRADE_RECORD_COLUMNS.map((column) => `
                <th class="${TRADE_RECORD_FORMULA_COLUMNS.has(column) ? "dm-column" : ""}${SECONDARY_PENDING_OPTIONAL_COLUMNS.has(column) ? " secondary-pending-optional" : ""}" scope="col">
                  ${escapeHtml(column)}
                  ${TRADE_RECORD_FORMULA_COLUMNS.has(column) ? '<span class="secondary-ledger-column-source">DM</span>' : ""}
                </th>
              `).join("")}
              <th class="secondary-pending-action-heading">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, rowIndex) => {
              const trade = tradeById.get(row.id);
              if (!trade) return "";
              const draftTrade = secondaryPendingTradeFromDraftRow(trade, row);
              const missingFields = secondaryTradeMissingFields(draftTrade);
              const missingKeys = new Set(missingFields.map((field) => field.key));
              const dmStatus = secondaryLedgerDmRowStatus(row);
              return `
                <tr class="${missingFields.length ? "incomplete" : "ready"} ${row.dirty ? "dirty" : ""}" title="${escapeAttribute(trade.sourceText || "")}">
                  <th class="secondary-pending-row-number" scope="row">
                    <span>${rowIndex + 1}</span>
                    ${dmStatus.label ? `<small class="${escapeAttribute(dmStatus.className)}" title="${escapeAttribute(dmStatus.title)}">${escapeHtml(dmStatus.label)}</small>` : ""}
                  </th>
                  ${TRADE_RECORD_COLUMNS.map((column) =>
                    renderSecondaryPendingCell(row, column, rowIndex, missingKeys)
                  ).join("")}
                  <td class="secondary-pending-actions">
                    <div class="secondary-pending-action-buttons">
                      <button class="button primary" type="button" data-secondary-trade-id="${escapeAttribute(trade.id)}" data-secondary-trade-action="front-office">成交</button>
                      <button class="button subtle danger-button" type="button" data-secondary-trade-id="${escapeAttribute(trade.id)}" data-secondary-trade-action="remove" aria-expanded="${secondaryPendingDeleteConfirmId === trade.id ? "true" : "false"}">删除</button>
                      ${secondaryPendingDeleteConfirmId === trade.id ? `
                        <div class="secondary-pending-delete-popover" data-secondary-delete-confirm-popover="${escapeAttribute(trade.id)}" role="dialog" aria-label="确认删除待成交记录">
                          <strong>删除这笔待成交？</strong>
                          <span>${escapeHtml(trade.shortName || trade.code || "该笔交易")}，删除后无法从待成交中恢复。</span>
                          <div>
                            <button class="button subtle" type="button" data-secondary-trade-id="${escapeAttribute(trade.id)}" data-secondary-delete-confirm-action="cancel">取消</button>
                            <button class="button danger-button" type="button" data-secondary-trade-id="${escapeAttribute(trade.id)}" data-secondary-delete-confirm-action="confirm">确认删除</button>
                          </div>
                        </div>
                      ` : ""}
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : '<div class="empty">暂无待成交记录。把交易要素粘贴到上方，点击“转换为待成交”。</div>';
  updateSecondaryPendingControls();
  const dmRows = tradeRecordDmRequestRows(rows);
  const attemptKey = secondaryPendingDmRequestKey(rows);
  if (dmRows.length && !secondaryPendingDmLoading && secondaryPendingDmAttemptKey !== attemptKey) {
    secondaryPendingDmAttemptKey = attemptKey;
    queueMicrotask(() => enrichSecondaryPendingFromDm({ automatic: true }));
  }
}

function handleSecondaryPendingCellFocus(event) {
  const input = event.target.closest(".secondary-pending-cell");
  if (!input) return;
  secondaryPendingEditSnapshot = {
    key: input.dataset.pendingKey,
    column: input.dataset.pendingColumn,
    value: input.value,
    rows: cloneTradeRecordDraftRows(secondaryPendingDraftRows),
  };
}

function handleSecondaryPendingCellInput(event) {
  const input = event.target.closest(".secondary-pending-cell");
  if (!input) return;
  secondaryPendingDraftRows = updateTradeRecordDraftCell(secondaryPendingDraftRows, {
    key: input.dataset.pendingKey,
    column: input.dataset.pendingColumn,
    value: input.value,
    source: "manual",
  });
  const row = secondaryPendingDraftRows.find((item) => item.key === input.dataset.pendingKey);
  const trade = (state.secondaryTrades || []).find((item) => item.id === row?.id);
  const missingKeys = trade && row
    ? new Set(secondaryTradeMissingFields(secondaryPendingTradeFromDraftRow(trade, row)).map((field) => field.key))
    : new Set();
  const valid = isTradeRecordCellValueValid(input.dataset.pendingColumn, input.value)
    && !missingKeys.has(input.dataset.secondaryTradeField);
  input.classList.toggle("invalid", !valid);
  input.setAttribute("aria-invalid", valid ? "false" : "true");
  const cell = input.closest("td");
  cell.dataset.source = "manual";
  let badge = cell.querySelector(".secondary-ledger-cell-source");
  if (TRADE_RECORD_FORMULA_COLUMNS.has(input.dataset.pendingColumn)) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "secondary-ledger-cell-source";
      cell.querySelector(".secondary-ledger-cell-wrap").append(badge);
    }
    badge.textContent = "人工";
    badge.title = "人工编辑";
  } else {
    badge?.remove();
  }
  input.closest("tr")?.classList.add("dirty");
  updateSecondaryPendingControls();
}

function handleSecondaryPendingCellBlur(event) {
  const input = event.target.closest(".secondary-pending-cell");
  if (!input || !secondaryPendingEditSnapshot) return;
  const dependencyChanged = ["债券代码", "谈判日"].includes(input.dataset.pendingColumn)
    && secondaryPendingEditSnapshot.value !== input.value;
  if (
    secondaryPendingEditSnapshot.key === input.dataset.pendingKey
    && secondaryPendingEditSnapshot.column === input.dataset.pendingColumn
    && secondaryPendingEditSnapshot.value !== input.value
  ) {
    pushSecondaryPendingUndo(secondaryPendingEditSnapshot.rows);
  }
  secondaryPendingEditSnapshot = null;
  if (dependencyChanged) renderSecondaryTrades();
}

function handleSecondaryPendingPaste(event) {
  const input = event.target.closest(".secondary-pending-cell");
  const text = event.clipboardData?.getData("text/plain");
  if (!input || !text || (!text.includes("\t") && !/[\r\n]/.test(text))) return;
  event.preventDefault();
  const firstClipboardRow = text.replace(/\r\n?/g, "\n").split("\n", 1)[0].split("\t");
  const hasFullHeader = TRADE_RECORD_COLUMNS.every((column, index) => firstClipboardRow[index]?.trim() === column);
  const useFullColumns = input.dataset.pendingColumn === TRADE_RECORD_COLUMNS[0]
    && (hasFullHeader || firstClipboardRow.length >= TRADE_RECORD_COLUMNS.length);
  const columns = useFullColumns ? TRADE_RECORD_COLUMNS : secondaryPendingVisibleColumns();
  const columnIndex = columns.indexOf(input.dataset.pendingColumn);
  const before = cloneTradeRecordDraftRows(secondaryPendingDraftRows);
  secondaryPendingEditSnapshot = null;
  secondaryPendingDraftRows = pasteTradeRecordDraftCells(secondaryPendingDraftRows, {
    rowIndex: Number(input.dataset.pendingRowIndex),
    columnIndex,
    text,
    columns,
    skipMatchingHeader: hasFullHeader,
  });
  if (useFullColumns) secondaryPendingShowAllColumns = true;
  pushSecondaryPendingUndo(before);
  renderSecondaryTrades();
  focusSecondaryPendingColumn(Number(input.dataset.pendingRowIndex), input.dataset.pendingColumn);
}

function handleSecondaryPendingKeydown(event) {
  if (event.key === "Escape" && secondaryPendingDeleteConfirmId) {
    event.preventDefault();
    closeSecondaryPendingDeleteConfirm({ returnFocus: true });
    return;
  }
  const input = event.target.closest(".secondary-pending-cell");
  if (!input) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (secondaryPendingEditSnapshot?.rows) {
      secondaryPendingDraftRows = secondaryPendingEditSnapshot.rows;
      secondaryPendingEditSnapshot = null;
      renderSecondaryTrades();
    } else {
      undoSecondaryPendingEdit();
    }
    return;
  }
  if (event.key === "Escape" && secondaryPendingEditSnapshot?.rows) {
    event.preventDefault();
    secondaryPendingDraftRows = secondaryPendingEditSnapshot.rows;
    secondaryPendingEditSnapshot = null;
    renderSecondaryTrades();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const rowIndex = Number(input.dataset.pendingRowIndex) + (event.shiftKey ? -1 : 1);
  focusSecondaryPendingCell(rowIndex, Number(input.dataset.pendingColumnIndex));
}

function focusSecondaryPendingCell(rowIndex, columnIndex) {
  const input = $(`.secondary-pending-cell[data-pending-row-index="${rowIndex}"][data-pending-column-index="${columnIndex}"]`);
  input?.focus();
  input?.select();
}

function focusSecondaryPendingColumn(rowIndex, column) {
  if (!column) return;
  if (SECONDARY_PENDING_OPTIONAL_COLUMNS.has(column) && !secondaryPendingShowAllColumns) {
    secondaryPendingShowAllColumns = true;
    renderSecondaryTrades();
  }
  const input = $(`.secondary-pending-cell[data-pending-row-index="${rowIndex}"][data-pending-column="${column}"]`);
  input?.focus();
  input?.select();
}

function pushSecondaryPendingUndo(rows) {
  secondaryPendingUndoStack.push(cloneTradeRecordDraftRows(rows));
  if (secondaryPendingUndoStack.length > 20) secondaryPendingUndoStack.shift();
  updateSecondaryPendingControls();
}

function undoSecondaryPendingEdit() {
  const previous = secondaryPendingUndoStack.pop();
  if (!previous) return;
  secondaryPendingDraftRows = previous;
  secondaryPendingEditSnapshot = null;
  renderSecondaryTrades();
}

function updateSecondaryPendingControls() {
  const dirtyCells = tradeRecordDirtyCellCount(secondaryPendingDraftRows);
  const dirtyRows = secondaryPendingDraftRows.filter((row) => row.dirty).length;
  const saveStatus = $("#secondaryPendingSaveStatus");
  if (saveStatus) {
    saveStatus.textContent = secondaryPendingSavePending
      ? "正在保存"
      : dirtyRows ? `${dirtyRows} 行 · ${dirtyCells} 格待保存` : "已保存";
    saveStatus.className = `secondary-ledger-save-status ${dirtyRows ? "dirty" : "saved"}`;
  }
  const dmStatus = $("#secondaryPendingDmStatus");
  if (dmStatus) {
    const complete = secondaryPendingDraftRows.filter((row) => row.dmLookup?.status === "complete").length;
    const partial = secondaryPendingDraftRows.filter((row) => ["partial", "missing"].includes(row.dmLookup?.status)).length;
    const errors = secondaryPendingDraftRows.filter((row) => row.dmLookup?.status === "error").length;
    dmStatus.textContent = secondaryPendingDmLoading
      ? "DM 读取中"
      : errors ? `DM ${errors} 笔失败 · 可重试`
        : complete || partial ? `DM ${complete} 完整${partial ? ` · ${partial} 待补` : ""}` : "DM 待读取";
  }
  const dmButton = $("#secondaryPendingDmButton");
  if (dmButton) dmButton.disabled = secondaryPendingDmLoading || !secondaryPendingDraftRows.length;
  const undoButton = $("#secondaryPendingUndoButton");
  if (undoButton) undoButton.disabled = !secondaryPendingUndoStack.length;
  const saveButton = $("#secondaryPendingSaveButton");
  if (saveButton) saveButton.disabled = secondaryPendingSavePending || !dirtyRows;
  const copyButton = $("#secondaryPendingCopyButton");
  if (copyButton) copyButton.disabled = !secondaryPendingDraftRows.length;
  const columnsButton = $("#secondaryPendingColumnsButton");
  if (columnsButton) columnsButton.textContent = secondaryPendingShowAllColumns ? "收起附加列" : "展开附加列";
  const quickDeleteButton = $("#secondaryPendingQuickDeleteButton");
  if (quickDeleteButton) {
    quickDeleteButton.textContent = `免确认删除：${secondaryPendingQuickDelete ? "开" : "关"}`;
    quickDeleteButton.classList.toggle("is-active", secondaryPendingQuickDelete);
    quickDeleteButton.setAttribute("aria-pressed", secondaryPendingQuickDelete ? "true" : "false");
  }
}

async function copySecondaryPendingRows() {
  const rows = ensureSecondaryPendingDraft();
  if (!rows.length) {
    showToast("暂无待成交记录可复制。");
    return;
  }
  const text = buildTradeRecordTableText(rows, { includeHeader: true });
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制 ${rows.length} 笔待成交记录，可直接粘贴到 Excel。`);
  } catch {
    downloadBlob("待成交记录.tsv", new Blob([text], { type: "text/tab-separated-values;charset=utf-8" }));
    showToast(`已导出 ${rows.length} 笔待成交记录。`);
  }
}

async function saveSecondaryPendingDraft({ silent = false } = {}) {
  if (secondaryPendingSavePending) return false;
  const dirtyRows = secondaryPendingDraftRows.filter((row) => row.dirty);
  if (!dirtyRows.length) return true;
  const validationErrors = validateTradeRecordDraftRows(dirtyRows);
  if (validationErrors.length) {
    const first = validationErrors[0];
    const row = dirtyRows[first.rowIndex];
    const rowIndex = secondaryPendingDraftRows.findIndex((item) => item.key === row?.key);
    focusSecondaryPendingColumn(rowIndex, first.column);
    if (!silent) showToast(`第 ${rowIndex + 1} 行“${first.column}”：${first.message}`);
    return false;
  }
  secondaryPendingSavePending = true;
  updateSecondaryPendingControls();
  state = applySecondaryPendingDraftRows(state, secondaryPendingDraftRows);
  secondaryPendingDraftSignature = secondaryPendingStateSignature();
  const saved = await saveCloudState();
  secondaryPendingSavePending = false;
  if (!saved) {
    updateSecondaryPendingControls();
    if (!silent) showToast("待成交修改尚未同步到 D1，请检查登录或网络后重试。");
    return false;
  }
  resetSecondaryPendingDraft({ keepDmAttempt: true });
  renderSecondaryDashboard();
  renderSecondaryTrades();
  if (!silent) showToast(`已保存 ${dirtyRows.length} 行待成交修改。`);
  return true;
}

async function requestTradeRecordDmRows(requestRows = []) {
  const rows = [];
  const failedIds = [];
  const errors = [];
  for (let index = 0; index < requestRows.length; index += 80) {
    const batch = requestRows.slice(index, index + 80);
    try {
      const response = await fetch(DM_TRADE_RECORDS_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ rows: batch }),
      });
      const text = await response.text();
      const payload = parseJson(text);
      if (!response.ok || !payload?.ok) {
        const error = new Error(payload?.hint || payload?.reason || `HTTP ${response.status}`);
        if (response.status === 401) {
          clearAuthSession();
          redirectToGatewayLogin();
          error.dmAuthFailure = true;
          throw error;
        }
        throw error;
      }
      rows.push(...(payload.rows || []));
    } catch (error) {
      if (error?.dmAuthFailure) throw error;
      failedIds.push(...batch.map((row) => row.id));
      errors.push(error?.message || "DM 查询失败");
    }
  }
  return { rows, failedIds, errors };
}

async function enrichSecondaryPendingFromDm({ refresh = false, automatic = false } = {}) {
  const rows = ensureSecondaryPendingDraft();
  const requestRows = tradeRecordDmRequestRows(rows, { refresh });
  if (!requestRows.length) {
    if (!automatic) showToast("当前待成交记录的 DM 字段已齐全。");
    return;
  }
  const requestedIds = new Set(requestRows.map((row) => row.id));
  const sentDependencyKey = tradeRecordDmDependencyKey(requestRows);
  secondaryPendingDmLoading = true;
  updateSecondaryPendingControls();
  try {
    const { rows: results, failedIds, errors } = await requestTradeRecordDmRows(requestRows);
    secondaryPendingDraftRows = mergeTradeRecordDmResults(secondaryPendingDraftRows, results);
    secondaryPendingDraftRows = markTradeRecordDmErrors(secondaryPendingDraftRows, failedIds);
    renderSecondaryTrades();
    if (!automatic) {
      const complete = results.filter((row) => row.status === "complete").length;
      const partial = results.length - complete;
      const failed = failedIds.length;
      showToast(failed
        ? `DM 已返回 ${results.length} 笔，${failed} 笔失败：${errors[0] || "可重试"}。`
        : `DM 已返回 ${results.length} 笔：${complete} 笔完整${partial ? `，${partial} 笔部分返回` : ""}。`);
    }
  } catch (error) {
    secondaryPendingDraftRows = markTradeRecordDmErrors(secondaryPendingDraftRows, [...requestedIds]);
    renderSecondaryTrades();
    if (!automatic) showToast(error.message || "DM 待成交字段读取失败。");
  } finally {
    secondaryPendingDmLoading = false;
    const currentDependencies = tradeRecordDmRequestRows(secondaryPendingDraftRows, { refresh: true })
      .filter((row) => requestedIds.has(row.id));
    if (tradeRecordDmDependencyKey(currentDependencies) !== sentDependencyKey) {
      secondaryPendingDmAttemptKey = "";
      renderSecondaryTrades();
    } else {
      secondaryPendingDmAttemptKey = secondaryPendingDmRequestKey(secondaryPendingDraftRows);
      updateSecondaryPendingControls();
    }
  }
}

function secondaryTradeStageLabel(trade) {
  if (trade.ledgerSentAt || trade.tradeStage === "sent") return "台账已发送";
  if (trade.frontOfficeDone || trade.tradeStage === "front_office_done") return "前台成交";
  return "谈判成交";
}

function secondaryTradeCategoryLabel(trade) {
  if (trade.tradeCategory === "protocol") return "协议转让";
  if (trade.tradeCategory === "primary_award") return "一级入库";
  return "非协议";
}

function confirmSecondaryFrontOffice(id) {
  const rows = ensureSecondaryPendingDraft();
  const rowIndex = rows.findIndex((item) => item.id === id);
  const row = rows[rowIndex];
  if (!row) return;
  const validationErrors = validateTradeRecordDraftRows([row]);
  if (validationErrors.length) {
    const first = validationErrors[0];
    focusSecondaryPendingColumn(rowIndex, first.column);
    showToast(`第 ${rowIndex + 1} 行“${first.column}”：${first.message}`);
    return;
  }
  const trades = normalizeSecondaryTrades(state.secondaryTrades || []);
  const trade = trades.find((item) => item.id === id);
  if (!trade) return;
  const completedTrade = secondaryPendingTradeFromDraftRow(trade, row);
  const missingFields = secondaryTradeMissingFields(completedTrade);
  if (missingFields.length) {
    state = {
      ...state,
      secondaryTrades: trades.map((item) => item.id === id ? completedTrade : item),
      updatedAt: new Date().toISOString(),
    };
    persistState();
    secondaryPendingDraftRows = secondaryPendingDraftRows.map((item) =>
      item.id === id ? { ...item, changedColumns: [], dirty: false } : item
    );
    secondaryPendingDraftSignature = secondaryPendingStateSignature();
    renderSecondaryInventoryWorkspace();
    requestAnimationFrame(() => {
      const column = Object.entries(SECONDARY_PENDING_COLUMN_FIELDS)
        .find(([, field]) => field === missingFields[0].key)?.[0];
      focusSecondaryPendingColumn(rowIndex, column);
    });
    showToast(`请先补全：${missingFields.map((field) => field.label).join("、")}。`);
    return;
  }
  state = {
    ...state,
    secondaryTrades: trades.map((item) =>
      item.id === id
        ? markSecondaryTradeFrontOffice(completedTrade, { frontOfficePrice: completedTrade.frontOfficePrice })
        : item,
    ),
    updatedAt: new Date().toISOString(),
  };
  persistState();
  secondaryPendingDraftRows = secondaryPendingDraftRows.filter((item) => item.id !== id);
  secondaryPendingDraftSignature = secondaryPendingStateSignature();
  secondaryPendingUndoStack = [];
  secondaryPendingEditSnapshot = null;
  renderSecondaryInventoryWorkspace();
  showToast(`${completedTrade.shortName || completedTrade.code || "该笔交易"} 已成交，并进入 ${completedTrade.tradeDate} 台账。`);
}

function requestRemovePendingSecondaryTrade(id) {
  const trade = pendingSecondaryTrades(state).find((item) => item.id === id);
  if (!trade) return;
  if (secondaryPendingQuickDelete) {
    removePendingSecondaryTrade(id);
    return;
  }
  secondaryPendingDeleteConfirmId = id;
  renderSecondaryTrades();
  requestAnimationFrame(() => {
    $$('[data-secondary-delete-confirm-action="confirm"]')
      .find((button) => button.dataset.secondaryTradeId === id)
      ?.focus();
  });
}

function closeSecondaryPendingDeleteConfirm({ returnFocus = false } = {}) {
  const id = secondaryPendingDeleteConfirmId;
  if (!id) return;
  secondaryPendingDeleteConfirmId = "";
  const popover = $("[data-secondary-delete-confirm-popover]");
  popover?.remove();
  const removeButton = $$('[data-secondary-trade-action="remove"]')
    .find((button) => button.dataset.secondaryTradeId === id);
  removeButton?.setAttribute("aria-expanded", "false");
  if (returnFocus) removeButton?.focus();
}

function removePendingSecondaryTrade(id) {
  const trade = pendingSecondaryTrades(state).find((item) => item.id === id);
  if (!trade) return;
  secondaryPendingDeleteConfirmId = "";
  state = removeSecondaryTrade(state, id);
  persistState();
  secondaryPendingDraftRows = secondaryPendingDraftRows.filter((item) => item.id !== id);
  secondaryPendingDraftSignature = secondaryPendingStateSignature();
  secondaryPendingUndoStack = [];
  secondaryPendingEditSnapshot = null;
  renderSecondaryInventoryWorkspace();
  showToast("待成交记录已删除。");
}

function renderSecondaryLedger() {
  if (!$("#secondaryLedgerList")) return;
  const date = secondaryLedgerDateValue();
  const rows = ensureSecondaryLedgerDraft(date);
  $("#secondaryLedgerCountPill").textContent = `${rows.length}笔`;
  $("#secondaryLedgerList").innerHTML = rows.length
    ? `
      <div class="secondary-ledger-sheet" id="secondaryLedgerSheet">
        <table class="secondary-ledger-table">
          <colgroup>
            <col class="secondary-ledger-row-number-column">
            ${TRADE_RECORD_COLUMNS.map((column) => `<col data-ledger-column="${escapeHtml(column)}">`).join("")}
          </colgroup>
          <thead>
            <tr>
              <th class="secondary-ledger-row-number" scope="col">#</th>
              ${TRADE_RECORD_COLUMNS.map((column) => `
                <th scope="col" class="${TRADE_RECORD_FORMULA_COLUMNS.has(column) ? "dm-column" : ""}">
                  ${escapeHtml(column)}
                  ${TRADE_RECORD_FORMULA_COLUMNS.has(column) ? '<span class="secondary-ledger-column-source">DM</span>' : ""}
                </th>
              `).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, rowIndex) => renderSecondaryLedgerSheetRow(row, rowIndex)).join("")}
          </tbody>
        </table>
      </div>
    `
    : '<div class="empty">暂无当日已前台成交记录。</div>';
  updateSecondaryLedgerControls();
  const dmRows = tradeRecordDmRequestRows(rows);
  const attemptKey = `${date}:${dmRows.map((row) => `${row.id}:${row.securityId}:${row.negotiationDate}`).join("|")}`;
  if (dmRows.length && !secondaryLedgerDmLoading && secondaryLedgerDmAttemptKey !== attemptKey) {
    secondaryLedgerDmAttemptKey = attemptKey;
    queueMicrotask(() => enrichSecondaryLedgerFromDm({ automatic: true }));
  }
}

function renderSecondaryLedgerSheetRow(row, rowIndex) {
  const dmStatus = secondaryLedgerDmRowStatus(row);
  return `
    <tr class="${row.sent ? "sent" : "pending"} ${row.dirty ? "dirty" : ""}" data-ledger-row-key="${escapeHtml(row.key)}">
      <th class="secondary-ledger-row-number" scope="row">
        <span>${rowIndex + 1}</span>
        ${dmStatus.label ? `<small class="${dmStatus.className}" title="${escapeHtml(dmStatus.title)}">${escapeHtml(dmStatus.label)}</small>` : ""}
      </th>
      ${TRADE_RECORD_COLUMNS.map((column, columnIndex) => {
        const source = row.fieldSources[column] || "";
        const sourceLabel = source === "dm" ? "DM" : source === "manual" && TRADE_RECORD_FORMULA_COLUMNS.has(column) ? "人工" : "";
        const title = source === "dm"
          ? secondaryLedgerDmCellTitle(row, column)
          : source === "manual" ? "人工编辑" : "";
        return `
          <td class="${TRADE_RECORD_FORMULA_COLUMNS.has(column) ? "dm-cell" : ""}" data-source="${escapeHtml(source)}">
            <div class="secondary-ledger-cell-wrap">
              <input
                class="secondary-ledger-cell ${isTradeRecordCellValueValid(column, row.record[column] || "") ? "" : "invalid"}"
                type="text"
                value="${escapeHtml(row.record[column] || "")}"
                data-ledger-key="${escapeHtml(row.key)}"
                data-ledger-column="${escapeHtml(column)}"
                data-ledger-row-index="${rowIndex}"
                data-ledger-column-index="${columnIndex}"
                inputmode="${secondaryLedgerInputMode(column)}"
                spellcheck="false"
                autocomplete="off"
                aria-invalid="${isTradeRecordCellValueValid(column, row.record[column] || "") ? "false" : "true"}"
                aria-label="第${rowIndex + 1}行 ${escapeHtml(column)}"
              >
              ${sourceLabel ? `<span class="secondary-ledger-cell-source" title="${escapeHtml(title)}">${sourceLabel}</span>` : ""}
            </div>
          </td>
        `;
      }).join("")}
    </tr>
  `;
}

function ensureSecondaryLedgerDraft(date) {
  if (
    secondaryLedgerDraftDate === date
    && (secondaryLedgerDmLoading || secondaryLedgerDraftRows.some((row) => row.dirty))
  ) {
    return secondaryLedgerDraftRows;
  }
  secondaryLedgerDraftDate = date;
  secondaryLedgerDraftRows = createTradeRecordDraftRows(buildTradeRecordRows(state, date));
  secondaryLedgerUndoStack = [];
  secondaryLedgerEditSnapshot = null;
  return secondaryLedgerDraftRows;
}

function resetSecondaryLedgerDraft() {
  secondaryLedgerDraftDate = "";
  secondaryLedgerDraftRows = [];
  secondaryLedgerUndoStack = [];
  secondaryLedgerEditSnapshot = null;
  secondaryLedgerDmAttemptKey = "";
}

function handleSecondaryLedgerCellFocus(event) {
  const input = event.target.closest(".secondary-ledger-cell");
  if (!input) return;
  secondaryLedgerEditSnapshot = {
    key: input.dataset.ledgerKey,
    column: input.dataset.ledgerColumn,
    value: input.value,
    rows: cloneTradeRecordDraftRows(secondaryLedgerDraftRows),
  };
}

function handleSecondaryLedgerCellInput(event) {
  const input = event.target.closest(".secondary-ledger-cell");
  if (!input) return;
  secondaryLedgerDraftRows = updateTradeRecordDraftCell(secondaryLedgerDraftRows, {
    key: input.dataset.ledgerKey,
    column: input.dataset.ledgerColumn,
    value: input.value,
    source: "manual",
  });
  const valid = isTradeRecordCellValueValid(input.dataset.ledgerColumn, input.value);
  input.classList.toggle("invalid", !valid);
  input.setAttribute("aria-invalid", valid ? "false" : "true");
  const cell = input.closest("td");
  cell.dataset.source = "manual";
  let badge = cell.querySelector(".secondary-ledger-cell-source");
  if (TRADE_RECORD_FORMULA_COLUMNS.has(input.dataset.ledgerColumn)) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "secondary-ledger-cell-source";
      cell.querySelector(".secondary-ledger-cell-wrap").append(badge);
    }
    badge.textContent = "人工";
    badge.title = "人工编辑";
  } else {
    badge?.remove();
  }
  input.closest("tr")?.classList.add("dirty");
  updateSecondaryLedgerControls();
}

function handleSecondaryLedgerCellBlur(event) {
  const input = event.target.closest(".secondary-ledger-cell");
  if (!input || !secondaryLedgerEditSnapshot) return;
  const dependencyChanged = ["债券代码", "谈判日"].includes(input.dataset.ledgerColumn)
    && secondaryLedgerEditSnapshot.value !== input.value;
  if (
    secondaryLedgerEditSnapshot.key === input.dataset.ledgerKey
    && secondaryLedgerEditSnapshot.column === input.dataset.ledgerColumn
    && secondaryLedgerEditSnapshot.value !== input.value
  ) {
    pushSecondaryLedgerUndo(secondaryLedgerEditSnapshot.rows);
  }
  secondaryLedgerEditSnapshot = null;
  if (dependencyChanged) renderSecondaryLedger();
}

function handleSecondaryLedgerPaste(event) {
  const input = event.target.closest(".secondary-ledger-cell");
  const text = event.clipboardData?.getData("text/plain");
  if (!input || !text || (!text.includes("\t") && !/[\r\n]/.test(text))) return;
  event.preventDefault();
  const before = cloneTradeRecordDraftRows(secondaryLedgerDraftRows);
  secondaryLedgerEditSnapshot = null;
  secondaryLedgerDraftRows = pasteTradeRecordDraftCells(secondaryLedgerDraftRows, {
    rowIndex: Number(input.dataset.ledgerRowIndex),
    columnIndex: Number(input.dataset.ledgerColumnIndex),
    text,
  });
  pushSecondaryLedgerUndo(before);
  renderSecondaryLedger();
  focusSecondaryLedgerCell(Number(input.dataset.ledgerRowIndex), Number(input.dataset.ledgerColumnIndex));
}

function handleSecondaryLedgerKeydown(event) {
  const input = event.target.closest(".secondary-ledger-cell");
  if (!input) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (secondaryLedgerEditSnapshot?.rows) {
      secondaryLedgerDraftRows = secondaryLedgerEditSnapshot.rows;
      secondaryLedgerEditSnapshot = null;
      renderSecondaryLedger();
    } else {
      undoSecondaryLedgerEdit();
    }
    return;
  }
  if (event.key === "Escape" && secondaryLedgerEditSnapshot?.rows) {
    event.preventDefault();
    secondaryLedgerDraftRows = secondaryLedgerEditSnapshot.rows;
    secondaryLedgerEditSnapshot = null;
    renderSecondaryLedger();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const rowIndex = Number(input.dataset.ledgerRowIndex) + (event.shiftKey ? -1 : 1);
  focusSecondaryLedgerCell(rowIndex, Number(input.dataset.ledgerColumnIndex));
}

function focusSecondaryLedgerCell(rowIndex, columnIndex) {
  const input = $(`.secondary-ledger-cell[data-ledger-row-index="${rowIndex}"][data-ledger-column-index="${columnIndex}"]`);
  input?.focus();
  input?.select();
}

function pushSecondaryLedgerUndo(rows) {
  secondaryLedgerUndoStack.push(cloneTradeRecordDraftRows(rows));
  if (secondaryLedgerUndoStack.length > 20) secondaryLedgerUndoStack.shift();
  updateSecondaryLedgerControls();
}

function undoSecondaryLedgerEdit() {
  const previous = secondaryLedgerUndoStack.pop();
  if (!previous) return;
  secondaryLedgerDraftRows = previous;
  secondaryLedgerEditSnapshot = null;
  renderSecondaryLedger();
}

function updateSecondaryLedgerControls() {
  const dirtyCells = tradeRecordDirtyCellCount(secondaryLedgerDraftRows);
  const dirtyRows = secondaryLedgerDraftRows.filter((row) => row.dirty).length;
  const status = $("#secondaryLedgerSaveStatus");
  if (status) {
    status.textContent = secondaryLedgerSavePending
      ? "正在保存"
      : dirtyRows ? `${dirtyRows} 行 · ${dirtyCells} 格待保存` : "已保存";
    status.className = `secondary-ledger-save-status ${dirtyRows ? "dirty" : "saved"}`;
  }
  const dmStatus = $("#secondaryLedgerDmStatus");
  if (dmStatus) {
    const complete = secondaryLedgerDraftRows.filter((row) => row.dmLookup?.status === "complete").length;
    const partial = secondaryLedgerDraftRows.filter((row) => ["partial", "missing"].includes(row.dmLookup?.status)).length;
    dmStatus.textContent = secondaryLedgerDmLoading
      ? "DM 读取中"
      : complete || partial ? `DM ${complete} 完整${partial ? ` · ${partial} 待补` : ""}` : "DM 待读取";
  }
  const saveButton = $("#secondaryLedgerSaveButton");
  if (saveButton) saveButton.disabled = secondaryLedgerSavePending || !dirtyRows;
  const undoButton = $("#secondaryLedgerUndoButton");
  if (undoButton) undoButton.disabled = !secondaryLedgerUndoStack.length;
  const dmButton = $("#secondaryLedgerDmButton");
  if (dmButton) dmButton.disabled = secondaryLedgerDmLoading || !secondaryLedgerDraftRows.length;
}

function secondaryLedgerInputMode(column) {
  return ["净价", "收益率(%)", "估值收益率", "面值（万元）", "成本", "价差", "清算速度(0/1)"].includes(column)
    ? "decimal"
    : "text";
}

function secondaryLedgerDmRowStatus(row) {
  if (row.dmLookup?.status === "complete") {
    return { label: "DM", className: "complete", title: `DM 已补全；估值日 ${row.dmLookup.valuationDate || "未返回"}` };
  }
  if (row.dmLookup?.status === "partial") {
    return { label: "DM", className: "partial", title: `DM 部分返回：${(row.dmLookup.missing || []).join("、")}` };
  }
  if (row.dmLookup?.status === "missing") {
    return { label: "—", className: "missing", title: "DM 未返回对应字段" };
  }
  if (row.dmLookup?.status === "error") {
    return { label: "!", className: "error", title: "DM 读取失败" };
  }
  return { label: "", className: "", title: "" };
}

function secondaryLedgerDmCellTitle(row, column) {
  if (column === "估值收益率") {
    const basis = row.dmLookup?.valuationField === "cbYte" ? "中债行权收益率" : "中债到期收益率";
    return `DM ${basis} · ${row.dmLookup?.valuationDate || row.dmLookup?.requestedDate || "日期未返回"}`;
  }
  return `DM ${column}`;
}

function secondaryLedgerDateValue() {
  const input = $("#secondaryLedgerDate");
  if (!input.value) input.value = localDate(new Date());
  return input.value;
}

async function enrichSecondaryLedgerFromDm({ refresh = false, automatic = false } = {}) {
  const date = secondaryLedgerDateValue();
  const rows = ensureSecondaryLedgerDraft(date);
  const requestRows = tradeRecordDmRequestRows(rows, { refresh });
  if (!requestRows.length) {
    if (!automatic) showToast("当前台账的 DM 字段已齐全。");
    return;
  }
  secondaryLedgerDmLoading = true;
  updateSecondaryLedgerControls();
  try {
    const { rows: results, failedIds, errors } = await requestTradeRecordDmRows(requestRows);
    const before = cloneTradeRecordDraftRows(secondaryLedgerDraftRows);
    secondaryLedgerDraftRows = mergeTradeRecordDmResults(secondaryLedgerDraftRows, results);
    secondaryLedgerDraftRows = markTradeRecordDmErrors(secondaryLedgerDraftRows, failedIds);
    if (secondaryLedgerDraftRows.some((row, index) =>
      JSON.stringify(row.record) !== JSON.stringify(before[index]?.record)
    )) {
      pushSecondaryLedgerUndo(before);
    }
    renderSecondaryLedger();
    if (!automatic) {
      const complete = results.filter((row) => row.status === "complete").length;
      const partial = results.length - complete;
      showToast(failedIds.length
        ? `DM 已返回 ${results.length} 笔，${failedIds.length} 笔失败：${errors[0] || "可重试"}。`
        : `DM 已返回 ${results.length} 笔：${complete} 笔完整${partial ? `，${partial} 笔部分返回` : ""}。`);
    }
  } catch (error) {
    secondaryLedgerDraftRows = markTradeRecordDmErrors(secondaryLedgerDraftRows, requestRows.map((row) => row.id));
    renderSecondaryLedger();
    if (!automatic) showToast(error.message || "DM 成交台账字段读取失败。");
  } finally {
    secondaryLedgerDmLoading = false;
    updateSecondaryLedgerControls();
  }
}

async function saveSecondaryLedgerDraft({ silent = false } = {}) {
  if (secondaryLedgerSavePending) return false;
  const dirtyRows = secondaryLedgerDraftRows.filter((row) => row.dirty);
  if (!dirtyRows.length) return true;
  const validationErrors = validateTradeRecordDraftRows(dirtyRows);
  if (validationErrors.length) {
    const first = validationErrors[0];
    focusSecondaryLedgerCell(first.rowIndex, TRADE_RECORD_COLUMNS.indexOf(first.column));
    showToast(`第 ${first.rowIndex + 1} 行：${first.message}。`);
    return false;
  }
  secondaryLedgerSavePending = true;
  updateSecondaryLedgerControls();
  state = applyTradeRecordRowsToState(state, dirtyRows);
  persistLocal();
  const saved = await saveCloudState();
  secondaryLedgerSavePending = false;
  if (!saved) {
    updateSecondaryLedgerControls();
    if (!silent) showToast("台账修改尚未同步到 D1，请检查登录或网络后重试。");
    return false;
  }
  resetSecondaryLedgerDraft();
  renderSecondaryLedger();
  if (!silent) showToast(`已保存 ${dirtyRows.length} 行成交台账修改。`);
  return true;
}

function buildSecondaryLedgerPreviewText(rows, date) {
  if (!rows.length) return `${date} 暂无二级成交台账记录。`;
  return [
    `二级成交台账 ${date}`,
    buildTradeRecordTableText(rows.map((row) => ({ record: row.record }))),
  ].join("\n");
}

async function copySecondaryLedgerRows() {
  const date = secondaryLedgerDateValue();
  const rows = ensureSecondaryLedgerDraft(date);
  if (!rows.length) {
    showToast("当日暂无可复制的成交记录。");
    return;
  }
  const text = buildTradeRecordTableText(rows, { includeHeader: false });
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制 ${rows.length} 笔 DM 可用值，不含 Wind 公式。`);
  } catch {
    downloadBlob(`二级成交台账-${date}.txt`, new Blob([text], { type: "text/plain;charset=utf-8" }));
    showToast(`已导出 ${rows.length} 笔交易记录。`);
  }
}

async function callSecondaryLedgerMailer(action) {
  const date = secondaryLedgerDateValue();
  let rows = ensureSecondaryLedgerDraft(date);
  const isSend = action === "send";
  if (!rows.length) {
    showSecondaryLedgerOutput("暂无可发送台账", "warning", `${date} 暂无二级成交台账记录。`);
    showToast("当日暂无二级成交台账记录。");
    return;
  }

  if (!isSend) {
    showSecondaryLedgerOutput("二级台账邮件预览", "preview", buildSecondaryLedgerPreviewText(rows, date));
    showToast(`已生成 ${rows.length} 笔二级成交台账预览。`);
    return;
  }

  if (!getCurrentUser() && !isLocalApiMode()) {
    showSecondaryLedgerOutput("请先登录", "warning", "请先通过 tempest07.com 统一登录后再发送二级成交台账邮件。");
    redirectToGatewayLogin();
    return;
  }

  if (rows.some((row) => row.dirty)) {
    const saved = await saveSecondaryLedgerDraft({ silent: true });
    if (!saved) {
      showSecondaryLedgerOutput("台账尚未保存", "warning", "请先完成 D1 同步，再发送二级成交台账邮件。");
      return;
    }
    rows = ensureSecondaryLedgerDraft(date);
  }

  const button = $("#secondaryLedgerSendButton");
  button.disabled = true;
  showSecondaryLedgerOutput("正在发送", "loading", "正在发送二级成交台账邮件...");
  try {
    const query = new URLSearchParams({ date });
    const response = await fetch(`${SECONDARY_MAILER_URL}?${query.toString()}`, {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
      showSecondaryLedgerOutput("二级台账发送失败", "error", JSON.stringify({
        ok: false,
        httpStatus: response.status,
        ...(payload || { error: text.slice(0, 1000) }),
      }, null, 2));
      showToast("二级台账邮件发送失败，请查看输出详情。");
      return;
    }

    if (payload?.status === "sent") {
      const tradeIds = secondaryTradesForLedger(state, date).map((trade) => trade.id);
      if (tradeIds.length) {
        state = {
          ...state,
          secondaryTrades: markSecondaryTradesLedgerSent(state.secondaryTrades || [], tradeIds, payload.sentAt || new Date().toISOString()),
          updatedAt: new Date().toISOString(),
        };
        persistState();
        renderSecondaryInventoryWorkspace();
      }
      showSecondaryLedgerOutput("二级台账已发送", "success", buildSecondaryLedgerSuccessMessage(payload));
      showToast("二级成交台账邮件已发送。");
    } else {
      showSecondaryLedgerOutput("发送结果", "info", payload?.reason || "二级台账发送请求已完成。");
      showToast(payload?.reason || "二级台账发送请求已完成。");
    }
  } catch (error) {
    showSecondaryLedgerOutput("邮件服务异常", "error", JSON.stringify({
      status: "error",
      error: error.message || String(error),
      hint: "请确认 credit-bond-mailer Worker 已部署二级成交台账接口。",
    }, null, 2));
    showToast("邮件服务暂时无法访问。");
  } finally {
    button.disabled = false;
  }
}

function buildSecondaryLedgerSuccessMessage(payload = {}) {
  const subject = payload.subject ? `主题：${payload.subject}` : "";
  const count = Number.isFinite(Number(payload.rowCount)) ? `台账数量：${payload.rowCount} 笔` : "";
  return ["二级成交台账邮件已成功发送。", subject, count].filter(Boolean).join("\n");
}

function showSecondaryLedgerOutput(title, status, text) {
  const panel = $("#secondaryLedgerOutputPanel");
  panel.hidden = false;
  panel.dataset.status = status || "info";
  $("#secondaryLedgerOutputTitle").textContent = title || "邮件输出";
  $("#secondaryLedgerOutput").textContent = text || "";
}

function hideSecondaryLedgerOutput() {
  $("#secondaryLedgerOutputPanel").hidden = true;
  $("#secondaryLedgerOutput").textContent = "";
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

async function exportSecondaryOffers() {
  const orders = normalizeSecondaryOrders(state.secondaryOrders || [])
    .filter((order) => order.side === "offer" && ["active", "partial"].includes(order.status));
  if (!orders.length) {
    showToast("暂无有效挂卖可导出。");
    return;
  }
  const text = buildSecondaryOfferListText(orders);
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制 ${orders.length} 条 OFR 挂单列表。`);
  } catch {
    downloadBlob("二级挂单OFR.txt", new Blob([text], { type: "text/plain;charset=utf-8" }));
    showToast(`已导出 ${orders.length} 条 OFR 挂单 txt。`);
  }
}

function importSecondaryTrades() {
  const negotiationDate = $("#secondaryNegotiationDate").value || localDate(new Date());
  const referenceDate = new Date(`${negotiationDate}T12:00:00`);
  const result = parseSecondaryTradeIntake($("#secondaryInput").value, { negotiationDate, referenceDate });
  if (!result.trades.length && !result.protocolCandidates.length) {
    showSecondaryIntakeResult(result);
    showToast("没有识别到交易记录。请确认每行包含债券代码或简称，以及面值。");
    return;
  }
  if (result.trades.length && secondaryPendingDraftRows.some((row) => row.dirty)) {
    state = applySecondaryPendingDraftRows(state, secondaryPendingDraftRows);
  }
  if (result.trades.length) state = upsertSecondaryTrades(state, result.trades);
  for (const candidate of result.protocolCandidates) {
    state = upsertProtocolTransfer(state, protocolTransferFromSecondaryTrade(candidate, referenceDate));
  }
  persistState();
  if (result.trades.length) resetSecondaryPendingDraft();
  if (result.trades.length) setSecondaryIntakeCollapsed(true);
  renderSecondaryInventoryWorkspace();
  renderProtocolTransferWorkspace();
  showSecondaryIntakeResult(result);
  const messages = [];
  if (result.trades.length) messages.push(`${result.trades.length} 条已转为待成交`);
  if (result.protocolCandidates.length) messages.push(`${result.protocolCandidates.length} 条交易所私募已转入协议转让`);
  showToast(messages.join("；"));
  if (!result.trades.length && result.protocolCandidates.length) switchSecondaryWorkspacePanel("protocol");
}

function clearSecondaryIntake() {
  $("#secondaryInput").value = "";
  const result = $("#secondaryIntakeResult");
  result.hidden = true;
  result.innerHTML = "";
  $("#secondaryInput").focus();
}

function showSecondaryIntakeResult(result = {}) {
  const panel = $("#secondaryIntakeResult");
  const trades = result.trades || [];
  const protocolCandidates = result.protocolCandidates || [];
  const diagnostics = result.diagnostics || [];
  const rejected = diagnostics.filter((item) => item.status === "rejected");
  const warnings = diagnostics.filter((item) => item.status === "warning");
  panel.hidden = false;
  panel.innerHTML = `
    <strong>本次识别：${escapeHtml(trades.length)} 条待成交，${escapeHtml(protocolCandidates.length)} 条转协议，${escapeHtml(rejected.length)} 条未识别</strong>
    ${warnings.length ? `<span>${escapeHtml(warnings.length)} 条需要复核：${escapeHtml(warnings.map((item) => `第${item.lineNumber}行 ${item.message}`).join("；"))}</span>` : ""}
    ${rejected.length ? `<span>${escapeHtml(rejected.map((item) => `第${item.lineNumber}行 ${item.message}`).join("；"))}</span>` : ""}
  `;
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
  if (status === "filled") {
    showToast("请粘贴交易要素并点“录入待成交”，成交不再从挂单卡片触发。");
    return;
  }
  state = {
    ...state,
    secondaryOrders: orders.map((item) => item.id === id ? markSecondaryOrderStatus(item, status, item.quantityWan) : item),
    updatedAt: new Date().toISOString(),
  };
  persistState();
  renderSecondaryInventoryWorkspace();
  showToast("挂单状态已更新。");
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
        const paymentKey = `${projectValue.id}:${tranche.id}`;
        const prepaymentNumber = tranche.prepaymentNumber || "";
        return `
          <article class="payment-todo-item ${timing} ${prepaymentNumber ? "has-prepayment" : ""}">
            <div class="payment-todo-content">
              <button class="payment-todo-main" type="button" data-open-payment-project="${escapeAttribute(projectValue.id)}">
                <strong>${escapeHtml(tranche.shortName || projectValue.shortName)}</strong>
                <span>${escapeHtml(projectValue.issuerName || projectValue.branch || "主体待补")} · ${escapeHtml(timingLabel)}${escapeHtml(addBondNote)}</span>
              </button>
              ${prepaymentNumber ? `<span class="payment-todo-number">预缴款 · ${escapeHtml(prepaymentNumber)}</span>` : ""}
            </div>
            <div class="payment-todo-actions">
              <button class="button prepayment-button ${prepaymentNumber ? "recorded" : "subtle"}" type="button" data-prepayment-payment="${escapeAttribute(paymentKey)}" aria-label="${prepaymentNumber ? "修改" : "录入"}${escapeAttribute(tranche.shortName || projectValue.shortName)}预缴款编号">预缴款</button>
              <button class="button subtle" type="button" data-complete-payment="${escapeAttribute(paymentKey)}">缴款</button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="payment-todo-empty">目前没有待缴款任务。</div>';
}

function isAbsOrAbnProject(projectValue, tranche = {}) {
  return isAbsProject(projectValue) || /(?:ABS|ABN|资产支持)/i.test(`${projectValue.shortName} ${tranche.shortName} ${projectValue.sourceText}`);
}

function openPrepaymentEntry(value, trigger) {
  const [projectId, trancheId] = String(value || "").split(":");
  const projectValue = (state.projects || []).find((item) => item.id === projectId);
  const tranche = projectValue?.tranches?.find((item) => item.id === trancheId);
  if (!projectValue || !tranche) return;
  const existingNumber = tranche.prepaymentNumber || "";
  const numberDate = existingNumber
    ? `${existingNumber.slice(1, 5)}-${existingNumber.slice(5, 7)}-${existingNumber.slice(7, 9)}`
    : localDate(new Date());
  activePrepaymentTarget = { projectId, trancheId, numberDate, trigger };
  $("#prepaymentEntrySubject").textContent = tranche.shortName || projectValue.shortName;
  $("#prepaymentSuffixInput").value = existingNumber.slice(-3);
  $("#prepaymentEntryPanel").hidden = false;
  renderPrepaymentNumberPreview();
  syncModalOpenState();
  requestAnimationFrame(() => {
    $("#prepaymentSuffixInput").focus({ preventScroll: true });
    $("#prepaymentSuffixInput").select();
  });
}

function renderPrepaymentNumberPreview() {
  const suffix = $("#prepaymentSuffixInput").value;
  const number = activePrepaymentTarget && suffix.length === 3
    ? buildPrepaymentNumber(suffix.padEnd(3, "·"), activePrepaymentTarget.numberDate)
    : "";
  const prefix = activePrepaymentTarget
    ? buildPrepaymentNumber("000", activePrepaymentTarget.numberDate).slice(0, -3)
    : "";
  $("#prepaymentNumberPrefix").textContent = prefix;
  $("#prepaymentNumberPreview").textContent = number || `${prefix}${suffix.padEnd(3, "·")}`;
}

function savePrepaymentEntry(event) {
  event.preventDefault();
  if (!activePrepaymentTarget) return;
  const suffix = $("#prepaymentSuffixInput").value.trim();
  const prepaymentNumber = buildPrepaymentNumber(suffix, activePrepaymentTarget.numberDate);
  if (!prepaymentNumber) {
    showToast("请输入预缴款编号的最后三位数字。");
    $("#prepaymentSuffixInput").focus({ preventScroll: true });
    return;
  }
  const { projectId, trancheId } = activePrepaymentTarget;
  const projectValue = (state.projects || []).find((item) => item.id === projectId);
  if (!projectValue) return;
  const next = normalizeProjectRecord({
    ...projectValue,
    tranches: projectValue.tranches.map((tranche) => tranche.id === trancheId
      ? { ...tranche, prepaymentNumber, prepaymentRecordedAt: new Date().toISOString() }
      : tranche),
  });
  next.status = deriveProjectStatus(next);
  closePrepaymentEntry({ restoreFocus: false });
  state = upsertProject(state, next);
  persistState();
  renderProjectWorkspace();
  showToast(`${next.shortName} 已保存预缴款编号 ${prepaymentNumber}。`);
}

function closePrepaymentEntry({ restoreFocus = true } = {}) {
  const trigger = activePrepaymentTarget?.trigger;
  $("#prepaymentEntryPanel").hidden = true;
  activePrepaymentTarget = null;
  syncModalOpenState();
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
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
  ledgerFilter = LEDGER_FILTER_LABELS[nextFilter] || PROJECT_STATUS_OPTIONS.includes(nextFilter) ? nextFilter : "all";
  syncLedgerFilterControls();
  renderProjectList();
}

function syncLedgerFilterControls() {
  $("#projectStatusFilter").value = ledgerFilter === "all" ? "" : ledgerFilter;
  const activeFilter = LEDGER_FILTER_LABELS[ledgerFilter] ? ledgerFilter
    : projectMatchesStatusFilter({ status: ledgerFilter }, "resulted") ? "resulted" : ledgerFilter;
  $$("[data-ledger-filter]").forEach((item) => {
    const active = item.dataset.ledgerFilter === activeFilter;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
}

function renderProjectList() {
  syncLedgerFilterControls();
  const query = $("#projectSearch").value.trim().toLowerCase();
  const dateFilter = $("#projectDateFilter").value;
  const projects = (state.projects || [])
    .filter((item) => {
      if (!projectMatchesStatusFilter(item, ledgerFilter)) return false;
      if (dateFilter && !projectMatchesDateFilter(item, dateFilter)) return false;
      return `${item.shortName} ${item.issuerName} ${item.branch} ${item.leadUnderwriter}`.toLowerCase().includes(query);
    })
    .sort(compareProjects);

  const projectList = $("#projectList");
  projectList.innerHTML = projects.length
    ? projects.map((item) => {
      const valuationSummary = formatProjectValuationSummary(item);
      return `
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
            ${valuationSummary ? `<span class="project-valuation-badge">${escapeHtml(valuationSummary)}</span>` : ""}
            <span class="project-offering-badge ${projectOfferingBadgeClass(item)}">${escapeHtml(formatProjectOfferingSummary(item) || "发行方式待补")}</span>
            <span class="project-party-badge">${escapeHtml(formatProjectVenueLead(item))}</span>
          </span>
          ${renderProjectCardBidSummary(item)}
        </button>
      `;
    }).join("")
    : '<div class="empty">当前筛选下暂无项目。</div>';

  $$("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openLedgerProject(button.dataset.projectId);
    });
  });
}

function renderProjectCardBidSummary(project) {
  const summary = projectCardBidSummary(project);
  if (!summary) return "";
  const label = summary.isFinal ? "最终标位" : summary.sequence ? "当前标位" : "投标记录";
  return `<span class="project-bid-summary" aria-label="${label}">
    <span class="project-bid-summary-head">
      <span>${label}${summary.sequence ? ` · 第 ${summary.sequence} 次提交` : ""}</span>
      ${summary.hasDraftChanges ? '<span class="project-bid-draft">有修改未提交</span>' : ""}
    </span>
    ${summary.tranches.map(tranche => {
      const showParticipation = tranche.positions.some(position => position.label !== "表内");
      return `<span class="project-bid-tranche">
        ${summary.tranches.length > 1 ? `<span class="project-bid-tranche-name">${escapeHtml(tranche.shortName)}${tranche.duration ? ` · ${escapeHtml(tranche.duration)}` : ""}</span>` : ""}
        <span class="project-bid-positions">${tranche.positions.map(position => `<span class="project-bid-position">
          ${showParticipation ? `<span class="project-bid-participation">${escapeHtml(position.label)}</span>` : ""}
          <span><strong>${escapeHtml(position.rate)}</strong> 投 ${escapeHtml(position.amount)}</span>
        </span>`).join("")}</span>
      </span>`;
    }).join("")}
  </span>`;
}

function clearProjectForm() {
  closeResultEntryPanel();
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
  const guaranteeSummary = formatProjectGuaranteeSummary(record.guaranteeInfo);
  $("#projectSummaryGuaranteeItem").hidden = !guaranteeSummary;
  $("#projectSummaryGuarantee").textContent = guaranteeSummary || "待补";
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
  $("#projectStatusPill").classList.toggle("bid-final", record.status === "已投标结束");
  $("#projectAutosaveStatus").textContent = localStateDirty ? "已保存到本机，正在上传" : "云端已确认";
  updateProjectActionButtons(record);
  renderBidSubmissionHistory(record);
  renderCutoffHint(record);
  renderTranches(record.tranches);
  void loadProjectPaymentReceipts(record.id);
  applyResultRecognitionMarks(record);
  renderProjectList();
}

function formatProjectGuaranteeSummary(input = {}) {
  const info = normalizeGuaranteeInfo(input);
  if (!info.guarantors.length) return "";
  const parties = info.guarantors.map(formatProjectGuarantor).join("、");
  return info.method ? `${parties} · ${info.method}` : parties;
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
          <label>市场估值（%）<input data-tranche-field="marketValuation" type="number" step="0.0001" value="${escapeAttribute(tranche.marketValuation ?? "")}"></label>
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
          <label>预缴款编号<input data-tranche-field="prepaymentNumber" value="${escapeAttribute(tranche.prepaymentNumber)}" placeholder="从缴款待办录入" readonly></label>
          <input data-tranche-field="prepaymentRecordedAt" type="hidden" value="${escapeAttribute(tranche.prepaymentRecordedAt)}">
          <label class="span-3">回拨 / 结果备注<input data-tranche-field="allocationNote" value="${escapeAttribute(tranche.allocationNote)}"></label>
          <label class="checkbox-label compact-checkbox"><input data-tranche-field="paymentCompleted" type="checkbox" ${tranche.paymentCompleted ? "checked" : ""}>已完成缴款</label>
        </div>
        ${renderTranchePaymentReceipts(selectedProjectId, tranche)}
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
    const fullyReallocated = /全部回拨|^取消发行(?:[：:]|$)/.test(item?.allocationNote || "");

    marks[`${base}.resultStatus`] = fullyReallocated
      ? recognitionMark("success", "已识别为取消/全部回拨，本品种未发行")
      : tranche.resultStatus && tranche.resultStatus !== "待出结果"
      ? recognitionMark("success", "截标结果已按票面和标位推算")
      : recognitionMark("attention", "截标结果需要复核或补充标位");
    marks[`${base}.winningRate`] = fullyReallocated
      ? recognitionMark("success", "本品种未发行，无票面利率")
      : hasCoupon
      ? recognitionMark("success", "票面/中标利率已识别")
      : recognitionMark("error", "票面/中标利率未识别，请补充");
    marks[`${base}.winningAmountWan`] = fullyReallocated
      ? recognitionMark("success", "本品种未发行，中标量为 0")
      : Number.isFinite(numberOrNull(tranche.winningAmountWan))
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
    marks[`${base}.issueScale`] = fullyReallocated
      ? recognitionMark("success", "本品种未发行，无实际发行规模")
      : hasIssueScale
      ? recognitionMark("success", "发行规模已识别")
      : recognitionMark("error", "发行规模未识别，请补充");
    marks[`${base}.fullMarketMultiple`] = fullyReallocated
      ? recognitionMark("success", "本品种未发行，无全场倍数")
      : Number.isFinite(numberOrNull(item?.fullMarketMultiple))
      ? recognitionMark("success", "全场倍数已识别")
      : recognitionMark("attention", "全场倍数未披露或未识别");
    if (Number.isFinite(numberOrNull(item?.marginalMultiple))) {
      marks[`${base}.marginalMultiple`] = recognitionMark("success", "边际倍数已识别");
    } else if (hasMarginalBidForRecognition(tranche)) {
      marks[`${base}.marginalMultiple`] = recognitionMark("attention", "标位在边际上，未识别边际倍数时按全中处理，请复核");
    }
    marks[`${base}.startDate`] = fullyReallocated
      ? recognitionMark("success", "本品种未发行，无需起息")
      : hasStartDate
      ? recognitionMark("success", "起息日期已识别")
      : recognitionMark("attention", "起息日期未识别，必要时补充");
    marks[`${base}.paymentDate`] = fullyReallocated
      ? recognitionMark("success", "本品种未发行，无需缴款")
      : hasPaymentDate
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
  if (items.some((item) => item.trancheId)) return items.find((item) => item.trancheId === tranche.id) || {};
  const trancheShortName = resultRecognitionShortNameKey(tranche.shortName);
  const exact = items.find((item) => item?.shortName && resultRecognitionShortNameKey(item.shortName) === trancheShortName);
  if (exact) return exact;

  const securityCode = String(tranche.securityCode || "").trim().toUpperCase();
  const codeMatch = securityCode
    ? items.find((item) => String(item?.securityCode || "").trim().toUpperCase() === securityCode)
    : null;
  if (codeMatch) return codeMatch;

  const baseShortName = resultRecognitionShortNameKey(stripTrancheSuffixForRecognition(tranche.shortName));
  const duration = resultRecognitionDurationKey(tranche.durationText);
  const baseMatches = items.filter((item) =>
    item?.shortName
    && resultRecognitionShortNameKey(stripTrancheSuffixForRecognition(item.shortName)) === baseShortName
  );
  const durationMatch = duration
    ? baseMatches.find((item) => resultRecognitionDurationKey(item.durationText) === duration)
    : null;
  if (durationMatch) return durationMatch;

  const positional = items[index];
  if (!positional?.shortName || resultRecognitionShortNameKey(positional.shortName) === trancheShortName) {
    return positional || {};
  }
  return {};
}

function resultRecognitionShortNameKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/[，,；;].*$/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function resultRecognitionDurationKey(value = "") {
  return String(value || "").replace(/\s+/g, "").replace(/期$/, "").toUpperCase();
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
    // The result modal is a separate draft; only its confirmation handler persists it.
    resultAdvertisement: existing.resultAdvertisement || "",
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
  projectAutoSaveTimer = null;
  const draft = readProjectForm();
  if (draft.resultConfirmed) draft.status = deriveProjectStatus(draft);
  saveProjectRecordNow(draft);
}

function saveProjectRecordNow(record) {
  clearTimeout(projectAutoSaveTimer);
  projectAutoSaveTimer = null;
  const normalized = applyFtpRevenueToProject(record);
  const isCurrentProject = !$("#projectForm").hidden && $("#projectId").value === normalized.id;
  state = upsertProject(state, normalized);
  if (isCurrentProject) selectedProjectId = normalized.id;
  persistState();
  if (isCurrentProject) {
    $("#projectStatus").value = normalized.status;
    $("#projectStatusPill").textContent = normalized.status;
    $("#projectStatusPill").classList.toggle("bid-final", normalized.status === "已投标结束");
    $("#projectAutosaveStatus").textContent = "已保存到本机，正在上传";
    $("#projectBidPosition").value = buildBidPositionText(normalized);
    updateProjectActionButtons(normalized);
    renderBidSubmissionHistory(normalized);
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
  if (["未投标", "已投标", "已结束"].includes(status)) {
    draft.resultConfirmed = false;
  }
  saveProjectRecordNow(draft);
  if (["未投标", "已投标", "已结束"].includes(status)) {
    closeResultEntryPanel();
    setResultEntryFieldsVisible(false);
  }
  const messages = {
    未投标: "项目已撤回为未投标。",
    已投标: "项目已确认投标，可以继续改标。",
    已结束: "项目已终止，不再进入待投标流程。",
  };
  showToast(messages[status] || "项目状态已更新。");
}

function submitProjectBidRound() {
  clearTimeout(projectAutoSaveTimer);
  const result = appendBidSubmission(readProjectForm());
  if (!result.submission) {
    showToast(result.issues[0] || "请先补全投标标位。");
    return;
  }
  saveProjectRecordNow(result.project);
  closeResultEntryPanel();
  setResultEntryFieldsVisible(false);
  showToast(`第 ${result.submission.sequence} 次标位已记录，当前有效标已更新。`);
}

function changeProjectBidFinalization(reopen) {
  const draft = readProjectForm();
  const result = reopen ? reopenProjectBid(draft) : finalizeProjectBid(draft);
  if (result.issues.length) {
    showToast(result.issues[0]);
    return;
  }
  saveProjectRecordNow(result.project);
  showToast(reopen
    ? "已恢复为已投标，可以继续改标；已有标位和提交记录已保留。"
    : "最终标位已确认，项目已移至已投标结束，等待录入结果。");
}

function updateProjectActionButtons(projectOrStatus) {
  const projectValue = typeof projectOrStatus === "string"
    ? { status: projectOrStatus, bidSubmissions: [] }
    : projectOrStatus || {};
  const status = projectValue.status || "未投标";
  const bidCount = projectValue.bidSubmissions?.length || 0;
  const resultStatuses = new Set(["部分中标", "已中标", "未中标", "待缴款", "已缴款"]);
  const hasResult = projectValue.resultConfirmed || resultStatuses.has(status);
  $("#markUnbidButton").disabled = status === "未投标" || status === "已投标结束" || hasResult;
  $("#terminateProjectButton").disabled = status !== "未投标";
  $("#markBidButton").disabled = hasResult || !["未投标", "已投标"].includes(status);
  $("#markBidButton").textContent = `提交第 ${bidCount + 1} 次标`;
  $("#finalizeBidButton").hidden = status !== "已投标" || hasResult;
  $("#finalizeBidButton").disabled = !bidCount;
  $("#reopenBidButton").hidden = status !== "已投标结束" || hasResult;
  $("#openResultButton").disabled = status === "未投标" || status === "已结束";
  updateProjectResultQueueState();
}

function renderBidSubmissionHistory(projectValue) {
  const history = $("#bidSubmissionHistory");
  const summary = $("#projectBidRoundSummary");
  const submissions = projectValue.bidSubmissions || [];
  if (!submissions.length) {
    summary.textContent = "尚无投标记录";
    history.hidden = true;
    history.innerHTML = "";
    return;
  }

  const latest = submissions[submissions.length - 1];
  const isFinal = latest.id === projectValue.finalBidSubmissionId;
  const hasDraftChanges = !projectValue.resultConfirmed && hasUnsubmittedBidChanges(projectValue);
  summary.textContent = `已提交 ${submissions.length} 次 · ${isFinal ? "最终标位" : "最近提交"}：第 ${latest.sequence} 次${hasDraftChanges ? " · 有修改未提交" : ""}`;
  history.hidden = false;
  history.innerHTML = [...submissions].reverse().map((submission) => {
    const isLatest = submission.id === latest.id;
    const actions = [...new Set((submission.tranches || []).map((tranche) => tranche.bidAction).filter(Boolean))].join(" / ");
    const positions = (submission.tranches || []).flatMap((tranche) => bidSubmissionPositionLabels(tranche)).join("；");
    return `
      <div class="bid-submission-row ${isLatest ? "is-current" : ""}">
        <strong>第 ${submission.sequence} 次</strong>
        <time>${escapeHtml(formatBidSubmissionTime(submission.submittedAt))}</time>
        <span class="bid-submission-action">${escapeHtml(actions || "投标")}</span>
        <span class="bid-submission-positions">${escapeHtml(positions || "标位待补")}</span>
        ${isLatest ? `<span class="bid-submission-current">${isFinal ? "最终标位" : "最近提交"}</span>` : ""}
      </div>
    `;
  }).join("");
}

function bidSubmissionPositionLabels(tranche = {}) {
  const name = tranche.shortName || "品种";
  const own = (tranche.bidLevels || []).map((level) =>
    `${name} ${formatNumber(level.bidRate)}%投${formatNumber(level.bidAmount)}亿`,
  );
  const outsourced = (tranche.outsourcedBids || []).map((bid) =>
    `${bid.managerName || "委外"} ${formatNumber(bid.bidRate)}%投${formatNumber(bid.bidAmount)}亿`,
  );
  return [...own, ...outsourced];
}

function formatBidSubmissionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function openResultEntryPanel(shouldFocus = true, requestedTaskId = "") {
  resetIssuanceReview();
  const current = readProjectForm();
  const task = issuanceQueueTaskForProject(current.id, requestedTaskId);
  if (task) loadIssuanceQueueTask(task);
  else {
    activeIssuanceQueueTaskId = "";
    $("#projectResultAdvertisement").value = current.resultAdvertisement || "";
    $("#issuanceNoticeDate").value = (current.cutoffAt || "").slice(0, 10);
  }
  $("#resultEntryPanel").hidden = false;
  positionResultEntryPanel();
  requestAnimationFrame(positionResultEntryPanel);
  syncModalOpenState();
  if (shouldFocus && (!task || task.status === ISSUANCE_QUEUE_STATUS.ERROR)) {
    $("#projectResultAdvertisement").focus({ preventScroll: true });
  } else {
    $("#resultEntryDialog")?.focus({ preventScroll: true });
  }
}

function closeResultEntryPanel() {
  resetIssuanceReview();
  activeIssuanceQueueTaskId = "";
  $("#resultEntryPanel").hidden = true;
  syncModalOpenState();
  if (isCompactLedger()) $("#openResultButton")?.focus({ preventScroll: true });
}

function resetIssuanceReview(message = "") {
  $("#issuanceRecognitionPreview").hidden = true;
  $("#issuanceRecognitionPreview").replaceChildren();
  $("#issuanceConfirmBar").hidden = true;
  $("#confirmIssuanceResultButton").disabled = true;
  $("#confirmIssuanceResultButton").textContent = "确认写入并生成汇报";
  $("#parseAdvertisementButton").disabled = false;
  $("#parseAdvertisementButton").textContent = "确认并排队";
  $("#issuanceRecognitionStatus").textContent = message;
  $("#issuanceRecognitionStatus").dataset.error = "false";
  updateIssuanceQueueSummary();
}

function issuanceReviewSnapshot() {
  const draft = readProjectForm();
  return { projectId: draft.id, tranches: draft.tranches, cutoffAt: draft.cutoffAt,
    text: $("#projectResultAdvertisement").value, noticeDate: $("#issuanceNoticeDate").value };
}

function queueIssuanceResultRecognition() {
  resetIssuanceReview();
  try {
    const snapshot = issuanceReviewSnapshot();
    const request = validateRecognitionRequest(snapshot);
    const current = (state.projects || []).find((item) => item.id === snapshot.projectId);
    if (!current) throw new Error("当前项目已不存在，不能加入识别队列。");
    const alreadyRunning = issuanceRecognitionQueue.list().find((task) =>
      task.payload.projectId === snapshot.projectId
      && [ISSUANCE_QUEUE_STATUS.QUEUED, ISSUANCE_QUEUE_STATUS.PROCESSING].includes(task.status));
    if (alreadyRunning) {
      throw new Error(`${current.shortName || "当前项目"}已经在识别队列中，请等待本次完成。`);
    }
    if (activeIssuanceQueueTaskId) {
      issuanceRecognitionQueue.remove(activeIssuanceQueueTaskId);
      dismissedIssuanceQueueTaskIds.add(activeIssuanceQueueTaskId);
    }
    const task = issuanceRecognitionQueue.enqueue({
      projectId: current.id,
      projectName: current.shortName || "未命名项目",
      text: request.text,
      noticeDate: request.noticeDate,
      request,
    });
    closeResultEntryPanel();
    showToast(`${current.shortName || "项目"}已加入后台识别队列。`);
    return task;
  } catch (error) {
    resetIssuanceReview(error.message || "无法加入识别队列，本次未改动项目。");
    $("#issuanceRecognitionStatus").dataset.error = "true";
  }
}

async function requestQueuedIssuanceRecognition(payload) {
  const response = await fetch("./api/issuance-results/recognize", {
    method: "POST",
    credentials: "same-origin",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload.request),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "语义识别请求失败。");
  return result;
}

function handleIssuanceQueueChange(task) {
  const previousStatus = issuanceQueueAnnouncedStatus.get(task.id);
  issuanceQueueAnnouncedStatus.set(task.id, task.status);
  const completed = [ISSUANCE_QUEUE_STATUS.READY, ISSUANCE_QUEUE_STATUS.REVIEW, ISSUANCE_QUEUE_STATUS.ERROR].includes(task.status);
  if (completed && previousStatus !== task.status) dismissedIssuanceQueueTaskIds.delete(task.id);
  updateIssuanceQueueSummary();
  renderIssuanceQueueNotifications();
  updateProjectResultQueueState();
  if (task.id === activeIssuanceQueueTaskId && !$("#resultEntryPanel").hidden) loadIssuanceQueueTask(task);
}

function issuanceQueueTaskForProject(projectId, preferredId = "") {
  const tasks = issuanceRecognitionQueue.list();
  if (preferredId) return tasks.find((task) => task.id === preferredId && task.payload.projectId === projectId) || null;
  return [...tasks].reverse().find((task) => task.payload.projectId === projectId) || null;
}

function loadIssuanceQueueTask(task) {
  resetIssuanceReview();
  activeIssuanceQueueTaskId = task.id;
  $("#projectResultAdvertisement").value = task.payload.text;
  $("#issuanceNoticeDate").value = task.payload.noticeDate;
  if (task.status === ISSUANCE_QUEUE_STATUS.QUEUED || task.status === ISSUANCE_QUEUE_STATUS.PROCESSING) {
    $("#parseAdvertisementButton").disabled = true;
    $("#parseAdvertisementButton").textContent = task.status === ISSUANCE_QUEUE_STATUS.QUEUED ? "排队中…" : "识别中…";
    $("#issuanceRecognitionStatus").textContent = task.status === ISSUANCE_QUEUE_STATUS.QUEUED
      ? "已进入后台队列，前序项目完成后自动开始。"
      : "正在后台识别；可以收起窗口并继续录入其他项目。";
    return;
  }
  if (task.status === ISSUANCE_QUEUE_STATUS.ERROR) {
    $("#parseAdvertisementButton").textContent = "重新排队";
    $("#issuanceRecognitionStatus").textContent = task.error || "识别失败，请重新排队。";
    $("#issuanceRecognitionStatus").dataset.error = "true";
    return;
  }
  $("#parseAdvertisementButton").textContent = "重新排队";
  renderIssuanceReview(task.result);
}

function updateIssuanceQueueSummary() {
  const summary = $("#issuanceQueueSummary");
  if (!summary) return;
  const tasks = issuanceRecognitionQueue.list();
  const running = tasks.filter((task) => [ISSUANCE_QUEUE_STATUS.QUEUED, ISSUANCE_QUEUE_STATUS.PROCESSING].includes(task.status)).length;
  const review = tasks.filter((task) => [ISSUANCE_QUEUE_STATUS.READY, ISSUANCE_QUEUE_STATUS.REVIEW, ISSUANCE_QUEUE_STATUS.ERROR].includes(task.status)).length;
  summary.dataset.busy = String(running > 0);
  summary.textContent = running
    ? `后台识别中 ${running} 项${review ? ` · 待核对 ${review} 项` : ""}`
    : review
      ? `待核对 ${review} 项识别结果`
      : "后台识别队列空闲";
}

function renderIssuanceQueueNotifications() {
  const container = $("#issuanceQueueNotifications");
  if (!container) return;
  const visible = issuanceRecognitionQueue.list()
    .filter((task) => [ISSUANCE_QUEUE_STATUS.READY, ISSUANCE_QUEUE_STATUS.REVIEW, ISSUANCE_QUEUE_STATUS.ERROR].includes(task.status)
      && !dismissedIssuanceQueueTaskIds.has(task.id))
    .slice(-4)
    .reverse();
  container.innerHTML = visible.map((task) => {
    const ready = task.status === ISSUANCE_QUEUE_STATUS.READY;
    const message = ready ? "已识别完成，等待人工核对"
      : task.status === ISSUANCE_QUEUE_STATUS.REVIEW ? "识别完成，有字段需要核对"
        : "识别失败，可重新提交";
    return `<article class="issuance-queue-notification" data-status="${escapeAttribute(task.status)}">
      <div class="issuance-queue-notification-copy"><strong>${escapeHtml(task.payload.projectName)}</strong><span>${escapeHtml(message)}</span></div>
      <div class="issuance-queue-notification-actions">
        <button type="button" data-review-issuance-task="${escapeAttribute(task.id)}">${ready ? "核对并写入" : "查看"}</button>
        <button type="button" data-dismiss-issuance-task="${escapeAttribute(task.id)}" aria-label="关闭通知">×</button>
      </div>
    </article>`;
  }).join("");
}

function handleIssuanceQueueNotificationClick(event) {
  const dismiss = event.target.closest("[data-dismiss-issuance-task]");
  if (dismiss) {
    dismissedIssuanceQueueTaskIds.add(dismiss.dataset.dismissIssuanceTask);
    renderIssuanceQueueNotifications();
    return;
  }
  const review = event.target.closest("[data-review-issuance-task]");
  if (!review) return;
  openIssuanceQueueTask(review.dataset.reviewIssuanceTask);
}

function openIssuanceQueueTask(taskId) {
  const task = issuanceRecognitionQueue.get(taskId);
  if (!task) return;
  const projectExists = (state.projects || []).some((item) => item.id === task.payload.projectId);
  if (!projectExists) {
    showToast("对应项目已不存在，无法核对该识别结果。");
    return;
  }
  dismissedIssuanceQueueTaskIds.add(task.id);
  renderIssuanceQueueNotifications();
  openLedgerProject(task.payload.projectId);
  requestAnimationFrame(() => openResultEntryPanel(true, task.id));
}

function updateProjectResultQueueState() {
  const button = $("#openResultButton");
  if (!button) return;
  const projectId = $("#projectId")?.value || selectedProjectId;
  const tasks = issuanceRecognitionQueue.list().filter((task) => task.payload.projectId === projectId);
  const ready = tasks.some((task) => [ISSUANCE_QUEUE_STATUS.READY, ISSUANCE_QUEUE_STATUS.REVIEW, ISSUANCE_QUEUE_STATUS.ERROR].includes(task.status));
  const processing = tasks.some((task) => [ISSUANCE_QUEUE_STATUS.QUEUED, ISSUANCE_QUEUE_STATUS.PROCESSING].includes(task.status));
  if (ready) button.dataset.queueStatus = "ready";
  else if (processing) button.dataset.queueStatus = "processing";
  else delete button.dataset.queueStatus;
  button.title = ready ? "有识别结果待核对" : processing ? "发行结果正在后台识别" : "";
}

function handleResultEntryOutsidePointer(event) {
  const panel = $("#resultEntryPanel");
  if (!panel || panel.hidden || panel.contains(event.target) || $("#openResultButton")?.contains(event.target)) return;
  closeResultEntryPanel();
}

function positionResultEntryPanel() {
  const panel = $("#resultEntryPanel");
  const anchor = $("#openResultButton");
  const host = anchor?.closest(".result-entry-anchor");
  if (!panel || panel.hidden || !anchor || !host) return;
  const margin = 12;
  const anchorRect = anchor.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const width = Math.min(460, Math.max(280, window.innerWidth - margin * 2));
  const viewportLeft = Math.min(window.innerWidth - width - margin, Math.max(margin, anchorRect.right - width));
  const arrowCenter = anchorRect.left + anchorRect.width / 2 - viewportLeft;
  const arrowRight = Math.min(width - 20, Math.max(20, width - arrowCenter - 6.5));
  panel.style.setProperty("--result-entry-offset-x", `${Math.round(viewportLeft - hostRect.left)}px`);
  panel.style.setProperty("--result-entry-arrow-right", `${Math.round(arrowRight)}px`);
  panel.style.width = `${Math.round(width)}px`;
}

function renderIssuanceReview(result) {
  const preview = $("#issuanceRecognitionPreview");
  preview.hidden = false;
  $("#issuanceConfirmBar").hidden = false;
  preview.innerHTML = (result.items || []).map((item) => `
    <section class="issuance-review-card">
      <h4>${escapeHtml(item.shortName)}<small>${escapeHtml(ISSUANCE_OUTCOMES[item.outcome] || "待核对")}</small></h4>
      <dl class="issuance-review-fields">${Object.entries(ISSUANCE_FIELDS).map(([field, label]) => `
        <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(item[field] === null || item[field] === "" || item[field] === undefined ? "未识别" : String(item[field]))}</dd>
        ${item.evidence?.[field] ? `<details><summary>原文依据</summary>${escapeHtml(item.evidence[field])}</details>` : ""}</div>`).join("")}</dl>
      ${item.allocationNote ? `<p class="issuance-review-note">${escapeHtml(item.allocationNote)}（将清空该品种发行数据，中标量归零）</p>` : ""}
    </section>`).join("")
    + ["errors", "warnings"].map((kind) => result[kind]?.length ? `<ul class="issuance-review-issues ${kind}">${result[kind].map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : "").join("");
  $("#confirmIssuanceResultButton").disabled = !result.canApply;
  $("#confirmIssuanceResultButton").textContent = result.items?.some((item) => ["cancelled", "reallocated"].includes(item.outcome))
    ? "确认取消/回拨并写入" : "确认写入并生成汇报";
  $("#issuanceRecognitionStatus").dataset.error = String(!result.canApply);
  $("#issuanceRecognitionStatus").textContent = result.canApply
    ? `已识别 ${result.items.length} 个品种 · ${result.model || "云端语义模型"} · 尚未保存，请核对后确认。空缺字段保留原值；取消/回拨除外。`
    : "识别结果有待核对项，暂不能写入。请补充或修正原文/通知日期，再重新识别。";
}

function confirmIssuanceResult() {
  const task = issuanceRecognitionQueue.get(activeIssuanceQueueTaskId);
  if (!task?.result || ![ISSUANCE_QUEUE_STATUS.READY, ISSUANCE_QUEUE_STATUS.REVIEW].includes(task.status)) {
    resetIssuanceReview("识别结果已失效，请重新排队。"); return;
  }
  if ($("#projectId").value !== task.payload.projectId
    || $("#projectResultAdvertisement").value.trim() !== task.payload.text
    || $("#issuanceNoticeDate").value !== task.payload.noticeDate) {
    activeIssuanceQueueTaskId = "";
    resetIssuanceReview("项目、原文或通知日期已变化，请重新排队。"); return;
  }
  try {
    const draft = readProjectForm();
    const currentRequest = validateRecognitionRequest({
      projectId: draft.id,
      tranches: draft.tranches,
      text: task.payload.text,
      noticeDate: task.payload.noticeDate,
    });
    if (JSON.stringify(currentRequest.tranches) !== JSON.stringify(task.payload.request.tranches)) {
      activeIssuanceQueueTaskId = "";
      resetIssuanceReview("项目品种结构已变化，旧识别结果不能写入，请重新排队。");
      return;
    }
    const parsed = applySemanticIssuanceResult({ ...draft, ftpCurve: state.ftpCurve }, task.result, task.payload.text);
    parsed.resultConfirmed = true;
    parsed.status = deriveProjectStatus(parsed);
    resultRecognitionMarks = buildResultRecognitionMarks(draft, parsed, task.result);
    resultRecognitionProjectId = parsed.id;
    issuanceRecognitionQueue.remove(task.id);
    dismissedIssuanceQueueTaskIds.add(task.id);
    issuanceQueueAnnouncedStatus.delete(task.id);
    activeIssuanceQueueTaskId = "";
    saveProjectRecordNow(parsed);
    fillProjectForm(parsed);
    setResultEntryFieldsVisible(true);
    updateIssuanceQueueSummary();
    renderIssuanceQueueNotifications();
    showToast("已确认发行结果并生成汇报；中标量和营收为标位推算值，请复核。");
  } catch (error) { resetIssuanceReview(error.message); }
}

function syncModalOpenState() {
  document.body.classList.toggle(
    "modal-open",
    !$("#prepaymentEntryPanel").hidden
      || !$("#paymentReceiptRegroupPanel").hidden
      || !$("#paymentReceiptExplorerPanel").hidden
      || !$("#stateHistoryPanel").hidden
      || !$("#idleExitPanel").hidden,
  );
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
  if (["未投标", "待投标", "已投标", "已投标待结果"].includes(status)) return "warning";
  if (status === "已投标结束") return "bid-final";
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
  return input.closest("[data-recognition-root]") || input.closest("label") || input;
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

  persistState();
  openLedgerProject(firstRecordId);
  const parts = [];
  if (createdCount) parts.push(`新增 ${createdCount} 笔`);
  if (updatedCount) parts.push(`更新 ${updatedCount} 笔`);
  if (skippedCount) parts.push(`跳过 ${skippedCount} 笔`);
  showToast(`已批量加入项目台账：${parts.join("，")}。`);
}

function bindDatabase() {
  $("#newIssuerButton").addEventListener("click", () => clearIssuerForm({ openEditor: true }));
  $("#issuerSearch").addEventListener("input", renderIssuerList);
  $$('[data-issuer-credit-module]').forEach((button) => {
    button.addEventListener("click", () => selectIssuerCreditModule(button.dataset.issuerCreditModule));
  });
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
  $("#newAbsCreditApprovalButton")?.addEventListener("click", () => clearAbsCreditApprovalForm({ showForm: true }));
  $("#cancelAbsCreditApprovalButton")?.addEventListener("click", () => {
    $("#absCreditApprovalForm").hidden = true;
    $("#absCreditApprovalId").value = "";
    renderAbsCreditApprovalList();
  });
  $("#absCreditScopeType")?.addEventListener("change", syncAbsCreditScopeFields);
  $("#absCreditRawText")?.addEventListener("change", () => {
    fillParsedAbsCreditFields("absCredit");
    syncAbsCreditScopeFields();
  });
  $("#absCreditApprovalForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      fillParsedAbsCreditFields("absCredit");
      syncAbsCreditScopeFields();
      const approval = readAbsCreditApprovalForm();
      state = upsertAbsCreditApproval(state, approval);
      persistState();
      renderIssuerList();
      renderAbsCreditApprovalList();
      fillAbsCreditApprovalForm((state.absCreditApprovals || []).find((item) => item.id === approval.id));
      syncIssuerCreditWorkspace();
      renderAbsCreditApprovalOptions();
      regenerate();
      showToast("50217 批单已保存。");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#deleteAbsCreditApprovalButton")?.addEventListener("click", () => {
    const id = $("#absCreditApprovalId").value;
    const approval = (state.absCreditApprovals || []).find((item) => item.id === id);
    if (!approval) return;
    const links = approval.linkedProjectIds?.length || 0;
    const detail = links ? `，已有 ${links} 个项目关联；项目中的历史快照会保留` : "";
    if (!confirm(`确定删除这张 50217 批单吗${detail}？`)) return;
    state = removeAbsCreditApproval(state, id);
    persistState();
    renderIssuerList();
    clearAbsCreditApprovalForm();
    renderAbsCreditApprovalList();
    syncIssuerCreditWorkspace();
    clearInapplicableAbsCreditApproval();
    renderAbsCreditApprovalOptions();
    regenerate();
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
      renderAbsCreditEnhancerOptions();
      fillIssuerForm(state.issuers.find((item) => item.id === issuer.id), { module: "50206" });
      regenerate();
      if (batchItems.length) renderBatchResults();
      showToast("主体与普通信用债 50206 授信已保存。");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#deleteIssuerButton").addEventListener("click", () => {
    const id = $("#issuerId").value;
    const issuer = state.issuers.find((item) => item.id === id);
    const absApprovalCount = (state.absCreditApprovals || []).filter((item) => item.enhancerIssuerId === id).length;
    if (issuer && absApprovalCount) {
      showToast(`该主体仍关联 ${absApprovalCount} 张 50217 批单，请先处理这些批单。`);
      return;
    }
    if (!issuer || !confirm(`确定删除“${issuer.legalName}”及其授信资料吗？`)) return;
    state = { ...state, issuers: state.issuers.filter((item) => item.id !== id), updatedAt: new Date().toISOString() };
    if (selectedIssuerId === id) selectedIssuerId = "";
    persistState();
    renderIssuerOptions();
    renderIssuerList();
    renderAbsCreditEnhancerOptions();
    clearIssuerForm({ openEditor: false });
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
    renderAbsCreditEnhancerOptions();
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

function findLocalRatingForDmNormalized(normalized, sourceState = state) {
  return findProjectRatingForDmNormalized(normalized, sourceState) || findIssuerForDmNormalized(normalized, sourceState);
}

async function findCloudRatingForDmNormalized(normalized) {
  try {
    const response = await fetch(API_URL, { cache: "no-store", credentials: "same-origin", headers: authHeaders() });
    if (!response.ok) return null;
    const remote = await response.json();
    if (!remote.data?.issuers) return null;
    const remoteState = normalizeLoadedState(remote.data);
    return findLocalRatingForDmNormalized(normalized, remoteState);
  } catch {
    return null;
  }
}

function findProjectRatingForDmNormalized(normalized, sourceState = state) {
  const querySecurityId = normalizeDmSecurityId(normalized.securityId);
  const queryNames = [normalized.shortName, normalized.fullName].filter(Boolean);
  const issuerTargets = [normalized.issuerName, normalized.fullName].filter(Boolean);
  let best = null;
  for (const projectRecord of sourceState.projects || []) {
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

function findIssuerForDmNormalized(normalized, sourceState = state) {
  const targets = [normalized.issuerName, normalized.fullName, normalized.shortName].filter(Boolean);
  for (const target of targets) {
    const issuer = findIssuer(String(target), sourceState.issuers || []);
    if (issuer) return issuer;
  }
  return findIssuerForDmByCoreName(targets, sourceState);
}

function findIssuerForDmByCoreName(targets, sourceState = state) {
  let best = null;
  for (const issuer of sourceState.issuers || []) {
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

const DM_RATING_SOURCE_FIELDS = new Set([
  "subjectRating", "ratingAgency", "subjectRatingAsOf", "subjectRatingOutlook",
  "bondRating", "bondRatingAgency", "bondRatingAsOf", "bondRatingOutlook",
  "impliedRating", "impliedRatingBasis", "impliedRatingAsOf", "cbImpliedRating", "csImpliedRating",
  "defaultRateAsOf", "cbRemainingTenorYear", "cbImpliedDefaultRate",
  "cbOneYearImpliedDefaultRate", "csOneYearImpliedDefaultRate", "yyDefaultRate",
]);

function dmNormalizedSourceBadge(normalized, key, isMissing) {
  if (isMissing || !DM_RATING_SOURCE_FIELDS.has(key)) return null;
  const source = normalized?.ratingSource?.[key] || "";
  if (source === "wind-analytics") {
    return { label: "Wind", className: "wind" };
  }
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
    ["subjectRatingAsOf", "主体评级日期"],
    ["subjectRatingOutlook", "主体评级展望"],
    ["bondRating", "债项评级"],
    ["bondRatingAgency", "债项评级机构"],
    ["bondRatingAsOf", "债项评级日期"],
    ["bondRatingOutlook", "债项评级展望"],
    ["impliedRating", "市场隐含评级"],
    ["impliedRatingBasis", "隐含评级口径"],
    ["impliedRatingAsOf", "隐含评级日期"],
    ["cbImpliedRating", "中债隐含评级"],
    ["csImpliedRating", "中证隐含评级"],
    ["defaultRateAsOf", "隐含违约率日期"],
    ["cbRemainingTenorYear", "中债待偿期（年）"],
    ["cbImpliedDefaultRate", "中债剩余期限隐含违约率（%）"],
    ["cbOneYearImpliedDefaultRate", "中债一年期隐含违约率（%）"],
    ["csOneYearImpliedDefaultRate", "中证一年期隐含违约率（%）"],
    ["yyDefaultRate", "YY隐含违约率（%）"],
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
      <div class="dm-normalized-item ${isMissing ? "empty-field" : ""} ${sourceBadge?.className ? `source-${sourceBadge.className}` : ""}">
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
  const cancelledCount = tranches.filter((tranche) => ["cancelled", "failed"].includes(tranche.status)).length;
  summary.textContent = [
    `${tranches.length} 个${abs ? "分档" : "期限"}`,
    sourceLabel,
    confirmedReallocatedCount ? `${confirmedReallocatedCount} 个已回拨` : "",
    uncertainReallocatedCount ? `${uncertainReallocatedCount} 个待确认回拨` : "",
    cancelledCount ? `${cancelledCount} 个已取消` : "",
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
      <article class="dm-issue-tranche ${tranche.isQueriedInput ? "queried" : ""} ${["reallocated", "cancelled", "failed"].includes(tranche.status) ? "attention" : ""}" role="button" tabindex="0" data-dm-issue-query="${escapeAttribute(queryValue)}" aria-label="查询 ${escapeAttribute(queryValue || "该品种")}">
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
  if (["cancelled", "failed"].includes(status)) return { label: "已取消", className: "warning" };
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
  panel.hidden = isAbsProject(project);
  ensureInquiryRangeCapacity(project);
  rows.innerHTML = project.inquiryRanges.slice(0, count).map((range, index) => {
    return `
      <div class="tranche-term-row">
        ${trancheTermIdentityHtml(project, index)}
        <label>下限（%）<input type="number" step="0.0001" data-inquiry-index="${index}" data-inquiry-bound="low" value="${escapeAttribute(range?.low ?? "")}"></label>
        <label>上限（%）<input type="number" step="0.0001" data-inquiry-index="${index}" data-inquiry-bound="high" value="${escapeAttribute(range?.high ?? "")}"></label>
      </div>
    `;
  }).join("");
}

function updateDynamicInquiryRange(input) {
  const index = Number(input.dataset.inquiryIndex);
  const bound = input.dataset.inquiryBound;
  if (!Number.isInteger(index) || index < 0 || !["low", "high"].includes(bound)) return;
  ensureInquiryRangeCapacity(project);
  project.inquiryRanges[index] = {
    ...(project.inquiryRanges[index] || { low: null, high: null }),
    [bound]: numberOrNull(input.value),
  };
  project.inquiryLow = project.inquiryRanges[0]?.low ?? null;
  project.inquiryHigh = project.inquiryRanges[0]?.high ?? null;
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

function pricingVarietyCount(projectValue) {
  const pricingRows = Array.isArray(projectValue?.tranchePricing) ? projectValue.tranchePricing.length : 0;
  const valuations = Array.isArray(projectValue?.valuations) ? projectValue.valuations.length : 0;
  const guidancePrices = Array.isArray(projectValue?.guidancePrices) ? projectValue.guidancePrices.length : 0;
  return Math.max(inquiryVarietyCount(projectValue), pricingRows, valuations, guidancePrices, 1);
}

function ensureProjectPricingCapacity(projectValue) {
  const count = pricingVarietyCount(projectValue);
  const existingRows = Array.isArray(projectValue.tranchePricing) ? projectValue.tranchePricing : [];
  const valuations = Array.isArray(projectValue.valuations) ? projectValue.valuations : [];
  const guidancePrices = Array.isArray(projectValue.guidancePrices) ? projectValue.guidancePrices : [];
  projectValue.tranchePricing = Array.from({ length: count }, (_, index) => {
    const existing = existingRows[index] || {};
    const hasMarketValuation = Object.prototype.hasOwnProperty.call(existing, "marketValuation");
    const hasGuidancePrice = Object.prototype.hasOwnProperty.call(existing, "guidancePrice");
    return {
      shortName: projectValue.shortNames?.[index] || existing.shortName || (count === 1 ? projectValue.shortName || "" : ""),
      durationText: projectValue.durationParts?.[index] || existing.durationText || (count === 1 ? projectValue.durationText || "" : ""),
      marketValuation: hasMarketValuation
        ? numberOrNull(existing.marketValuation)
        : index < valuations.length
          ? numberOrNull(valuations[index])
          : index === 0
            ? numberOrNull(projectValue.valuation)
            : null,
      guidancePrice: hasGuidancePrice
        ? numberOrNull(existing.guidancePrice)
        : index < guidancePrices.length
          ? numberOrNull(guidancePrices[index])
          : index === 0
            ? numberOrNull(projectValue.guidancePrice)
            : null,
    };
  });
  syncProjectPricingMirrors(projectValue);
}

function syncProjectPricingMirrors(projectValue) {
  const rows = Array.isArray(projectValue.tranchePricing) ? projectValue.tranchePricing : [];
  projectValue.valuations = rows.map((row) => numberOrNull(row.marketValuation));
  projectValue.valuation = projectValue.valuations[0] ?? null;
  projectValue.guidancePrices = rows.map((row) => numberOrNull(row.guidancePrice));
  projectValue.guidancePrice = projectValue.guidancePrices[0] ?? null;
}

function renderProjectPricingFields() {
  const rows = $("#projectPricingRows");
  if (!rows) return;
  ensureProjectPricingCapacity(project);
  rows.innerHTML = project.tranchePricing.map((pricing, index) => `
    <div class="tranche-term-row">
      ${trancheTermIdentityHtml(project, index)}
      <label>市场估值（%）<input type="number" step="0.0001" inputmode="decimal" autocomplete="off" data-pricing-index="${index}" data-pricing-field="marketValuation" value="${escapeAttribute(pricing.marketValuation ?? "")}"></label>
      <label>综合定价至（%）<input type="number" step="0.0001" inputmode="decimal" autocomplete="off" data-pricing-index="${index}" data-pricing-field="guidancePrice" value="${escapeAttribute(pricing.guidancePrice ?? "")}"></label>
    </div>
  `).join("");
}

function trancheTermIdentityHtml(projectValue, index) {
  const shortName = projectValue.shortNames?.[index]
    || projectValue.tranchePricing?.[index]?.shortName
    || (pricingVarietyCount(projectValue) === 1 ? projectValue.shortName : "")
    || `品种${index + 1}`;
  const duration = projectValue.durationParts?.[index]
    || projectValue.tranchePricing?.[index]?.durationText
    || (pricingVarietyCount(projectValue) === 1 ? projectValue.durationText : "");
  const tenor = duration ? `<span class="tranche-term-tenor">${escapeHtml(formatDurationSummaryValue(duration))}</span>` : "";
  return `<div class="tranche-term-identity"><strong>${escapeHtml(shortName)}</strong>${tenor}</div>`;
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
    ? issuers.map((issuer) => {
      const absCount = (state.absCreditApprovals || []).filter((approval) => approval.enhancerIssuerId === issuer.id).length;
      const ordinaryAvailable = issuerHasOrdinaryCredit(issuer);
      return `
        <button class="issuer-item ${$("#issuerId").value === issuer.id ? "active" : ""}" data-issuer-id="${escapeAttribute(issuer.id)}">
          <span class="issuer-item-head">
            <strong>${escapeHtml(issuer.legalName)}</strong>
            <span class="issuer-item-credit-tags">
              <em class="${ordinaryAvailable ? "available" : ""}">50206 ${ordinaryAvailable ? "已录" : "未录"}</em>
              <em class="${absCount ? "available" : ""}">50217 ${absCount}张</em>
            </span>
          </span>
          <span>${escapeHtml((issuer.aliases || []).join(" / ") || "暂无简称")} · ${escapeHtml(issuer.enterpriseType || "企业性质待补")} · ${escapeHtml(issuerCommonSummary(issuer))}</span>
        </button>
      `;
    }).join("")
    : '<div class="empty">暂无主体资料。可新增主体，或载入示例。</div>';

  $$("[data-issuer-id]").forEach((button) => {
    button.addEventListener("click", () => fillIssuerForm(state.issuers.find((issuer) => issuer.id === button.dataset.issuerId)));
  });
}

function renderAbsCreditEnhancerOptions() {
  const input = $("#absCreditEnhancerIssuerId");
  if (input) input.value = $("#issuerId")?.value || "";
}

function renderAbsCreditApprovalList() {
  const list = $("#absCreditApprovalList");
  if (!list) return;
  const enhancerIssuerId = $("#issuerId")?.value || "";
  const approvals = [...(state.absCreditApprovals || [])]
    .map(normalizeAbsCreditApproval)
    .filter((approval) => approval.enhancerIssuerId === enhancerIssuerId)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const count = $("#selectedIssuerAbsCreditCount");
  if (count) count.textContent = `${approvals.length} 张批单`;
  list.innerHTML = approvals.length
    ? approvals.map((approval) => {
      const scopeName = approval.scopeType === ABS_CREDIT_SCOPE_SHELF ? approval.shelfName : approval.projectName;
      const scope = approval.scopeType === ABS_CREDIT_SCOPE_SHELF ? "储架批" : "单项目批";
      const facts = [
        approval.enhancerName,
        `${scope}：${scopeName}`,
        approval.approvalNo ? `批单号 ${approval.approvalNo}` : "",
        Number.isFinite(approval.approvedAmount) ? `金额 ${formatNumber(approval.approvedAmount)}亿` : "",
        Number.isFinite(approval.approvedRatio) ? `比例 ${formatNumber(approval.approvedRatio)}%` : "",
        approval.investmentTermText ? `期限 ${approval.investmentTermText}` : "",
        approval.linkedProjectIds.length ? `已关联 ${approval.linkedProjectIds.length} 个项目` : "尚未关联项目",
      ].filter(Boolean).join(" · ");
      return `
        <button class="issuer-item abs-credit-item ${$("#absCreditApprovalId")?.value === approval.id ? "active" : ""}" data-abs-credit-id="${escapeAttribute(approval.id)}" type="button">
          <strong>${escapeHtml(scope)} · ${escapeHtml(scopeName || "范围待补")}</strong>
          <span>${escapeHtml(facts)}</span>
        </button>
      `;
    }).join("")
    : enhancerIssuerId
      ? '<div class="empty compact">该主体暂无 50217 批单，可新增单项目批或储架批。</div>'
      : '<div class="empty compact">请先选择主体。</div>';
  $$("[data-abs-credit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      fillAbsCreditApprovalForm((state.absCreditApprovals || []).find((item) => item.id === button.dataset.absCreditId));
    });
  });
}

function readAbsCreditApprovalForm() {
  const enhancerIssuerId = $("#issuerId")?.value || $("#absCreditEnhancerIssuerId").value;
  const enhancer = (state.issuers || []).find((issuer) => issuer.id === enhancerIssuerId);
  return normalizeAbsCreditApproval({
    id: $("#absCreditApprovalId").value || undefined,
    businessCode: ABS_CREDIT_CODE,
    enhancerIssuerId,
    enhancerName: enhancer?.legalName || "",
    approvalNo: $("#absCreditApprovalNo").value,
    approvalLevel: $("#absCreditApprovalLevel").value,
    scopeType: $("#absCreditScopeType").value,
    projectName: $("#absCreditProjectName").value,
    shelfName: $("#absCreditShelfName").value,
    approvedAmount: $("#absCreditApprovedAmount").value,
    approvedRatio: $("#absCreditApprovedRatio").value,
    investmentTermText: $("#absCreditInvestmentTermText").value,
    rawText: $("#absCreditRawText").value,
    linkedProjectIds: (state.absCreditApprovals || []).find((item) => item.id === $("#absCreditApprovalId").value)?.linkedProjectIds || [],
    linkedProjectNames: (state.absCreditApprovals || []).find((item) => item.id === $("#absCreditApprovalId").value)?.linkedProjectNames || [],
  });
}

function clearAbsCreditApprovalForm({ showForm = false } = {}) {
  const form = $("#absCreditApprovalForm");
  if (!form) return;
  form.reset();
  form.hidden = !showForm;
  $("#absCreditApprovalId").value = "";
  $("#absCreditEnhancerIssuerId").value = $("#issuerId")?.value || "";
  $("#absCreditApprovalLevel").value = "总行";
  $("#absCreditScopeType").value = ABS_CREDIT_SCOPE_PROJECT;
  $("#absCreditApprovalFormTitle").textContent = "新增 50217 批单";
  $("#deleteAbsCreditApprovalButton").hidden = true;
  syncAbsCreditScopeFields();
  renderAbsCreditApprovalList();
}

function fillAbsCreditApprovalForm(input) {
  if (!input) return clearAbsCreditApprovalForm();
  const approval = normalizeAbsCreditApproval(input);
  renderAbsCreditEnhancerOptions();
  $("#absCreditApprovalForm").hidden = false;
  $("#absCreditApprovalId").value = approval.id;
  $("#absCreditEnhancerIssuerId").value = approval.enhancerIssuerId;
  $("#absCreditApprovalNo").value = approval.approvalNo;
  $("#absCreditApprovalLevel").value = approval.approvalLevel;
  $("#absCreditScopeType").value = approval.scopeType;
  $("#absCreditProjectName").value = approval.projectName;
  $("#absCreditShelfName").value = approval.shelfName;
  $("#absCreditApprovedAmount").value = approval.approvedAmount ?? "";
  $("#absCreditApprovedRatio").value = approval.approvedRatio ?? "";
  $("#absCreditInvestmentTermText").value = approval.investmentTermText;
  $("#absCreditRawText").value = approval.rawText;
  $("#absCreditApprovalFormTitle").textContent = approval.approvalNo
    ? `编辑批单：${approval.approvalNo}`
    : `编辑${approval.scopeType === ABS_CREDIT_SCOPE_SHELF ? "储架批" : "单项目批"}`;
  $("#deleteAbsCreditApprovalButton").hidden = false;
  syncAbsCreditScopeFields();
  renderAbsCreditApprovalList();
}

function syncAbsCreditScopeFields() {
  const shelf = $("#absCreditScopeType")?.value === ABS_CREDIT_SCOPE_SHELF;
  if ($("#absCreditProjectNameField")) $("#absCreditProjectNameField").hidden = shelf;
  if ($("#absCreditShelfNameField")) $("#absCreditShelfNameField").hidden = !shelf;
  if ($("#absCreditProjectName")) $("#absCreditProjectName").required = !shelf;
  if ($("#absCreditShelfName")) $("#absCreditShelfName").required = shelf;
}

function issuerCommonSummary(issuer) {
  const rating = issuer.subjectRating
    ? `${issuer.subjectRating}${issuer.ratingAgency ? `(${issuer.ratingAgency})` : ""}`
    : "主体评级待补";
  const branch = issuer.linkedBranch || issuer.defaultBranch || "";
  return `${branch ? `联动${branch} / ` : ""}${rating} / 隐含${issuer.hiddenRating || "待补"}`;
}

function renderIssuerOptions() {
  issuerSearchEntries = buildIssuerSearchIndex(state.issuers || []);
  $("#issuerSelect").value = selectedIssuerId;
  $("#issuerSearchInput").value = "";
  syncIssuerPickerSelection();
  if (issuerPickerOpen) renderIssuerPickerResults();
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

function issuerHasOrdinaryCredit(issuer) {
  const credit = issuer?.credit || {};
  return [
    credit.approvalLevel,
    credit.approvedAmount,
    credit.privateAmount,
    credit.offeringType,
    credit.approvedRatio,
    credit.privateRatio,
    credit.investmentTermText,
    credit.rawText,
  ].some((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function selectIssuerCreditModule(module) {
  const issuerId = $("#issuerId")?.value || "";
  if (module === "50217" && !issuerId) {
    showToast("请先保存主体，再新增该主体名下的 50217 批单。");
    return;
  }
  databaseCreditModule = ["50206", "50217"].includes(module) ? module : "";
  if (databaseCreditModule === "50217") clearAbsCreditApprovalForm();
  syncIssuerCreditWorkspace();
}

function syncIssuerCreditWorkspace() {
  const issuerId = $("#issuerId")?.value || "";
  const issuer = (state.issuers || []).find((item) => item.id === issuerId) || null;
  const creating = !issuer && databaseCreditModule === "50206";
  const absCount = issuer
    ? (state.absCreditApprovals || []).filter((approval) => approval.enhancerIssuerId === issuer.id).length
    : 0;
  const empty = $("#issuerWorkspaceEmpty");
  $("#issuerWorkspaceTitle").textContent = issuer?.legalName || (creating ? "新增主体" : "请选择主体");
  $("#issuerWorkspaceStatus").textContent = issuer
    ? `50206 ${issuerHasOrdinaryCredit(issuer) ? "已录入" : "未录入"} · 50217 ${absCount} 张`
    : creating ? "先建立主体，再分别维护授信" : "以主体为入口维护授信";
  $("#issuerCreditChooser").hidden = !issuer;
  if (empty) {
    empty.hidden = Boolean(issuer || creating);
    if (issuer && !databaseCreditModule) {
      empty.hidden = false;
      empty.innerHTML = `
        <strong>选择要维护的授信代码</strong>
        <span>50206 用于普通信用债且每个主体仅一张；50217 用于 ABS，同一主体可以有多张项目批或储架批。</span>
      `;
    } else if (!issuer && !creating) {
      empty.innerHTML = `
        <strong>先从左侧选择一个主体</strong>
        <span>进入主体后，可分别维护普通信用债 50206，或查看该主体名下的全部 ABS 50217 批单。</span>
      `;
    }
  }
  $$('[data-issuer-credit-module]').forEach((button) => {
    const active = button.dataset.issuerCreditModule === databaseCreditModule;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#issuer50206Status").textContent = issuerHasOrdinaryCredit(issuer) ? "已录入 · 点击查看或修改" : "未录入 · 点击新增";
  $("#issuer50217Status").textContent = absCount ? `${absCount} 张批单 · 点击查看` : "暂无批单 · 点击新增";
  $("#issuerForm").hidden = databaseCreditModule !== "50206";
  $("#absCreditLibraryPanel").hidden = databaseCreditModule !== "50217" || !issuer;
  renderAbsCreditEnhancerOptions();
  if (databaseCreditModule === "50217") renderAbsCreditApprovalList();
}

function clearIssuerForm({ openEditor = true } = {}) {
  $("#issuerForm").reset();
  $("#issuerId").value = "";
  $("#issuerFormTitle").textContent = "新增主体与 50206 授信";
  $("#deleteIssuerButton").hidden = true;
  databaseCreditModule = openEditor ? "50206" : "";
  clearAbsCreditApprovalForm();
  syncIssuerCreditWorkspace();
  renderIssuerList();
}

function fillIssuerForm(issuer, { module = "" } = {}) {
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
  databaseCreditModule = module;
  clearAbsCreditApprovalForm();
  syncIssuerCreditWorkspace();
  renderIssuerList();
}

function bindDataActions() {
  $("#saveCloudButton").addEventListener("click", async () => {
    const ok = await saveCloudState({ source: "manual", markChange: false });
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
      persistState({ source: "import" });
      renderIssuerOptions();
      renderIssuerList();
      renderAbsCreditEnhancerOptions();
      renderAbsCreditApprovalList();
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

function bindStateHistory() {
  $("#stateHistoryButton").addEventListener("click", (event) => openStateHistory(event.currentTarget));
  $("#stateHistoryCloseButton").addEventListener("click", closeStateHistory);
  $("#stateHistoryPanel").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeStateHistory();
  });
  $("#stateHistoryList").addEventListener("click", (event) => {
    const card = event.target.closest("[data-state-snapshot-id]");
    if (card) void selectStateSnapshot(card.dataset.stateSnapshotId);
  });
  $("#stateHistoryDetail").addEventListener("click", (event) => {
    if (event.target.closest("[data-download-state-snapshot]")) downloadSelectedStateSnapshot();
    if (event.target.closest("[data-revert-state-snapshot]")) void revertSelectedStateSnapshot();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#stateHistoryPanel").hidden) closeStateHistory();
  });
}

async function openStateHistory(trigger = null) {
  stateHistoryTrigger = trigger || document.activeElement;
  $("#stateHistoryPanel").hidden = false;
  syncModalOpenState();
  $(".state-history-dialog")?.focus({ preventScroll: true });
  await loadStateHistory();
}

function closeStateHistory() {
  $("#stateHistoryPanel").hidden = true;
  syncModalOpenState();
  stateHistoryTrigger?.focus?.({ preventScroll: true });
  stateHistoryTrigger = null;
}

async function loadStateHistory({ selectId = stateHistorySelectedId } = {}) {
  $("#stateHistoryList").innerHTML = '<div class="empty-state"><strong>正在读取版本历史...</strong></div>';
  try {
    const response = await fetch(`${STATE_HISTORY_URL}?limit=50`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    stateHistoryEntries = payload.snapshots || [];
    renderStateHistoryList();
    const targetId = selectId && stateHistoryEntries.some((entry) => entry.id === selectId)
      ? selectId
      : stateHistoryEntries[0]?.id;
    if (targetId) await selectStateSnapshot(targetId);
  } catch (error) {
    $("#stateHistoryList").innerHTML = `<div class="empty-state"><strong>版本历史读取失败</strong><span>${escapeHtml(error.message || "请稍后重试")}</span></div>`;
  }
}

function renderStateHistoryList() {
  if (!stateHistoryEntries.length) {
    $("#stateHistoryList").innerHTML = '<div class="empty-state"><strong>暂无版本快照</strong></div>';
    return;
  }
  $("#stateHistoryList").innerHTML = stateHistoryEntries.map((entry) => {
    const current = entry.status === "accepted" && entry.revision === cloudRevision;
    const badgeClass = entry.status === "conflict" ? "conflict" : current ? "current" : "";
    const badge = entry.status === "conflict" ? "冲突副本" : current ? "当前版本" : `版本 ${entry.revision}`;
    const title = entry.status === "conflict"
      ? `来自版本 ${entry.baseRevision ?? "未知"} 的候选`
      : `版本 ${entry.revision}`;
    return `
      <button class="state-history-card ${entry.status === "conflict" ? "conflict" : ""} ${entry.id === stateHistorySelectedId ? "active" : ""}" type="button" data-state-snapshot-id="${escapeAttribute(entry.id)}">
        <span class="state-history-card-head">
          <strong>${escapeHtml(title)}</strong>
          <span class="state-history-badge ${badgeClass}">${escapeHtml(badge)}</span>
        </span>
        <span class="state-history-card-summary">${escapeHtml(formatStateChangeSummary(entry.summary))}</span>
        <span class="state-history-card-meta">
          <span>${escapeHtml(formatStateSnapshotTime(entry.savedAt))}</span>
          <span>${escapeHtml(entry.clientLabel || stateSaveReasonLabel(entry.saveReason))}</span>
        </span>
      </button>
    `;
  }).join("");
}

async function selectStateSnapshot(snapshotId) {
  stateHistorySelectedId = snapshotId;
  stateHistorySelectedSnapshot = null;
  renderStateHistoryList();
  $("#stateHistoryDetail").innerHTML = '<div class="empty-state"><strong>正在读取快照...</strong></div>';
  try {
    const response = await fetch(`${STATE_HISTORY_URL}/${encodeURIComponent(snapshotId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    stateHistorySelectedSnapshot = payload.snapshot;
    renderStateHistoryDetail(payload.snapshot);
  } catch (error) {
    $("#stateHistoryDetail").innerHTML = `<div class="empty-state"><strong>快照读取失败</strong><span>${escapeHtml(error.message || "请稍后重试")}</span></div>`;
  }
}

function renderStateHistoryDetail(snapshot) {
  const current = snapshot.status === "accepted" && snapshot.revision === cloudRevision;
  const title = snapshot.status === "conflict"
    ? "冲突候选快照"
    : current ? `当前版本 ${snapshot.revision}` : `历史版本 ${snapshot.revision}`;
  const groups = stateHistoryChangeGroups(snapshot.summary);
  $("#stateHistoryDetail").innerHTML = `
    <div class="state-history-detail-content">
      <div>
        <span class="step">${snapshot.status === "conflict" ? "CONFLICT" : "SNAPSHOT"}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="state-history-detail-meta">
        <div><span>保存时间</span><strong>${escapeHtml(formatStateSnapshotTime(snapshot.savedAt))}</strong></div>
        <div><span>保存来源</span><strong>${escapeHtml(snapshot.clientLabel || "未标记设备")} · ${escapeHtml(stateSaveReasonLabel(snapshot.saveReason))}</strong></div>
        <div><span>基于版本</span><strong>${snapshot.baseRevision ?? "初始版本"}</strong></div>
        <div><span>快照大小</span><strong>${escapeHtml(formatStateSnapshotBytes(snapshot.byteSize))}</strong></div>
      </div>
      <div class="state-history-changes">
        ${groups.length ? groups.map((group) => `
          <div class="state-history-change-group">
            <span>${escapeHtml(group.label)}</span>
            <strong>${escapeHtml(group.counts)}</strong>
            ${group.items ? `<div class="state-history-change-items">${escapeHtml(group.items)}</div>` : ""}
          </div>
        `).join("") : '<div class="state-history-change-group"><strong>内容无变化</strong></div>'}
      </div>
      ${snapshot.status === "conflict" ? '<p class="form-note danger">该快照来自过期 revision，已被安全保留，但从未覆盖云端当前版本。</p>' : ""}
      <div class="state-history-detail-actions">
        <button class="button subtle" type="button" data-download-state-snapshot>导出此快照</button>
        <button class="button primary" type="button" data-revert-state-snapshot>${current ? "重新载入此版本" : "回溯为当前版本"}</button>
      </div>
    </div>
  `;
}

function stateHistoryChangeGroups(summary = {}) {
  const labels = {
    issuers: "主体库",
    absCreditApprovals: "50217 批单",
    projects: "项目台账",
    protocolTransfers: "协议转让",
    secondaryInventoryPositions: "二级库存",
    secondaryOrders: "二级挂单",
    secondaryTrades: "二级成交",
  };
  const groups = Object.entries(labels).flatMap(([key, label]) => {
    const change = summary?.collections?.[key] || {};
    const counts = [];
    if (change.added) counts.push(`新增 ${change.added}`);
    if (change.updated) counts.push(`修改 ${change.updated}`);
    if (change.removed) counts.push(`删除 ${change.removed}`);
    if (!counts.length) return [];
    return [{
      label,
      counts: counts.join(" / "),
      items: (change.items || []).map((item) => `${stateChangeTypeLabel(item.type)} ${item.label}`).join("、"),
    }];
  });
  if (summary?.settings?.length) {
    groups.push({ label: "其他设置", counts: summary.settings.map((item) => item.label).join("、") + "有改动", items: "" });
  }
  return groups;
}

function downloadSelectedStateSnapshot() {
  const snapshot = stateHistorySelectedSnapshot;
  if (!snapshot?.data) return;
  const blob = new Blob([JSON.stringify(snapshot.data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `credit-bond-snapshot-${snapshot.revision ?? "conflict"}-${snapshot.savedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function revertSelectedStateSnapshot() {
  const snapshot = stateHistorySelectedSnapshot;
  if (!snapshot) return;
  const confirmed = window.confirm("确定使用这个快照创建新的当前版本吗？现有版本会保留在历史中。");
  if (!confirmed) return;
  try {
    const response = await fetch(`${STATE_HISTORY_URL}/${encodeURIComponent(snapshot.id)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        action: "revert",
        expectedRevision: cloudRevision,
        meta: stateSaveMeta("revert"),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) handleStateConflict(payload);
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    state = normalizeLoadedState(payload.data);
    cloudRevision = Number(payload.revision || 0);
    localBaseRevision = cloudRevision;
    cloudUpdatedAt = payload.updatedAt || state.updatedAt || null;
    localStateDirty = false;
    localDirtyAt = null;
    syncConflictActive = false;
    cloudAvailable = true;
    persistLocal();
    renderStateDependentViews();
    setCloudGate(false, { state: "success" });
    setSyncStatus("D1 已回溯", `云端版本 ${cloudRevision} 已确认`);
    showToast(`已创建云端版本 ${cloudRevision}，原版本仍保留。`);
    await loadStateHistory({ selectId: payload.snapshot?.id || snapshot.id });
  } catch (error) {
    showToast(`回溯失败：${error.message}`);
  }
}

function stateSaveReasonLabel(reason) {
  return ({
    autosave: "自动保存",
    manual: "手动同步",
    import: "导入资料库",
    idle: "空闲退出保存",
    revert: "版本回溯",
    migration: "历史迁移",
  })[reason] || "保存";
}

function stateChangeTypeLabel(type) {
  return ({ added: "新增", updated: "修改", removed: "删除" })[type] || "变更";
}

function formatStateSnapshotTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatStateSnapshotBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024, 1)} KB`;
  return `${round(bytes / 1024 / 1024, 2)} MB`;
}

function initializeIdleExit() {
  if (isLocalApiMode()) {
    $("#idleLogoutDetail").textContent = "本地开发模式不会自动退出";
    return;
  }
  if ("BroadcastChannel" in window) {
    bondActivityChannel = new BroadcastChannel("tempest07-bond-centre-activity");
    bondActivityChannel.addEventListener("message", (event) => {
      if (event.data?.type === "activity" && Number.isFinite(event.data.at)) {
        registerIdleActivity({ at: event.data.at, broadcast: false });
      }
    });
  }
  ["pointerdown", "keydown", "input", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, () => registerIdleActivity(), { passive: true });
  });
  window.addEventListener("focus", () => registerIdleActivity());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) registerIdleActivity();
  });
  window.addEventListener("pagehide", flushProjectDraftToLocal);
  $("#idleContinueButton").addEventListener("click", () => registerIdleActivity());
  $("#idleExitNowButton").addEventListener("click", () => void performIdleSaveAndLogout());
  scheduleIdleWarning();
}

function registerIdleActivity({ at = Date.now(), broadcast = true } = {}) {
  if (idleExitInProgress) return;
  idleLastActivityAt = Math.max(idleLastActivityAt, at);
  hideIdleWarning();
  scheduleIdleWarning();
  if (broadcast) bondActivityChannel?.postMessage({ type: "activity", at: idleLastActivityAt });
}

function scheduleIdleWarning() {
  clearTimeout(idleWarningTimer);
  const remaining = Math.max(1000, IDLE_WARNING_AFTER_MS - (Date.now() - idleLastActivityAt));
  idleWarningTimer = setTimeout(showIdleWarning, remaining);
}

function showIdleWarning() {
  if (idleExitInProgress || !getCurrentUser()) return scheduleIdleWarning();
  if (document.hidden || !document.hasFocus()) {
    idleWarningTimer = setTimeout(showIdleWarning, 60_000);
    return;
  }
  idleCountdownRemaining = IDLE_EXIT_COUNTDOWN_SECONDS;
  $("#idleExitTitle").textContent = "即将自动保存并退出";
  $("#idleExitCountdown").textContent = String(idleCountdownRemaining);
  $("#idleContinueButton").disabled = false;
  $("#idleExitNowButton").disabled = false;
  $("#idleExitPanel").hidden = false;
  syncModalOpenState();
  clearInterval(idleCountdownTimer);
  idleCountdownTimer = setInterval(() => {
    idleCountdownRemaining -= 1;
    $("#idleExitCountdown").textContent = String(Math.max(0, idleCountdownRemaining));
    if (idleCountdownRemaining <= 0) void performIdleSaveAndLogout();
  }, 1000);
}

function hideIdleWarning() {
  clearInterval(idleCountdownTimer);
  idleCountdownTimer = null;
  if ($("#idleExitPanel")) $("#idleExitPanel").hidden = true;
  syncModalOpenState();
}

function flushProjectDraftToLocal() {
  if (!projectAutoSaveTimer) return;
  clearTimeout(projectAutoSaveTimer);
  projectAutoSaveTimer = null;
  saveProjectDraftNow();
}

async function flushStateBeforeIdleExit() {
  flushProjectDraftToLocal();
  const pendingSaved = await saveSecondaryPendingDraft({ silent: true });
  if (!pendingSaved) return false;
  const ledgerSaved = await saveSecondaryLedgerDraft({ silent: true });
  if (!ledgerSaved) return false;
  return saveCloudState({ source: "idle", markChange: false });
}

async function performIdleSaveAndLogout() {
  if (idleExitInProgress || isLocalApiMode()) return;
  idleExitInProgress = true;
  clearTimeout(idleWarningTimer);
  clearInterval(idleCountdownTimer);
  $("#idleExitTitle").textContent = "正在保存并安全退出";
  $("#idleExitCountdown").textContent = "…";
  $("#idleContinueButton").disabled = true;
  $("#idleExitNowButton").disabled = true;
  setSyncStatus("正在保存", "等待云端版本确认后退出");

  try {
    const saved = await flushStateBeforeIdleExit();
    if (!saved || syncConflictActive) throw new Error("云端保存未确认；已暂停自动退出，数据仍保留在本机");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || "统一退出失败");
    location.replace("/login/?next=%2Fbond-centre%2F");
  } catch (error) {
    idleExitInProgress = false;
    $("#idleExitTitle").textContent = "自动退出已暂停";
    $("#idleExitCountdown").textContent = "!";
    $("#idleContinueButton").disabled = false;
    $("#idleExitNowButton").disabled = false;
    showToast(error.message || "自动退出失败，请稍后重试。");
    idleLastActivityAt = Date.now();
    scheduleIdleWarning();
  }
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
    const remoteState = remote.data?.issuers ? normalizeLoadedState(remote.data) : structuredClone(DEFAULT_STATE);
    const remoteRevision = Number(remote.revision || 0);
    const localCandidate = state;
    const preserveDirtyLocal = localStateDirty && !statePayloadEquals(localCandidate, remoteState);
    const migrationSource = preserveDirtyLocal ? localCandidate : remote.data;
    const shouldMigrateFtpCurve = ftpCurveNeedsMigration(migrationSource?.ftpCurve);
    const shouldMigrateIssuerBranch = issuerBranchNeedsMigration(migrationSource);
    const shouldMigrateCreditModel = creditModelNeedsMigration(migrationSource);
    cloudRevision = remoteRevision;
    cloudUpdatedAt = remote.updatedAt || remoteState.updatedAt || null;
    if (!preserveDirtyLocal) {
      state = remoteState;
      localBaseRevision = remoteRevision;
      localStateDirty = false;
      localDirtyAt = null;
    }
    if (remote.user) {
      setCurrentUser(remote.user);
      updateAuthUi();
    }
    cloudAvailable = true;
    persistLocal();
    setSyncStatus(
      preserveDirtyLocal ? "发现本机待同步数据" : isLocalApiMode() ? "本地 D1 已连接" : "D1 已连接",
      preserveDirtyLocal
        ? `正在基于云端版本 ${localBaseRevision} 安全上传；不会直接覆盖版本 ${remoteRevision}`
        : `${state.issuers.length} 个主体 / ${(state.absCreditApprovals || []).length} 张 50217 / ${(state.projects || []).length} 个项目`,
    );
    setCloudGate(true, {
      state: preserveDirtyLocal ? "connecting" : "success",
      title: preserveDirtyLocal ? "正在保护并上传本机数据" : isLocalApiMode() ? "本地 D1 连接成功" : "D1 连接成功",
      detail: preserveDirtyLocal
        ? "检测到尚未确认的本机副本。系统将使用 revision 校验；若云端已变化，本机内容会保留为冲突快照。"
        : `已载入 ${state.issuers.length} 个主体 / ${(state.absCreditApprovals || []).length} 张 50217 / ${(state.projects || []).length} 个项目。`,
    });
    renderStateDependentViews();
    if (preserveDirtyLocal) {
      await saveCloudState({ source: "autosave", markChange: false });
    } else {
      window.setTimeout(() => {
        setCloudGate(false, { state: "success" });
        restoreLedgerMobileViewport();
      }, 850);
      if (shouldMigrateFtpCurve || shouldMigrateIssuerBranch || shouldMigrateCreditModel) {
        await saveCloudState({ source: "autosave", markChange: true });
      }
    }
  } catch (error) {
    cloudAvailable = false;
    setSyncStatus(isLocalApiMode() ? "本地 D1 未连接" : "D1 未连接", isLocalApiMode() ? "请确认本地 wrangler 正在运行" : "请检查登录状态或重新登录");
    setCloudGate(true, {
      state: "error",
      title: isLocalApiMode() ? "本地 D1 连接失败" : "D1 连接失败",
      detail: isLocalApiMode() ? "请确认 npm run dev:local 仍在运行。" : `D1 暂时无法连接，本机副本仍保留。${error?.message ? `（${error.message}）` : ""}`,
    });
  }
  renderStateDependentViews();
}

function renderStateDependentViews() {
  renderIssuerOptions();
  renderIssuerList();
  renderAbsCreditEnhancerOptions();
  renderAbsCreditApprovalList();
  renderAbsCreditApprovalOptions();
  renderFtpCurveForm();
  renderProjectWorkspace();
  renderProtocolTransferWorkspace();
  renderSecondaryInventoryWorkspace();
  renderUnifiedReminders();
  if (batchItems.length) renderBatchResults();
}

function saveCloudState({ source = "autosave", markChange = true } = {}) {
  if (syncConflictActive) return Promise.resolve(false);
  if (markChange) markLocalStateDirty();
  persistLocal();
  const snapshot = structuredClone(state);
  const generation = localChangeGeneration;
  cloudSaveQueue = cloudSaveQueue
    .catch(() => false)
    .then(() => syncConflictActive ? false : saveCloudStateSnapshot(snapshot, { generation, source }));
  return cloudSaveQueue;
}

async function saveCloudStateSnapshot(snapshot, { generation, source }) {
  try {
    setSyncStatus("正在上传", `基于云端版本 ${localBaseRevision} 保存本机修改`);
    const response = await fetch(API_URL, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        data: snapshot,
        expectedRevision: localBaseRevision,
        meta: stateSaveMeta(source),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        clearAuthSession();
        redirectToGatewayLogin();
      }
      if (response.status === 409) {
        handleStateConflict(payload);
        return false;
      }
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    cloudRevision = Number(payload.revision || cloudRevision || 0);
    cloudUpdatedAt = payload.updatedAt || cloudUpdatedAt;
    localBaseRevision = cloudRevision;
    activeStateSnapshotId = payload.snapshot?.id || activeStateSnapshotId;
    if (localChangeGeneration === generation) {
      localStateDirty = false;
      localDirtyAt = null;
    }
    cloudAvailable = true;
    persistLocal();
    setSyncStatus(
      localStateDirty ? "本机仍有待同步修改" : isLocalApiMode() ? "本地 D1 已同步" : "D1 已确认",
      localStateDirty ? `云端版本 ${cloudRevision} 已确认，继续上传较新的本机修改` : `云端版本 ${cloudRevision} · ${formatStateSnapshotTime(cloudUpdatedAt)}`,
    );
    setCloudGate(false, { state: "success" });
    if ($("#projectAutosaveStatus") && !$("#projectForm")?.hidden) {
      $("#projectAutosaveStatus").textContent = localStateDirty ? "已保存到本机，正在上传" : "云端已确认";
    }
    return true;
  } catch (error) {
    cloudAvailable = false;
    localStateDirty = true;
    persistLocal();
    setSyncStatus("D1 同步失败", error.message || "请检查网络或登录状态");
    setCloudGate(true, {
      state: "error",
      title: "D1 同步失败",
      detail: `${error.message || "请检查网络或登录状态"}。本机数据仍保留，可导出备份或重试同步。`,
    });
    return false;
  }
}

function handleStateConflict(payload = {}) {
  syncConflictActive = true;
  cloudAvailable = false;
  cloudRevision = Number(payload.revision || cloudRevision || 0);
  cloudUpdatedAt = payload.updatedAt || cloudUpdatedAt;
  localStateDirty = true;
  persistLocal();
  setSyncStatus("检测到版本冲突", `云端当前为版本 ${cloudRevision}；本机内容已保留为冲突快照`);
  setCloudGate(true, {
    state: "error",
    title: "另一来源已先保存",
    detail: "本机内容没有覆盖云端，且已保留为冲突快照。请打开“版本历史”查看改动，并选择要恢复为当前版本的快照。",
  });
  if ($("#projectAutosaveStatus")) $("#projectAutosaveStatus").textContent = "存在冲突，已保留快照";
}

function persistState({ source = "autosave" } = {}) {
  markLocalStateDirty();
  persistLocal();
  if (cloudAvailable) void saveCloudState({ source, markChange: false });
}

function markLocalStateDirty() {
  state.updatedAt = new Date().toISOString();
  localStateDirty = true;
  localDirtyAt = state.updatedAt;
  localChangeGeneration += 1;
}

function loadLocalState() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (value?.cacheVersion === LOCAL_CACHE_VERSION && value.data?.issuers) {
      return {
        data: normalizeLoadedState(value.data),
        dirty: Boolean(value.dirty),
        baseRevision: Number.isInteger(value.baseRevision) ? value.baseRevision : 0,
        dirtyAt: value.dirtyAt || null,
      };
    }
    if (value?.issuers) {
      return {
        data: normalizeLoadedState(value),
        dirty: true,
        baseRevision: 0,
        dirtyAt: value.updatedAt || new Date().toISOString(),
      };
    }
  } catch {
    // Fall through to an empty local cache.
  }
  return { data: structuredClone(DEFAULT_STATE), dirty: false, baseRevision: 0, dirtyAt: null };
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
    version: 5,
    issuers: (value.issuers || []).filter((issuer) => issuer?.legalName).map(normalizeIssuer),
    absCreditApprovals: (value.absCreditApprovals || [])
      .filter((approval) => !approval?.businessCode || String(approval.businessCode).trim() === ABS_CREDIT_CODE)
      .map(normalizeAbsCreditApproval),
    ftpCurve: normalizeFtpCurve(value.ftpCurve),
    projects: (value.projects || []).map(normalizeProjectRecord),
    protocolTransfers: normalizeProtocolTransfers(value.protocolTransfers || []),
    secondaryInventoryPositions: normalizeSecondaryInventoryPositions(value.secondaryInventoryPositions || []),
    secondaryOrders: normalizeSecondaryOrders(value.secondaryOrders || []),
    secondaryTrades: normalizeSecondaryTrades(value.secondaryTrades || []),
    reminderState: normalizeReminderState(value.reminderState),
  };
}

function creditModelNeedsMigration(data = {}) {
  return Number(data.version || 0) < 5
    || !Array.isArray(data.absCreditApprovals)
    || (data.issuers || []).some((issuer) => issuer?.credit?.businessCode !== ORDINARY_CREDIT_CODE);
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
  localStorage.setItem(LOCAL_KEY, JSON.stringify({
    cacheVersion: LOCAL_CACHE_VERSION,
    data: state,
    dirty: localStateDirty,
    baseRevision: localBaseRevision,
    dirtyAt: localDirtyAt,
  }));
}

function setSyncStatus(status, detail) {
  $("#syncStatus").textContent = status;
  $("#syncDetail").textContent = detail;
  const revision = $("#syncRevision");
  if (revision) {
    const dirtyLabel = syncConflictActive ? " · 存在冲突" : localStateDirty ? " · 本机待同步" : " · 云端已确认";
    revision.textContent = `云端版本 ${cloudRevision}${dirtyLabel}`;
  }
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
  $("#saveCloudButton").disabled = Boolean(locked) && (stateName !== "error" || syncConflictActive);
  $("#exportDataButton").disabled = Boolean(locked) && stateName !== "error";
  $("#importDataInput").disabled = Boolean(locked);
  $("#importDataInput").closest(".file-button")?.classList.toggle("unavailable", Boolean(locked));
  const gatewayLoginLink = $("#gatewayLoginLink");
  if (gatewayLoginLink) gatewayLoginLink.hidden = !locked || isLocalApiMode() || stateName === "success" || stateName === "connecting";
  if (config.title) $("#cloudGateTitle").textContent = config.title;
  if (config.detail) $("#cloudGateDetail").textContent = config.detail;
  $("#cloudGateStep").textContent = stateName === "error" ? "ERR" : stateName === "success" ? "OK" : stateName === "connecting" ? "WAIT" : "LOGIN";
  $("#cloudGateSymbol").textContent = stateName === "error" ? "!" : stateName === "success" ? "✓" : stateName === "connecting" ? "..." : "T7";
}

function loadStateClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID ? crypto.randomUUID() : randomClientId();
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return randomClientId();
  }
}

function randomClientId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stateSaveMeta(source) {
  return {
    source,
    clientId: stateClientId,
    clientLabel: stateClientLabel(),
  };
}

function stateClientLabel() {
  if (navigator.userAgent.includes("Tempest07Android/")) return "Bond Centre Android";
  if (/Windows/i.test(navigator.userAgent)) return "Windows 浏览器";
  if (/Macintosh|Mac OS/i.test(navigator.userAgent)) return "Mac 浏览器";
  if (/iPhone|iPad/i.test(navigator.userAgent)) return "iOS 浏览器";
  return "浏览器";
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

void initialize().catch((error) => {
  console.error("Bond Centre initialization failed", error);
  setSyncStatus("加载失败", "请刷新页面重试");
  setCloudGate(true, {
    state: "error",
    title: "页面加载失败",
    detail: "请刷新页面重试。",
  });
});
