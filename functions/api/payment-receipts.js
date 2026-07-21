import { apiHeaders, ensureAuthSchema, json, requireUser } from "./_auth.js";
import {
  ensurePaymentReceiptSchema,
  listPaymentReceipts,
  listPendingPaymentReceiptBatches,
  listPendingPaymentReceiptFiles,
} from "./_payment-receipts.js";

const MATCH_STATUSES = new Set(["matched", "review", "unmatched", "duplicate", "error"]);

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const url = new URL(context.request.url);
    const date = validDate(url.searchParams.get("date")) ? url.searchParams.get("date") : "";
    const requestedStatus = String(url.searchParams.get("status") || "");
    const status = MATCH_STATUSES.has(requestedStatus) ? requestedStatus : "";
    const projectId = url.searchParams.get("projectId") || "";
    const limit = url.searchParams.get("limit") || 200;
    const offset = url.searchParams.get("offset") || 0;
    const receipts = await listPaymentReceipts(context.env.DB, auth.user.id, {
      date,
      status,
      projectId,
      trancheId: url.searchParams.get("trancheId") || "",
      limit,
      offset,
    });
    const includePending = !date && !projectId;
    const pendingFiles = includePending && (![...MATCH_STATUSES].includes(requestedStatus) || ["error", "review", "unmatched"].includes(requestedStatus))
      ? await listPendingPaymentReceiptFiles(context.env.DB, auth.user.id, { status, limit, offset })
      : [];
    const pendingBatches = includePending && (![...MATCH_STATUSES].includes(requestedStatus) || ["error", "review"].includes(requestedStatus))
      ? await listPendingPaymentReceiptBatches(context.env.DB, auth.user.id, { status, limit, offset })
      : [];
    return json({ ok: true, receipts, pendingFiles, pendingBatches });
  } catch (error) {
    return json({ error: error.message || "读取缴款单失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

function validDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
