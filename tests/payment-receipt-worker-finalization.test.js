import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensureAuthSchema} from '../functions/api/_auth.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch,insertPaymentReceiptFile} from '../functions/api/_payment-receipts.js';
import worker from '../payment-receipt-worker.js';
import {finalizePendingPaymentReceiptRebuilds} from '../payment-receipt-rebuild-finalize.js';

const NOW='2026-10-28T07:00:00.000Z';
async function fixture(t){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare=DB.prepare,wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});DB.prepare=query=>wrap(prepare(query));
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB,{id:'batch',ownerUserId:'admin',messageId:'batch',receivedAt:NOW,receivedDate:'2026-10-28',rawObjectKey:'batch.eml',processingStatus:'processing',createdAt:NOW});
  const pdf=await PDFDocument.create();pdf.addPage([100,100]);const bytes=await pdf.save(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const rebuildId=crypto.randomUUID(),progress={rebuildId,requestedAt:NOW,sourceSha256:sha,stage:'matching',completedPages:1,totalPages:1};
  const page={pageNumber:1,analysisVersion:7,classification:'receipt_start',confidence:.99,recognizedText:'标题 配售确认及缴款通知书\n债券简称 26其他MTN001\n债券代码 102699001\n缴款日期 2026-10-29',fields:{bondShortName:'26其他MTN001',securityCode:'102699001',paymentDate:'2026-10-29'}};
  await insertPaymentReceiptFile(DB,{id:'file',batchId:'batch',filename:'file.pdf',mimeType:'application/pdf',byteSize:bytes.length,sha256:sha,objectKey:'file.pdf',pageCount:1,pageAnalysis:[page],grouping:{processing:progress},processingStatus:'queued',createdAt:NOW});
  DB.sql.prepare(`INSERT INTO payment_receipt_events(id,owner_user_id,event_type,detail_json,created_at) VALUES (?,'admin','library_rebuild_requested',?,?)`).run(rebuildId,JSON.stringify({fileIds:['file'],requestedAt:NOW}),NOW);
  let calls=0,acked=0,retried=0;
  const env={DB,AI_PROCESSING_APPROVED:'true',AI:{async run(){calls++;throw Error('saved page must not be inferred again');}},PAYMENT_RECEIPTS:{async get(){return{arrayBuffer:async()=>bytes};},async put(){},async delete(){}}};
  const batch={queue:'credit-bond-payment-receipts',messages:[{body:{kind:'file',ownerUserId:'admin',batchId:'batch',fileId:'file',objectKey:'file.pdf',receivedDate:'2026-10-28',forceReanalyze:true,rebuildId},ack(){acked++;},retry(){retried++;}}]};
  return{DB,env,batch,rebuildId,counts:()=>({calls,acked,retried})};
}

test('a failed duplicate finalizer acknowledges completed OCR and retries only the cheap final sweep',async t=>{
  const h=await fixture(t);h.DB.setFail('SELECT id FROM payment_receipt_events WHERE id=');
  await worker.queue(h.batch,h.env);
  assert.deepEqual(h.counts(),{calls:0,acked:1,retried:0});
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='file'").get().processing_status,'processed');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='file_processing_failed'").get().n,0);
  h.DB.setFail('');await finalizePendingPaymentReceiptRebuilds(h.env);
  assert.ok(h.DB.sql.prepare("SELECT id FROM payment_receipt_events WHERE id=?").get(h.rebuildId+':completed'));assert.equal(h.counts().calls,0);
});

test('a failed batch aggregate refresh does not send a completed file through OCR again',async t=>{
  const h=await fixture(t);h.DB.setFail('SELECT 1 AS complete');
  await worker.queue(h.batch,h.env);
  assert.deepEqual(h.counts(),{calls:0,acked:1,retried:0});
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='file'").get().processing_status,'processed');
});

test('a genuine source-processing failure still records error and retries the file message',async t=>{
  const h=await fixture(t);h.env.PAYMENT_RECEIPTS.get=async()=>{throw Error('source service unavailable');};
  await worker.queue(h.batch,h.env);
  assert.deepEqual(h.counts(),{calls:0,acked:0,retried:1});
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_files WHERE id='file'").get().processing_status,'error');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='file_processing_failed'").get().n,1);
});
