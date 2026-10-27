import { PDFDocument } from 'pdf-lib';
import { apiHeaders, ensureAuthSchema, json, requireUser } from '../../_auth.js';
import { isSameOriginMutation } from '../../_same-origin.js';
import { ACCEPTED_IDENTITY_REVIEW_SQL, ensurePaymentReceiptSchema, getPaymentReceipt, readPaymentReceiptIdentityState } from '../../_payment-receipts.js';
import { extractPaymentReceiptPageImage } from '../../../../payment-receipt-worker.js';
import { normalizeManualReceiptName, parseReceiptIdentityReview, runReceiptIdentityReview } from '../../../../payment-receipt-identity-review.js';
import { normalizePaymentReceiptBondShortName } from '../../../../payment-receipt-names.js';
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
    if (!['preview', 'apply', 'manual'].includes(body.action)) throw failure(400, '不支持的简称复核操作');
    await ensureAuthSchema(context.env.DB);
    await ensurePaymentReceiptSchema(context.env.DB);
    const source = await readOwnedSource(context.env.DB, auth.user.id, String(context.params.id || ''));
    if (!source) throw failure(404, '未找到缴款单');
    assertReady(source);
    const pages = sourcePages(source.source_pages_json);
    if (!pages.length) throw failure(409, '缴款单原始页码不可用，请先核对拆页');
    if (body.action === 'manual') return await applyManualName(context, auth.user.id, source, pages, body);
    if (body.action === 'apply') return await applyReview(context, auth.user.id, source, pages, body.reviewId, body.fileReviewId);

    const receipt = await getPaymentReceipt(context.env.DB, auth.user.id, source.id);
    if (receipt?.identityReview && body.force !== true) {
      const accepted = receipt.identityReview;
      return json({ ok: true, cached: true, reviewId: accepted.reviewId, proposal: accepted, identityReview: accepted, receipt });
    }
    if (body.reuse === true && body.force !== true) {
      const reusable = await readReusableProposal(context.env.DB, auth.user.id, source, pages);
      if (reusable) {
        const current = await readOwnedSource(context.env.DB, auth.user.id, source.id);
        if (!current) throw failure(404, '未找到缴款单');
        assertReady(current);
        if (!proposalMatchesSource(reusable, current, sourcePages(current.source_pages_json), true)) throw failure(409, '原件或识别信息已经变化，请刷新后重新复核');
        return json({ ok: true, cached: true, reviewId: reusable.reviewId, proposal: publicProposal(reusable) });
      }
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
    const result = await runReceiptIdentityReview(ai, image, source.security_code);
    const now = new Date().toISOString();
    const reviewId = crypto.randomUUID();
    const proposal = { ...result, pageNumber: pages[0], originalName: String(source.bond_short_name || ''), reviewId,
      fileId: source.file_id, sourcePages: pages, receiptSha256: source.receipt_sha256,
      fileSha256: source.file_sha256, fileUpdatedAt: source.file_updated_at, receiptUpdatedAt: source.receipt_updated_at,
      expectedCode: source.security_code, priorReviewId: receipt?.identityReview?.reviewId || '', createdAt: now };
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
    && proposal.receiptSha256 === source.receipt_sha256 && proposal.fileSha256 === source.file_sha256
    && JSON.stringify(proposal.sourcePages) === JSON.stringify(pages) && proposal.pageNumber === pages[0]
    && verified && !verified.invalid && (!expected || !expected.invalid && samePaymentReceiptCode(expected, verified))
    && (!includeVersion || proposal.fileUpdatedAt === source.file_updated_at && proposal.receiptUpdatedAt === source.receipt_updated_at);
}

async function readReusableProposal(db, owner, source, pages) {
  const rows = await db.prepare(`SELECT id, detail_json FROM payment_receipt_events WHERE owner_user_id = ?1 AND receipt_id = ?2
    AND event_type = 'identity_review_proposed' ORDER BY created_at DESC, id DESC LIMIT 20`).bind(owner, source.id).all();
  for (const row of rows.results || []) {
    let proposal;
    try { proposal = JSON.parse(row.detail_json); } catch { continue; }
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) continue;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)) continue;
    const verified = parseReceiptIdentityReview(proposal.readings, source.security_code);
    if (verified.status !== 'verified' || !['verified','source_name_conflict'].includes(proposal.status === 'verified' ? 'verified' : proposal.reason)) continue;
    if (proposal.status==='verified' && (verified.name!==proposal.name
      || !samePaymentReceiptCode(paymentReceiptCodeIdentity(verified.code),paymentReceiptCodeIdentity(proposal.code)))) continue;
    const reusable = { ...proposal, ...verified, reviewId: row.id };
    if (!proposalMatchesSource(reusable, source, pages, true)) continue;
    return reusable;
  }
  return null;
}

async function applyReview(context, owner, source, pages, id, fileReviewId) {
  if (fileReviewId !== undefined && !validFileReviewId(fileReviewId)) throw failure(400, '整份文件复核记录无效');
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw failure(400, '复核记录无效');
  const row = await context.env.DB.prepare(`SELECT detail_json FROM payment_receipt_events WHERE id = ?1 AND owner_user_id = ?2
    AND receipt_id = ?3 AND event_type = 'identity_review_proposed'`).bind(id, owner, source.id).first();
  if (!row) throw failure(404, '未找到简称复核记录');
  let proposal;
  try { proposal = JSON.parse(row.detail_json); } catch { throw failure(409, '简称复核记录不可用，请重新复核'); }
  if (proposal?.status === 'verified' || proposal?.reason === 'source_name_conflict') {
    const verified = parseReceiptIdentityReview(proposal.readings, source.security_code);
    if(proposal.status==='verified'&&(verified.name!==proposal.name
      ||!samePaymentReceiptCode(paymentReceiptCodeIdentity(verified.code),paymentReceiptCodeIdentity(proposal.code))))throw failure(409,'简称复核记录不可用，请重新检测');
    if (verified.status === 'verified') proposal = { ...proposal, ...verified };
  }
  if (!proposalMatchesSource(proposal, source, pages, true)) throw failure(409, '原件或识别信息已经变化，请重新复核');
  const identityState = await readPaymentReceiptIdentityState(context.env.DB, owner, source.id);
  const prior = identityState.receipt?.identityReview;
  if (prior && normalizePaymentReceiptBondShortName(prior.name) === normalizePaymentReceiptBondShortName(proposal.name)) {
    return json({ ok:true, cached:true, changed:false, reviewId:prior.reviewId, fileReviewId:fileReviewId||'', identityReview:prior, receipt:identityState.receipt });
  }
  if ((prior?.reviewId || '') !== id && (proposal.priorReviewId || '') !== (prior?.reviewId || '')) {
    throw failure(409, '简称已被修改，请重新检测后再采用');
  }
  const acceptedId = fileReviewId ? `identity-review-auto-${fileReviewId}-${id}` : `identity-review-accepted-${id}`;
  const existing = await context.env.DB.prepare(`SELECT detail_json FROM payment_receipt_events WHERE id = ?1
    AND owner_user_id = ?2 AND receipt_id = ?3 AND event_type = 'identity_review_accepted'`).bind(acceptedId, owner, source.id).first();
  if (existing) {
    const latest = await readPaymentReceiptIdentityState(context.env.DB, owner, source.id);
    if (latest.record !== identityState.record && latest.receipt?.identityReview?.reviewId !== id) {
      throw failure(409, '简称已被修改，请刷新后再核对');
    }
    return json({ ok: true, cached: true, changed:false, reviewId: id, fileReviewId:fileReviewId||'', identityReview: latest.receipt?.identityReview, receipt: latest.receipt });
  }
  const now = new Date(Math.max(Date.now(), (Date.parse(prior?.acceptedAt || '') || 0) + 1)).toISOString();
  const accepted = { ...proposal, reviewId: id, acceptedAt: now,
    ...(fileReviewId ? {fileReviewId,previousIdentityRecord:identitySnapshot(identityState.record)} : {}) };
  const revokedId = fileReviewId ? await fileUndoMarkerId(owner,source.file_id,fileReviewId) : '';
  await insertGuardedEvent(context.env.DB, source, owner, acceptedId, 'identity_review_accepted', accepted, now, true, identityState.record, revokedId);
  return json({ ok: true, cached: false, changed:true, reviewId: id, fileReviewId:fileReviewId||'', identityReview: publicProposal(accepted), receipt: await getPaymentReceipt(context.env.DB, owner, source.id) });
}

async function applyManualName(context, owner, source, pages, body) {
  const name = normalizeManualReceiptName(body.name);
  if (!name) throw failure(400, '请填写 1–100 字的单行债券简称，不含控制字符');
  if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt
      || body.expectedUpdatedAt !== source.receipt_updated_at) throw failure(409, '单据状态已变化，请刷新后再修改简称');
  if (typeof body.expectedFileUpdatedAt !== 'string' || !body.expectedFileUpdatedAt
      || body.expectedFileUpdatedAt !== source.file_updated_at) throw failure(409, '原件状态已变化，请刷新后再修改简称');
  if (!source.receipt_sha256 || !source.file_sha256) throw failure(409, '原件校验信息不可用，请先核对单据');
  const identityState = await readPaymentReceiptIdentityState(context.env.DB, owner, source.id);
  const current = identityState.receipt;
  if (current?.identityReview?.source === 'manual' && current.identityReview.name === name) {
    return json({ ok: true, cached: true, reviewId: current.identityReview.reviewId, identityReview: current.identityReview, receipt: current });
  }
  if (body.expectedIdentityReviewId !== undefined && body.expectedIdentityReviewId !== (current?.identityReview?.reviewId || '')) {
    throw failure(409, '简称已被修改，请刷新后再核对');
  }
  const prior = current?.identityReview;
  const acceptedAt = new Date(Math.max(Date.now(), (Date.parse(prior?.acceptedAt || '') || 0) + 1)).toISOString();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
    owner, source.id, source.receipt_sha256, source.file_sha256, source.receipt_updated_at, source.file_updated_at,
    prior?.reviewId || '', name,
  ])));
  const id = `manual-name-${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2,'0')).join('')}`;
  const detail = { source: 'manual', status: 'verified', name, newName: name,
    originalName: String(source.bond_short_name || ''), previousName: prior?.name || String(source.bond_short_name || ''),
    editedBy: owner, acceptedAt, reviewId: id, pageNumber: pages[0], sourcePages: pages,
    fileId: source.file_id, fileSha256: source.file_sha256, fileUpdatedAt: source.file_updated_at,
    receiptSha256: source.receipt_sha256, receiptUpdatedAt: source.receipt_updated_at,
    code: String(source.security_code || ''), expectedCode: String(source.security_code || '') };
  await insertGuardedEvent(context.env.DB, source, owner, id, 'identity_name_manually_corrected', detail, acceptedAt, true, identityState.record);
  const receipt = await getPaymentReceipt(context.env.DB, owner, source.id);
  return json({ ok: true, cached: false, reviewId: receipt?.identityReview?.reviewId || id, identityReview: receipt?.identityReview, receipt });
}

function manualMatchesSource(detail, source, pages) {
  return detail.source === 'manual' && detail.editedBy === source.owner_user_id && Boolean(normalizeManualReceiptName(detail.name))
    && detail.fileId === source.file_id && detail.fileSha256 === source.file_sha256
    && detail.receiptSha256 === source.receipt_sha256 && detail.receiptUpdatedAt === source.receipt_updated_at
    && detail.fileUpdatedAt === source.file_updated_at && JSON.stringify(detail.sourcePages) === JSON.stringify(pages)
    && detail.pageNumber === pages[0] && detail.expectedCode === source.security_code;
}

async function insertGuardedEvent(db, source, owner, eventId, type, detail, now, ignoreExisting = false, expectedIdentityRecord = null, revokedId = '') {
  const result = await db.prepare(`INSERT ${ignoreExisting ? 'OR IGNORE' : ''} INTO payment_receipt_events
    (id, owner_user_id, receipt_id, batch_id, event_type, detail_json, created_at)
    SELECT ?1, r.owner_user_id, r.id, r.batch_id, ?2, ?3, ?4
    FROM payment_receipts r JOIN payment_receipt_files f ON f.id = r.file_id
    JOIN payment_receipt_batches b ON b.id = f.batch_id
    WHERE r.id = ?5 AND r.owner_user_id = ?6 AND b.owner_user_id = ?6 AND r.batch_id = b.id
      AND r.sha256 = ?7 AND r.source_pages_json = ?8 AND r.updated_at = ?9 AND r.security_code = ?10
      AND f.id = ?11 AND f.sha256 = ?12 AND f.updated_at = ?13
      AND f.processing_status IN ('processed', 'review') AND b.processing_status IN ('processed', 'review')
      AND (?14 IS NULL OR COALESCE(${ACCEPTED_IDENTITY_REVIEW_SQL}, '') = ?14)
      AND (?15 = '' OR NOT EXISTS(SELECT 1 FROM payment_receipt_events cancelled WHERE cancelled.id=?15
        AND cancelled.owner_user_id=r.owner_user_id AND cancelled.event_type='identity_file_review_undone'))`)
    .bind(eventId, type, JSON.stringify(detail), now, source.id, owner, source.receipt_sha256, source.source_pages_json,
      source.receipt_updated_at, source.security_code, source.file_id, source.file_sha256, source.file_updated_at, expectedIdentityRecord,revokedId).run();
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) > 0) return;
  if (ignoreExisting) {
    const current = await readOwnedSource(db, owner, source.id);
    const existing = await db.prepare('SELECT id FROM payment_receipt_events WHERE id = ?1 AND owner_user_id = ?2 AND receipt_id = ?3')
      .bind(eventId, owner, source.id).first();
    if (expectedIdentityRecord !== null) {
      const latest = await readPaymentReceiptIdentityState(db, owner, source.id);
      if (latest.record !== expectedIdentityRecord && latest.receipt?.identityReview?.reviewId !== detail.reviewId) {
        throw failure(409, '简称已被修改，请刷新后再核对');
      }
    }
    if (existing && current && (detail.source === 'manual'
        ? manualMatchesSource(detail, current, sourcePages(current.source_pages_json))
        : proposalMatchesSource(detail, current, sourcePages(current.source_pages_json), true))
      && readyStatuses.has(current.file_processing_status) && readyStatuses.has(current.batch_processing_status)) return;
  }
  throw failure(409, '原件或处理状态已经变化，请刷新后重新复核');
}

function validFileReviewId(value) { return typeof value==='string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value); }
function identitySnapshot(value) {
  try {
    const snapshot=JSON.parse(value||'null');
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))return '';
    delete snapshot.previousIdentityRecord;delete snapshot.fileReviewId;
    return JSON.stringify(snapshot);
  }catch{return '';}
}
async function fileUndoMarkerId(owner,fileId,fileReviewId){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner,fileId,fileReviewId])));
  return `identity-file-undo-${[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}`;
}

/** Undo is append-only; the marker also prevents an in-flight apply from arriving afterwards. */
export async function undoPaymentReceiptFileIdentityReview(context) {
  const auth=await requireUser(context);if(auth.response)return auth.response;
  if(!isSameOriginMutation(context.request))return json({error:'请求来源不受信任'},403);
  if(!context.env.DB)return json({error:'缴款单数据库尚未配置'},503);
  try{
    const body=await boundedJson(context.request);
    if(!validFileReviewId(body.fileReviewId))throw failure(400,'整份文件复核记录无效');
    await ensureAuthSchema(context.env.DB);await ensurePaymentReceiptSchema(context.env.DB);
    const owner=auth.user.id,fileId=String(context.params.id||''),db=context.env.DB;
    const file=await db.prepare(`SELECT f.id,f.batch_id FROM payment_receipt_files f
      JOIN payment_receipt_batches b ON b.id=f.batch_id WHERE f.id=?1 AND b.owner_user_id=?2`).bind(fileId,owner).first();
    if(!file)throw failure(404,'未找到原始缴款单附件');
    const markerId=await fileUndoMarkerId(owner,fileId,body.fileReviewId),now=new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO payment_receipt_events(id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at)
      VALUES(?1,?2,NULL,?3,'identity_file_review_undone',?4,?5)`)
      .bind(markerId,owner,file.batch_id,JSON.stringify({fileId,fileReviewId:body.fileReviewId,undoneAt:now}),now).run();
    const changes=await db.prepare(`SELECT e.id,e.receipt_id,e.detail_json FROM payment_receipt_events e
      WHERE e.owner_user_id=?1 AND e.batch_id=?2 AND e.event_type='identity_review_accepted'
      AND json_extract(CASE WHEN json_valid(e.detail_json) THEN e.detail_json ELSE '{}' END,'$.fileId')=?3
      AND json_extract(CASE WHEN json_valid(e.detail_json) THEN e.detail_json ELSE '{}' END,'$.fileReviewId')=?4
      ORDER BY e.created_at,e.rowid LIMIT 61`).bind(owner,file.batch_id,fileId,body.fileReviewId).all();
    const rows=changes.results||[];
    if(rows.length>60)throw failure(409,'本次复核记录过多，请刷新后核对');
    const receipts=[],seen=new Set();let restoredCount=0,skippedCount=0;
    for(const row of rows){
      if(seen.has(row.receipt_id))continue;seen.add(row.receipt_id);
      const source=await readOwnedSource(db,owner,row.receipt_id);
      if(!source||source.file_id!==fileId){skippedCount++;continue;}
      let current=await readPaymentReceiptIdentityState(db,owner,source.id);
      if(current.record!==row.detail_json){
        skippedCount++;if(current.receipt)receipts.push(current.receipt);continue;
      }
      const accepted=JSON.parse(row.detail_json),pages=sourcePages(source.source_pages_json);
      if(!readyStatuses.has(source.file_processing_status)||!readyStatuses.has(source.batch_processing_status)
        ||!proposalMatchesSource(accepted,source,pages,false)){
        skippedCount++;if(current.receipt)receipts.push(current.receipt);continue;
      }
      // Matching a project may update receipt.updated_at without changing the
      // image identity. Restore only this identity event; the INSERT still uses
      // the current source version and record as its concurrent-write guard.
      let previous;try{previous=JSON.parse(accepted.previousIdentityRecord||'null');}catch{previous=null;}
      const restoreId=`identity-restore-${row.id}`,restoredAt=new Date(Math.max(Date.now(),(Date.parse(accepted.acceptedAt)||0)+1)).toISOString();
      const restored=previous&&typeof previous==='object'&&!Array.isArray(previous)?{...previous}: {
        status:'reverted',source:'undo',fileId, fileSha256:source.file_sha256,receiptSha256:source.receipt_sha256,
        sourcePages:pages,pageNumber:pages[0],originalName:source.bond_short_name,code:source.security_code,
      };
      delete restored.previousIdentityRecord;delete restored.fileReviewId;
      Object.assign(restored,{reviewId:restoreId,acceptedAt:restoredAt,restoredFromReviewId:accepted.reviewId,revertedFileReviewId:body.fileReviewId});
      try{
        await insertGuardedEvent(db,source,owner,restoreId,'identity_review_restored',restored,restoredAt,false,current.record);
        restoredCount++;
      }catch(error){if(error.httpStatus!==409)throw error;skippedCount++;}
      current=await readPaymentReceiptIdentityState(db,owner,source.id);if(current.receipt)receipts.push(current.receipt);
    }
    return json({ok:true,fileReviewId:body.fileReviewId,restoredCount,skippedCount,receipts});
  }catch(error){return json({error:error.publicMessage||'撤销本次更新失败，请稍后重试'},error.httpStatus||502);}
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
