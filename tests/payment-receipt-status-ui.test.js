import assert from "node:assert/strict";
import test from "node:test";
import { filterReceiptFlowJobs, formatReceiptFlowTime, initializePaymentReceiptStatus, receiptFlowEvents, receiptFlowStages, receiptFlowState, renderReceiptFlowJob } from "../payment-receipt-status.js";

test("shows each active file's current PDF page and gives a new attempt precedence over old failures", () => {
  const job = { kind: "file", processingStatus: "processing", outcome: "failed", events: [
    { eventType: "file_page_started", createdAt: "2026-11-05T02:02:00Z", detail: { pageNumber: 3, pageCount: 8 } },
    { eventType: "file_processing_failed", createdAt: "2026-11-05T02:00:00Z" },
    { eventType: "file_processing_started", createdAt: "2026-11-05T02:01:00Z" },
  ] };
  assert.deepEqual(receiptFlowState(job), { kind: "active", label: "正在识别页面 · 第 3 / 8 页" });
  assert.equal(receiptFlowEvents(job)[0].eventType, "file_processing_failed");
  assert.equal(job.events[0].eventType, "file_page_started");
  assert.equal(receiptFlowState({ ...job, processingStatus: "queued" }).label, "已接收，等待解析");
  assert.deepEqual(receiptFlowState({ ...job, processingStatus: "reprocess_requested" }), { kind: "active", label: "已请求重新解析，等待处理" });
  assert.equal(receiptFlowStages({ ...job, processingStatus: "reprocess_requested" })[1].state, "active");
  assert.equal(receiptFlowState({ ...job, events: [...job.events,
    { eventType: "email_processing_started", createdAt: "2026-11-05T02:03:00Z" },
  ] }).label, "正在识别页面 · 第 3 / 8 页");
  assert.equal(receiptFlowState({ ...job, events: [...job.events,
    { eventType: "file_reprocess_requested", createdAt: "2026-11-05T02:04:00Z" },
  ] }).label, "正在解析 PDF");
});

test("distinguishes successful parsing, manual review, retryable failure and permanent failure", () => {
  assert.equal(receiptFlowState({ processingStatus: "processed" }).kind, "success");
  assert.equal(receiptFlowState({ processingStatus: "review" }).kind, "review");
  assert.equal(receiptFlowState({ processingStatus: "error" }).label, "解析失败，等待重试");
  assert.equal(receiptFlowState({ processingStatus: "review", outcome: "failed" }).label, "解析失败，需人工处理");
  assert.equal(receiptFlowState({ processingStatus: "review", events: [{ eventType: "file_dead_lettered" }] }).kind, "failed");
  assert.equal(receiptFlowState({ processingStatus: "future-status" }).kind, "unknown");
  assert.deepEqual(receiptFlowState({ kind: "email", processingStatus: "processed", events: [{ eventType: "email_archived_without_payment_pdf" }] }),
    { kind: "success", label: "邮件已归档，无缴款 PDF" });
});

test("formats receipt and event timestamps explicitly in Beijing time", () => {
  assert.equal(formatReceiptFlowTime("2026-11-04T17:23:45Z"), "2026-11-05 01:23:45");
  assert.equal(formatReceiptFlowTime("bad date"), "时间未记录");
  assert.equal(formatReceiptFlowTime(null), "时间未记录");
});

test("searches file and subject with state filtering independent of payment-date archive filters", () => {
  const jobs = [
    { id: "a", filename: "通知.PDF", subject: "发行邮件", processingStatus: "queued" },
    { id: "b", filename: "资料.pdf", subject: "发行邮件", processingStatus: "processed" },
  ];
  assert.deepEqual(filterReceiptFlowJobs(jobs, { query: "pdf", status: "active" }).map((job) => job.id), ["a"]);
  assert.equal(filterReceiptFlowJobs(jobs, { query: "发行邮件" }).length, 2);
  assert.equal(filterReceiptFlowJobs(jobs, { status: "failed" }).length, 0);
});

test("escapes untrusted filenames, errors and event details, without inventing historical step times", () => {
  const html = renderReceiptFlowJob({ id: '" onmouseover="x', filename: '<img src=x onerror="x">',
    subject: "<script>x</script>", errorMessage: "<svg/onload=x>", processingStatus: "review",
    receivedAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:05:00Z", events: [],
  });
  assert.doesNotMatch(html, /<img|<script|<svg/);
  assert.match(html, /&lt;img/);
  assert.match(html, /2026-11-05 08:00:00/);
  assert.match(html, /此历史任务未记录分步时间/);
  assert.doesNotMatch(html, /开始解析 PDF|解析成功/);
  const error = renderReceiptFlowJob({ processingStatus: "error", events: [{ eventType: "file_processing_failed", detail: { error: "<svg>" } }] });
  assert.match(error, /&lt;svg&gt;/);
});

test("shows stalled work as unconfirmed and preserves truncated event history notice", () => {
  const html = renderReceiptFlowJob({ processingStatus: "processing", updatedAt: "2026-11-05T00:00:00Z", eventsTruncated: true }, { now: Date.parse("2026-11-05T01:00:00Z") });
  assert.match(html, /超过 30 分钟没有状态更新/);
  assert.match(html, /仅展示最近的处理事件/);
  assert.doesNotMatch(html, /receipt-flow-badge failed/);
});

test("phase display follows the current attempt and never fills unrecorded historical steps", () => {
  const event = (eventType, minute) => ({ eventType, createdAt: `2026-11-05T01:${String(minute).padStart(2, "0")}:00Z` });
  const job = { kind: "file", receivedAt: "2026-11-05T01:00:00Z", processingStatus: "processing", events: [
    event("file_queued", 1), event("file_processing_started", 2), event("file_page_started", 3),
  ] };
  assert.deepEqual(receiptFlowStages(job).map((stage) => stage.state), ["recorded", "recorded", "active", "unknown", "unknown"]);
  job.events.push(event("file_matching_started", 4), event("file_processing_failed", 5), event("file_processing_started", 6));
  assert.deepEqual(receiptFlowStages(job).map((stage) => stage.state), ["recorded", "unknown", "active", "unknown", "unknown"]);
  assert.deepEqual(receiptFlowStages({ ...job, processingStatus: "processed", events: [] }).map((stage) => stage.state), ["recorded", "unknown", "unknown", "unknown", "success"]);
  assert.equal(receiptFlowStages({ ...job, processingStatus: "review", outcome: "failed" }).some((stage) => stage.state === "active"), false);
  job.events.push(event("file_reprocess_requested", 7));
  assert.deepEqual(receiptFlowStages({ ...job, processingStatus: "reprocess_requested" }).map((stage) => stage.state), ["recorded", "active", "unknown", "unknown", "unknown"]);
});

test("logout clears displayed jobs and ignores late authorization responses from the previous session", async (t) => {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: "", value: "", addEventListener() {}, querySelectorAll() { return []; } });
    return nodes.get(selector);
  };
  const root = { querySelector: node, ownerDocument: { hidden: false, addEventListener() {}, removeEventListener() {} } };
  let unauthorized = 0, resolveLate, lateSignal;
  const fetch = t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200,
    json: async () => ({ jobs: [{ id: "private-file", filename: "private-file.pdf", processingStatus: "processed" }] }),
  }));
  const controller = initializePaymentReceiptStatus({ root, onUnauthorized() { unauthorized++; } });
  t.after(() => controller.destroy());
  controller.setActive(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(node("[data-flow-list]").innerHTML, /private-file.pdf/);
  fetch.mock.mockImplementation((_url, init) => { lateSignal = init.signal; return new Promise((resolve) => { resolveLate = resolve; }); });
  const pending = controller.refresh();
  controller.reset();
  assert.equal(lateSignal.aborted, true);
  assert.doesNotMatch(node("[data-flow-list]").innerHTML, /private-file/);
  resolveLate({ ok: false, status: 401 });
  await pending;
  assert.equal(unauthorized, 0);
  assert.doesNotMatch(node("[data-flow-list]").innerHTML, /private-file/);
});
