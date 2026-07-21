import { ensureAuthSchema, json, requireUser } from "../_auth.js";
import {
  assignPaymentReceipt,
  ensurePaymentReceiptSchema,
  getPaymentReceipt,
  insertPaymentReceiptEvent,
  readPaymentProjects,
  unassignPaymentReceipt,
} from "../_payment-receipts.js";

export async function onRequestPatch(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const receiptId = String(context.params.id || "");
    const receipt = await getPaymentReceipt(context.env.DB, auth.user.id, receiptId);
    if (!receipt) return json({ error: "未找到缴款单" }, 404);

    const body = await context.request.json().catch(() => ({}));
    const projectId = String(body.projectId || "");
    const trancheId = String(body.trancheId || "");
    const projects = await readPaymentProjects(context.env.DB, auth.user.id);
    const project = projects.find((item) => String(item?.id || "") === projectId);
    const tranche = project?.tranches?.find((item) => String(item?.id || "") === trancheId);
    if (!project || !tranche) return json({ error: "目标项目或品种不存在" }, 400);

    await assignPaymentReceipt(context.env.DB, {
      ownerUserId: auth.user.id,
      receiptId,
      projectId,
      trancheId,
      matchReason: "Bond Centre 人工确认对应",
    });
    await insertPaymentReceiptEvent(context.env.DB, {
      id: crypto.randomUUID(),
      ownerUserId: auth.user.id,
      receiptId,
      batchId: receipt.batchId,
      eventType: "receipt_manually_matched",
      detail: { projectId, trancheId },
    });
    return json({ ok: true, receiptId, projectId, trancheId });
  } catch (error) {
    const message = error.message || "人工对应缴款单失败";
    const conflict = /UNIQUE|constraint/i.test(message);
    return json({ error: conflict ? "该项目品种已经对应其他缴款单，请先复核" : message }, conflict ? 409 : 500);
  }
}

export async function onRequestDelete(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const receiptId = String(context.params.id || "");
    const receipt = await getPaymentReceipt(context.env.DB, auth.user.id, receiptId);
    if (!receipt) return json({ error: "未找到缴款单" }, 404);
    await unassignPaymentReceipt(context.env.DB, { ownerUserId: auth.user.id, receiptId });
    await insertPaymentReceiptEvent(context.env.DB, {
      id: crypto.randomUUID(),
      ownerUserId: auth.user.id,
      receiptId,
      batchId: receipt.batchId,
      eventType: "receipt_manually_unmatched",
      detail: { previousProjectId: receipt.projectId, previousTrancheId: receipt.trancheId },
    });
    return json({ ok: true, receiptId });
  } catch (error) {
    return json({ error: error.message || "解除缴款单对应失败" }, 500);
  }
}
