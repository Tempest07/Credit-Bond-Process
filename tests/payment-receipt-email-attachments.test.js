import test from 'node:test';import assert from 'node:assert/strict';
import {collectPaymentReceiptPdfAttachments,PaymentReceiptAttachmentLimitError} from '../payment-receipt-email-attachments.js';
import {processPaymentReceiptEmail} from '../payment-receipt-worker.js';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensureAuthSchema} from '../functions/api/_auth.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch} from '../functions/api/_payment-receipts.js';

const pdf=Buffer.from('%PDF-1.5\nsynthetic scan'),NOW='2026-10-29T00:00:00Z';
function email(attachments){const boundary='test_boundary';return Buffer.from('From: authorized-forwarder@example.com\r\nTo: receipts@example.com\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="'+boundary+'"\r\n\r\n'+attachments.map(item=>'--'+boundary+'\r\nContent-Type: '+item.type+'\r\nContent-Disposition: attachment; filename="'+item.name+'"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(item.content).toString('base64')+'\r\n').join('')+'--'+boundary+'--\r\n');}
const part=(name,content=pdf,type='application/pdf')=>({name,content,type});
const nested=(content,name='forwarded.eml')=>part(name,content,'message/rfc822');

test('direct PDFs retain their actual filenames and source route',async()=>{
  const result=await collectPaymentReceiptPdfAttachments(email([part('缴款.pdf'),part('summary.xlsx',Buffer.from('PK..'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]));
  assert.equal(result.pdfs.length,1);assert.equal(result.pdfs[0].filename,'缴款.pdf');assert.deepEqual(result.pdfs[0].sourcePath,['缴款.pdf']);assert.deepEqual(Buffer.from(result.pdfs[0].content),pdf);
  assert.equal(result.attachmentCount,2);assert.equal(result.nestedEmailCount,0);
});

test('forwarded messages yield both inner PDFs and preserve their separate relative origins',async()=>{
  const raw=email([nested(email([part('债券A.pdf')]),'来自同事A.eml'),nested(email([part('债券B.pdf')]),'来自同事B.eml')]);
  const result=await collectPaymentReceiptPdfAttachments(raw);assert.equal(result.attachmentCount,4);assert.equal(result.nestedEmailCount,2);
  assert.deepEqual(result.pdfs.map(item=>item.sourcePath),[['来自同事A.eml','债券A.pdf'],['来自同事B.eml','债券B.pdf']]);
});

test('three nested EML levels are accepted and a fourth is explicitly bounded',async()=>{
  let raw=email([part('notice.pdf')]);for(let level=0;level<3;level++)raw=email([nested(raw)]);
  assert.equal((await collectPaymentReceiptPdfAttachments(raw)).pdfs.length,1);
  await assert.rejects(collectPaymentReceiptPdfAttachments(email([nested(raw)])),error=>error instanceof PaymentReceiptAttachmentLimitError&&error.detail.limit==='depth');
});

test('the attachment count is global across nested messages rather than per message',async()=>{
  const many=Array.from({length:10},(_,index)=>part('notice'+index+'.pdf'));
  await assert.rejects(collectPaymentReceiptPdfAttachments(email([nested(email(many),'a.eml'),nested(email(many),'b.eml')])),error=>error.detail.limit==='attachments');
});

test('raw email bytes and cumulative nested attachment bytes are bounded before extraction completes',async()=>{
  await assert.rejects(collectPaymentReceiptPdfAttachments(Buffer.alloc(25*1024*1024+1)),error=>error.detail.limit==='bytes');
  const content=Buffer.alloc(11.5*1024*1024,32);pdf.copy(content);
  const raw=email([nested(email([part('large.pdf',content)]))]);assert.ok(raw.length<25*1024*1024);
  await assert.rejects(collectPaymentReceiptPdfAttachments(raw),error=>error.detail.limit==='bytes');
});

test('office-only files and mislabeled non-PDF content remain archive material without becoming fake PDFs',async()=>{
  const result=await collectPaymentReceiptPdfAttachments(email([part('not-real.pdf',Buffer.from('not a pdf')),part('income.xlsx',Buffer.from('PK..'),'application/octet-stream')]));
  assert.equal(result.pdfs.length,0);assert.equal(result.attachmentCount,2);
});

async function fixture(t,raw){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());const prepare=DB.prepare,wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});DB.prepare=query=>wrap(prepare(query));
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
  await insertPaymentReceiptBatch(DB,{id:'batch',ownerUserId:'admin',messageId:'original-message',receivedAt:NOW,receivedDate:'2026-08-24',rawObjectKey:'raw/batch/message.eml',rawSha256:sha,processingStatus:'queued',createdAt:NOW});
  const objects=new Map([['raw/batch/message.eml',raw]]),jobs=[];let calls=0;
  const env={DB,PAYMENT_RECEIPTS:{async get(key){return{arrayBuffer:async()=>objects.get(key)};},async put(key,value){objects.set(key,value);}},RECEIPT_QUEUE:{async send(job){jobs.push(job);}},AI:{async run(){calls++;throw Error('No inference during email extraction');}},EMAIL:{async send(){throw Error('Do not resend nested emails');}}};
  return{DB,env,objects,jobs,raw,sha,calls:()=>calls,job:{kind:'email',ownerUserId:'admin',batchId:'batch',rawObjectKey:'raw/batch/message.eml',receivedDate:'2026-08-24',expectedRawSha256:sha}};
}

test('the real email processor archives and queues inner PDF files without sending mail, OCR or replacing the original EML',async t=>{
  const h=await fixture(t,email([nested(email([part('原件A.pdf')])),nested(email([part('原件B.pdf',Buffer.from('%PDF-1.5\ndifferent scan'))]),'second.eml')]));
  const result=await processPaymentReceiptEmail(h.env,h.job);assert.equal(result.acceptedPdfCount,2);assert.equal(h.jobs.length,2);assert.equal(h.calls(),0);
  assert.equal(h.objects.get(h.job.rawObjectKey),h.raw);assert.deepEqual(h.DB.sql.prepare('SELECT filename FROM payment_receipt_files ORDER BY filename').all().map(row=>row.filename),['原件A.pdf','原件B.pdf']);
  const detail=JSON.parse(h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE event_type='email_attachments_extracted'").get().detail_json);
  assert.equal(detail.nestedEmailCount,2);assert.deepEqual(detail.pdfSources[0].sourcePath,['forwarded.eml','原件A.pdf']);
  assert.equal((await processPaymentReceiptEmail(h.env,h.job)).status,'already_handled');assert.equal(h.jobs.length,2);
});

test('an office-only email is completed with a no-payment-PDF audit and is not retried',async t=>{
  const h=await fixture(t,email([part('income.xlsx',Buffer.from('PK..'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]));
  assert.equal((await processPaymentReceiptEmail(h.env,h.job)).status,'no_pdf');
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_batches WHERE id='batch'").get().processing_status,'processed');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='email_archived_without_payment_pdf'").get().n,1);assert.equal(h.jobs.length,0);
  assert.equal((await processPaymentReceiptEmail(h.env,h.job)).status,'already_handled');
});

test('a recursive limit violation persists no partial PDF files or processing jobs',async t=>{
  const h=await fixture(t,email(Array.from({length:21},(_,i)=>part('a'+i+'.pdf'))));
  assert.equal((await processPaymentReceiptEmail(h.env,h.job)).status,'too_many_attachments');
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_files').get().n,0);assert.equal(h.jobs.length,0);
});

test('recovery jobs verify the exact saved EML digest before extracting attachments',async t=>{
  const h=await fixture(t,email([part('notice.pdf')]));
  await assert.rejects(processPaymentReceiptEmail(h.env,{...h.job,expectedRawSha256:'0'.repeat(64)}),error=>error.permanent===true);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_files').get().n,0);assert.equal(h.jobs.length,0);
});

test('an attachment declared as PDF with invalid bytes remains an extraction issue',async t=>{
  const h=await fixture(t,email([part('broken.pdf',Buffer.from('not PDF content'))]));
  assert.equal((await processPaymentReceiptEmail(h.env,h.job)).status,'invalid_pdf');
  assert.equal(h.DB.sql.prepare("SELECT processing_status FROM payment_receipt_batches WHERE id='batch'").get().processing_status,'review');assert.equal(h.jobs.length,0);
});
