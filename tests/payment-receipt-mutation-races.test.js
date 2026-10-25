import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createMemoryD1 } from "./helpers/d1-memory.js";
import { ensureAuthSchema } from "../functions/api/_auth.js";
import {
  ensurePaymentReceiptSchema, insertPaymentReceipt, insertPaymentReceiptBatch,
  insertPaymentReceiptFile, insertPaymentReceiptMatch,
} from "../functions/api/_payment-receipts.js";
import { onRequestPatch, onRequestDelete } from "../functions/api/payment-receipts/[id].js";
import { onRequestPost as regroup } from "../functions/api/payment-receipt-files/[id]/regroup.js";

const NOW = "2026-10-25T10:00:00.000Z";

function barrier() {
  let reached;
  let release;
  return {
    entered: new Promise(resolve => { reached = resolve; }),
    released: new Promise(resolve => { release = resolve; }),
    reached: () => reached(),
    release: () => release(),
  };
}

async function fixture(t) {
  const DB = createMemoryD1();
  t.after(() => DB.sql.close());
  DB.sql.exec("PRAGMA foreign_keys = ON");
  const prepare = DB.prepare;
  const wrap = (query, statement) => ({
    ...statement, query,
    bind(...values) { return wrap(query, statement.bind(...values)); },
    async all() { return statement.execute(); },
  });
  DB.prepare = query => wrap(query, prepare(query));
  const batch = DB.batch.bind(DB);
  DB.beforeManualBatch = null;
  DB.beforeRegroupBatch = null;
  DB.batch = async statements => {
    if (/file_regroup_commit_started/.test(statements[0]?.query || "")) {
      await DB.beforeRegroupBatch?.();
    } else if (/INSERT INTO payment_receipt_events/.test(statements[0]?.query || "")
      && /r\.match_status (?:<>|=)/.test(statements[0]?.query || "")) {
      await DB.beforeManualBatch?.();
    }
    return batch(statements);
  };
  await ensureAuthSchema(DB);
  await ensurePaymentReceiptSchema(DB);
  const projects = ["a", "b"].map(suffix => ({
    id: `p-${suffix}`, shortName: `26测试0${suffix}`, tranches: [{
      id: `t-${suffix}`, shortName: `26测试0${suffix}`, securityCode: suffix === "a" ? "246129.SH" : "246130.SH",
      winningAmountWan: 1000, paymentDate: "2026-10-26",
    }],
  }));
  DB.sql.prepare("UPDATE user_app_state SET data = ? WHERE user_id = 'admin'").run(JSON.stringify({ issuers: [], projects }));
  await insertPaymentReceiptBatch(DB, {
    id: "batch", ownerUserId: "admin", messageId: "message", receivedAt: NOW,
    receivedDate: "2026-10-25", rawObjectKey: "emails/message.eml", processingStatus: "processed", createdAt: NOW,
  });
  await insertPaymentReceiptFile(DB, {
    id: "file", batchId: "batch", filename: "source.pdf", mimeType: "application/pdf", byteSize: 1,
    sha256: "source-sha", objectKey: "attachments/source.pdf", pageCount: 2, processingStatus: "processed", createdAt: NOW,
    pageAnalysis: [1, 2].map(pageNumber => ({
      pageNumber, classification: "receipt_start", confidence: 0.99,
      recognizedText: `债券简称26测试01\n债券代码246129.SH\n缴款金额1000万元\n缴款日期2026-10-26`,
      fields: { bondShortName: "26测试01", securityCode: "246129.SH", paymentDate: "2026-10-26", amountFen: 1_000_000_000 },
    })),
  });
  for (const [id, page, matchStatus] of [["one", 1, "matched"], ["two", 2, "duplicate"]]) {
    await insertPaymentReceipt(DB, {
      id, ownerUserId: "admin", batchId: "batch", fileId: "file", sourcePages: [page], sourcePageLabel: String(page),
      objectKey: `receipts/${id}.pdf`, sha256: `${id}-sha`, recognitionStatus: "recognized", matchStatus, createdAt: NOW,
    });
  }
  await insertPaymentReceiptMatch(DB, { id: "match-one", ownerUserId: "admin", receiptId: "one", projectId: "p-a", trancheId: "t-a" });
  DB.sql.prepare(`INSERT INTO payment_receipt_events (id, owner_user_id, batch_id, event_type, created_at)
    VALUES ('extracted', 'admin', 'batch', 'email_attachments_extracted', ?)`).run(NOW);
  const pdf = await PDFDocument.create();
  pdf.addPage(); pdf.addPage();
  const objects = new Map([
    ["attachments/source.pdf", await pdf.save()],
    ["emails/message.eml", new Uint8Array([1])],
    ["receipts/one.pdf", new Uint8Array([1])], ["receipts/two.pdf", new Uint8Array([2])],
  ]);
  const writes = [];
  const deleted = [];
  const bucket = {
    beforePut: null,
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { async arrayBuffer() { return bytes; } } : null;
    },
    async put(key, bytes) {
      await this.beforePut?.();
      writes.push(key); objects.set(key, bytes);
    },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) { deleted.push(key); objects.delete(key); } },
  };
  const env = { DB, PAYMENT_RECEIPTS: bucket };
  const call = (handler, id, method, data, action = "") => handler({
    env, params: { id },
    request: new Request(`http://127.0.0.1:8788/api/${handler === regroup ? "payment-receipt-files" : "payment-receipts"}/${id}${action}`, {
      method, ...(data ? { body: JSON.stringify(data) } : {}),
    }),
  });
  return {
    DB, bucket, objects, writes, deleted,
    regroup: (data = {}) => call(regroup, "file", "POST", { groups: [[1], [2]], blankPages: [], expectedUpdatedAt: NOW, ...data }),
    patch: (id = "one", target = "b") => call(onRequestPatch, id, "PATCH", { projectId: `p-${target}`, trancheId: `t-${target}` }),
    unlink: (id = "one") => call(onRequestDelete, id, "DELETE"),
    removeDuplicate: (id = "two") => call(onRequestDelete, id, "DELETE", null, "?action=delete-duplicate"),
  };
}

function currentMatch(h, page = "1") {
  return h.DB.sql.prepare(`SELECT m.project_id, m.tranche_id FROM payment_receipts r
    LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id WHERE r.file_id = 'file' AND r.source_page_label = ?`).get(page);
}

function fileState(h) {
  return h.DB.sql.prepare("SELECT processing_status, updated_at FROM payment_receipt_files WHERE id = 'file'").get();
}

test("PATCH, unlink and duplicate deletion cannot succeed while regroup holds its R2 upload lock", async t => {
  const h = await fixture(t);
  const pause = barrier();
  h.bucket.beforePut = async () => { h.bucket.beforePut = null; pause.reached(); await pause.released; };
  const pending = h.regroup();
  await pause.entered;
  assert.equal(fileState(h).processing_status, "regrouping");
  for (const mutate of [() => h.patch(), () => h.unlink(), () => h.removeDuplicate()]) {
    const response = await mutate();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /处理|拆页|变化/);
  }
  assert.equal(currentMatch(h).project_id, "p-a");
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) AS n FROM payment_receipts").get().n, 2);
  assert.deepEqual(h.deleted, []);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) AS n FROM payment_receipt_events WHERE event_type LIKE 'receipt_manually_%'").get().n, 0);
  pause.release();
  assert.equal((await pending).status, 200);
  assert.equal(currentMatch(h).project_id, "p-a");
  assert.ok(h.objects.has("attachments/source.pdf"));
  assert.ok(h.objects.has("emails/message.eml"));
});

test("a PATCH that pre-read before regroup acquired the lock is rejected by its transaction guard", async t => {
  const h = await fixture(t);
  const mutation = barrier();
  h.DB.beforeManualBatch = async () => { h.DB.beforeManualBatch = null; mutation.reached(); await mutation.released; };
  const patch = h.patch();
  await mutation.entered;
  const upload = barrier();
  h.bucket.beforePut = async () => { h.bucket.beforePut = null; upload.reached(); await upload.released; };
  const pending = h.regroup();
  await upload.entered;
  mutation.release();
  assert.equal((await patch).status, 409);
  assert.equal(currentMatch(h).project_id, "p-a");
  upload.release();
  assert.equal((await pending).status, 200);
  assert.equal(currentMatch(h).project_id, "p-a");
});

test("a completed manual correspondence made before the regroup lock is preserved by regrouping", async t => {
  const h = await fixture(t);
  assert.equal((await h.patch()).status, 200);
  assert.equal(currentMatch(h).project_id, "p-b");
  assert.equal((await h.regroup()).status, 200);
  assert.equal(currentMatch(h).project_id, "p-b");
});

test("a completed unlink is not resurrected when regroup later reads its locked snapshot", async t => {
  const h = await fixture(t);
  assert.equal((await h.unlink()).status, 200);
  assert.equal(currentMatch(h).project_id, null);
  assert.equal((await h.regroup()).status, 200);
  assert.equal(currentMatch(h).project_id, null);
});

test("a second regroup request is rejected before uploading objects while the first request owns the file", async t => {
  const h = await fixture(t);
  const upload = barrier();
  h.bucket.beforePut = async () => { h.bucket.beforePut = null; upload.reached(); await upload.released; };
  const pending = h.regroup();
  await upload.entered;
  assert.equal((await h.regroup()).status, 409);
  assert.equal(h.writes.length, 0);
  upload.release();
  assert.equal((await pending).status, 200);
  assert.equal(h.writes.length, 2);
});

test("a lost regroup lease returns 409, rolls back old-row replacement and cleans only uncommitted objects", async t => {
  const h = await fixture(t);
  h.DB.beforeRegroupBatch = async () => {
    h.DB.beforeRegroupBatch = null;
    h.DB.sql.exec(`UPDATE payment_receipt_files SET processing_status = 'review', updated_at = 'new-owner';
      UPDATE payment_receipt_matches SET project_id = 'p-b', tranche_id = 't-b' WHERE receipt_id = 'one'`);
  };
  assert.equal((await h.regroup()).status, 409);
  assert.equal(currentMatch(h).project_id, "p-b");
  assert.equal(fileState(h).updated_at, "new-owner");
  assert.equal(fileState(h).processing_status, "review");
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) AS n FROM payment_receipts").get().n, 2);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) AS n FROM payment_receipt_events WHERE event_type LIKE 'file_%regroup%'").get().n, 0);
  assert.ok(h.objects.has("receipts/one.pdf"));
  assert.ok(h.objects.has("attachments/source.pdf"));
  assert.ok(h.writes.every(key => !h.objects.has(key)));
  assert.equal(h.deleted.some(key => key === "attachments/source.pdf" || key === "receipts/one.pdf"), false);
});

test("a database failure during replacement rolls back rows and releases the regroup lease for manual recovery", async t => {
  const h = await fixture(t);
  h.DB.beforeRegroupBatch = async () => { h.DB.beforeRegroupBatch = null; h.DB.setFail("INSERT INTO payment_receipts"); };
  assert.equal((await h.regroup()).status, 500);
  h.DB.setFail("");
  assert.equal(currentMatch(h).project_id, "p-a");
  assert.equal(fileState(h).processing_status, "processed");
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) AS n FROM payment_receipts").get().n, 2);
  assert.ok(h.writes.every(key => !h.objects.has(key)));
  assert.equal((await h.patch()).status, 200);
  assert.equal(currentMatch(h).project_id, "p-b");
});

test("an R2 upload failure releases its lease without removing existing receipts or source archives", async t => {
  const h = await fixture(t);
  h.bucket.beforePut = async () => { throw new Error("synthetic R2 upload failure"); };
  assert.equal((await h.regroup()).status, 500);
  assert.equal(fileState(h).processing_status, "processed");
  assert.equal(currentMatch(h).project_id, "p-a");
  assert.deepEqual(h.deleted, []);
  assert.ok(h.objects.has("attachments/source.pdf"));
  assert.equal((await h.unlink()).status, 200);
});

test("manual assignment and unlink also reject automatic processing and reanalysis states atomically", async t => {
  const h = await fixture(t);
  for (const status of ["received", "queued", "processing", "regrouping", "reprocess_requested", "error"]) {
    h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status = ? WHERE id = 'file'").run(status);
    assert.equal((await h.patch()).status, 409, status);
    assert.equal((await h.unlink()).status, 409, status);
    assert.equal(currentMatch(h).project_id, "p-a");
  }
});

test("a competing target constraint rolls back both the previous match removal and its audit event", async t => {
  const h = await fixture(t);
  await insertPaymentReceiptMatch(h.DB, { id: "match-two", ownerUserId: "admin", receiptId: "two", projectId: "p-b", trancheId: "t-b" });
  assert.equal((await h.patch()).status, 409);
  assert.equal(currentMatch(h).project_id, "p-a");
  assert.equal(currentMatch(h, "2").project_id, "p-b");
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) AS n FROM payment_receipt_events WHERE event_type = 'receipt_manually_matched'").get().n, 0);
});
