const ACTIVE_STATUSES = new Set(["received", "queued", "reprocess_requested", "processing", "regrouping"]);
const EVENT_LABELS = {
  email_received: "已收到邮件", email_resumed: "邮件重新入队", email_queued: "邮件等待解析",
  email_processing_started: "正在解析邮件附件", email_attachments_extracted: "邮件附件提取完成",
  email_no_pdf: "未找到有效 PDF 附件", email_processing_failed: "邮件解析失败",
  email_invalid_pdf_attachment: "PDF 附件无效", email_archived_without_payment_pdf: "邮件已归档，无缴款 PDF",
  email_processing_rejected: "邮件无法自动解析", email_dead_lettered: "邮件自动重试已停止",
  email_retry_queued: "邮件重新排队", email_queue_failed: "邮件入队失败", email_rejected_attachment_limit: "附件数量超过自动处理上限",
  file_received: "已提取 PDF 附件", file_queued: "PDF 等待解析", file_retry_queued: "PDF 重新排队",
  file_reprocess_requested: "已请求重新解析",
  file_processing_started: "开始解析 PDF", file_page_started: "正在识别页面",
  file_page_completed: "页面识别完成", file_analysis_reused: "已复用此前的页面识别结果",
  file_grouping_started: "正在识别首页、续页与空白页",
  file_matching_started: "正在提取缴款要素并匹配项目", receipt_extracted: "已提取缴款单",
  file_processed: "解析成功", file_review: "解析结束，待人工复核",
  file_processing_failed: "解析失败，等待重试", file_processing_rejected: "解析失败，需人工处理",
  file_dead_lettered: "自动重试已停止", file_queue_failed: "PDF 入队失败",
  file_regroup_commit_started: "开始保存人工拆页", file_manually_regrouped: "人工拆页修正完成",
  receipt_manually_matched: "已人工确认项目对应", receipt_manually_unmatched: "已解除项目对应",
};

export function formatReceiptFlowTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(value)).replaceAll("/", "-");
}

export function receiptFlowEvents(job) {
  return (Array.isArray(job.events) ? job.events : []).filter((event) => event && event.eventType)
    .slice().sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
}

export function receiptFlowEventLabel(event) {
  const detail = event.detail || {};
  const label = EVENT_LABELS[event.eventType] || "处理记录";
  if (detail.pageNumber) return `${label} · 第 ${detail.pageNumber}${detail.pageCount ? ` / ${detail.pageCount}` : ""} 页${detail.reused ? " · 已复用" : ""}`;
  if (event.eventType === "file_analysis_reused" && detail.completedPages) return `${label} · ${detail.completedPages} 页`;
  if (detail.receiptCount != null) return `${label} · ${detail.receiptCount} 张单据`;
  if (detail.sourcePages?.length) return `${label} · 第 ${detail.sourcePages.join("、")} 页`;
  return label;
}

export function receiptFlowState(job) {
  const events = receiptFlowEvents(job);
  const latest = events.at(-1);
  // Persisted task state takes precedence over a previous attempt's failure events.
  if (ACTIVE_STATUSES.has(job.processingStatus)) {
    if (job.processingStatus === "regrouping") return { kind: "active", label: "正在修正拆页" };
    if (job.processingStatus === "reprocess_requested") return { kind: "active", label: "已请求重新解析，等待处理" };
    if (job.processingStatus === "received" || job.processingStatus === "queued") return { kind: "active", label: "已接收，等待解析" };
    const ownEvents = events.filter((event) => event.eventType.startsWith(job.kind === "email" ? "email_" : "file_"));
    const restart = ownEvents.findLastIndex((event) => /(?:retry_queued|reprocess_requested|resumed|processing_started)$/.test(event.eventType));
    const processingEvent = ownEvents.slice(Math.max(0, restart)).findLast((event) => /(?:processing_started|page_started|grouping_started|matching_started)$/.test(event.eventType));
    return { kind: "active", label: processingEvent ? receiptFlowEventLabel(processingEvent) : job.kind === "email" ? "正在解析邮件附件" : "正在解析 PDF" };
  }
  if (job.processingStatus === "error" || job.outcome === "failed"
      || (job.processingStatus === "review" && /(?:failed|rejected|dead_lettered)$/.test(latest?.eventType || ""))) {
    return { kind: "failed", label: job.processingStatus === "error" ? "解析失败，等待重试" : "解析失败，需人工处理" };
  }
  if (job.processingStatus === "review") return { kind: "review", label: "解析结束，待人工复核" };
  if (job.processingStatus === "processed" && job.kind === "email" && events.some((event) => event.eventType === "email_archived_without_payment_pdf")) return { kind: "success", label: "邮件已归档，无缴款 PDF" };
  if (job.processingStatus === "processed") return { kind: "success", label: "解析成功" };
  return { kind: "unknown", label: "状态待确认" };
}

export function filterReceiptFlowJobs(jobs, { status = "", query = "" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return jobs.filter((job) => (!status || receiptFlowState(job).kind === status)
    && (!needle || `${job.filename || ""} ${job.subject || ""}`.toLocaleLowerCase().includes(needle)));
}

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function receiptFlowStages(job) {
  const events = receiptFlowEvents(job);
  const own = events.filter((event) => event.eventType.startsWith(job.kind === "email" ? "email_" : "file_"));
  const state = receiptFlowState(job);
  // A retry starts a new pass. Previous attempts remain in the event timeline only.
  const restart = own.findLastIndex((event) => /(?:retry_queued|reprocess_requested|resumed|processing_started)$/.test(event.eventType));
  const queued = own.findLastIndex((event) => /(?:queued|reprocess_requested|resumed)$/.test(event.eventType));
  const previousResult = own.slice(0, Math.max(0, restart)).findLastIndex((event) => /(?:processing_failed|processing_rejected|processed|review|dead_lettered)$/.test(event.eventType));
  const pass = restart < 0 ? own : own.slice(restart);
  const recorded = [
    Boolean(job.receivedAt),
    queued >= 0 && queued > previousResult,
    pass.some((event) => /(?:processing_started|page_started|page_completed|analysis_reused)$/.test(event.eventType)),
    pass.some((event) => /(?:grouping_started|matching_started|regroup_commit_started|manually_regrouped|attachments_extracted)$/.test(event.eventType)),
    false,
  ];
  const current = state.kind !== "active" ? 4
    : ["received", "queued", "reprocess_requested"].includes(job.processingStatus) ? 1
    : job.processingStatus === "regrouping" || recorded[3] ? 3 : 2;
  return (job.kind === "email" ? ["收件", "排队", "附件解析", "PDF 提取", "结果"] : ["收件", "排队", "解析", "拆页匹配", "结果"]).map((label, index) => ({
    label,
    state: index === current ? state.kind : index < current && recorded[index] ? "recorded" : "unknown",
  }));
}

function renderFlowTimestamp(value, label) {
  const formatted = formatReceiptFlowTime(value);
  const [date, time] = formatted.split(" ");
  return `<span class="receipt-flow-time" aria-label="${escape(`${label} ${formatted}`)}"><span class="receipt-flow-time-label">${label}</span>${time
    ? `<time datetime="${escape(value)}"><span>${escape(date)}</span><strong>${escape(time)}</strong></time>`
    : `<span>${escape(formatted)}</span>`}</span>`;
}

export function renderReceiptFlowJob(job, { open = false, now = Date.now() } = {}) {
  const state = receiptFlowState(job);
  const events = receiptFlowEvents(job);
  const title = job.filename || job.subject || "待提取附件的邮件";
  const updatedTime = Date.parse(job.updatedAt);
  const stalled = state.kind === "active" && Number.isFinite(updatedTime) && now - updatedTime > 30 * 60_000;
  const received = { eventType: "email_received", createdAt: job.receivedAt, detail: {} };
  const timeline = events.some((event) => event.eventType === "email_received") ? events : [received, ...events];
  const stages = receiptFlowStages(job);
  const pageCount = Number(job.progress?.pageCount || job.pageCount);
  const fileMeta = [job.kind === "email" ? "邮件" : "PDF", Number.isInteger(pageCount) && pageCount > 0 ? `${pageCount} 页` : ""].filter(Boolean).join(" · ");
  return `<details class="receipt-flow-job ${state.kind}" data-flow-job="${escape(job.id)}"${open ? " open" : ""}>
    <summary>
      <span class="receipt-flow-file"><strong>${escape(title)}</strong><span>${escape(fileMeta)}</span></span>
      ${renderFlowTimestamp(job.receivedAt, "收到时间")}
      ${renderFlowTimestamp(job.updatedAt, "最后更新")}
      <span class="receipt-flow-current"><span class="receipt-flow-badge ${state.kind}">${escape(state.label)}</span></span>
    </summary>
    <div class="receipt-flow-detail">
      <div class="receipt-flow-inspector">
      <section class="receipt-flow-process" aria-label="文件处理阶段">
      <div class="receipt-flow-detail-head"><strong>运行状态</strong><span>${escape(fileMeta)}</span></div>
      <ol class="receipt-flow-stages">${stages.map((stage) => `<li class="${stage.state}"${stage.state === "active" ? ' aria-current="step"' : ""}><span>${stage.label}</span></li>`).join("")}</ol>
      <p class="receipt-flow-stage-status ${state.kind}">${escape(state.label)}</p>
      ${job.filename && job.subject ? `<p class="receipt-flow-subject">邮件：${escape(job.subject)}</p>` : ""}
      ${job.errorMessage ? `<p class="receipt-flow-error">${escape(job.errorMessage)}</p>` : ""}
      ${stalled ? '<p class="receipt-flow-warning">已超过 30 分钟没有状态更新，任务尚未确认完成。</p>' : ""}
      </section>
      <section class="receipt-flow-event-panel" aria-label="处理时间线">
      <div class="receipt-flow-detail-head"><strong>事件记录</strong><span>北京时间</span></div>
      <ol class="receipt-flow-timeline" tabindex="0" aria-label="按发生时间排列的处理记录">${timeline.map((event) => `<li><time>${escape(formatReceiptFlowTime(event.createdAt))}</time><span>${escape(receiptFlowEventLabel(event))}${event.detail?.error ? `<span class="receipt-flow-event-error">${escape(event.detail.error)}</span>` : ""}</span></li>`).join("")}</ol>
      ${job.eventsTruncated ? '<p class="receipt-flow-history-note">仅展示最近的处理事件；收件时间保留。</p>' : ""}
      ${events.length ? "" : '<p class="receipt-flow-history-note">此历史任务未记录分步时间，当前状态以最后更新记录为准。</p>'}
      </section>
      </div>
    </div>
  </details>`;
}

export function initializePaymentReceiptStatus({ root, url = "./api/payment-receipt-status", headers = () => ({}), onUnauthorized = () => {}, onCompleted = () => {} }) {
  if (!root) return null;
  const list = root.querySelector("[data-flow-list]");
  const refreshButton = root.querySelector("[data-flow-refresh]");
  const statusSelect = root.querySelector("[data-flow-filter]");
  const search = root.querySelector("[data-flow-search]");
  const summary = root.querySelector("[data-flow-summary]");
  const sync = root.querySelector("[data-flow-sync]");
  const errorBox = root.querySelector("[data-flow-error]");
  const doc = root.ownerDocument;
  let jobs = [], active = false, timer = null, controller = null, fetchedAt = "", loaded = false, error = "";
  let requestVersion = 0;
  const expanded = new Set();

  function render() {
    const counts = { active: 0, success: 0, review: 0, failed: 0, unknown: 0 };
    jobs.forEach((job) => counts[receiptFlowState(job).kind]++);
    summary.innerHTML = [
      ["total", "最近任务", jobs.length], ["active", "处理中", counts.active],
      ["success", "已完成", counts.success], ["review", "待复核", counts.review],
      ["failed", "解析失败", counts.failed], ...(counts.unknown ? [["unknown", "状态待确认", counts.unknown]] : []),
    ].map(([kind, label, count]) => `<span class="receipt-flow-stat ${kind}"><span>${label}</span><strong>${count}</strong></span>`).join("");
    sync.textContent = fetchedAt ? `${error ? "上次成功更新" : "更新"} ${formatReceiptFlowTime(fetchedAt)} · 北京时间` : "北京时间 · 前台每 10 秒刷新";
    errorBox.hidden = !error;
    errorBox.textContent = error ? `状态读取失败：${error}${loaded ? "。当前保留上次结果。" : ""}` : "";
    refreshButton.disabled = Boolean(controller);
    refreshButton.textContent = controller ? "刷新中…" : "刷新动态";
    const visible = filterReceiptFlowJobs(jobs, { status: statusSelect.value, query: search.value });
    const html = visible.length ? visible.map((job) => renderReceiptFlowJob(job, { open: expanded.has(job.id) })).join("")
      : `<div class="empty receipt-flow-empty">${!loaded ? error ? "暂时无法读取处理动态。" : "正在读取处理动态…" : jobs.length ? "没有符合筛选条件的任务。" : "尚未收到缴款单邮件。"}</div>`;
    // Do not replace identical rows every poll: keep keyboard focus and expanded details stable.
    if (list.innerHTML !== html) {
      const focused = doc.activeElement?.closest("[data-flow-job]");
      const focusedId = focused?.dataset.flowJob;
      list.innerHTML = html;
      if (focusedId) [...list.querySelectorAll("[data-flow-job]")].find((row) => row.dataset.flowJob === focusedId)?.querySelector("summary")?.focus({ preventScroll: true });
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (active && !doc.hidden) timer = setTimeout(() => void refresh(), 10_000);
  }

  async function refresh() {
    if (controller || !active || doc.hidden) return;
    clearTimeout(timer);
    const version = ++requestVersion;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 20_000);
    render();
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: headers(), signal: request.signal });
      if (version !== requestVersion) return;
      if (response.status === 401) { reset(); onUnauthorized(); return; }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (!Array.isArray(payload.jobs)) throw new Error("状态响应格式不正确");
      if (version !== requestVersion) return;
      const next = payload.jobs;
      if (!loaded) {
        const current = next.find((job) => ACTIVE_STATUSES.has(job.processingStatus));
        if (current) expanded.add(current.id);
      }
      const completed = loaded && next.some((job) => !ACTIVE_STATUSES.has(job.processingStatus)
        && (!jobs.some((old) => old.id === job.id) || jobs.some((old) => old.id === job.id && old.updatedAt !== job.updatedAt)));
      jobs = next;
      fetchedAt = payload.fetchedAt || new Date().toISOString();
      loaded = true;
      error = "";
      if (completed) onCompleted();
    } catch (failure) {
      if (version !== requestVersion) return;
      error = failure.name === "AbortError" ? "请求超时，请重试" : failure.message || "网络不可用";
    } finally {
      clearTimeout(timeout);
      if (version === requestVersion) {
        controller = null;
        render();
        schedule();
      }
    }
  }

  function pause() {
    clearTimeout(timer);
    requestVersion++;
    controller?.abort();
    controller = null;
  }
  function reset() {
    active = false;
    pause();
    jobs = [];
    loaded = false;
    fetchedAt = "";
    error = "";
    expanded.clear();
    search.value = "";
    statusSelect.value = "";
    render();
  }
  list.addEventListener("toggle", (event) => {
    const row = event.target;
    if (!row.matches("[data-flow-job]")) return;
    if (row.open) expanded.add(row.dataset.flowJob);
    else expanded.delete(row.dataset.flowJob);
  }, true);
  refreshButton.addEventListener("click", () => void refresh());
  statusSelect.addEventListener("change", render);
  search.addEventListener("input", render);
  const visibility = () => { if (doc.hidden) pause(); else if (active) void refresh(); };
  doc.addEventListener("visibilitychange", visibility);
  return {
    refresh,
    reset,
    setActive(value) { active = Boolean(value); if (active) void refresh(); else pause(); },
    destroy() { active = false; pause(); doc.removeEventListener("visibilitychange", visibility); },
  };
}
