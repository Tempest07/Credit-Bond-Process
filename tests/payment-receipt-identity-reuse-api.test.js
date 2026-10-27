import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile, insertPaymentReceipt } from '../functions/api/_payment-receipts.js';
import { onRequestPost } from '../functions/api/payment-receipts/[id]/identity-review.js';

const NOW = '2026-10-28T00:00:00.000Z';
const proposal = (extra = {}) => ({ status: 'verified', name: '26苏交通CP008', code: '042680338', pageNumber: 1,
  readings: { nameField: '26苏交通CP008', remittanceName: '26苏交通CP008', securityCode: '042680338', uncertainties: [] },
  fileId: 'file', sourcePages: [1], receiptSha256: 'receipt-hash', fileSha256: 'file-hash',
  fileUpdatedAt: NOW, receiptUpdatedAt: NOW, originalName: '26苏交CP008', reviewId: 'proposed', createdAt: NOW,
  ...extra });

async function fixture(t, { value = proposal(), owner = 'admin', receiptId = 'receipt', type = 'identity_review_proposed' } = {}) {
  const DB = createMemoryD1(); t.after(() => DB.sql.close());
  const originalPrepare = DB.prepare;
  const wrap = statement => ({ ...statement, bind(...values) { return wrap(statement.bind(...values)); }, async all() { return statement.execute(); } });
  DB.prepare = sql => wrap(originalPrepare(sql));
  await ensureAuthSchema(DB); await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB, { id: 'batch', ownerUserId: 'admin', messageId: 'message', receivedAt: NOW,
    receivedDate: '2026-10-28', rawObjectKey: 'email.eml', processingStatus: 'review', createdAt: NOW });
  await insertPaymentReceiptFile(DB, { id: 'file', batchId: 'batch', filename: 'original.pdf', mimeType: 'application/pdf',
    byteSize: 100, sha256: 'file-hash', objectKey: 'original.pdf', pageCount: 2, processingStatus: 'review', createdAt: NOW });
  await insertPaymentReceipt(DB, { id: 'receipt', ownerUserId: 'admin', batchId: 'batch', fileId: 'file', sourcePages: [1],
    sourcePageLabel: '1', objectKey: 'receipt.pdf', sha256: 'receipt-hash', bondShortName: '26苏交CP008', securityCode: '042680338',
    amountFen: 42000000000, recognizedText: '原始OCR不可改写', matchStatus: 'review', recognitionStatus: 'recognized', createdAt: NOW });
  DB.sql.prepare(`INSERT INTO payment_receipt_events (id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at)
    VALUES ('proposed',?,?,?,?,?,?)`).run(owner, receiptId, 'batch', type, typeof value === 'string' ? value : JSON.stringify(value), NOW);
  let storageReads = 0;
  const env = { DB, PAYMENT_RECEIPTS: { async get() { storageReads++; throw new Error('Cache must not load a PDF'); } } };
  const invoke = body => onRequestPost({ env, params: { id: 'receipt' }, request: new Request('http://127.0.0.1/api/payment-receipts/receipt/identity-review',
    { method: 'POST', headers: { Origin: 'http://127.0.0.1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return { DB, invoke, get storageReads() { return storageReads; } };
}

test('reuse=true returns a verified cloud proposal without a PDF read, new inference or business mutation', async t => {
  const h = await fixture(t);
  const receipts = h.DB.sql.prepare('SELECT * FROM payment_receipts').all();
  const events = h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all();
  const r = await h.invoke({ action: 'preview', reuse: true }); assert.equal(r.status, 200);
  const body = await r.json(); assert.equal(body.cached, true); assert.equal(body.reviewId, 'proposed');
  assert.equal(body.proposal.name, '26苏交通CP008'); assert.equal(body.identityReview, undefined); assert.equal(body.receipt, undefined);
  assert.equal(h.storageReads, 0);
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipts').all(), receipts);
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all(), events);
});

test('manual preview retains its explicit fresh-review behavior unless reuse is exactly boolean true', async t => {
  const h = await fixture(t);
  for (const reuse of [undefined, false, 'true']) {
    const r = await h.invoke({ action: 'preview', ...(reuse === undefined ? {} : { reuse }) });
    assert.equal(r.status, 503, 'without a configured model the forced review cannot silently return a prior suggestion');
  }
});

test('every source fence and independent reading must match before a proposal is reused', async t => {
  const changes = [{ fileId: 'other' }, { fileSha256: 'changed' }, { receiptSha256: 'changed' },
    { fileUpdatedAt: 'changed' }, { receiptUpdatedAt: 'changed' }, { sourcePages: [1, 2] }, { pageNumber: 2 },
    { code: '032680566' }, { status: 'unavailable' }, { name: '26苏交通SCP008' },
    { readings: { ...proposal().readings, remittanceName: '26别的CP008' } },
    { readings: { ...proposal().readings, uncertainties: ['不确定'] } }];
  for (const change of changes) {
    await t.test(JSON.stringify(change), async sub => {
      const h = await fixture(sub, { value: proposal(change) });
      assert.equal((await h.invoke({ action: 'preview', reuse: true })).status, 503);
      assert.equal(h.storageReads, 0);
    });
  }
});

test('malformed records, other owners and other receipt records cannot provide reusable evidence', async t => {
  for (const options of [{ value: '{broken' }, { value: 'null' }, { value: '[]' }, { value: '"text"' }, { owner: 'other' }, { receiptId: 'other-receipt' }]) {
    await t.test(JSON.stringify(options), async sub => {
      const h = await fixture(sub, options);
      assert.equal((await h.invoke({ action: 'preview', reuse: true })).status, 503);
    });
  }
});

test('an already accepted name is still preferred to proposed reuse and is not adopted again', async t => {
  const h = await fixture(t, { type: 'identity_review_accepted', value: proposal({ acceptedAt: NOW }) });
  const before = h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all();
  const r = await h.invoke({ action: 'preview', reuse: true }); assert.equal(r.status, 200);
  const body = await r.json(); assert.equal(body.cached, true); assert.equal(body.receipt.id, 'receipt');
  assert.equal(body.receipt.identityReview.name, '26苏交通CP008');
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipt_events').all(), before);
  assert.equal(h.storageReads, 0);
});

test('source changes during cache lookup are rejected before a cached suggestion is returned', async t => {
  const h = await fixture(t), prepare = h.DB.prepare;
  h.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT id, detail_json FROM payment_receipt_events')) return statement;
    const wrap = query => ({ ...query, bind(...values) { return wrap(query.bind(...values)); }, async all() {
      const result = await query.all();
      h.DB.sql.prepare("UPDATE payment_receipt_files SET updated_at='changed' WHERE id='file'").run();
      return result;
    } });
    return wrap(statement);
  };
  const r = await h.invoke({ action: 'preview', reuse: true });
  assert.equal(r.status, 409); assert.equal(h.storageReads, 0);
});
