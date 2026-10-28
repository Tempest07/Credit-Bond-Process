import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createMemoryD1 } from "./helpers/d1-memory.js";
import { ensureAuthSchema } from "../functions/api/_auth.js";
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile,
  insertPaymentReceipt, insertPaymentReceiptMatch, listPendingPaymentReceiptFiles } from "../functions/api/_payment-receipts.js";
import { onRequestPost as batchDelete } from "../functions/api/payment-receipts/batch-delete.js";
import { onRequestDelete as singleDelete } from "../functions/api/payment-receipts/[id].js";
import { onRequestGet as receiptFile } from "../functions/api/payment-receipts/[id]/file.js";

const ORIGIN = "http://127.0.0.1:8788";
const NOW = "2026-10-29T01:00:00.000Z";

async function fixture(t) {
  const DB = createMemoryD1();
  t.after(() => DB.sql.close());
  DB.sql.exec("PRAGMA foreign_keys=ON");
  const originalPrepare = DB.prepare;
  const wrap = (query, statement) => ({ ...statement, query,
    bind(...values) { return wrap(query, statement.bind(...values)); },
    async all() { return statement.execute(); },
  });
  DB.prepare = query => wrap(query, originalPrepare(query));
  const originalBatch = DB.batch.bind(DB);
  let beforeDelete;
  DB.batch = async statements => {
    if (beforeDelete && statements.some(statement => /receipts_batch_deleted/.test(statement.query))) {
      const hook = beforeDelete; beforeDelete = null; await hook();
    }
    return originalBatch(statements);
  };
  await ensureAuthSchema(DB);
  await ensurePaymentReceiptSchema(DB);
  for (const [batchId, ownerUserId] of [["batch", "admin"], ["other-batch", "other"]]) {
    await insertPaymentReceiptBatch(DB, { id: batchId, ownerUserId, messageId: batchId, receivedAt: NOW,
      receivedDate: "2026-10-29", rawObjectKey: batchId + ".eml", processingStatus: "processed", createdAt: NOW });
    await insertPaymentReceiptFile(DB, { id: batchId + "-file", batchId, filename: batchId + ".pdf", mimeType: "application/pdf",
      byteSize: 100, sha256: batchId, objectKey: batchId + ".pdf", pageCount: 3, processingStatus: "processed", createdAt: NOW });
  }
  for (const [id, ownerUserId, matchStatus, sourcePages] of [
    ["matched", "admin", "review", [1]], ["duplicate", "admin", "duplicate", [2]],
    ["unmatched", "admin", "unmatched", [3]], ["error", "admin", "error", [1, 2]],
    ["other", "other", "unmatched", [1]],
  ]) {
    const batchId = ownerUserId === "admin" ? "batch" : "other-batch";
    await insertPaymentReceipt(DB, { id, ownerUserId, batchId, fileId: batchId + "-file", sourcePages,
      sourcePageLabel: sourcePages.join(","), objectKey: id + ".pdf", sha256: id, bondShortName: "26苏交通CP008",
      securityCode: "042680338", amountFen: 42000000000, paymentDate: "2026-10-29", recognitionStatus: "recognized", matchStatus, createdAt: NOW });
  }
  await insertPaymentReceiptMatch(DB, { id: "manual", ownerUserId: "admin", receiptId: "matched", projectId: "project",
    trancheId: "tranche", matchSource: "manual", createdAt: NOW });
  const stored = new Map();
  const reads = [];
  const writes = [];
  const PAYMENT_RECEIPTS = {
    async get(key, options) {
      reads.push({ key, options });
      const bytes = stored.get(key);
      return bytes ? { body: bytes, size: bytes.byteLength, async arrayBuffer() { return bytes; }, httpEtag: '"etag"',
        writeHttpMetadata(headers) { headers.set("Content-Disposition", "inline; filename=wrong.pdf"); } } : null;
    },
    async delete(keys) { writes.push(keys); },
    async put(key) { writes.push(key); },
  };
  function context(path, options = {}) {
    return { env: { DB, PAYMENT_RECEIPTS }, params: { id: options.id || "matched" },
      request: new Request((options.urlOrigin || ORIGIN) + path, { method: options.method || "GET",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", ...options.headers },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      }) };
  }
  const remove = (ids, options = {}) => batchDelete(context("/api/payment-receipts/batch-delete", { method: "POST", body: { receiptIds: ids }, ...options }));
  const rows = table => DB.sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => ({ ...row }));
  return { DB, remove, context, rows, reads, writes, stored, beforeDelete(hook) { beforeDelete = hook; } };
}

test("mixed receipt bulk deletion removes arbitrary statuses and matches while retaining originals and audit", async t => {
  const h = await fixture(t), originalFiles = h.rows("payment_receipt_files"), batches = h.rows("payment_receipt_batches");
  const response = await h.remove(["matched", "duplicate", "unmatched", "error", "matched"]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.deletedCount, 4);
  assert.equal(body.originalsPreserved, true);
  assert.deepEqual(h.rows("payment_receipts").map(row => row.id), ["other"]);
  assert.deepEqual(h.rows("payment_receipt_matches"), []);
  for (const file of h.rows("payment_receipt_files")) {
    const old = originalFiles.find(row => row.id === file.id);
    assert.deepEqual({ ...file, updated_at: old.updated_at }, old);
  }
  assert.deepEqual(h.rows("payment_receipt_batches"), batches);
  assert.deepEqual(h.writes, []);
  const event = h.rows("payment_receipt_events")[0];
  assert.equal(event.event_type, "receipts_batch_deleted");
  const receipts = JSON.parse(event.detail_json).receipts;
  assert.equal(receipts.length, 4);
  assert.deepEqual(receipts.find(row => row.receiptId === "matched"), {
    receiptId: "matched", fileId: "batch-file", batchId: "batch", sourcePages: [1], sourcePageLabel: "1",
    bondShortName: "26苏交通CP008", securityCode: "042680338", paymentDate: "2026-10-29", amountFen: 42000000000,
    matchStatus: "matched", projectId: "project", trancheId: "tranche", matchSource: "manual",
    fileStatus: "processed", fileError: "", batchStatus: "processed",
  });
  assert.deepEqual(await listPendingPaymentReceiptFiles(h.DB, "admin"), []);
});

test("single delete action accepts an already matched receipt", async t => {
  const h = await fixture(t);
  const response = await singleDelete(h.context("/api/payment-receipts/matched?action=delete", { method: "DELETE" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deletedCount, 1);
  assert.equal(h.rows("payment_receipts").length, 4);
  assert.deepEqual(h.writes, []);
});

test("bulk deletion validates IDs and scope without partial deletion", async t => {
  const h = await fixture(t), before = h.rows("payment_receipts");
  for (const [ids, status] of [[[], 400], [null, 400], [[""], 400], [["matched", "missing"], 404], [["matched", "other"], 404], [Array(101).fill("matched"), 400]]) {
    assert.equal((await h.remove(ids)).status, status);
    assert.deepEqual(h.rows("payment_receipts"), before);
  }
  assert.equal((await h.remove(["matched"], { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await h.remove(["matched"], { urlOrigin: "https://example.com" })).status, 401);
  assert.deepEqual(h.rows("payment_receipt_events"), []);
});

test("processing transitions and late transaction failure roll back the entire selection", async t => {
  const h = await fixture(t), before = h.rows("payment_receipts"), matches = h.rows("payment_receipt_matches");
  h.beforeDelete(() => h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processing' WHERE id='batch-file'").run());
  assert.equal((await h.remove(["matched", "duplicate"])).status, 409);
  assert.deepEqual(h.rows("payment_receipts"), before);
  assert.deepEqual(h.rows("payment_receipt_matches"), matches);
  assert.deepEqual(h.rows("payment_receipt_events"), []);
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed' WHERE id='batch-file'").run();
  h.DB.setFail("DELETE FROM payment_receipts");
  assert.equal((await h.remove(["matched", "duplicate"])).status, 500);
  h.DB.setFail("");
  assert.deepEqual(h.rows("payment_receipts"), before);
  assert.deepEqual(h.rows("payment_receipt_matches"), matches);
  assert.deepEqual(h.rows("payment_receipt_events"), []);
  h.DB.setFail("UPDATE payment_receipt_files");
  assert.equal((await h.remove(["matched", "duplicate"])).status, 500);
  h.DB.setFail("");
  assert.deepEqual(h.rows("payment_receipts"), before);
  assert.deepEqual(h.rows("payment_receipt_matches"), matches);
  assert.deepEqual(h.rows("payment_receipt_events"), []);
});

test("deletion settles failed OCR retries without losing their diagnostic history", async t => {
  const h = await fixture(t);
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='error',error_message='old OCR failure' WHERE id='batch-file'").run();
  assert.equal((await h.remove(["matched"])).status, 200);
  let file = h.rows("payment_receipt_files").find(row => row.id === "batch-file");
  assert.equal(file.processing_status, "review");
  assert.equal(file.error_message, "");
  const audit = JSON.parse(h.rows("payment_receipt_events")[0].detail_json).receipts[0];
  assert.equal(audit.fileStatus, "error");
  assert.equal(audit.fileError, "old OCR failure");
  assert.equal((await h.remove(["duplicate", "unmatched", "error"])).status, 200);
  file = h.rows("payment_receipt_files").find(row => row.id === "batch-file");
  assert.equal(file.processing_status, "processed");
  assert.deepEqual(await listPendingPaymentReceiptFiles(h.DB, "admin"), []);
});

async function makePdf(count) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index++) pdf.addPage([200 + index, 300]);
  return pdf.save();
}

test("receipt download serves only the saved split object with an attachment filename", async t => {
  const h = await fixture(t), split = await makePdf(1);
  h.stored.set("matched.pdf", split);
  const response = await receiptFile(h.context("/api/payment-receipts/matched/file?download=1"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition"), /^attachment; filename\*=UTF-8''/);
  assert.match(decodeURIComponent(response.headers.get("Content-Disposition")), /26苏交通CP008\.pdf/);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 1);
  assert.deepEqual(h.reads.map(row => row.key), ["matched.pdf"]);
  assert.deepEqual(h.writes, []);
});

test("a missing split object is rebuilt from just its original source pages", async t => {
  const h = await fixture(t);
  h.DB.sql.prepare("UPDATE payment_receipts SET source_pages_json='[2,3]',source_page_label='2-3' WHERE id='matched'").run();
  h.stored.set("batch.pdf", await makePdf(3));
  const response = await receiptFile(h.context("/api/payment-receipts/matched/file?download=1"));
  assert.equal(response.status, 200);
  const result = await PDFDocument.load(await response.arrayBuffer());
  assert.equal(result.getPageCount(), 2);
  assert.equal(result.getPage(0).getWidth(), 201);
  assert.equal(result.getPage(1).getWidth(), 202);
  assert.deepEqual(h.writes, []);
});

test("download does not expose an entire source PDF for a legacy receipt and invalid pages fail clearly", async t => {
  const h = await fixture(t);
  h.DB.sql.prepare("UPDATE payment_receipts SET object_key='batch.pdf' WHERE id='matched'").run();
  h.stored.set("batch.pdf", await makePdf(3));
  let response = await receiptFile(h.context("/api/payment-receipts/matched/file"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition"), /^inline;/);
  assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 1);
  h.DB.sql.prepare("UPDATE payment_receipts SET source_pages_json='[4]' WHERE id='matched'").run();
  response = await receiptFile(h.context("/api/payment-receipts/matched/file?download=1"));
  assert.equal(response.status, 409);
});

test("receipt download enforces ownership before any object storage access", async t => {
  const h = await fixture(t);
  assert.equal((await receiptFile(h.context("/api/payment-receipts/other/file?download=1", { id: "other" }))).status, 404);
  assert.equal((await receiptFile(h.context("/api/payment-receipts/matched/file?download=1", { urlOrigin: "https://example.com" }))).status, 401);
  assert.deepEqual(h.reads, []);
});
