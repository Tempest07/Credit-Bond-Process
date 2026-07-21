import { PDFDocument } from "pdf-lib";

import { apiHeaders, ensureAuthSchema, json, requireUser } from "../../_auth.js";
import {
  ensurePaymentReceiptSchema,
  readPaymentProjects,
} from "../../_payment-receipts.js";
import {
  normalizePaymentReceiptPageGroups,
  recognizePaymentReceiptText,
  selectPaymentReceiptMatch,
} from "../../../../payment-receipts.js";

const MAX_BODY_BYTES = 64 * 1024;

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB || !context.env.PAYMENT_RECEIPTS) return json({ error: "缴款单数据库或存储绑定尚未配置" }, 503);

  let claimedFile = null;
  let leaseAt = "";
  let committed = false;
  const uploadedObjectKeys = [];
  try {
    const text = await context.request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: "拆页修正数据过大" }, 413);
    const body = JSON.parse(text || "{}");
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const file = await readOwnedFile(context.env.DB, auth.user.id, context.params.id);
    if (!file) return json({ error: "未找到原始缴款单附件" }, 404);
    if (!["processed", "review", "error"].includes(String(file.processing_status || ""))) {
      throw httpError(409, "PDF 仍在自动处理，完成后才能人工修正拆页");
    }
    const expectedUpdatedAt = String(body.expectedUpdatedAt || "");
    if (!expectedUpdatedAt || expectedUpdatedAt !== String(file.updated_at || "")) {
      throw httpError(409, "PDF 状态已经变化，请刷新后再修正拆页");
    }
    leaseAt = new Date().toISOString();
    if (!await claimManualRegroup(context.env.DB, file.id, expectedUpdatedAt, leaseAt)) {
      throw httpError(409, "PDF 正在被其他任务处理，请刷新后重试");
    }
    claimedFile = file;
    const sourceObject = await context.env.PAYMENT_RECEIPTS.get(file.object_key);
    if (!sourceObject) throw httpError(404, "原始 PDF 文件不存在");
    const sourceBytes = await sourceObject.arrayBuffer();
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const pageCount = sourcePdf.getPageCount();
    const normalized = normalizePaymentReceiptPageGroups(body, pageCount);
    const pageAnalyses = jsonArray(file.page_analysis_json);
    const projects = await readPaymentProjects(context.env.DB, auth.user.id);
    const oldReceipts = await readExistingReceipts(context.env.DB, auth.user.id, file.id);
    const previousMatchByPages = new Map(oldReceipts.flatMap((receipt) =>
      receipt.project_id && receipt.tranche_id
        ? [[pageKey(receipt.sourcePages), receipt]]
        : [],
    ));
    const manualVersion = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const createdAt = new Date().toISOString();
    const newReceipts = [];

    for (const pageNumbers of normalized.groups) {
      const bytes = await copyPdfPages(sourcePdf, pageNumbers);
      const idHash = await sha256Hex(new TextEncoder().encode(`${file.id}:${pageNumbers.join(",")}`));
      const receiptId = `receipt-${idHash.slice(0, 32)}`;
      const objectKey = `receipts/manual/${file.received_date.replaceAll("-", "/")}/${file.id}/${manualVersion}-${receiptId}.pdf`;
      const analyses = pageNumbers.map((pageNumber) => pageAnalyses.find((item) => Number(item?.pageNumber) === pageNumber) || {});
      const firstFields = analyses.find((item) => item.classification === "receipt_start")?.fields || analyses[0]?.fields || {};
      const recognized = recognizePaymentReceiptText(
        analyses.map((item) => item.recognizedText).filter(Boolean).join("\n\n"),
        firstFields,
      );
      const match = selectPaymentReceiptMatch(recognized, projects);
      const preservedMatch = previousMatchByPages.get(pageKey(pageNumbers)) || null;
      const objectSha256 = await sha256Hex(bytes);
      const fingerprint = await sha256Hex(new TextEncoder().encode(`manual-regroup-v1|source:${file.sha256}|pages:${pageNumbers.join(",")}`));
      await context.env.PAYMENT_RECEIPTS.put(objectKey, bytes, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { batchId: file.batch_id, fileId: file.id, sourcePages: pageLabel(pageNumbers), regroupedBy: auth.user.id },
        sha256: hexToBytes(objectSha256),
      });
      uploadedObjectKeys.push(objectKey);
      newReceipts.push({
        id: receiptId,
        pageNumbers,
        pageLabel: pageLabel(pageNumbers),
        objectKey,
        fingerprint,
        recognized,
        candidates: preservedMatch ? [] : match.candidates,
        preservedMatch,
      });
    }

    await replaceReceiptRows(context.env.DB, {
      ownerUserId: auth.user.id,
      file,
      normalized,
      pageAnalyses,
      receipts: newReceipts,
      createdAt,
      leaseAt,
    });
    committed = true;
    await cleanupDerivedReceiptObjects(context.env.PAYMENT_RECEIPTS, oldReceipts, newReceipts);
    return json({
      ok: true,
      fileId: file.id,
      receiptCount: newReceipts.length,
      preservedMatchCount: newReceipts.filter((receipt) => receipt.preservedMatch).length,
      groups: normalized.groups,
      blankPages: normalized.blankPages,
      updatedAt: createdAt,
    });
  } catch (error) {
    if (!committed) {
      await cleanupObjectKeys(context.env.PAYMENT_RECEIPTS, uploadedObjectKeys, "payment_receipt_regroup_rollback_cleanup_failed");
    }
    if (claimedFile && leaseAt && !committed) {
      await releaseManualRegroup(context.env.DB, claimedFile, leaseAt, error).catch(() => {});
    }
    const status = Number(error.status) || (/页|分组|归类|JSON/.test(error.message || "") ? 400 : 500);
    return json({ error: error.message || "人工修正 PDF 拆页失败" }, status);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

async function readOwnedFile(db, ownerUserId, fileId) {
  return db.prepare(`
    SELECT f.*, b.received_date
    FROM payment_receipt_files f
    JOIN payment_receipt_batches b ON b.id = f.batch_id
    WHERE b.owner_user_id = ?1 AND f.id = ?2
  `).bind(ownerUserId, fileId).first();
}

async function readExistingReceipts(db, ownerUserId, fileId) {
  const result = await db.prepare(`
    SELECT r.id, r.object_key, r.source_pages_json, m.project_id, m.tranche_id,
           m.match_source, m.match_score, m.match_reason
    FROM payment_receipts r
    LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id
    WHERE r.owner_user_id = ?1 AND r.file_id = ?2
  `).bind(ownerUserId, fileId).all();
  return (result?.results || []).map((row) => ({ ...row, sourcePages: jsonPageNumbers(row.source_pages_json) }));
}

async function claimManualRegroup(db, fileId, expectedUpdatedAt, leaseAt) {
  const result = await db.prepare(`
    UPDATE payment_receipt_files
    SET processing_status = 'regrouping', error_message = '', updated_at = ?1
    WHERE id = ?2 AND updated_at = ?3 AND processing_status IN ('processed', 'review', 'error')
  `).bind(leaseAt, fileId, expectedUpdatedAt).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

async function releaseManualRegroup(db, file, leaseAt, error) {
  await db.prepare(`
    UPDATE payment_receipt_files
    SET processing_status = ?1, error_message = ?2, updated_at = ?3
    WHERE id = ?4 AND processing_status = 'regrouping' AND updated_at = ?5
  `).bind(
    String(file.processing_status || "review"),
    `人工修正拆页失败：${String(error?.message || error || "未知错误")}`.slice(0, 1000),
    new Date().toISOString(),
    file.id,
    leaseAt,
  ).run();
}

async function replaceReceiptRows(db, input) {
  if (typeof db.batch !== "function") throw new Error("当前 D1 运行环境不支持事务批处理");
  const statements = [
    db.prepare(`
      INSERT INTO payment_receipt_events (
        id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at
      ) VALUES (
        ?1,
        (
          SELECT b.owner_user_id
          FROM payment_receipt_files f
          JOIN payment_receipt_batches b ON b.id = f.batch_id
          WHERE f.id = ?2 AND b.owner_user_id = ?3
            AND f.processing_status = 'regrouping' AND f.updated_at = ?4
        ),
        NULL, ?5, 'file_regroup_commit_started', ?6, ?7
      )
    `).bind(
      crypto.randomUUID(), input.file.id, input.ownerUserId, input.leaseAt,
      input.file.batch_id, JSON.stringify({ fileId: input.file.id, leaseAt: input.leaseAt }), input.createdAt,
    ),
    db.prepare(`
      DELETE FROM payment_receipt_matches
      WHERE owner_user_id = ?1 AND receipt_id IN (
        SELECT id FROM payment_receipts WHERE owner_user_id = ?1 AND file_id = ?2
      )
    `).bind(input.ownerUserId, input.file.id),
    db.prepare("DELETE FROM payment_receipts WHERE owner_user_id = ?1 AND file_id = ?2")
      .bind(input.ownerUserId, input.file.id),
  ];
  for (const receipt of input.receipts) {
    const preserved = receipt.preservedMatch;
    statements.push(db.prepare(`
      INSERT INTO payment_receipts (
        id, owner_user_id, batch_id, file_id, source_pages_json, source_page_label,
        object_key, mime_type, sha256, payment_date, amount_fen, payer_name,
        payee_name, bond_short_name, security_code, prepayment_number,
        bank_reference, recognized_text, recognition_status, match_status,
        candidate_json, error_message, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'application/pdf', ?8, ?9, ?10, ?11,
        ?12, ?13, ?14, ?15, ?16, ?17, 'recognized', ?18, ?19, ?20, ?21, ?21
      )
    `).bind(
      receipt.id,
      input.ownerUserId,
      input.file.batch_id,
      input.file.id,
      JSON.stringify(receipt.pageNumbers),
      receipt.pageLabel,
      receipt.objectKey,
      receipt.fingerprint,
      receipt.recognized.paymentDate || null,
      receipt.recognized.amountFen ?? null,
      receipt.recognized.payerName || "",
      receipt.recognized.payeeName || "",
      receipt.recognized.bondShortName || "",
      receipt.recognized.securityCode || "",
      receipt.recognized.prepaymentNumber || "",
      receipt.recognized.bankReference || "",
      receipt.recognized.recognizedText || "",
      preserved ? "matched" : "review",
      JSON.stringify(receipt.candidates || []),
      preserved ? "" : "人工修正拆页后，请确认项目对应",
      input.createdAt,
    ));
    if (preserved) {
      statements.push(db.prepare(`
        INSERT INTO payment_receipt_matches (
          id, owner_user_id, receipt_id, project_id, tranche_id,
          match_source, match_score, match_reason, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
      `).bind(
        crypto.randomUUID(), input.ownerUserId, receipt.id, preserved.project_id,
        preserved.tranche_id, preserved.match_source || "manual", Number(preserved.match_score) || 100,
        preserved.match_reason || "拆页未变，保留原对应", input.createdAt,
      ));
    }
  }
  const hasUnmatched = input.receipts.some((receipt) => !receipt.preservedMatch);
  const grouping = {
    version: 2,
    source: "manual",
    groups: input.receipts.map((receipt) => ({ pageNumbers: receipt.pageNumbers, pageLabel: receipt.pageLabel })),
    blankPages: input.normalized.blankPages,
    uncertainPages: [],
    correctedAt: input.createdAt,
    correctedBy: input.ownerUserId,
  };
  const fileMessage = !input.receipts.length
    ? "已人工确认该附件全部为空白页"
    : hasUnmatched
      ? "已人工修正拆页，新增或变更的单据请确认项目对应"
      : "已人工确认拆页，原项目对应已保留";
  statements.push(db.prepare(`
    UPDATE payment_receipt_files
    SET page_count = ?1, blank_pages_json = ?2, page_analysis_json = ?3,
        grouping_json = ?4, processing_status = ?5, error_message = ?6, updated_at = ?7
    WHERE id = ?8 AND processing_status = 'regrouping' AND updated_at = ?9
  `).bind(
    Number(input.file.page_count) || input.pageAnalyses.length,
    JSON.stringify(input.normalized.blankPages),
    JSON.stringify(input.pageAnalyses),
    JSON.stringify(grouping),
    hasUnmatched ? "review" : "processed",
    fileMessage,
    input.createdAt,
    input.file.id,
    input.leaseAt,
  ));
  statements.push(db.prepare(`
    UPDATE payment_receipt_batches
    SET processing_status = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM payment_receipt_events
            WHERE batch_id = ?1 AND event_type = 'email_attachments_extracted'
          ) THEN processing_status
          WHEN EXISTS (
            SELECT 1 FROM payment_receipt_files
            WHERE batch_id = ?1 AND processing_status IN ('received', 'queued', 'processing', 'regrouping')
          ) THEN 'processing'
          WHEN EXISTS (
            SELECT 1 FROM payment_receipt_files
            WHERE batch_id = ?1 AND processing_status IN ('error', 'review')
          ) THEN 'review'
          ELSE 'processed'
        END,
        error_message = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM payment_receipt_events
            WHERE batch_id = ?1 AND event_type = 'email_attachments_extracted'
          ) THEN error_message
          WHEN ?2 = 1 THEN ?3
          WHEN NOT EXISTS (
            SELECT 1 FROM payment_receipt_files
            WHERE batch_id = ?1 AND processing_status IN ('error', 'review')
          ) THEN ''
          ELSE error_message
        END,
        updated_at = ?4
    WHERE id = ?1
  `).bind(input.file.batch_id, hasUnmatched ? 1 : 0, fileMessage, input.createdAt));
  statements.push(db.prepare(`
    INSERT INTO payment_receipt_events (
      id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at
    ) VALUES (?1, ?2, NULL, ?3, 'file_manually_regrouped', ?4, ?5)
  `).bind(
    crypto.randomUUID(), input.ownerUserId, input.file.batch_id,
    JSON.stringify({ groups: input.normalized.groups, blankPages: input.normalized.blankPages, preservedMatches: input.receipts.filter((receipt) => receipt.preservedMatch).length }),
    input.createdAt,
  ));
  await db.batch(statements);
}

async function cleanupDerivedReceiptObjects(bucket, oldReceipts, newReceipts) {
  const retained = new Set(newReceipts.map((receipt) => receipt.objectKey));
  const obsolete = [...new Set(oldReceipts
    .map((receipt) => String(receipt.object_key || ""))
    .filter((key) => key.startsWith("receipts/") && !retained.has(key)))];
  await cleanupObjectKeys(bucket, obsolete, "payment_receipt_regroup_cleanup_failed");
}

async function cleanupObjectKeys(bucket, objectKeys, event) {
  const keys = [...new Set(objectKeys.filter(Boolean))];
  if (!keys.length || typeof bucket.delete !== "function") return;
  const results = await Promise.allSettled(keys.map((key) => bucket.delete(key)));
  results.forEach((result, index) => {
    if (result.status === "rejected") console.error(JSON.stringify({
      event,
      objectKey: keys[index],
      error: result.reason?.message || String(result.reason),
    }));
  });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function copyPdfPages(sourcePdf, pageNumbers) {
  const output = await PDFDocument.create();
  const copied = await output.copyPages(sourcePdf, pageNumbers.map((pageNumber) => pageNumber - 1));
  copied.forEach((page) => output.addPage(page));
  const bytes = await output.save({ useObjectStreams: false });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function pageLabel(pageNumbers) {
  return pageNumbers.join(",");
}

function pageKey(pageNumbers) {
  return jsonPageNumbers(pageNumbers).join(",");
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonPageNumbers(value) {
  return (Array.isArray(value) ? value : jsonArray(value)).map(Number).filter(Number.isInteger).sort((left, right) => left - right);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", value instanceof ArrayBuffer ? value : value.buffer || value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  return Uint8Array.from(String(value || "").match(/.{1,2}/g) || [], (byte) => Number.parseInt(byte, 16));
}
