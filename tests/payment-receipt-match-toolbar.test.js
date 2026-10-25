import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPaymentReceiptNameResolver } from '../payment-receipt-name-display.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function load(context, names) {
  for (const name of names) {
    const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    const rest = app.slice(start), end = rest.slice(1).search(/\n(?:async )?function |\nvoid initialize\(/);
    vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
  }
}
function harness() {
  const state = { projects: [
    { id: 'p1', shortName: '26测试MTN001', issuerName: '甲公司', tranches: [{ id: 't1', shortName: '26测试MTN001', paymentDate: '2026-10-15', paymentCompleted: false }] },
    { id: 'p2', shortName: '26测试CP002', issuerName: '乙公司', tranches: [{ id: 't2', shortName: '26测试CP002', paymentDate: '2026-10-23', paymentCompleted: true }] },
  ] };
  const context = vm.createContext({ state, createPaymentReceiptNameResolver, paymentReceiptNameResolverCache: null, paymentReceiptIdentityReviews: new Map() });
  load(context, ['paymentReceiptNameResolution', 'paymentReceiptNameSourceLabel', 'renderPaymentReceiptQuickMatch', 'renderPaymentReceiptIdentityReviewContent', 'paymentReceiptTargetOptions', 'paymentReceiptTarget', 'renderPaymentReceiptCandidates', 'escapeHtml', 'escapeAttribute']);
  return { context, state };
}

test('quick matching is immediately available for an unassigned receipt without switching detail tabs', () => {
  const { context } = harness();
  const html = context.renderPaymentReceiptQuickMatch({ id: 'r1', matchStatus: 'review', paymentDate: '2026-10-15', candidates: [{ projectId: 'p1', trancheId: 't1', shortName: '26测试MTN001' }] });
  assert.match(html, /data-receipt-target-search/);
  assert.match(html, /<select data-receipt-target/);
  assert.match(html, /data-receipt-assign="r1"[^>]*disabled/);
  assert.match(html, /data-receipt-match="r1" data-project-id="p1" data-tranche-id="t1"/);
  assert.doesNotMatch(html, /data-receipt-show-fields/);
});

test('assigned receipts expose their exact tranche, correction and unlink, while invalid receipts cannot be assigned', () => {
  const { context, state } = harness();
  const before = JSON.stringify(state);
  const html = context.renderPaymentReceiptQuickMatch({ id: 'r1', matchStatus: 'matched', projectId: 'p1', trancheId: 't1' });
  assert.match(html, /data-receipt-open-project="p1"/);
  assert.match(html, /更正对应/);
  assert.match(html, /data-receipt-unlink="r1"/);
  assert.match(html, /value="\[&quot;p1&quot;,&quot;t1&quot;\]" selected/);
  for (const matchStatus of ['duplicate', 'error']) assert.doesNotMatch(context.renderPaymentReceiptQuickMatch({ id: 'r1', matchStatus }), /data-receipt-assign|data-receipt-match|data-receipt-unlink/);
  assert.equal(JSON.stringify(state), before);
});

test('target search narrows by project, issuer or date and keeps same-day targets first', () => {
  const { context } = harness();
  const receipt = { paymentDate: '2026-10-15' };
  const all = context.paymentReceiptTargetOptions(receipt);
  assert.ok(all.indexOf('p1') < all.indexOf('p2'));
  assert.doesNotMatch(context.paymentReceiptTargetOptions(receipt, '乙公司'), /p1/);
  assert.match(context.paymentReceiptTargetOptions(receipt, '乙公司'), /p2/);
  assert.match(context.paymentReceiptTargetOptions(receipt, 'mtn001'), /p1/);
  assert.match(context.paymentReceiptTargetOptions(receipt, '26 测试 MTN001'), /p1/);
  assert.doesNotMatch(context.paymentReceiptTargetOptions(receipt, '2026-10-15'), /p2/);
});

test('receipt names use canonical tranche data without hiding conflicting recognition or changing saved fields', () => {
  const { context, state } = harness();
  Object.assign(state.projects[0].tranches[0], { shortName: '26越秀租赁MTN002B(绿色)', securityCode: '102683999.IB' });
  const receipt = { id: 'r1', bondShortName: '26 越秀租 MTN002B', securityCode: '102683999', matchStatus: 'matched', projectId: 'p1', trancheId: 't1' };
  const before = JSON.stringify({ state, receipt });
  load(context, ['paymentReceiptEntryTitle', 'renderPaymentReceiptIndexItem', 'paymentReceiptStatusBadge', 'paymentReceiptStatusLabel']);
  context.selectedPaymentReceiptEntryKey = '';
  context.formatPaymentReceiptAmount = () => '';
  const entry = { kind: 'receipt', key: 'receipt:r1', value: receipt };
  assert.equal(context.paymentReceiptEntryTitle(entry), '26越秀租赁MTN002B(绿色)');
  assert.match(context.renderPaymentReceiptIndexItem(entry), /原识别：26 越秀租 MTN002B/);
  const conflict = { ...receipt, securityCode: '102600001' };
  assert.match(context.renderPaymentReceiptIndexItem({ ...entry, value: conflict }), /简称待核对/);
  assert.match(context.renderPaymentReceiptQuickMatch(conflict), /payment-receipt-name-warning/);
  assert.equal(JSON.stringify({ state, receipt }), before);
  state.projects[0].tranches[0].shortName = '26越秀租赁MTN002B';
  state.updatedAt = 'changed';
  assert.equal(context.paymentReceiptEntryTitle(entry), '26越秀租赁MTN002B');
});

test('original preview has its own matching controls and unchanged refreshes preserve an in-progress selection', () => {
  const { context } = harness();
  const nodes = new Map();
  context.$ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', hidden: false, disabled: false, setAttribute() {} });
    return nodes.get(selector);
  };
  Object.assign(context, {
    paymentReceiptsLoading: false, paymentReceiptsError: '', paymentReceiptInspectorSignature: '', paymentReceiptDetailTab: 'original',
    paymentReceiptReaderPreview: () => ({ url: './api/file' }), paymentReceiptEmailUrl: () => './email',
    setPaymentReceiptDetailTab: tab => assert.equal(tab, 'original'),
  });
  load(context, ['renderPaymentReceiptInspector', 'paymentReceiptEntryTitle', 'paymentReceiptStatusBadge', 'paymentReceiptStatusLabel']);
  const entry = { key: 'receipt:r1', kind: 'receipt', value: { id: 'r1', bondShortName: '26测试MTN001', matchStatus: 'review' } };
  context.renderPaymentReceiptInspector(entry);
  assert.equal(context.$('#paymentReceiptMatchToolbar').hidden, false);
  assert.match(context.$('#paymentReceiptMatchToolbar').innerHTML, /确认对应/);
  assert.equal(context.$('#paymentReceiptFieldsPane').innerHTML, '');
  context.$('#paymentReceiptMatchToolbar').innerHTML = 'unfinished target selection';
  context.renderPaymentReceiptInspector(structuredClone(entry));
  assert.equal(context.$('#paymentReceiptMatchToolbar').innerHTML, 'unfinished target selection');
  context.renderPaymentReceiptInspector({ ...entry, value: { ...entry.value, projectId: 'p1', trancheId: 't1', matchStatus: 'matched' } });
  assert.match(context.$('#paymentReceiptMatchToolbar').innerHTML, /更正对应/);
});

test('confirm uses the selected project and tranche through the existing API without changing payment state', async () => {
  const { context, state } = harness();
  const before = JSON.stringify(state), calls = [], mutations = [], messages = [];
  const receipt = { id: 'r/1', matchStatus: 'review', candidates: [] };
  const select = { value: JSON.stringify(['p1', 't1']) };
  const controls = { disabled: false, querySelector: () => select };
  const button = { dataset: { receiptAssign: receipt.id }, disabled: false, closest: () => controls };
  Object.assign(context, {
    paymentReceipts: [receipt], PAYMENT_RECEIPTS_URL: './api/payment-receipts', authHeaders: () => ({}),
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ receipt: { ...receipt, projectId: 'p1', trancheId: 't1', matchStatus: 'matched' } }) }; },
    applyLocalPaymentReceiptMutation: value => mutations.push(value), showToast: value => messages.push(value),
  });
  load(context, ['handlePaymentReceiptArchiveClick']);
  const pending = context.handlePaymentReceiptArchiveClick({ target: { closest: () => button } });
  assert.equal(controls.disabled, true);
  await context.handlePaymentReceiptArchiveClick({ target: { closest: () => button } });
  await pending;
  assert.equal(controls.disabled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, './api/payment-receipts/r%2F1');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { projectId: 'p1', trancheId: 't1' });
  assert.equal(mutations[0].receipts[0].matchStatus, 'matched');
  assert.match(messages[0], /缴款状态未改变/);
  assert.equal(JSON.stringify(state), before);
});
