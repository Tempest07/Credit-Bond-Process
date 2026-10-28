const READY = new Set(['processed', 'review', 'error']);
const ACTIVE = new Set(['received', 'queued', 'processing', 'regrouping', 'reprocess_requested']);
const MAX_FILES = 500;

function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

/** Explicit full-library reruns reuse the existing file queue and archive tables. */
export async function requestPaymentReceiptRebuild(env, ownerUserId, input = {}, execution = null) {
  if (input.all !== true && (!Array.isArray(input.fileIds) || !input.fileIds.length)) {
    throw Object.assign(new Error('请选择要重新识别的文件'), { status: 400 });
  }
  const ids = input.all === true ? null : [...new Set(input.fileIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (ids && (!ids.length || ids.length > MAX_FILES)) throw Object.assign(new Error('一次最多重新识别 500 份文件'), { status: 400 });
  const requestId = String(execution?.requestId || '');
  if (requestId && !/^[a-f0-9-]{36}$/i.test(requestId)) throw Object.assign(new Error('识别任务编号无效'), { status:400 });
  if (requestId) {
    const prior = await env.DB.prepare(`SELECT id,event_type,detail_json FROM payment_receipt_events WHERE owner_user_id=?1 AND id=?2
      AND event_type IN ('library_rebuild_requested','library_rebuild_forwarded')`).bind(ownerUserId,requestId).first();
    if (prior) return {rebuild:await readPaymentReceiptRebuild(env.DB,ownerUserId,
      prior.event_type==='library_rebuild_requested' ? prior.id : parseJson(prior.detail_json,{}).rebuildId),reused:true};
  }
  const current = await readPaymentReceiptRebuild(env.DB, ownerUserId);
  if (current?.status === 'processing' || current?.finalized === false) {
    if (requestId) await env.DB.prepare(`INSERT OR IGNORE INTO payment_receipt_events(id,owner_user_id,event_type,detail_json,created_at)
      VALUES (?1,?2,'library_rebuild_forwarded',?3,?4)`).bind(requestId,ownerUserId,JSON.stringify({rebuildId:current.id}),new Date().toISOString()).run();
    return { rebuild: current, reused: true };
  }
  const selected = await env.DB.prepare(`
    SELECT f.id, f.batch_id, f.filename, f.object_key, f.processing_status, f.updated_at,
      f.page_count, b.received_date, b.message_id, b.processing_status AS batch_status
    FROM payment_receipt_files f JOIN payment_receipt_batches b ON b.id=f.batch_id
    WHERE b.owner_user_id=?1 AND (?2 IS NULL OR f.id IN (SELECT value FROM json_each(?2)))
    ORDER BY f.created_at, f.id LIMIT ?3
  `).bind(ownerUserId, ids ? JSON.stringify(ids) : null, MAX_FILES + 1).all();
  const files = selected.results || [];
  if (files.length > MAX_FILES) throw Object.assign(new Error('文件超过 500 份，请分批重新识别'), { status: 400 });
  if (ids && files.length !== ids.length) throw Object.assign(new Error('未找到所选原始文件'), { status: 404 });
  const ready = files.filter(file => READY.has(file.processing_status) && READY.has(file.batch_status));
  const skippedFiles = files.length - ready.length;
  if (!ready.length) throw Object.assign(new Error(skippedFiles ? '文件正在处理中，请稍后查看' : '暂无可重新识别的 PDF'), { status: 409 });

  const now = new Date().toISOString(), rebuildId = requestId || crypto.randomUUID();
  const snapshots = JSON.stringify(ready.map(file => ({ fileId: file.id, updatedAt: file.updated_at, status: file.processing_status })));
  const targetIds = JSON.stringify(ready.map(file => file.id));
  const detail = JSON.stringify({ fileIds: ready.map(file => file.id), skippedFiles, requestedAt: now });
  // The NOT NULL guard makes a raced file claim roll back every unlink and status
  // update. All old correspondences are recorded inside the same transaction.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO payment_receipt_events(id,owner_user_id,event_type,detail_json,created_at)
      VALUES (?1,(SELECT ?2 WHERE (SELECT COUNT(*) FROM payment_receipt_files f
        JOIN payment_receipt_batches b ON b.id=f.batch_id
        JOIN json_each(?3) s ON f.id=json_extract(s.value,'$.fileId')
        WHERE b.owner_user_id=?2 AND b.processing_status IN ('processed','review','error') AND f.updated_at=json_extract(s.value,'$.updatedAt')
          AND f.processing_status=json_extract(s.value,'$.status'))=?4),
        'library_rebuild_requested',?5,?6)`)
      .bind(rebuildId,ownerUserId,snapshots,ready.length,detail,now),
    env.DB.prepare(`INSERT INTO payment_receipt_events(id,owner_user_id,batch_id,event_type,detail_json,created_at)
      SELECT ?1||':'||f.id,?2,f.batch_id,'file_reprocess_requested',
        json_object('fileId',f.id,'rebuildId',?1,'previousStatus',f.processing_status,'releasedMatches',json((
          SELECT json_group_array(json_object('receiptId',m.receipt_id,'projectId',m.project_id,'trancheId',m.tranche_id,'matchSource',m.match_source))
          FROM payment_receipt_matches m JOIN payment_receipts r ON r.id=m.receipt_id AND r.owner_user_id=m.owner_user_id
          WHERE m.owner_user_id=?2 AND r.file_id=f.id))),?3
      FROM payment_receipt_files f WHERE f.id IN (SELECT value FROM json_each(?4))`)
      .bind(rebuildId,ownerUserId,now,targetIds),
    env.DB.prepare(`UPDATE payment_receipt_files SET processing_status='reprocess_requested',
      error_message='等待重新识别',updated_at=?1,
      grouping_json=json_set(CASE WHEN json_valid(grouping_json) THEN grouping_json ELSE '{}' END,
        '$.processing',json_object('rebuildId',?2,'requestedAt',?1,'stage','queued','completedPages',0,'totalPages',COALESCE(page_count,0)))
      WHERE id IN (SELECT value FROM json_each(?3))`).bind(now,rebuildId,targetIds),
    env.DB.prepare(`DELETE FROM payment_receipt_matches WHERE owner_user_id=?1 AND receipt_id IN
      (SELECT id FROM payment_receipts WHERE owner_user_id=?1 AND file_id IN (SELECT value FROM json_each(?2)))`)
      .bind(ownerUserId,targetIds),
    env.DB.prepare(`UPDATE payment_receipts SET match_status='review',candidate_json='[]',error_message='正在重新识别',updated_at=?1
      WHERE owner_user_id=?2 AND file_id IN (SELECT value FROM json_each(?3))`).bind(now,ownerUserId,targetIds),
    env.DB.prepare(`UPDATE payment_receipt_batches SET processing_status='processing',error_message='',updated_at=?1
      WHERE owner_user_id=?2 AND id IN (SELECT batch_id FROM payment_receipt_files WHERE id IN (SELECT value FROM json_each(?3)))`)
      .bind(now,ownerUserId,targetIds),
  ]);

  // Queues are the durable execution path. Without a Pages producer binding the
  // existing scheduled reconciler picks up the exact same persisted requests.
  const dispatch = dispatchRequestedPaymentReceiptFiles(env,ownerUserId,ready,now,rebuildId);
  if (typeof execution?.waitUntil==='function') execution.waitUntil(dispatch);
  else await dispatch;
  return { rebuild: await readPaymentReceiptRebuild(env.DB,ownerUserId,rebuildId), reused:false };
}

export async function dispatchRequestedPaymentReceiptFiles(env, ownerUserId, files, requestedAt, rebuildId = '') {
  if (!env.RECEIPT_QUEUE || !files.length) return;
  const queuedAt = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE payment_receipt_files SET processing_status='queued',updated_at=?1
    WHERE id IN (SELECT value FROM json_each(?2)) AND processing_status='reprocess_requested' AND updated_at=?3
      AND batch_id IN (SELECT id FROM payment_receipt_batches WHERE owner_user_id=?4) RETURNING id`)
    .bind(queuedAt,JSON.stringify(files.map(file=>file.id)),requestedAt,ownerUserId).all();
  const claimed = new Set((result.results || []).map(file=>file.id));
  const pending = files.filter(file=>claimed.has(file.id));
  for (let offset=0;offset<pending.length;offset+=100) {
    const group = pending.slice(offset,offset+100);
    const messages = group.map(file=>({body:{kind:'file',ownerUserId,batchId:file.batch_id,fileId:file.id,
      objectKey:file.object_key,filename:file.filename,receivedDate:file.received_date,
      forceReanalyze:true,rebuildId,messageIdConflict:String(file.message_id || '').includes('#sha256:')}}));
    try {
      if (typeof env.RECEIPT_QUEUE.sendBatch==='function') await env.RECEIPT_QUEUE.sendBatch(messages);
      else await Promise.all(messages.map(message=>env.RECEIPT_QUEUE.send(message.body)));
    } catch {
      await env.DB.prepare(`UPDATE payment_receipt_files SET processing_status='reprocess_requested',error_message='等待后台重试',updated_at=?1
        WHERE id IN (SELECT value FROM json_each(?2)) AND processing_status='queued' AND updated_at=?3`)
        .bind(new Date().toISOString(),JSON.stringify(group.map(file=>file.id)),queuedAt).run();
    }
  }
}

export async function readPaymentReceiptRebuild(db, ownerUserId, rebuildId = '') {
  const event = await db.prepare(`SELECT id,detail_json,created_at FROM payment_receipt_events
    WHERE owner_user_id=?1 AND event_type='library_rebuild_requested' AND (?2='' OR id=?2)
    ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(ownerUserId,rebuildId).first();
  if (!event) return null;
  const detail = parseJson(event.detail_json,{}), fileIds = Array.isArray(detail.fileIds) ? detail.fileIds : [];
  const targetIds = JSON.stringify(fileIds);
  const rows = await db.prepare(`SELECT f.id,f.filename,f.processing_status,f.page_count,f.grouping_json,f.error_message
    FROM payment_receipt_files f JOIN payment_receipt_batches b ON b.id=f.batch_id
    WHERE b.owner_user_id=?1 AND f.id IN (SELECT value FROM json_each(?2)) ORDER BY f.created_at,f.id`)
    .bind(ownerUserId,targetIds).all();
  const files = (rows.results || []).map(file => {
    const progress = parseJson(file.grouping_json,{}).processing || {};
    const isThisRun = progress.rebuildId === event.id;
    const done = !ACTIVE.has(file.processing_status);
    const failed = done && (file.processing_status==='error' || (isThisRun && progress.stage!=='complete' && Boolean(file.error_message)));
    return { fileId:file.id, filename:file.filename, status:file.processing_status,
      stage:isThisRun ? progress.stage || '' : '',
      totalPages:Number(file.page_count) || Number(progress.totalPages) || 0,
      completedPages:done && !failed ? Number(file.page_count) || 0 : isThisRun ? Number(progress.completedPages) || 0 : 0,
      failed, error:failed ? String(file.error_message || '') : '',
    };
  });
  const counts = await db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN r.match_status='matched' THEN 1 ELSE 0 END) matched,
    SUM(CASE WHEN r.match_status='review' OR r.match_status='error' THEN 1 ELSE 0 END) review,
    SUM(CASE WHEN r.match_status='unmatched' THEN 1 ELSE 0 END) archived,
    SUM(CASE WHEN r.match_status='duplicate' THEN 1 ELSE 0 END) duplicate
    FROM payment_receipts r WHERE r.owner_user_id=?1 AND r.file_id IN (SELECT value FROM json_each(?2))`)
    .bind(ownerUserId,targetIds).first();
  const failedFiles = files.filter(file => file.failed).length;
  const completedFiles = files.filter(file => !ACTIVE.has(file.status) && !file.failed).length;
  const finalized=Boolean(await db.prepare(`SELECT id FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2 AND event_type='library_rebuild_completed'`)
    .bind(event.id+':completed',ownerUserId).first());
  return { id:event.id, startedAt:event.created_at, status:completedFiles+failedFiles===fileIds.length ? (failedFiles ? 'completed_with_errors':'completed'):'processing',
    finalized,finalizing:completedFiles+failedFiles===fileIds.length && !finalized,
    totalFiles:fileIds.length, completedFiles, failedFiles,
    queuedFiles:files.filter(file => ['received','queued','reprocess_requested'].includes(file.status)).length,
    processingFiles:files.filter(file => ['processing','regrouping'].includes(file.status)).length,
    totalPages:files.reduce((total,file)=>total+file.totalPages,0),
    completedPages:files.reduce((total,file)=>total+file.completedPages,0),
    skippedFiles:Number(detail.skippedFiles)||0, receiptCount:Number(counts?.total)||0,
    matchedCount:Number(counts?.matched)||0,reviewCount:Number(counts?.review)||0,
    archivedCount:Number(counts?.archived)||0,duplicateCount:Number(counts?.duplicate)||0, files };
}
