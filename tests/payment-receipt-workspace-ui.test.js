import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPaymentReceiptWorkspace, receiptRebuildActive, receiptRebuildProgress } from '../payment-receipt-workspace-ui.js';

const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return structuredClone(payload); } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
const activeJob = (extra = {}) => ({ id: 'job', status: 'processing', totalFiles: 3, completedFiles: 0, failedFiles: 0, files: [], ...extra });
const data = (count = 4) => Array.from({ length: count }, (_, index) => ({ id: `r${index + 1}`, fileId: `file-${Math.floor(index / 2)}` }));

function fixture(t, options = {}) {
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = options.confirm || (() => true);
  t.after(() => { if (oldConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = oldConfirm; });
  let receipts = options.receipts || data(), nextTimer = 0;
  const nodes = new Map(), listeners = new Map(), timers = new Map(), requests = [], mutations = [], notices = [], refreshes = [];
  const classes = () => { const set = new Set(); return { toggle(name, value) { value ? set.add(name) : set.delete(name); }, contains(name) { return set.has(name); } }; };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', hidden: false, disabled: false, checked: false,
      value: 0, dataset: {}, attributes: {}, classList: classes(), setAttribute(name, value) { this.attributes[name] = value; } });
    return nodes.get(selector);
  };
  const checkboxes = receipts.map(row => ({ ...node('checkbox:' + row.id), dataset: { receiptSelect: row.id } }));
  const root = { classList: classes(), querySelector: node,
    querySelectorAll(selector) { return selector === '[data-receipt-select]' ? checkboxes : selector.split(', ').map(node); },
    addEventListener(name, handler) { listeners.set(name, handler); }, removeEventListener(name) { listeners.delete(name); },
  };
  const controller = createPaymentReceiptWorkspace({ root, getReceipts: () => receipts,
    getVisibleReceipts: () => options.visible ? options.visible(receipts) : receipts,
    getSelectedReceipt: () => receipts[0], getHeaders: () => ({ 'X-Test': 'auth' }),
    onMutation(mutation) { mutations.push(mutation); receipts = receipts.filter(row => !mutation.removedReceiptIds.includes(row.id)); },
    onRefresh() { refreshes.push(true); }, onToast(value) { notices.push(value); },
    setTimer(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    async fetch(url, init) { requests.push({ url, init }); return options.fetch ? options.fetch(url, init, requests.length) : response({ rebuild: null }); },
  });
  t.after(() => controller.destroy());
  controller.render();
  function click(selector) { listeners.get('click')({ target: { closest(value) { return selector === value ? node(selector) : null; } } }); }
  function change(id, checked) { listeners.get('change')({ target: { dataset: { receiptSelect: id }, checked } }); }
  return { controller, node, root, checkboxes, requests, mutations, notices, refreshes, timers, listeners, click, change,
    replaceReceipts(value) { receipts = value; }, runTimer(delay) { const found = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(found, `timer ${delay}`); timers.delete(found[0]); found[1].callback(); } };
}

test('progress honors success/failure counters and both durable terminal statuses', () => {
  assert.equal(receiptRebuildActive(null), false);
  assert.equal(receiptRebuildActive(activeJob()), true);
  for (const status of ['completed', 'completed_with_errors']) assert.equal(receiptRebuildActive(activeJob({ status })), false);
  let value = receiptRebuildProgress(activeJob({ totalFiles: 4, completedFiles: 1, failedFiles: 1,
    files: [{ status: 'queued', filename: 'later.pdf' }, { status: 'processing', filename: 'working.pdf' }], totalPages: 10, completedPages: 5 }));
  assert.equal(value.percent, 50);
  assert.match(value.title, /2 \/ 4/);
  assert.equal(value.detail, 'working.pdf · 5 / 10 页');
  value = receiptRebuildProgress(activeJob({ status: 'completed_with_errors', totalFiles: 3, completedFiles: 2, failedFiles: 1,
    receiptCount: 12, matchedCount: 5, reviewCount: 2 }));
  assert.equal(value.percent, 100);
  assert.equal(value.active, false);
  assert.match(value.title, /1 份需重试/);
  assert.equal(value.detail, '12 张单据 · 5 张已对应 · 2 张待核对');
});

test('selection supports visible rows, the entire selected file, individual rows and pruning stale IDs', t => {
  const h = fixture(t, { visible: rows => [rows[0], rows[2]] });
  h.click('[data-receipt-manage]');
  assert.equal(h.root.classList.contains('is-receipt-selecting'), true);
  assert.equal(h.node('[data-receipt-selection-bar]').hidden, false);
  h.click('[data-receipt-select-visible]');
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 2 张');
  h.click('[data-receipt-select-file]');
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 3 张');
  h.change('r4', true);
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 4 张');
  h.replaceReceipts(data().slice(1)); h.controller.render();
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 3 张');
  h.click('[data-receipt-clear-selection]');
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 0 张');
  assert.equal(h.node('[data-receipt-delete-selected]').disabled, true);
  h.click('[data-receipt-manage]');
  assert.equal(h.node('[data-receipt-selection-bar]').hidden, true);
});

test('rebuild clicks immediately show busy progress and serialize duplicate requests', async t => {
  const gate = deferred(), h = fixture(t, { fetch: () => gate.promise });
  h.click('[data-receipt-rebuild-all]');
  assert.equal(h.requests.length, 1);
  assert.equal(h.node('[data-receipt-rebuild-all]').disabled, true);
  assert.equal(h.node('[data-receipt-job]').hidden, false);
  assert.equal(h.node('[data-receipt-job]').attributes['aria-busy'], 'true');
  assert.match(h.node('[data-receipt-job-title]').textContent, /正在提交/);
  assert.equal(h.node('[data-receipt-job]').classList.contains('is-running'), true);
  await h.controller.rebuildAll();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { all: true });
  gate.resolve(response({ rebuild: activeJob() })); await flush();
  assert.match(h.node('[data-receipt-job-title]').textContent, /0 \/ 3/);
  assert.equal(h.refreshes.length, 1);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 4000), true);
});

test('single-file rebuilds use the durable job endpoint and never start an unrelated file', async t => {
  const h = fixture(t, { fetch: () => response({ rebuild: activeJob({ totalFiles: 1 }) }) });
  await h.controller.rebuildFiles(['file-a', 'file-a']);
  assert.equal(h.requests[0].url, './api/payment-receipt-rebuild');
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { fileIds: ['file-a'] });
  assert.equal(h.requests[0].init.headers['X-Test'], 'auth');
  assert.equal(h.requests[0].init.credentials, 'same-origin');
  assert.ok(h.requests[0].init.signal instanceof AbortSignal);
});

test('reload restores durable progress, refreshes completed files and stops polling after partial errors', async t => {
  const h = fixture(t, { fetch: (_url, _init, count) => response({ rebuild: activeJob(count === 1 ? {} :
    { status: 'completed_with_errors', completedFiles: 2, failedFiles: 1, receiptCount: 11, matchedCount: 4 }) }) });
  await h.controller.refreshJob();
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.node('[data-receipt-job]').hidden, false);
  h.runTimer(4000); await flush();
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.node('[data-receipt-job-progress]').value, 100);
  assert.equal(h.node('[data-receipt-job]').attributes['aria-busy'], 'false');
  assert.equal(h.node('[data-receipt-rebuild-all]').disabled, false);
  assert.equal(h.requests[1].url, './api/payment-receipt-rebuild?id=job');
  assert.equal([...h.timers.values()].some(timer => timer.delay === 4000), false);
});

test('finished OCR keeps polling through settlement and refreshes the final project correspondences', async t => {
  const h = fixture(t, { fetch: (_url, _init, count) => response({ rebuild: activeJob({ status: 'completed',
    completedFiles: 3, finalized: count > 1, finalizing: count === 1, receiptCount: 12, matchedCount: count === 1 ? 0 : 4 }) }) });
  await h.controller.refreshJob();
  assert.equal(h.node('[data-receipt-job-progress]').value, 99);
  assert.equal(h.node('[data-receipt-job-detail]').textContent, '正在对应项目并整理重复件');
  assert.equal(h.node('[data-receipt-rebuild-all]').disabled, true);
  h.runTimer(4000); await flush();
  assert.equal(h.node('[data-receipt-job-progress]').value, 100);
  assert.equal(h.refreshes.length, 1);
  assert.match(h.node('[data-receipt-job-detail]').textContent, /4 张已对应/);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 4000), false);
});

test('bulk deletion shows immediate progress and makes sequential chunks of at most 100', async t => {
  const gate = deferred(), h = fixture(t, { receipts: data(205), fetch: (_url, init, count) => count === 1 ? gate.promise
    : response({ receiptIds: JSON.parse(init.body).receiptIds }) });
  h.click('[data-receipt-manage]'); h.click('[data-receipt-select-visible]');
  const running = h.controller.deleteReceipts(data(205).map(row => row.id));
  assert.equal(h.requests.length, 1);
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '正在删除 0 / 205 张…');
  assert.equal(h.node('[data-receipt-delete-selected]').disabled, true);
  assert.ok(h.checkboxes.every(row => row.disabled));
  await h.controller.deleteReceipts(['r1']); assert.equal(h.requests.length, 1);
  gate.resolve(response({ receiptIds: data(100).map(row => row.id) })); await running;
  assert.deepEqual(h.requests.map(row => JSON.parse(row.init.body).receiptIds.length), [100, 100, 5]);
  assert.equal(h.mutations.flatMap(row => row.removedReceiptIds).length, 205);
  assert.equal(h.notices.at(-1), '已删除 205 张单据。');
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 0 张');
});

test('partial deletion retains unresolved selections and stops after the first failed chunk', async t => {
  const h = fixture(t, { receipts: data(205), fetch: (_url, init, count) => count === 1
    ? response({ receiptIds: JSON.parse(init.body).receiptIds }) : response({ error: '原件正在处理' }, 409) });
  h.click('[data-receipt-manage]'); h.click('[data-receipt-select-visible]');
  await h.controller.deleteReceipts(data(205).map(row => row.id));
  assert.equal(h.requests.length, 2);
  assert.equal(h.mutations.length, 1);
  assert.equal(h.mutations[0].removedReceiptIds.length, 100);
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 105 张');
  assert.equal(h.node('[data-receipt-delete-selected]').disabled, false);
  assert.match(h.notices.at(-1), /已删除 100 张；删除失败：原件正在处理/);
  assert.equal(h.refreshes.length, 1);
});

test('cancelled deletion or stale unavailable rows cause no API calls', async t => {
  const h = fixture(t, { confirm: () => false });
  await h.controller.deleteReceipts(['r1']);
  await h.controller.deleteReceipts(['not-present']);
  assert.equal(h.requests.length, 0);
  assert.equal(h.mutations.length, 0);
});

test('logout aborts an old progress request and ignores even a late successful response', async t => {
  const gate = deferred(), h = fixture(t, { fetch: () => gate.promise });
  const running = h.controller.refreshJob();
  h.controller.reset();
  assert.equal(h.requests[0].init.signal.aborted, true);
  gate.resolve(response({ rebuild: activeJob() })); await running;
  assert.equal(h.node('[data-receipt-job]').hidden, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.refreshes.length, 0);
});

test('logout prevents an old rebuild success or failure from affecting a new session', async t => {
  const first = deferred(), second = deferred(), h = fixture(t, { fetch: (_url, _init, count) => count === 1 ? first.promise : second.promise });
  const oldRun = h.controller.rebuildAll(); h.controller.reset();
  assert.equal(h.requests[0].init.signal.aborted, true);
  const newRun = h.controller.rebuildFiles(['new-file']);
  assert.equal(h.requests.length, 2);
  first.reject(new Error('old session failure')); await oldRun;
  assert.equal(h.notices.length, 0);
  assert.equal(h.node('[data-receipt-rebuild-all]').disabled, true);
  second.resolve(response({ rebuild: activeJob({ id: 'new-job', totalFiles: 1 }) })); await newRun;
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.notices.length, 1);
  await h.controller.refreshJob();
  assert.match(h.requests.at(-1).url, /id=new-job/);
});

test('logout interrupts chunked deletion without mutating or notifying the new session', async t => {
  const gate = deferred(), h = fixture(t, { receipts: data(205), fetch: () => gate.promise });
  const oldRun = h.controller.deleteReceipts(data(205).map(row => row.id));
  h.controller.reset();
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.node('[data-receipt-selection-count]').textContent, '已选 0 张');
  gate.resolve(response({ receiptIds: data(100).map(row => row.id) })); await oldRun;
  assert.equal(h.requests.length, 1);
  assert.equal(h.mutations.length, 0);
  assert.equal(h.notices.length, 0);
});

test('mutation failure clears busy state, renders the error and allows a later retry', async t => {
  const h = fixture(t, { fetch: (_url, _init, count) => count === 1 ? response({ error: '暂时不可用' }, 503) : response({ rebuild: activeJob() }) });
  await h.controller.rebuildAll();
  assert.equal(h.node('[data-receipt-job-title]').textContent, '提交失败');
  assert.equal(h.node('[data-receipt-job-detail]').textContent, '暂时不可用');
  assert.equal(h.node('[data-receipt-job]').attributes['aria-busy'], 'false');
  assert.equal(h.node('[data-receipt-rebuild-all]').disabled, false);
  await h.controller.rebuildAll();
  assert.equal(h.requests.length, 2);
  assert.match(h.node('[data-receipt-job-title]').textContent, /0 \/ 3/);
});

test('mutation timeout releases the button and preserves explicit recovery feedback', async t => {
  const h = fixture(t, { fetch: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')));
  }) });
  const running = h.controller.rebuildAll();
  h.runTimer(30000); await running;
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.node('[data-receipt-rebuild-all]').disabled, false);
  assert.equal(h.node('[data-receipt-job]').attributes['aria-busy'], 'false');
  assert.match(h.node('[data-receipt-job-detail]').textContent, /请求超时/);
  assert.equal(h.timers.size, 0);
});

test('temporary polling failure retains the task and retries with visible reconnect feedback', async t => {
  const h = fixture(t, { fetch: (_url, _init, count) => count === 1
    ? response({ rebuild: activeJob() }) : Promise.reject(new Error('offline')) });
  await h.controller.refreshJob();
  h.runTimer(4000); await flush();
  assert.equal(h.node('[data-receipt-job]').hidden, false);
  assert.equal(h.node('[data-receipt-job-detail]').textContent, '进度暂未更新，正在重连…');
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 4000).length, 1);
});

test('destroyed controllers abort mutations and cannot initiate further work', async t => {
  const gate = deferred(), h = fixture(t, { fetch: () => gate.promise });
  const running = h.controller.rebuildAll(); h.controller.destroy();
  assert.equal(h.requests[0].init.signal.aborted, true);
  gate.resolve(response({ rebuild: activeJob() })); await running;
  await h.controller.rebuildAll(); await h.controller.deleteReceipts(['r1']); await h.controller.refreshJob();
  assert.equal(h.requests.length, 1);
  assert.equal(h.notices.length, 0);
  assert.equal(h.listeners.size, 0);
});

test('the reader reprocess button delegates to durable file jobs with immediate busy feedback', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function reprocessPaymentReceiptFile(');
  assert.ok(start >= 0);
  const end = source.indexOf('\nasync function ', start + 1);
  const gate = deferred(), calls = [], context = vm.createContext({
    paymentReceiptWorkspace: { rebuildFiles(ids) { calls.push(ids); return gate.promise; } },
  });
  vm.runInContext(source.slice(start, end), context);
  const button = { disabled: false, textContent: '重新识别', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const running = context.reprocessPaymentReceiptFile('one-file', button);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '正在提交…');
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['one-file']]);
  gate.resolve(); await running;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '重新识别');
  assert.equal(button.attributes['aria-busy'], 'false');
});
