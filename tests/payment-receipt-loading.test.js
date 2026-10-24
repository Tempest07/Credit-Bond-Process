import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyPaymentReceiptArchiveMutation, applyPaymentReceiptCoverageMutation } from '../payment-receipts.js';
import { paymentReceiptReaderEntries, paymentReceiptReaderSelection } from '../payment-receipt-reader.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function load(context, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function |\nvoid initialize\(/);
  vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const receipt = (id, extra = {}) => ({ id, fileId: 'f-' + id, matchStatus: 'unmatched', paymentDate: '2026-10-24', ...extra });
const coverage = (extra = {}) => ({ expected: 1, covered: 0, missing: 1,
  targets: [{ projectId: 'p', trancheId: 't', shortName: '测试券', covered: false, receiptId: '' }], ...extra });
const archive = (receipts, extra = {}) => ({ receipts, pendingFiles: [], pendingBatches: [], ...extra });

function harness() {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', disabled: false, hidden: false,
      attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
    return nodes.get(selector);
  };
  const archives = [], coverages = [], notices = [], previews = [];
  const context = vm.createContext({
    $, $$: () => [], AbortController, structuredClone,
    paymentReceipts: [receipt('old')], paymentReceiptPendingFiles: [], paymentReceiptPendingBatches: [],
    paymentReceiptCoverage: coverage(), paymentReceiptCoverageFilter: 'all',
    paymentReceiptsLoading: false, paymentReceiptCoverageLoading: false,
    paymentReceiptsError: '', paymentReceiptCoverageError: '',
    paymentReceiptArchiveController: null, paymentReceiptArchiveRequestId: 0,
    paymentReceiptArchiveFilterKey: JSON.stringify(['', '']), paymentReceiptLoadMutations: [],
    paymentReceiptIndexView: 'all', selectedPaymentReceiptEntryKey: 'receipt:old',
    selectedProjectId: '', projectPaymentReceiptCache: new Map(),
    applyPaymentReceiptArchiveMutation, applyPaymentReceiptCoverageMutation,
    paymentReceiptReaderEntries, paymentReceiptReaderSelection,
    renderPaymentReceiptIndexItem: entry => `<button>${entry.key}</button>`,
    renderPaymentReceiptInspector(entry) { previews.push(entry?.key || null); },
    syncProjectPaymentReceiptCaches() {}, loadProjectPaymentReceipts() {},
    showToast: value => notices.push(value),
    fetchPaymentReceiptArchivePages(args) { const request = { ...deferred(), args }; archives.push(request); return request.promise; },
    fetchPaymentReceiptCoverage(date, signal) { const request = { ...deferred(), date, signal }; coverages.push(request); return request.promise; },
  });
  for (const name of ['escapeHtml', 'escapeAttribute', 'renderPaymentReceiptArchive', 'renderPaymentReceiptCoverage',
    'applyLocalPaymentReceiptMutation', 'loadPaymentReceipts']) load(context, name);
  return { context, $, archives, coverages, notices, previews };
}

test('archive and coverage start together, and a ready archive does not wait for coverage', async () => {
  const h = harness();
  const pending = h.context.loadPaymentReceipts();
  let finished = false;
  pending.then(() => { finished = true; });
  assert.equal(h.archives.length, 1);
  assert.equal(h.coverages.length, 1);
  assert.equal(h.context.selectedPaymentReceiptEntryKey, 'receipt:old');
  assert.match(h.$('#paymentReceiptArchive').innerHTML, /receipt:old/);
  assert.equal(h.previews.includes(null), false, 'refresh must not clear the displayed original');
  h.archives[0].resolve(archive([receipt('old', { bondShortName: '新资料' }), receipt('new')]));
  await flush();
  assert.equal(h.context.paymentReceiptsLoading, false);
  assert.equal(h.context.paymentReceiptCoverageLoading, true);
  assert.match(h.$('#paymentReceiptArchive').innerHTML, /receipt:new/);
  assert.equal(h.context.selectedPaymentReceiptEntryKey, 'receipt:old');
  assert.equal(finished, false);
  h.coverages[0].resolve(coverage());
  await pending;
  assert.equal(h.context.paymentReceiptCoverageLoading, false);
  assert.equal(h.context.paymentReceiptArchiveController, null);
});

test('changing filters clears the old receipt and original while late cancelled results cannot replace the new view', async () => {
  for (const lateFailure of [false, true]) {
    const h = harness();
    h.$('#paymentReceiptDateFilter').value = '2026-10-23';
    const oldLoad = h.context.loadPaymentReceipts();
    assert.equal(h.context.paymentReceipts.length, 0);
    assert.equal(h.context.selectedPaymentReceiptEntryKey, '');
    assert.equal(h.previews.at(-1), null);
    h.$('#paymentReceiptDateFilter').value = '2026-10-24';
    const newLoad = h.context.loadPaymentReceipts();
    assert.equal(h.archives[0].args.signal.aborted, true);
    h.archives[1].resolve(archive([receipt('new')]));
    h.coverages[1].resolve(coverage());
    await newLoad;
    const current = JSON.stringify([h.context.paymentReceipts, h.context.paymentReceiptCoverage]);
    if (lateFailure) h.archives[0].reject(new Error('旧请求错误'));
    else h.archives[0].resolve(archive([receipt('late')]));
    h.coverages[0].resolve(coverage({ expected: 99 }));
    await oldLoad;
    assert.equal(JSON.stringify([h.context.paymentReceipts, h.context.paymentReceiptCoverage]), current);
    assert.equal(h.context.selectedPaymentReceiptEntryKey, 'receipt:new');
    assert.equal(h.context.paymentReceiptsLoading, false);
    assert.equal(h.context.paymentReceiptCoverageLoading, false);
    assert.equal(h.notices.some(value => value.includes('旧请求错误')), false);
  }
});

test('manual assignment survives stale archive and coverage responses in either completion order', async () => {
  for (const first of ['neither', 'archive', 'coverage']) {
    const h = harness();
    const pending = h.context.loadPaymentReceipts({ silent: true });
    if (first === 'archive') { h.archives[0].resolve(archive([receipt('old')])); await flush(); }
    if (first === 'coverage') { h.coverages[0].resolve(coverage()); await flush(); }
    const assigned = receipt('old', { matchStatus: 'matched', projectId: 'p', trancheId: 't', matchSource: 'manual' });
    h.context.applyLocalPaymentReceiptMutation({ removedReceiptIds: ['old', 'old'], receipts: [assigned] });
    assert.equal(h.context.paymentReceiptLoadMutations.length, 1);
    assigned.projectId = 'mutated-after-capture';
    if (first !== 'archive') h.archives[0].resolve(archive([receipt('old')]));
    if (first !== 'coverage') h.coverages[0].resolve(coverage());
    await pending;
    assert.equal(h.context.paymentReceipts[0].matchStatus, 'matched', first);
    // A response that completed before the edit cannot replace it later. A still-pending
    // response must replay the immutable saved mutation rather than the edited object.
    if (first !== 'archive') assert.equal(h.context.paymentReceipts[0].projectId, 'p', first);
    assert.equal(h.context.paymentReceiptCoverage.targets[0].covered, true, first);
    assert.equal(h.context.paymentReceiptCoverage.targets[0].receiptId, 'old', first);
    assert.equal(h.context.paymentReceiptLoadMutations.length, 0);
  }
});

test('multiple local edits replay in order and remove deleted originals from late pending-file lists', async () => {
  const h = harness();
  const pending = h.context.loadPaymentReceipts({ silent: true });
  h.context.applyLocalPaymentReceiptMutation({ removedReceiptIds: ['old'],
    receipts: [receipt('old', { matchStatus: 'matched', projectId: 'p', trancheId: 't' })] });
  h.context.applyLocalPaymentReceiptMutation({ removedReceiptIds: ['old'], receipts: [receipt('old')] });
  h.context.applyLocalPaymentReceiptMutation({ removedReceiptIds: ['deleted'], removedFileIds: ['deleted-file'] });
  h.archives[0].resolve(archive([receipt('old'), receipt('deleted', { fileId: 'deleted-file' })], {
    pendingFiles: [{ id: 'deleted-file' }, { id: 'retained-file' }],
  }));
  h.coverages[0].resolve(coverage({ covered: 1, missing: 0,
    targets: [{ projectId: 'p', trancheId: 't', covered: true, receiptId: 'old' }] }));
  await pending;
  assert.deepEqual(plain(h.context.paymentReceipts.map(value => value.id)), ['old']);
  assert.equal(h.context.paymentReceipts[0].matchStatus, 'unmatched');
  assert.deepEqual(plain(h.context.paymentReceiptPendingFiles.map(value => value.id)), ['retained-file']);
  assert.equal(h.context.paymentReceiptCoverage.targets[0].covered, false);
  assert.equal(h.context.paymentReceiptCoverage.covered, 0);
  assert.equal(h.context.paymentReceiptCoverage.missing, 1);
});

test('replayed assignments respect the active date and status filters', async () => {
  const h = harness();
  h.$('#paymentReceiptStatusFilter').value = 'unmatched';
  h.context.paymentReceiptArchiveFilterKey = JSON.stringify(['', 'unmatched']);
  const pending = h.context.loadPaymentReceipts({ silent: true });
  h.context.applyLocalPaymentReceiptMutation({ removedReceiptIds: ['old'],
    receipts: [receipt('old', { matchStatus: 'matched', projectId: 'p', trancheId: 't' })] });
  h.archives[0].resolve(archive([receipt('old')]));
  h.coverages[0].resolve(coverage());
  await pending;
  assert.equal(h.context.paymentReceipts.length, 0);
  assert.equal(h.context.selectedPaymentReceiptEntryKey, '');
  assert.equal(h.context.paymentReceiptCoverage.covered, 1);
});

test('archive and coverage failures stay independent and a same-filter refresh failure retains the selected original', async () => {
  const h = harness();
  const pending = h.context.loadPaymentReceipts();
  h.archives[0].reject(new Error('归档暂不可用'));
  h.coverages[0].resolve(coverage({ covered: 1, missing: 0,
    targets: [{ projectId: 'p', trancheId: 't', covered: true, receiptId: 'old' }] }));
  await pending;
  assert.equal(h.context.paymentReceipts[0].id, 'old');
  assert.equal(h.context.selectedPaymentReceiptEntryKey, 'receipt:old');
  assert.equal(h.previews.includes(null), false);
  assert.equal(h.context.paymentReceiptCoverage.covered, 1);
  assert.equal(h.context.paymentReceiptCoverageError, '');
  assert.match(h.context.paymentReceiptsError, /归档暂不可用/);
  const retry = h.context.loadPaymentReceipts();
  h.archives[1].resolve(archive([receipt('new')]));
  h.coverages[1].reject(new Error('对账暂不可用'));
  await retry;
  assert.equal(h.context.paymentReceipts[0].id, 'new');
  assert.equal(h.context.paymentReceiptsError, '');
  assert.match(h.context.paymentReceiptCoverageError, /对账暂不可用/);
});

function pagingHarness(fetch) {
  const calls = { logout: 0, redirect: 0 };
  const context = vm.createContext({ fetch, URLSearchParams, PAYMENT_RECEIPTS_URL: './api/payment-receipts', authHeaders: () => ({}),
    clearAuthSession() { calls.logout++; }, redirectToGatewayLogin() { calls.redirect++; } });
  load(context, 'fetchPaymentReceiptArchivePages');
  return { context, calls };
}

test('554 receipts use two 500-row requests while all receipt, file and batch IDs remain deduplicated', async () => {
  const requested = [];
  const first = Array.from({ length: 500 }, (_, index) => receipt(String(index)));
  const rest = [first[499], ...Array.from({ length: 54 }, (_, index) => receipt(String(index + 500)))];
  const h = pagingHarness(async url => {
    const parsed = new URL(url, 'http://localhost/');
    requested.push(Object.fromEntries(parsed.searchParams));
    return Response.json(archive(requested.length === 1 ? first : rest, {
      pendingFiles: [{ id: 'file' }, { id: 'file' }], pendingBatches: [{ id: 'batch' }],
    }));
  });
  const result = await h.context.fetchPaymentReceiptArchivePages({ date: '2026-10-24', status: 'review' });
  assert.deepEqual(requested.map(value => [value.limit, value.offset]), [['500', '0'], ['500', '500']]);
  assert.ok(requested.every(value => value.date === '2026-10-24' && value.status === 'review'));
  assert.equal(result.receipts.length, 554);
  assert.equal(result.pendingFiles.length, 1);
  assert.equal(result.pendingBatches.length, 1);
});

test('repeating full pages fail safely rather than looping indefinitely', async () => {
  let calls = 0;
  const receipts = Array.from({ length: 500 }, (_, index) => receipt(String(index)));
  const h = pagingHarness(async () => { calls++; return Response.json(archive(receipts)); });
  await assert.rejects(h.context.fetchPaymentReceiptArchivePages(), /分页未推进/);
  assert.equal(calls, 2);
});

test('an aborted late 401 cannot clear authentication or redirect a newer request', async () => {
  const response = deferred();
  const controller = new AbortController();
  const h = pagingHarness(() => response.promise);
  const pending = h.context.fetchPaymentReceiptArchivePages({ signal: controller.signal });
  controller.abort();
  response.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 }));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(h.calls, { logout: 0, redirect: 0 });
  const current = pagingHarness(async () => Response.json({ error: 'Unauthorized' }, { status: 401 }));
  await assert.rejects(current.context.fetchPaymentReceiptArchivePages(), /Unauthorized/);
  assert.deepEqual(current.calls, { logout: 1, redirect: 1 });
});
