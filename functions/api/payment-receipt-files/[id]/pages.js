import { apiHeaders, ensureAuthSchema, json, requireUser } from "../../_auth.js";
import { ensurePaymentReceiptSchema } from "../../_payment-receipts.js";

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!context.env.DB) return json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503);

  try {
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const file = await context.env.DB.prepare(`
      SELECT f.id, f.batch_id, f.filename, f.page_count, f.blank_pages_json,
             f.page_analysis_json, f.grouping_json, f.processing_status, f.error_message,
             f.updated_at,
             b.received_date
      FROM payment_receipt_files f
      JOIN payment_receipt_batches b ON b.id = f.batch_id
      WHERE b.owner_user_id = ?1 AND f.id = ?2
    `).bind(auth.user.id, context.params.id).first();
    if (!file) return json({ error: "未找到原始缴款单附件" }, 404);

    const receiptsResult = await context.env.DB.prepare(`
      SELECT r.id, r.source_pages_json, r.source_page_label, r.bond_short_name,
             r.match_status, m.project_id, m.tranche_id
      FROM payment_receipts r
      LEFT JOIN payment_receipt_matches m ON m.receipt_id = r.id
      WHERE r.owner_user_id = ?1 AND r.file_id = ?2
      ORDER BY r.source_page_label, r.created_at
    `).bind(auth.user.id, context.params.id).all();
    const grouping = jsonObject(file.grouping_json);
    const pageAnalyses = jsonArray(file.page_analysis_json);
    const pageCount = Number(file.page_count) || pageAnalyses.length;
    const groups = Array.isArray(grouping.groups)
      ? grouping.groups.map((group) => jsonPageNumbers(group?.pageNumbers))
      : (receiptsResult?.results || []).map((row) => jsonPageNumbers(row.source_pages_json));
    const blankPages = jsonPageNumbers(grouping.blankPages || file.blank_pages_json);

    return json({
      ok: true,
      file: {
        id: String(file.id || ""),
        batchId: String(file.batch_id || ""),
        filename: String(file.filename || ""),
        receivedDate: String(file.received_date || ""),
        pageCount,
        processingStatus: String(file.processing_status || ""),
        errorMessage: String(file.error_message || ""),
        updatedAt: String(file.updated_at || ""),
      },
      groups,
      blankPages,
      pages: Array.from({ length: pageCount }, (_, index) => {
        const pageNumber = index + 1;
        const analysis = pageAnalyses.find((item) => Number(item?.pageNumber) === pageNumber) || {};
        return {
          pageNumber,
          classification: String(analysis.classification || "uncertain"),
          confidence: Number(analysis.confidence) || 0,
          boundaryEvidence: String(analysis.boundaryEvidence || "").slice(0, 500),
          recognizedText: String(analysis.recognizedText || "").slice(0, 1600),
        };
      }),
      receipts: (receiptsResult?.results || []).map((row) => ({
        id: String(row.id || ""),
        sourcePages: jsonPageNumbers(row.source_pages_json),
        sourcePageLabel: String(row.source_page_label || ""),
        bondShortName: String(row.bond_short_name || ""),
        matchStatus: String(row.match_status || ""),
        projectId: String(row.project_id || ""),
        trancheId: String(row.tranche_id || ""),
      })),
    });
  } catch (error) {
    return json({ error: error.message || "读取 PDF 分页信息失败" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonPageNumbers(value) {
  const values = Array.isArray(value) ? value : jsonArray(value);
  return values.map(Number).filter(Number.isInteger).sort((left, right) => left - right);
}
