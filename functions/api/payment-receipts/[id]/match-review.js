import { apiHeaders, ensureAuthSchema, json, requireUser } from '../../_auth.js';
import { isSameOriginMutation } from '../../_same-origin.js';
import { ensurePaymentReceiptSchema, getPaymentReceipt, readPaymentProjects, listPaymentReceiptCoverageMatches } from '../../_payment-receipts.js';
import { runDeepseekText } from '../../_deepseek-text.js';
import { preparePaymentReceiptMatchAi, paymentReceiptMatchAiMessages, validatePaymentReceiptMatchAi,
  paymentReceiptMatchAiFingerprint } from '../../../../payment-receipt-match-ai.js';

const EVENT_TYPE = 'receipt_match_ai_review';
const LEASE_MS = 150000;

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!isSameOriginMutation(context.request)) return json({ error: '请求来源不受信任' }, 403);
  if (!context.env.DB) return json({ error: '缴款单数据库尚未配置' }, 503);
  let claim = null;
  try {
    const body = await boundedBody(context.request);
    if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt || body.expectedUpdatedAt.length > 80) {
      throw failure(428, '请先刷新缴款单，再请求智能推荐。');
    }
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const owner = auth.user.id, receiptId = String(context.params.id || '');
    const snapshot = await readSnapshot(context.env.DB, owner, receiptId, body.expectedUpdatedAt);
    const inputFingerprint = await fingerprint(snapshot);
    const eventId = `receipt-match-ai-${await paymentReceiptMatchAiFingerprint({ owner, receiptId, inputFingerprint })}`;
    const response = (result, extra = {}) => json({ ok: true, receiptId, expectedUpdatedAt: body.expectedUpdatedAt,
      inputFingerprint, ...result, ...extra });
    if (!snapshot.prepared.candidates.length) {
      return response({ recommendations: [], warnings: snapshot.prepared.warnings.length ? snapshot.prepared.warnings
        : ['暂未找到具有债券身份依据的可用候选，请核对原件或手动搜索项目。'] }, { cached: false });
    }
    const cached = await readCache(context.env.DB, owner, receiptId, eventId);
    if (cached?.value?.status === 'ready' && cached.value.inputFingerprint === inputFingerprint) {
      try {
        const result = validatePaymentReceiptMatchAi(cached.value.result, snapshot.prepared);
        return response(result, { cached: true, model: cached.value.model, provider: cached.value.provider });
      } catch { /* Malformed cached advice is replaced only after this explicit request. */ }
    }
    if (cached?.value?.status === 'pending' && Date.now() - Date.parse(cached.createdAt) < LEASE_MS) {
      throw failure(409, '智能推荐正在生成，请稍后再试。');
    }
    if (String(context.env.AI_PROCESSING_APPROVED || '').toLowerCase().trim() !== 'true') {
      throw failure(503, '缴款单远端识别尚未启用。');
    }
    if (cached) {
      await context.env.DB.prepare('DELETE FROM payment_receipt_events WHERE id = ? AND owner_user_id = ? AND receipt_id = ? AND event_type = ? AND detail_json = ?')
        .bind(eventId, owner, receiptId, EVENT_TYPE, cached.raw).run();
    }
    const pending = JSON.stringify({ status: 'pending', inputFingerprint, leaseId: crypto.randomUUID() });
    const now = new Date().toISOString();
    const guarded = sourceGuard(snapshot, owner);
    const inserted = await context.env.DB.prepare(`INSERT OR IGNORE INTO payment_receipt_events
      (id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at)
      SELECT ?, r.owner_user_id, r.id, r.batch_id, ?, ?, ?
      FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
      JOIN payment_receipt_batches b ON b.id = r.batch_id
      WHERE ${guarded.sql}`).bind(eventId, EVENT_TYPE, pending, now, ...guarded.values).run();
    if (!changed(inserted)) throw failure(409, '单据状态已变化，或推荐正在生成，请刷新后再试。');
    claim = { eventId, owner, receiptId, pending };
    const result = await runDeepseekText(context.env, { purpose: 'receipt-match',
      messages: paymentReceiptMatchAiMessages(snapshot.prepared), maxTokens: 2200 },
    { fetchImpl: context.fetchImpl, signal: context.request.signal });
    let validated;
    try { validated = validatePaymentReceiptMatchAi(result.output, snapshot.prepared); }
    catch { throw failure(502, '推荐结果缺少可靠依据，请重试。'); }
    const current = await readSnapshot(context.env.DB, owner, receiptId, body.expectedUpdatedAt);
    if (await fingerprint(current) !== inputFingerprint || JSON.stringify(current.state) !== JSON.stringify(snapshot.state)) {
      throw failure(409, '单据或项目资料已变化，请刷新后重新推荐。');
    }
    const ready = JSON.stringify({ status: 'ready', inputFingerprint, model: result.model, provider: result.provider, result: validated });
    const guard = sourceGuard(current, owner);
    const updated = await context.env.DB.prepare(`UPDATE payment_receipt_events SET detail_json = ?
      WHERE id = ? AND owner_user_id = ? AND receipt_id = ? AND event_type = ? AND detail_json = ?
      AND EXISTS (SELECT 1 FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
        JOIN payment_receipt_batches b ON b.id = r.batch_id WHERE ${guard.sql})`)
      .bind(ready, eventId, owner, receiptId, EVENT_TYPE, pending, ...guard.values).run();
    if (!changed(updated)) throw failure(409, '单据或项目资料已变化，请刷新后重新推荐。');
    claim = null;
    return response(validated, { cached: false, model: result.model, provider: result.provider });
  } catch (error) {
    return json({ error: error.publicMessage || '智能推荐暂时不可用，请稍后重试。', ...(error.code ? { code: error.code } : {}) }, error.httpStatus || 502);
  } finally {
    if (claim) await context.env.DB.prepare('DELETE FROM payment_receipt_events WHERE id = ? AND owner_user_id = ? AND receipt_id = ? AND event_type = ? AND detail_json = ?')
      .bind(claim.eventId, claim.owner, claim.receiptId, EVENT_TYPE, claim.pending).run().catch(() => {});
  }
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: apiHeaders() }); }

async function readSnapshot(db, owner, id, expectedUpdatedAt) {
  const source = await db.prepare(`SELECT r.id, r.updated_at, r.sha256, r.source_pages_json, r.file_id,
    f.sha256 AS file_sha256, f.updated_at AS file_updated_at,
    f.processing_status AS file_status, b.processing_status AS batch_status
    FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
    JOIN payment_receipt_batches b ON b.id = r.batch_id AND b.id = f.batch_id
    WHERE r.owner_user_id = ? AND b.owner_user_id = ? AND r.id = ?`).bind(owner, owner, id).first();
  if (!source) throw failure(404, '未找到缴款单。');
  if (source.updated_at !== expectedUpdatedAt) throw failure(409, '单据信息已变化，请刷新后重新推荐。');
  if (![source.file_status, source.batch_status].every(value => ['processed', 'review'].includes(value))) {
    throw failure(409, '原件正在处理，请完成后重新推荐。');
  }
  const state = await stateVersion(db, owner);
  const receipt = await getPaymentReceipt(db, owner, id);
  if (!receipt || receipt.updatedAt !== expectedUpdatedAt) throw failure(409, '单据信息已变化，请刷新后重新推荐。');
  if (['duplicate', 'error'].includes(receipt.matchStatus)) throw failure(409, '请先处理重复或识别异常，再请求推荐。');
  const projects = await readPaymentProjects(db, owner);
  const coverage = await listPaymentReceiptCoverageMatches(db, owner);
  const prepared = preparePaymentReceiptMatchAi(receipt, projects, { unavailableTargets: coverage.filter(value => value.receiptId !== id) });
  if (JSON.stringify(await stateVersion(db, owner)) !== JSON.stringify(state)) throw failure(409, '项目资料已变化，请刷新后重新推荐。');
  return { source, state, prepared };
}

function stateVersion(db, owner) {
  return db.prepare('SELECT revision, updated_at FROM user_app_state WHERE user_id = ?').bind(owner).first();
}
// Unrelated workspace edits must not spend tokens again. The actual candidate
// fields are fingerprinted; the complete state revision still guards in-flight work.
function fingerprint(snapshot) { return paymentReceiptMatchAiFingerprint(snapshot.prepared, { source: snapshot.source }); }
function sourceGuard(snapshot, owner) {
  const s = snapshot.source;
  return { sql: `r.owner_user_id = ? AND b.owner_user_id = ? AND r.id = ? AND r.updated_at = ? AND r.sha256 = ?
    AND r.source_pages_json = ? AND r.file_id = ? AND f.sha256 = ? AND f.updated_at = ? AND f.batch_id = b.id
    AND f.processing_status IN ('processed', 'review') AND b.processing_status IN ('processed', 'review')
    AND EXISTS (SELECT 1 FROM user_app_state WHERE user_id = ? AND revision = ? AND updated_at = ?)`,
  values: [owner, owner, s.id, s.updated_at, s.sha256, s.source_pages_json, s.file_id, s.file_sha256, s.file_updated_at,
    owner, snapshot.state?.revision, snapshot.state?.updated_at] };
}
async function readCache(db, owner, receiptId, id) {
  const row = await db.prepare('SELECT detail_json, created_at FROM payment_receipt_events WHERE id = ? AND owner_user_id = ? AND receipt_id = ? AND event_type = ?')
    .bind(id, owner, receiptId, EVENT_TYPE).first();
  if (!row) return null;
  let value = null;
  try { value = JSON.parse(row.detail_json); } catch { /* A malformed cache is never used. */ }
  return { raw: row.detail_json, createdAt: row.created_at, value };
}
async function boundedBody(request) {
  if (Number(request.headers.get('Content-Length')) > 2048) throw failure(413, '请求内容过大。');
  const reader = request.body?.getReader();
  if (!reader) throw failure(400, '请求内容无效。');
  let length = 0; const parts = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength; if (length > 2048) { await reader.cancel(); throw failure(413, '请求内容过大。'); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* Safe error below. */ }
  throw failure(400, '请求内容无效。');
}
function changed(value) { return Number(value?.meta?.changes ?? value?.changes ?? 0) > 0; }
function failure(httpStatus, publicMessage) { return Object.assign(new Error(publicMessage), { httpStatus, publicMessage }); }
