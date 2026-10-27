import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensureAuthSchema} from '../functions/api/_auth.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch,insertPaymentReceiptFile,insertPaymentReceipt,insertPaymentReceiptMatch,getPaymentReceipt} from '../functions/api/_payment-receipts.js';
import {onRequestPost} from '../functions/api/payment-receipts/[id]/identity-review.js';
import {onRequestPost as undo} from '../functions/api/payment-receipt-files/[id]/identity-review-undo.js';

const NOW='2026-10-28T00:00:00.000Z',OP='file-review-operation-1';
async function fixture(t){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());
  const prepare=DB.prepare,wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});
  DB.prepare=sql=>wrap(prepare(sql));
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB,{id:'batch',ownerUserId:'admin',messageId:'message',receivedAt:NOW,receivedDate:'2026-10-28',rawObjectKey:'email.eml',processingStatus:'processed',createdAt:NOW});
  await insertPaymentReceiptFile(DB,{id:'file',batchId:'batch',filename:'original.pdf',mimeType:'application/pdf',byteSize:10,sha256:'source-hash',objectKey:'original.pdf',pageCount:3,processingStatus:'processed',createdAt:NOW});
  const codes=['042680338','102683994','012682438'];
  const names=['26苏交通CP008','26闽高速MTN005','26九州通SCP003(支持养老产业)'];
  for(let i=0;i<3;i++){
    const id=`receipt-${i+1}`;
    await insertPaymentReceipt(DB,{id,ownerUserId:'admin',batchId:'batch',fileId:'file',sourcePages:[i+1],sourcePageLabel:String(i+1),
      objectKey:`receipts/${id}.pdf`,sha256:`fingerprint-${i}`,recognitionStatus:'recognized',matchStatus:'review',bondShortName:`旧OCR${i+1}`,securityCode:codes[i],
      recognizedText:'原始OCR保留',amountFen:100000,paymentDate:'2026-10-28',createdAt:NOW});
    const proposal={status:'verified',name:names[i],code:codes[i],readings:{nameField:names[i],remittanceName:'',securityCode:codes[i],uncertainties:[]},
      pageNumber:i+1,fileId:'file',fileSha256:'source-hash',sourcePages:[i+1],receiptSha256:`fingerprint-${i}`,fileUpdatedAt:NOW,receiptUpdatedAt:NOW,
      originalName:`旧OCR${i+1}`,reviewId:`review-${i+1}`,priorReviewId:'',createdAt:NOW};
    DB.sql.prepare(`INSERT INTO payment_receipt_events(id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at) VALUES(?,?,?,'batch','identity_review_proposed',?,?)`)
      .run(`review-${i+1}`,'admin',id,JSON.stringify(proposal),NOW);
  }
  await insertPaymentReceiptMatch(DB,{id:'match',ownerUserId:'admin',receiptId:'receipt-1',projectId:'project',trancheId:'tranche',createdAt:NOW});
  const env={DB,PAYMENT_RECEIPTS:{async get(){throw Error('no PDF or AI call is needed for adoption/undo');}}};
  const invoke=(id,body,headers={})=>onRequestPost({env,params:{id},request:new Request('http://127.0.0.1/api/payment-receipts/'+id+'/identity-review',{
    method:'POST',headers:{Origin:'http://127.0.0.1',...headers},body:JSON.stringify(body)})});
  const revoke=(op=OP,file='file',headers={})=>undo({env,params:{id:file},request:new Request('http://127.0.0.1/api/payment-receipt-files/'+file+'/identity-review-undo',{
    method:'POST',headers:{Origin:'http://127.0.0.1',...headers},body:JSON.stringify({fileReviewId:op})})});
  const apply=(n=1,op=OP)=>invoke(`receipt-${n}`,{action:'apply',reviewId:`review-${n}`,fileReviewId:op});
  const state=()=>({receipts:DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all(),matches:DB.sql.prepare('SELECT * FROM payment_receipt_matches').all(),files:DB.sql.prepare('SELECT * FROM payment_receipt_files').all()});
  return{DB,env,invoke,revoke,apply,state,names};
}

test('clear file-reviewed names apply directly and one undo restores raw without changing OCR, amounts or matches',async t=>{
  const h=await fixture(t),before=h.state();
  for(const n of [1,2]){const response=await h.apply(n);assert.equal(response.status,200);const value=await response.json();assert.equal(value.changed,true);assert.equal(value.fileReviewId,OP);assert.equal(value.receipt.identityReview.name,h.names[n-1]);}
  assert.deepEqual(h.state(),before);
  const response=await h.revoke();assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.restoredCount,2);assert.equal(value.skippedCount,0);assert.equal(value.receipts.length,2);
  for(const row of value.receipts)assert.equal(row.identityReview,undefined);
  assert.equal((await getPaymentReceipt(h.DB,'admin','receipt-1')).identityReview,undefined);
  assert.deepEqual(h.state(),before);
  const events=h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all();
  const second=await(await h.revoke()).json();assert.equal(second.restoredCount,0);assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all(),events);
});

test('undo restores prior manual evidence and skips a later manual correction',async t=>{
  const h=await fixture(t);
  const manual=await(await h.invoke('receipt-1',{action:'manual',name:'人工确认旧名',expectedUpdatedAt:NOW,expectedFileUpdatedAt:NOW,expectedIdentityReviewId:''})).json();
  const detail=JSON.parse(h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE id='review-1'").get().detail_json);detail.priorReviewId=manual.reviewId;
  h.DB.sql.prepare("UPDATE payment_receipt_events SET detail_json=? WHERE id='review-1'").run(JSON.stringify(detail));
  assert.equal((await h.apply(1)).status,200);assert.equal((await h.apply(2)).status,200);
  const name2=(await getPaymentReceipt(h.DB,'admin','receipt-2')).identityReview;
  assert.equal((await h.invoke('receipt-2',{action:'manual',name:'后来人工新名',expectedUpdatedAt:NOW,expectedFileUpdatedAt:NOW,expectedIdentityReviewId:name2.reviewId})).status,200);
  const value=await(await h.revoke()).json();assert.equal(value.restoredCount,1);assert.equal(value.skippedCount,1);
  const one=value.receipts.find(row=>row.id==='receipt-1'),two=value.receipts.find(row=>row.id==='receipt-2');
  assert.equal(one.identityReview.source,'manual');assert.equal(one.identityReview.name,'人工确认旧名');assert.equal(one.identityReview.readings,undefined);
  assert.equal(two.identityReview.name,'后来人工新名');
});

test('undo after project matching restores only the name and keeps the updated match and receipt state',async t=>{
  const h=await fixture(t);assert.equal((await h.apply()).status,200);
  h.DB.sql.prepare("UPDATE payment_receipt_matches SET project_id='new-project',tranche_id='new-tranche' WHERE id='match'").run();
  h.DB.sql.prepare("UPDATE payment_receipts SET match_status='matched',updated_at='2026-10-28T01:00:00.000Z' WHERE id='receipt-1'").run();
  const afterMatch=h.state();
  const response=await h.revoke();assert.equal(response.status,200);const value=await response.json();
  assert.equal(value.restoredCount,1);assert.equal(value.skippedCount,0);
  assert.equal(value.receipts[0].identityReview,undefined);
  assert.deepEqual(h.state(),afterMatch);
});

test('an undone raw identity does not resurrect its old accepted name after regroup',async t=>{
  const h=await fixture(t);assert.equal((await h.apply()).status,200);assert.equal((await h.revoke()).status,200);
  h.DB.sql.prepare("DELETE FROM payment_receipts WHERE id='receipt-1'").run();
  await insertPaymentReceipt(h.DB,{id:'regrouped-new-id',ownerUserId:'admin',batchId:'batch',fileId:'file',sourcePages:[1],sourcePageLabel:'1',
    objectKey:'receipts/manual/new.pdf',sha256:'new-fingerprint',recognitionStatus:'recognized',matchStatus:'review',
    bondShortName:'旧OCR1',securityCode:'042680338',createdAt:NOW});
  assert.equal((await getPaymentReceipt(h.DB,'admin','regrouped-new-id')).identityReview,undefined);
});

test('undo marker prevents an apply arriving later and duplicate apply/undo creates no duplicate updates',async t=>{
  const h=await fixture(t);assert.equal((await h.revoke()).status,200);assert.equal((await h.apply()).status,409);
  const value=await(await h.apply(1,'another-operation-2')).json();assert.equal(value.changed,true);
  const before=h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all();
  const repeated=await(await h.apply(1,'another-operation-2')).json();assert.equal(repeated.changed,false);
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all(),before);
});

test('undo written while an apply is waiting to INSERT blocks that late update atomically',async t=>{
  const h=await fixture(t),prepare=h.DB.prepare;let paused=false;
  const wrap=(sql,statement,bindings=[])=>({...statement,bind(...values){return wrap(sql,statement.bind(...values),values);},async run(){
    if(!paused&&bindings[1]==='identity_review_accepted'){
      paused=true;assert.equal((await h.revoke()).status,200);
    }
    return statement.run();
  }});
  h.DB.prepare=sql=>wrap(sql,prepare(sql));
  assert.equal((await h.apply()).status,409);assert.equal(paused,true);
  assert.equal((await getPaymentReceipt(h.DB,'admin','receipt-1')).identityReview,undefined);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_review_accepted'").get().n,0);
});

test('a later human edit committed during undo is kept by the restore CAS',async t=>{
  const h=await fixture(t);assert.equal((await h.apply()).status,200);
  const prepare=h.DB.prepare;let paused=false;
  const wrap=(sql,statement,bindings=[])=>({...statement,bind(...values){return wrap(sql,statement.bind(...values),values);},async run(){
    if(!paused&&bindings[1]==='identity_review_restored'){
      paused=true;
      const response=await h.invoke('receipt-1',{action:'manual',name:'撤销时人工修改',expectedUpdatedAt:NOW,expectedFileUpdatedAt:NOW,expectedIdentityReviewId:'review-1'});
      assert.equal(response.status,200);
    }
    return statement.run();
  }});
  h.DB.prepare=sql=>wrap(sql,prepare(sql));
  const value=await(await h.revoke()).json();assert.equal(paused,true);assert.equal(value.restoredCount,0);assert.equal(value.skippedCount,1);
  assert.equal(value.receipts[0].identityReview.name,'撤销时人工修改');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_review_restored'").get().n,0);
});

test('undo only accepts owned files and protects a source change',async t=>{
  const h=await fixture(t);assert.equal((await h.revoke(OP,'not-owned')).status,404);
  assert.equal((await h.revoke(OP,'file',{Origin:'https://evil.example'})).status,403);
  assert.equal((await h.apply()).status,200);h.DB.sql.prepare("UPDATE payment_receipt_files SET sha256='different-original-content',updated_at='new-version'").run();
  const value=await(await h.revoke()).json();assert.equal(value.restoredCount,0);assert.equal(value.skippedCount,1);
  assert.equal((await getPaymentReceipt(h.DB,'admin','receipt-1')).identityReview,undefined);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_review_restored'").get().n,0);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_review_accepted'").get().n,1);
});

test('legacy source-name false conflicts can be reused and adopted from their original clear readings',async t=>{
  const h=await fixture(t);const row=h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE id='review-2'").get();
  const old=JSON.parse(row.detail_json);old.status='conflict';old.reason='source_name_conflict';old.name='';old.code='';
  h.DB.sql.prepare("UPDATE payment_receipt_events SET detail_json=? WHERE id='review-2'").run(JSON.stringify(old));
  const preview=await h.invoke('receipt-2',{action:'preview',reuse:true});assert.equal(preview.status,200);assert.equal((await preview.json()).proposal.name,'26闽高速MTN005');
  const result=await h.apply(2);assert.equal(result.status,200);assert.equal((await result.json()).receipt.identityReview.name,'26闽高速MTN005');
});
