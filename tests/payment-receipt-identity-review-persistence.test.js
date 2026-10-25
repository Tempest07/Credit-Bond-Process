import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentReceiptFromRow } from '../functions/api/_payment-receipts.js';

function fixture() {
  const review = { status: 'verified', name: '26苏交通CP008', code: '042680338', pageNumber: 9,
    readings: { nameField: '26 苏交通 CP008', remittanceName: '26 苏交通 CP008', securityCode: '042680338', uncertainties: [] },
    receiptSha256: 'receipt-hash', fileSha256: 'source-hash', fileId: 'source', sourcePages: [9, 10, 11],
    originalName: '26 苏交 CP008', model: 'test-vision', reviewId: 'review', acceptedAt: '2026-10-25T15:00:00Z' };
  const row = { id: 'receipt', file_id: 'source', sha256: 'receipt-hash', source_file_sha256: 'source-hash',
    source_pages_json: '[9,10,11]', bond_short_name: '26 苏交 CP008', security_code: '042680338',
    recognized_text: '原始识别全文保持不变', amount_fen: 42000000000, payment_date: '2026-10-15',
    match_status: 'matched', project_id: 'original-project', tranche_id: 'original-tranche',
    identity_review_json: JSON.stringify(review) };
  return { row, review };
}

test('accepted name review is a separate traceable value and never rewrites historical OCR or matching fields', () => {
  const { row } = fixture();
  const before = JSON.stringify(row);
  const mapped = paymentReceiptFromRow(row);
  assert.equal(mapped.identityReview.name, '26苏交通CP008');
  assert.equal(mapped.identityReview.pageNumber, 9);
  assert.equal(mapped.bondShortName, '26 苏交 CP008');
  assert.equal(mapped.recognizedText, row.recognized_text);
  assert.equal(mapped.amountFen, row.amount_fen);
  assert.equal(mapped.paymentDate, row.payment_date);
  assert.equal(mapped.projectId, row.project_id);
  assert.equal(mapped.trancheId, row.tranche_id);
  assert.equal(mapped.matchStatus, row.match_status);
  assert.equal(mapped.identityReview.receiptSha256, undefined, 'internal source evidence is not part of the public receipt');
  assert.equal(JSON.stringify(row), before);
});

test('a different source object, page group, receipt fingerprint or code invalidates an older review', () => {
  const { row, review } = fixture();
  for (const change of [{ sha256: 'different-receipt' }, { source_file_sha256: 'different-source' },
    { source_pages_json: '[9]' }, { security_code: '032680566' }, { security_code: '042680338.SZ' }]) {
    const source = { ...row, ...change };
    if (change.security_code?.endsWith('.SZ')) {
      source.identity_review_json = JSON.stringify({ ...review, code: '042680338.IB',
        readings: { ...review.readings, securityCode: '042680338.IB' } });
    }
    assert.equal(paymentReceiptFromRow(source).identityReview, undefined, JSON.stringify(change));
  }
});

test('unaccepted, malformed and contradictory evidence is never promoted to a verified name', () => {
  const { row, review } = fixture();
  for (const value of [null, {}, { ...review, status: 'proposed' }, { ...review, pageNumber: 10 },
    { ...review, fileId: 'other-file' }, { ...review, name: '26苏交通SCP008' },
    { ...review, readings: { ...review.readings, remittanceName: '26苏交通SCP008' } },
    { ...review, readings: { ...review.readings, uncertainties: ['字迹不清'] } },
    { ...review, readings: { ...review.readings, securityCode: '032680566' } }]) {
    assert.equal(paymentReceiptFromRow({ ...row, identity_review_json: JSON.stringify(value) }).identityReview, undefined);
  }
  assert.equal(paymentReceiptFromRow({ ...row, identity_review_json: '{broken' }).identityReview, undefined);
});

test('older receipts with no accepted review retain their existing serialization', () => {
  const mapped = paymentReceiptFromRow({ bond_short_name: '26测试MTN001' });
  assert.equal(Object.hasOwn(mapped, 'identityReview'), false);
  assert.equal(mapped.bondShortName, '26测试MTN001');
});
