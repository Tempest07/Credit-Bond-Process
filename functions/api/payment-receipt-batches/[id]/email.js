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
      SELECT raw_object_key, received_date, subject
      FROM payment_receipt_batches
      WHERE owner_user_id = ?1 AND id = ?2
    `).bind(auth.user.id, context.params.id).first();
    if (!row?.raw_object_key) return json({ error: "未找到原始邮件" }, 404);
    const object = await context.env.PAYMENT_RECEIPTS.get(row.raw_object_key, { onlyIf: context.request.headers });
    if (!object) return json({ error: "原始邮件文件不存在" }, 404);
    const filename = `${row.received_date || "未识别日期"}-${safeName(row.subject || "缴款单邮件")}.eml`;
    const headers = new Headers({
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    object.writeHttpMetadata?.(headers);
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return object.body ? new Response(object.body, { headers }) : new Response(null, { status: 304, headers });
  } catch (error) {
    return json({ error: error.message || "读取原始邮件失败" }, 500);
  }
}

function safeName(value) {
  return String(value || "").replace(/[\\/:*?"<>|\r\n]/g, "-").slice(0, 100) || "缴款单邮件";
}
