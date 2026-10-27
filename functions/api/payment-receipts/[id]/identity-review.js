import { PDFDocument } from 'pdf-lib';
import { apiHeaders, ensureAuthSchema, json, requireUser } from '../../_auth.js';
import { isSameOriginMutation } from '../../_same-origin.js';
import { ensurePaymentReceiptSchema, getPaymentReceipt } from '../../_payment-receipts.js';
import { extractPaymentReceiptPageImage } from '../../../../payment-receipt-worker.js';
import { compatibleReceiptNameCorrection, runReceiptIdentityReview } from '../../../../payment-receipt-identity-review.js';
import { paymentReceiptCodeIdentity, samePaymentReceiptCode } from '../../../../payment-receipt-security.js';
import { selectDeepSeekOcr } from '../../../../ocr-deepseek.js';

const MAX_BODY_BYTES = 4096;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 60;
const readyStatuses = new Set(['processed', 'review']);

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  if (!isSameOriginMutation(context.request)) return json({ error: '请求来源不受信任' }, 403);
  if (!context.env.DB || !context.env.PAYMENT_RECEIPTS) return json({ error: '缴款单数据库或存储尚未配置' }, 503);
  try {
    const body = await boundedJson(context.request);
    if (!['preview', 'apply'].includes(body.action)) throw failure(400, '不支持的简称复核操作');
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const source = await readOwnedSource(context.env.DB, auth.user.id, String(context.params.id || ''));
    if (!source) throw failure(404, '未找到缴款单');
    assertReady(source);
    const pages = sourcePages(source.source_pages_json);
    if (!pages.length) throw failure(409, '缴款单原始页码不可用，请先核对拆页');
    if (body.action === 'apply') return await applyReview(context, auth.user.id, source, pages, body.reviewId);

    const accepted = await readAccepted(context.env.DB, auth.user.id, source.id);
    if (accepted && proposalMatchesSource(accepted, source, pages)) {
      const receipt = await getPaymentReceipt(context.env.DB, auth.user.id, source.id);
      return json({ ok: true, cached: true, reviewId: accepted.reviewId, proposal: publicProposal(accepted), identityReview: publicProposal(accepted), receipt });
    }
    const ai = selectAi(context);
    if (!ai) throw failure(503, '简称复核服务尚未配置');
    if (Number(source.byte_size) > MAX_PDF_BYTES) throw failure(413, '原件超过简称复核大小限制');
    const object = await context.env.PAYMENT_RECEIPTS.get(source.object_key);
    if (!object) throw failure(404, '原始缴款单不存在');
    if (Number(object.size) > MAX_PDF_BYTES) throw failure(413, '原件超过简称复核大小限制');
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength > MAX_PDF_BYTES) throw failure(413, '原件超过简称复核大小限制');
    const actualHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actualHash !== source.file_sha256) throw failure(409, '原件校验信息已经变化，请刷新后重试');
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    if (pdf.getPageCount() > MAX_PDF_PAGES || pages.some(page => page > pdf.getPageCount())) throw failure(409, '原件页码已经变化，请刷新后重试');
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(pdf, [pages[0] - 1]);
    single.addPage(page);
    const image = await extractPaymentReceiptPageImage(await single.save());
    let result = await runReceiptIdentityReview(ai, image, source.security_code);
    if (result.status === 'verified' && !compatibleReceiptNameCorrection(source.bond_short_name, result.name)) {
      result = { ...result, status: 'conflict', name: '', code: '', reason: 'source_name_conflict' };
    }
    const now = new Date().toISOString();
    const reviewId = crypto.randomUUID();
    const proposal = { ...result, pageNumber: pages[0], originalName: String(source.bond_short_name || ''), reviewId,
      fileId: source.file_id, sourcePages: pages, receiptSha256: source.receipt_sha256,
      fileSha256: source.file_sha256, fileUpdatedAt: source.file_updated_at, receiptUpdatedAt: source.receipt_updated_at,
      expectedCode: source.security_code, createdAt: now };
    await insertGuardedEvent(context.env.DB, source, auth.user.id, reviewId, 'identity_review_proposed', proposal, now);
    return json({ ok: true, cached: false, reviewId, proposal: publicProposal(proposal) });
  } catch (error) {
    return json({ error: error.publicMessage || '简称复核暂时不可用，请稍后重试' }, error.httpStatus || 502);
  }
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: apiHeaders() }); }

async function boundedJson(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) throw failure(413, '请求数据过大');
  const reader = request.body?.getReader();
  if (!reader) throw failure(400, '请求数据无效');
  const parts = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw failure(413, '请求数据过大'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* Public error below. */ }
  throw failure(400, '请求数据无效');
}

async function readOwnedSource(db, owner, id) {
  return db.prepare(`SELECT r.id, r.owner_user_id, r.batch_id, r.file_id, r.source_pages_json,
    r.sha256 AS receipt_sha256, r.updated_at AS receipt_updated_at, r.security_code, r.bond_short_name,
    f.sha256 AS file_sha256, f.updated_at AS file_updated_at, f.processing_status AS file_processing_status,
    f.object_key, f.byte_size, b.processing_status AS batch_processing_status
    FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
    JOIN payment_receipt_batches b ON b.id = f.batch_id
    WHERE r.id = ?1 AND r.owner_user_id = ?2 AND b.owner_user_id = ?2 AND r.batch_id = b.id`)
    .bind(id, owner).first();
}

function assertReady(source) {
  if (!readyStatuses.has(source.file_processing_status) || !readyStatuses.has(source.batch_processing_status)) {
    throw failure(409, '原件正在处理或拆页，请完成后重试');
  }
}

function sourcePages(value) {
  try { const pages = JSON.parse(value); return Array.isArray(pages) && pages.length && pages.length <= MAX_PDF_PAGES
    && pages.every(page => Number.isInteger(page) && page >= 1 && page <= MAX_PDF_PAGES)
    && new Set(pages).size === pages.length ? pages : []; } catch { return []; }
}

function publicProposal(value) {
  return { status: value.status, name: value.name, code: value.code, readings: value.readings,
    pageNumber: value.pageNumber, model: value.model, reason: value.reason || '', originalName: String(value.originalName || '').slice(0, 100) };
}

function proposalMatchesSource(proposal, source, pages, includeVersion = false) {
  const expected = paymentReceiptCodeIdentity(source.security_code), verified = paymentReceiptCodeIdentity(proposal.code);
  return proposal.status === 'verified' && proposal.fileId === source.file_id
    && compatibleReceiptNameCorrection(source.bond_short_name, proposal.name)
    && proposal.receiptSha256 === source.receipt_sha256 && proposal.fileSha256 === source.file_sha256
    && JSON.stringify(proposal.sourcePages) === JSON.stringify(pages) && proposal.pageNumber === pages[0]
    && verified && !verified.invalid && (!expected || !expected.invalid && samePaymentReceiptCode(expected, verified))
    && (!includeVersion || proposal.fileUpdatedAt === source.file_updated_at && proposal.receiptUpdatedAt === source.receipt_updated_at);
}

async function readAccepted(db, owner, id) {
  const row = await db.prepare(`SELECT detail_json FROM payment_receipt_events WHERE owner_user_id = ?1 AND receipt_id = ?2
    AND event_type = 'identity_review_accepted' ORDER BY created_at DESC, id DESC LIMIT 1`).bind(owner, id).first();
  try { return row ? JSON.parse(row.detail_json) : null; } catch { return null; }
}

async function applyReview(context, owner, source, pages, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw failure(400, '复核记录无效');
  const row = await context.env.DB.prepare(`SELECT detail_json FROM payment_receipt_events WHERE id = ?1 AND owner_user_id = ?2
    AND receipt_id = ?3 AND event_type = 'identity_review_proposed'`).bind(id, owner, source.id).first();
  if (!row) throw failure(404, '未找到简称复核记录');
  let proposal;
  try { proposal = JSON.parse(row.detail_json); } catch { throw failure(409, '简称复核记录不可用，请重新复核'); }
  if (!proposalMatchesSource(proposal, source, pages, true)) throw failure(409, '原件或识别信息已经变化，请重新复核');
  const acceptedId = `identity-review-accepted-${id}`;
  const existing = await context.env.DB.prepare(`SELECT detail_json FROM payment_receipt_events WHERE id = ?1
    AND owner_user_id = ?2 AND receipt_id = ?3 AND event_type = 'identity_review_accepted'`).bind(acceptedId, owner, source.id).first();
  if (existing) {
    const accepted = JSON.parse(existing.detail_json);
    return json({ ok: true, cached: true, reviewId: id, identityReview: publicProposal(accepted), receipt: await getPaymentReceipt(context.env.DB, owner, source.id) });
  }
  const now = new Date().toISOString();
  const accepted = { ...proposal, reviewId: id, acceptedAt: now };
  await insertGuardedEvent(context.env.DB, source, owner, acceptedId, 'identity_review_accepted', accepted, now, true);
  return json({ ok: true, cached: false, reviewId: id, identityReview: publicProposal(accepted), receipt: await getPaymentReceipt(context.env.DB, owner, source.id) });
}

async function insertGuardedEvent(db, source, owner, eventId, type, detail, now, ignoreExisting = false) {
  const result = await db.prepare(`INSERT ${ignoreExisting ? 'OR IGNORE' : ''} INTO payment_receipt_events
    (id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at)
    SELECT ?1, r.owner_user_id, r.id, r.batch_id, ?2, ?3, ?4
    FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
    JOIN payment_receipt_batches b ON b.id = f.batch_id
    WHERE r.id = ?5 AND r.owner_user_id = ?6 AND b.owner_user_id = ?6 AND r.batch_id = b.id
      AND r.sha256 = ?7 AND r.source_pages_json = ?8 AND r.updated_at = ?9 AND r.security_code = ?10
      AND f.id = ?11 AND f.sha256 = ?12 AND f.updated_at = ?13
      AND f.processing_status IN ('processed', 'review') AND b.processing_status IN ('processed', 'review')`)
    .bind(eventId, type, JSON.stringify(detail), now, source.id, owner, source.receipt_sha256, source.source_pages_json,
      source.receipt_updated_at, source.security_code, source.file_id, source.file_sha256, source.file_updated_at).run();
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) > 0) return;
  if (ignoreExisting) {
    const current = await readOwnedSource(db, owner, source.id);
    const existing = await db.prepare('SELECT id FROM payment_receipt_events WHERE id = ?1 AND owner_user_id = ?2 AND receipt_id = ?3')
      .bind(eventId, owner, source.id).first();
    if (existing && current && proposalMatchesSource(detail, current, sourcePages(current.source_pages_json), true)
      && readyStatuses.has(current.file_processing_status) && readyStatuses.has(current.batch_processing_status)) return;
  }
  throw failure(409, '原件或处理状态已经变化，请刷新后重新复核');
}

function selectAi(context) {
  const deepseek = selectDeepSeekOcr(context.env, { fetchImpl: context.fetchImpl, signal: context.request.signal });
  if (deepseek) {
    if (String(context.env.AI_PROCESSING_APPROVED).trim().toLowerCase() !== 'true') {
      throw failure(503, '缴款单远端识别尚未启用');
    }
    return deepseek;
  }
  if (typeof context.env.AI?.run === 'function' && String(context.env.AI_PROCESSING_APPROVED).trim().toLowerCase() === 'true') return context.env.AI;
  const host = new URL(context.request.url).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || context.env.CF_PAGES_BRANCH !== 'local') return null;
  let base;
  try { base = new URL(context.env.PAYMENT_RECEIPT_LOCAL_AI_URL); } catch { return null; }
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) return null;
  return {
    model: 'qwen3-vl:8b-instruct',
    async run(_model, input) {
      const content = input.messages[0].content;
      const image = content.find(item => item.type === 'image_url')?.image_url?.url || '';
      const response = await fetch(new URL('/api/chat', base), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000), redirect: 'manual',
        body: JSON.stringify({ model: 'qwen3-vl:8b-instruct', stream: false, keep_alive: 0, format: 'json',
          messages: [{ role: 'user', content: content.find(item => item.type === 'text')?.text || '', images: [image.split(',')[1] || ''] }],
          options: { temperature: 0, num_ctx: 8192, num_predict: 400 } }),
      }).catch(error => {
        console.warn(JSON.stringify({ event: 'local_receipt_vision_transport_failed', error: String(error?.message || 'network error').slice(0, 240) }));
        throw error;
      });
      if (!response.ok || Number(response.headers.get('Content-Length')) > 64 * 1024) throw new Error('local-ai-unavailable');
      const text = await limitedLocalResponse(response);
      return JSON.parse(text);
    },
  };
}

async function limitedLocalResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('local-ai-empty-response');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64 * 1024) { await reader.cancel(); throw new Error('local-ai-response-too-large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function failure(status, message) { return Object.assign(new Error(message), { httpStatus: status, publicMessage: message }); }
