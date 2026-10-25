import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryD1 } from "./helpers/d1-memory.js";
import { onRequestDelete } from "../functions/api/payment-receipts/[id].js";
import { ensureAuthSchema } from "../functions/api/_auth.js";
import {
  ensurePaymentReceiptSchema,
  insertPaymentReceipt,
  insertPaymentReceiptBatch,
  insertPaymentReceiptFile,
} from "../functions/api/_payment-receipts.js";

const NOW = "2026-10-25T10:00:00.000Z";

async function fixture({ fileStatus = "processed", batchStatus = "processed" } = {}) {
  const DB = createMemoryD1();
  DB.sql.exec("PRAGMA foreign_keys = ON");
  const prepare = DB.prepare;
  const wrap = (query, statement) => ({
    ...statement,
    query,
    bind(...values) { return wrap(query, statement.bind(...values)); },
    async all() { return statement.execute(); },
  });
  DB.prepare = query => wrap(query, prepare(query));
  const batch = DB.batch.bind(DB);
  DB.beforeDeletionBatch = null;
  DB.batch = async statements => {
    if (DB.beforeDeletionBatch && statements.some(statement => /DELETE FROM payment_receipts\b/i.test(statement.query))) {
      await DB.beforeDeletionBatch();
    }
    return batch(statements);
  };
  await ensureAuthSchema(DB);
  await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB, {
    id: "batch", ownerUserId: "admin", messageId: "message", receivedAt: NOW,
    receivedDate: "2026-10-25", rawObjectKey: "emails/message.eml",
    processingStatus: batchStatus, createdAt: NOW,
  });
  await addFile(DB, "file", fileStatus);
  await addReceipt(DB, "duplicate", "file", "1", "duplicate");
  const deletedKeys = [];
  const remove = receiptId => onRequestDelete({
    env: { DB, PAYMENT_RECEIPTS: { async delete(keys) { deletedKeys.push(...keys); } } },
    params: { id: receiptId },
    request: new Request(`http://127.0.0.1:8788/api/payment-receipts/${receiptId}?action=delete-duplicate`, { method: "DELETE" }),
  });
  return { DB, deletedKeys, remove };
}

async function addFile(DB, id, processingStatus = "processed") {
  await insertPaymentReceiptFile(DB, {
    id, batchId: "batch", filename: `${id}.pdf`, mimeType: "application/pdf", byteSize: 1,
    sha256: `${id}-sha`, objectKey: `attachments/${id}.pdf`, processingStatus, createdAt: NOW,
  });
}

async function addReceipt(DB, id, fileId, pageLabel, matchStatus = "unmatched") {
  await insertPaymentReceipt(DB, {
    id, ownerUserId: "admin", batchId: "batch", fileId, sourcePages: [Number(pageLabel)],
    sourcePageLabel: pageLabel, objectKey: `receipts/${id}.pdf`, sha256: `${id}-sha`,
    recognitionStatus: "recognized", matchStatus, createdAt: NOW,
  });
}

function count(DB, table) {
  return Number(DB.sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function deletionEvent(DB, receiptId = "duplicate") {
  return JSON.parse(DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE receipt_id = ? AND event_type = 'receipt_duplicate_deleted'").get(receiptId).detail_json);
}

function assertOriginalsPreserved({ DB, deletedKeys }) {
  assert.equal(count(DB, "payment_receipts"), 1);
  assert.equal(count(DB, "payment_receipt_files"), 1);
  assert.equal(count(DB, "payment_receipt_batches"), 1);
  assert.equal(count(DB, "payment_receipt_events"), 0);
  assert.deepEqual(deletedKeys, []);
}

test("duplicate deletion rejects every active or retryable file status without deleting DB or R2 archives", async () => {
  for (const fileStatus of ["received", "queued", "processing", "regrouping", "reprocess_requested", "error"]) {
    const state = await fixture({ fileStatus });
    try {
      const response = await state.remove("duplicate");
      assert.equal(response.status, 409, fileStatus);
      assertOriginalsPreserved(state);
    } finally { state.DB.sql.close(); }
  }
});

test("duplicate deletion waits until the containing email batch finishes extraction and processing", async () => {
  for (const batchStatus of ["received", "queued", "processing", "error"]) {
    const state = await fixture({ batchStatus });
    try {
      assert.equal((await state.remove("duplicate")).status, 409, batchStatus);
      assertOriginalsPreserved(state);
    } finally { state.DB.sql.close(); }
  }
});

test("a first duplicate cannot delete the processing PDF before its later unique receipt is inserted", async () => {
  const state = await fixture({ fileStatus: "processing", batchStatus: "processing" });
  try {
    assert.equal((await state.remove("duplicate")).status, 409);
    await addReceipt(state.DB, "later-unique", "file", "2");
    assert.equal(count(state.DB, "payment_receipts"), 2);
    assert.equal(state.DB.sql.prepare("SELECT file_id FROM payment_receipts WHERE id = 'later-unique'").get().file_id, "file");
    assert.deepEqual(state.deletedKeys, []);
  } finally { state.DB.sql.close(); }
});

test("a processing claim after the deletion pre-read atomically rolls back every deletion and audit event", async () => {
  const state = await fixture();
  try {
    state.DB.beforeDeletionBatch = async () => {
      state.DB.beforeDeletionBatch = null;
      state.DB.sql.exec("UPDATE payment_receipt_files SET processing_status = 'reprocess_requested'; UPDATE payment_receipt_batches SET processing_status = 'processing'");
    };
    assert.equal((await state.remove("duplicate")).status, 409);
    assertOriginalsPreserved(state);
    await addReceipt(state.DB, "later-unique", "file", "2");
    assert.equal(count(state.DB, "payment_receipts"), 2);
  } finally { state.DB.sql.close(); }
});

test("completed and review archives delete only the duplicate and its actually exclusive source objects", async () => {
  for (const processingStatus of ["processed", "review"]) {
    const state = await fixture({ fileStatus: processingStatus, batchStatus: processingStatus });
    try {
      const response = await state.remove("duplicate");
      assert.equal(response.status, 200, processingStatus);
      const result = await response.json();
      assert.equal(result.deletedSourceFile, true);
      assert.equal(result.deletedEmailArchive, true);
      assert.deepEqual(deletionEvent(state.DB), { fileId: "file", deletedSourceFile: true, deletedEmailArchive: true });
      assert.equal(count(state.DB, "payment_receipts"), 0);
      assert.equal(count(state.DB, "payment_receipt_files"), 0);
      assert.equal(count(state.DB, "payment_receipt_batches"), 0);
      assert.deepEqual(new Set(state.deletedKeys), new Set(["receipts/duplicate.pdf", "attachments/file.pdf", "emails/message.eml"]));
    } finally { state.DB.sql.close(); }
  }
});

test("a new receipt after pre-read keeps the shared PDF and email even when pre-read counts showed exclusive ownership", async () => {
  const state = await fixture();
  try {
    state.DB.beforeDeletionBatch = async () => {
      state.DB.beforeDeletionBatch = null;
      await addReceipt(state.DB, "new-unique", "file", "2");
    };
    const response = await state.remove("duplicate");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.deletedSourceFile, false);
    assert.equal(result.deletedEmailArchive, false);
    assert.deepEqual(deletionEvent(state.DB), { fileId: "file", deletedSourceFile: false, deletedEmailArchive: false });
    assert.equal(count(state.DB, "payment_receipts"), 1);
    assert.equal(count(state.DB, "payment_receipt_files"), 1);
    assert.equal(count(state.DB, "payment_receipt_batches"), 1);
    assert.deepEqual(state.deletedKeys, ["receipts/duplicate.pdf"]);
  } finally { state.DB.sql.close(); }
});

test("a new attachment after pre-read keeps the email while the exclusively owned duplicate source PDF is deleted", async () => {
  const state = await fixture();
  try {
    state.DB.beforeDeletionBatch = async () => {
      state.DB.beforeDeletionBatch = null;
      await addFile(state.DB, "another-file");
      await addReceipt(state.DB, "new-unique", "another-file", "1");
    };
    const response = await state.remove("duplicate");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.deletedSourceFile, true);
    assert.equal(result.deletedEmailArchive, false);
    assert.deepEqual(deletionEvent(state.DB), { fileId: "file", deletedSourceFile: true, deletedEmailArchive: false });
    assert.equal(count(state.DB, "payment_receipt_files"), 1);
    assert.equal(count(state.DB, "payment_receipt_batches"), 1);
    assert.deepEqual(new Set(state.deletedKeys), new Set(["receipts/duplicate.pdf", "attachments/file.pdf"]));
  } finally { state.DB.sql.close(); }
});

test("two concurrent duplicate deletions clean a shared source only when the transaction deletes its final receipt", async () => {
  const state = await fixture();
  try {
    await addReceipt(state.DB, "duplicate-two", "file", "2", "duplicate");
    let waiting = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    state.DB.beforeDeletionBatch = async () => {
      waiting += 1;
      if (waiting === 2) release();
      await barrier;
    };
    const responses = await Promise.all([state.remove("duplicate"), state.remove("duplicate-two")]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const results = await Promise.all(responses.map(response => response.json()));
    assert.equal(results.filter(result => result.deletedSourceFile).length, 1);
    assert.equal(results.filter(result => result.deletedEmailArchive).length, 1);
    assert.equal(["duplicate", "duplicate-two"].filter(id => deletionEvent(state.DB, id).deletedSourceFile).length, 1);
    assert.equal(count(state.DB, "payment_receipts"), 0);
    assert.equal(count(state.DB, "payment_receipt_files"), 0);
    assert.equal(count(state.DB, "payment_receipt_batches"), 0);
    assert.equal(state.deletedKeys.filter(key => key === "attachments/file.pdf").length, 1);
    assert.equal(state.deletedKeys.filter(key => key === "emails/message.eml").length, 1);
  } finally { state.DB.sql.close(); }
});
