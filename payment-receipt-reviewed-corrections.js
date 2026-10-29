import {readStoredStateRow} from './state-storage.js';
import {paymentReceiptFromRow} from './functions/api/_payment-receipts.js';
import {selectPaymentReceiptMatch} from './payment-receipts.js';
import {paymentReceiptCodeIdentity} from './payment-receipt-security.js';

const UUID=/^[a-f0-9-]{36}$/i,SHA=/^[a-f0-9]{64}$/i,MAX_BYTES=20*1024*1024;
const fail=message=>Object.assign(new Error(message),{nonRetryable:true,retryable:false});
const json=value=>JSON.stringify(value);
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const MATCH_COLUMNS=['id','owner_user_id','receipt_id','project_id','tranche_id','match_source','match_score','match_reason','created_at','updated_at'];
const sameMatch=(left,right)=>left&&right&&MATCH_COLUMNS.every(column=>Object.hasOwn(left,column)&&left[column]===right[column]);

/** Sign the exact reviewed project/tranche; neither is modified by this operation. */
export async function reviewedPaymentReceiptTargetSignature(project,tranche){
  return{projectSha256:await hash(json(project)),trancheSha256:await hash(json(tranche))};
}

/** Internal queue only: apply an already visually verified, source-bound decision. */
export async function applyReviewedPaymentReceiptCorrections(env,job,{fingerprintMaterial}={}){
  if(job?.kind!=='reviewed-receipt-corrections'||!UUID.test(job.requestId||'')||!job.ownerUserId
    ||!Array.isArray(job.corrections)||!job.corrections.length||job.corrections.length>20
    ||new Set(job.corrections.map(item=>item.receiptId)).size!==job.corrections.length)throw fail('复核修正参数无效');
  const owner=String(job.ownerUserId),requestId=job.requestId,payloadHash=await hash(json(job)),appliedId=requestId+':applied',attemptId=requestId+':attempt';
  const prior=await env.DB.prepare('SELECT detail_json FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2').bind(appliedId,owner).first();
  if(prior){const detail=parse(prior.detail_json);if(detail?.payloadSha256!==payloadHash)throw fail('复核请求编号已被其他内容使用');return{status:'applied',reused:true,requestId,correctedCount:detail.correctedCount};}
  const oldAttempt=await env.DB.prepare('SELECT detail_json FROM payment_receipt_events WHERE id=?1').bind(attemptId).first();
  if(oldAttempt&&parse(oldAttempt.detail_json)?.payloadSha256!==payloadHash)throw fail('复核请求编号已被其他内容使用');
  const state=await readStoredStateRow(env.DB,'current',[owner]);
  if(!state)throw fail('未找到项目资料库');
  const projects=Array.isArray(state.data.projects)?state.data.projects:[],plans=[],sources=new Set();
  for(const item of job.corrections){
    const expected=item.expected||{},source=item.source||{},decision=item.decision||{},target=decision.target;
    if(!item.receiptId||!item.fileId||!SHA.test(source.sha256||'')||!Number.isSafeInteger(source.bytes)||source.bytes<1||source.bytes>MAX_BYTES
      ||!SHA.test(expected.recognizedTextSha256||'')||!expected.updatedAt||!Array.isArray(expected.sourcePages)||!expected.sourcePages.length
      ||!['matched','unmatched'].includes(decision.status)||!String(item.evidence||'').trim())throw fail('复核证据不完整');
    const row=await env.DB.prepare(`SELECT r.*,f.sha256 AS file_sha256,f.byte_size AS file_bytes,f.object_key AS file_object_key,
      f.processing_status AS file_status,f.updated_at AS file_updated_at,b.owner_user_id AS file_owner,b.processing_status AS batch_status
      FROM payment_receipts r JOIN payment_receipt_files f ON f.id=r.file_id JOIN payment_receipt_batches b ON b.id=f.batch_id
      WHERE r.id=?1 AND r.owner_user_id=?2`).bind(item.receiptId,owner).first();
    if(!row||row.file_id!==item.fileId||row.file_owner!==owner||row.file_sha256!==source.sha256||row.file_bytes!==source.bytes
      ||!['processed','review'].includes(row.file_status)||!['processed','review'].includes(row.batch_status)
      ||row.match_status!==(item.expectedMatch?'matched':'review')||row.recognition_status!=='recognized'||row.updated_at!==expected.updatedAt
      ||row.bond_short_name!==expected.name||row.security_code!==expected.code||row.payment_date!==expected.date||row.amount_fen!==expected.amountFen
      ||json(parse(row.source_pages_json))!==json(expected.sourcePages)||await hash(row.recognized_text)!==expected.recognizedTextSha256)throw fail('单据或原件已改变，复核修正未执行');
    const previousMatch=await env.DB.prepare('SELECT * FROM payment_receipt_matches WHERE receipt_id=?1').bind(row.id).first();
    if(item.expectedMatch){
      if(item.expectedMatch.match_source!=='auto'||item.expectedMatch.owner_user_id!==owner||item.expectedMatch.receipt_id!==row.id
        ||!sameMatch(item.expectedMatch,previousMatch))throw fail('原自动对应已改变，复核修正未执行');
    }else if(previousMatch)throw fail('单据已有新的项目对应');
    if(!sources.has(row.file_id)){
      const object=await env.PAYMENT_RECEIPTS.get(row.file_object_key);
      if(!object||(object.size!=null&&object.size!==source.bytes))throw fail('原始 PDF 校验失败');
      const bytes=await object.arrayBuffer();
      if(bytes.byteLength!==source.bytes||await hash(bytes)!==source.sha256)throw fail('原始 PDF 校验失败');
      sources.add(row.file_id);
    }
    let code=row.security_code,text=row.recognized_text,fingerprint=row.sha256,replacedTokens=0;
    if(item.securityCode!==undefined){
      const identity=paymentReceiptCodeIdentity(item.securityCode);
      if(!identity||identity.invalid||item.securityCode===code||typeof fingerprintMaterial!=='function')throw fail('证券代码修正无效');
      const escaped=code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      text=text.replace(new RegExp('(^|[^A-Za-z0-9.])('+escaped+')(?=$|[^A-Za-z0-9.])','g'),(_,prefix)=>{replacedTokens++;return prefix+item.securityCode;});
      if(!replacedTokens)throw fail('原识别文字中未找到准确代码');
      code=item.securityCode;
      fingerprint=await hash(fingerprintMaterial({...paymentReceiptFromRow(row),securityCode:code},source.sha256,expected.sourcePages));
    }
    const updatedReceipt={...paymentReceiptFromRow(row),securityCode:code,recognizedText:text};
    if(decision.status==='matched'){
      const project=projects.find(project=>project.id===target?.projectId),tranche=project?.tranches?.find(tranche=>tranche.id===target?.trancheId);
      if(!project||!tranche)throw fail('复核目标项目不存在');
      const signatures=await reviewedPaymentReceiptTargetSignature(project,tranche);
      if(signatures.projectSha256!==target.projectSha256||signatures.trancheSha256!==target.trancheSha256)throw fail('复核目标项目已改变');
      const occupied=await env.DB.prepare('SELECT id FROM payment_receipt_matches WHERE owner_user_id=?1 AND project_id=?2 AND tranche_id=?3').bind(owner,target.projectId,target.trancheId).first();
      if(occupied&&occupied.id!==previousMatch?.id)throw fail('复核目标已有缴款单');
    }else if(target||selectPaymentReceiptMatch(updatedReceipt,projects).status!=='unmatched')throw fail('单据仍有本方项目候选，未归档为外部单据');
    plans.push({item,row,previousMatch,code,text,fingerprint,replacedTokens});
  }
  const now=new Date().toISOString(),audit={payloadSha256:payloadHash,correctedCount:plans.length,
    decisions:plans.map(({item,row,previousMatch,replacedTokens})=>({receiptId:row.id,fileId:row.file_id,source:item.source,pages:item.expected.sourcePages,evidence:item.evidence,
      before:{...paymentReceiptFromRow(row),recognizedText:row.recognized_text},previousMatch,securityCode:item.securityCode||row.security_code,decision:item.decision,replacedTokens}))};
  await env.DB.prepare(`INSERT OR IGNORE INTO payment_receipt_events(id,owner_user_id,event_type,detail_json,created_at)
    VALUES(?1,?2,'receipts_reviewed_correction_attempt',?3,?4)`).bind(attemptId,owner,json(audit),now).run();
  const recordedAttempt=await env.DB.prepare('SELECT owner_user_id,detail_json FROM payment_receipt_events WHERE id=?1').bind(attemptId).first();
  if(recordedAttempt?.owner_user_id!==owner||parse(recordedAttempt.detail_json)?.payloadSha256!==payloadHash)throw fail('复核请求编号已被其他内容使用');
  const snapshots=json(plans.map(({row,item,previousMatch})=>({...row,expectedMatch:previousMatch,targetProjectId:item.decision.target?.projectId||'',targetTrancheId:item.decision.target?.trancheId||''})));
  const columns=['batch_id','source_pages_json','source_page_label','object_key','mime_type','sha256','payment_date','amount_fen','payer_name','payee_name','bond_short_name','security_code','prepayment_number','bank_reference','recognized_text','recognition_status','match_status','candidate_json','error_message','created_at'];
  const guard=`EXISTS(SELECT 1 FROM user_app_state WHERE user_id=?1 AND revision=?2 AND data=?3)
    AND (SELECT COUNT(*) FROM json_each(?4) snapshot JOIN payment_receipts r ON r.id=json_extract(snapshot.value,'$.id')
      JOIN payment_receipt_files f ON f.id=r.file_id JOIN payment_receipt_batches b ON b.id=f.batch_id
      WHERE r.owner_user_id=?1 AND r.file_id=json_extract(snapshot.value,'$.file_id') AND r.updated_at=json_extract(snapshot.value,'$.updated_at')
      AND ${columns.map(column=>`r.${column} IS json_extract(snapshot.value,'$.${column}')`).join(' AND ')}
      AND f.sha256=json_extract(snapshot.value,'$.file_sha256') AND f.byte_size=json_extract(snapshot.value,'$.file_bytes')
      AND f.object_key=json_extract(snapshot.value,'$.file_object_key') AND f.updated_at=json_extract(snapshot.value,'$.file_updated_at')
      AND f.processing_status IN ('processed','review') AND b.owner_user_id=?1 AND b.processing_status IN ('processed','review')
      AND ((json_extract(snapshot.value,'$.expectedMatch.id') IS NULL AND NOT EXISTS(SELECT 1 FROM payment_receipt_matches WHERE receipt_id=r.id))
        OR EXISTS(SELECT 1 FROM payment_receipt_matches old_match WHERE old_match.receipt_id=r.id AND old_match.match_source='auto'
          AND ${MATCH_COLUMNS.map(column=>`old_match.${column} IS json_extract(snapshot.value,'$.expectedMatch.${column}')`).join(' AND ')}))
      AND (json_extract(snapshot.value,'$.targetProjectId')='' OR NOT EXISTS(SELECT 1 FROM payment_receipt_matches
        WHERE owner_user_id=?1 AND project_id=json_extract(snapshot.value,'$.targetProjectId') AND tranche_id=json_extract(snapshot.value,'$.targetTrancheId')
          AND id IS NOT json_extract(snapshot.value,'$.expectedMatch.id'))))=json_array_length(?4)`;
  const values=[owner,state.revision,state.rawData,snapshots,appliedId,json({payloadSha256:payloadHash,correctedCount:plans.length,receiptIds:plans.map(plan=>plan.row.id)}),now];
  // A stale precondition makes owner_user_id NULL, failing its NOT NULL constraint
  // and rolling back the entire D1 batch, including every correspondence.
  const statements=[env.DB.prepare(`INSERT INTO payment_receipt_events(id,owner_user_id,event_type,detail_json,created_at)
    VALUES(?5,(SELECT ?1 WHERE ${guard}),'receipts_reviewed_corrections_applied',?6,?7)`).bind(...values)];
  for(const {item,row,previousMatch,code,text,fingerprint} of plans){
    if(previousMatch)statements.push(env.DB.prepare('DELETE FROM payment_receipt_matches WHERE id=?1 AND owner_user_id=?2').bind(previousMatch.id,owner));
    statements.push(env.DB.prepare(`UPDATE payment_receipts SET security_code=?1,recognized_text=?2,sha256=?3,match_status=?4,candidate_json='[]',error_message='',updated_at=?5 WHERE id=?6 AND owner_user_id=?7`)
      .bind(code,text,fingerprint,item.decision.status,now,row.id,owner));
    if(item.decision.status==='matched')statements.push(env.DB.prepare(`INSERT INTO payment_receipt_matches(id,owner_user_id,receipt_id,project_id,tranche_id,match_source,match_score,match_reason,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,'manual',100,'原始缴款单视觉复核确认',?6,?6)`).bind(requestId+':'+row.id,owner,row.id,item.decision.target.projectId,item.decision.target.trancheId,now));
  }
  try{await env.DB.batch(statements);}catch(error){
    const completed=await env.DB.prepare('SELECT detail_json FROM payment_receipt_events WHERE id=?1 AND owner_user_id=?2').bind(appliedId,owner).first();
    if(completed&&parse(completed.detail_json)?.payloadSha256===payloadHash)return{status:'applied',reused:true,requestId,correctedCount:plans.length};
    if(/constraint/i.test(String(error.message||error)))throw fail('复核期间单据或项目已改变，事务已回滚');
    throw error;
  }
  return{status:'applied',reused:false,requestId,correctedCount:plans.length};
}
