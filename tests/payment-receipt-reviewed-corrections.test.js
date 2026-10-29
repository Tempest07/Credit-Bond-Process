import test from 'node:test';import assert from 'node:assert/strict';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensureAuthSchema} from '../functions/api/_auth.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch,insertPaymentReceiptFile,insertPaymentReceipt,insertPaymentReceiptMatch} from '../functions/api/_payment-receipts.js';
import {applyReviewedPaymentReceiptCorrections,reviewedPaymentReceiptTargetSignature} from '../payment-receipt-reviewed-corrections.js';
import {paymentReceiptFingerprintMaterial,processPaymentReceiptQueueJob} from '../payment-receipt-worker.js';
import {ensureStateChunksSchema,prepareStoredState} from '../state-storage.js';

const NOW='2026-10-28T07:00:00.000Z';
const hash=async input=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof input==='string'?new TextEncoder().encode(input):input))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function fixture(t){
  const DB=createMemoryD1();t.after(()=>DB.sql.close());DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare=DB.prepare,wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});DB.prepare=query=>wrap(prepare(query));
  await ensureAuthSchema(DB);await ensurePaymentReceiptSchema(DB);
  const source=new Uint8Array([1,2,3,4]),sourceSha=await hash(source),projects=[{id:'project',shortName:'26国昇03',tranches:[{id:'tranche',shortName:'26国昇03',securityCode:'284086.SH',paymentDate:'2026-09-23',winningAmountWan:4000}]}];
  DB.sql.prepare("UPDATE user_app_state SET data=?,revision=12 WHERE user_id='admin'").run(JSON.stringify({projects}));
  await insertPaymentReceiptBatch(DB,{id:'batch',ownerUserId:'admin',messageId:'message',receivedAt:NOW,receivedDate:'2026-10-28',rawObjectKey:'mail',processingStatus:'processed',createdAt:NOW});
  await insertPaymentReceiptFile(DB,{id:'file',batchId:'batch',filename:'scan.pdf',objectKey:'source.pdf',mimeType:'application/pdf',byteSize:source.length,sha256:sourceSha,pageCount:2,processingStatus:'review',createdAt:NOW});
  for(const [id,name,code,page,amount] of [['a','26国昇03','2680486.SH',1,4000000000],['b','26成都建工SCP003','01269003',2,5000000000]])
    await insertPaymentReceipt(DB,{id,ownerUserId:'admin',batchId:'batch',fileId:'file',sourcePages:[page],sourcePageLabel:String(page),objectKey:id+'.pdf',sha256:'old-'+id,
      bondShortName:name,securityCode:code,paymentDate:'2026-09-23',amountFen:amount,recognizedText:'债券简称 '+name+'\n债券代码 '+code+'\n原件保留',recognitionStatus:'recognized',matchStatus:'review',createdAt:NOW});
  const rows=DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all(),signatures=await reviewedPaymentReceiptTargetSignature(projects[0],projects[0].tranches[0]);
  const job={kind:'reviewed-receipt-corrections',ownerUserId:'admin',requestId:crypto.randomUUID(),corrections:await Promise.all(rows.map(async(row,index)=>({receiptId:row.id,fileId:'file',source:{sha256:sourceSha,bytes:source.length},
    expected:{updatedAt:row.updated_at,name:row.bond_short_name,code:row.security_code,date:row.payment_date,amountFen:row.amount_fen,sourcePages:[index+1],recognizedTextSha256:await hash(row.recognized_text)},
    securityCode:index?'012690003':'284086.SH',decision:index?{status:'unmatched'}:{status:'matched',target:{projectId:'project',trancheId:'tranche',...signatures}},evidence:'verified-fixture-'+row.id})))};
  let reads=0;return{DB,job,rows,source,env:{DB,PAYMENT_RECEIPTS:{async get(){reads++;return{size:source.length,arrayBuffer:async()=>source};}}},reads:()=>reads};
}
const apply=(h)=>applyReviewedPaymentReceiptCorrections(h.env,h.job,{fingerprintMaterial:paymentReceiptFingerprintMaterial});
async function existingAutoFixture(t){
  const h=await fixture(t);h.job.corrections=h.job.corrections.slice(0,1);
  await insertPaymentReceiptMatch(h.DB,{id:'old-auto',ownerUserId:'admin',receiptId:'a',projectId:'wrong-project',trancheId:'wrong-tranche',matchSource:'auto',matchScore:100,matchReason:'old mistaken reading',createdAt:NOW});
  h.job.corrections[0].expected.updatedAt=h.DB.sql.prepare("SELECT updated_at FROM payment_receipts WHERE id='a'").get().updated_at;
  h.job.corrections[0].expectedMatch={...h.DB.sql.prepare("SELECT * FROM payment_receipt_matches WHERE id='old-auto'").get()};return h;
}

test('reviewed code fixes and correspondences commit together, preserve original data and retry idempotently',async t=>{
  const h=await fixture(t),beforeState=h.DB.sql.prepare("SELECT * FROM user_app_state WHERE user_id='admin'").get();
  const result=await apply(h);assert.equal(result.correctedCount,2);assert.equal(result.reused,false);assert.equal(h.reads(),1);
  const rows=h.DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all();assert.equal(rows[0].security_code,'284086.SH');assert.equal(rows[0].match_status,'matched');assert.equal(rows[1].match_status,'unmatched');assert.equal(rows[1].security_code,'012690003');
  assert.match(rows[0].recognized_text,/债券代码 284086\.SH/);assert.equal(rows[0].bond_short_name,h.rows[0].bond_short_name);
  assert.equal(h.DB.sql.prepare('SELECT match_source FROM payment_receipt_matches').get().match_source,'manual');
  assert.deepEqual(h.DB.sql.prepare("SELECT * FROM user_app_state WHERE user_id='admin'").get(),beforeState);
  assert.equal(h.DB.sql.prepare('SELECT object_key FROM payment_receipt_files').get().object_key,'source.pdf');
  const attempt=JSON.parse(h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE event_type='receipts_reviewed_correction_attempt'").get().detail_json);
  assert.equal(attempt.decisions[0].before.recognizedText,h.rows[0].recognized_text);assert.equal(attempt.decisions[0].before.securityCode,'2680486.SH');
  assert.equal((await apply(h)).reused,true);assert.equal(h.reads(),1);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_matches').get().n,1);
});

test('a request ID cannot be reused with changed evidence or decisions',async t=>{
  const h=await fixture(t);await apply(h);h.job.corrections[0].evidence='different';await assert.rejects(apply(h),/编号/);
});

test('receipt versions, source metadata and recognized text hashes must match the reviewed snapshot',async t=>{
  for(const field of ['updatedAt','name','code','date','amountFen','recognizedTextSha256','sourcePages'])await t.test(field,async t=>{
    const h=await fixture(t),expected=h.job.corrections[0].expected;
    expected[field]=field==='amountFen'?1:field==='sourcePages'?[2]:field==='recognizedTextSha256'?'0'.repeat(64):'changed';
    await assert.rejects(apply(h),/已改变/);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_matches').get().n,0);
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n,0);
  });
});

test('R2 content verification rejects a changed original before any business mutation',async t=>{
  const h=await fixture(t);h.env.PAYMENT_RECEIPTS.get=async()=>({size:4,arrayBuffer:async()=>new Uint8Array([4,3,2,1])});
  await assert.rejects(apply(h),/PDF 校验/);assert.equal(h.DB.sql.prepare("SELECT security_code FROM payment_receipts WHERE id='a'").get().security_code,'2680486.SH');
});

test('a new manual match or changed reviewed target prevents all corrections',async t=>{
  const h=await fixture(t);await insertPaymentReceiptMatch(h.DB,{id:'manual',ownerUserId:'admin',receiptId:'a',projectId:'project',trancheId:'tranche',matchSource:'manual',createdAt:NOW});
  await assert.rejects(apply(h),/已改变|新的项目对应/);
  const h2=await fixture(t);h2.DB.sql.prepare("UPDATE user_app_state SET data=json_set(data,'$.projects[0].tranches[0].winningAmountWan',3999) WHERE user_id='admin'").run();
  await assert.rejects(apply(h2),/目标项目已改变/);
});

test('a newly owned candidate is not silently archived as external',async t=>{
  const h=await fixture(t);h.job.corrections.shift();
  const projects=[{id:'new',shortName:'26成都建工SCP003',tranches:[{id:'new-tranche',shortName:'26成都建工SCP003',securityCode:'012690003',paymentDate:'2026-09-23',winningAmountWan:5000}]}];
  h.DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({projects}));
  await assert.rejects(apply(h),/本方项目候选/);
});

test('an edit between validation and transaction rejects the complete batch and keeps the user edit',async t=>{
  const h=await fixture(t),batch=h.DB.batch;h.DB.batch=async statements=>{h.DB.sql.prepare("UPDATE payment_receipts SET bond_short_name='用户新改' WHERE id='b'").run();return batch(statements);};
  await assert.rejects(apply(h),/事务已回滚/);
  assert.equal(h.DB.sql.prepare("SELECT bond_short_name FROM payment_receipts WHERE id='b'").get().bond_short_name,'用户新改');
  assert.equal(h.DB.sql.prepare("SELECT security_code FROM payment_receipts WHERE id='a'").get().security_code,'2680486.SH');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='receipts_reviewed_corrections_applied'").get().n,0);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='receipts_reviewed_correction_attempt'").get().n,1);
});

test('a project save racing the transaction invalidates its state-root fence',async t=>{
  const h=await fixture(t),batch=h.DB.batch;h.DB.batch=async statements=>{h.DB.sql.prepare("UPDATE user_app_state SET revision=13 WHERE user_id='admin'").run();return batch(statements);};
  await assert.rejects(apply(h),/事务已回滚/);assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_matches').get().n,0);
});

test('a late D1 failure rolls back the applied marker and all changes but retains the attempt for a safe retry',async t=>{
  const h=await fixture(t);h.DB.setFail('UPDATE payment_receipts SET');await assert.rejects(apply(h),/private-database-failure/);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='receipts_reviewed_corrections_applied'").get().n,0);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_matches').get().n,0);h.DB.setFail('');assert.equal((await apply(h)).correctedCount,2);
});

test('code replacement edits exact recognized tokens and retains the unrelated longer number',async t=>{
  const h=await fixture(t);h.job.corrections.shift();
  const text='债券简称 26成都建工SCP003\n债券代码 01269003\n片段 A01269003Z 012690030';
  h.DB.sql.prepare("UPDATE payment_receipts SET recognized_text=? WHERE id='b'").run(text);h.job.corrections[0].expected.recognizedTextSha256=await hash(text);
  await apply(h);assert.equal(h.DB.sql.prepare("SELECT recognized_text FROM payment_receipts WHERE id='b'").get().recognized_text,'债券简称 26成都建工SCP003\n债券代码 012690003\n片段 A01269003Z 012690030');
});

test('a reviewed correspondence can retain a literal unsuffixed source name and wrapped project code',async t=>{
  for(const variant of ['wrapped-code','unsuffixed-name'])await t.test(variant,async t=>{
    const h=await fixture(t);h.job.corrections=h.job.corrections.slice(0,1);delete h.job.corrections[0].securityCode;
    const item=h.job.corrections[0],row=h.rows[0];
    const project={id:'project',shortName:variant==='unsuffixed-name'?row.bond_short_name+'A/B':row.bond_short_name,
      tranches:[{id:'tranche',shortName:variant==='unsuffixed-name'?row.bond_short_name+'A':row.bond_short_name,securityCode:variant==='wrapped-code'?'F102682475':'',paymentDate:row.payment_date,winningAmountWan:4000}]};
    h.DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({projects:[project]}));
    item.decision.target={projectId:project.id,trancheId:'tranche',...await reviewedPaymentReceiptTargetSignature(project,project.tranches[0])};
    await apply(h);const current=h.DB.sql.prepare("SELECT bond_short_name,security_code,recognized_text FROM payment_receipts WHERE id='a'").get();
    assert.deepEqual({...current},{bond_short_name:row.bond_short_name,security_code:row.security_code,recognized_text:row.recognized_text});
    assert.deepEqual(JSON.parse(h.DB.sql.prepare("SELECT data FROM user_app_state WHERE user_id='admin'").get().data).projects,[project]);
  });
});

test('only the configured owner can dispatch reviewed decisions through the internal queue', async t => {
  const h = await fixture(t);
  await assert.rejects(processPaymentReceiptQueueJob(h.env, {...h.job, ownerUserId:'another-user'}), /归属无效/);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  assert.equal((await processPaymentReceiptQueueJob(h.env, h.job)).correctedCount, 2);
  assert.equal((await processPaymentReceiptQueueJob(h.env, h.job)).reused, true);
});

test('production-style chunked project state is read and guarded by its unchanged manifest root',async t=>{
  const h=await fixture(t);await ensureStateChunksSchema(h.DB);
  const current=h.DB.sql.prepare("SELECT data FROM user_app_state WHERE user_id='admin'").get().data;
  const storage=await prepareStoredState(JSON.stringify({...JSON.parse(current),padding:'数'.repeat(200000)}));
  assert.ok(storage.chunkId);for(let index=0;index<storage.chunks.length;index++)h.DB.sql.prepare('INSERT INTO app_state_chunks(storage_id,chunk_index,data) VALUES(?,?,?)').run(storage.chunkId,index,storage.chunks[index]);
  h.DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(storage.serialized);
  assert.equal((await apply(h)).correctedCount,2);
  assert.equal(h.DB.sql.prepare("SELECT data FROM user_app_state WHERE user_id='admin'").get().data,storage.serialized);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM app_state_chunks').get().n,storage.chunks.length);
});

test('a reviewed exact old automatic correspondence is replaced atomically and retained in its audit',async t=>{
  const h=await existingAutoFixture(t),old=h.job.corrections[0].expectedMatch;await apply(h);
  const match=h.DB.sql.prepare("SELECT * FROM payment_receipt_matches WHERE receipt_id='a'").get();
  assert.equal(match.project_id,'project');assert.equal(match.tranche_id,'tranche');assert.equal(match.match_source,'manual');assert.notEqual(match.id,old.id);
  const audit=JSON.parse(h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE event_type='receipts_reviewed_correction_attempt'").get().detail_json);
  assert.deepEqual(audit.decisions[0].previousMatch,old);assert.equal((await apply(h)).reused,true);
});

test('an automatic correspondence needs its complete unchanged snapshot and can never authorize a manual one',async t=>{
  for(const mode of ['missing','incomplete','stale','manual'])await t.test(mode,async t=>{
    const h=await existingAutoFixture(t),item=h.job.corrections[0];
    if(mode==='missing')delete item.expectedMatch;
    if(mode==='incomplete')delete item.expectedMatch.match_reason;
    if(mode==='stale')item.expectedMatch.match_score--;
    if(mode==='manual')h.DB.sql.prepare("UPDATE payment_receipt_matches SET match_source='manual' WHERE id='old-auto'").run();
    await assert.rejects(apply(h),/已改变|新的项目对应/);
    assert.equal(h.DB.sql.prepare("SELECT id FROM payment_receipt_matches WHERE receipt_id='a'").get().id,'old-auto');
    assert.equal(h.DB.sql.prepare("SELECT security_code FROM payment_receipts WHERE id='a'").get().security_code,'2680486.SH');
  });
});

test('the transaction fences a changed old auto correspondence and a concurrent manual confirmation',async t=>{
  for(const column of ['match_reason','match_source'])await t.test(column,async t=>{
    const h=await existingAutoFixture(t),batch=h.DB.batch;
    h.DB.batch=async statements=>{h.DB.sql.prepare(`UPDATE payment_receipt_matches SET ${column}=? WHERE id='old-auto'`).run(column==='match_source'?'manual':'user changed reason');return batch(statements);};
    await assert.rejects(apply(h),/事务已回滚/);
    assert.equal(h.DB.sql.prepare("SELECT id FROM payment_receipt_matches WHERE receipt_id='a'").get().id,'old-auto');
    assert.equal(h.DB.sql.prepare("SELECT security_code FROM payment_receipts WHERE id='a'").get().security_code,'2680486.SH');
  });
});

test('a failure after deleting the wrong auto match restores both its mapping and its receipt fields',async t=>{
  const h=await existingAutoFixture(t),old=h.job.corrections[0].expectedMatch;h.DB.setFail('INSERT INTO payment_receipt_matches');
  await assert.rejects(apply(h),/private-database-failure/);
  assert.deepEqual({...h.DB.sql.prepare("SELECT * FROM payment_receipt_matches WHERE receipt_id='a'").get()},old);
  assert.equal(h.DB.sql.prepare("SELECT security_code FROM payment_receipts WHERE id='a'").get().security_code,'2680486.SH');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='receipts_reviewed_corrections_applied'").get().n,0);
  h.DB.setFail('');assert.equal((await apply(h)).correctedCount,1);
});
