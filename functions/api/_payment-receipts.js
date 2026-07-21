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
    where.push("COALESCE(r.payment_date, b.received_date) = ?");
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
      f.blank_pages_json,
      f.processing_status AS file_processing_status,
      m.project_id,
      m.tranche_id,
      m.match_source,
      m.match_score,
      m.match_reason
    FROM payment_receipts r
    JOIN payment_receipt_batches b ON b.id = r.batch_id
    JOIN payment_receipt_files f ON f.id = r.file_id
    LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id
    WHERE ${where.join(" AND ")}
    ORDER BY COALESCE(r.payment_date, b.received_date) DESC, r.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...values).all();
  return (result?.results || []).map(paymentReceiptFromRow);
}

export async function listPendingPaymentReceiptFiles(db, ownerUserId, filters = {}) {
  const where = [
    "b.owner_user_id = ?",
    "NOT EXISTS (SELECT 1 FROM payment_receipts r WHERE r.file_id = f.id)",
  ];
  const values = [ownerUserId];
  if (filters.date) {
    where.push("b.received_date = ?");
    values.push(filters.date);
  }
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
    ORDER BY b.received_date DESC, f.created_at DESC
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
    subject: String(row.subject || ""),
    receivedAt: String(row.received_at || ""),
    archiveDate: String(row.received_date || ""),
  }));
}

export async function listPendingPaymentReceiptBatches(db, ownerUserId, filters = {}) {
  const where = [
    "b.owner_user_id = ?",
    "NOT EXISTS (SELECT 1 FROM payment_receipt_files f WHERE f.batch_id = b.id)",
  ];
  const values = [ownerUserId];
  if (filters.date) {
    where.push("b.received_date = ?");
    values.push(filters.date);
  }
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
    ORDER BY b.received_date DESC, b.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...values).all();
  return (result?.results || []).map((row) => ({
    id: String(row.id || ""),
    sender: String(row.sender || ""),
    recipient: String(row.recipient || ""),
    subject: String(row.subject || ""),
    receivedAt: String(row.received_at || ""),
    archiveDate: String(row.received_date || ""),
    processingStatus: String(row.processing_status || "received"),
    errorMessage: String(row.error_message || ""),
  }));
}

export async function getPaymentReceipt(db, ownerUserId, receiptId) {
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
      f.blank_pages_json,
      f.processing_status AS file_processing_status,
      m.project_id,
      m.tranche_id,
      m.match_source,
      m.match_score,
      m.match_reason
    FROM payment_receipts r
    JOIN payment_receipt_batches b ON b.id = r.batch_id
    JOIN payment_receipt_files f ON f.id = r.file_id
    LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id
    WHERE r.owner_user_id = ?1 AND r.id = ?2
  `).bind(ownerUserId, receiptId).first();
  return row ? paymentReceiptFromRow(row) : null;
}

export async function findPaymentReceiptBySha(db, ownerUserId, sha256) {
  const row = await db.prepare(`
    SELECT id, batch_id, file_id, source_page_label, created_at
    FROM payment_receipts
    WHERE owner_user_id = ?1 AND sha256 = ?2
    ORDER BY created_at ASC
    LIMIT 1
  `).bind(ownerUserId, sha256).first();
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
    row = await db.prepare(`
      SELECT data
      FROM user_app_state
      WHERE user_id = ?1
    `).bind(ownerUserId).first();
  } catch (error) {
    if (/no such table:\s*user_app_state/i.test(String(error?.message || error))) return [];
    throw error;
  }
  if (!row?.data) return [];
  try {
    const data = JSON.parse(row.data);
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
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
      SET match_status = 'matched', candidate_json = '[]', error_message = '', updated_at = ?1
      WHERE owner_user_id = ?2 AND id = ?3
    `).bind(now, input.ownerUserId, input.receiptId),
  ];
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");
  await db.batch(statements);
}

export async function unassignPaymentReceipt(db, input) {
  const now = input.updatedAt || new Date().toISOString();
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");
  await db.batch([
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
  return {
    id: String(row.id || ""),
    batchId: String(row.batch_id || ""),
    fileId: String(row.file_id || ""),
    sourcePages: jsonArray(row.source_pages_json),
    sourcePageLabel: String(row.source_page_label || ""),
    sourceFilename: String(row.source_filename || ""),
    blankPages: jsonArray(row.blank_pages_json),
    fileProcessingStatus: String(row.file_processing_status || ""),
    batchProcessingStatus: String(row.batch_processing_status || ""),
    batchErrorMessage: String(row.batch_error_message || ""),
    mimeType: String(row.mime_type || "application/pdf"),
    paymentDate: String(row.payment_date || ""),
    archiveDate: String(row.payment_date || row.received_date || ""),
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
    sender: String(row.sender || ""),
    subject: String(row.subject || ""),
    receivedAt: String(row.received_at || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

async function ensurePaymentReceiptFileColumn(db, columnName, definition) {
  return ensurePaymentReceiptColumn(db, "payment_receipt_files", columnName, definition);
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
