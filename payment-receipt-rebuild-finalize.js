import {readPaymentReceiptRebuild} from './functions/api/_payment-receipt-rebuild.js';
import {ACCEPTED_IDENTITY_REVIEW_SQL,getPaymentReceipt,paymentReceiptFromRow,readPaymentProjects} from './functions/api/_payment-receipts.js';
import {selectPaymentReceiptMatch} from './payment-receipts.js';

/** A cheap, repeatable final pass settles cross-file duplicate races without AI. */
export async function finalizePaymentReceiptRebuild(env, ownerUserId, rebuildId) {
  if (!rebuildId) return null;
  const completionId=rebuildId+':completed';
  if(await env.DB.prepare('SELECT id FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2').bind(completionId,ownerUserId).first())return null;
  const rebuild=await readPaymentReceiptRebuild(env.DB,ownerUserId,rebuildId);
  if(!rebuild || rebuild.status==='processing')return null;
  const fileIds=JSON.stringify(rebuild.files.map(file=>file.fileId)),selected=new Set(rebuild.files.map(file=>file.fileId));
  const runValues=[ownerUserId,rebuildId,fileIds];
  if(!await env.DB.prepare(`SELECT 1 AS valid WHERE ${rebuildFence()}`).bind(...runValues).first())return null;
  const rows=(await env.DB.prepare(`SELECT r.*,m.match_source,m.project_id,m.tranche_id
    FROM payment_receipts r JOIN payment_receipt_files f ON f.id=r.file_id
    LEFT JOIN payment_receipt_matches m ON m.receipt_id=r.id AND m.owner_user_id=r.owner_user_id
    WHERE r.owner_user_id=?1 AND r.recognition_status='recognized' AND r.sha256<>''
      AND f.processing_status IN ('processed','review')
      AND r.error_message NOT IN ('正在重新识别','已申请重新识别，等待后台任务')
      AND r.sha256 IN (SELECT sha256 FROM payment_receipts WHERE owner_user_id=?1 AND file_id IN (SELECT value FROM json_each(?2)))
    ORDER BY r.created_at,r.id`).bind(ownerUserId,fileIds).all()).results||[];
  const groups=new Map();for(const row of rows){if(!groups.has(row.sha256))groups.set(row.sha256,[]);groups.get(row.sha256).push(row);}
  const statements=[],guardedUpdateIndexes=[],canonicalIds=[],now=new Date().toISOString();let duplicateCount=0,needsRetry=false;
  for(const group of groups.values()){
    // A correspondence the user confirmed during the rebuild takes priority.
    // Never undo a new manual decision, even if another copy is chronologically older.
    const manual=group.filter(row=>row.match_source==='manual');
    if(manual.length>1)continue;
    const canonical=manual[0]||group[0];
    // An older copy outside this request can be the canonical original, but its
    // project correspondence is outside the scope of this requested rerun.
    if(selected.has(canonical.file_id))canonicalIds.push(canonical.id);
    const duplicates=group.filter(row=>row.id!==canonical.id && selected.has(row.file_id) && row.match_source!=='manual');
    for(const row of duplicates){
      if(row.match_status==='duplicate' && !row.project_id && row.error_message==='与已归档缴款单 '+canonical.id+' 内容相同')continue;
      duplicateCount++;
      const guard=`r.id=?4 AND r.owner_user_id=?1 AND r.updated_at=?5 AND r.sha256=?6
        AND ${rebuildFence()} AND EXISTS (SELECT 1 FROM payment_receipts canonical
          JOIN payment_receipt_files source ON source.id=canonical.file_id
          WHERE canonical.id=?7 AND canonical.owner_user_id=?1 AND canonical.updated_at=?8 AND canonical.sha256=?6
            AND canonical.recognition_status='recognized' AND source.processing_status IN ('processed','review')
            AND canonical.error_message NOT IN ('正在重新识别','已申请重新识别，等待后台任务'))
        AND NOT EXISTS (SELECT 1 FROM payment_receipt_matches m WHERE m.receipt_id=r.id AND m.match_source='manual')`;
      const values=[...runValues,row.id,row.updated_at,row.sha256,canonical.id,canonical.updated_at];
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO payment_receipt_events(id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at)
        SELECT ?9,r.owner_user_id,r.id,r.batch_id,'receipt_duplicate_reconciled',?10,?11 FROM payment_receipts r WHERE ${guard}`)
        .bind(...values,rebuildId+':duplicate:'+row.id,JSON.stringify({rebuildId,duplicateOf:canonical.id,previousStatus:row.match_status,previousProjectId:row.project_id||'',previousTrancheId:row.tranche_id||''}),now));
      statements.push(env.DB.prepare(`DELETE FROM payment_receipt_matches WHERE match_source<>'manual' AND receipt_id IN
        (SELECT r.id FROM payment_receipts r WHERE ${guard})`).bind(...values));
      guardedUpdateIndexes.push(statements.length);
      statements.push(env.DB.prepare(`UPDATE payment_receipts AS r SET match_status='duplicate',candidate_json='[]',error_message=?9,updated_at=?10 WHERE ${guard}`)
        .bind(...values,'与已归档缴款单 '+canonical.id+' 内容相同',now));
    }
    if(canonical.match_status==='duplicate' && selected.has(canonical.file_id)){
      guardedUpdateIndexes.push(statements.length);
      statements.push(env.DB.prepare(`UPDATE payment_receipts AS r SET match_status='review',candidate_json='[]',error_message='',updated_at=?6
        WHERE r.id=?4 AND r.owner_user_id=?1 AND r.updated_at=?5 AND ${rebuildFence()}
          AND NOT EXISTS(SELECT 1 FROM payment_receipt_matches m WHERE m.receipt_id=?4 AND m.match_source='manual')`)
        .bind(...runValues,canonical.id,canonical.updated_at,now));
    }
  }
  if(statements.length){
    const results=await env.DB.batch(statements);
    // A raced user edit or another finalizer can invalidate an update. Leave
    // the completion marker absent so the cheap sweep can reconsider it.
    if(guardedUpdateIndexes.some(index=>!changed(results[index])))needsRetry=true;
  }
  const projects=await readPaymentProjects(env.DB,ownerUserId);let matchedCount=0;
  // One bulk read keeps a 600+ receipt sweep well below D1's per-invocation
  // request limit; the following mutations still compare each row's version.
  const canonicalRows=canonicalIds.length?(await env.DB.prepare(`SELECT r.*,f.sha256 AS source_file_sha256,
    ${ACCEPTED_IDENTITY_REVIEW_SQL} AS identity_review_json,m.project_id,m.tranche_id,m.match_source,m.match_score,m.match_reason
    FROM payment_receipts r JOIN payment_receipt_files f ON f.id=r.file_id
    LEFT JOIN payment_receipt_matches m ON m.receipt_id=r.id AND m.owner_user_id=r.owner_user_id
    WHERE r.owner_user_id=?1 AND r.id IN (SELECT value FROM json_each(?2))`)
    .bind(ownerUserId,JSON.stringify(canonicalIds)).all()).results||[]:[];
  for(const row of canonicalRows){
    const receipt=paymentReceiptFromRow(row),id=receipt.id;
    if(receipt.projectId || receipt.matchStatus==='duplicate')continue;
    const values=[...runValues,id,receipt.updatedAt];
    const guard=unmatchedReceiptFence();
    const match=selectPaymentReceiptMatch(receipt,projects);
    if(match.status!=='matched'){
      const nextError=match.status==='review'?match.reason:'';
      if(receipt.matchStatus===match.status && receipt.errorMessage===nextError
        && JSON.stringify(receipt.candidates||[])===JSON.stringify(match.candidates||[]))continue;
      const result=await env.DB.prepare(`UPDATE payment_receipts AS r SET match_status=?6,candidate_json=?7,error_message=?8,updated_at=?9 WHERE ${guard}`)
        .bind(...values,match.status,JSON.stringify(match.candidates||[]),nextError,new Date().toISOString()).run();
      if(!changed(result))needsRetry=true;
      continue;
    }
    const matchId=crypto.randomUUID(),matchedAt=new Date().toISOString();
    try{
      const results=await env.DB.batch([
        env.DB.prepare(`INSERT INTO payment_receipt_matches(id,owner_user_id,receipt_id,project_id,tranche_id,match_source,match_score,match_reason,created_at,updated_at)
          SELECT ?6,?1,r.id,?7,?8,'auto',?9,?10,?11,?11 FROM payment_receipts r WHERE ${guard}`)
          .bind(...values,matchId,match.projectId,match.trancheId,match.score,match.reason,matchedAt),
        env.DB.prepare(`UPDATE payment_receipts AS r SET match_status='matched',candidate_json='[]',error_message='',updated_at=?7
          WHERE r.id=?4 AND r.owner_user_id=?1 AND r.updated_at=?5 AND ${rebuildFence()}
            AND EXISTS(SELECT 1 FROM payment_receipt_matches m WHERE m.id=?6 AND m.receipt_id=r.id AND m.owner_user_id=?1)`)
          .bind(...values,matchId,matchedAt),
      ]);
      if(changed(results[0]))matchedCount++;else needsRetry=true;
    }catch(error){
      if(!/UNIQUE constraint/i.test(error.message||''))throw error;
      // Another completion pass or the user may have linked this row meanwhile.
      const current=await getPaymentReceipt(env.DB,ownerUserId,id);
      if(!current?.projectId){
        const result=await env.DB.prepare(`UPDATE payment_receipts AS r SET match_status='review',candidate_json=?6,error_message='项目已有缴款单，请核对',updated_at=?7 WHERE ${guard}`)
          .bind(...values,JSON.stringify(match.candidates||[]),new Date().toISOString()).run();
        if(!changed(result))needsRetry=true;
      }
    }
  }
  if(needsRetry)return{duplicateCount,matchedCount,deferred:true};
  await env.DB.prepare(`INSERT OR IGNORE INTO payment_receipt_events(id,owner_user_id,event_type,detail_json,created_at)
    SELECT ?4,?1,'library_rebuild_completed',?5,?6 WHERE ${rebuildFence()}`)
    .bind(...runValues,completionId,JSON.stringify({rebuildId,duplicateCount,matchedCount,failedFiles:rebuild.failedFiles}),now).run();
  return{duplicateCount,matchedCount};
}

function changed(result){return Number(result?.meta?.changes??result?.changes??0);}
function rebuildFence(){
  return `(SELECT COUNT(*) FROM payment_receipt_files owned_file JOIN payment_receipt_batches owned_batch ON owned_batch.id=owned_file.batch_id
    WHERE owned_batch.owner_user_id=?1 AND owned_file.id IN (SELECT value FROM json_each(?3)))=json_array_length(?3)
    AND NOT EXISTS (SELECT 1 FROM payment_receipt_files run_file JOIN payment_receipt_batches run_batch ON run_batch.id=run_file.batch_id
    WHERE run_batch.owner_user_id=?1 AND run_file.id IN (SELECT value FROM json_each(?3))
      AND (run_file.processing_status NOT IN ('processed','review','error') OR
        COALESCE(json_extract(CASE WHEN json_valid(run_file.grouping_json) THEN run_file.grouping_json ELSE '{}' END,'$.processing.rebuildId'),'')<>?2))`;
}
function unmatchedReceiptFence(){
  return `r.id=?4 AND r.owner_user_id=?1 AND r.updated_at=?5 AND r.recognition_status='recognized' AND r.match_status<>'duplicate'
    AND r.error_message NOT IN ('正在重新识别','已申请重新识别，等待后台任务') AND ${rebuildFence()}
    AND EXISTS (SELECT 1 FROM payment_receipt_files f WHERE f.id=r.file_id AND f.processing_status IN ('processed','review'))
    AND NOT EXISTS (SELECT 1 FROM payment_receipt_matches m WHERE m.receipt_id=r.id)`;
}

export async function finalizePendingPaymentReceiptRebuilds(env){
  const rows=(await env.DB.prepare(`SELECT e.id,e.owner_user_id FROM payment_receipt_events e
    WHERE e.event_type='library_rebuild_requested' AND NOT EXISTS
      (SELECT 1 FROM payment_receipt_events done WHERE done.id=e.id||':completed' AND done.owner_user_id=e.owner_user_id)
    ORDER BY e.created_at LIMIT 10`).all()).results||[];
  for(const row of rows){
    try{await finalizePaymentReceiptRebuild(env,row.owner_user_id,row.id);}
    catch(error){console.warn(JSON.stringify({event:'payment_receipt_rebuild_finalize_retry',rebuildId:row.id,error:String(error?.message||error)}));}
  }
}
