const DEFAULT_ENDPOINT = "./api/dm/realtime-quotes";
const DEFAULT_VALUATION_ENDPOINT = "./api/dm/realtime-valuations";
const STORAGE_KEY = "credit-bond-process-realtime-watchlist-v2";
const LEGACY_STORAGE_KEY = "credit-bond-process-realtime-watchlist-v1";
const COLUMN_STORAGE_KEY = "credit-bond-process-realtime-columns-v1";
const DEFAULT_INTERVAL_MS = 20_000;
const VALUATION_REFRESH_MS = 15 * 60_000;
const VALUATION_RETRY_MS = 60_000;
const CHANGE_HIGHLIGHT_MS = 6_000;
const SUPPORTED_INTERVALS = new Set([15_000, 20_000, 30_000]);
const MAX_SECURITIES = 200;
const MAX_CHANGE_HISTORY = 8;

const COLUMN_DEFINITIONS = [
  { id: "identity", label: "债券", width: 240, required: true, sortValue: (row) => row.shortName || row.query || "" },
  { id: "tenor", label: "剩余期限", width: 78, sortValue: (row) => tenorYears(row.remainingTenor) },
  { id: "chinaBond", label: "中债估值", width: 128, sortValue: (row) => row.valuation?.chinaBond?.yield },
  { id: "chinaSecurities", label: "中证估值", width: 128, sortValue: (row) => row.valuation?.chinaSecurities?.yield },
  { id: "source", label: "行情源", width: 88, sortValue: (row) => row.source || "" },
  { id: "bidVolume", label: "买量（万）", width: 86, tone: "bid", sortValue: (row) => row.bid?.volumeWan },
  { id: "bid", label: "BID", width: 120, tone: "bid", sortValue: (row) => primaryQuoteValue(row.bid) },
  { id: "spread", label: "价差", width: 72, sortValue: (row) => row.spread?.yieldPct ?? row.spread?.netPrice },
  { id: "ofr", label: "OFR", width: 120, tone: "ofr", sortValue: (row) => primaryQuoteValue(row.ofr) },
  { id: "ofrVolume", label: "卖量（万）", width: 86, tone: "ofr", sortValue: (row) => row.ofr?.volumeWan },
  { id: "target", label: "我的目标", width: 150, sortValue: (row, controller) => firstTargetValue(controller.watchItemForRow(row)) },
  { id: "quoteTime", label: "报价时间", width: 106, sortValue: (row) => `${row.quoteDate || ""} ${row.quoteTime || ""}` },
];

const COLUMN_BY_ID = new Map(COLUMN_DEFINITIONS.map((column) => [column.id, column]));
const DEFAULT_COLUMN_ORDER = COLUMN_DEFINITIONS.map((column) => column.id);

export function initializeRealtimeQuotes(options = {}) {
  const root = document.querySelector('[data-view="realtime-quotes"]');
  if (!root) return { setActive() {}, destroy() {} };
  return new RealtimeQuoteController(root, options);
}

export function parseRealtimeQuoteImportText(value = "") {
  return parseRealtimeQuoteImportEntries(value).map((item) => item.query);
}

export function parseRealtimeQuoteImportEntries(value = "") {
  const entries = [];
  const lines = String(value || "").replace(/\r/g, "\n").split(/[\n;；]+/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isImportHeaderLine(line)) continue;
    const codes = line.match(/(?<!\d)\d{6,12}(?:\.(?:IB|SH|SZ))?(?![\dA-Z])/gi) || [];
    const side = detectIntentSide(line);
    const target = side ? detectIntentTarget(line, side) : null;
    const alert = target ? { side, metric: target.metric, target: target.value } : null;

    if (codes.length) {
      const label = extractImportLabel(line, codes[0]);
      for (const code of codes) entries.push({ query: cleanImportToken(code), label, alerts: alert ? [alert] : [] });
      continue;
    }
    if (side) {
      const query = extractImportLabel(line);
      if (query && !isObviousNonBondImportCandidate(query)) entries.push({ query, label: query, alerts: alert ? [alert] : [] });
      continue;
    }
    const hasDelimitedCells = /[\t,，]/.test(line);
    const cells = line.split(hasDelimitedCells ? /[\t,，]+/ : /\s+/).map(cleanImportToken).filter(Boolean);
    for (const candidate of cells) {
      if (!isObviousNonBondImportCandidate(candidate)) entries.push({ query: candidate, label: "", alerts: [] });
    }
  }
  return mergeWatchItems([], entries).slice(0, MAX_SECURITIES);
}

class RealtimeQuoteController {
  constructor(root, options = {}) {
    this.root = root;
    this.endpoint = options.endpoint || DEFAULT_ENDPOINT;
    this.valuationEndpoint = options.valuationEndpoint || DEFAULT_VALUATION_ENDPOINT;
    this.onToast = typeof options.onToast === "function" ? options.onToast : () => {};
    const saved = loadSavedState();
    this.watchlist = saved.watchlist;
    this.intervalMs = saved.intervalMs;
    this.columnState = loadColumnState();
    this.rows = [];
    this.unresolved = [];
    this.pendingImports = [];
    this.valuations = new Map();
    this.lastFetchedAt = "";
    this.valuationFetchedAt = "";
    this.valuationRetryAt = 0;
    this.error = "";
    this.valuationError = "";
    this.active = false;
    this.paused = false;
    this.loading = false;
    this.valuationLoading = false;
    this.nextRefreshAt = 0;
    this.refreshTimer = null;
    this.ticker = null;
    this.changeTimer = null;
    this.fetchController = null;
    this.valuationController = null;
    this.requestSequence = 0;
    this.sortState = { columnId: "", direction: "" };
    this.draggedColumnId = "";
    this.liveChanges = new Map();
    this.unseenChanges = new Map();
    this.alertStates = new Map();
    this.alertEvents = [];
    this.alertSequence = 0;
    this.bind();
    this.render();
    this.ticker = window.setInterval(() => this.renderStatus(), 1_000);
  }

  bind() {
    this.root.querySelector("#realtimeQuoteImportButton")?.addEventListener("click", () => this.openImportDialog());
    this.root.querySelector("#realtimeQuoteEmptyImportButton")?.addEventListener("click", () => this.openImportDialog());
    this.root.querySelector("#realtimeQuoteRefreshButton")?.addEventListener("click", () => void this.refresh({ manual: true }));
    this.root.querySelector("#realtimeQuotePauseButton")?.addEventListener("click", () => this.togglePaused());
    this.root.querySelector("#realtimeQuoteNotificationButton")?.addEventListener("click", () => void this.enableNotifications());
    this.root.querySelector("#realtimeQuoteColumnButton")?.addEventListener("click", () => this.toggleColumnMenu());
    this.root.querySelector("#realtimeQuoteColumnReset")?.addEventListener("click", () => this.resetColumns());
    this.root.querySelector("#realtimeQuoteClearChanges")?.addEventListener("click", () => this.acknowledgeChanges());
    this.root.querySelector("#realtimeQuoteClearAlerts")?.addEventListener("click", () => this.clearAlerts());
    this.root.querySelector("#realtimeQuoteInterval")?.addEventListener("change", (event) => {
      const value = Number(event.currentTarget.value) * 1_000;
      this.intervalMs = SUPPORTED_INTERVALS.has(value) ? value : DEFAULT_INTERVAL_MS;
      this.save();
      this.schedule();
      this.renderStatus();
    });

    this.root.querySelector("#realtimeQuoteColumnList")?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-realtime-column-toggle]");
      if (input) this.setColumnVisible(input.dataset.realtimeColumnToggle, input.checked);
    });

    const head = this.root.querySelector("#realtimeQuoteTableHead");
    head?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort-realtime-column]");
      if (button) this.cycleSort(button.dataset.sortRealtimeColumn);
    });
    head?.addEventListener("dragstart", (event) => {
      const cell = event.target.closest("[data-realtime-column-id]");
      if (!cell) return;
      this.draggedColumnId = cell.dataset.realtimeColumnId;
      cell.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", this.draggedColumnId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    head?.addEventListener("dragover", (event) => {
      if (!event.target.closest("[data-realtime-column-id]")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    head?.addEventListener("drop", (event) => {
      const target = event.target.closest("[data-realtime-column-id]");
      if (!target) return;
      event.preventDefault();
      this.moveColumn(this.draggedColumnId || event.dataTransfer?.getData("text/plain"), target.dataset.realtimeColumnId);
    });
    head?.addEventListener("dragend", () => {
      this.draggedColumnId = "";
      head.querySelectorAll(".is-dragging").forEach((element) => element.classList.remove("is-dragging"));
    });

    this.root.querySelector("#realtimeQuoteTableBody")?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-realtime-query]");
      if (remove) return this.removeQuery(remove.dataset.removeRealtimeQuery);
      const copy = event.target.closest("[data-copy-quote-side]");
      if (copy) void this.copyQuote(copy.dataset.copySecurityId, copy.dataset.copyQuoteSide);
    });
    this.root.querySelector("#realtimeQuoteAlertList")?.addEventListener("click", (event) => {
      const dismiss = event.target.closest("[data-dismiss-realtime-alert]");
      if (!dismiss) return;
      this.alertEvents = this.alertEvents.filter((item) => item.id !== dismiss.dataset.dismissRealtimeAlert);
      this.renderAlerts();
    });

    const dialog = document.querySelector("#realtimeQuoteImportDialog");
    const input = dialog?.querySelector("#realtimeQuoteImportInput");
    dialog?.querySelectorAll("[data-close-realtime-import]").forEach((button) => button.addEventListener("click", () => this.closeImportDialog()));
    dialog?.querySelector("#realtimeQuoteImportAddButton")?.addEventListener("click", () => this.addInputValue());
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.addInputValue();
    });
    dialog?.querySelector("#realtimeQuoteClipboardButton")?.addEventListener("click", () => void this.importClipboard());
    dialog?.querySelector("#realtimeQuoteFileInput")?.addEventListener("change", (event) => void this.importFile(event));
    dialog?.querySelector("#realtimeQuotePendingList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-pending-query]");
      if (!button) return;
      this.pendingImports = this.pendingImports.filter((item) => item.query !== button.dataset.removePendingQuery);
      this.renderPendingImports();
    });
    dialog?.querySelector("#realtimeQuoteImportConfirm")?.addEventListener("click", () => this.confirmImport());

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (dialog && !dialog.hidden) this.closeImportDialog();
      this.closeColumnMenu();
    });
    document.addEventListener("click", (event) => {
      const wrap = this.root.querySelector(".realtime-column-menu-wrap");
      if (wrap && !wrap.contains(event.target)) this.closeColumnMenu();
    });
    document.addEventListener("visibilitychange", () => {
      this.render();
      this.syncPolling();
    });
    window.addEventListener("pagehide", () => this.destroy(), { once: true });
  }

  setActive(active) {
    this.active = Boolean(active);
    this.render();
    this.syncPolling({ immediate: this.active });
  }

  destroy() {
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.changeTimer);
    window.clearInterval(this.ticker);
    this.fetchController?.abort();
    this.valuationController?.abort();
  }

  openImportDialog() {
    const dialog = document.querySelector("#realtimeQuoteImportDialog");
    if (!dialog) return;
    this.pendingImports = [];
    const replace = dialog.querySelector("#realtimeQuoteReplaceExisting");
    if (replace) replace.checked = false;
    const input = dialog.querySelector("#realtimeQuoteImportInput");
    if (input) input.value = "";
    this.setDialogStatus("支持：券码/简称；或 券码 简称 买入/卖出 目标收益率。", "idle");
    this.renderPendingImports();
    dialog.hidden = false;
    document.body.classList.add("realtime-import-open");
    requestAnimationFrame(() => input?.focus({ preventScroll: true }));
  }

  closeImportDialog() {
    const dialog = document.querySelector("#realtimeQuoteImportDialog");
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    document.body.classList.remove("realtime-import-open");
    this.root.querySelector("#realtimeQuoteImportButton")?.focus({ preventScroll: true });
  }

  addInputValue() {
    const input = document.querySelector("#realtimeQuoteImportInput");
    this.addPending(parseRealtimeQuoteImportEntries(input?.value || ""));
    if (input) input.value = "";
  }

  async importClipboard() {
    try {
      const items = parseRealtimeQuoteImportEntries(await navigator.clipboard.readText());
      this.addPending(items);
      this.setDialogStatus(items.length ? `已从剪贴板识别 ${items.length} 只债券，买卖方向和目标价已一并读取。` : "剪贴板中未识别到券码或券名。", items.length ? "ok" : "warning");
    } catch {
      this.setDialogStatus("浏览器未允许读取剪贴板，请使用单行输入或文件导入。", "warning");
    }
  }

  async importFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 512_000) return this.setDialogStatus("文件超过 500 KB，请缩小后重试。", "warning");
    try {
      const items = parseRealtimeQuoteImportEntries(await file.text());
      this.addPending(items);
      this.setDialogStatus(items.length ? `已从 ${file.name} 识别 ${items.length} 只债券。` : "文件中未识别到券码或券名。", items.length ? "ok" : "warning");
    } catch {
      this.setDialogStatus("文件读取失败，请改用 UTF-8 编码的 TXT 或 CSV。", "warning");
    }
  }

  addPending(items) {
    const merged = mergeWatchItems(this.pendingImports, items);
    this.pendingImports = merged.slice(0, MAX_SECURITIES);
    if (merged.length > MAX_SECURITIES) this.setDialogStatus(`单次最多导入 ${MAX_SECURITIES} 只，超出部分已忽略。`, "warning");
    this.renderPendingImports();
  }

  renderPendingImports() {
    const list = document.querySelector("#realtimeQuotePendingList");
    const count = document.querySelector("#realtimeQuotePendingCount");
    const confirm = document.querySelector("#realtimeQuoteImportConfirm");
    if (count) count.textContent = `${this.pendingImports.length} / ${MAX_SECURITIES}`;
    if (confirm) confirm.disabled = !this.pendingImports.length;
    if (!list) return;
    list.innerHTML = this.pendingImports.length
      ? this.pendingImports.map((item) => `<span class="realtime-import-chip"><b>${escapeHtml(importItemLabel(item))}</b><button type="button" data-remove-pending-query="${escapeAttribute(item.query)}" aria-label="移除 ${escapeAttribute(item.query)}">×</button></span>`).join("")
      : '<div class="realtime-import-empty">待导入列表为空</div>';
  }

  setDialogStatus(message, state = "idle") {
    const element = document.querySelector("#realtimeQuoteImportStatus");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  confirmImport() {
    if (!this.pendingImports.length) return;
    const replace = document.querySelector("#realtimeQuoteReplaceExisting")?.checked;
    this.watchlist = (replace ? mergeWatchItems([], this.pendingImports) : mergeWatchItems(this.watchlist, this.pendingImports)).slice(0, MAX_SECURITIES);
    this.rows = [];
    this.unresolved = [];
    this.error = "";
    this.save();
    this.closeImportDialog();
    this.render();
    this.onToast(`券池已更新：${this.watchlist.length} 只`);
    this.syncPolling({ immediate: true });
  }

  removeQuery(query) {
    const normalized = String(query || "");
    this.watchlist = this.watchlist.filter((item) => item.query !== normalized);
    this.rows = this.rows.filter((row) => row.query !== normalized);
    this.unresolved = this.unresolved.filter((row) => row.query !== normalized);
    this.save();
    this.render();
    this.schedule();
  }

  togglePaused() {
    this.paused = !this.paused;
    this.syncPolling({ immediate: !this.paused });
    this.renderStatus();
  }

  syncPolling({ immediate = false } = {}) {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.nextRefreshAt = 0;
    if (!this.shouldPoll()) {
      if (this.paused || !this.watchlist.length) this.fetchController?.abort();
      this.renderStatus();
      return;
    }
    const stale = !this.lastFetchedAt || Date.now() - Date.parse(this.lastFetchedAt) >= this.intervalMs;
    if (immediate && !this.loading && stale) return void this.refresh();
    this.schedule();
  }

  schedule() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.nextRefreshAt = 0;
    if (!this.shouldPoll() || this.loading) return this.renderStatus();
    this.nextRefreshAt = Date.now() + this.intervalMs;
    this.refreshTimer = window.setTimeout(() => void this.refresh(), this.intervalMs);
    this.renderStatus();
  }

  shouldPoll() {
    return !this.paused && this.watchlist.length > 0;
  }

  isPanelVisible() {
    return this.active && !document.hidden;
  }

  async refresh({ manual = false } = {}) {
    if (!this.watchlist.length || this.loading) return;
    this.fetchController?.abort();
    const controller = new AbortController();
    this.fetchController = controller;
    const sequence = ++this.requestSequence;
    this.loading = true;
    this.error = "";
    this.nextRefreshAt = 0;
    this.renderStatus();
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ queries: this.watchlist.map((item) => item.query) }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || `HTTP ${response.status}`);
      if (sequence !== this.requestSequence) return;
      const nextRows = (Array.isArray(payload.rows) ? payload.rows : []).map((row) => this.attachValuation(row));
      const unmatched = pruneUnresolvedWatchItems(this.watchlist, payload.unresolved);
      this.captureQuoteChanges(this.rows, nextRows);
      this.rows = nextRows;
      this.watchlist = unmatched.watchlist;
      this.unresolved = [];
      this.lastFetchedAt = payload.fetchedAt || new Date().toISOString();
      this.error = "";
      this.evaluateAlerts(nextRows);
      if (unmatched.removed.length) this.save();
      this.render();
      void this.maybeRefreshValuations(nextRows);
      if (unmatched.removed.length) {
        const labels = unmatched.removed.slice(0, 3).map((item) => item.label || item.query).join("、");
        const more = unmatched.removed.length > 3 ? ` 等 ${unmatched.removed.length} 项` : "";
        this.onToast(`已移除非债券或未匹配内容：${labels}${more}`);
      } else if (manual) this.onToast(`已刷新 ${this.rows.length} 只债券`);
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== this.requestSequence) return;
      this.error = error.message || "实时行情刷新失败";
      this.render();
    } finally {
      if (sequence === this.requestSequence) {
        this.loading = false;
        this.fetchController = null;
        this.render();
        this.schedule();
      }
    }
  }

  async maybeRefreshValuations(rows, { force = false } = {}) {
    const securityIds = unique(rows.map((row) => normalizeSecurityKey(row.securityId)).filter(Boolean));
    if (!securityIds.length || this.valuationLoading) return;
    const missing = securityIds.some((securityId) => !this.valuations.has(securityId));
    const fresh = this.valuationFetchedAt && Date.now() - Date.parse(this.valuationFetchedAt) < VALUATION_REFRESH_MS;
    if (!force && !missing && fresh) return;
    if (!force && Date.now() < this.valuationRetryAt) return;
    this.valuationController?.abort();
    const controller = new AbortController();
    this.valuationController = controller;
    this.valuationLoading = true;
    this.valuationError = "";
    this.renderValuationStatus();
    try {
      const response = await fetch(this.valuationEndpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ securityIds }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || `HTTP ${response.status}`);
      for (const item of Array.isArray(payload.rows) ? payload.rows : []) {
        const securityId = normalizeSecurityKey(item.securityId);
        if (securityId) this.valuations.set(securityId, item);
      }
      this.valuationFetchedAt = payload.fetchedAt || new Date().toISOString();
      this.valuationRetryAt = 0;
      this.rows = this.rows.map((row) => this.attachValuation(row));
      this.renderTable();
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.valuationError = error.message || "估值更新失败";
      this.valuationRetryAt = Date.now() + VALUATION_RETRY_MS;
    } finally {
      this.valuationLoading = false;
      this.valuationController = null;
      this.renderValuationStatus();
    }
  }

  attachValuation(row) {
    return { ...row, valuation: this.valuations.get(normalizeSecurityKey(row.securityId)) || row.valuation || null };
  }

  captureQuoteChanges(previousRows, nextRows) {
    const previousById = new Map(previousRows.map((row) => [normalizeSecurityKey(row.securityId), row]));
    const now = Date.now();
    for (const row of nextRows) {
      const securityId = normalizeSecurityKey(row.securityId);
      const previous = previousById.get(securityId);
      if (!securityId || !previous) continue;
      for (const side of ["bid", "ofr"]) {
        const change = describeQuoteChange(previous[side], row[side], side);
        if (!change) continue;
        const key = `${securityId}|${side}`;
        const existingUnread = this.unseenChanges.get(key);
        if (!this.isPanelVisible() || existingUnread) {
          const history = [...(existingUnread?.history || []), { ...change, at: now }].slice(-MAX_CHANGE_HISTORY);
          this.unseenChanges.set(key, { ...change, count: (existingUnread?.count || 0) + 1, history, securityId, side });
        } else {
          this.liveChanges.set(key, { ...change, expiresAt: now + CHANGE_HIGHLIGHT_MS, securityId, side });
        }
      }
    }
    this.scheduleChangeCleanup();
  }

  scheduleChangeCleanup() {
    window.clearTimeout(this.changeTimer);
    if (!this.liveChanges.size) return;
    this.changeTimer = window.setTimeout(() => {
      const now = Date.now();
      for (const [key, change] of this.liveChanges) if (change.expiresAt <= now) this.liveChanges.delete(key);
      this.renderTable();
    }, CHANGE_HIGHLIGHT_MS + 40);
  }

  changeFor(row, side) {
    const key = `${normalizeSecurityKey(row.securityId)}|${side}`;
    return this.unseenChanges.get(key) || this.liveChanges.get(key) || null;
  }

  acknowledgeChanges() {
    this.unseenChanges.clear();
    this.render();
  }

  evaluateAlerts(rows) {
    const activeKeys = new Set();
    for (const row of rows) {
      for (const alert of this.watchItemForRow(row)?.alerts || []) {
        const key = alertStateKey(row, alert);
        activeKeys.add(key);
        const met = targetIsMet(row, alert);
        if (met && this.alertStates.get(key) !== true) this.raiseAlert(row, alert);
        this.alertStates.set(key, met);
      }
    }
    for (const key of this.alertStates.keys()) if (!activeKeys.has(key)) this.alertStates.delete(key);
  }

  raiseAlert(row, alert) {
    const text = buildAlertText(row, alert);
    const event = { id: `alert-${Date.now()}-${++this.alertSequence}`, text, time: new Date().toISOString(), side: alert.side };
    this.alertEvents = [event, ...this.alertEvents].slice(0, 20);
    this.onToast(text);
    if (!this.isPanelVisible() && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const notification = new Notification("实时行情到价", { body: text, tag: alertStateKey(row, alert) });
      window.setTimeout(() => notification.close(), 15_000);
    }
    this.renderAlerts();
  }

  clearAlerts() {
    this.alertEvents = [];
    this.renderAlerts();
  }

  async enableNotifications() {
    if (typeof Notification === "undefined") return this.onToast("当前浏览器不支持系统通知");
    if (Notification.permission === "denied") return this.onToast("系统通知已被浏览器拦截，请在站点设置中开启");
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    this.onToast(permission === "granted" ? "到价系统提醒已开启" : "未开启系统通知，仍会保留面板内提醒");
    this.renderNotificationButton();
  }

  async copyQuote(securityId, side) {
    const row = this.rows.find((item) => normalizeSecurityKey(item.securityId) === normalizeSecurityKey(securityId));
    const text = buildQuoteCopyText(row, side);
    if (!text) return this.onToast("当前没有可复制的报价");
    try {
      await navigator.clipboard.writeText(text);
      this.onToast(`已复制：${text}`);
    } catch {
      this.onToast("剪贴板写入失败，请检查浏览器权限");
    }
  }

  watchItemForRow(row) {
    return this.watchlist.find((item) => item.query === row?.query)
      || this.watchlist.find((item) => normalizeSecurityKey(item.query) === normalizeSecurityKey(row?.securityId))
      || null;
  }

  cycleSort(columnId) {
    if (!COLUMN_BY_ID.has(columnId)) return;
    if (this.sortState.columnId !== columnId) this.sortState = { columnId, direction: "asc" };
    else if (this.sortState.direction === "asc") this.sortState = { columnId, direction: "desc" };
    else if (this.sortState.direction === "desc") this.sortState = { columnId: "", direction: "" };
    else this.sortState = { columnId, direction: "asc" };
    this.renderTable();
  }

  sortedRows() {
    const { columnId, direction } = this.sortState;
    const column = COLUMN_BY_ID.get(columnId);
    if (!column || !direction) return [...this.rows];
    return [...this.rows].sort((left, right) => compareSortValues(column.sortValue(left, this), column.sortValue(right, this), direction));
  }

  visibleColumns() {
    return this.columnState.order.filter((id) => this.columnState.visible.includes(id)).map((id) => COLUMN_BY_ID.get(id)).filter(Boolean);
  }

  setColumnVisible(columnId, visible) {
    const column = COLUMN_BY_ID.get(columnId);
    if (!column || column.required) return;
    const current = new Set(this.columnState.visible);
    if (visible) current.add(columnId);
    else current.delete(columnId);
    this.columnState.visible = this.columnState.order.filter((id) => current.has(id) || COLUMN_BY_ID.get(id)?.required);
    saveColumnState(this.columnState);
    this.renderTable();
    this.renderColumnSettings();
  }

  moveColumn(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId || !COLUMN_BY_ID.has(sourceId) || !COLUMN_BY_ID.has(targetId)) return;
    const order = this.columnState.order.filter((id) => id !== sourceId);
    order.splice(order.indexOf(targetId), 0, sourceId);
    this.columnState.order = order;
    saveColumnState(this.columnState);
    this.renderTable();
    this.renderColumnSettings();
  }

  resetColumns() {
    this.columnState = defaultColumnState();
    saveColumnState(this.columnState);
    this.renderTable();
    this.renderColumnSettings();
    this.onToast("行情列已恢复默认");
  }

  toggleColumnMenu() {
    const menu = this.root.querySelector("#realtimeQuoteColumnMenu");
    if (!menu) return;
    menu.hidden = !menu.hidden;
    this.root.querySelector("#realtimeQuoteColumnButton")?.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) this.renderColumnSettings();
  }

  closeColumnMenu() {
    const menu = this.root.querySelector("#realtimeQuoteColumnMenu");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    this.root.querySelector("#realtimeQuoteColumnButton")?.setAttribute("aria-expanded", "false");
  }

  renderColumnSettings() {
    const list = this.root.querySelector("#realtimeQuoteColumnList");
    if (!list) return;
    list.innerHTML = this.columnState.order.map((id) => {
      const column = COLUMN_BY_ID.get(id);
      if (!column) return "";
      const checked = this.columnState.visible.includes(id);
      return `<label><input type="checkbox" data-realtime-column-toggle="${escapeAttribute(id)}" ${checked ? "checked" : ""} ${column.required ? "disabled" : ""}><span>${escapeHtml(column.label)}</span>${column.required ? "<small>固定</small>" : ""}</label>`;
    }).join("");
  }

  render() {
    const interval = this.root.querySelector("#realtimeQuoteInterval");
    if (interval) interval.value = String(this.intervalMs / 1_000);
    this.renderTable();
    this.renderSummary();
    this.renderStatus();
    this.renderAlerts();
    this.renderColumnSettings();
    this.renderNotificationButton();
    this.renderValuationStatus();
  }

  renderTable() {
    const body = this.root.querySelector("#realtimeQuoteTableBody");
    const head = this.root.querySelector("#realtimeQuoteTableHead");
    const empty = this.root.querySelector("#realtimeQuoteEmptyState");
    const table = this.root.querySelector("#realtimeQuoteTable");
    if (!body || !head || !empty || !table) return;
    empty.hidden = this.watchlist.length > 0;
    table.hidden = this.watchlist.length === 0;
    if (!this.watchlist.length) {
      body.innerHTML = "";
      head.innerHTML = "";
      return;
    }
    const columns = this.visibleColumns();
    table.style.minWidth = `${columns.reduce((sum, column) => sum + column.width, 0) + 42}px`;
    head.innerHTML = `<tr>${columns.map((column) => renderColumnHeader(column, this.sortState)).join("")}<th class="quote-action-head"><span class="visually-hidden">操作</span></th></tr>`;
    const representedQueries = new Set([...this.rows.map((row) => row.query), ...this.unresolved.map((row) => row.query)]);
    const pending = this.watchlist.filter((item) => !representedQueries.has(item.query));
    const resolvedHtml = this.sortedRows().map((row) => renderQuoteRow(row, columns, this)).join("");
    const unresolvedHtml = this.unresolved.map((item) => renderPlaceholderRow(item, columns, this, "unresolved")).join("");
    const pendingHtml = pending.map((item) => renderPlaceholderRow(item, columns, this, "pending")).join("");
    body.innerHTML = resolvedHtml || unresolvedHtml || pendingHtml
      ? `${resolvedHtml}${unresolvedHtml}${pendingHtml}`
      : this.loading ? renderLoadingRows(Math.min(this.watchlist.length, 8), columns.length + 1) : "";
  }

  renderSummary() {
    const twoSided = this.rows.filter((row) => row.status === "two-sided").length;
    const oneSided = this.rows.filter((row) => row.status === "bid-only" || row.status === "ofr-only").length;
    const representedQueries = new Set([...this.rows.map((row) => row.query), ...this.unresolved.map((row) => row.query)]);
    const pending = this.watchlist.filter((item) => !representedQueries.has(item.query)).length;
    const noQuote = this.rows.filter((row) => row.status === "no-quote").length + this.unresolved.length + pending;
    setText(this.root, "#realtimeQuoteUniverseCount", this.watchlist.length);
    setText(this.root, "#realtimeQuoteTwoSidedCount", twoSided);
    setText(this.root, "#realtimeQuoteOneSidedCount", oneSided);
    setText(this.root, "#realtimeQuoteNoPriceCount", noQuote);
    setText(this.root, "#realtimeQuoteUnreadCount", [...this.unseenChanges.values()].reduce((sum, item) => sum + item.count, 0));
    const clear = this.root.querySelector("#realtimeQuoteClearChanges");
    if (clear) clear.hidden = this.unseenChanges.size === 0;
  }

  renderStatus() {
    const state = this.root.querySelector("#realtimeQuoteLiveState");
    const detail = this.root.querySelector("#realtimeQuoteStatusDetail");
    const pause = this.root.querySelector("#realtimeQuotePauseButton");
    const refresh = this.root.querySelector("#realtimeQuoteRefreshButton");
    const last = this.root.querySelector("#realtimeQuoteLastRefresh");
    const countdown = this.root.querySelector("#realtimeQuoteCountdown");
    let label = "待导入";
    let status = "idle";
    let detailText = "导入券池后开始轮询";
    if (this.loading) {
      label = "刷新中";
      status = "loading";
      detailText = "正在读取当日最优报价";
    } else if (this.error) {
      label = "连接异常";
      status = "error";
      detailText = this.error;
    } else if (this.paused) {
      label = "已暂停";
      status = "paused";
      detailText = "自动轮询已暂停";
    } else if ((!this.active || document.hidden) && this.watchlist.length) {
      label = "后台监控";
      status = "background";
      detailText = "继续轮询，变动与到价将累计";
    } else if (this.watchlist.length) {
      label = "LIVE";
      status = "live";
      detailText = `每 ${this.intervalMs / 1_000} 秒自动刷新`;
    }
    if (state) {
      state.dataset.state = status;
      state.querySelector("strong").textContent = label;
    }
    if (detail) detail.textContent = detailText;
    if (pause) {
      pause.textContent = this.paused ? "继续轮询" : "暂停轮询";
      pause.disabled = !this.watchlist.length;
    }
    if (refresh) refresh.disabled = !this.watchlist.length || this.loading;
    if (last) last.textContent = this.lastFetchedAt ? formatChinaDateTime(this.lastFetchedAt) : "--";
    if (countdown) {
      const seconds = this.nextRefreshAt ? Math.max(0, Math.ceil((this.nextRefreshAt - Date.now()) / 1_000)) : null;
      countdown.textContent = seconds === null ? "--" : `${seconds}s`;
    }
  }

  renderAlerts() {
    const tray = this.root.querySelector("#realtimeQuoteAlertTray");
    const list = this.root.querySelector("#realtimeQuoteAlertList");
    if (!tray || !list) return;
    tray.hidden = this.alertEvents.length === 0;
    list.innerHTML = this.alertEvents.map((item) => `<div class="realtime-alert-item" data-alert-side="${escapeAttribute(item.side)}"><span>${escapeHtml(item.text)}</span><time>${escapeHtml(formatChinaDateTime(item.time))}</time><button type="button" data-dismiss-realtime-alert="${escapeAttribute(item.id)}" aria-label="关闭提醒">×</button></div>`).join("");
  }

  renderNotificationButton() {
    const button = this.root.querySelector("#realtimeQuoteNotificationButton");
    if (!button) return;
    const permission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    button.dataset.permission = permission;
    button.textContent = permission === "granted" ? "提醒已开" : permission === "denied" ? "提醒被禁" : "系统提醒";
  }

  renderValuationStatus() {
    const element = this.root.querySelector("#realtimeQuoteValuationStatus");
    if (!element) return;
    element.dataset.state = this.valuationError ? "error" : this.valuationLoading ? "loading" : "idle";
    element.textContent = this.valuationError ? `估值：${this.valuationError}` : this.valuationLoading ? "估值：更新中" : this.valuationFetchedAt ? `估值快照：${formatChinaDateTime(this.valuationFetchedAt)}` : "估值：待首次行情解析";
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ watchlist: this.watchlist, intervalMs: this.intervalMs }));
    } catch {
      // A blocked local cache must not stop live quote retrieval.
    }
  }
}

function renderColumnHeader(column, sortState) {
  const active = sortState.columnId === column.id;
  const ariaSort = active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none";
  return `<th draggable="true" data-realtime-column-id="${escapeAttribute(column.id)}" data-column="${escapeAttribute(column.id)}" data-tone="${escapeAttribute(column.tone || "")}" style="width:${column.width}px" aria-sort="${ariaSort}"><button type="button" data-sort-realtime-column="${escapeAttribute(column.id)}"><span>${escapeHtml(column.label)}</span><i aria-hidden="true">${active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}</i></button><b aria-hidden="true">⋮⋮</b></th>`;
}

function renderQuoteRow(row, columns, controller) {
  return `<tr data-quote-status="${escapeAttribute(row.status || "no-quote")}" data-security-id="${escapeAttribute(row.securityId)}">${columns.map((column) => renderQuoteCell(column.id, row, controller)).join("")}${renderActionCell(row.query, row.shortName || row.query)}</tr>`;
}

function renderPlaceholderRow(item, columns, controller, status) {
  const watchItem = item.query ? controller.watchlist.find((watch) => watch.query === item.query) : item;
  const row = { query: item.query, shortName: watchItem?.label || item.query, status, placeholderStatus: status, placeholderReason: status === "unresolved" ? (item.reason || "请核对简称") : "等待首次刷新", bid: {}, ofr: {}, spread: {} };
  return `<tr data-quote-status="${status}">${columns.map((column) => renderQuoteCell(column.id, row, controller)).join("")}${renderActionCell(item.query, row.shortName)}</tr>`;
}

function renderQuoteCell(columnId, row, controller) {
  const watchItem = controller.watchItemForRow(row) || controller.watchlist.find((item) => item.query === row.query);
  if (columnId === "identity") {
    const secondary = row.placeholderStatus ? row.placeholderReason : (row.securityId || row.query || "--");
    return `<td data-column="identity" class="quote-identity-cell"><strong>${escapeHtml(row.shortName || row.query || "未命名")}</strong><span>${escapeHtml(secondary)}</span></td>`;
  }
  if (columnId === "tenor") return `<td data-column="tenor" class="quote-tenor-cell">${escapeHtml(row.remainingTenor || "--")}</td>`;
  if (columnId === "chinaBond") return `<td data-column="chinaBond" class="quote-valuation-cell china-bond-valuation">${renderValuation(row.valuation?.chinaBond)}</td>`;
  if (columnId === "chinaSecurities") return `<td data-column="chinaSecurities" class="quote-valuation-cell china-securities-valuation">${renderValuation(row.valuation?.chinaSecurities)}</td>`;
  if (columnId === "source") {
    const sourceLabel = row.placeholderStatus === "pending" ? "待查询" : row.placeholderStatus === "unresolved" ? "基础资料" : "经纪商聚合";
    return `<td data-column="source" class="quote-source-cell" title="数据来源：DM"><span>聚合</span><small>${sourceLabel}</small></td>`;
  }
  if (columnId === "bidVolume") return `<td data-column="bidVolume" class="quote-volume-cell bid-volume">${formatQuoteNumber(row.bid?.volumeWan, 0)}</td>`;
  if (columnId === "bid") return renderPriceCell(row, "bid", controller.changeFor(row, "bid"));
  if (columnId === "spread") return `<td data-column="spread" class="quote-spread-cell">${formatSpread(row.spread)}</td>`;
  if (columnId === "ofr") return renderPriceCell(row, "ofr", controller.changeFor(row, "ofr"));
  if (columnId === "ofrVolume") return `<td data-column="ofrVolume" class="quote-volume-cell ofr-volume">${formatQuoteNumber(row.ofr?.volumeWan, 0)}</td>`;
  if (columnId === "target") return `<td data-column="target" class="quote-target-cell">${renderTargets(watchItem, row)}</td>`;
  if (columnId === "quoteTime") return `<td data-column="quoteTime" class="quote-time-cell"><strong>${escapeHtml(row.quoteTime || (row.placeholderStatus === "unresolved" ? "未匹配" : "--"))}</strong><span>${escapeHtml(row.quoteDate || (row.placeholderStatus ? row.placeholderReason : "当日"))}</span></td>`;
  return `<td data-column="${escapeAttribute(columnId)}">--</td>`;
}

function renderActionCell(query, label) {
  return `<td class="quote-action-cell"><button type="button" data-remove-realtime-query="${escapeAttribute(query)}" aria-label="移除 ${escapeAttribute(label || query)}">×</button></td>`;
}

function renderPriceCell(row, side, change) {
  const quote = row[side] || {};
  const hasValue = Number.isFinite(quote.yield) || Number.isFinite(quote.netPrice);
  const changeClass = change ? ` quote-change-${change.quality}${change.count ? " quote-cell-unread" : ""}` : "";
  const action = side === "ofr" ? "TKN" : "GVN";
  const content = `${renderPrice(quote)}${renderChangeIndicator(change)}`;
  return `<td data-column="${side}" class="quote-price-cell ${side}-price${changeClass}"${change ? ` title="${escapeAttribute(changeTitle(change))}"` : ""}>${hasValue && row.securityId ? `<button type="button" data-copy-quote-side="${side}" data-copy-security-id="${escapeAttribute(row.securityId)}" aria-label="复制 ${escapeAttribute(action)} 报价">${content}</button>` : content}</td>`;
}

function renderPrice(side = {}) {
  const yieldValue = formatQuoteNumber(side.yield, 4);
  const priceValue = Number.isFinite(side.netPrice) ? `净价 ${formatQuoteNumber(side.netPrice, 4)}` : "净价 --";
  return `<strong>${yieldValue}${yieldValue === "--" ? "" : "<em>%</em>"}</strong><span>${priceValue}</span>`;
}

function renderValuation(value) {
  if (!value || !Number.isFinite(value.yield)) return "<strong>--</strong><span>暂无估值</span>";
  const date = String(value.date || "").slice(5) || "--";
  const netPrice = Number.isFinite(value.netPrice) ? ` · 净价 ${formatQuoteNumber(value.netPrice, 3)}` : "";
  return `<strong>${formatQuoteNumber(value.yield, 4)}<em>%</em></strong><span>${escapeHtml(value.basis || "估值")} · ${escapeHtml(date)}${escapeHtml(netPrice)}</span>`;
}

function renderTargets(watchItem, row) {
  const alerts = watchItem?.alerts || [];
  if (!alerts.length) return '<span class="quote-target-empty">--</span>';
  return alerts.map((alert) => {
    const met = targetIsMet(row, alert);
    const side = alert.side === "buy" ? "买入" : "卖出";
    const marketSide = alert.side === "buy" ? "OFR" : "BID";
    const suffix = alert.metric === "yield" ? "%" : "";
    return `<span class="quote-target-line${met ? " is-met" : ""}" data-target-side="${escapeAttribute(alert.side)}"><b>${side}</b>${marketSide} ${targetComparator(alert)} ${formatQuoteNumber(alert.target, 4)}${suffix}${met ? "<i>到价</i>" : ""}</span>`;
  }).join("");
}

function renderChangeIndicator(change) {
  if (!change) return "";
  const prefix = change.count ? `未读 ${change.count}` : change.quality === "improved" ? "改善" : change.quality === "worsened" ? "转差" : "变动";
  return `<span class="quote-change-indicator">${prefix} · ${escapeHtml(change.fromLabel)}→${escapeHtml(change.toLabel)}</span>`;
}

function changeTitle(change) {
  if (!change?.history?.length) return `${change.fromLabel} → ${change.toLabel}`;
  return change.history.map((item) => `${formatChinaTimeOnly(item.at)} ${item.fromLabel} → ${item.toLabel}`).join("\n");
}

function renderLoadingRows(count, columnCount) {
  return Array.from({ length: count }, () => `<tr class="quote-loading-row"><td colspan="${columnCount}"><span></span></td></tr>`).join("");
}

function formatSpread(spread = {}) {
  if (Number.isFinite(spread.yieldPct)) return `${formatQuoteNumber(spread.yieldPct * 100, 2)}<small>bp</small>`;
  if (Number.isFinite(spread.netPrice)) return `${formatQuoteNumber(spread.netPrice, 4)}<small>元</small>`;
  return "--";
}

function describeQuoteChange(previous = {}, next = {}, side = "bid") {
  const change = numericChange(previous.yield, next.yield, "yield") || numericChange(previous.netPrice, next.netPrice, "netPrice");
  if (!change) return null;
  let quality = "neutral";
  if (Number.isFinite(change.from) && Number.isFinite(change.to)) {
    const delta = change.to - change.from;
    const improvement = change.metric === "yield" ? (side === "bid" ? delta < 0 : delta > 0) : (side === "bid" ? delta > 0 : delta < 0);
    quality = improvement ? "improved" : "worsened";
  }
  return { ...change, quality, fromLabel: quoteChangeLabel(change.from, change.metric), toLabel: quoteChangeLabel(change.to, change.metric) };
}

function numericChange(from, to, metric) {
  const a = Number.isFinite(from) ? from : null;
  const b = Number.isFinite(to) ? to : null;
  return a === b ? null : { from: a, to: b, metric };
}

function quoteChangeLabel(value, metric) {
  return Number.isFinite(value) ? `${formatQuoteNumber(value, 4)}${metric === "yield" ? "%" : ""}` : "--";
}

function targetIsMet(row, alert) {
  if (!row || !alert) return false;
  const quote = alert.side === "buy" ? row.ofr : row.bid;
  const current = alert.metric === "netPrice" ? quote?.netPrice : quote?.yield;
  if (!Number.isFinite(current) || !Number.isFinite(alert.target)) return false;
  if (alert.metric === "netPrice") return alert.side === "buy" ? current <= alert.target : current >= alert.target;
  return alert.side === "buy" ? current >= alert.target : current <= alert.target;
}

function targetComparator(alert) {
  return alert.metric === "netPrice" ? (alert.side === "buy" ? "≤" : "≥") : (alert.side === "buy" ? "≥" : "≤");
}

function alertStateKey(row, alert) {
  return `${normalizeSecurityKey(row?.securityId || row?.query)}|${alert.side}|${alert.metric}|${alert.target}`;
}

function buildAlertText(row, alert) {
  const quote = alert.side === "buy" ? row.ofr : row.bid;
  const current = alert.metric === "netPrice" ? quote?.netPrice : quote?.yield;
  const suffix = alert.metric === "yield" ? "%" : "";
  return `${row.shortName || row.securityId} ${alert.side === "buy" ? "买入" : "卖出"}到价：${alert.side === "buy" ? "OFR" : "BID"} ${formatQuoteNumber(current, 4)}${suffix} ${targetComparator(alert)} ${formatQuoteNumber(alert.target, 4)}${suffix}`;
}

function buildQuoteCopyText(row, side) {
  if (!row || !["bid", "ofr"].includes(side)) return "";
  const quote = row[side] || {};
  const value = Number.isFinite(quote.yield) ? formatDeskNumber(quote.yield) : Number.isFinite(quote.netPrice) ? `净价${formatDeskNumber(quote.netPrice)}` : "";
  return value ? [row.securityId, row.shortName, side === "ofr" ? "TKN" : "GVN", value].filter(Boolean).join(" ") : "";
}

function formatDeskNumber(value) {
  return Number(value).toFixed(4);
}

function loadSavedState() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (current) return normalizeSavedState(current);
    return normalizeSavedState(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)) || {});
  } catch {
    return { watchlist: [], intervalMs: DEFAULT_INTERVAL_MS };
  }
}

function normalizeSavedState(value) {
  const intervalMs = SUPPORTED_INTERVALS.has(Number(value?.intervalMs)) ? Number(value.intervalMs) : DEFAULT_INTERVAL_MS;
  return { watchlist: mergeWatchItems([], Array.isArray(value?.watchlist) ? value.watchlist : []).slice(0, MAX_SECURITIES), intervalMs };
}

function defaultColumnState() {
  return { order: [...DEFAULT_COLUMN_ORDER], visible: [...DEFAULT_COLUMN_ORDER] };
}

function loadColumnState() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY));
    const order = unique([...(Array.isArray(saved?.order) ? saved.order : []), ...DEFAULT_COLUMN_ORDER]).filter((id) => COLUMN_BY_ID.has(id));
    const requestedVisible = new Set(Array.isArray(saved?.visible) ? saved.visible : DEFAULT_COLUMN_ORDER);
    return { order, visible: order.filter((id) => requestedVisible.has(id) || COLUMN_BY_ID.get(id)?.required) };
  } catch {
    return defaultColumnState();
  }
}

function saveColumnState(state) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Column preferences are optional.
  }
}

function mergeWatchItems(existing, incoming) {
  const result = [];
  const byQuery = new Map();
  for (const raw of [...existing, ...incoming]) {
    const item = normalizeWatchItem(raw);
    if (!item) continue;
    const key = normalizeQueryKey(item.query);
    const current = byQuery.get(key);
    if (!current) {
      byQuery.set(key, item);
      result.push(item);
    } else {
      if (!current.label && item.label) current.label = item.label;
      current.alerts = mergeAlerts(current.alerts, item.alerts);
    }
  }
  return result;
}

function normalizeWatchItem(value) {
  const source = typeof value === "string" ? { query: value } : value;
  const query = cleanImportToken(source?.query || source?.securityId || source?.shortName || "");
  if (!query || isObviousNonBondImportCandidate(query)) return null;
  const alerts = (Array.isArray(source?.alerts) ? source.alerts : []).map(normalizeAlert).filter(Boolean);
  const legacyAlert = normalizeAlert({ side: source?.targetSide, metric: source?.targetMetric, target: source?.targetValue });
  return { query, label: cleanImportLabel(source?.label || ""), alerts: mergeAlerts(alerts, legacyAlert ? [legacyAlert] : []) };
}

function normalizeAlert(value) {
  const side = value?.side === "buy" || value?.side === "sell" ? value.side : "";
  const metric = value?.metric === "netPrice" ? "netPrice" : "yield";
  const target = Number(value?.target);
  if (!side || !Number.isFinite(target) || target <= -5 || (metric === "yield" ? target >= 25 : target >= 200)) return null;
  return { side, metric, target };
}

function mergeAlerts(existing = [], incoming = []) {
  const map = new Map();
  for (const alert of [...existing, ...incoming]) {
    const normalized = normalizeAlert(alert);
    if (normalized) map.set(`${normalized.side}|${normalized.metric}`, normalized);
  }
  return [...map.values()];
}

function firstTargetValue(item) {
  return item?.alerts?.[0]?.target;
}

function importItemLabel(item) {
  const identity = item.label && normalizeQueryKey(item.label) !== normalizeQueryKey(item.query) ? `${item.query} ${item.label}` : item.query;
  const targets = (item.alerts || []).map((alert) => `${alert.side === "buy" ? "买入" : "卖出"}${targetComparator(alert)}${formatQuoteNumber(alert.target, 4)}${alert.metric === "yield" ? "%" : ""}`);
  return [identity, ...targets].join(" · ");
}

function detectIntentSide(line) {
  if (/(?:买入|(?<![\p{L}])买(?![\p{L}])|\b(?:BID|TAKEN|TAKE)\b)/iu.test(line)) return "buy";
  if (/(?:卖出|(?<![\p{L}])卖(?![\p{L}])|\b(?:OFR|OFFER|GIVEN|GIVE)\b)/iu.test(line)) return "sell";
  return "";
}

function detectIntentTarget(line, side) {
  const percentages = [...line.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];
  if (percentages.length) return { metric: "yield", value: Number(percentages.at(-1)[1]) };
  const priceMatch = line.match(/(?:净价|PRICE|\bP)\s*[:=：]?\s*(\d{2,3}(?:\.\d+)?)/i);
  if (priceMatch) return { metric: "netPrice", value: Number(priceMatch[1]) };
  const sidePattern = side === "buy" ? /(?:买入|\b(?:BID|TAKEN|TAKE)\b)/iu : /(?:卖出|\b(?:OFR|OFFER|GIVEN|GIVE)\b)/iu;
  const sideMatch = sidePattern.exec(line);
  const cleaned = (sideMatch ? line.slice(sideMatch.index + sideMatch[0].length) : line)
    .replace(/\d{6,12}(?:\.(?:IB|SH|SZ))?/gi, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:Y|年)/gi, " ")
    .replace(/\*\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*万/g, " ");
  const numbers = [...cleaned.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
  const candidate = numbers.find((number) => number > -5 && number < 25) ?? numbers.find((number) => number >= 50 && number < 200);
  return Number.isFinite(candidate) ? { metric: candidate < 25 ? "yield" : "netPrice", value: candidate } : null;
}

function extractImportLabel(line, code = "") {
  const stripped = String(line || "")
    .replace(code ? new RegExp(escapeRegExp(code), "ig") : /$^/, " ")
    .replace(/\b(?:BID|OFR|OFFER|TAKEN|TAKE|GIVEN|GIVE)\b|买入|卖出|(?<![\p{L}])[买卖](?![\p{L}])/giu, " ")
    .replace(/(?:净价|PRICE)\s*[:=：]?\s*\d+(?:\.\d+)?/gi, " ")
    .replace(/-?\d+(?:\.\d+)?\s*%/g, " ")
    .replace(/\*\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*万/g, " ");
  const candidates = stripped.split(/[\s\t,，|/]+/).map(cleanImportLabel).filter((token) => token && !/^\d+(?:\.\d+)?(?:Y|年)$/i.test(token) && !/^-?\d+(?:\.\d+)?$/.test(token) && !isImportHeaderToken(token));
  return candidates.find((token) => /[\u3400-\u9fff]/.test(token)) || candidates[0] || "";
}

function isImportHeaderLine(line) {
  const cells = line.split(/[\s\t,，|/]+/).filter(Boolean);
  return cells.length > 0 && cells.every(isImportHeaderToken);
}

function isImportHeaderToken(value) {
  return /^(?:代码|券码|债券代码|简称|债券简称|名称|方向|买卖方向|目标|目标价|收益率|价格|security.?id|side|target)$/i.test(String(value || "").trim());
}

function cleanImportToken(value = "") {
  const text = String(value || "").trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (!text || isImportHeaderToken(text) || text.length > 80) return "";
  return text.toUpperCase().replace(/\.(ib|sh|sz)$/i, (suffix) => suffix.toUpperCase());
}

function cleanImportLabel(value = "") {
  const text = String(value || "").trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return text.length <= 80 ? text : "";
}

function isObviousNonBondImportCandidate(value = "") {
  const text = cleanImportLabel(value).replace(/\s+/g, "");
  if (!text || /\d/.test(text) || /(?:债|票据|MTN|SCP|CP|PPN|ABN|ABS|GN|NCD|CD)/i.test(text)) return false;
  if (/^[\p{Script=Han}]{2,12}[（(][\p{Script=Han}]{2,12}[）)]$/u.test(text)) return true;
  if (/^(?:北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/.test(text)) return true;
  return /^(?:华北|华东|华南|华中|东北|西北|西南|全国|其他|全部)(?:地区|区域|团队)?$/.test(text)
    || /(?:省|市|自治区|地区|区域|分行|团队|名单)$/.test(text);
}

function pruneUnresolvedWatchItems(watchlist = [], unresolved = []) {
  const unresolvedKeys = new Set((Array.isArray(unresolved) ? unresolved : [])
    .map((item) => normalizeQueryKey(item?.query || item))
    .filter(Boolean));
  const kept = [];
  const removed = [];
  for (const raw of Array.isArray(watchlist) ? watchlist : []) {
    const item = normalizeWatchItem(raw);
    if (!item) continue;
    if (unresolvedKeys.has(normalizeQueryKey(item.query))) removed.push(item);
    else kept.push(item);
  }
  return { watchlist: kept, removed };
}

function normalizeQueryKey(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeSecurityKey(value) {
  return String(value || "").trim().toUpperCase();
}

function compareSortValues(left, right, direction) {
  const leftMissing = left === null || left === undefined || left === "" || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || right === "" || Number.isNaN(right);
  if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
  const factor = direction === "desc" ? -1 : 1;
  return typeof left === "number" && typeof right === "number"
    ? (left - right) * factor
    : String(left).localeCompare(String(right), "zh-Hans-CN", { numeric: true }) * factor;
}

function primaryQuoteValue(side = {}) {
  return Number.isFinite(side.yield) ? side.yield : side.netPrice;
}

function tenorYears(value = "") {
  const text = String(value || "").toUpperCase();
  const year = text.match(/(\d+(?:\.\d+)?)\s*Y/);
  if (year) return Number(year[1]);
  const day = text.match(/(\d+(?:\.\d+)?)\s*D/);
  return day ? Number(day[1]) / 365 : null;
}

function formatQuoteNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
}

function formatChinaDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}

function formatChinaTimeOnly(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

function unique(values) {
  return [...new Set(values)];
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export const __test__ = {
  buildAlertText,
  buildQuoteCopyText,
  describeQuoteChange,
  detectIntentTarget,
  isObviousNonBondImportCandidate,
  mergeWatchItems,
  parseRealtimeQuoteImportEntries,
  pruneUnresolvedWatchItems,
  targetIsMet,
};
