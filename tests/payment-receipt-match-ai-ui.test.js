import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentReceiptMatchAiController } from '../payment-receipt-match-ai-ui.js';

function harness() {
  const receipt = { id: 'r1', updatedAt: 'v1', matchStatus: 'review' }, calls = [], selected = [], notices = [];
  const body = { hidden: true, innerHTML: '' }, toggle = { setAttribute() {}, textContent: '' };
  const section = { dataset: { receiptMatchAi: 'r1' }, querySelector: selector => selector === '[data-match-ai-content]' ? body : toggle };
  const handlers = new Map();
  const container = { addEventListener(type, fn) { handlers.set(type, fn); }, removeEventListener(type) { handlers.delete(type); },
    querySelectorAll() { return [section]; }, contains(node) { return node === section; } };
  const payload = { ok: true, receiptId: 'r1', expectedUpdatedAt: 'v1', inputFingerprint: 'fingerprint', cached: false, recommendations: [
    { projectId: 'p1', trancheId: 't1', shortName: '26测试CP001', paymentDate: '2026-10-27', paymentCompleted: false,
      reason: '请核对代码和简称', evidence: [{ receiptLabel: '债券代码', receiptQuote: '042600001.IB', candidateLabel: '债券代码', candidateQuote: '042600001.IB' }] },
  ], warnings: [] };
  let handler = async () => Response.json(payload), selectionHandler = () => {};
  const controller = createPaymentReceiptMatchAiController({ container, getReceipt: id => id === receipt.id ? receipt : null,
    getHeaders: () => ({ 'X-Test-Auth': 'token' }), fetchImpl: async (url, input) => { calls.push({ url, input }); return handler(url, input); },
    onSelectCandidate: value => { selected.push(value); return selectionHandler(value); }, onNotice: value => notices.push(value) });
  async function click(action, index = '0') {
    const button = { dataset: { matchAiAction: action, matchAiIndex: index }, closest: () => section };
    return handlers.get('click')?.({ target: { closest: () => button } });
  }
  return { receipt, controller, body, toggle, calls, selected, notices, payload, click,
    setHandler(value) { handler = value; }, setSelection(value) { selectionHandler = value; } };
}

test('rendering is idle; explicit expansion is single-flight and selecting only invokes manual-toolbar callback', async () => {
  const h = harness();
  const initial = h.controller.render(h.receipt);
  assert.match(initial, /智能推荐/); assert.match(initial, /aria-expanded="false"/); assert.equal(h.calls.length, 0);
  await h.click('toggle');
  assert.equal(h.calls.length, 1); assert.equal(h.body.hidden, false);
  assert.equal(h.calls[0].url, './api/payment-receipts/r1/match-review');
  assert.equal(h.calls[0].input.method, 'POST');
  assert.equal(h.calls[0].input.headers['X-Test-Auth'], 'token');
  assert.deepEqual(JSON.parse(h.calls[0].input.body), { expectedUpdatedAt: 'v1' });
  assert.match(h.body.innerHTML, /选择后仍需人工确认/);
  await h.click('toggle'); assert.equal(h.body.hidden, true);
  await h.click('toggle'); assert.equal(h.calls.length, 1);
  await h.click('select');
  assert.deepEqual(h.selected, [{ receiptId: 'r1', projectId: 'p1', trancheId: 't1', expectedUpdatedAt: 'v1', inputFingerprint: 'fingerprint' }]);
  assert.match(h.notices[0], /确认对应/); assert.equal(h.calls.length, 1);
});

test('closing/reopening a pending recommendation does not spend another request', async () => {
  const h = harness(); let release;
  h.setHandler(() => new Promise(resolve => { release = () => resolve(Response.json(h.payload)); }));
  const first = h.click('toggle');
  await h.click('toggle'); await h.click('toggle');
  assert.equal(h.calls.length, 1); assert.match(h.body.innerHTML, /正在核对/);
  release(); await first; assert.match(h.body.innerHTML, /26测试CP001/);
});

test('a changed receipt version aborts cached work and late replies cannot replace current recommendations', async () => {
  const h = harness(); let release;
  h.setHandler(() => new Promise(resolve => { release = () => resolve(Response.json(h.payload)); }));
  const first = h.click('toggle'); h.receipt.updatedAt = 'v2';
  assert.doesNotMatch(h.controller.render(h.receipt), /26测试CP001/);
  assert.equal(h.calls[0].input.signal.aborted, true);
  release(); await first; await h.click('select');
  assert.equal(h.selected.length, 0);
});

test('errors require an explicit retry and malformed or foreign-receipt responses cannot be selected', async () => {
  const h = harness();
  h.setHandler(async () => Response.json({ error: '请求过于频繁，请稍后重试。' }, { status: 429 }));
  await h.click('toggle'); assert.equal(h.calls.length, 1); assert.match(h.body.innerHTML, /重试推荐/);
  h.setHandler(async () => Response.json({ ...h.payload, receiptId: 'another' }));
  await h.click('retry'); await h.click('select');
  assert.equal(h.selected.length, 0); assert.match(h.body.innerHTML, /结果不完整/);
  h.setHandler(async () => Response.json(h.payload));
  await h.click('retry'); assert.equal(h.calls.length, 3); assert.match(h.body.innerHTML, /26测试CP001/);
});

test('all recommendation and evidence text is escaped, and rejecting stale selection produces no success notice', async () => {
  const h = harness();
  h.payload.recommendations[0].shortName = '<img src=x onerror=alert(1)>';
  h.payload.recommendations[0].reason = '<script>bad()</script>';
  h.payload.recommendations[0].evidence[0].receiptQuote = '<svg onload=bad()>';
  h.payload.warnings = ['<b>warning</b>'];
  await h.click('toggle');
  assert.doesNotMatch(h.body.innerHTML, /<img|<script|<svg|<b>/);
  assert.match(h.body.innerHTML, /&lt;script&gt;/);
  h.setSelection(() => false); await h.click('select'); assert.equal(h.notices.length, 0);
});

test('logout/dispose clears visible private advice, cancels work and ignores late responses', async () => {
  const h = harness(); let release;
  h.setHandler(() => new Promise(resolve => { release = () => resolve(Response.json(h.payload)); }));
  const first = h.click('toggle'); h.controller.clear();
  assert.equal(h.calls[0].input.signal.aborted, true); assert.equal(h.body.hidden, true); assert.equal(h.body.innerHTML, '');
  release(); await first; assert.equal(h.body.innerHTML, '');
  h.controller.dispose(); await h.click('toggle'); assert.equal(h.calls.length, 1);
});
