import { apiHeaders, ensureAuthSchema, json, requireUser } from "../../_auth.js";
import { ensurePaymentReceiptSchema } from "../../_payment-receipts.js";
import { isSameOriginMutation } from "../../_same-origin.js";
import { dispatchRequestedPaymentReceiptFiles } from "../../_payment-receipt-rebuild.js";

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!isSameOriginMutation(context.request)) return json({ error: "请求来源不受信任" }, 403);
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const file = await context.env.DB.prepare(`
      SELECT f.id, f.batch_id, f.processing_status, f.updated_at, f.object_key, f.filename,
             b.processing_status AS batch_status, b.received_date, b.message_id
      FROM payment_receipt_files f
      JOIN payment_receipt_batches b ON b.id = f.batch_id
      WHERE b.owner_user_id = ?1 AND f.id = ?2
    `).bind(auth.user.id, context.params.id).first();
    if (!file) return json({ error: "未找到原始缴款单附件" }, 404);
    const allowedStatuses = new Set(["processed", "review", "error"]);
    if (!allowedStatuses.has(String(file.processing_status || "")) || !allowedStatuses.has(String(file.batch_status || ""))) {
      return json({ error: "该 PDF 正在处理或已经申请重新识别，请稍后刷新" }, 409);
    }
    const now = new Date().toISOString();
    if (typeof context.env.DB.batch !== "function") throw new Error("重新识别需要事务批处理");
    // The first statement fails its NOT NULL owner constraint if the file was
    // claimed elsewhere. D1 then rolls back the entire batch, including unlinking.
    // Capture mappings inside the transaction so a just-saved manual match is
    // recorded before it is released for the explicitly requested full rerun.
    await context.env.DB.batch([
      context.env.DB.prepare(`
      INSERT INTO payment_receipt_events(id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at)
      VALUES (?1, (SELECT b.owner_user_id FROM payment_receipt_files f JOIN payment_receipt_batches b ON b.id=f.batch_id
        WHERE f.id=?2 AND b.owner_user_id=?3 AND f.processing_status=?4 AND f.updated_at=?5
          AND b.processing_status IN ('processed','review','error')), NULL, ?6, 'file_reprocess_requested',
        json_object('fileId',?2,'previousStatus',?4,'releasedMatches',json((
          SELECT json_group_array(json_object('receiptId',m.receipt_id,'projectId',m.project_id,'trancheId',m.tranche_id,'matchSource',m.match_source))
          FROM payment_receipt_matches m JOIN payment_receipts r ON r.id=m.receipt_id AND r.owner_user_id=m.owner_user_id
          WHERE m.owner_user_id=?3 AND r.file_id=?2))), ?7)
      `).bind(crypto.randomUUID(),file.id,auth.user.id,file.processing_status,file.updated_at,file.batch_id,now),
      context.env.DB.prepare(`
      UPDATE payment_receipt_files
      SET processing_status = 'reprocess_requested',
          error_message = '已申请重新识别，等待后台任务',
          updated_at = ?1
      WHERE id = ?2 AND processing_status = ?3 AND updated_at = ?4
      `).bind(now, file.id, file.processing_status, file.updated_at),
      context.env.DB.prepare(`
      DELETE FROM payment_receipt_matches WHERE owner_user_id=?1 AND receipt_id IN
        (SELECT id FROM payment_receipts WHERE owner_user_id=?1 AND file_id=?2)
      `).bind(auth.user.id,file.id),
      context.env.DB.prepare(`
      UPDATE payment_receipts SET match_status='review',candidate_json='[]',error_message='已申请重新识别，等待后台任务',updated_at=?1
      WHERE owner_user_id=?2 AND file_id=?3
      `).bind(now,auth.user.id,file.id),
      context.env.DB.prepare(`
      UPDATE payment_receipt_batches
      SET processing_status = 'processing', error_message = '', updated_at = ?1
      WHERE id = ?2
      `).bind(now, file.batch_id),
    ]);
    const dispatch=dispatchRequestedPaymentReceiptFiles(context.env,auth.user.id,[file],now);
    if(typeof context.waitUntil==='function') context.waitUntil(dispatch); else await dispatch;
    return json({ ok: true, fileId: file.id, processingStatus: "reprocess_requested", correspondenceReset: true }, 202);
  } catch (error) {
    if (/NOT NULL constraint failed: payment_receipt_events\.owner_user_id/i.test(error.message||"")) {
      return json({ error: "PDF 状态已经变化，请刷新后重试" }, 409);
    }
    return json({ error: error.message || "申请重新识别失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
