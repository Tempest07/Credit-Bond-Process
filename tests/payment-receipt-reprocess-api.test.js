import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensureAuthSchema} from '../functions/api/_auth.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch,insertPaymentReceiptFile,insertPaymentReceipt,insertPaymentReceiptMatch} from '../functions/api/_payment-receipts.js';
import {onRequestPost} from '../functions/api/payment-receipt-files/[id]/reprocess.js';
import {processPaymentReceiptFile,reconcileStalePaymentReceiptJobs} from '../payment-receipt-worker.js';

const NOW='2026-10-28T07:00:00.000Z';
const ORIGIN='http://127.0.0.1:8788';

async function fixture(t){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare=DB.prepare;
  const wrap=(query,statement)=>({...statement,query,bind(...values){return wrap(query,statement.bind(...values));},async all(){return statement.execute();}});
  DB.prepare=query=>wrap(query,prepare(query));
  const batch=DB.batch.bind(DB);let beforeClaim=null;
  DB.batch=async statements=>{
    if(beforeClaim&&statements.some(statement=>/file_reprocess_requested/.test(statement.query))){const hook=beforeClaim;beforeClaim=null;await hook();}
    return batch(statements);
  };
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  for(const id of ['batch','other-batch'])await insertPaymentReceiptBatch(DB,{id,ownerUserId:'admin',messageId:id,receivedAt:NOW,receivedDate:'2026-10-28',rawObjectKey:id+'.eml',processingStatus:'processed',createdAt:NOW});
  for(const [id,batchId] of [['file','batch'],['other-file','other-batch']])await insertPaymentReceiptFile(DB,{id,batchId,filename:id+'.pdf',mimeType:'application/pdf',byteSize:1,sha256:id+'-source-sha',objectKey:id+'.pdf',pageCount:4,processingStatus:'processed',createdAt:NOW});
  for(const [index,id] of ['manual','auto','duplicate','unmatched','other'].entries())await insertPaymentReceipt(DB,{
    id,ownerUserId:'admin',batchId:id==='other'?'other-batch':'batch',fileId:id==='other'?'other-file':'file',sourcePages:[index+1],sourcePageLabel:String(index+1),
    objectKey:id+'.pdf',sha256:id+'-sha',paymentDate:'2026-10-29',amountFen:123456789,bondShortName:'26测试MTN001',securityCode:'102699001',
    recognizedText:'原始识别文字',recognitionStatus:'recognized',matchStatus:id==='duplicate'?'duplicate':'review',candidates:[{projectId:'candidate'}],createdAt:NOW,
  });
  for(const [id,source] of [['manual','manual'],['auto','auto'],['other','manual']])await insertPaymentReceiptMatch(DB,{id:'match-'+id,ownerUserId:'admin',receiptId:id,projectId:'project-'+id,trancheId:'tranche-'+id,matchSource:source,matchScore:100,matchReason:'原对应',createdAt:NOW});
  DB.sql.prepare(`INSERT INTO payment_receipt_events(id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at) VALUES ('manual-name','admin','manual','batch','identity_name_manually_corrected','{"name":"26人工名称MTN001"}',?)`).run(NOW);
  const request=(options={})=>onRequestPost({env:{DB},params:{id:options.id||'file'},request:new Request((options.originURL||ORIGIN)+'/api/payment-receipt-files/'+(options.id||'file')+'/reprocess',{
    method:'POST',headers:{Origin:ORIGIN,...options.headers},
  })});
  const rows=table=>DB.sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row=>({...row}));
  return{DB,request,rows,beforeClaim:hook=>{beforeClaim=hook;},audit(){const row=DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE event_type='file_reprocess_requested'").get();return row?JSON.parse(row.detail_json):null;}};
}

test('a full-file retry releases all old correspondences atomically and preserves source data and other files',async t=>{
  const h=await fixture(t),before=h.rows('payment_receipts'),otherFile=h.rows('payment_receipt_files').find(row=>row.id==='other-file'),oldName=h.rows('payment_receipt_events')[0];
  const response=await h.request();assert.equal(response.status,202);const payload=await response.json();
  assert.equal(payload.correspondenceReset,true);assert.equal(payload.processingStatus,'reprocess_requested');assert.equal(payload.fileId,'file');
  const after=h.rows('payment_receipts');assert.equal(after.length,before.length);
  for(const old of before){const current=after.find(row=>row.id===old.id);if(old.id==='other'){assert.deepEqual(current,old);continue;}
    assert.equal(current.match_status,'review');assert.deepEqual(JSON.parse(current.candidate_json),[]);
    for(const field of ['id','owner_user_id','batch_id','file_id','object_key','source_pages_json','source_page_label','sha256','payment_date','amount_fen','bond_short_name','security_code','recognized_text'])assert.equal(current[field],old[field],field);
  }
  assert.deepEqual(h.rows('payment_receipt_matches').map(row=>row.receipt_id),['other']);
  assert.deepEqual(h.rows('payment_receipt_files').find(row=>row.id==='other-file'),otherFile);
  assert.deepEqual(h.rows('payment_receipt_events').find(row=>row.id===oldName.id),oldName);
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='file'").get().processing_status,'reprocess_requested');
  const audit=h.audit();assert.equal(audit.fileId,'file');
  assert.deepEqual([...audit.releasedMatches].sort((a,b)=>a.receiptId.localeCompare(b.receiptId)),[
    {receiptId:'auto',projectId:'project-auto',trancheId:'tranche-auto',matchSource:'auto'},
    {receiptId:'manual',projectId:'project-manual',trancheId:'tranche-manual',matchSource:'manual'},
  ]);
});

test('active file or batch processing refuses a retry without clearing any correspondence',async t=>{
  for(const table of ['payment_receipt_files','payment_receipt_batches'])for(const status of ['received','queued','processing','regrouping','reprocess_requested']){
    const h=await fixture(t);h.DB.sql.prepare(`UPDATE ${table} SET processing_status=? WHERE id=?`).run(status,table==='payment_receipt_files'?'file':'batch');
    const matches=h.rows('payment_receipt_matches'),receipts=h.rows('payment_receipts');
    assert.equal((await h.request()).status,409,table+'/'+status);assert.deepEqual(h.rows('payment_receipt_matches'),matches);assert.deepEqual(h.rows('payment_receipts'),receipts);assert.equal(h.audit(),null);
  }
});

test('other owners, unauthenticated callers and cross-origin requests cannot release matches',async t=>{
  const h=await fixture(t),matches=h.rows('payment_receipt_matches');
  assert.equal((await h.request({id:'missing'})).status,404);
  assert.equal((await h.request({originURL:'https://example.com'})).status,401);
  assert.equal((await h.request({headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await h.request({headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  h.DB.sql.prepare("UPDATE payment_receipt_batches SET owner_user_id='someone-else' WHERE id='batch'").run();
  assert.equal((await h.request()).status,404);assert.deepEqual(h.rows('payment_receipt_matches'),matches);assert.equal(h.audit(),null);
});

test('a file-version race at the transactional claim rolls back before any correspondence is released',async t=>{
  const h=await fixture(t),matches=h.rows('payment_receipt_matches'),receipts=h.rows('payment_receipts');
  h.beforeClaim(()=>h.DB.sql.prepare("UPDATE payment_receipt_files SET updated_at='newer-version' WHERE id='file'").run());
  assert.equal((await h.request()).status,409);assert.deepEqual(h.rows('payment_receipt_matches'),matches);assert.deepEqual(h.rows('payment_receipts'),receipts);assert.equal(h.audit(),null);
  assert.equal(h.DB.sql.prepare("SELECT updated_at FROM payment_receipt_files WHERE id='file'").get().updated_at,'newer-version');
});

test('audit snapshots the latest manual correspondence at the same transaction that releases it',async t=>{
  const h=await fixture(t);
  h.beforeClaim(async()=>insertPaymentReceiptMatch(h.DB,{id:'last-moment-match',ownerUserId:'admin',receiptId:'unmatched',projectId:'latest-project',trancheId:'latest-tranche',matchSource:'manual',matchScore:100,createdAt:NOW}));
  assert.equal((await h.request()).status,202);
  assert.equal(h.audit().releasedMatches.length,3);
  assert.deepEqual(h.audit().releasedMatches.find(row=>row.receiptId==='unmatched'),{receiptId:'unmatched',projectId:'latest-project',trancheId:'latest-tranche',matchSource:'manual'});
  assert.deepEqual(h.rows('payment_receipt_matches').map(row=>row.receipt_id),['other']);
});

test('a failure late in the transaction restores matches, receipt status, file status and audit together',async t=>{
  const h=await fixture(t);const before=Object.fromEntries(['payment_receipt_files','payment_receipt_batches','payment_receipts','payment_receipt_matches','payment_receipt_events'].map(table=>[table,h.rows(table)]));
  h.DB.setFail('UPDATE payment_receipt_batches');assert.equal((await h.request()).status,500);h.DB.setFail('');
  for(const [table,rows] of Object.entries(before))assert.deepEqual(h.rows(table),rows,table);
});

test('a duplicate retry cannot clear or audit the same file twice',async t=>{
  const h=await fixture(t);assert.equal((await h.request()).status,202);const first=h.audit();
  assert.equal((await h.request()).status,409);assert.deepEqual(h.audit(),first);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='file_reprocess_requested'").get().n,1);
});

test('the real retry queue and file processor replace released manual matches with new automatic matches and remove obsolete groups',async t=>{
  const h=await fixture(t),DB=h.DB;
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const receiptId=async pages=>'receipt-'+(await hash(new TextEncoder().encode('file:'+pages.join(',')))).slice(0,32);
  const one=await receiptId([1]),obsolete=await receiptId([2,3]);
  DB.sql.exec("DELETE FROM payment_receipt_matches WHERE receipt_id IN (SELECT id FROM payment_receipts WHERE file_id='file'); DELETE FROM payment_receipts WHERE file_id='file'");
  for(const [id,pages,index] of [[one,[1],1],[obsolete,[2,3],2]]){
    await insertPaymentReceipt(DB,{id,ownerUserId:'admin',batchId:'batch',fileId:'file',sourcePages:pages,sourcePageLabel:pages.join('-'),objectKey:'receipts/'+id+'.pdf',sha256:id+'-old',bondShortName:'26旧错误MTN009',securityCode:'102699999',recognitionStatus:'recognized',matchStatus:'review',createdAt:NOW});
    await insertPaymentReceiptMatch(DB,{id:'old-'+index,ownerUserId:'admin',receiptId:id,projectId:'old-wrong-project-'+index,trancheId:'old-wrong-tranche-'+index,matchSource:'manual',createdAt:NOW});
  }
  const projects=[1,2,3].map(index=>({id:'new-project-'+index,shortName:`26重识别MTN00${index}`,tranches:[{id:'new-tranche-'+index,shortName:`26重识别MTN00${index}`,securityCode:'10269900'+index,paymentDate:'2026-10-29',winningAmountWan:1000}]}));
  DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({projects,issuers:[]}));
  const pdf=await PDFDocument.create();
  for(let index=0;index<3;index++){
    const page=pdf.addPage([100,100]),image=pdf.context.stream(new Uint8Array([255,216,255,217]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'});
    page.node.newXObject('Scan',pdf.context.register(image));
  }
  const bytes=await pdf.save({useObjectStreams:false});
  DB.sql.prepare("UPDATE payment_receipt_files SET sha256=?,byte_size=?,page_count=3 WHERE id='file'").run(await hash(bytes),bytes.length);
  const objects=new Map([['file.pdf',bytes],['receipts/'+one+'.pdf',new Uint8Array([1])],['receipts/'+obsolete+'.pdf',new Uint8Array([2])]]),deleted=[],jobs=[];let aiCalls=0;
  const env={DB,AI_PROCESSING_APPROVED:'true',RECEIPT_QUEUE:{async send(job){jobs.push(job);}},PAYMENT_RECEIPTS:{
    async get(key){const value=objects.get(key);return value?{arrayBuffer:async()=>value}:null;},async put(key,value){objects.set(key,value);},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){deleted.push(key);objects.delete(key);}},
  },AI:{async run(){const page=Math.floor(aiCalls++/2)+1;return{response:aiCalls%2?{
    classification:'receipt_start',confidence:.99,document_title:'配售确认及缴款通知书',bond_short_name:`26重识别MTN00${page}`,security_code:'10269900'+page,payment_date:'2026-10-29',amount_text:'1000万元',payer_name:'资金中心',
  }:{nameField:`26重识别MTN00${page}`,remittanceName:`26重识别MTN00${page}`,securityCode:'10269900'+page,uncertainties:[]}};}}};
  assert.equal((await h.request()).status,202);
  assert.deepEqual(h.rows('payment_receipt_matches').map(row=>row.receipt_id),['other']);
  const queued=await reconcileStalePaymentReceiptJobs(env);assert.equal(queued.fileJobs,1);assert.equal(jobs.length,1);assert.equal(jobs[0].forceReanalyze,true);
  const result=await processPaymentReceiptFile(env,jobs[0]);assert.equal(result.receiptIds.length,3);assert.equal(aiCalls,6);
  const newMatches=h.rows('payment_receipt_matches').filter(row=>row.receipt_id!=='other');assert.equal(newMatches.length,3);
  for(let index=1;index<=3;index++){
    const match=newMatches.find(row=>row.receipt_id===result.receiptIds[index-1]);assert.equal(match.project_id,'new-project-'+index);assert.equal(match.tranche_id,'new-tranche-'+index);assert.equal(match.match_source,'auto');
  }
  assert.ok(result.receiptIds.includes(one),'same-page receipt is refreshed and rematched rather than retaining its old manual association');
  assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipts WHERE id=?').get(obsolete).n,0);assert.ok(deleted.includes('receipts/'+obsolete+'.pdf'));
  assert.ok(objects.has('file.pdf'),'original PDF is retained');assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipts WHERE file_id='file'").get().n,3);
  assert.ok(!h.rows('payment_receipt_matches').some(row=>row.project_id.startsWith('old-wrong')));
});
