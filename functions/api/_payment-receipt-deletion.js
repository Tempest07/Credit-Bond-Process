// Archive deletion deliberately retains original attachments and append-only
// recognition history. A later explicit whole-file rerun can recreate receipts.
export const MAX_PAYMENT_RECEIPT_DELETE_COUNT = 100;

export async function deletePaymentReceiptSelection(db, ownerUserId, receiptIds, options = {}) {
  if (!Array.isArray(receiptIds) || !receiptIds.length
      || receiptIds.length > MAX_PAYMENT_RECEIPT_DELETE_COUNT
      || receiptIds.some(id => typeof id !== "string" || !id.trim() || id.length > 200)) {
    throw Object.assign(new Error(`请选择 1–${MAX_PAYMENT_RECEIPT_DELETE_COUNT} 张缴款单`), { status: 400 });
  }
  const ids = [...new Set(receiptIds.map(id => id.trim()))];
  const selection = JSON.stringify(ids);
  const rows = await db.prepare(`
    SELECT r.id, r.file_id FROM payment_receipts r
    JOIN payment_receipt_files f ON f.id = r.file_id AND f.batch_id = r.batch_id
    JOIN payment_receipt_batches b ON b.id = r.batch_id AND b.owner_user_id = r.owner_user_id
    WHERE r.owner_user_id = ?1 AND r.id IN (SELECT value FROM json_each(?2))
  `).bind(ownerUserId, selection).all();
  if ((rows.results || []).length !== ids.length) {
    throw Object.assign(new Error("部分单据不存在，请刷新后重试"), { status: 404 });
  }
  if (typeof db.batch !== "function") throw new Error("删除缴款单需要事务批处理");
  const now = options.deletedAt || new Date().toISOString();
  const eventId = crypto.randomUUID();
  try {
    const result = await db.batch([
      db.prepare(`
        INSERT INTO payment_receipt_events (id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at)
        VALUES (?1, (SELECT ?2 WHERE (
          SELECT COUNT(*) FROM payment_receipts r
          JOIN payment_receipt_files f ON f.id = r.file_id AND f.batch_id = r.batch_id
          JOIN payment_receipt_batches b ON b.id = r.batch_id AND b.owner_user_id = r.owner_user_id
          WHERE r.owner_user_id = ?2 AND r.id IN (SELECT value FROM json_each(?3))
            AND f.processing_status IN ('processed', 'review', 'error')
            AND b.processing_status IN ('processed', 'review', 'error')
        ) = json_array_length(?3)), NULL, NULL, 'receipts_batch_deleted',
          json_object('receipts', json((
            SELECT json_group_array(json_object(
              'receiptId', r.id, 'fileId', r.file_id, 'batchId', r.batch_id,
              'sourcePages', json(r.source_pages_json), 'sourcePageLabel', r.source_page_label,
              'bondShortName', r.bond_short_name, 'securityCode', r.security_code,
              'paymentDate', r.payment_date, 'amountFen', r.amount_fen,
              'matchStatus', r.match_status, 'projectId', m.project_id, 'trancheId', m.tranche_id,
              'matchSource', m.match_source, 'fileStatus', f.processing_status,
              'fileError', f.error_message, 'batchStatus', b.processing_status))
            FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
            JOIN payment_receipt_batches b ON b.id = r.batch_id
            LEFT JOIN payment_receipt_matches m
              ON m.receipt_id = r.id AND m.owner_user_id = r.owner_user_id
            WHERE r.owner_user_id = ?2 AND r.id IN (SELECT value FROM json_each(?3))
          ))), ?4)
      `).bind(eventId, ownerUserId, selection, now),
      db.prepare(`DELETE FROM payment_receipt_matches WHERE owner_user_id = ?1
        AND receipt_id IN (SELECT value FROM json_each(?2))`).bind(ownerUserId, selection),
      db.prepare(`DELETE FROM payment_receipts WHERE owner_user_id = ?1
        AND id IN (SELECT value FROM json_each(?2))`).bind(ownerUserId, selection),
      // A failed OCR file can contain usable receipts. Explicitly deleting its
      // selection settles that failed retry so cron cannot recreate the rows.
      // The original status/error remains in the audit inserted above.
      db.prepare(`UPDATE payment_receipt_files SET
        processing_status = CASE WHEN EXISTS (SELECT 1 FROM payment_receipts r WHERE r.file_id=payment_receipt_files.id)
          THEN 'review' ELSE 'processed' END, error_message='', updated_at=?1
        WHERE id IN (SELECT DISTINCT json_extract(value,'$.fileId') FROM payment_receipt_events e,
          json_each(e.detail_json,'$.receipts') WHERE e.id=?2 AND e.owner_user_id=?3)
          AND (processing_status='error' OR NOT EXISTS (SELECT 1 FROM payment_receipts r WHERE r.file_id=payment_receipt_files.id))
      `).bind(now, eventId, ownerUserId),
    ]);
    return {
      receiptIds: ids,
      deletedCount: Number(result[2]?.meta?.changes ?? result[2]?.changes ?? ids.length),
      fileIds: [...new Set(rows.results.map(row => row.file_id))],
      originalsPreserved: true,
    };
  } catch (error) {
    if (/NOT NULL constraint failed: payment_receipt_events\.owner_user_id/i.test(error.message || "")) {
      throw Object.assign(new Error("单据正在处理或状态已变化，请稍后重试"), { status: 409 });
    }
    throw error;
  }
}
