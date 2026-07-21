import { ensureAuthSchema, json, requireUser } from "../../_auth.js";
import { ensurePaymentReceiptSchema, getPaymentReceipt } from "../../_payment-receipts.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);
  if (!context.env.PAYMENT_RECEIPTS) return json({ error: "Cloudflare R2 binding PAYMENT_RECEIPTS 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const receipt = await getPaymentReceipt(context.env.DB, auth.user.id, context.params.id);
    if (!receipt) return json({ error: "未找到缴款单" }, 404);

    const row = await context.env.DB.prepare(`
      SELECT object_key
      FROM payment_receipts
      WHERE owner_user_id = ?1 AND id = ?2
    `).bind(auth.user.id, context.params.id).first();
    if (!row?.object_key) return json({ error: "缴款单文件索引缺失" }, 404);

    const object = await context.env.PAYMENT_RECEIPTS.get(row.object_key, {
      onlyIf: context.request.headers,
    });
    if (!object) return json({ error: "缴款单文件不存在" }, 404);
    if (!object.body) return new Response(null, { status: 304, headers: responseHeaders(object, receipt) });

    return new Response(object.body, {
      headers: responseHeaders(object, receipt),
    });
  } catch (error) {
    return json({ error: error.message || "读取缴款单文件失败" }, 500);
  }
}

function responseHeaders(object, receipt) {
  const headers = new Headers({
    "Content-Type": receipt.mimeType || "application/pdf",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(displayFilename(receipt))}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  object.writeHttpMetadata?.(headers);
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return headers;
}

function displayFilename(receipt) {
  const name = receipt.bondShortName || "缴款单";
  const date = receipt.paymentDate || receipt.archiveDate || "未识别日期";
  return `${date}-${name}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}
