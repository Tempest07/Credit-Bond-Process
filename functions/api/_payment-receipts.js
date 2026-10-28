import { decodeWords } from "postal-mime";
import { readStoredStateRow } from "../../state-storage.js";
import { normalizePaymentReceiptBondShortName } from "../../payment-receipt-names.js";
import { paymentReceiptCodeIdentity, samePaymentReceiptCode } from "../../payment-receipt-security.js";
import { normalizeManualReceiptName, parseReceiptIdentityReview } from "../../payment-receipt-identity-review.js";

// Accepted image readings belong to an original page, even if manual regrouping
// replaces the derived receipt. Keep exact receipt records first; any parent
// evidence selected here is checked against the file hash, page set and code below.
export const ACCEPTED_IDENTITY_REVIEW_SQL = `COALESCE(
  (SELECT e.detail_json FROM payment_receipt_events e
   WHERE e.owner_user_id = r.owner_user_id AND e.receipt_id = r.id
     AND e.event_type IN ('identity_review_accepted', 'identity_name_manually_corrected', 'identity_review_restored')
   ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1),
  (SELECT e.detail_json FROM payment_receipt_events e
   WHERE e.owner_user_id = r.owner_user_id AND e.event_type IN ('identity_review_accepted', 'identity_name_manually_corrected', 'identity_review_restored')
      AND r.object_key LIKE 'receipts/manual/%' AND e.batch_id = r.batch_id
      AND json_extract(CASE WHEN json_valid(e.detail_json) THEN e.detail_json ELSE '{}' END, '$.fileId') = r.file_id
      AND json_extract(CASE WHEN json_valid(e.detail_json) THEN e.detail_json ELSE '{}' END, '$.pageNumber')
        = json_extract(CASE WHEN json_valid(r.source_pages_json) THEN r.source_pages_json ELSE '[]' END, '$[0]')
   ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1))`;

const RECEIPT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS payment_receipt_batches (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sender TEXT NOT NULL DEFAULT '',
    recipient TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL,
    received_date TEXT NOT NULL,
    raw_object_key TEXT NOT NULL,
    raw_sha256 TEXT NOT NULL DEFAULT '',
    processing_status TEXT NOT NULL DEFAULT 'received',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_user_id, message_id)
  )`,
  `CREATE TABLE IF NOT EXISTS payment_receipt_files (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    object_key TEXT NOT NULL,
    page_count INTEGER,
    blank_pages_json TEXT NOT NULL DEFAULT '[]',
    page_analysis_json TEXT NOT NULL DEFAULT '[]',
    grouping_json TEXT NOT NULL DEFAULT '{}',
    processing_status TEXT NOT NULL DEFAULT 'received',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (batch_id, sha256),
    FOREIGN KEY (batch_id) REFERENCES payment_receipt_batches(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS payment_receipts (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    source_pages_json TEXT NOT NULL,
    source_page_label TEXT NOT NULL,
    object_key TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    sha256 TEXT NOT NULL,
    payment_date TEXT,
    amount_fen INTEGER,
    payer_name TEXT NOT NULL DEFAULT '',
    payee_name TEXT NOT NULL DEFAULT '',
    bond_short_name TEXT NOT NULL DEFAULT '',
    security_code TEXT NOT NULL DEFAULT '',
    prepayment_number TEXT NOT NULL DEFAULT '',
    bank_reference TEXT NOT NULL DEFAULT '',
    recognized_text TEXT NOT NULL DEFAULT '',
    recognition_status TEXT NOT NULL DEFAULT 'pending',
    match_status TEXT NOT NULL DEFAULT 'unmatched',
    candidate_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES payment_receipt_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES payment_receipt_files(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS payment_receipt_matches (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    tranche_id TEXT NOT NULL,
    match_source TEXT NOT NULL,
    match_score INTEGER NOT NULL DEFAULT 0,
    match_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (owner_user_id, project_id, tranche_id),
    FOREIGN KEY (receipt_id) REFERENCES payment_receipts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS payment_receipt_events (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    receipt_id TEXT,
    batch_id TEXT,
    event_type TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_receipts_owner_date
    ON payment_receipts(owner_user_id, payment_date, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_receipts_owner_status
    ON payment_receipts(owner_user_id, match_status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_receipts_owner_sha
    ON payment_receipts(owner_user_id, sha256, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_receipts_file_pages
    ON payment_receipts(file_id, source_page_label)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_receipt_matches_target
    ON payment_receipt_matches(owner_user_id, project_id, tranche_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_receipt_identity_reviews
    ON payment_receipt_events(owner_user_id, receipt_id, event_type, created_at DESC, id DESC)`,
];

export async function ensurePaymentReceiptSchema(db) {
  if (!db) throw new Error("Cloudflare D1 binding DB is not configured");
  const statements = RECEIPT_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql));
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
  await ensurePaymentReceiptFileColumn(db, "page_analysis_json", "TEXT NOT NULL DEFAULT '[]'");
  await ensurePaymentReceiptFileColumn(db, "grouping_json", "TEXT NOT NULL DEFAULT '{}'");
  await ensurePaymentReceiptColumn(db, "payment_receipt_batches", "raw_sha256", "TEXT NOT NULL DEFAULT ''");
}

export async function listPaymentReceipts(db, ownerUserId, filters = {}) {
  const where = ["r.owner_user_id = ?"];
  const values = [ownerUserId];
  if (filters.date) {
    where.push("r.payment_date = ?");
    values.push(filters.date);
  }
  if (filters.status) {
    where.push("r.match_status = ?");
    values.push(filters.status);
  }
  if (filters.projectId) {
    where.push("m.project_id = ?");
    values.push(filters.projectId);
  }
  if (filters.trancheId) {
    where.push("m.tranche_id = ?");
    values.push(filters.trancheId);
  }
  const limit = Math.max(1, Math.min(500, Number(filters.limit) || 200));
  const offset = Math.max(0, Math.min(1_000_000, Number(filters.offset) || 0));
  values.push(limit, offset);

  const result = await db.prepare(`
    SELECT
      r.*,
      b.sender,
      b.subject,
      b.received_at,
      b.received_date,
      b.processing_status AS batch_processing_status,
      b.error_message AS batch_error_message,
      f.filename AS source_filename,
      f.sha256 AS source_file_sha256,
      f.updated_at AS source_file_updated_at,
      ${ACCEPTED_IDENTITY_REVIEW_SQL} AS identity_review_json,
      f.blank_pages_json,
      f.processing_status AS file_processing_status,
      m.project_id,
      m.tranche_id,
      m.match_source,
      m.match_score,
      m.match_reason,
      CASE WHEN r.match_status = 'duplicate' THEN (
        SELECT original.id
        FROM payment_receipts original
        JOIN payment_receipt_files original_file ON original_file.id = original.file_id
        WHERE original.owner_user_id = r.owner_user_id
          AND original.id <> r.id
          AND original.match_status <> 'duplicate'
          AND (
            original.sha256 = r.sha256
            OR (original_file.sha256 = f.sha256 AND original.source_page_label = r.source_page_label)
          )
        ORDER BY original.created_at ASC, original.id ASC
        LIMIT 1
      ) ELSE NULL END AS duplicate_of_receipt_id
    FROM payment_receipts r
    JOIN payment_receipt_batches b ON b.id = r.batch_id
    JOIN payment_receipt_files f ON f.id = r.file_id
    LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE WHEN r.payment_date IS NULL OR r.payment_date = '' THEN 1 ELSE 0 END,
      r.payment_date DESC,
      r.created_at DESC,
      r.id DESC
    LIMIT ? OFFSET ?
  `).bind(...values).all();
  return (result?.results || []).map(paymentReceiptFromRow);
}

export async function listPendingPaymentReceiptFiles(db, ownerUserId, filters = {}) {
  const where = [
    "b.owner_user_id = ?",
    "NOT EXISTS (SELECT 1 FROM payment_receipts r WHERE r.file_id = f.id)",
    `NOT EXISTS (SELECT 1 FROM payment_receipt_events e, json_each(
      CASE WHEN json_valid(e.detail_json) THEN e.detail_json ELSE '{}' END, '$.receipts') deleted
      WHERE e.owner_user_id = b.owner_user_id AND e.event_type = 'receipts_batch_deleted'
        AND json_extract(deleted.value, '$.fileId') = f.id
        AND f.processing_status IN ('processed', 'review'))`,
  ];
  const values = [ownerUserId];
  if (["error", "review"].includes(filters.status)) {
    where.push("f.processing_status = ?");
    values.push(filters.status);
  }
  const limit = Math.max(1, Math.min(500, Number(filters.limit) || 200));
  const offset = Math.max(0, Math.min(1_000_000, Number(filters.offset) || 0));
  values.push(limit, offset);
  const result = await db.prepare(`
    SELECT f.id, f.batch_id, f.filename, f.mime_type, f.byte_size, f.page_count,
           f.blank_pages_json, f.processing_status, f.error_message,
           b.sender, b.subject, b.received_at, b.received_date
    FROM payment_receipt_files f
    JOIN payment_receipt_batches b ON b.id = f.batch_id
    WHERE ${where.join(" AND ")}
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ? OFFSET ?
  `).bind(...values).all();
  return (result?.results || []).map((row) => ({
    id: String(row.id || ""),
    batchId: String(row.batch_id || ""),
    sourceFilename: String(row.filename || ""),
    mimeType: String(row.mime_type || "application/pdf"),
    byteSize: Number(row.byte_size) || 0,
    pageCount: Number(row.page_count) || null,
    blankPages: jsonArray(row.blank_pages_json),
    processingStatus: String(row.processing_status || "received"),
    errorMessage: String(row.error_message || ""),
    sender: String(row.sender || ""),
    subject: decodePaymentReceiptSubject(row.subject),
    receivedAt: String(row.received_at || ""),
    archiveDate: "",
  }));
}

export async function listPendingPaymentReceiptBatches(db, ownerUserId, filters = {}) {
  const where = [
    "b.owner_user_id = ?",
    "NOT EXISTS (SELECT 1 FROM payment_receipt_files f WHERE f.batch_id = b.id)",
  ];
  const values = [ownerUserId];
  if (["error", "review"].includes(filters.status)) {
    where.push("b.processing_status = ?");
    values.push(filters.status);
  }
  const limit = Math.max(1, Math.min(500, Number(filters.limit) || 200));
  const offset = Math.max(0, Math.min(1_000_000, Number(filters.offset) || 0));
  values.push(limit, offset);
  const result = await db.prepare(`
    SELECT b.id, b.sender, b.recipient, b.subject, b.received_at, b.received_date,
           b.processing_status, b.error_message
    FROM payment_receipt_batches b
    WHERE ${where.join(" AND ")}
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT ? OFFSET ?
  `).bind(...values).all();
  return (result?.results || []).map((row) => ({
    id: String(row.id || ""),
    sender: String(row.sender || ""),
    recipient: String(row.recipient || ""),
    subject: decodePaymentReceiptSubject(row.subject),
    receivedAt: String(row.received_at || ""),
    archiveDate: "",
    processingStatus: String(row.processing_status || "received"),
    errorMessage: String(row.error_message || ""),
  }));
}

export async function getPaymentReceipt(db, ownerUserId, receiptId) {
  const row = await readPaymentReceiptRow(db, ownerUserId, receiptId);
  return row ? paymentReceiptFromRow(row) : null;
}

/** Internal mutation fence; never serialize the raw record to the browser. */
export async function readPaymentReceiptIdentityState(db, ownerUserId, receiptId) {
  const row = await readPaymentReceiptRow(db, ownerUserId, receiptId);
  return { receipt: row ? paymentReceiptFromRow(row) : null, record: String(row?.identity_review_json || '') };
}

async function readPaymentReceiptRow(db, ownerUserId, receiptId) {
  const row = await db.prepare(`
    SELECT
      r.*,
      b.sender,
      b.subject,
      b.received_at,
      b.received_date,
      b.processing_status AS batch_processing_status,
      b.error_message AS batch_error_message,
      f.filename AS source_filename,
      f.sha256 AS source_file_sha256,
      f.updated_at AS source_file_updated_at,
      ${ACCEPTED_IDENTITY_REVIEW_SQL} AS identity_review_json,
      f.blank_pages_json,
      f.processing_status AS file_processing_status,
      m.project_id,
      m.tranche_id,
      m.match_source,
      m.match_score,
      m.match_reason,
      CASE WHEN r.match_status = 'duplicate' THEN (
        SELECT original.id
        FROM payment_receipts original
        JOIN payment_receipt_files original_file ON original_file.id = original.file_id
        WHERE original.owner_user_id = r.owner_user_id
          AND original.id <> r.id
          AND original.match_status <> 'duplicate'
          AND (
            original.sha256 = r.sha256
            OR (original_file.sha256 = f.sha256 AND original.source_page_label = r.source_page_label)
          )
        ORDER BY original.created_at ASC, original.id ASC
        LIMIT 1
      ) ELSE NULL END AS duplicate_of_receipt_id
    FROM payment_receipts r
    JOIN payment_receipt_batches b ON b.id = r.batch_id
    JOIN payment_receipt_files f ON f.id = r.file_id
    LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id
    WHERE r.owner_user_id = ?1 AND r.id = ?2
  `).bind(ownerUserId, receiptId).first();
  return row;
}

export async function findPaymentReceiptBySha(db, ownerUserId, sha256, excludeReceiptId = "") {
  const row = await db.prepare(`
    SELECT id, batch_id, file_id, source_page_label, created_at
    FROM payment_receipts
    WHERE owner_user_id = ?1 AND sha256 = ?2
      AND match_status <> 'duplicate'
      AND (?3 = '' OR id <> ?3)
      AND error_message NOT IN ('正在重新识别','已申请重新识别，等待后台任务')
      AND (NOT EXISTS (SELECT 1 FROM payment_receipts current WHERE current.id=?3 AND current.owner_user_id=?1)
        OR created_at < (SELECT current.created_at FROM payment_receipts current WHERE current.id=?3 AND current.owner_user_id=?1)
        OR (created_at = (SELECT current.created_at FROM payment_receipts current WHERE current.id=?3 AND current.owner_user_id=?1) AND id < ?3))
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).bind(ownerUserId, sha256, excludeReceiptId).first();
  return row ? {
    id: String(row.id || ""),
    batchId: String(row.batch_id || ""),
    fileId: String(row.file_id || ""),
    sourcePageLabel: String(row.source_page_label || ""),
    createdAt: String(row.created_at || ""),
  } : null;
}

export async function readPaymentProjects(db, ownerUserId) {
  let row;
  try {
    row = await readStoredStateRow(db, "current", [ownerUserId]);
  } catch (error) {
    if (/no such table:\s*user_app_state/i.test(String(error?.message || error))) return [];
    throw error;
  }
  if (!row) return [];
  return Array.isArray(row.data.projects) ? row.data.projects : [];
}

export async function listPaymentReceiptCoverageMatches(db, ownerUserId) {
  const result = await db.prepare(`
    SELECT m.project_id, m.tranche_id, m.receipt_id, m.match_source, m.match_score
    FROM payment_receipt_matches m
    JOIN payment_receipts r ON r.id = m.receipt_id
    WHERE m.owner_user_id = ?1 AND r.owner_user_id = ?1
    ORDER BY m.created_at DESC
  `).bind(ownerUserId).all();
  return (result?.results || []).map((row) => ({
    projectId: String(row.project_id || ""),
    trancheId: String(row.tranche_id || ""),
    receiptId: String(row.receipt_id || ""),
    matchSource: String(row.match_source || ""),
    matchScore: Number(row.match_score) || 0,
  }));
}

export async function findPaymentReceiptBatch(db, ownerUserId, messageId) {
  return db.prepare(`
    SELECT * FROM payment_receipt_batches
    WHERE owner_user_id = ?1 AND message_id = ?2
  `).bind(ownerUserId, messageId).first();
}

export async function findPaymentReceiptFile(db, batchId, sha256) {
  const row = await db.prepare(`
    SELECT id, batch_id, filename, mime_type, byte_size, sha256, object_key,
           page_count, blank_pages_json, page_analysis_json, grouping_json,
           processing_status, error_message
    FROM payment_receipt_files
    WHERE batch_id = ?1 AND sha256 = ?2
  `).bind(batchId, sha256).first();
  return row ? {
    id: String(row.id || ""),
    batchId: String(row.batch_id || ""),
    filename: String(row.filename || ""),
    mimeType: String(row.mime_type || "application/pdf"),
    byteSize: Number(row.byte_size) || 0,
    sha256: String(row.sha256 || ""),
    objectKey: String(row.object_key || ""),
    pageCount: Number(row.page_count) || null,
    blankPages: jsonArray(row.blank_pages_json),
    pageAnalysis: jsonArray(row.page_analysis_json),
    grouping: jsonObject(row.grouping_json),
    processingStatus: String(row.processing_status || "received"),
    errorMessage: String(row.error_message || ""),
  } : null;
}

export async function insertPaymentReceiptBatch(db, input) {
  await db.prepare(`
    INSERT INTO payment_receipt_batches (
      id, owner_user_id, message_id, sender, recipient, subject,
      received_at, received_date, raw_object_key, raw_sha256, processing_status,
      error_message, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
  `).bind(
    input.id,
    input.ownerUserId,
    input.messageId,
    input.sender || "",
    input.recipient || "",
    input.subject || "",
    input.receivedAt,
    input.receivedDate,
    input.rawObjectKey,
    input.rawSha256 || "",
    input.processingStatus || "received",
    input.errorMessage || "",
    input.createdAt,
  ).run();
}

export async function insertPaymentReceiptFile(db, input) {
  await db.prepare(`
    INSERT INTO payment_receipt_files (
      id, batch_id, filename, mime_type, byte_size, sha256, object_key,
      page_count, blank_pages_json, page_analysis_json, grouping_json,
      processing_status, error_message,
      created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
  `).bind(
    input.id,
    input.batchId,
    input.filename,
    input.mimeType,
    input.byteSize,
    input.sha256,
    input.objectKey,
    input.pageCount ?? null,
    JSON.stringify(input.blankPages || []),
    JSON.stringify(input.pageAnalysis || []),
    JSON.stringify(input.grouping || {}),
    input.processingStatus || "received",
    input.errorMessage || "",
    input.createdAt,
  ).run();
}

export async function updatePaymentReceiptFile(db, fileId, input = {}) {
  await db.prepare(`
    UPDATE payment_receipt_files
    SET page_count = COALESCE(?1, page_count),
        blank_pages_json = COALESCE(?2, blank_pages_json),
        page_analysis_json = COALESCE(?3, page_analysis_json),
        grouping_json = COALESCE(?4, grouping_json),
        processing_status = ?5,
        error_message = ?6,
        updated_at = ?7
    WHERE id = ?8
  `).bind(
    input.pageCount ?? null,
    input.blankPages === undefined ? null : JSON.stringify(input.blankPages || []),
    input.pageAnalysis === undefined ? null : JSON.stringify(input.pageAnalysis || []),
    input.grouping === undefined ? null : JSON.stringify(input.grouping || {}),
    input.processingStatus || "processed",
    input.errorMessage || "",
    input.updatedAt || new Date().toISOString(),
    fileId,
  ).run();
}

export async function updatePaymentReceiptBatch(db, batchId, input = {}) {
  await db.prepare(`
    UPDATE payment_receipt_batches
    SET processing_status = ?1,
        error_message = ?2,
        updated_at = ?3
    WHERE id = ?4
  `).bind(
    input.processingStatus || "processed",
    input.errorMessage || "",
    input.updatedAt || new Date().toISOString(),
    batchId,
  ).run();
}

export async function insertPaymentReceipt(db, input) {
  await db.prepare(`
    INSERT INTO payment_receipts (
      id, owner_user_id, batch_id, file_id, source_pages_json, source_page_label,
      object_key, mime_type, sha256, payment_date, amount_fen, payer_name,
      payee_name, bond_short_name, security_code, prepayment_number,
      bank_reference, recognized_text, recognition_status, match_status,
      candidate_json, error_message, created_at, updated_at
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
      ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?23
    )
  `).bind(
    input.id,
    input.ownerUserId,
    input.batchId,
    input.fileId,
    JSON.stringify(input.sourcePages || []),
    input.sourcePageLabel || "",
    input.objectKey,
    input.mimeType || "application/pdf",
    input.sha256,
    input.paymentDate || null,
    input.amountFen ?? null,
    input.payerName || "",
    input.payeeName || "",
    input.bondShortName || "",
    input.securityCode || "",
    input.prepaymentNumber || "",
    input.bankReference || "",
    input.recognizedText || "",
    input.recognitionStatus || "pending",
    input.matchStatus || "unmatched",
    JSON.stringify(input.candidates || []),
    input.errorMessage || "",
    input.createdAt,
  ).run();
}

export async function updatePaymentReceiptRecognition(db, input) {
  await db.prepare(`
    UPDATE payment_receipts
    SET sha256 = ?1,
        payment_date = ?2,
        amount_fen = ?3,
        payer_name = ?4,
        payee_name = ?5,
        bond_short_name = ?6,
        security_code = ?7,
        prepayment_number = ?8,
        bank_reference = ?9,
        recognized_text = ?10,
        recognition_status = ?11,
        match_status = ?12,
        candidate_json = ?13,
        error_message = ?14,
        updated_at = ?15
    WHERE owner_user_id = ?16 AND id = ?17
  `).bind(
    input.sha256,
    input.paymentDate || null,
    input.amountFen ?? null,
    input.payerName || "",
    input.payeeName || "",
    input.bondShortName || "",
    input.securityCode || "",
    input.prepaymentNumber || "",
    input.bankReference || "",
    input.recognizedText || "",
    input.recognitionStatus || "review",
    input.matchStatus || "review",
    JSON.stringify(input.candidates || []),
    input.errorMessage || "",
    input.updatedAt || new Date().toISOString(),
    input.ownerUserId,
    input.receiptId,
  ).run();
}

export async function listPaymentReceiptsForFile(db, ownerUserId, fileId) {
  const result = await db.prepare(`
    SELECT r.id, r.object_key, r.match_status, r.source_pages_json,
           m.project_id, m.tranche_id
    FROM payment_receipts r
    LEFT JOIN payment_receipt_matches m
      ON m.owner_user_id = r.owner_user_id AND m.receipt_id = r.id
    WHERE r.owner_user_id = ?1 AND r.file_id = ?2
    ORDER BY r.created_at ASC, r.id ASC
  `).bind(ownerUserId, fileId).all();
  return (result?.results || []).map((row) => ({
    id: String(row.id || ""),
    objectKey: String(row.object_key || ""),
    matchStatus: String(row.match_status || "unmatched"),
    sourcePages: jsonArray(row.source_pages_json),
    projectId: String(row.project_id || ""),
    trancheId: String(row.tranche_id || ""),
  }));
}

export async function deleteUnmatchedPaymentReceipts(db, ownerUserId, receiptIds = []) {
  const ids = [...new Set(receiptIds.map((value) => String(value || "")).filter(Boolean))];
  if (!ids.length) return;
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");
  const placeholders = ids.map((_, index) => `?${index + 2}`).join(", ");
  await db.batch([
    db.prepare(`
      DELETE FROM payment_receipt_matches
      WHERE owner_user_id = ?1 AND receipt_id IN (${placeholders})
    `).bind(ownerUserId, ...ids),
    db.prepare(`
      DELETE FROM payment_receipts
      WHERE owner_user_id = ?1
        AND id IN (${placeholders})
        AND match_status <> 'matched'
    `).bind(ownerUserId, ...ids),
  ]);
}

export async function insertPaymentReceiptMatch(db, input) {
  const now = input.createdAt || new Date().toISOString();
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");
  await db.batch([
    db.prepare(`
      INSERT INTO payment_receipt_matches (
        id, owner_user_id, receipt_id, project_id, tranche_id,
        match_source, match_score, match_reason, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    `).bind(
      input.id,
      input.ownerUserId,
      input.receiptId,
      input.projectId,
      input.trancheId,
      input.matchSource || "auto",
      Number(input.matchScore) || 0,
      input.matchReason || "",
      now,
    ),
    db.prepare(`
      UPDATE payment_receipts
      SET match_status = 'matched', candidate_json = '[]', error_message = '', updated_at = ?1
      WHERE owner_user_id = ?2 AND id = ?3
    `).bind(now, input.ownerUserId, input.receiptId),
  ]);
}

export async function assignPaymentReceipt(db, input) {
  const now = input.updatedAt || new Date().toISOString();
  const statements = [
    manualReceiptMutationGuard(db, input, {
      now,
      eventType: "receipt_manually_matched",
      detail: { projectId: input.projectId, trancheId: input.trancheId, paymentDate: input.paymentDate || "" },
    }),
    db.prepare(`
      DELETE FROM payment_receipt_matches
      WHERE owner_user_id = ?1 AND receipt_id = ?2
    `).bind(input.ownerUserId, input.receiptId),
    db.prepare(`
      INSERT INTO payment_receipt_matches (
        id, owner_user_id, receipt_id, project_id, tranche_id,
        match_source, match_score, match_reason, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 100, ?6, ?7, ?7)
    `).bind(
      crypto.randomUUID(),
      input.ownerUserId,
      input.receiptId,
      input.projectId,
      input.trancheId,
      input.matchReason || "人工确认对应",
      now,
    ),
    db.prepare(`
      UPDATE payment_receipts
      SET payment_date = CASE WHEN ?1 <> '' THEN ?1 ELSE payment_date END,
          match_status = 'matched', candidate_json = '[]', error_message = '', updated_at = ?2
      WHERE owner_user_id = ?3 AND id = ?4
    `).bind(input.paymentDate || "", now, input.ownerUserId, input.receiptId),
  ];
  await commitManualReceiptMutation(db, statements);
}

export async function unassignPaymentReceipt(db, input) {
  const now = input.updatedAt || new Date().toISOString();
  await commitManualReceiptMutation(db, [
    manualReceiptMutationGuard(db, input, {
      now,
      eventType: "receipt_manually_unmatched",
      matchedOnly: true,
      detail: { previousProjectId: input.previousProjectId || "", previousTrancheId: input.previousTrancheId || "" },
    }),
    db.prepare(`
      DELETE FROM payment_receipt_matches
      WHERE owner_user_id = ?1 AND receipt_id = ?2
    `).bind(input.ownerUserId, input.receiptId),
    db.prepare(`
      UPDATE payment_receipts
      SET match_status = 'review', error_message = '人工解除对应，等待重新确认', updated_at = ?1
      WHERE owner_user_id = ?2 AND id = ?3
    `).bind(now, input.ownerUserId, input.receiptId),
  ]);
}

function manualReceiptMutationGuard(db, input, { now, eventType, detail, matchedOnly = false }) {
  // The first write shares the source-file lock used by regrouping. A failed
  // guard violates owner_user_id's NOT NULL constraint and rolls back the batch.
  return db.prepare(`
    INSERT INTO payment_receipt_events (
      id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at
    ) VALUES (
      ?1,
      (SELECT r.owner_user_id
       FROM payment_receipts r
       JOIN payment_receipt_files f ON f.id = r.file_id AND f.batch_id = r.batch_id
       JOIN payment_receipt_batches b ON b.id = r.batch_id
       WHERE r.owner_user_id = ?2 AND b.owner_user_id = ?2 AND r.id = ?3
         AND f.processing_status IN ('processed', 'review')
         AND r.match_status ${matchedOnly ? "= 'matched'" : "<> 'duplicate'"}),
      ?3, (SELECT batch_id FROM payment_receipts WHERE owner_user_id = ?2 AND id = ?3),
      ?4, ?5, ?6
    )
  `).bind(crypto.randomUUID(), input.ownerUserId, input.receiptId, eventType, JSON.stringify(detail), now);
}

async function commitManualReceiptMutation(db, statements) {
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");
  try {
    await db.batch(statements);
  } catch (error) {
    if (/NOT NULL constraint failed: payment_receipt_events\.owner_user_id/i.test(error.message || "")) {
      throw Object.assign(new Error("原件正在处理、修正拆页或单据状态已变化，请刷新后重试"), { code: "receipt_processing_conflict" });
    }
    throw error;
  }
}

export async function deleteDuplicatePaymentReceipt(db, input) {
  const row = await db.prepare(`
    SELECT r.id, r.batch_id, r.file_id, r.match_status,
           r.object_key AS receipt_object_key,
           f.object_key AS file_object_key,
           b.raw_object_key, f.processing_status AS file_processing_status,
           b.processing_status AS batch_processing_status
    FROM payment_receipts r
    JOIN payment_receipt_files f ON f.id = r.file_id
    JOIN payment_receipt_batches b ON b.id = r.batch_id
    WHERE r.owner_user_id = ?1 AND b.owner_user_id = ?1 AND r.id = ?2
  `).bind(input.ownerUserId, input.receiptId).first();
  if (!row) return null;
  if (String(row.match_status || "") !== "duplicate") {
    throw new Error("只有已标记为重复的缴款单才能删除");
  }
  const processingConflict = () => Object.assign(new Error("原件仍在处理或状态已变化，请处理完成后刷新重试"), { code: "receipt_processing_conflict" });
  if (!["processed", "review"].includes(row.file_processing_status)
    || !["processed", "review"].includes(row.batch_processing_status)) throw processingConflict();
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");

  const now = input.deletedAt || new Date().toISOString();
  let results;
  try {
    results = await db.batch([
    db.prepare(`
      INSERT INTO payment_receipt_events (
        id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at
      ) VALUES (
        ?1,
        (SELECT r.owner_user_id FROM payment_receipts r
         JOIN payment_receipt_files f ON f.id = r.file_id
         JOIN payment_receipt_batches b ON b.id = r.batch_id
         WHERE r.owner_user_id = ?2 AND b.owner_user_id = ?2 AND r.id = ?3
           AND r.file_id = ?4 AND r.batch_id = ?5 AND r.match_status = 'duplicate'
           AND f.processing_status IN ('processed', 'review')
           AND b.processing_status IN ('processed', 'review')),
        ?3, ?5, 'receipt_duplicate_deleted',
        json_object('fileId', ?4,
          'deletedSourceFile', json(CASE WHEN (SELECT COUNT(*) = 1 FROM payment_receipts WHERE file_id = ?4) THEN 'true' ELSE 'false' END),
          'deletedEmailArchive', json(CASE WHEN (SELECT COUNT(*) = 1 FROM payment_receipts WHERE file_id = ?4)
            AND (SELECT COUNT(*) = 1 FROM payment_receipt_files WHERE batch_id = ?5) THEN 'true' ELSE 'false' END)),
        ?6
      )
    `).bind(
      crypto.randomUUID(),
      input.ownerUserId,
      input.receiptId,
      String(row.file_id || ""),
      String(row.batch_id || ""),
      now,
    ),
    db.prepare(`
      DELETE FROM payment_receipt_matches
      WHERE owner_user_id = ?1 AND receipt_id = ?2
    `).bind(input.ownerUserId, input.receiptId),
    db.prepare(`
      DELETE FROM payment_receipts
      WHERE owner_user_id = ?1 AND id = ?2 AND match_status = 'duplicate'
    `).bind(input.ownerUserId, input.receiptId),
    db.prepare(`
      DELETE FROM payment_receipt_files
      WHERE id = ?1
        AND processing_status IN ('processed', 'review')
        AND batch_id IN (SELECT id FROM payment_receipt_batches WHERE owner_user_id = ?2)
        AND NOT EXISTS (SELECT 1 FROM payment_receipts WHERE file_id = ?1)
    `).bind(String(row.file_id || ""), input.ownerUserId),
    db.prepare(`
      DELETE FROM payment_receipt_batches
      WHERE id = ?1 AND owner_user_id = ?2
        AND processing_status IN ('processed', 'review')
        AND NOT EXISTS (SELECT 1 FROM payment_receipt_files WHERE batch_id = ?1)
    `).bind(String(row.batch_id || ""), input.ownerUserId),
    ]);
  } catch (error) {
    // The NOT NULL event owner is the transaction guard: no partial deletion
    // can commit if processing restarted or the duplicate changed after reading.
    if (/NOT NULL constraint failed: payment_receipt_events\.owner_user_id/i.test(error.message || "")) throw processingConflict();
    throw error;
  }
  const receiptDeleteChanges = Number(results?.[2]?.meta?.changes ?? results?.[2]?.changes ?? 0);
  if (receiptDeleteChanges !== 1) throw new Error("重复单据状态已变化，请刷新后重试");
  const deletedSourceFile = Number(results?.[3]?.meta?.changes ?? results?.[3]?.changes ?? 0) === 1;
  const deletedEmailArchive = Number(results?.[4]?.meta?.changes ?? results?.[4]?.changes ?? 0) === 1;

  return {
    receiptId: input.receiptId,
    batchId: String(row.batch_id || ""),
    fileId: String(row.file_id || ""),
    deletedSourceFile,
    deletedEmailArchive,
    objectKeys: [
      String(row.receipt_object_key || ""),
      deletedSourceFile ? String(row.file_object_key || "") : "",
      deletedEmailArchive ? String(row.raw_object_key || "") : "",
    ].filter(key => key && (deletedSourceFile || key !== row.file_object_key)
      && (deletedEmailArchive || key !== row.raw_object_key)),
  };
}

export async function updatePaymentReceiptMatchStatus(db, ownerUserId, receiptId, input = {}) {
  await db.prepare(`
    UPDATE payment_receipts
    SET match_status = ?1,
        candidate_json = ?2,
        error_message = ?3,
        updated_at = ?4
    WHERE owner_user_id = ?5 AND id = ?6
  `).bind(
    input.matchStatus || "review",
    JSON.stringify(input.candidates || []),
    input.errorMessage || "",
    input.updatedAt || new Date().toISOString(),
    ownerUserId,
    receiptId,
  ).run();
}

export async function insertPaymentReceiptEvent(db, input) {
  await db.prepare(`
    INSERT INTO payment_receipt_events (
      id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    input.id,
    input.ownerUserId,
    input.receiptId || null,
    input.batchId || null,
    input.eventType,
    JSON.stringify(input.detail || {}),
    input.createdAt || new Date().toISOString(),
  ).run();
}

export function paymentReceiptFromRow(row = {}) {
  const identityReview = acceptedPaymentReceiptIdentityReview(row);
  return {
    id: String(row.id || ""),
    batchId: String(row.batch_id || ""),
    fileId: String(row.file_id || ""),
    sourcePages: jsonArray(row.source_pages_json),
    sourcePageLabel: String(row.source_page_label || ""),
    sourceFilename: String(row.source_filename || ""),
    blankPages: jsonArray(row.blank_pages_json),
    fileProcessingStatus: String(row.file_processing_status || ""),
    fileUpdatedAt: String(row.source_file_updated_at || ""),
    batchProcessingStatus: String(row.batch_processing_status || ""),
    batchErrorMessage: String(row.batch_error_message || ""),
    mimeType: String(row.mime_type || "application/pdf"),
    paymentDate: String(row.payment_date || ""),
    archiveDate: String(row.payment_date || ""),
    amountFen: Number.isSafeInteger(Number(row.amount_fen)) ? Number(row.amount_fen) : null,
    payerName: String(row.payer_name || ""),
    payeeName: String(row.payee_name || ""),
    bondShortName: String(row.bond_short_name || ""),
    securityCode: String(row.security_code || ""),
    prepaymentNumber: String(row.prepayment_number || ""),
    bankReference: String(row.bank_reference || ""),
    recognizedText: String(row.recognized_text || ""),
    recognitionStatus: String(row.recognition_status || "pending"),
    matchStatus: String(row.match_status || "unmatched"),
    candidates: jsonArray(row.candidate_json),
    errorMessage: String(row.error_message || ""),
    projectId: String(row.project_id || ""),
    trancheId: String(row.tranche_id || ""),
    matchSource: String(row.match_source || ""),
    matchScore: Number(row.match_score) || 0,
    matchReason: String(row.match_reason || ""),
    duplicateOfReceiptId: String(row.duplicate_of_receipt_id || ""),
    sender: String(row.sender || ""),
    subject: decodePaymentReceiptSubject(row.subject),
    receivedAt: String(row.received_at || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    ...(identityReview ? { identityReview } : {}),
  };
}

export function acceptedPaymentReceiptIdentityReview(row) {
  let review;
  try { review = JSON.parse(row.identity_review_json || "null"); } catch { return null; }
  if (!review || review.status !== "verified"
      || !review.receiptSha256
      || !review.fileSha256 || review.fileSha256 !== row.source_file_sha256
      || review.fileId !== row.file_id) return null;
  const pages = jsonArray(row.source_pages_json);
  if (!Number.isSafeInteger(review.pageNumber) || review.pageNumber !== pages[0]) return null;
  const sameReceipt = review.receiptSha256 === row.sha256
    && JSON.stringify(review.sourcePages) === JSON.stringify(pages);
  const regroupedReceipt = String(row.object_key || "").startsWith("receipts/manual/")
    && typeof review.acceptedAt === "string" && Boolean(review.acceptedAt)
    && Array.isArray(review.sourcePages) && review.sourcePages.length > 0
    && review.sourcePages.every(page => Number.isSafeInteger(page) && page > 0)
    && new Set(review.sourcePages).size === review.sourcePages.length
    && review.sourcePages[0] === review.pageNumber && pages.length > 0
    && new Set(pages).size === pages.length
    && pages.every(page => Number.isSafeInteger(page) && review.sourcePages.includes(page));
  if (!sameReceipt && !regroupedReceipt) return null;
  const code = paymentReceiptCodeIdentity(review.code);
  const originalCode = paymentReceiptCodeIdentity(row.security_code);
  if (review.source === 'manual') {
    const name = normalizeManualReceiptName(review.name);
    const codeSnapshotMatches = String(review.expectedCode || '') === String(row.security_code || '');
    if (!name || review.editedBy !== row.owner_user_id || !review.acceptedAt || !review.reviewId
        || !codeSnapshotMatches || !sameReceipt && (!code || !originalCode || !samePaymentReceiptCode(code, originalCode))) return null;
    return { source: 'manual', status: 'verified', name, code: String(review.code || ''), pageNumber: review.pageNumber,
      originalName: String(review.originalName || ''), previousName: String(review.previousName || ''),
      reviewId: String(review.reviewId), acceptedAt: String(review.acceptedAt) };
  }
  if (!code || code.invalid || (originalCode && !samePaymentReceiptCode(code, originalCode))) return null;
  if (!sameReceipt && (!originalCode || originalCode.invalid)) return null;
  const verified = parseReceiptIdentityReview(review.readings, row.security_code);
  const name = normalizePaymentReceiptBondShortName(review.name);
  if (verified.status !== 'verified' || verified.name !== name || !samePaymentReceiptCode(code, paymentReceiptCodeIdentity(verified.code))) return null;
  return {
    status: "verified", name, code: code.text, pageNumber: review.pageNumber,
    model: String(review.model || ""), readings: verified.readings,
    originalName: String(review.originalName || ""), reviewId: String(review.reviewId || ""),
    acceptedAt: String(review.acceptedAt || ""),
  };
}

export async function readAcceptedPaymentReceiptReviewsForFile(db, ownerUserId, fileId) {
  const result = await db.prepare(`SELECT e.receipt_id, e.detail_json
    FROM payment_receipt_events e
    JOIN payment_receipt_batches b ON b.id = e.batch_id AND b.owner_user_id = e.owner_user_id
    JOIN payment_receipt_files f ON f.batch_id = b.id
    WHERE e.owner_user_id = ?1 AND f.id = ?2 AND e.event_type IN ('identity_review_accepted', 'identity_name_manually_corrected', 'identity_review_restored')
    ORDER BY e.created_at DESC, e.rowid DESC`).bind(ownerUserId, fileId).all();
  return result?.results || [];
}

async function ensurePaymentReceiptFileColumn(db, columnName, definition) {
  return ensurePaymentReceiptColumn(db, "payment_receipt_files", columnName, definition);
}

export function decodePaymentReceiptSubject(value) {
  const subject = String(value || "").replace(/\r?\n[\t ]+/g, " ").trim();
  if (!subject) return "";
  try {
    return decodeWords(subject).trim() || subject;
  } catch {
    return subject;
  }
}

async function ensurePaymentReceiptColumn(db, tableName, columnName, definition) {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columns = new Set((result?.results || []).map((row) => String(row.name || "")));
  if (columns.has(columnName)) return;
  await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

function jsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
