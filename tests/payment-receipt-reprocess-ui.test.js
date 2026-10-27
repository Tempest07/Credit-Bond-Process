import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('async function reprocessPaymentReceiptFile(');
const end = app.indexOf('\nasync function ', start + 1);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

function harness(base, { conflict = false } = {}) {
  const fileId = 'file one/part';
  const requests = [], notices = [], mutations = [];
  let renders = 0;
  const receipt = { id: 'receipt-1', fileId, bondShortName: '26测试MTN001', amountYuan: 30000000 };
  const other = { id: 'receipt-other', fileId: 'other-file' };
  const context = vm.createContext({
    paymentReceipts: [receipt, other],
    paymentReceiptPendingFiles: [{ id: fileId, filename: 'original.pdf' }, { id: 'other-file' }],
    authHeaders: () => ({ 'X-Test-Auth': 'test-only' }),
    async fetch(input, options) {
      const url = new URL(input, base);
      requests.push({ url, options });
      const expected = new URL(`./api/payment-receipt-files/${encodeURIComponent(fileId)}/reprocess`, base);
      if (url.href !== expected.href) return { ok: false, status: 405, json: async () => ({}) };
      if (conflict) return { ok: false, status: 409, json: async () => ({ error: '已有人工确认的项目对应' }) };
      return { ok: true, status: 202, json: async () => ({ processingStatus: 'reprocess_requested' }) };
    },
    applyLocalPaymentReceiptMutation: value => mutations.push(value),
    renderPaymentReceiptArchive: () => { renders++; },
    showToast: value => notices.push(value),
  });
  vm.runInContext(source, context);
  return { context, fileId, receipt, requests, notices, mutations, get renders() { return renders; } };
}

for (const base of ['https://tempest07.com/bond-centre/', 'http://127.0.0.1:8838/']) {
  test(`reprocess reaches the product API from ${base}`, async () => {
    const h = harness(base), button = { disabled: false };
    await h.context.reprocessPaymentReceiptFile(h.fileId, button);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].options.method, 'POST');
    assert.equal(h.requests[0].options.credentials, 'same-origin');
    assert.equal(h.requests[0].options.headers['X-Test-Auth'], 'test-only');
    assert.equal(h.mutations.length, 1, h.notices.join('; '));
    assert.equal(h.renders, 1);
    assert.equal(h.mutations[0].receipts.length, 1);
    assert.equal(h.mutations[0].receipts[0].bondShortName, h.receipt.bondShortName);
    assert.equal(h.mutations[0].receipts[0].amountYuan, h.receipt.amountYuan);
    assert.equal(h.context.paymentReceiptPendingFiles[0].filename, 'original.pdf');
    assert.equal(h.context.paymentReceiptPendingFiles[1].processingStatus, undefined);
    assert.ok(h.notices[0].startsWith('已申请重新识别'));
  });
}

test('a rejected reprocess retains local receipt data and allows retry', async () => {
  const h = harness('https://tempest07.com/bond-centre/', { conflict: true });
  const button = { disabled: false };
  await h.context.reprocessPaymentReceiptFile(h.fileId, button);
  assert.equal(h.mutations.length, 0);
  assert.equal(h.renders, 0);
  assert.equal(button.disabled, false);
  assert.equal(h.context.paymentReceiptPendingFiles[0].processingStatus, undefined);
  assert.match(h.notices[0], /已有人工确认的项目对应/);
});
