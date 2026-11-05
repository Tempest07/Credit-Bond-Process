import assert from "node:assert/strict";
import { createMemoryD1 } from "./helpers/d1-memory.js";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import worker, { processPaymentReceiptEmail, processPaymentReceiptFile, recordPaymentReceiptStatus } from "../payment-receipt-worker.js";
import { dispatchRequestedPaymentReceiptFiles } from "../functions/api/_payment-receipt-rebuild.js";
import { onRequestGet } from "../functions/api/payment-receipt-status.js";
import {
  ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile,
  insertPaymentReceiptEvent, listPaymentReceiptStatus, paymentReceiptStatusDetail,
} from "../functions/api/_payment-receipts.js";

function sqliteDb(t) {
  const db = createMemoryD1();
  t.after(() => db.sql.close());
  const prepare = db.prepare;
  const wrap = (statement) => ({ ...statement, bind(...values) { return wrap(statement.bind(...values)); }, async all() { return statement.execute(); } });
  db.prepare = (sql) => wrap(prepare(sql));
  return db;
}

const receivedAt = "2026-11-05T01:02:03.000Z";
async function seed(db, { batchId = "b1", fileId = "f1", ownerUserId = "admin", status = "queued", filename = "缴款单.pdf", sha256 = "sha1" } = {}) {
  await insertPaymentReceiptBatch(db, { id: batchId, ownerUserId, messageId: batchId, subject: "缴款邮件",
    receivedAt, receivedDate: "2026-11-05", rawObjectKey: "private/raw.eml", createdAt: receivedAt });
  if (fileId) await insertPaymentReceiptFile(db, { id: fileId, batchId, filename,
    mimeType: "application/pdf", byteSize: 10, sha256, objectKey: "private/source.pdf", processingStatus: status, createdAt: receivedAt });
}

async function event(db, { id = crypto.randomUUID(), batchId = "b1", fileId, ownerUserId = "admin", eventType, createdAt = receivedAt, detail = {} }) {
  await insertPaymentReceiptEvent(db, { id, batchId, ownerUserId, eventType, createdAt, detail: { ...detail, ...(fileId ? { fileId } : {}) } });
}

test("status feed scopes jobs and events to owner and file, excludes private payloads", async (t) => {
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  await seed(db, { status: "processing" });
  await insertPaymentReceiptFile(db, { id: "f2", batchId: "b1", filename: "另一份.pdf", mimeType: "application/pdf", byteSize: 1,
    sha256: "sha2", objectKey: "private/other.pdf", processingStatus: "processed", createdAt: receivedAt });
  await seed(db, { batchId: "private-batch", fileId: "private-file", ownerUserId: "someone-else" });
  await event(db, { eventType: "email_received" });
  await event(db, { fileId: "f1", eventType: "file_page_started", createdAt: "2026-11-05T01:03:00.000Z",
    detail: { pageNumber: 2, pageCount: 3, recognizedText: "private OCR", objectKey: "private/key", apiKey: "secret" } });
  await event(db, { fileId: "f2", eventType: "file_processed" });
  await event(db, { fileId: "f1", ownerUserId: "someone-else", eventType: "file_processing_failed" });
  const status = await listPaymentReceiptStatus(db, "admin");
  assert.equal(status.jobs.length, 2);
  const first = status.jobs.find((job) => job.id === "f1");
  assert.equal(first.outcome, "active");
  assert.equal(first.updatedAt, "2026-11-05T01:03:00.000Z");
  assert.deepEqual(first.progress, { stage: "file_page_started", pageNumber: 2, pageCount: 3 });
  assert.deepEqual(first.events.map((item) => item.eventType), ["email_received", "file_page_started"]);
  assert.doesNotMatch(JSON.stringify(status), /private|secret|apiKey|recognizedText|objectKey/);
});

test("status feed retains unfinished emails, failed permanent jobs and honest legacy history", async (t) => {
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  await seed(db, { batchId: "empty", fileId: "" });
  await seed(db, { batchId: "rejected", fileId: "rejected-file", status: "review" });
  await event(db, { batchId: "rejected", fileId: "rejected-file", eventType: "file_processing_rejected", detail: { error: "已加密" } });
  await seed(db, { batchId: "legacy", fileId: "legacy-file", status: "processed" });
  const status = await listPaymentReceiptStatus(db, "admin");
  assert.equal(status.jobs.find((job) => job.id === "empty").kind, "email");
  assert.equal(status.jobs.find((job) => job.id === "rejected-file").outcome, "failed");
  const legacy = status.jobs.find((job) => job.id === "legacy-file");
  assert.equal(legacy.outcome, "success");
  assert.deepEqual(legacy.events, []);
  assert.equal(legacy.updatedAt, receivedAt);
});

test("status API is authenticated, no-store, bounded, and reports truncated history", async (t) => {
  let queried = false;
  const denied = await onRequestGet({ request: new Request("https://example.test/api/payment-receipt-status"), env: { DB: { prepare() { queried = true; } } } });
  assert.equal(denied.status, 401);
  assert.equal(queried, false);
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  for (let index = 0; index < 51; index += 1) await seed(db, { batchId: `b${index}`, fileId: `f${index}` });
  for (let index = 0; index < 165; index += 1) await event(db, { batchId: "b9", fileId: "f9", eventType: "file_page_started", createdAt: new Date(Date.parse(receivedAt) + index).toISOString() });
  const response = await onRequestGet({ request: new Request("http://localhost/api/payment-receipt-status?limit=9999&ownerUserId=someone-else"), env: { DB: db } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const status = await response.json();
  assert.equal(status.jobs.length, 50);
  assert.equal(status.hasMore, true);
  const job = status.jobs.find((item) => item.id === "f9");
  assert.equal(job.eventsTruncated, true);
  assert.equal(job.events.length, 160);
});

test("status recording failure cannot reject document processing and only stores allowed fields", async () => {
  assert.deepEqual(paymentReceiptStatusDetail({ fileId: "f1", pageCount: 2, rawText: "private", apiKey: "secret" }), { fileId: "f1", pageCount: 2 });
  const original = console.error;
  const logs = [];
  console.error = (value) => logs.push(value);
  try {
    assert.equal(await recordPaymentReceiptStatus({ prepare() { throw new Error("private DB error"); } }, { batchId: "b1" }, "file_processed"), false);
    assert.doesNotMatch(logs.join(""), /private DB error/);
  } finally { console.error = original; }
});

async function scannedPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([100, 100]);
  const image = document.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    Type: "XObject", Subtype: "Image", Width: 2, Height: 2, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode",
  });
  page.node.newXObject("Image", document.context.register(image));
  return document.save({ useObjectStreams: false });
}

test("PDF pipeline exposes live page progress, then completion without changing payment state", async (t) => {
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  const bytes = await scannedPdf();
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  await seed(db, { sha256 });
  await event(db, { eventType: "email_attachments_extracted" });
  let aiCalls = 0;
  const env = { DB: db, AI_PROCESSING_APPROVED: "true",
    PAYMENT_RECEIPTS: { async get() { return { arrayBuffer: async () => bytes.buffer }; }, async put() {} },
    AI: { async run() {
      aiCalls += 1;
      const live = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
      assert.equal(live.processingStatus, "processing");
      assert.equal(live.progress.stage, "file_page_started");
      assert.equal(live.progress.pageNumber, 1);
      assert.equal(live.filename, "缴款单.pdf");
      if (aiCalls === 2) return { response: { nameField: "26测试01", remittanceName: "26测试01", securityCode: "123456.SH", uncertainties: [] } };
      return { response: JSON.stringify({ classification: "receipt_start", confidence: 0.98,
        document_title: "测试配售确认及缴款通知书", bond_short_name: "26测试01", security_code: "123456.SH", payment_date: "2026-11-05", amount_text: "1000万元" }) };
    } },
  };
  await processPaymentReceiptFile(env, { batchId: "b1", fileId: "f1", ownerUserId: "admin", filename: "缴款单.pdf", objectKey: "private/source.pdf", receivedDate: "2026-11-05" });
  const job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
  assert.equal(job.outcome, "success");
  assert.deepEqual(job.events.filter((entry) => entry.eventType.startsWith("file_")).map((entry) => entry.eventType), [
    "file_processing_started", "file_page_started", "file_page_completed", "file_grouping_started", "file_matching_started", "file_processed",
  ]);
  assert.equal(job.events.at(-1).detail.receiptCount, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM payment_receipts").first()).count, 1);
});

test("reprocessing keeps an older source visible and never reports previous-run progress", async (t) => {
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  for (let index = 0; index < 55; index += 1) await seed(db, { batchId: `new-${index}`, fileId: `new-${index}`, status: "processed" });
  await seed(db, { batchId: "old-batch", fileId: "old-file", status: "reprocess_requested" });
  await db.prepare("UPDATE payment_receipt_batches SET received_at='2025-01-01T00:00:00.000Z' WHERE id='old-batch'").run();
  await event(db, { batchId: "old-batch", fileId: "old-file", eventType: "file_page_started", detail: { pageNumber: 8, pageCount: 10 }, createdAt: "2026-01-01T00:00:00.000Z" });
  await event(db, { batchId: "old-batch", fileId: "old-file", eventType: "file_processing_failed", createdAt: "2026-01-01T00:01:00.000Z" });
  await event(db, { batchId: "old-batch", fileId: "old-file", eventType: "file_reprocess_requested" });
  let job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
  assert.equal(job.id, "old-file");
  assert.equal(job.receivedAt, "2025-01-01T00:00:00.000Z");
  assert.equal(job.outcome, "active");
  assert.equal(job.progress.pageNumber, null);
  assert.equal(job.progress.stage, "reprocess_requested");
  await db.prepare("UPDATE payment_receipt_files SET processing_status='processing' WHERE id='old-file'").run();
  await event(db, { batchId: "old-batch", fileId: "old-file", eventType: "file_processing_started", createdAt: "2026-11-05T01:03:00.000Z" });
  job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
  assert.equal(job.progress.stage, "file_processing_started");
  assert.equal(job.progress.pageNumber, null);
});

test("5.4 reprocess dispatch records successful queues and failed sends that remain pending", async (t) => {
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  await seed(db, { status: "reprocess_requested" });
  const file = { id: "f1", batch_id: "b1", filename: "缴款单.pdf", received_date: "2026-11-05", object_key: "private/source.pdf" };
  await dispatchRequestedPaymentReceiptFiles({ DB: db, RECEIPT_QUEUE: { async send() { throw new Error("private queue failure"); } } }, "admin", [file], receivedAt);
  let job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
  assert.equal(job.processingStatus, "reprocess_requested");
  assert.equal(job.outcome, "active");
  assert.equal(job.events.at(-1).eventType, "file_queue_failed");
  assert.doesNotMatch(JSON.stringify(job), /private queue failure/);
  const updated = (await db.prepare("SELECT updated_at FROM payment_receipt_files WHERE id='f1'").first()).updated_at;
  await dispatchRequestedPaymentReceiptFiles({ DB: db, RECEIPT_QUEUE: { async send() {} } }, "admin", [file], updated);
  job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
  assert.equal(job.processingStatus, "queued");
  assert.equal(job.events.at(-1).eventType, "file_retry_queued");
});

test("5.4 ordinary no-PDF emails remain archived while invalid PDF attachments are failed", async (t) => {
  for (const invalidPdf of [false, true]) {
    const db = sqliteDb(t);
    await ensurePaymentReceiptSchema(db);
    await seed(db, { fileId: "" });
    const raw = new TextEncoder().encode(invalidPdf
      ? 'From: sender@example.com\r\nTo: receipt@example.com\r\nMIME-Version: 1.0\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="broken.pdf"\r\n\r\nnot a PDF'
      : 'From: sender@example.com\r\nTo: receipt@example.com\r\nContent-Type: text/plain\r\n\r\nOrdinary message');
    const env = { DB: db, RECEIPT_QUEUE: { async send() { assert.fail("no valid PDF to queue"); } },
      PAYMENT_RECEIPTS: { async get() { return { arrayBuffer: async () => raw }; } } };
    await processPaymentReceiptEmail(env, { kind: "email", ownerUserId: "admin", batchId: "b1", rawObjectKey: "private/raw.eml" });
    const job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
    assert.equal(job.kind, "email");
    assert.equal(job.outcome, invalidPdf ? "failed" : "success");
    assert.equal(job.events[0].eventType, "email_processing_started");
    assert.equal(job.events.at(-1).eventType, invalidPdf ? "email_invalid_pdf_attachment" : "email_archived_without_payment_pdf");
  }
});

test("corrupt PDF queue job is recorded as failed and waits for manual handling", async (t) => {
  const db = sqliteDb(t);
  await ensurePaymentReceiptSchema(db);
  await seed(db);
  let acknowledged = false;
  const original = console.error;
  console.error = () => {};
  try {
    await worker.queue({ queue: "receipts", messages: [{ attempts: 1,
      body: { kind: "file", ownerUserId: "admin", batchId: "b1", fileId: "f1", objectKey: "private/source.pdf" },
      ack() { acknowledged = true; }, retry() { assert.fail("permanent errors must not retry"); },
    }] }, { DB: db, AI: {}, AI_PROCESSING_APPROVED: "true", PAYMENT_RECEIPTS: { async get() { return { arrayBuffer: async () => new TextEncoder().encode("broken PDF").buffer }; } } });
  } finally { console.error = original; }
  assert.equal(acknowledged, true);
  const job = (await listPaymentReceiptStatus(db, "admin")).jobs[0];
  assert.equal(job.processingStatus, "review");
  assert.equal(job.outcome, "failed");
  assert.equal(job.events.at(-1).eventType, "file_processing_rejected");
  assert.match(job.errorMessage, /PDF 无法读取/);
});
