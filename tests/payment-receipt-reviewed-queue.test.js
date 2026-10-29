import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {recordDeadLetterFailure} from '../payment-receipt-worker.js';
import {createMemoryD1} from './helpers/d1-memory.js';

test('invalid internal corrections record a request-specific failure and acknowledge without touching a source batch', async t => {
  const DB = createMemoryD1(); t.after(() => DB.sql.close());
  const prepare = DB.prepare, wrap = statement => ({...statement,
    bind(...values) { return wrap(statement.bind(...values)); }, async all() { return statement.execute(); }});
  DB.prepare = query => wrap(prepare(query));
  const env = {DB, PAYMENT_RECEIPTS:{}, RECEIPT_OWNER_USER_ID:'admin'};
  const job = {kind:'reviewed-receipt-corrections', ownerUserId:'admin', requestId:'invalid'};
  let acknowledged = 0, retried = 0;
  await worker.queue({queue:'receipts', messages:[{body:job, ack(){acknowledged++;}, retry(){retried++;}}]}, env);
  assert.equal(acknowledged,1); assert.equal(retried,0);
  const event = DB.sql.prepare('SELECT event_type,detail_json FROM payment_receipt_events').get();
  assert.equal(event.event_type,'reviewed_receipt_corrections_failed');
  assert.deepEqual(JSON.parse(event.detail_json), {requestId:'invalid',error:'复核修正参数无效',permanent:true});
  assert.equal(DB.statements.some(query => /UPDATE payment_receipt_batches/.test(query)),false);
  await recordDeadLetterFailure(env, job);
  assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='reviewed_receipt_corrections_dead_lettered'").get().n,1);
});
