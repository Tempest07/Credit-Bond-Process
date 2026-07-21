import { ensureAuthSchema, json, requireUser } from "../../_auth.js";
import { ensurePaymentReceiptSchema } from "../../_payment-receipts.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB || !context.env.PAYMENT_RECEIPTS) return json({ error: "缴款单存储绑定尚未配置" }, 503);
  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const row = await context.env.DB.prepare(`
      SELECT f.object_key, f.filename
      FROM payment_receipt_files f
      JOIN payment_receipt_batches b ON b.id = f.batch_id
      WHERE b.owner_user_id = ?1 AND f.id = ?2
    `).bind(auth.user.id, context.params.id).first();
    if (!row?.object_key) return json({ error: "未找到原始 PDF" }, 404);
    const object = await context.env.PAYMENT_RECEIPTS.get(row.object_key, { onlyIf: context.request.headers });
    if (!object) return json({ error: "原始 PDF 文件不存在" }, 404);
    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename || "缴款单原附件.pdf")}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    object.writeHttpMetadata?.(headers);
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return object.body ? new Response(object.body, { headers }) : new Response(null, { status: 304, headers });
  } catch (error) {
    return json({ error: error.message || "读取原始 PDF 失败" }, 500);
  }
}
