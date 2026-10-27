import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema,insertPaymentReceiptBatch,insertPaymentReceiptFile,insertPaymentReceipt,insertPaymentReceiptMatch } from '../functions/api/_payment-receipts.js';
import { onRequestPost } from '../functions/api/payment-receipt-files/[id]/boundary-review.js';

const NOW='2026-10-27T12:00:00.000Z';
const key='fake-independent-ocr-key-123456789';
const jpeg=new Uint8Array([255,216,255,192,0,11,8,0,10,0,10,1,1,17,0]);
const rows=(pages=[1,2])=>pages.map((pageNumber,index)=>({pageNumber,classification:index?'continuation':'receipt_start',confidence:.99,
  recognizedText:'缴款通知书\n26测试MTN001',textEvidence:'缴款通知书',visualReason:'原页标题和身份连续',uncertainties:[]}));
const reply=pages=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({pages:rows(pages)})}}]});

async function fixture(t,overrides={}){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());
  const prepare=DB.prepare,wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});
  DB.prepare=query=>wrap(prepare(query));
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB,{id:'batch',ownerUserId:'admin',messageId:'message',receivedAt:NOW,receivedDate:'2026-10-27',rawObjectKey:'email.eml',processingStatus:'processed',createdAt:NOW});
  const pdf=await PDFDocument.create();for(let i=0;i<4;i++){const page=pdf.addPage([100,100]);const image=pdf.context.stream(jpeg,{Type:'XObject',Subtype:'Image',Width:10,Height:10,ColorSpace:'DeviceGray',BitsPerComponent:8,Filter:'DCTDecode'});page.node.newXObject('Scan',pdf.context.register(image));}
  const bytes=await pdf.save(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  await insertPaymentReceiptFile(DB,{id:'file',batchId:'batch',filename:'source.pdf',mimeType:'application/pdf',byteSize:bytes.length,sha256:sha,objectKey:'source.pdf',pageCount:4,processingStatus:'processed',createdAt:NOW});
  await insertPaymentReceipt(DB,{id:'receipt',ownerUserId:'admin',batchId:'batch',fileId:'file',sourcePages:[1,2,3,4],sourcePageLabel:'1-4',objectKey:'receipt.pdf',sha256:'derived',recognitionStatus:'recognized',matchStatus:'matched',bondShortName:'26测试MTN001',createdAt:NOW});
  await insertPaymentReceiptMatch(DB,{id:'match',ownerUserId:'admin',receiptId:'receipt',projectId:'project',trancheId:'tranche'});
  const calls=[],r2=[];
  const env={DB,OCR_AI_PROVIDER:'deepseek',DEEPSEEK_OCR_API_KEY:key,DEEPSEEK_API_KEY:'issuance-key-must-not-be-used',AI_PROCESSING_APPROVED:'true',
    PAYMENT_RECEIPTS:{async get(name){r2.push(name);return{size:bytes.length,arrayBuffer:async()=>bytes};},async put(){throw Error('must not write original');},async delete(){throw Error('must not delete original');}},...overrides};
  let fetchImpl=async(url,options)=>{calls.push({url,options});return reply([1,2]);};
  const request=(body={pages:[1,2],expectedUpdatedAt:NOW},options={})=>{
    const request=new Request(options.url||'http://127.0.0.1:8788/api/payment-receipt-files/file/boundary-review',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:8788',...options.headers},body:typeof body==='string'?body:JSON.stringify(body)});
    return onRequestPost({env,params:{id:options.id||'file'},fetchImpl:(...args)=>fetchImpl(...args),request:options.withoutSignal?{url:request.url,headers:request.headers,body:request.body}:request});
  };
  return{DB,env,calls,r2,request,bytes,setFetch(fn){fetchImpl=fn;},state(){return{files:DB.sql.prepare('SELECT * FROM payment_receipt_files').all(),receipts:DB.sql.prepare('SELECT * FROM payment_receipts').all(),matches:DB.sql.prepare('SELECT * FROM payment_receipt_matches').all()};}};
}

test('joint proposal uses the OCR key, original adjacent images, cloud cache and no business mutations',async t=>{
  const h=await fixture(t),before=h.state();
  const first=await h.request();assert.equal(first.status,200);const value=await first.json();assert.equal(value.cached,false);assert.equal(value.proposal.canApply,true);
  assert.deepEqual(value.proposal.pageNumbers,[1,2]);assert.equal(h.calls.length,1);assert.deepEqual(h.r2,['source.pdf']);
  assert.equal(h.calls[0].options.headers.Authorization,'Bearer '+key);assert.ok(!h.calls[0].options.body.includes(h.env.DEEPSEEK_API_KEY));
  assert.equal(JSON.parse(h.calls[0].options.body).messages[0].content.filter(x=>x.type==='image_url').length,2);
  assert.deepEqual(h.state(),before);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,1);
  const cached=await(await h.request()).json();assert.equal(cached.cached,true);assert.equal(h.calls.length,1);assert.deepEqual(h.state(),before);
});
test('legacy Pages request objects without AbortSignal still support a read-only joint proposal',async t=>{
  const h=await fixture(t);assert.equal((await h.request(undefined,{withoutSignal:true})).status,200);assert.equal(h.calls.length,1);
});
test('legacy file records use the same analyzed page count fallback as the existing pages view',async t=>{
  const h=await fixture(t);h.DB.sql.prepare('UPDATE payment_receipt_files SET page_count=NULL,page_analysis_json=?').run(JSON.stringify([1,2,3,4].map(pageNumber=>({pageNumber}))));
  const before=h.state(),response=await h.request();assert.equal(response.status,200);assert.equal((await response.json()).pageCount,4);assert.deepEqual(h.state(),before);
});
test('ownership, source origin, input bounds and stale versions reject before AI',async t=>{
  const h=await fixture(t);
  assert.equal((await h.request({}, {headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await h.request({}, {headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await h.request({}, {url:'https://tempest07.com/api/payment-receipt-files/file/boundary-review'})).status,401);
  assert.equal((await h.request('x'.repeat(4097))).status,413);
  assert.equal((await h.request({pages:[1,2],expectedUpdatedAt:'old'})).status,409);
  for(const pages of [[1],[1,3],[1,1],[3,4,5]])assert.equal((await h.request({pages,expectedUpdatedAt:NOW})).status,400);
  assert.equal((await h.request(undefined,{id:'foreign'})).status,404);
  h.DB.sql.prepare("UPDATE payment_receipt_batches SET owner_user_id='other'").run();assert.equal((await h.request()).status,404);assert.equal(h.calls.length,0);
});
test('OCR-specific missing keys and explicit processing denial fail closed without issuance-key fallback',async t=>{
  for(const change of [{DEEPSEEK_OCR_API_KEY:''},{AI_PROCESSING_APPROVED:'false'}]){const h=await fixture(t,change);assert.equal((await h.request()).status,503);assert.equal(h.calls.length,0);assert.equal(h.r2.length,0);}
});
test('source hash, page count, file size and processing state are verified before recognition',async t=>{
  for(const sql of ["UPDATE payment_receipt_files SET sha256='changed'","UPDATE payment_receipt_files SET page_count=5","UPDATE payment_receipt_files SET byte_size=30000000","UPDATE payment_receipt_files SET processing_status='regrouping'"]){
    const h=await fixture(t);h.DB.sql.exec(sql);const response=await h.request();assert.ok([409,413].includes(response.status),sql);assert.equal(h.calls.length,0);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,0);
  }
});
test('a version race during inference cannot persist or return a proposal',async t=>{
  const h=await fixture(t);h.setFetch(async()=>{h.DB.sql.prepare("UPDATE payment_receipt_files SET updated_at='changed'").run();return reply([1,2]);});
  assert.equal((await h.request()).status,409);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,0);
});
test('parallel identical previews are leased so a second request does not spend model tokens',async t=>{
  const h=await fixture(t);let release,entered;const pending=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);let count=0;
  h.setFetch(async()=>{count++;entered();await pending;return reply([1,2]);});
  const first=h.request();await ready;assert.equal((await h.request()).status,409);release();assert.equal((await first).status,200);assert.equal(count,1);
});
test('invalid page output and upstream failures do not change grouping or retain a stuck lease',async t=>{
  const h=await fixture(t),before=h.state();h.setFetch(async()=>reply([1,1]));assert.equal((await h.request()).status,502);
  assert.deepEqual(h.state(),before);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,0);
  h.setFetch(async()=>new Response('private-provider-error',{status:429}));const response=await h.request();assert.equal(response.status,429);assert.ok(!(await response.text()).includes('private-provider-error'));assert.deepEqual(h.state(),before);
});
