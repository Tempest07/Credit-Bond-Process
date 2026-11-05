import { apiHeaders, json, requireUser } from "./_auth.js";
import { ensurePaymentReceiptSchema, listPaymentReceiptStatus } from "./_payment-receipts.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);
  try {
    await ensurePaymentReceiptSchema(context.env.DB);
    const status = await listPaymentReceiptStatus(context.env.DB, auth.user.id);
    return json({ ok: true, ...status, fetchedAt: new Date().toISOString() });
  } catch {
    return json({ error: "读取缴款单处理状态失败，请稍后刷新" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
