import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryD1} from './helpers/d1-memory.js';
import {ensurePaymentReceiptSchema,insertPaymentReceiptBatch,listPendingPaymentReceiptBatches} from '../functions/api/_payment-receipts.js';

test('an archived email without payment PDFs is complete while unresolved email extraction stays visible', async t => {
  const DB = createMemoryD1(); t.after(() => DB.sql.close());
  const prepare=DB.prepare, wrap=statement=>({...statement,bind(...values){return wrap(statement.bind(...values));},async all(){return statement.execute();}});
  DB.prepare=query=>wrap(prepare(query));
  await ensurePaymentReceiptSchema(DB);
  for (const status of ['processed','review','error']) await insertPaymentReceiptBatch(DB, {
    id:status,ownerUserId:'admin',messageId:status,rawObjectKey:`emails/${status}.eml`,
    processingStatus:status,receivedDate:'2026-10-29',receivedAt:'2026-10-29T00:00:00Z',createdAt:'2026-10-29T00:00:00Z',
  });
  const pending=await listPendingPaymentReceiptBatches(DB,'admin');
  assert.deepEqual(pending.map(row=>row.id).sort(),['error','review']);
  assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_batches').get().n,3);
});
