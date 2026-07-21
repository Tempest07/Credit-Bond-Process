import { apiHeaders, ensureAuthSchema, json, requireUser } from "./_auth.js";
import {
  ensurePaymentReceiptSchema,
  listPaymentReceiptCoverageMatches,
  readPaymentProjects,
} from "./_payment-receipts.js";
import { buildPaymentReceiptCoverage, normalizeDate } from "../../payment-receipts.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const requestedDate = new URL(context.request.url).searchParams.get("date") || "";
    const date = normalizeDate(requestedDate);
    const [projects, matches] = await Promise.all([
      readPaymentProjects(context.env.DB, auth.user.id),
      listPaymentReceiptCoverageMatches(context.env.DB, auth.user.id),
    ]);
    return json({ ok: true, ...buildPaymentReceiptCoverage(projects, matches, { date }) });
  } catch (error) {
    return json({ error: error.message || "读取缴款单覆盖情况失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}
