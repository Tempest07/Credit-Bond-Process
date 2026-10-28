import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensureAuthSchema} from '../functions/api/_auth.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch,insertPaymentReceiptFile,insertPaymentReceipt,insertPaymentReceiptMatch,findPaymentReceiptBySha} from '../functions/api/_payment-receipts.js';
import {requestPaymentReceiptRebuild,readPaymentReceiptRebuild} from '../functions/api/_payment-receipt-rebuild.js';
import {onRequestGet,onRequestPost} from '../functions/api/payment-receipt-rebuild.js';
import {paymentReceiptPrimaryIsClear,reusablePaymentReceiptPageCheckpoint,analyzePaymentReceiptPage,processPaymentReceiptFile,processPaymentReceiptQueueJob} from '../payment-receipt-worker.js';
import {finalizePaymentReceiptRebuild} from '../payment-receipt-rebuild-finalize.js';
import {PDFDocument} from 'pdf-lib';

const NOW='2026-10-28T07:00:00.000Z';
async function fixture(t){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare=DB.prepare;const wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});
  DB.prepare=query=>wrap(prepare(query));
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  for(const [id,owner] of [['batch','admin'],['foreign','other']])await insertPaymentReceiptBatch(DB,{id,ownerUserId:owner,messageId:id,receivedAt:NOW,receivedDate:'2026-10-28',rawObjectKey:id+'.eml',processingStatus:'processed',createdAt:NOW});
  for(const [id,batchId,status] of [['a','batch','processed'],['b','batch','review'],['busy','batch','processing'],['foreign','foreign','processed']]){
    await insertPaymentReceiptFile(DB,{id,batchId,filename:id+'.pdf',mimeType:'application/pdf',byteSize:10,sha256:id,objectKey:id+'.pdf',pageCount:2,processingStatus:status,createdAt:NOW});
    const owner=batchId==='foreign'?'other':'admin';
    await insertPaymentReceipt(DB,{id:'r-'+id,ownerUserId:owner,batchId,fileId:id,sourcePages:[1],sourcePageLabel:'1',objectKey:'r-'+id+'.pdf',sha256:'r-'+id,recognitionStatus:'recognized',matchStatus:'review',bondShortName:'26原件MTN001',createdAt:NOW});
    await insertPaymentReceiptMatch(DB,{id:'m-'+id,ownerUserId:owner,receiptId:'r-'+id,projectId:'p-'+id,trancheId:'t-'+id,matchSource:'manual',createdAt:NOW});
  }
  const jobs=[];return{DB,jobs,env:{DB,RECEIPT_QUEUE:{async send(job){jobs.push(job);}}}};
}

test('whole-library rebuild atomically records and resets own ready files then queues them immediately',async t=>{
  const h=await fixture(t);const result=await requestPaymentReceiptRebuild(h.env,'admin',{all:true});
  assert.equal(result.rebuild.totalFiles,2);assert.equal(result.rebuild.skippedFiles,1);assert.equal(result.rebuild.status,'processing');
  assert.equal(h.jobs.length,2);assert.ok(h.jobs.every(job=>job.forceReanalyze&&job.rebuildId===result.rebuild.id));
  assert.deepEqual(h.DB.sql.prepare('SELECT receipt_id FROM payment_receipt_matches ORDER BY receipt_id').all().map(row=>row.receipt_id),['r-busy','r-foreign']);
  const events=h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE event_type='file_reprocess_requested'").all().map(row=>JSON.parse(row.detail_json));
  assert.equal(events.length,2);assert.ok(events.every(event=>event.releasedMatches.length===1));
  assert.equal(h.DB.sql.prepare("SELECT bond_short_name FROM payment_receipts WHERE id='r-a'").get().bond_short_name,'26原件MTN001');
  assert.equal(h.DB.sql.prepare("SELECT object_key FROM payment_receipt_files WHERE id='a'").get().object_key,'a.pdf');
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='busy'").get().processing_status,'processing');
});

test('an active request is resumed rather than clearing matches or queueing twice',async t=>{
  const h=await fixture(t),first=await requestPaymentReceiptRebuild(h.env,'admin',{all:true});
  const second=await requestPaymentReceiptRebuild(h.env,'admin',{all:true});
  assert.equal(second.reused,true);assert.equal(second.rebuild.id,first.rebuild.id);assert.equal(h.jobs.length,2);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='library_rebuild_requested'").get().n,1);
});

test('progress survives reload and reports per-page work and final archive counts',async t=>{
  const h=await fixture(t),first=await requestPaymentReceiptRebuild(h.env,'admin',{fileIds:['a','b']});
  const progress={rebuildId:first.rebuild.id,stage:'reading',totalPages:2,completedPages:1};
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processing',grouping_json=? WHERE id='a'").run(JSON.stringify({processing:progress}));
  let current=await readPaymentReceiptRebuild(h.DB,'admin');assert.equal(current.completedPages,1);assert.equal(current.processingFiles,1);assert.equal(current.queuedFiles,1);
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed',error_message='',grouping_json=? WHERE id IN ('a','b')").run(JSON.stringify({processing:{...progress,stage:'complete',completedPages:2}}));
  h.DB.sql.prepare("UPDATE payment_receipts SET match_status='unmatched' WHERE file_id IN ('a','b')").run();
  current=await readPaymentReceiptRebuild(h.DB,'admin',first.rebuild.id);
  assert.equal(current.status,'completed');assert.equal(current.completedFiles,2);assert.equal(current.completedPages,4);assert.equal(current.archivedCount,2);
  assert.equal(await readPaymentReceiptRebuild(h.DB,'other',first.rebuild.id),null);
});

test('one late transaction failure rolls back library claim, receipt resets and mappings together',async t=>{
  const h=await fixture(t);h.DB.setFail('UPDATE payment_receipt_batches');
  await assert.rejects(requestPaymentReceiptRebuild(h.env,'admin',{all:true}),/private-database-failure/);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_matches').get().n,4);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,0);
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='a'").get().processing_status,'processed');
  assert.equal(h.jobs.length,0);
});

test('queue send failure leaves persisted reprocess requests for the scheduled retry',async t=>{
  const h=await fixture(t);h.env.RECEIPT_QUEUE.send=async()=>{throw Error('queue unavailable');};
  const result=await requestPaymentReceiptRebuild(h.env,'admin',{all:true});assert.equal(result.rebuild.queuedFiles,2);
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='a'").get().processing_status,'reprocess_requested');
});

test('HTTP endpoint validates origin, ownership and bounded request shape',async t=>{
  const h=await fixture(t);const post=(body,origin='http://127.0.0.1:8788')=>onRequestPost({env:h.env,request:new Request('http://127.0.0.1:8788/api/payment-receipt-rebuild',{method:'POST',headers:{Origin:origin},body:JSON.stringify(body)})});
  assert.equal((await post({all:true},'https://evil.example')).status,403);
  assert.equal((await post({fileIds:['foreign']})).status,404);
  assert.equal((await post({})).status,400);assert.equal((await post({fileIds:Array.from({length:501},(_,i)=>String(i))})).status,400);
  const response=await onRequestGet({env:h.env,request:new Request('https://example.com/api/payment-receipt-rebuild')});assert.equal(response.status,401);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,0);
});

test('partial page checkpoints require the same source, contiguous successful pages and in-flight stage',()=>{
  const pages=[{pageNumber:1,analysisVersion:7,classification:'receipt_start'}];
  const progress={stage:'reading',sourceSha256:'source',completedPages:1};
  assert.deepEqual(reusablePaymentReceiptPageCheckpoint(pages,progress,'source',3),pages);
  assert.equal(reusablePaymentReceiptPageCheckpoint(pages,progress,'changed-source',3),null);
  assert.equal(reusablePaymentReceiptPageCheckpoint(pages,{...progress,stage:'queued'},'source',3),null);
  assert.equal(reusablePaymentReceiptPageCheckpoint([{...pages[0],pageNumber:2}],progress,'source',3),null);
  assert.equal(reusablePaymentReceiptPageCheckpoint(pages,{...progress,completedPages:2},'source',3),null);
});

test('clear current-page DeepSeek readings avoid a second request while conflicts still get reviewed',()=>{
  const fields={classification:'receipt_start',confidence:.99,document_title:'配售确认及缴款通知书',bond_short_name:'26苏交通CP008',security_code:'042680338'};
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',fields),true);
  assert.equal(paymentReceiptPrimaryIsClear('legacy',fields),false);
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',{...fields,confidence:.96}),true);
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',{...fields,confidence:.9}),true);
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',{...fields,confidence:.89}),false);
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',{...fields,confidence:.96,remittance_name:'26苏交通CP008'}),true);
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',{...fields,remittance_name:'26苏交CP008'}),false);
  assert.equal(paymentReceiptPrimaryIsClear('deepseek',fields,{bondShortName:'26苏交通CP008',securityCode:'042680339'}),false);
});

test('a verified first-page notice is usable even if the initial boundary classifier was uncertain',async()=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage([100,100]);
  const image=pdf.context.stream(new Uint8Array([255,216,255,217]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'});page.node.newXObject('Scan',pdf.context.register(image));
  let calls=0;const result=await analyzePaymentReceiptPage({AI:{async run(){calls++;return{response:calls===1?{classification:'uncertain',confidence:.96,document_title:'配售确认及缴款通知书',bond_short_name:'26苏交CP008',security_code:'042680338'}:{nameField:'26苏交通CP008',remittanceName:'26苏交通CP008',securityCode:'042680338',uncertainties:[]}};}}},await pdf.save({useObjectStreams:false}),1);
  assert.equal(result.classification,'receipt_start');assert.equal(result.fields.bondShortName,'26苏交通CP008');
});

test('one clear DeepSeek call extracts name, coupon and awarded amount from the current page',async t=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage([100,100]);
  const image=pdf.context.stream(new Uint8Array([0xff,0xd8,0xff,0xc0,0,17,8,0,2,0,2,3,1,17,0,2,17,0,3,17,0,0xff,0xd9]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'});page.node.newXObject('Image',pdf.context.register(image));
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({classification:'receipt_start',confidence:.96,document_title:'配售确认及缴款通知书',bond_short_name:'26苏交通CP008',security_code:'042680338',payment_date:'2026-10-15',amount_text:'42000万元',coupon_rate:'1.39%',allotted_amount_text:'42000万元'})}}]});});
  const result=await analyzePaymentReceiptPage({OCR_AI_PROVIDER:'deepseek',DEEPSEEK_OCR_API_KEY:'ocr-only-test-key-123456789'},await pdf.save({useObjectStreams:false}),1);
  assert.equal(calls,1);assert.equal(result.fields.bondShortName,'26苏交通CP008');assert.equal(result.fields.couponRate,'1.39%');
  assert.equal(result.classification,'receipt_start');assert.match(result.recognizedText,/票面利率 1.39%/);assert.match(result.recognizedText,/获配量 42000万元/);
});

test('a real interrupted full-file processor resumes after its saved page instead of paying for page one again',async t=>{
  const h=await fixture(t),pdf=await PDFDocument.create();
  for(let i=0;i<2;i++){
    const page=pdf.addPage([100,100]),image=pdf.context.stream(new Uint8Array([255,216,255,217]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,ColorSpace:'DeviceRGB',BitsPerComponent:8,Filter:'DCTDecode'});
    page.node.newXObject('Scan',pdf.context.register(image));
  }
  const bytes=await pdf.save({useObjectStreams:false}),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  h.DB.sql.prepare("UPDATE payment_receipt_files SET sha256=?,byte_size=? WHERE id='a'").run(sha,bytes.length);
  const result=await requestPaymentReceiptRebuild(h.env,'admin',{fileIds:['a']});
  const firstPage={pageNumber:1,analysisVersion:7,classification:'receipt_start',confidence:.99,recognizedText:'标题 配售确认及缴款通知书\n债券简称 26测试MTN001\n债券代码 102699001\n缴款日期 2026-10-29\n缴款金额 1000万元',fields:{bondShortName:'26测试MTN001',securityCode:'102699001',paymentDate:'2026-10-29',amountText:'1000万元'}};
  h.DB.sql.prepare("UPDATE payment_receipt_files SET page_analysis_json=?,grouping_json=? WHERE id='a'").run(JSON.stringify([firstPage]),JSON.stringify({processing:{rebuildId:result.rebuild.id,requestedAt:NOW,sourceSha256:sha,stage:'reading',completedPages:1,totalPages:2}}));
  const objects=new Map([['a.pdf',bytes]]);let calls=0;
  const env={...h.env,AI_PROCESSING_APPROVED:'true',PAYMENT_RECEIPTS:{async get(key){const bytes=objects.get(key);return bytes?{arrayBuffer:async()=>bytes}:null;},async put(key,bytes){objects.set(key,bytes);},async delete(key){objects.delete(key);}},AI:{async run(){calls++;return{response:calls===1?{classification:'receipt_start',confidence:.99,document_title:'配售确认及缴款通知书',bond_short_name:'26测试MTN002',security_code:'102699002',payment_date:'2026-10-29',amount_text:'1000万元'}:{nameField:'26测试MTN002',remittanceName:'26测试MTN002',securityCode:'102699002',uncertainties:[]}};}}};
  const rebuilt=await processPaymentReceiptFile(env,h.jobs[0]);assert.equal(rebuilt.receiptIds.length,2);assert.equal(calls,2);
  const file=h.DB.sql.prepare("SELECT grouping_json,page_analysis_json FROM payment_receipt_files WHERE id='a'").get();
  assert.equal(JSON.parse(file.grouping_json).processing.stage,'complete');assert.equal(JSON.parse(file.page_analysis_json).length,2);
  assert.equal((await readPaymentReceiptRebuild(h.DB,'admin')).status,'completed');assert.ok(objects.has('a.pdf'));
  assert.equal((await processPaymentReceiptFile(env,h.jobs[0])).status,'already_handled');assert.equal(calls,2);
});

test('trusted queue rebuild requests remain idempotent even after the first run completed',async t=>{
  const h=await fixture(t),job={kind:'library-rebuild',ownerUserId:'admin',requestId:crypto.randomUUID()};
  const env={...h.env,PAYMENT_RECEIPTS:{},AI_PROCESSING_APPROVED:'true',AI:{async run(){throw Error('must not infer in rebuild dispatcher');}}};
  const first=await processPaymentReceiptQueueJob(env,job);assert.equal(first.rebuild.id,job.requestId);assert.equal(h.jobs.length,2);
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed',error_message='' WHERE id IN ('a','b')").run();
  const second=await processPaymentReceiptQueueJob(env,job);assert.equal(second.reused,true);assert.equal(second.rebuild.id,first.rebuild.id);assert.equal(h.jobs.length,2);
  await assert.rejects(processPaymentReceiptQueueJob(env,{...job,ownerUserId:'other'}),/参数无效/);
  await assert.rejects(processPaymentReceiptQueueJob(env,{...job,requestId:''}),/参数无效/);
});

test('a forwarded request ID cannot restart an existing run after its original job finishes',async t=>{
  const h=await fixture(t),first=await requestPaymentReceiptRebuild(h.env,'admin',{all:true}),requestId=crypto.randomUUID();
  const forwarded=await requestPaymentReceiptRebuild(h.env,'admin',{all:true},{requestId});assert.equal(forwarded.rebuild.id,first.rebuild.id);
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed',error_message='' WHERE id IN ('a','b')").run();
  const again=await requestPaymentReceiptRebuild(h.env,'admin',{all:true},{requestId});assert.equal(again.rebuild.id,first.rebuild.id);assert.equal(h.jobs.length,2);
});

test('a slow queue producer does not delay the HTTP 202 acknowledgement',async t=>{
  const h=await fixture(t),pending=[];let release;const held=new Promise(resolve=>{release=resolve;});let sent=false;
  h.env.RECEIPT_QUEUE={async sendBatch(messages){sent=true;assert.equal(messages.length,2);await held;}};
  const response=await onRequestPost({env:h.env,waitUntil(promise){pending.push(promise);},request:new Request('http://127.0.0.1:8788/api/payment-receipt-rebuild',{method:'POST',headers:{Origin:'http://127.0.0.1:8788'},body:JSON.stringify({all:true})})});
  assert.equal(response.status,202);assert.equal(pending.length,1);assert.equal(sent,true);release();await Promise.all(pending);
});

test('duplicate lookups never make an older original point to a later duplicate or a stale unprocessed row',async t=>{
  const h=await fixture(t);h.DB.sql.prepare("UPDATE payment_receipts SET sha256='shared',created_at=CASE id WHEN 'r-a' THEN '2026-10-01' ELSE '2026-10-02' END WHERE id IN ('r-a','r-b')").run();
  assert.equal(await findPaymentReceiptBySha(h.DB,'admin','shared','r-a'),null);
  assert.equal((await findPaymentReceiptBySha(h.DB,'admin','shared','r-b')).id,'r-a');
  h.DB.sql.prepare("UPDATE payment_receipts SET error_message='正在重新识别' WHERE id='r-a'").run();
  assert.equal(await findPaymentReceiptBySha(h.DB,'admin','shared','r-b'),null);
});

test('the final no-AI sweep resolves concurrent duplicate originals and restores one automatic project correspondence',async t=>{
  const h=await fixture(t),run=await requestPaymentReceiptRebuild(h.env,'admin',{fileIds:['a','b']});
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed',error_message='' WHERE id IN ('a','b')").run();
  h.DB.sql.prepare("UPDATE payment_receipts SET sha256='same-fingerprint',payment_date='2026-10-29',amount_fen=1000000000,bond_short_name='26测试MTN001',security_code='102699001',recognition_status='recognized',error_message='',match_status='review',created_at=CASE id WHEN 'r-a' THEN '2026-10-01' ELSE '2026-10-02' END WHERE id IN ('r-a','r-b')").run();
  const projects=[{id:'target-project',shortName:'26测试MTN001',tranches:[{id:'target-tranche',shortName:'26测试MTN001',securityCode:'102699001',paymentDate:'2026-10-29',winningAmountWan:1000}]}];
  h.DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({projects,issuers:[]}));
  // Simulate both parallel files initially treating themselves as originals,
  // with the later copy winning the unique target constraint first.
  await insertPaymentReceiptMatch(h.DB,{id:'parallel-winner',ownerUserId:'admin',receiptId:'r-b',projectId:'target-project',trancheId:'target-tranche',matchSource:'auto',createdAt:NOW});
  const settled=await finalizePaymentReceiptRebuild(h.env,'admin',run.rebuild.id);assert.equal(settled.duplicateCount,1);
  const receipt=h.DB.sql.prepare("SELECT match_status FROM payment_receipts WHERE id='r-b'").get();assert.equal(receipt.match_status,'duplicate');
  const target=h.DB.sql.prepare("SELECT receipt_id FROM payment_receipt_matches WHERE project_id='target-project'").get();assert.equal(target.receipt_id,'r-a');
  assert.equal(await finalizePaymentReceiptRebuild(h.env,'admin',run.rebuild.id),null);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='library_rebuild_completed'").get().n,1);
});

test('duplicate settlement keeps a new manual correspondence and ignores files outside the requested rebuild',async t=>{
  const h=await fixture(t),run=await requestPaymentReceiptRebuild(h.env,'admin',{fileIds:['a','b']});
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed',error_message='' WHERE id IN ('a','b')").run();
  h.DB.sql.prepare("UPDATE payment_receipts SET sha256='same',recognition_status='recognized',error_message='',match_status='review' WHERE id IN ('r-a','r-b')").run();
  await insertPaymentReceiptMatch(h.DB,{id:'new-manual',ownerUserId:'admin',receiptId:'r-b',projectId:'new-manual-project',trancheId:'new-manual-tranche',matchSource:'manual',createdAt:NOW});
  await finalizePaymentReceiptRebuild(h.env,'admin',run.rebuild.id);
  assert.equal(h.DB.sql.prepare("SELECT match_status FROM payment_receipts WHERE id='r-a'").get().match_status,'duplicate');
  assert.equal(h.DB.sql.prepare("SELECT match_source FROM payment_receipt_matches WHERE receipt_id='r-b'").get().match_source,'manual');
  assert.equal(h.DB.sql.prepare("SELECT match_status FROM payment_receipts WHERE id='r-busy'").get().match_status,'matched');
});

test('ambiguous or unidentified pages stay reviewable while clear unrelated notices are simply archived',async t=>{
  const cases=[
    {classification:'uncertain',text:'标题 配售确认及缴款通知书\n债券简称 26他人MTN001\n缴款日期 2026-10-29',fields:{bondShortName:'26他人MTN001',paymentDate:'2026-10-29'},expected:'review'},
    {classification:'receipt_start',text:'标题 配售确认及缴款通知书',fields:{},expected:'review'},
    {classification:'receipt_start',text:'标题 配售确认及缴款通知书\n缴款日期 2026-10-29',fields:{paymentDate:'2026-10-29'},expected:'review'},
    {classification:'receipt_start',text:'标题 配售确认及缴款通知书\n债券简称 26他人MTN001\n缴款日期 2026-10-29',fields:{bondShortName:'26他人MTN001',paymentDate:'2026-10-29'},expected:'unmatched'},
    {classification:'receipt_start',text:'标题 配售确认及缴款通知书\n债券简称 26测试MTN001\n债券代码 102699001',fields:{bondShortName:'26测试MTN001',securityCode:'102699001'},expected:'matched',projects:[{id:'target-project',shortName:'26测试MTN001',tranches:[{id:'target-tranche',shortName:'26测试MTN001',securityCode:'102699001',paymentDate:'2026-10-29',winningAmountWan:1000}]}]},
  ];
  for(const item of cases){
    const h=await fixture(t),pdf=await PDFDocument.create();pdf.addPage([100,100]);
    const bytes=await pdf.save(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    h.DB.sql.prepare("UPDATE payment_receipt_files SET sha256=?,byte_size=?,page_count=1 WHERE id='a'").run(sha,bytes.length);
    await requestPaymentReceiptRebuild(h.env,'admin',{fileIds:['a']});
    h.DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({projects:item.projects||[],issuers:[]}));
    h.DB.sql.prepare("UPDATE payment_receipt_files SET page_analysis_json=?,grouping_json=? WHERE id='a'").run(JSON.stringify([{pageNumber:1,analysisVersion:7,classification:item.classification,confidence:.99,recognizedText:item.text,fields:item.fields}]),JSON.stringify({processing:{requestedAt:NOW,sourceSha256:sha,stage:'matching',completedPages:1,totalPages:1}}));
    const env={...h.env,AI_PROCESSING_APPROVED:'true',AI:{async run(){throw Error('checkpoint must not infer');}},PAYMENT_RECEIPTS:{async get(){return{arrayBuffer:async()=>bytes};},async put(){},async delete(){}}};
    const result=await processPaymentReceiptFile(env,h.jobs[0]);
    const row=h.DB.sql.prepare('SELECT match_status,recognition_status,error_message FROM payment_receipts WHERE id=?').get(result.receiptIds[0]);
    assert.equal(row.match_status,item.expected,item.text);
    assert.equal(row.recognition_status,item.expected==='review'?'review':'recognized',item.text);
    if(item.expected==='review')assert.equal(result.status,'review');
  }
});
