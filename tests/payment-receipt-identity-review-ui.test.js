import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizePaymentReceiptBondShortName } from '../payment-receipt-names.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(payload) };
}
const proposal = (overrides = {}) => ({
  status: 'verified', name: '26苏交通CP008', code: '042680338', originalName: '26苏交CP008',
  pageNumber: 9, model: 'local-vision', reason: '',
  readings: { nameField: '26 苏交通 CP008', remittanceName: '26 苏交通 CP008', securityCode: '042680338', uncertainties: [] },
  ...overrides,
});
function load(context, names) {
  for (const name of names) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, name);
    const rest = source.slice(start), end = rest.slice(1).search(/\n(?:async )?function |\nvoid initialize\(/);
    vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
  }
}

function harness() {
  const requests = [], mutations = [], panels = new Map(), controls = new Map();
  let clearedPreviews = 0;
  const makeControls = () => {
    const owner = {
      select: { value: '', innerHTML: '<option value="">请选择项目品种</option>' },
      search: { value: '' }, fieldset: { disabled: false }, assign: { disabled: true }, candidates: { open: false },
    };
    owner.fieldset.owner = owner;
    owner.fieldset.replaceWith = retained => controls.set(currentId(), retained.owner);
    return owner;
  };
  const getControls = id => {
    if (!controls.has(id)) controls.set(id, makeControls());
    return controls.get(id);
  };
  const getPanel = id => {
    if (!panels.has(id)) panels.set(id, { dataset: { receiptIdentityReview: id }, innerHTML: '' });
    return panels.get(id);
  };
  let context;
  const currentId = () => context.selectedPaymentReceiptEntryKey.replace(/^receipt:/, '');
  const toolbar = { querySelector(selector) {
    if (selector === '[data-receipt-identity-review]') return getPanel(currentId());
    return ({ '[data-receipt-target]': 'select', '[data-receipt-target-search]': 'search',
      '.payment-receipt-match-controls': 'fieldset', '[data-receipt-assign]': 'assign',
      '.payment-receipt-match-candidates': 'candidates' })[selector]
      ? getControls(currentId())[({ '[data-receipt-target]': 'select', '[data-receipt-target-search]': 'search',
        '.payment-receipt-match-controls': 'fieldset', '[data-receipt-assign]': 'assign',
        '.payment-receipt-match-candidates': 'candidates' })[selector]] : null;
  } };
  context = vm.createContext({
    Map, AbortController, structuredClone, normalizePaymentReceiptBondShortName,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    paymentReceiptIdentityReviews: new Map(), selectedPaymentReceiptEntryKey: 'receipt:r/1',
    paymentReceipts: [
      { id: 'r/1', fileId: 'file-1', bondShortName: '26苏交CP008', recognizedText: '旧原文保留', securityCode: '042680338', sourcePages: [9, 10, 11], amountFen: 42000000000, paymentDate: '2026-10-15', projectId: '', trancheId: '' },
      { id: 'r2', bondShortName: '26另一只MTN001', recognizedText: '另一页原文', amountFen: 123, paymentDate: '2026-10-26' },
    ],
    state: { projects: [{ id: 'p1', status: '待缴款', paymentCompleted: false }] },
    PAYMENT_RECEIPTS_URL: './api/payment-receipts', authHeaders: () => ({}),
    $: selector => selector === '#paymentReceiptMatchToolbar' ? toolbar : null,
    fetch(url, options) {
      const request = { ...deferred(), url, options };
      requests.push(request); return request.promise;
    },
    applyLocalPaymentReceiptMutation(mutation) {
      mutations.push(plain(mutation));
      for (const receipt of mutation.receipts || []) {
        context.paymentReceipts = context.paymentReceipts.map(current => current.id === receipt.id ? receipt : current);
        // The real archive mutation redraws the selected inspector for changed
        // receipt data. Deliberately discard its controls to exercise restoration.
        if (currentId() === receipt.id) controls.set(receipt.id, makeControls());
      }
    },
    currentGatewayUser: { username: 'admin' }, paymentReceiptInspectorSignature: 'private',
    paymentReceiptNameResolverCache: { private: true },
    paymentReceiptPreview: { clear() { clearedPreviews++; } }, bondListController: null, projectOfrActions: null,
    paymentReceiptMatchAi:null,paymentReceiptBoundaryAi:null,paymentReceiptFileIdentityAi:null,paymentReceiptManualIdentityEdit:null,projectIntakeAi:null,
    syncBondListCloudGate() {}, updateAuthUi() {},
  });
  load(context, ['escapeHtml', 'escapeAttribute', 'clearPaymentReceiptIdentityReviews',
    'refreshPaymentReceiptIdentityReview', 'capturePaymentReceiptMatchDraft', 'restorePaymentReceiptMatchDraft', 'applyPaymentReceiptFileIdentityResult', 'applyPaymentReceiptFileIdentityUndo', 'applyPaymentReceiptManualIdentityResult',
    'paymentReceiptIdentityReviewHasCorrection', 'requestPaymentReceiptIdentityReview', 'renderPaymentReceiptIdentityReviewContent',
    'handlePaymentReceiptArchiveClick', 'clearAuthSession']);
  const click = (id, action = 'preview') => context.handlePaymentReceiptArchiveClick({ target: {
    closest: () => ({ dataset: { [action === 'apply' ? 'receiptIdentityApply' : 'receiptIdentityPreview']: id } }),
  } });
  return { context, requests, mutations, getPanel, getControls, click, clearedPreviews: () => clearedPreviews };
}

async function ready(h, id = 'r/1', value = proposal()) {
  const pending = h.click(id);
  h.requests.at(-1).resolve(response({ reviewId: `review:${id}`, proposal: value }));
  await pending;
}

test('whole-file results only store suggestions and preserve existing accepted identities', () => {
  const h=harness(),before=plain(h.context.paymentReceipts);
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'file-1',receiptId:'r/1',payload:{reviewId:'batch-review',proposal:proposal()}});
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').reviewId,'batch-review');
  assert.deepEqual(plain(h.context.paymentReceipts),before);assert.equal(h.mutations.length,0);
  h.context.paymentReceipts[0].identityReview=proposal({name:'26已确认CP008'});
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'file-1',receiptId:'r/1',payload:{reviewId:'other',proposal:proposal()}});
  assert.equal(h.context.paymentReceipts[0].identityReview.name,'26已确认CP008');
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').reviewId,'batch-review');
});

test('whole-file accepted cache merges identity alone and ignores other files and active single reviews', () => {
  const h=harness(),original=plain(h.context.paymentReceipts[0]),controls=h.getControls('r/1');
  controls.search.value='未保存的对应搜索';
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'wrong',receiptId:'r/1',payload:{reviewId:'bad',proposal:proposal()}});
  assert.equal(h.context.paymentReceiptIdentityReviews.size,0);
  h.context.paymentReceiptIdentityReviews.set('r/1',{controller:new AbortController()});
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'file-1',receiptId:'r/1',payload:{reviewId:'late',proposal:proposal()}});
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').reviewId,undefined);
  h.context.paymentReceiptIdentityReviews.clear();
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'file-1',receiptId:'r/1',payload:{reviewId:'accepted',proposal:proposal(),
    receipt:{id:'r/1',identityReview:proposal(),amountFen:1,paymentDate:'2099-01-01',projectId:'incorrect'}}});
  assert.deepEqual(plain(h.context.paymentReceipts[0]),{...original,identityReview:proposal()});
  assert.equal(h.getControls('r/1'),controls);assert.equal(controls.search.value,'未保存的对应搜索');
});

test('single-receipt AI cannot start during a whole-file review', async () => {
  const h=harness();h.context.paymentReceiptFileIdentityAi={isBusy:()=>true};
  await h.context.requestPaymentReceiptIdentityReview('r/1');assert.equal(h.requests.length,0);
});

test('automatic file adoption updates identity immediately and undo can remove it without touching raw data', () => {
  const h=harness(),before=plain(h.context.paymentReceipts[0]),controls=h.getControls('r/1');
  controls.search.value='未保存的对应选择';
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'file-1',receiptId:'r/1',stage:'apply',payload:{changed:true,receipt:{id:'r/1',identityReview:proposal(),amountFen:1}}});
  assert.deepEqual(plain(h.context.paymentReceipts[0]),{...before,identityReview:proposal()});
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').status,'applied');
  h.context.applyPaymentReceiptFileIdentityUndo({fileId:'file-1',payload:{receipts:[{id:'r/1'}],restoredCount:1,skippedCount:0}});
  assert.deepEqual(plain(h.context.paymentReceipts[0]),before);assert.equal(h.context.paymentReceiptIdentityReviews.has('r/1'),false);
  assert.equal(h.getControls('r/1'),controls);assert.equal(controls.search.value,'未保存的对应选择');assert.equal(h.requests.length,0);
});

test('file undo displays a later manual name returned for skipped rows and leaves other files untouched', () => {
  const h=harness(),before=plain(h.context.paymentReceipts[0]);
  h.context.paymentReceipts[0].identityReview=proposal();
  const manual={...proposal(),source:'manual',name:'26人工新简称CP008'};
  h.context.paymentReceiptIdentityReviews.set('r2',{fileId:'other',proposal:proposal()});
  h.context.applyPaymentReceiptFileIdentityUndo({fileId:'file-1',payload:{receipts:[{id:'r/1',identityReview:manual},{id:'r2'}],restoredCount:0,skippedCount:1}});
  assert.deepEqual(plain(h.context.paymentReceipts[0]),{...before,identityReview:manual});
  assert.equal(h.context.paymentReceiptIdentityReviews.has('r2'),true);
});

test('late undo responses never clear a newer local manual name or a new file version', () => {
  const h=harness();
  h.context.paymentReceipts[0].identityReview={...proposal(),source:'manual',name:'26人工较新简称CP008',acceptedAt:'2026-10-28T03:00:00Z'};
  h.context.applyPaymentReceiptFileIdentityUndo({fileId:'file-1',payload:{receipts:[{id:'r/1'}]}});
  assert.equal(h.context.paymentReceipts[0].identityReview.name,'26人工较新简称CP008');
  h.context.paymentReceipts[0].identityReview=proposal();h.context.paymentReceipts[0].fileUpdatedAt='v2';
  h.context.applyPaymentReceiptFileIdentityUndo({fileId:'file-1',payload:{receipts:[{id:'r/1',fileUpdatedAt:'v1'}]}});
  assert.equal(h.context.paymentReceipts[0].identityReview.name,'26苏交通CP008');
});

test('file source fences discard late batch suggestions and expired suggestions from filtered receipts', () => {
  const h=harness();h.context.paymentReceipts[0].fileUpdatedAt='v2';
  h.context.applyPaymentReceiptFileIdentityResult({fileId:'file-1',fileUpdatedAt:'v1',receiptId:'r/1',payload:{reviewId:'old',proposal:proposal()}});
  assert.equal(h.context.paymentReceiptIdentityReviews.size,0);
  h.context.paymentReceiptIdentityReviews.set('r/1',{fileId:'file-1',fileUpdatedAt:'v1',status:'ready',proposal:proposal()});
  h.context.renderPaymentReceiptIdentityReviewContent(h.context.paymentReceipts[0]);assert.equal(h.context.paymentReceiptIdentityReviews.size,0);
});

test('an accepted name can be explicitly rechecked without replacing it until adoption', async () => {
  const h=harness();h.context.paymentReceipts[0].identityReview=proposal();
  const pending=h.click('r/1');assert.equal(JSON.parse(h.requests[0].options.body).force,true);
  h.requests[0].resolve(response({reviewId:'new-check',proposal:proposal({name:'26苏交通CP008(绿色)'})}));await pending;
  assert.equal(h.context.paymentReceipts[0].identityReview.name,'26苏交通CP008');assert.equal(h.mutations.length,0);
  assert.match(h.getPanel('r/1').innerHTML,/当前简称/);assert.match(h.getPanel('r/1').innerHTML,/采用复核简称/);
});

test('explicit manual save only replaces accepted identity evidence and preserves raw business fields', () => {
  const h=harness(),before=plain(h.context.paymentReceipts[0]),controls=h.getControls('r/1');
  const manual={status:'verified',source:'manual',name:'26苏交通CP008',code:'042680338',pageNumber:9,acceptedAt:'2026-10-28',reviewId:'manual-1'};
  h.context.applyPaymentReceiptManualIdentityResult({receiptId:'r/1',payload:{receipt:{id:'r/1',identityReview:manual,amountFen:1,paymentDate:'2099-01-01'}}});
  assert.deepEqual(plain(h.context.paymentReceipts[0]),{...before,identityReview:manual});assert.equal(h.getControls('r/1'),controls);
  assert.match(h.getPanel('r/1').innerHTML,/人工修改/);assert.doesNotMatch(h.getPanel('r/1').innerHTML,/简称字段|缴款附言/);
});

test('render and navigation never request AI; an explicit preview is single-flight and never applies', async () => {
  const h = harness(), before = plain(h.context.paymentReceipts);
  const first = h.context.paymentReceipts[0];
  assert.match(h.context.renderPaymentReceiptIdentityReviewContent(first), /检测简称/);
  assert.equal(h.requests.length, 0);
  const pending = h.click(first.id);
  assert.match(h.getPanel(first.id).innerHTML, /检测中…/);
  await h.click(first.id);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, './api/payment-receipts/r%2F1/identity-review');
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { action: 'preview', force:true });
  h.requests[0].resolve(response({ reviewId: 'preview-one', proposal: proposal() }));
  await pending;
  assert.equal(h.mutations.length, 0);
  assert.deepEqual(plain(h.context.paymentReceipts), before);
  const html = h.getPanel(first.id).innerHTML;
  for (const text of ['26苏交通CP008', '26苏交CP008', '原件第 9 页', '26 苏交通 CP008', '042680338', '采用复核简称']) assert.ok(html.includes(text), text);
  assert.match(html, /识别建议/);
  assert.doesNotMatch(html, /复核完成/);
  assert.match(html, /data-receipt-identity-preview="r\/1" >再检测一次/);
  assert.match(html, /本次仅识别原件第 9 页，未核对整个分组/);
});

test('a repeated unchanged reading is not a correction and can be explicitly retried', async () => {
  const h = harness(), before = plain(h.context.paymentReceipts);
  const unchanged = proposal({ name: '26苏交CP008', originalName: '26 苏交 CP008',
    readings: { nameField: '26 苏交 CP008', remittanceName: '26 苏交 CP008', securityCode: '042680338', uncertainties: [] } });
  await ready(h, 'r/1', unchanged);
  assert.match(h.getPanel('r/1').innerHTML, /与当前简称一致/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /复核完成|data-receipt-identity-apply/);
  await h.click('r/1', 'apply');
  assert.equal(h.requests.length, 1, 'an unchanged name cannot be adopted through a stale or synthetic button');
  const retry = h.click('r/1');
  await h.click('r/1');
  assert.equal(h.requests.length, 2, 'only the explicit retry triggers one new request');
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /data-receipt-identity-apply/);
  h.requests[1].resolve(response({ reviewId: 'corrected', proposal: proposal() }));
  await retry;
  assert.match(h.getPanel('r/1').innerHTML, /26苏交通CP008/);
  assert.match(h.getPanel('r/1').innerHTML, /采用复核简称/);
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').reviewId, 'corrected');
  assert.deepEqual(plain(h.context.paymentReceipts), before);
  assert.equal(h.mutations.length, 0);
});

test('spaces, case and full-width formatting do not create a spurious name correction', async () => {
  const h = harness();
  h.context.paymentReceipts[0].bondShortName = '２６ 苏交 ｃｐ００８';
  await ready(h, 'r/1', proposal({ name: '26苏交CP008' }));
  assert.match(h.getPanel('r/1').innerHTML, /与当前简称一致/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /data-receipt-identity-apply/);
});

test('adoption sends only its saved review id and preserves raw data, current correspondence, drafts and project state', async () => {
  const h = harness();
  await ready(h);
  const beforeState = JSON.stringify(h.context.state);
  const pending = h.click('r/1', 'apply');
  await h.click('r/1', 'apply');
  assert.equal(h.requests.length, 2);
  assert.deepEqual(JSON.parse(h.requests[1].options.body), { action: 'apply', reviewId: 'review:r/1' });
  assert.equal(h.context.paymentReceipts[0].identityReview, undefined);
  // Both a correspondence mutation and a newer unsaved selection can happen
  // while this request is in flight. The identity reply must not roll either back.
  Object.assign(h.context.paymentReceipts[0], { projectId: 'new-project', trancheId: 'new-tranche' });
  Object.assign(h.getControls('r/1').select, { value: 'new-choice', innerHTML: '<option value="new-choice">新选择</option>' });
  h.getControls('r/1').search.value = '正在筛选';
  h.getControls('r/1').candidates.open = true;
  const stale = { ...plain(h.context.paymentReceipts[0]), projectId: 'old-project', trancheId: 'old-tranche', amountFen: 1, identityReview: proposal() };
  h.requests[1].resolve(response({ reviewId: 'review:r/1', identityReview: proposal(), receipt: stale }));
  await pending;
  assert.equal(h.mutations.length, 1);
  const current = h.context.paymentReceipts[0];
  assert.equal(current.identityReview.name, '26苏交通CP008');
  assert.equal(current.bondShortName, '26苏交CP008');
  assert.equal(current.recognizedText, '旧原文保留');
  assert.deepEqual(plain(current.sourcePages), [9, 10, 11]);
  assert.equal(current.amountFen, 42000000000);
  assert.equal(current.paymentDate, '2026-10-15');
  assert.equal(current.projectId, 'new-project');
  assert.equal(current.trancheId, 'new-tranche');
  assert.equal(h.getControls('r/1').select.value, 'new-choice');
  assert.equal(h.getControls('r/1').search.value, '正在筛选');
  assert.equal(h.getControls('r/1').candidates.open, true);
  assert.equal(JSON.stringify(h.context.state), beforeState);
  assert.match(h.getPanel('r/1').innerHTML, /已采用/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /data-receipt-identity-apply/);
  const rerun=h.click('r/1');
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve(response({reviewId:'rerun',proposal:proposal()}));await rerun;
  assert.equal(h.context.paymentReceipts[0].identityReview.name,'26苏交通CP008');
});

test('late previews remain associated with their own receipt and are reusable when returning', async () => {
  const h = harness();
  const pending = h.click('r/1');
  h.context.selectedPaymentReceiptEntryKey = 'receipt:r2';
  h.getPanel('r2').innerHTML = 'second receipt untouched';
  h.requests[0].resolve(response({ reviewId: 'one', proposal: proposal() }));
  await pending;
  assert.equal(h.getPanel('r2').innerHTML, 'second receipt untouched');
  assert.equal(h.mutations.length, 0);
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').proposal.name, '26苏交通CP008');
  h.context.selectedPaymentReceiptEntryKey = 'receipt:r/1';
  h.context.refreshPaymentReceiptIdentityReview('r/1');
  assert.match(h.getPanel('r/1').innerHTML, /采用复核简称/);
  assert.equal(h.requests.length, 1, 'returning to a receipt does not automatically rerun recognition');
});

test('adoption preserves the live correspondence controls so a pending match can still unlock them', async () => {
  const h = harness();
  await ready(h);
  const pending = h.click('r/1', 'apply');
  const originalControls = h.getControls('r/1').fieldset;
  originalControls.disabled = true;
  h.requests[1].resolve(response({ receipt: { ...plain(h.context.paymentReceipts[0]), identityReview: proposal() } }));
  await pending;
  assert.equal(h.getControls('r/1').fieldset, originalControls);
  assert.equal(h.getControls('r/1').fieldset.disabled, true);
  originalControls.disabled = false; // the original match request's finally block
  assert.equal(h.getControls('r/1').fieldset.disabled, false);
});

test('failed previews can be explicitly retried; conflicting readings can never be applied', async () => {
  const h = harness();
  const failed = h.click('r/1');
  h.requests[0].resolve(response({ error: '复核服务暂时不可用。' }, 503));
  await failed;
  assert.match(h.getPanel('r/1').innerHTML, /复核服务暂时不可用/);
  assert.match(h.getPanel('r/1').innerHTML, /再检测一次/);
  const retry = h.click('r/1');
  h.requests[1].resolve(response({ reviewId: 'conflict', proposal: proposal({ status: 'conflict', name: '', reason: 'literal_name_conflict' }) }));
  await retry;
  assert.match(h.getPanel('r/1').innerHTML, /简称字段与缴款附言不一致/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /literal_name_conflict/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /data-receipt-identity-apply/);
  await h.click('r/1', 'apply');
  assert.equal(h.requests.length, 2);
  assert.equal(h.mutations.length, 0);
});

test('an apply conflict discards the stale proposal and requires another explicit preview', async () => {
  const h = harness();
  await ready(h);
  const pending = h.click('r/1', 'apply');
  h.requests[1].resolve(response({ error: '原件状态已经变化，请重新复核。' }, 409));
  await pending;
  assert.match(h.getPanel('r/1').innerHTML, /重新复核/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /data-receipt-identity-apply/);
  assert.equal(h.context.paymentReceiptIdentityReviews.get('r/1').proposal, null);
  await h.click('r/1', 'apply');
  assert.equal(h.requests.length, 2);
  assert.equal(h.mutations.length, 0);
});

test('logout aborts in-flight work, clears private proposals and ignores late replies', async () => {
  const h = harness();
  const preview = h.click('r/1');
  h.context.paymentReceiptIdentityReviews.set('r2', { reviewId: 'two', status: 'ready', proposal: proposal() });
  h.context.selectedPaymentReceiptEntryKey = 'receipt:r2';
  const apply = h.click('r2', 'apply');
  h.context.clearAuthSession();
  assert.equal(h.context.currentGatewayUser, null);
  assert.equal(h.context.paymentReceiptNameResolverCache, null);
  assert.equal(h.clearedPreviews(), 1);
  assert.ok(h.requests.every(item => item.options.signal.aborted));
  assert.equal(h.context.paymentReceiptIdentityReviews.size, 0);
  h.requests[0].resolve(response({ reviewId: 'one', proposal: proposal() }));
  h.requests[1].resolve(response({ reviewId: 'two', receipt: { ...plain(h.context.paymentReceipts[1]), identityReview: proposal() } }));
  await Promise.all([preview, apply]);
  assert.equal(h.context.paymentReceiptIdentityReviews.size, 0);
  assert.equal(h.mutations.length, 0);
});

test('already accepted identity evidence is shown without another preview or AI call', async () => {
  const h = harness();
  h.context.paymentReceipts[0].identityReview = proposal();
  h.context.renderPaymentReceiptIdentityReviewContent(h.context.paymentReceipts[0]);
  await h.click('r/1', 'apply');
  assert.equal(h.requests.length, 0);
  const html = h.context.renderPaymentReceiptIdentityReviewContent(h.context.paymentReceipts[0]);
  assert.match(html, /已采用/);
  assert.match(html, /26苏交通CP008/);
  assert.doesNotMatch(html, /data-receipt-identity-apply/);
});

test('review text is escaped and a mismatched apply receipt cannot update another item', async () => {
  const h = harness();
  await ready(h, 'r/1', proposal({ originalName: '<script>bad</script>' }));
  assert.match(h.getPanel('r/1').innerHTML, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(h.getPanel('r/1').innerHTML, /<script>/);
  const pending = h.click('r/1', 'apply');
  h.requests[1].resolve(response({ receipt: { id: 'r2', identityReview: proposal() } }));
  await pending;
  assert.equal(h.mutations.length, 0);
  assert.match(h.getPanel('r/1').innerHTML, /结果不完整/);
});
