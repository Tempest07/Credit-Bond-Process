import { ensureAuthSchema, json, requireUser } from "../../_auth.js";
import { ensurePaymentReceiptSchema, getPaymentReceipt } from "../../_payment-receipts.js";
import { PDFDocument } from "pdf-lib";

const MAX_RECEIPT_PDF_BYTES = 30 * 1024 * 1024;

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
      SELECT r.object_key, f.object_key AS source_object_key
      FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
      JOIN payment_receipt_batches b ON b.id = r.batch_id AND b.id = f.batch_id
      WHERE r.owner_user_id = ?1 AND b.owner_user_id = ?1 AND r.id = ?2
    `).bind(auth.user.id, context.params.id).first();
    if (!row) return json({ error: "缴款单文件索引缺失" }, 404);
    const attachment = new URL(context.request.url).searchParams.get("download") === "1";

    const object = row.object_key && row.object_key !== row.source_object_key
      ? await context.env.PAYMENT_RECEIPTS.get(row.object_key, attachment ? {} : { onlyIf: context.request.headers })
      : null;
    if (!object) return await receiptFromOriginal(context.env.PAYMENT_RECEIPTS, row.source_object_key, receipt, attachment);
    if (!object.body) return new Response(null, { status: 304, headers: responseHeaders(object, receipt, attachment) });

    return new Response(object.body, {
      headers: responseHeaders(object, receipt, attachment),
    });
  } catch (error) {
    return json({ error: error.message || "读取缴款单文件失败" }, 500);
  }
}

function responseHeaders(object, receipt, attachment = false) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  object.writeHttpMetadata?.(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(displayFilename(receipt))}`);
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return headers;
}

async function receiptFromOriginal(bucket, objectKey, receipt, attachment) {
  if (!objectKey) return json({ error: "缴款单文件不存在" }, 404);
  const source = await bucket.get(objectKey);
  if (!source) return json({ error: "缴款单原件不存在" }, 404);
  if (Number(source.size) > MAX_RECEIPT_PDF_BYTES) return json({ error: "原件过大，暂时无法生成单张缴款单" }, 413);
  const bytes = await source.arrayBuffer();
  if (bytes.byteLength > MAX_RECEIPT_PDF_BYTES) return json({ error: "原件过大，暂时无法生成单张缴款单" }, 413);
  const original = await PDFDocument.load(bytes);
  const pages = receipt.sourcePages;
  if (!Array.isArray(pages) || !pages.length || pages.some(page => !Number.isInteger(page) || page < 1 || page > original.getPageCount())) {
    return json({ error: "单据页码无效，请先修正拆页" }, 409);
  }
  const output = await PDFDocument.create();
  for (const page of await output.copyPages(original, [...new Set(pages)].map(page => page - 1))) output.addPage(page);
  return new Response(await output.save(), { headers: responseHeaders({}, receipt, attachment) });
}

function displayFilename(receipt) {
  const name = receipt.identityReview?.status === "verified" && receipt.identityReview.name
    ? receipt.identityReview.name : receipt.bondShortName || "缴款单";
  const date = receipt.paymentDate || receipt.archiveDate || "未识别日期";
  return `${date}-${name}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}
