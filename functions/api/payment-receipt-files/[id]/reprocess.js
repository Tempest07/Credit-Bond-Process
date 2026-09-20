import { apiHeaders, ensureAuthSchema, json, requireUser } from "../../_auth.js";
import { ensurePaymentReceiptSchema, insertPaymentReceiptEvent } from "../../_payment-receipts.js";

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const file = await context.env.DB.prepare(`
      SELECT f.id, f.batch_id, f.processing_status, f.updated_at,
             SUM(CASE WHEN r.match_status = 'matched' THEN 1 ELSE 0 END) AS matched_count
      FROM payment_receipt_files f
      JOIN payment_receipt_batches b ON b.id = f.batch_id
      LEFT JOIN payment_receipts r ON r.file_id = f.id AND r.owner_user_id = b.owner_user_id
      WHERE b.owner_user_id = ?1 AND f.id = ?2
      GROUP BY f.id, f.batch_id, f.processing_status, f.updated_at
    `).bind(auth.user.id, context.params.id).first();
    if (!file) return json({ error: "未找到原始缴款单附件" }, 404);
    if (Number(file.matched_count) > 0) {
      return json({ error: "该 PDF 中已有人工确认的项目对应；请先解除对应，或使用“修正拆页”复核" }, 409);
    }
    const allowedStatuses = new Set(["processed", "review", "error"]);
    if (!allowedStatuses.has(String(file.processing_status || ""))) {
      return json({ error: "该 PDF 正在处理或已经申请重新识别，请稍后刷新" }, 409);
    }
    const now = new Date().toISOString();
    const claimed = await context.env.DB.prepare(`
      UPDATE payment_receipt_files
      SET processing_status = 'reprocess_requested',
          error_message = '已申请重新识别，等待后台任务',
          updated_at = ?1
      WHERE id = ?2 AND processing_status = ?3 AND updated_at = ?4
    `).bind(now, file.id, file.processing_status, file.updated_at).run();
    if (changedRows(claimed) < 1) return json({ error: "PDF 状态已经变化，请刷新后重试" }, 409);

    await context.env.DB.prepare(`
      UPDATE payment_receipt_batches
      SET processing_status = 'processing', error_message = '', updated_at = ?1
      WHERE id = ?2
    `).bind(now, file.batch_id).run();
    await insertPaymentReceiptEvent(context.env.DB, {
      id: crypto.randomUUID(),
      ownerUserId: auth.user.id,
      batchId: file.batch_id,
      eventType: "file_reprocess_requested",
      detail: { fileId: file.id, previousStatus: file.processing_status },
      createdAt: now,
    });
    return json({ ok: true, fileId: file.id, processingStatus: "reprocess_requested" }, 202);
  } catch (error) {
    return json({ error: error.message || "申请重新识别失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
