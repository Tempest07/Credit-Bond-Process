import { ensureAuthSchema, json, requireUser } from "../_auth.js";
import {
  assignPaymentReceipt,
  deleteDuplicatePaymentReceipt,
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
    if (receipt.matchStatus === "duplicate") return json({ error: "重复单据不能对应项目，请删除重复件或保留归档" }, 409);

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
    const action = new URL(context.request.url).searchParams.get("action") || "unlink";
    if (action === "delete-duplicate") {
      if (receipt.matchStatus !== "duplicate") return json({ error: "只有重复单据才能删除" }, 409);
      if (!context.env.PAYMENT_RECEIPTS) return json({ error: "Cloudflare R2 binding PAYMENT_RECEIPTS 尚未配置" }, 503);
      const deleted = await deleteDuplicatePaymentReceipt(context.env.DB, {
        ownerUserId: auth.user.id,
        receiptId,
      });
      if (!deleted) return json({ error: "未找到缴款单" }, 404);
      const { objectKeys, ...publicDeleted } = deleted;
      let storageCleanup = true;
      try {
        if (objectKeys.length) await context.env.PAYMENT_RECEIPTS.delete(objectKeys);
      } catch (error) {
        storageCleanup = false;
        console.error(JSON.stringify({
          event: "payment_receipt_duplicate_storage_cleanup_failed",
          receiptId,
          error: error.message || String(error),
        }));
      }
      return json({ ok: true, deleted: true, storageCleanup, ...publicDeleted });
    }
    if (action !== "unlink") return json({ error: "不支持的缴款单删除操作" }, 400);
    if (receipt.matchStatus !== "matched") return json({ error: "只有已对应项目的缴款单才能解除对应" }, 409);
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
