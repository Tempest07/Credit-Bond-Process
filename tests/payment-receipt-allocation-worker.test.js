import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile,
  insertPaymentReceipt, insertPaymentReceiptMatch } from '../functions/api/_payment-receipts.js';
import { getPaymentReceipt } from '../functions/api/_payment-receipts.js';
import { processPaymentReceiptFile } from '../payment-receipt-worker.js';
import { onRequestPost as reprocess } from '../functions/api/payment-receipt-files/[id]/reprocess.js';
import { onRequestGet as download } from '../functions/api/payment-receipts/[id]/file.js';
import { onRequestPost as regroup } from '../functions/api/payment-receipt-files/[id]/regroup.js';

const NOW = '2026-10-29T04:00:00.000Z';
const ORIGIN = 'http://127.0.0.1:8788';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [
  { bond_short_name: '26青信07', security_code: '245774.SH', amount_text: '10000万元', coupon_rate: '1.88%', tenor: '5年' },
  { bond_short_name: '26青信08', security_code: '245775.SH', amount_text: '5000万元', coupon_rate: '2.40%', tenor: '10年' },
];
const TEXT = '配售确认及缴款通知书\n债券简称 债券代码 发行规模(万元) 期限 票面利率 获配面值(万元) 缴款金额(万元)\n' +
  '26青信07 245774.SH 74000.00 5年 1.88% 10000.00 10000.00\n26青信08 245775.SH 26000.00 10年 2.40% 5000.00 5000.00\n请贵公司于2026年7月29日15:00前缴款。';

async function fixture(t, { single = false, legacy = false } = {}) {
  const DB = createMemoryD1(); t.after(() => DB.sql.close()); DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare = DB.prepare, wrap = statement => ({ ...statement, bind(...values) { return wrap(statement.bind(...values)); }, async all() { return statement.execute(); } });
  DB.prepare = sql => wrap(prepare(sql));
  await ensureAuthSchema(DB); await ensurePaymentReceiptSchema(DB);
  const projects = [{ id: 'project', shortName: '26青信07/08', tranches: [
    { id: 'seven', shortName: '26青信07', securityCode: '', paymentDate: '2026-07-29', winningAmountWan: 10000 },
    { id: 'eight', shortName: '26青信08', securityCode: '', paymentDate: '2026-07-29', winningAmountWan: 5000 },
  ] }];
  DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({ projects, issuers: [] }));
  const storedState = DB.sql.prepare("SELECT data,revision FROM user_app_state WHERE user_id='admin'").get();
  await insertPaymentReceiptBatch(DB, { id: 'batch', ownerUserId: 'admin', messageId: 'message', receivedAt: NOW,
    receivedDate: '2026-07-29', rawObjectKey: 'original.eml', processingStatus: 'processed', createdAt: NOW });
  DB.sql.prepare("INSERT INTO payment_receipt_events(id,owner_user_id,batch_id,event_type,created_at) VALUES('extracted','admin','batch','email_attachments_extracted',?)").run(NOW);
  const pdf = await PDFDocument.create(), page = pdf.addPage([100, 100]);
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
  page.node.newXObject('Scan', pdf.context.register(pdf.context.stream(jpeg, { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2,
    ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' })));
  const bytes = await pdf.save({ useObjectStreams: false });
  await insertPaymentReceiptFile(DB, { id: 'file', batchId: 'batch', filename: 'notice.pdf', mimeType: 'application/pdf', byteSize: bytes.length,
    sha256: sha(bytes), objectKey: 'original.pdf', pageCount: 1, processingStatus: legacy ? 'processed' : 'queued', createdAt: NOW });
  const objects = new Map([['original.pdf', bytes], ['original.eml', new Uint8Array([1, 2, 3])]]), jobs = [];
  let aiCalls = 0, reverse = false;
  const env = { DB, AI_PROCESSING_APPROVED: 'true', RECEIPT_QUEUE: { async send(job) { jobs.push(job); } }, PAYMENT_RECEIPTS: {
    async get(key) { const value = objects.get(key); return value ? { body: value, arrayBuffer: async () => value } : null; },
    async put(key, value) { objects.set(key, value instanceof Uint8Array ? value.slice() : new Uint8Array(value)); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  }, AI: { provider: 'deepseek', model: 'mock-page-reader', async run() {
    aiCalls++;
    const allocations = reverse ? [...rows].reverse() : rows;
    return { response: { classification: 'receipt_start', confidence: .99, document_title: '配售确认及缴款通知书',
      bond_short_name: '26青信07', security_code: '245774.SH', payment_date: '2026-07-29', amount_text: '10000万元',
      ...(single ? {} : { allocations }) } };
  } } };
  if (legacy) {
    await insertPaymentReceipt(DB, { id: 'old-mixed', ownerUserId: 'admin', batchId: 'batch', fileId: 'file', sourcePages: [1], sourcePageLabel: '1',
      objectKey: 'receipts/old-mixed.pdf', sha256: 'old', bondShortName: '26青信07', securityCode: '245774.SH', amountFen: 5000000000,
      paymentDate: '2026-07-29', recognizedText: TEXT, recognitionStatus: 'recognized', matchStatus: 'review', createdAt: NOW });
    await insertPaymentReceiptMatch(DB, { id: 'old-match', ownerUserId: 'admin', receiptId: 'old-mixed', projectId: 'project', trancheId: 'eight', matchSource: 'auto', createdAt: NOW });
    objects.set('receipts/old-mixed.pdf', bytes);
  }
  const request = (handler, url, method, body, id = 'file') => handler({ env, params: { id }, request: new Request(ORIGIN + url, {
    method, headers: { Origin: ORIGIN }, ...(body ? { body: JSON.stringify(body) } : {}),
  }) });
  return { DB, env, objects, jobs, bytes, storedState, aiCalls: () => aiCalls, reverse() { reverse = true; },
    process: () => processPaymentReceiptFile(env, { ownerUserId: 'admin', batchId: 'batch', fileId: 'file', objectKey: 'original.pdf', receivedDate: '2026-07-29' }),
    async reprocess() { return request(reprocess, '/api/payment-receipt-files/file/reprocess', 'POST'); },
    async download(id) { return request(download, '/api/payment-receipts/' + id + '/file?download=1', 'GET', undefined, id); },
    async regroup() { const updatedAt = DB.sql.prepare("SELECT updated_at FROM payment_receipt_files WHERE id='file'").get().updated_at;
      return request(regroup, '/api/payment-receipt-files/file/regroup', 'POST', { groups: [[1]], blankPages: [], expectedUpdatedAt: updatedAt }); },
    receipts: () => DB.sql.prepare("SELECT * FROM payment_receipts WHERE file_id='file' ORDER BY source_page_label").all(),
    matches: () => DB.sql.prepare("SELECT * FROM payment_receipt_matches ORDER BY tranche_id").all(),
  };
}

test('one scanned page with two allocations creates two matching logical receipts and distinct fallback fingerprints', async t => {
  const h = await fixture(t), result = await h.process(), receipts = h.receipts();
  assert.equal(result.receiptIds.length, 2); assert.equal(h.aiCalls(), 1);
  assert.deepEqual(receipts.map(row => row.source_page_label), ['1#245774.SH', '1#245775.SH']);
  assert.deepEqual(receipts.map(row => JSON.parse(row.source_pages_json)), [[1], [1]]);
  assert.deepEqual(receipts.map(row => row.bond_short_name), ['26青信07', '26青信08']);
  assert.deepEqual(receipts.map(row => row.amount_fen), [10000000000, 5000000000]);
  assert.ok(receipts.every(row => row.payer_name === '' && row.match_status === 'matched'));
  assert.notEqual(receipts[0].id, receipts[1].id); assert.notEqual(receipts[0].sha256, receipts[1].sha256);
  assert.equal(h.matches().find(match => match.tranche_id === 'seven').receipt_id, receipts[0].id);
  assert.equal(h.matches().find(match => match.tranche_id === 'eight').receipt_id, receipts[1].id);
  assert.doesNotMatch(receipts[0].recognized_text, /245775|26青信08/);
  assert.doesNotMatch(receipts[1].recognized_text, /245774|26青信07/);
  for (const receipt of receipts) {
    const response = await h.download(receipt.id); assert.equal(response.status, 200);
    assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 1);
  }
  const grouping = JSON.parse(h.DB.sql.prepare("SELECT grouping_json FROM payment_receipt_files WHERE id='file'").get().grouping_json);
  assert.equal(grouping.groups.length, 1, 'physical page grouping is independent of the two allocation rows');
  assert.equal(sha(h.objects.get('original.pdf')), sha(h.bytes));
  assert.deepEqual(h.DB.sql.prepare("SELECT data,revision FROM user_app_state WHERE user_id='admin'").get(), h.storedState);
});

test('an explicit full rerun retains allocation IDs across row reorder without duplicate/unique conflicts', async t => {
  const h = await fixture(t); await h.process(); const ids = h.receipts().map(row => row.id).sort();
  h.reverse(); assert.equal((await h.reprocess()).status, 202); assert.equal(h.jobs.length, 1);
  await processPaymentReceiptFile(h.env, h.jobs[0]);
  assert.deepEqual(h.receipts().map(row => row.id).sort(), ids);
  assert.equal(h.receipts().length, 2); assert.equal(h.matches().length, 2);
  assert.ok(h.receipts().every(row => row.match_status === 'matched'));
  assert.ok(h.objects.has('original.pdf')); assert.ok(h.objects.has('original.eml'));
});

test('reprocessing an old mixed single row replaces it with the two correct logical rows and audit', async t => {
  const h = await fixture(t, { legacy: true });
  assert.equal((await h.reprocess()).status, 202);
  await processPaymentReceiptFile(h.env, h.jobs[0]);
  assert.equal(h.receipts().length, 2); assert.ok(h.receipts().every(row => row.id !== 'old-mixed'));
  assert.equal(h.matches().length, 2);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) count FROM payment_receipt_events WHERE event_type='file_reprocess_requested'").get().count, 1);
  assert.equal(h.objects.has('receipts/old-mixed.pdf'), false);
  assert.ok(h.objects.has('original.pdf'));
});

test('single-tranche notices retain the legacy receipt ID and page-label path', async t => {
  const h = await fixture(t, { single: true }); await h.process();
  assert.equal(h.receipts().length, 1);
  assert.equal(h.receipts()[0].id, 'receipt-' + sha(new TextEncoder().encode('file:1')).slice(0, 32));
  assert.equal(h.receipts()[0].source_page_label, '1');
});

test('manual regroup keeps both logical rows and both already-correct project correspondences', async t => {
  const h = await fixture(t); await h.process(); const ids = h.receipts().map(row => row.id).sort();
  const response = await h.regroup(); assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.receiptCount, 2); assert.equal(body.preservedMatchCount, 2);
  assert.deepEqual(h.receipts().map(row => row.id).sort(), ids); assert.equal(h.matches().length, 2);
  assert.deepEqual(body.groups, [[1]]);
  const grouping = JSON.parse(h.DB.sql.prepare("SELECT grouping_json FROM payment_receipt_files WHERE id='file'").get().grouping_json);
  assert.deepEqual(grouping.groups.map(group => group.pageNumbers), [[1]]);
});

test('manual regroup cannot transfer an old mixed-row correspondence to either new allocation', async t => {
  const h = await fixture(t, { legacy: true });
  h.DB.sql.prepare("UPDATE payment_receipt_files SET page_analysis_json=? WHERE id='file'").run(JSON.stringify([
    { pageNumber: 1, classification: 'receipt_start', confidence: .99, recognizedText: TEXT,
      fields: { bondShortName: '26青信07', securityCode: '245774.SH', amountFen: 5000000000, paymentDate: '2026-07-29' } },
  ]));
  const response = await h.regroup(); assert.equal(response.status, 200); const payload = await response.json();
  assert.equal(payload.receiptCount, 2); assert.equal(payload.preservedMatchCount, 0);
  assert.equal(h.matches().length, 0); assert.ok(h.receipts().every(row => row.id !== 'old-mixed'));
  assert.deepEqual(h.receipts().map(row => row.amount_fen), [10000000000, 5000000000]);
});

test('manual regroup retains each accepted identity on a shared page without borrowing the other tranche name', async t => {
  const h = await fixture(t); await h.process();
  const fileSha = h.DB.sql.prepare("SELECT sha256 FROM payment_receipt_files WHERE id='file'").get().sha256;
  const originals = h.receipts();
  for (const row of originals) {
    const evidence = { source: 'manual', status: 'verified', name: row.bond_short_name + '(人工核对)', code: row.security_code,
      expectedCode: row.security_code, editedBy: 'admin', reviewId: 'review-' + row.security_code, acceptedAt: NOW,
      pageNumber: 1, sourcePages: [1], fileId: 'file', fileSha256: fileSha, receiptSha256: row.sha256 };
    h.DB.sql.prepare("INSERT INTO payment_receipt_events(id,owner_user_id,receipt_id,batch_id,event_type,detail_json,created_at) VALUES(?,'admin',?,'batch','identity_name_manually_corrected',?,?)")
      .run(evidence.reviewId, row.id, JSON.stringify(evidence), NOW);
  }
  const response = await h.regroup(); assert.equal(response.status, 200); const payload = await response.json();
  for (const receipt of payload.receipts) {
    assert.equal(receipt.identityReview.name, receipt.bondShortName + '(人工核对)');
    assert.equal(receipt.identityReview.source, 'manual');
    const fetched = await getPaymentReceipt(h.DB, 'admin', receipt.id);
    assert.equal(fetched.identityReview.name, receipt.identityReview.name);
    assert.equal(fetched.identityReview.code, receipt.securityCode);
  }
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) count FROM payment_receipt_events WHERE event_type='identity_review_restored'").get().count, 2);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) count FROM payment_receipt_events WHERE event_type='identity_name_manually_corrected'").get().count, 2);
});

test('a failed multi-allocation regroup transaction restores both rows and matches and removes only uncommitted objects', async t => {
  const h = await fixture(t); await h.process();
  const receipts = h.receipts(), matches = h.matches(), objects = [...h.objects.keys()].sort();
  h.DB.setFail('UPDATE payment_receipt_batches');
  const response = await h.regroup(); assert.equal(response.status, 500); h.DB.setFail('');
  assert.deepEqual(h.receipts(), receipts); assert.deepEqual(h.matches(), matches);
  assert.deepEqual([...h.objects.keys()].sort(), objects);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) count FROM payment_receipt_events WHERE event_type='file_manually_regrouped'").get().count, 0);
  assert.equal(sha(h.objects.get('original.pdf')), sha(h.bytes));
});
