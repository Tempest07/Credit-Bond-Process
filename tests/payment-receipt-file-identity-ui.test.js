import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentReceiptFileIdentityReview } from '../payment-receipt-file-identity-ui.js';

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(payload) });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 160; index++) await Promise.resolve(); };
const action = init => init.body ? JSON.parse(init.body).action : 'pages';

function server() {
  const rows = ['r1', 'r2', 'r3'].map((id, index) => ({ id, fileId: 'file', fileUpdatedAt: 'v1', bondShortName: `旧简称${index + 1}` }));
  const readings = new Map(rows.map((row, index) => [row.id, { reviewId: `review-${row.id}`, cached: true,
    proposal: { status: 'verified', name: `26测试MTN00${index + 1}` } }]));
  const accepted = new Map(), batches = new Map(), closed = new Set();
  const receipt = id => ({ ...rows.find(row => row.id === id), ...(accepted.has(id) ? { identityReview: clone(accepted.get(id)) } : {}) });
  function handle(url, init) {
    if (url.endsWith('/pages')) return response({ file: { id: 'file', updatedAt: 'v1', processingStatus: 'review' }, receipts: clone(rows) });
    const body = JSON.parse(init.body || '{}');
    if (url.endsWith('/identity-review-undo')) {
      closed.add(body.fileReviewId);
      const changes = batches.get(body.fileReviewId) || [], receipts = [];
      let restoredCount = 0, skippedCount = 0;
      for (const change of changes) {
        if (accepted.get(change.id)?.reviewId === change.after.reviewId) {
          if (change.before) accepted.set(change.id, clone(change.before)); else accepted.delete(change.id);
          restoredCount++;
        } else skippedCount++;
        receipts.push(receipt(change.id));
      }
      return response({ ok: true, receipts, restoredCount, skippedCount });
    }
    const id = decodeURIComponent(url.match(/payment-receipts\/([^/]+)\/identity-review$/)?.[1] || '');
    if (!rows.some(row => row.id === id)) return response({ error: 'missing' }, 404);
    if (body.action === 'preview') return accepted.has(id)
      ? response({ reviewId: accepted.get(id).reviewId, proposal: accepted.get(id), receipt: receipt(id), cached: true })
      : response(readings.get(id));
    if (body.action === 'apply') {
      if (closed.has(body.fileReviewId)) return response({ error: 'run undone' }, 409);
      const before = clone(accepted.get(id)), after = { ...clone(readings.get(id).proposal), reviewId: `${body.fileReviewId}-${id}` };
      accepted.set(id, after);
      const changes = batches.get(body.fileReviewId) || []; changes.push({ id, before, after }); batches.set(body.fileReviewId, changes);
      return response({ ok: true, changed: true, receipt: receipt(id), fileReviewId: body.fileReviewId });
    }
    return response({ error: 'unexpected action' }, 400);
  }
  return { rows, readings, accepted, batches, handle };
}

function fixture(options = {}) {
  let context = { fileId: 'file', receiptId: 'r1', fileUpdatedAt: 'v1' }, run = 0;
  const requests = [], results = [], undos = [], notices = [], changes = [], listeners = new Map(), backend = server();
  const container = { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
    querySelectorAll: () => [], contains: () => true };
  const controller = createPaymentReceiptFileIdentityReview({ container, getContext: () => context,
    getHeaders: () => ({ 'X-Test-Auth': 'present' }), onResult: value => results.push(value), onUndo: value => undos.push(value),
    onStateChange: value => changes.push(value), onNotice: value => notices.push(value), reviewIdFactory: () => `batch-${++run}`,
    requestTimeoutMs: options.requestTimeoutMs || 1000,
    fetchImpl: async (url, init) => { requests.push({ url, init });
      return options.fetchImpl ? options.fetchImpl(url, init, requests.length, backend) : backend.handle(url, init); },
  });
  return { controller, requests, results, undos, notices, changes, listeners, backend, setContext: value => { context = value; } };
}

test('explicit file review reads every receipt and immediately adopts clear readings in serial order', async () => {
  const h = fixture();
  assert.match(h.controller.render({ fileId: 'file' }), /复核整份文件简称/); assert.equal(h.requests.length, 0);
  await h.controller.review();
  assert.deepEqual(h.requests.map(row => action(row.init)), ['pages', 'preview', 'apply', 'preview', 'apply', 'preview', 'apply']);
  assert.deepEqual(h.results.map(row => [row.receiptId, row.stage]), [['r1', 'apply'], ['r2', 'apply'], ['r3', 'apply']]);
  assert.equal(h.backend.accepted.size, 3, 'the current selected receipt does not restrict the whole-file list');
  for (const { init } of h.requests) {
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.headers['X-Test-Auth'], 'present');
    if (action(init) === 'preview') assert.deepEqual(JSON.parse(init.body), { action: 'preview', reuse: true });
    if (action(init) === 'apply') assert.equal(JSON.parse(init.body).fileReviewId, 'batch-1');
  }
  assert.match(h.controller.render({ fileId: 'file' }), /已更新 3 条/);
  assert.match(h.controller.render({ fileId: 'file' }), /撤销本次更新/);
});

test('conflicts and uncertain readings remain manual while clear names update without an adopt click', async () => {
  const h = fixture();
  h.backend.readings.set('r2', { proposal: { status: 'conflict', name: '', reason: 'literal_name_conflict' } });
  h.backend.readings.set('r3', { proposal: { status: 'unavailable', name: '', reason: 'uncertain_reading' } });
  await h.controller.review();
  assert.deepEqual([...h.backend.accepted.keys()], ['r1']);
  assert.deepEqual(h.results.map(row => row.stage), ['apply', 'preview', 'preview']);
  assert.equal(h.requests.filter(row => action(row.init) === 'apply').length, 1);
  assert.match(h.controller.render({ fileId: 'file' }), /待核对 2 条/);
});

test('existing accepted names are kept and one undo restores only this run without model requests', async () => {
  const h = fixture(), original = { status: 'verified', source: 'manual', name: '人工已定简称', reviewId: 'manual-old' };
  h.backend.accepted.set('r2', original);
  await h.controller.review();
  assert.deepEqual(h.results.map(row => row.stage), ['apply', 'retained', 'apply']);
  const count = h.requests.length;
  await h.controller.undo();
  assert.equal(h.requests.length, count + 1); assert.match(h.requests.at(-1).url, /identity-review-undo$/);
  assert.deepEqual(JSON.parse(h.requests.at(-1).init.body), { fileReviewId: 'batch-1' });
  assert.deepEqual([...h.backend.accepted], [['r2', original]]);
  assert.equal(h.undos[0].payload.restoredCount, 2);
  assert.ok(h.undos[0].payload.receipts.every(row => !Object.hasOwn(row, 'identityReview')), 'restore-to-raw explicitly omits accepted evidence');
  assert.doesNotMatch(h.controller.render({ fileId: 'file' }), /data-file-identity-action="undo"/);
  assert.doesNotMatch(h.controller.render({ fileId: 'file' }), /data-file-identity-action="review" disabled/, 'another file review remains available after undo');
});

test('undo keeps later manual changes and a no-op repeat preserves the previous undo run', async () => {
  const h = fixture(); await h.controller.review(); await h.controller.review();
  assert.equal(h.requests.filter(row => action(row.init) === 'apply').length, 3, 'cached accepted rows do not get adopted again');
  h.backend.accepted.set('r2', { status: 'verified', source: 'manual', name: '后来人工修改', reviewId: 'manual-new' });
  await h.controller.undo();
  assert.equal(JSON.parse(h.requests.at(-1).init.body).fileReviewId, 'batch-1');
  assert.equal(h.backend.accepted.get('r2').name, '后来人工修改'); assert.equal(h.backend.accepted.size, 1);
  assert.equal(h.undos[0].payload.skippedCount, 1); assert.equal(h.undos[0].payload.restoredCount, 2);
  assert.equal(h.undos[0].payload.receipts.find(row => row.id === 'r2').identityReview.source, 'manual');
});

test('review requests are serial and a duplicate click cannot begin a second batch', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: (url, init, count, backend) => count === 2 ? gate.promise : backend.handle(url, init) });
  const running = h.controller.review(); await flush();
  assert.equal(h.requests.length, 2); assert.equal(h.controller.isBusy('file'), true);
  await h.controller.review(); assert.equal(h.requests.length, 2);
  gate.resolve(h.backend.handle(h.requests[1].url, h.requests[1].init)); await running;
  assert.equal(h.results.length, 3); assert.equal(h.requests.length, 7);
});

test('an open single-record review or manual editor blocks another file-wide operation', async () => {
  const h = fixture(); h.setContext({ fileId: 'file', receiptId: 'r1', blocked: true });
  await h.controller.review(); assert.equal(h.requests.length, 0);
  h.setContext({ fileId: 'file', receiptId: 'r1', blocked: false }); await h.controller.review();
  h.setContext({ fileId: 'file', receiptId: 'r1', blocked: true }); await h.controller.undo();
  assert.equal(h.undos.length, 0); assert.match(h.controller.render({ fileId: 'file' }), /data-file-identity-action="undo" disabled/);
});

for (const status of [401, 403, 429, 504]) {
  test(`HTTP ${status} pauses later records but leaves completed updates undoable`, async () => {
    const h = fixture({ fetchImpl: (url, init, count, backend) => count === 4
      ? response({ error: 'PRIVATE_PROVIDER_SECRET_SHOULD_NOT_APPEAR' }, status) : backend.handle(url, init) });
    await h.controller.review();
    assert.equal(h.requests.length, 4); assert.equal(h.results.length, 1); assert.equal(h.controller.isBusy('file'), false);
    const html = h.controller.render({ fileId: 'file' }); assert.match(html, /暂停/); assert.match(html, /撤销本次更新/); assert.doesNotMatch(html, /PRIVATE_PROVIDER/);
    await h.controller.undo(); assert.equal(h.backend.accepted.size, 0);
  });
}

test('an apply conflict stays manual and does not prevent other clear records from updating', async () => {
  const h = fixture({ fetchImpl: (url, init, _count, backend) => url.includes('/r2/') && action(init) === 'apply'
    ? response({ error: 'changed by another editor' }, 409) : backend.handle(url, init) });
  await h.controller.review();
  assert.deepEqual([...h.backend.accepted.keys()], ['r1', 'r3']);
  assert.equal(h.results[1].payload.proposal.status, 'conflict'); assert.match(h.controller.render({ fileId: 'file' }), /待核对 1 条/);
});

test('cancel preserves a committed partial run for undo and ignores a late preview', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: (url, init, count, backend) => count === 4 ? gate.promise : backend.handle(url, init) });
  const running = h.controller.review(); await flush(); assert.equal(h.backend.accepted.size, 1);
  h.controller.cancel(); assert.equal(h.requests[3].init.signal.aborted, true);
  await h.controller.undo(); assert.equal(h.backend.accepted.size, 0);
  gate.resolve(response({ reviewId: 'late', proposal: { status: 'verified', name: 'late' } })); await running;
  assert.equal(h.results.length, 1); assert.equal(h.undos.length, 1);
});

test('a lost apply response still leaves its run id available to undo', async () => {
  const gate = deferred();
  const h = fixture({ fetchImpl: (url, init, count, backend) => {
    if (count === 3) { backend.handle(url, init); return gate.promise; }
    return backend.handle(url, init);
  } });
  const running = h.controller.review(); await flush(); assert.equal(h.backend.accepted.size, 1);
  h.controller.cancel(); await h.controller.undo(); assert.equal(h.backend.accepted.size, 0);
  gate.resolve(response({ changed: true, receipt: { id: 'r1', identityReview: { status: 'verified' } } })); await running;
  assert.equal(h.results.length, 0); assert.equal(h.undos[0].payload.restoredCount, 1);
});

test('navigation and file-version changes abort obsolete requests before any late adoption', async () => {
  for (const next of [{ fileId: '', receiptId: '' }, { fileId: 'file', fileUpdatedAt: 'v2' }]) {
    const gate = deferred(), h = fixture({ fetchImpl: (url, init, count, backend) => count === 2 ? gate.promise : backend.handle(url, init) });
    const running = h.controller.review(); await flush(); h.setContext(next); h.controller.sync();
    assert.equal(h.requests[1].init.signal.aborted, true); gate.resolve(response({ reviewId: 'late', proposal: { status: 'verified', name: 'late' } })); await running;
    assert.equal(h.results.length, 0); assert.equal(h.backend.accepted.size, 0);
  }
});

test('timeout and dispose terminate an uncooperative request without proceeding', async () => {
  const h = fixture({ requestTimeoutMs: 5, fetchImpl: (url, init, count, backend) => count === 2 ? new Promise(() => {}) : backend.handle(url, init) });
  await h.controller.review(); assert.equal(h.requests.length, 2); assert.equal(h.requests[1].init.signal.aborted, true);
  assert.match(h.controller.render({ fileId: 'file' }), /超时/);
  h.controller.dispose(); assert.equal(h.listeners.size, 0); assert.equal(h.controller.render({ fileId: 'file' }), '');
});

test('delegated review and undo header buttons use the same file-wide flow', async () => {
  const h = fixture(), section = { dataset: { fileIdentity: 'file' } };
  const click = value => h.listeners.get('click')({ target: { closest: () => ({ dataset: { fileIdentityAction: value }, closest: () => section }) } });
  click('review'); await flush(); assert.equal(h.results.length, 3);
  click('undo'); await flush(); assert.equal(h.undos.length, 1); assert.equal(h.backend.accepted.size, 0);
  h.controller.clear(); assert.doesNotMatch(h.controller.render({ fileId: 'file' }), /data-file-identity-action="undo"/);
});
