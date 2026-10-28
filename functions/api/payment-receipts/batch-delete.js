import { apiHeaders, ensureAuthSchema, json, requireUser } from "../_auth.js";
import { ensurePaymentReceiptSchema } from "../_payment-receipts.js";
import { deletePaymentReceiptSelection } from "../_payment-receipt-deletion.js";
import { isSameOriginMutation } from "../_same-origin.js";

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!isSameOriginMutation(context.request)) return json({ error: "请求来源不受信任" }, 403);
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);
  try {
    const body = await context.request.json().catch(() => null);
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const result = await deletePaymentReceiptSelection(context.env.DB, auth.user.id, body?.receiptIds);
    return json({ ok: true, deleted: true, ...result });
  } catch (error) {
    return json({ error: error.message || "删除缴款单失败" }, error.status || 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
