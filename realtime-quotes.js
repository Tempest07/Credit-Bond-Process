const DEFAULT_ENDPOINT = "./api/dm/realtime-quotes";
const STORAGE_KEY = "credit-bond-process-realtime-watchlist-v1";
const DEFAULT_INTERVAL_MS = 20_000;
const SUPPORTED_INTERVALS = new Set([15_000, 20_000, 30_000]);
const MAX_SECURITIES = 200;

export function initializeRealtimeQuotes(options = {}) {
  const root = document.querySelector('[data-view="realtime-quotes"]');
  if (!root) return { setActive() {}, destroy() {} };
  return new RealtimeQuoteController(root, options);
}

export function parseRealtimeQuoteImportText(value = "") {
  const output = [];
  const seen = new Set();
  const lines = String(value || "").replace(/\r/g, "\n").split(/[\n;；]+/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const codes = line.match(/(?<!\d)\d{6,12}(?:\.(?:IB|SH|SZ))?(?![\dA-Z])/gi) || [];
    if (codes.length) {
      for (const code of codes) addImportToken(code, output, seen);
      continue;
    }
    const hasDelimitedCells = /[\t,，]/.test(line);
    const cells = line.split(/[\t,，]+/).map(cleanImportToken).filter(Boolean);
    const candidates = hasDelimitedCells ? cells : line.split(/\s+/).map(cleanImportToken).filter(Boolean);
    for (const candidate of candidates) addImportToken(candidate, output, seen);
  }
  return output.slice(0, MAX_SECURITIES);
}

class RealtimeQuoteController {
  constructor(root, options = {}) {
    this.root = root;
    this.endpoint = options.endpoint || DEFAULT_ENDPOINT;
    this.onToast = typeof options.onToast === "function" ? options.onToast : () => {};
    const saved = loadSavedState();
    this.watchlist = saved.watchlist;
    this.intervalMs = saved.intervalMs;
    this.rows = [];
    this.unresolved = [];
    this.pendingImports = [];
    this.lastFetchedAt = "";
    this.error = "";
    this.active = false;
    this.paused = false;
    this.loading = false;
    this.nextRefreshAt = 0;
    this.refreshTimer = null;
    this.ticker = null;
    this.fetchController = null;
    this.requestSequence = 0;
    this.bind();
    this.render();
    this.ticker = window.setInterval(() => this.renderStatus(), 1_000);
  }

  bind() {
    this.root.querySelector("#realtimeQuoteImportButton")?.addEventListener("click", () => this.openImportDialog());
    this.root.querySelector("#realtimeQuoteEmptyImportButton")?.addEventListener("click", () => this.openImportDialog());
    this.root.querySelector("#realtimeQuoteRefreshButton")?.addEventListener("click", () => void this.refresh({ manual: true }));
    this.root.querySelector("#realtimeQuotePauseButton")?.addEventListener("click", () => this.togglePaused());
    this.root.querySelector("#realtimeQuoteInterval")?.addEventListener("change", (event) => {
      const value = Number(event.currentTarget.value) * 1_000;
      this.intervalMs = SUPPORTED_INTERVALS.has(value) ? value : DEFAULT_INTERVAL_MS;
      this.save();
      this.schedule();
      this.renderStatus();
    });
    this.root.querySelector("#realtimeQuoteTableBody")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-realtime-query]");
      if (!button) return;
      this.removeQuery(button.dataset.removeRealtimeQuery);
    });

    const dialog = document.querySelector("#realtimeQuoteImportDialog");
    const input = dialog?.querySelector("#realtimeQuoteImportInput");
    dialog?.querySelectorAll("[data-close-realtime-import]").forEach((button) => {
      button.addEventListener("click", () => this.closeImportDialog());
    });
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
      this.pendingImports = this.pendingImports.filter((item) => item !== button.dataset.removePendingQuery);
      this.renderPendingImports();
    });
    dialog?.querySelector("#realtimeQuoteImportConfirm")?.addEventListener("click", () => this.confirmImport());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog && !dialog.hidden) this.closeImportDialog();
    });
    document.addEventListener("visibilitychange", () => this.syncPolling());
    window.addEventListener("pagehide", () => this.destroy(), { once: true });
  }

  setActive(active) {
    this.active = Boolean(active);
    this.syncPolling({ immediate: this.active });
  }

  destroy() {
    window.clearTimeout(this.refreshTimer);
    window.clearInterval(this.ticker);
    this.fetchController?.abort();
  }

  openImportDialog() {
    const dialog = document.querySelector("#realtimeQuoteImportDialog");
    if (!dialog) return;
    this.pendingImports = [];
    const replace = dialog.querySelector("#realtimeQuoteReplaceExisting");
    if (replace) replace.checked = false;
    const input = dialog.querySelector("#realtimeQuoteImportInput");
    if (input) input.value = "";
    this.setDialogStatus("逐只输入，或从剪贴板 / TXT / CSV 导入。", "idle");
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
    const items = parseRealtimeQuoteImportText(input?.value || "");
    this.addPending(items);
    if (input) input.value = "";
  }

  async importClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const items = parseRealtimeQuoteImportText(text);
      this.addPending(items);
      this.setDialogStatus(items.length ? `已从剪贴板识别 ${items.length} 项。` : "剪贴板中未识别到券码或券名。", items.length ? "ok" : "warning");
    } catch {
      this.setDialogStatus("浏览器未允许读取剪贴板，请使用单行输入或文件导入。", "warning");
    }
  }

  async importFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 512_000) {
      this.setDialogStatus("文件超过 500 KB，请缩小后重试。", "warning");
      return;
    }
    try {
      const items = parseRealtimeQuoteImportText(await file.text());
      this.addPending(items);
      this.setDialogStatus(items.length ? `已从 ${file.name} 识别 ${items.length} 项。` : "文件中未识别到券码或券名。", items.length ? "ok" : "warning");
    } catch {
      this.setDialogStatus("文件读取失败，请改用 UTF-8 编码的 TXT 或 CSV。", "warning");
    }
  }

  addPending(items) {
    const merged = unique([...this.pendingImports, ...items]);
    this.pendingImports = merged.slice(0, MAX_SECURITIES);
    if (merged.length > MAX_SECURITIES) this.setDialogStatus(`单次最多导入 ${MAX_SECURITIES} 项，超出部分已忽略。`, "warning");
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
      ? this.pendingImports.map((item) => `<span class="realtime-import-chip"><b>${escapeHtml(item)}</b><button type="button" data-remove-pending-query="${escapeAttribute(item)}" aria-label="移除 ${escapeAttribute(item)}">×</button></span>`).join("")
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
    this.watchlist = (replace ? this.pendingImports : unique([...this.watchlist, ...this.pendingImports])).slice(0, MAX_SECURITIES);
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
    this.watchlist = this.watchlist.filter((item) => item !== normalized);
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
      if (document.hidden || !this.active) this.fetchController?.abort();
      this.renderStatus();
      return;
    }
    const stale = !this.lastFetchedAt || Date.now() - Date.parse(this.lastFetchedAt) >= this.intervalMs;
    if (immediate && !this.loading && stale) {
      void this.refresh();
      return;
    }
    this.schedule();
  }

  schedule() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.nextRefreshAt = 0;
    if (!this.shouldPoll() || this.loading) {
      this.renderStatus();
      return;
    }
    this.nextRefreshAt = Date.now() + this.intervalMs;
    this.refreshTimer = window.setTimeout(() => void this.refresh(), this.intervalMs);
    this.renderStatus();
  }

  shouldPoll() {
    return this.active && !document.hidden && !this.paused && this.watchlist.length > 0;
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
        body: JSON.stringify({ queries: this.watchlist }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || `HTTP ${response.status}`);
      if (sequence !== this.requestSequence) return;
      this.rows = Array.isArray(payload.rows) ? payload.rows : [];
      this.unresolved = Array.isArray(payload.unresolved) ? payload.unresolved : [];
      this.lastFetchedAt = payload.fetchedAt || new Date().toISOString();
      this.error = "";
      this.render();
      if (manual) this.onToast(`已刷新 ${this.rows.length} 只债券`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (sequence !== this.requestSequence) return;
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

  render() {
    const interval = this.root.querySelector("#realtimeQuoteInterval");
    if (interval) interval.value = String(this.intervalMs / 1_000);
    this.renderTable();
    this.renderSummary();
    this.renderStatus();
  }

  renderTable() {
    const body = this.root.querySelector("#realtimeQuoteTableBody");
    const empty = this.root.querySelector("#realtimeQuoteEmptyState");
    const table = this.root.querySelector("#realtimeQuoteTable");
    if (!body || !empty || !table) return;
    empty.hidden = this.watchlist.length > 0;
    table.hidden = this.watchlist.length === 0;
    if (!this.watchlist.length) {
      body.innerHTML = "";
      return;
    }
    const resolvedHtml = this.rows.map(renderQuoteRow).join("");
    const unresolvedHtml = this.unresolved.map(renderUnresolvedRow).join("");
    body.innerHTML = resolvedHtml || unresolvedHtml
      ? `${resolvedHtml}${unresolvedHtml}`
      : this.loading
        ? renderLoadingRows(Math.min(this.watchlist.length, 8))
        : this.watchlist.map((query) => renderPendingRow(query)).join("");
  }

  renderSummary() {
    const twoSided = this.rows.filter((row) => row.status === "two-sided").length;
    const oneSided = this.rows.filter((row) => row.status === "bid-only" || row.status === "ofr-only").length;
    const representedQueries = new Set([
      ...this.rows.map((row) => row.query),
      ...this.unresolved.map((row) => row.query),
    ]);
    const pending = this.watchlist.filter((query) => !representedQueries.has(query)).length;
    const noQuote = this.rows.filter((row) => row.status === "no-quote").length + this.unresolved.length + pending;
    setText(this.root, "#realtimeQuoteUniverseCount", this.watchlist.length);
    setText(this.root, "#realtimeQuoteTwoSidedCount", twoSided);
    setText(this.root, "#realtimeQuoteOneSidedCount", oneSided);
    setText(this.root, "#realtimeQuoteNoPriceCount", noQuote);
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
      detailText = "正在读取 DM 当日最优报价";
    } else if (this.error) {
      label = "连接异常";
      status = "error";
      detailText = this.error;
    } else if (this.paused) {
      label = "已暂停";
      status = "paused";
      detailText = "自动轮询已暂停";
    } else if (!this.active || document.hidden) {
      label = this.watchlist.length ? "后台暂停" : "待导入";
      status = "idle";
      detailText = this.watchlist.length ? "返回实时行情 Tab 后继续" : "导入券池后开始轮询";
    } else if (this.watchlist.length) {
      label = "LIVE";
      status = "live";
      detailText = `每 ${this.intervalMs / 1_000} 秒读取 DM`;
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

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ watchlist: this.watchlist, intervalMs: this.intervalMs }));
    } catch {
      // A blocked local cache must not stop live quote retrieval.
    }
  }
}

function renderQuoteRow(row) {
  return `<tr data-quote-status="${escapeAttribute(row.status || "no-quote")}">
    <td class="quote-identity-cell"><strong>${escapeHtml(row.shortName || row.query || "未命名")}</strong><span>${escapeHtml(row.securityId || "--")}</span></td>
    <td class="quote-tenor-cell">${escapeHtml(row.remainingTenor || "--")}</td>
    <td class="quote-source-cell"><span>DM</span><small>经纪商聚合</small></td>
    <td class="quote-volume-cell bid-volume">${formatQuoteNumber(row.bid?.volumeWan, 0)}</td>
    <td class="quote-price-cell bid-price">${renderPrice(row.bid)}</td>
    <td class="quote-spread-cell">${formatSpread(row.spread)}</td>
    <td class="quote-price-cell ofr-price">${renderPrice(row.ofr)}</td>
    <td class="quote-volume-cell ofr-volume">${formatQuoteNumber(row.ofr?.volumeWan, 0)}</td>
    <td class="quote-time-cell"><strong>${escapeHtml(row.quoteTime || "--")}</strong><span>${escapeHtml(row.quoteDate || "当日")}</span></td>
    <td class="quote-action-cell"><button type="button" data-remove-realtime-query="${escapeAttribute(row.query)}" aria-label="移除 ${escapeAttribute(row.shortName || row.query)}">×</button></td>
  </tr>`;
}

function renderUnresolvedRow(item) {
  return `<tr data-quote-status="unresolved">
    <td class="quote-identity-cell"><strong>${escapeHtml(item.query)}</strong><span>未匹配券码</span></td>
    <td>--</td><td class="quote-source-cell"><span>DM</span><small>基础资料</small></td>
    <td>--</td><td class="quote-price-cell bid-price"><strong>--</strong></td><td class="quote-spread-cell">--</td>
    <td class="quote-price-cell ofr-price"><strong>--</strong></td><td>--</td>
    <td class="quote-time-cell"><strong>未匹配</strong><span>${escapeHtml(item.reason || "请核对简称")}</span></td>
    <td class="quote-action-cell"><button type="button" data-remove-realtime-query="${escapeAttribute(item.query)}" aria-label="移除 ${escapeAttribute(item.query)}">×</button></td>
  </tr>`;
}

function renderPendingRow(query) {
  return `<tr data-quote-status="pending">
    <td class="quote-identity-cell"><strong>${escapeHtml(query)}</strong><span>等待首次刷新</span></td>
    <td>--</td><td class="quote-source-cell"><span>DM</span><small>待查询</small></td><td>--</td>
    <td class="quote-price-cell bid-price"><strong>--</strong></td><td class="quote-spread-cell">--</td>
    <td class="quote-price-cell ofr-price"><strong>--</strong></td><td>--</td><td>--</td>
    <td class="quote-action-cell"><button type="button" data-remove-realtime-query="${escapeAttribute(query)}" aria-label="移除 ${escapeAttribute(query)}">×</button></td>
  </tr>`;
}

function renderLoadingRows(count) {
  return Array.from({ length: count }, () => '<tr class="quote-loading-row"><td colspan="10"><span></span></td></tr>').join("");
}

function renderPrice(side = {}) {
  const yieldValue = formatQuoteNumber(side.yield, 4);
  const priceValue = Number.isFinite(side.netPrice) ? `净价 ${formatQuoteNumber(side.netPrice, 4)}` : "净价 --";
  return `<strong>${yieldValue}${yieldValue === "--" ? "" : '<em>%</em>'}</strong><span>${priceValue}</span>`;
}

function formatSpread(spread = {}) {
  if (Number.isFinite(spread.yieldPct)) return `${formatQuoteNumber(spread.yieldPct * 100, 2)}<small>bp</small>`;
  if (Number.isFinite(spread.netPrice)) return `${formatQuoteNumber(spread.netPrice, 4)}<small>元</small>`;
  return "--";
}

function formatQuoteNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatChinaDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
}

function loadSavedState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const intervalMs = SUPPORTED_INTERVALS.has(Number(value?.intervalMs)) ? Number(value.intervalMs) : DEFAULT_INTERVAL_MS;
    const watchlist = unique((Array.isArray(value?.watchlist) ? value.watchlist : []).map((item) => String(item || "").trim()).filter(Boolean)).slice(0, MAX_SECURITIES);
    return { watchlist, intervalMs };
  } catch {
    return { watchlist: [], intervalMs: DEFAULT_INTERVAL_MS };
  }
}

function cleanImportToken(value = "") {
  const text = String(value || "").trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (!text || /^(?:代码|券码|债券代码|简称|债券简称|名称|security.?id)$/i.test(text)) return "";
  if (text.length > 80) return "";
  return text.toUpperCase().replace(/\.(ib|sh|sz)$/i, (suffix) => suffix.toUpperCase());
}

function addImportToken(value, output, seen) {
  const token = cleanImportToken(value);
  if (!token || seen.has(token)) return;
  seen.add(token);
  output.push(token);
}

function unique(values) {
  return [...new Set(values)];
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = String(value);
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
