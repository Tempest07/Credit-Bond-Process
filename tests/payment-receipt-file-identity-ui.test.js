import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentReceiptFileIdentityReview } from '../payment-receipt-file-identity-ui.js';

const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const pages = { file: { id: 'file', updatedAt: 'v1', processingStatus: 'review' }, receipts: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] };
const result = (status = 'verified') => ({ reviewId: 'review', cached: true, proposal: { status, name: status === 'verified' ? '26测试MTN001' : '' } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function fixture(options = {}) {
  let context = { fileId: 'file', receiptId: 'r1' };
  const requests = [], results = [], notices = [], changes = [], listeners = new Map();
  const container = { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
    querySelectorAll: () => [], contains: () => true };
  const controller = createPaymentReceiptFileIdentityReview({ container, getContext: () => context,
    getHeaders: () => ({ 'X-Test-Auth': 'present' }), onResult: value => results.push(value),
    onStateChange: value => changes.push(value), onNotice: value => notices.push(value),
    requestTimeoutMs: options.requestTimeoutMs || 1000,
    fetchImpl: async (url, init) => { requests.push({ url, init });
      return options.fetchImpl ? options.fetchImpl(url, init, requests.length) : response(url.endsWith('/pages') ? pages : result()); },
  });
  return { controller, requests, results, notices, changes, listeners, setContext: value => { context = value; } };
}

test('rendering is free; explicit whole-file review reads every file receipt and only requests reusable suggestions', async () => {
  const h = fixture();
  assert.match(h.controller.render({ fileId: 'file' }), /复核整份文件简称/); assert.equal(h.requests.length, 0);
  await h.controller.review('file');
  assert.deepEqual(h.requests.map(row => row.url), ['./api/payment-receipt-files/file/pages',
    ...['r1', 'r2', 'r3'].map(id => `./api/payment-receipts/${id}/identity-review`)]);
  assert.deepEqual(h.results.map(row => row.receiptId), ['r1', 'r2', 'r3'], 'the current filtered selection cannot restrict the file list');
  for (const { init } of h.requests.slice(1)) {
    assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers['X-Test-Auth'], 'present'); assert.deepEqual(JSON.parse(init.body), { action: 'preview', reuse: true });
  }
  assert.ok(h.results.every(row => row.fileId === 'file' && row.fileUpdatedAt === 'v1'));
  assert.match(h.controller.render({ fileId: 'file' }), /已复核 3\/3 条/);
  assert.equal(h.controller.isBusy('file'), false);
  await h.controller.review('file');
  assert.equal(h.requests.length, 8, 'another click checks the server cache rather than treating a local session as durable cache');
});

test('reviews are serial and a second click cannot start another batch', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: (url, _init, count) => url.endsWith('/pages') ? response(pages)
    : count === 2 ? gate.promise : response(result()) });
  const running = h.controller.review('file'); await flush();
  assert.equal(h.requests.length, 2); assert.equal(h.controller.isBusy('file'), true);
  await h.controller.review('file'); assert.equal(h.requests.length, 2);
  gate.resolve(response(result())); await running;
  assert.equal(h.results.length, 3); assert.equal(h.requests.length, 4);
});

test('a single-receipt review or open manual editor blocks a whole-file batch', async () => {
  const h = fixture(); h.setContext({ fileId: 'file', receiptId: 'r1', blocked: true });
  assert.match(h.controller.render({ fileId: 'file' }), /data-file-identity-action="review" disabled/);
  await h.controller.review(); assert.equal(h.requests.length, 0); assert.equal(h.results.length, 0);
  h.setContext({ fileId: 'file', receiptId: 'r1', blocked: false });
  await h.controller.review(); assert.equal(h.results.length, 3);
});

for (const status of [401, 403, 429, 504]) {
  test(`HTTP ${status} stops subsequent items while retaining completed suggestions`, async () => {
    const h = fixture({ fetchImpl: (url, _init, count) => response(url.endsWith('/pages') ? pages : count === 2 ? result()
      : { error: 'PRIVATE_PROVIDER_SECRET_SHOULD_NOT_APPEAR' }, count > 2 ? status : 200) });
    await h.controller.review();
    assert.equal(h.requests.length, 3); assert.equal(h.results.length, 1); assert.equal(h.controller.isBusy('file'), false);
    const html = h.controller.render({ fileId: 'file' });
    assert.match(html, /已复核 1\/3 条/); assert.match(html, /暂停/); assert.doesNotMatch(html, /PRIVATE_PROVIDER/);
  });
}

test('explicit cancel aborts the request and ignores a late response without proceeding', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: url => url.endsWith('/pages') ? response(pages) : gate.promise });
  const running = h.controller.review(); await flush(); h.controller.cancel();
  assert.equal(h.requests[1].init.signal.aborted, true); assert.equal(h.controller.isBusy('file'), false);
  gate.resolve(response(result())); await running;
  assert.equal(h.results.length, 0); assert.equal(h.requests.length, 2); assert.match(h.controller.render({ fileId: 'file' }), /已暂停/);
});

test('sync cancels immediately when navigation leaves the file, including an empty detail pane', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: url => url.endsWith('/pages') ? response(pages) : gate.promise });
  const running = h.controller.review(); await flush(); h.setContext({ fileId: '', receiptId: '' }); h.controller.sync();
  assert.equal(h.requests[1].init.signal.aborted, true); assert.equal(h.controller.isBusy('file'), false);
  gate.resolve(response(result())); await running; assert.equal(h.results.length, 0);
});

test('file version changes invalidate a pending result even when the selected file id stays the same', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: url => url.endsWith('/pages') ? response(pages) : gate.promise });
  const running = h.controller.review(); await flush();
  h.setContext({ fileId: 'file', fileUpdatedAt: 'v2' }); h.controller.render({ fileId: 'file' });
  gate.resolve(response(result())); await running;
  assert.equal(h.results.length, 0); assert.equal(h.controller.isBusy('file'), false);
});

test('timeout stops an uncooperative pending fetch instead of hanging or continuing to the next receipt', async () => {
  const h = fixture({ requestTimeoutMs: 5, fetchImpl: url => url.endsWith('/pages') ? response(pages) : new Promise(() => {}) });
  await h.controller.review();
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].init.signal.aborted, true);
  assert.equal(h.results.length, 0); assert.match(h.controller.render({ fileId: 'file' }), /超时/);
});

test('unavailable or conflicting readings remain suggestions and are never adopted by the file controller', async () => {
  const statuses = ['verified', 'conflict', 'unavailable'];
  const h = fixture({ fetchImpl: (url, _init, count) => response(url.endsWith('/pages') ? pages : result(statuses[count - 2])) });
  await h.controller.review();
  assert.equal(h.results.length, 3); assert.match(h.controller.render({ fileId: 'file' }), /1 条可核对 · 2 条需人工核对/);
  assert.ok(h.requests.every(row => row.init.method === 'GET' || JSON.parse(row.init.body).action === 'preview'));
});

test('the delegated header button starts a batch and clear/dispose cancel without stale callbacks', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: url => url.endsWith('/pages') ? response(pages) : gate.promise });
  const section = { dataset: { fileIdentity: 'file' } };
  const button = { dataset: { fileIdentityAction: 'review' }, closest: selector => selector === '[data-file-identity]' ? section : null };
  h.listeners.get('click')({ target: { closest: () => button } }); await flush();
  assert.equal(h.requests.length, 2); h.controller.dispose(); gate.resolve(response(result())); await flush();
  assert.equal(h.results.length, 0); assert.equal(h.listeners.size, 0); assert.equal(h.controller.render({ fileId: 'file' }), '');
});
