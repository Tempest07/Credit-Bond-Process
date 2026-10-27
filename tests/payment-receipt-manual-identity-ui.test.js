import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentReceiptManualIdentityEdit } from '../payment-receipt-manual-identity-ui.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const saved = (id = 'r1', name = '26苏交通CP008') => ({ ok: true,
  identityReview: { status: 'verified', source: 'manual', name }, receipt: { id, identityReview: { status: 'verified', source: 'manual', name } } });
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function fixture(options = {}) {
  const receipts = { r1: { id: 'r1', fileId: 'file', updatedAt: 'v1', fileUpdatedAt: 'fv1', bondShortName: '26苏交CP008', amountFen: 42000000000,
    identityReview: { status: 'verified', name: '26苏交通CP008' } },
  r2: { id: 'r2', fileId: 'file', updatedAt: 'v2', fileUpdatedAt: 'fv1', bondShortName: '26其他MTN001' } };
  const requests = [], saves = [], changes = [], notices = [], listeners = new Map(), sections = new Map();
  let blocked = false;
  for (const id of ['r1', 'r2']) {
    const section = { dataset: { manualIdentity: id }, innerHTML: '' };
    const error = { textContent: '' };
    const input = { value: '', focus() {}, select() {}, matches: selector => selector === '[data-manual-identity-name]', closest: selector => selector === '[data-manual-identity]' ? section : null };
    section.input = input; section.querySelector = selector => selector === '[data-manual-identity-name]' ? input : error;
    sections.set(id, section);
  }
  const container = { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
    querySelectorAll: () => [...sections.values()], contains: () => true };
  const controller = createPaymentReceiptManualIdentityEdit({ container, getReceipt: id => receipts[id], isBlocked: () => blocked,
    getHeaders: () => ({ 'X-Test-Auth': 'present' }), onSaved: value => saves.push(value), onStateChange: value => changes.push(value),
    onNotice: value => notices.push(value), requestTimeoutMs: options.requestTimeoutMs || 1000,
    fetchImpl: async (url, init) => { requests.push({ url, init }); return options.fetchImpl ? options.fetchImpl(url, init) : response(saved()); } });
  controller.render(receipts.r1);
  return { controller, receipts, requests, saves, notices, changes, listeners, sections,
    block: value => { blocked = value; },
    input(value, id = 'r1') { const target = sections.get(id).input; target.value = value; listeners.get('input')({ target }); },
    action(action, id = 'r1') {
      const button = { dataset: { manualIdentityAction: action } }, section = sections.get(id);
      const target = { closest: selector => selector === '[data-manual-identity-action]' ? button : selector === '[data-manual-identity]' ? section : null };
      listeners.get('click')({ target });
    },
  };
}

test('editing starts from the accepted name and saves only manual name evidence with the source version', async () => {
  const h = fixture(), before = JSON.stringify(h.receipts);
  h.controller.edit('r1');
  assert.equal(h.requests.length, 0); assert.equal(h.controller.isEditing('file'), true);
  assert.match(h.controller.render(h.receipts.r1), /value="26苏交通CP008"/);
  h.input('26苏交通CP008(绿色)');
  await h.controller.save('r1');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, './api/payment-receipts/r1/identity-review');
  assert.equal(h.requests[0].init.credentials, 'same-origin'); assert.equal(h.requests[0].init.headers['X-Test-Auth'], 'present');
  assert.deepEqual(JSON.parse(h.requests[0].init.body), { action: 'manual', name: '26苏交通CP008(绿色)', expectedUpdatedAt: 'v1',
    expectedFileUpdatedAt: 'fv1', expectedIdentityReviewId: '' });
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0].receiptId, 'r1');
  assert.equal(JSON.stringify(h.receipts), before, 'the controller never rewrites raw receipt data');
  assert.equal(h.controller.isEditing('file'), false); assert.equal(h.controller.isBusy('file'), false);
});

test('canceling an inline edit makes no request and releases the bulk-review lock', () => {
  const h = fixture(); h.action('edit'); h.input('26新的CP008'); h.action('cancel');
  assert.equal(h.requests.length, 0); assert.equal(h.saves.length, 0); assert.equal(h.controller.isEditing('file'), false);
  assert.doesNotMatch(h.controller.render(h.receipts.r1), /data-manual-identity-name/);
});

test('failed saves keep the typed name and permit a later explicit retry', async () => {
  let count = 0;
  const h = fixture({ fetchImpl: () => ++count === 1 ? response({ error: '暂时无法保存，请重试' }, 503) : response(saved()) });
  h.controller.edit(); h.input('26苏交通CP008(绿色)'); await h.controller.save();
  assert.equal(h.saves.length, 0); assert.equal(h.controller.isEditing('file'), true);
  assert.match(h.controller.render(h.receipts.r1), /value="26苏交通CP008\(绿色\)"/);
  assert.match(h.controller.render(h.receipts.r1), /暂时无法保存/);
  await h.controller.save(); assert.equal(h.requests.length, 2); assert.equal(h.saves.length, 1);
});

test('saving is single-flight and switching receipts aborts and suppresses a late save response', async () => {
  const gate = deferred(); const h = fixture({ fetchImpl: () => gate.promise });
  h.controller.edit(); h.input('26苏交通CP008'); const pending = h.controller.save();
  await h.controller.save(); assert.equal(h.requests.length, 1); assert.equal(h.controller.isBusy('file'), true);
  h.controller.render(h.receipts.r2); assert.equal(h.requests[0].init.signal.aborted, true);
  gate.resolve(response(saved())); await pending;
  assert.equal(h.saves.length, 0); assert.equal(h.controller.isBusy('file'), false); assert.equal(h.controller.isEditing('file'), false);
});

test('source changes and an empty detail pane invalidate editing and saving state', async () => {
  const gate = deferred(); const h = fixture({ fetchImpl: () => gate.promise });
  h.controller.edit(); const pending = h.controller.save();
  h.receipts.r1.updatedAt = 'v2'; h.controller.sync('r1');
  assert.equal(h.requests[0].init.signal.aborted, true); gate.resolve(response(saved())); await pending;
  assert.equal(h.saves.length, 0); assert.equal(h.controller.isEditing('file'), false);
  h.controller.edit(); assert.equal(h.controller.isEditing('file'), true); h.controller.sync('');
  assert.equal(h.controller.isEditing('file'), false);
});

for (const update of [{ fileUpdatedAt: 'fv2' }, { identityReview: { status: 'verified', name: '26新的CP008', reviewId: 'new-review' } }]) {
  test(`file or adopted identity changes suppress late manual replies: ${JSON.stringify(update)}`, async () => {
    const gate = deferred(); const h = fixture({ fetchImpl: () => gate.promise });
    h.controller.edit(); const pending = h.controller.save(); Object.assign(h.receipts.r1, update);
    h.controller.sync('r1'); assert.equal(h.requests[0].init.signal.aborted, true);
    gate.resolve(response(saved())); await pending; assert.equal(h.saves.length, 0); assert.equal(h.controller.isEditing('file'), false);
  });
}

test('bulk or single-receipt requests block editing and saving without discarding an unsaved input', async () => {
  const h = fixture(); h.block(true);
  assert.match(h.controller.render(h.receipts.r1), /data-manual-identity-action="edit" disabled/);
  h.controller.edit(); assert.equal(h.controller.isEditing('file'), false);
  h.block(false); h.controller.edit(); h.input('26苏交通CP008'); h.block(true); await h.controller.save();
  assert.equal(h.requests.length, 0); assert.equal(h.controller.isEditing('file'), true);
});

test('unreliable successful payloads are not accepted and preserve the editor', async () => {
  const h = fixture({ fetchImpl: () => response({ ...saved(), identityReview: { status: 'verified', source: 'vision', name: '26错误CP008' } }) });
  h.controller.edit(); await h.controller.save();
  assert.equal(h.saves.length, 0); assert.equal(h.controller.isEditing('file'), true);
  assert.match(h.controller.render(h.receipts.r1), /保存失败/);
});

test('timeout keeps the input for retry even if a fetch ignores abort', async () => {
  const h = fixture({ requestTimeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  h.controller.edit(); h.input('26苏交通CP008'); await h.controller.save();
  assert.equal(h.requests[0].init.signal.aborted, true); assert.equal(h.saves.length, 0);
  assert.equal(h.controller.isBusy('file'), false); assert.equal(h.controller.isEditing('file'), true);
  assert.match(h.controller.render(h.receipts.r1), /保存超时/);
});

test('Enter saves, Escape cancels, and IME composition cannot submit the parent form', async () => {
  const h = fixture(); h.controller.edit(); h.input('26苏交通CP008');
  let prevented = 0, stopped = 0;
  const event = key => ({ target: h.sections.get('r1').input, key, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  h.listeners.get('keydown')({ ...event('Enter'), isComposing: true }); assert.equal(h.requests.length, 0);
  h.listeners.get('keydown')(event('Enter')); await flush(); assert.equal(h.requests.length, 1); assert.equal(h.saves.length, 1);
  h.controller.edit(); h.listeners.get('keydown')(event('Escape'));
  assert.equal(h.requests.length, 1); assert.equal(h.controller.isEditing('file'), false); assert.equal(prevented, 2); assert.equal(stopped, 2);
});

test('blank or multiline names are rejected locally and markup is escaped in the input', async () => {
  const h = fixture(); h.controller.edit();
  for (const name of ['', 'a\nb']) { h.input(name); await h.controller.save(); }
  assert.equal(h.requests.length, 0);
  h.input('<img onerror="private">'); assert.match(h.controller.render(h.receipts.r1), /&lt;img/);
  assert.doesNotMatch(h.controller.render(h.receipts.r1), /value="<img/);
});

test('clear and dispose abort requests and remove delegated listeners', async () => {
  const gate = deferred(); const h = fixture({ fetchImpl: () => gate.promise });
  h.controller.edit(); const pending = h.controller.save(); h.controller.dispose(); gate.resolve(response(saved())); await pending;
  assert.equal(h.requests[0].init.signal.aborted, true); assert.equal(h.saves.length, 0); assert.equal(h.listeners.size, 0);
  assert.equal(h.controller.render(h.receipts.r1), '');
});
