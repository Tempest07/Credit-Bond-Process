import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import {
  ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile,
  insertPaymentReceipt, insertPaymentReceiptMatch, getPaymentReceipt, listPaymentReceipts,
  acceptedPaymentReceiptIdentityReview,
} from '../functions/api/_payment-receipts.js';
import { onRequestPost as regroup } from '../functions/api/payment-receipt-files/[id]/regroup.js';
import { onRequestPost as review } from '../functions/api/payment-receipts/[id]/identity-review.js';

const NOW = '2026-10-28T00:00:00.000Z';
const accepted = (fileHash = 'source-hash') => ({
  status: 'verified', name: '26苏交通CP008', code: '042680338', pageNumber: 2,
  readings: { nameField: '26 苏交通 CP008', remittanceName: '26苏交通CP008', securityCode: '042680338', uncertainties: [] },
  receiptSha256: 'old-fingerprint', fileSha256: fileHash, fileId: 'file', sourcePages: [2, 3, 4],
  originalName: '26 苏交 CP008', model: 'test-vision', reviewId: 'original-review', acceptedAt: NOW,
});

function inheritedRow(extra = {}) {
  return { id: 'new-receipt', file_id: 'file', sha256: 'new-fingerprint', source_file_sha256: 'source-hash',
    source_pages_json: '[2]', object_key: 'receipts/manual/new.pdf', bond_short_name: '26苏交CP008',
    security_code: '042680338', identity_review_json: JSON.stringify(accepted()), ...extra };
}

test('manual regroup inherits only the accepted identity of the same original first page and code', () => {
  const row = inheritedRow(), before = JSON.stringify(row);
  const value = acceptedPaymentReceiptIdentityReview(row);
  assert.equal(value.name, '26苏交通CP008');
  assert.equal(value.pageNumber, 2);
  assert.equal(value.reviewId, 'original-review');
  assert.equal(value.originalName, '26 苏交 CP008');
  assert.equal(value.receiptSha256, undefined);
  assert.equal(JSON.stringify(row), before);
  assert.equal(acceptedPaymentReceiptIdentityReview(inheritedRow({ source_pages_json: '[2,3]' })).name, value.name);
});

test('regroup inheritance rejects other pages, added pages, different files, codes and unaccepted evidence', () => {
  const changes = [
    { source_pages_json: '[3]' }, { source_pages_json: '[2,5]' }, { source_pages_json: '[2,2]' },
    { object_key: 'receipts/automatic/new.pdf' }, { file_id: 'other' }, { source_file_sha256: 'other-content' },
    { security_code: '' }, { security_code: '032680566' },
    { security_code: '042680338.SZ', identity_review_json: JSON.stringify({ ...accepted(), code: '042680338.IB',
      readings: { ...accepted().readings, securityCode: '042680338.IB' } }) },
    { bond_short_name: '26苏交通SCP008' },
    ...[{ acceptedAt: '' }, { status: 'proposed' }, { sourcePages: [2,2,4] }, { pageNumber: 3 },
      { readings: { ...accepted().readings, remittanceName: '26苏交通SCP008' } },
      { readings: { ...accepted().readings, uncertainties: ['不确定'] } }]
      .map(change => ({ identity_review_json: JSON.stringify({ ...accepted(), ...change }) })),
  ];
  for (const change of changes) assert.equal(acceptedPaymentReceiptIdentityReview(inheritedRow(change)), null, JSON.stringify(change));
});

async function fixture(t) {
  const DB = createMemoryD1();
  t.after(() => DB.sql.close());
  DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare = DB.prepare;
  const wrap = statement => ({ ...statement, bind(...values) { return wrap(statement.bind(...values)); }, async all() { return statement.execute(); } });
  DB.prepare = sql => wrap(prepare(sql));
  await ensureAuthSchema(DB); await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB, { id: 'batch', ownerUserId: 'admin', messageId: 'message', receivedAt: NOW,
    receivedDate: '2026-10-28', rawObjectKey: 'emails/original.eml', processingStatus: 'review', createdAt: NOW });
  const pdf = await PDFDocument.create();
  for (let page=1;page<=4;page++) pdf.addPage();
  const bytes = await pdf.save();
  const fileHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
  const analyses = [1,2,3,4].map(pageNumber => ({ pageNumber, classification: 'receipt_start', confidence: .99,
    recognizedText: pageNumber === 2 ? '债券简称26苏交CP008\n债券代码042680338\n原始OCR不能修改' : '原始识别文字',
    fields: { bondShortName: pageNumber === 2 ? '26苏交CP008' : `26其他MTN00${pageNumber}`,
      securityCode: pageNumber === 2 ? '042680338' : `10268000${pageNumber}`, amountFen: 42_000_000_000,
      paymentDate: '2026-10-15' } }));
  await insertPaymentReceiptFile(DB, { id: 'file', batchId: 'batch', filename: 'original.pdf', mimeType: 'application/pdf',
    byteSize: bytes.length, sha256: fileHash, objectKey: 'attachments/original.pdf', pageCount: 4,
    pageAnalysis: analyses, processingStatus: 'review', createdAt: NOW });
  for (const [id, pages, code, name] of [['matched', [1], '102680001', '26其他MTN001'],
    ['old-receipt', [2,3,4], '042680338', '26苏交CP008']]) {
    await insertPaymentReceipt(DB, { id, ownerUserId: 'admin', batchId: 'batch', fileId: 'file', sourcePages: pages,
      sourcePageLabel: pages.join(','), objectKey: `receipts/${id}.pdf`, sha256: id === 'old-receipt' ? 'old-fingerprint' : 'matched-fingerprint',
      recognitionStatus: 'recognized', matchStatus: id === 'matched' ? 'matched' : 'review',
      bondShortName: name, securityCode: code, amountFen: 42_000_000_000, paymentDate: '2026-10-15', createdAt: NOW });
  }
  await insertPaymentReceiptMatch(DB, { id: 'match', ownerUserId: 'admin', receiptId: 'matched', projectId: 'project', trancheId: 'tranche' });
  DB.sql.prepare(`INSERT INTO payment_receipt_events (id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at)
    VALUES ('accepted','admin','old-receipt','batch','identity_review_accepted',?,?)`).run(JSON.stringify(accepted(fileHash)), NOW);
  const objects = new Map([['attachments/original.pdf', bytes], ['emails/original.eml', new Uint8Array([1])]]);
  const env = { DB, PAYMENT_RECEIPTS: {
    async get(key) { const value = objects.get(key); return value ? { arrayBuffer: async () => value } : null; },
    async put(key,value) { objects.set(key,value); }, async delete(key) { objects.delete(key); },
  } };
  const invoke = () => regroup({ env, params: { id: 'file' }, request: new Request('http://127.0.0.1/api/payment-receipt-files/file/regroup',
    { method: 'POST', body: JSON.stringify({ groups: [[1],[2],[3],[4]], blankPages: [], expectedUpdatedAt: NOW }) }) });
  return { DB, env, invoke, objects, fileHash, analyses };
}

test('regroup response and subsequent reads retain an adopted name without rewriting OCR or other matches', async t => {
  const h = await fixture(t);
  const oldEvent = h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE id='accepted'").get().detail_json;
  const result = await h.invoke(); assert.equal(result.status, 200);
  const payload = await result.json(), current = payload.receipts.find(row => row.sourcePages[0] === 2);
  assert.equal(current.bondShortName, '26苏交CP008');
  assert.equal(current.identityReview.name, '26苏交通CP008');
  assert.equal(current.securityCode, '042680338');
  assert.equal(current.amountFen, 42_000_000_000);
  assert.equal(current.paymentDate, '2026-10-15');
  assert.equal(payload.preservedMatchCount, 1);
  assert.equal(payload.receipts.find(row => row.sourcePages[0] === 1).projectId, 'project');
  for (const receipt of payload.receipts.filter(row => row.sourcePages[0] !== 2)) assert.equal(receipt.identityReview, undefined);
  const fetched = await getPaymentReceipt(h.DB, 'admin', current.id);
  assert.equal(fetched.identityReview.name, current.identityReview.name);
  assert.match(fetched.recognizedText, /原始OCR不能修改/);
  assert.equal(h.DB.sql.prepare("SELECT detail_json FROM payment_receipt_events WHERE id='accepted'").get().detail_json, oldEvent);
  assert.deepEqual(JSON.parse(h.DB.sql.prepare("SELECT page_analysis_json FROM payment_receipt_files WHERE id='file'").get().page_analysis_json), h.analyses);
  assert.ok(h.objects.has('attachments/original.pdf')); assert.ok(h.objects.has('emails/original.eml'));
});

test('already regrouped receipts recover historical accepted evidence through read-only listing and cached preview', async t => {
  const h = await fixture(t);
  // Reproduce a row created by the old regroup implementation, with the accepted
  // event still pointing at the removed parent receipt.
  h.DB.sql.prepare("DELETE FROM payment_receipts WHERE id='old-receipt'").run();
  await insertPaymentReceipt(h.DB, { id: 'already-regrouped', ownerUserId: 'admin', batchId: 'batch', fileId: 'file',
    sourcePages: [2], sourcePageLabel: '2', objectKey: 'receipts/manual/already.pdf', sha256: 'new-fingerprint',
    recognitionStatus: 'recognized', matchStatus: 'review', bondShortName: '26苏交CP008', securityCode: '042680338',
    amountFen: 42_000_000_000, paymentDate: '2026-10-15', createdAt: NOW });
  const insertEvent = h.DB.sql.prepare(`INSERT INTO payment_receipt_events
    (id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at) VALUES (?,?,?,?,?,?,?)`);
  for (const [id, owner, type, value] of [
    ['foreign', 'another-owner', 'identity_review_accepted', accepted(h.fileHash)],
    ['other-file', 'admin', 'identity_review_accepted', { ...accepted(h.fileHash), fileId: 'other-file' }],
    ['proposal-only', 'admin', 'identity_review_proposed', accepted(h.fileHash)],
    ['malformed', 'admin', 'identity_review_accepted', '{broken'],
  ]) insertEvent.run(id, owner, 'another-receipt', 'batch', type, typeof value === 'string' ? value : JSON.stringify(value), '2026-10-29T00:00:00.000Z');
  const before = h.DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all();
  const events = h.DB.sql.prepare('SELECT * FROM payment_receipt_events ORDER BY id').all();
  const all = await listPaymentReceipts(h.DB, 'admin');
  assert.equal(all.find(row => row.id === 'already-regrouped').identityReview.name, '26苏交通CP008');
  const result = await review({ env: h.env, params: { id: 'already-regrouped' }, request: new Request('http://127.0.0.1/api/payment-receipts/already-regrouped/identity-review',
    { method: 'POST', headers: { Origin: 'http://127.0.0.1' }, body: JSON.stringify({ action: 'preview' }) }) });
  assert.equal(result.status, 200);
  const payload = await result.json(); assert.equal(payload.cached, true);
  assert.equal(payload.identityReview.name, '26苏交通CP008');
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all(), before);
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipt_events ORDER BY id').all(), events);
  insertEvent.run('invalid-current', 'admin', 'already-regrouped', 'batch', 'identity_review_accepted',
    JSON.stringify({ ...accepted(h.fileHash), readings: { ...accepted().readings, uncertainties: ['两处冲突'] } }), '2026-10-30T00:00:00.000Z');
  assert.equal((await getPaymentReceipt(h.DB, 'admin', 'already-regrouped')).identityReview, undefined,
    'a conflicting current acceptance must not silently fall back to an older parent');
});

test('human edits remain explicitly manual after regroup and never inherit the old visual reading as evidence', async t => {
  const h = await fixture(t);
  const old = await getPaymentReceipt(h.DB, 'admin', 'old-receipt');
  assert.equal(old.fileUpdatedAt, NOW);
  const saved = await review({ env: h.env, params: { id: old.id }, request: new Request('http://127.0.0.1/api/payment-receipts/old-receipt/identity-review',
    { method: 'POST', headers: { Origin: 'http://127.0.0.1' }, body: JSON.stringify({ action: 'manual', name: '26苏交通SCP008(人工核对)',
      expectedUpdatedAt: old.updatedAt, expectedFileUpdatedAt: old.fileUpdatedAt, expectedIdentityReviewId: old.identityReview.reviewId }) }) });
  assert.equal(saved.status, 200);
  const first = await saved.json(); assert.equal(first.identityReview.source, 'manual');
  assert.equal(first.identityReview.readings, undefined);
  const result = await h.invoke(); assert.equal(result.status, 200);
  const payload = await result.json(), current = payload.receipts.find(row => row.sourcePages[0] === 2);
  assert.equal(current.identityReview.name, '26苏交通SCP008(人工核对)');
  assert.equal(current.identityReview.source, 'manual'); assert.equal(current.identityReview.readings, undefined);
  assert.equal(current.bondShortName, '26苏交CP008'); assert.equal(current.amountFen, 42_000_000_000);
  assert.equal(current.identityReview.reviewId, first.identityReview.reviewId);
  assert.equal(current.fileUpdatedAt, payload.updatedAt);
  assert.equal((await getPaymentReceipt(h.DB, 'admin', current.id)).identityReview.source, 'manual');
  assert.equal(payload.preservedMatchCount, 1);
});
