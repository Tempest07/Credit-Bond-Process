import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile, insertPaymentReceipt, insertPaymentReceiptMatch } from '../functions/api/_payment-receipts.js';
import { onRequestPost } from '../functions/api/payment-receipts/[id]/identity-review.js';
import { parseReceiptIdentityReview, compatibleReceiptNameCorrection, normalizeManualReceiptName, runReceiptIdentityReview } from '../payment-receipt-identity-review.js';

const NOW = '2026-10-25T10:00:00.000Z';
const literal = (extra = {}) => ({ nameField: '26 苏交通 CP008', remittanceName: '26苏交通CP008', securityCode: '042680338', uncertainties: [], ...extra });

test('independent literal readings normalize formatting and retain only explicit attributes', () => {
  const result = parseReceiptIdentityReview({ response: JSON.stringify(literal()) }, '042680338.IB');
  assert.equal(result.status, 'verified');
  assert.equal(result.name, '26苏交通CP008');
  assert.equal(result.code, '042680338');
  assert.equal(parseReceiptIdentityReview(literal({ nameField: '26苏交通CP008(绿色)' })).name, '26苏交通CP008(绿色)');
  assert.equal(parseReceiptIdentityReview(literal({ nameField: '26苏交通CP008(绿色)', remittanceName: '26苏交通CP008(科创)' })).name, '26苏交通CP008(绿色)(科创)');
});

test('CP/SCP, tranche letters, year, code and market conflicts cannot be guessed away', () => {
  for (const nameField of ['26苏交通SCP008', '26苏交通CP008A', '25苏交通CP008', '26另一CP008']) {
    assert.equal(parseReceiptIdentityReview(literal({ nameField }), '042680338').status, 'conflict', nameField);
  }
  for (const expected of ['042680339', '042680338.SZ', 'F042680338']) {
    assert.equal(parseReceiptIdentityReview(literal({ securityCode: '042680338.IB' }), expected).status, 'conflict', expected);
  }
  for (const data of [literal({ nameField: '', remittanceName: '' }), literal({ nameField: '无法读取的印字' }), literal({ securityCode: '871010177599000105' }),
    literal({ uncertainties: ['有两张缴款单'] }), { ...literal(), uncertainties: undefined }]) {
    assert.equal(parseReceiptIdentityReview(data, '042680338').status, 'unavailable');
  }
});

test('fresh current-page readings can correct earlier OCR identity errors', () => {
  assert.equal(compatibleReceiptNameCorrection('26苏交CP008', '26苏交通CP008'), true);
  assert.equal(compatibleReceiptNameCorrection('某某公司2026年公开发行债券', '26苏交通CP008'), true);
  assert.equal(compatibleReceiptNameCorrection('26苏交通CP008', '26苏交通CP008(绿色)'), true);
  for (const target of ['26苏交通SCP008', '26苏交通CP009', '25苏交通CP008', '26苏交通CP008A', '26中交航CP008']) {
    assert.equal(compatibleReceiptNameCorrection('26苏交CP008', target), true, target);
  }
  assert.equal(compatibleReceiptNameCorrection('福建高速MTN005', '26闽高速MTN005'), true);
  assert.equal(compatibleReceiptNameCorrection('26九川通SCP003(支持养老产业)', '26九州通SCP003(支持养老产业)'), true);
  assert.equal(compatibleReceiptNameCorrection('26苏交CP008', ''), false);
  assert.equal(compatibleReceiptNameCorrection('26苏交CP008', '只是公司全称有限公司'), false);
});

test('one clearly visible name is sufficient when the other field is absent', () => {
  for (const reading of [literal({ nameField: '' }), literal({ remittanceName: '' })]) {
    const result = parseReceiptIdentityReview(reading, '042680338');
    assert.equal(result.status, 'verified'); assert.equal(result.name, '26苏交通CP008');
  }
  const fujian = parseReceiptIdentityReview({ nameField: '26 闽高速 MTN005', remittanceName: '', securityCode: '102683994', uncertainties: [] }, '102683994');
  assert.equal(fujian.status, 'verified'); assert.equal(fujian.name, '26闽高速MTN005');
  assert.equal(parseReceiptIdentityReview({ ...literal(), remittanceName: '', uncertainties: ['另一处印字看不清'] }).status, 'unavailable');
  assert.equal(parseReceiptIdentityReview({ ...literal(), remittanceName: '无法读取的印字' }).status, 'unavailable');
  assert.equal(parseReceiptIdentityReview({ ...literal(), remittanceName: '26苏交通SCP008' }).status, 'conflict');
});

test('review sends current image only with bounded output and no automatic retry', async () => {
  const calls = [];
  const result = await runReceiptIdentityReview({ async run(model, input) { calls.push({ model, input }); return literal(); } },
    { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, '042680338');
  assert.equal(result.status, 'verified');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.temperature, 0);
  assert.equal(calls[0].input.max_tokens, 400);
  assert.equal(calls[0].input.messages.length, 1);
  assert.equal(calls[0].input.messages[0].content.length, 2);
  assert.doesNotMatch(calls[0].input.messages[0].content[0].text, /26苏交|042680338/);
  let failures = 0;
  assert.equal((await runReceiptIdentityReview({ async run() { failures++; throw Error('private-key-and-vendor-body'); } },
    { mimeType: 'image/png', bytes: new Uint8Array([1]) })).reason, 'ai_unavailable');
  assert.equal(failures, 1);
  assert.equal((await runReceiptIdentityReview({ async run() { return literal(); } },
    { mimeType: 'image/png', bytes: new Uint8Array([1, 2]).buffer }, '042680338')).status, 'verified');
});

async function fixture(t, overrides = {}, scanBytes = null) {
  const DB = createMemoryD1();
  t.after(() => DB.sql.close());
  const prepare = DB.prepare;
  const wrap = (query, statement) => ({ ...statement, query, bind(...values) { return wrap(query, statement.bind(...values)); }, async all() { return statement.execute(); } });
  DB.prepare = query => wrap(query, prepare(query));
  await ensureAuthSchema(DB);
  await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB, { id: 'batch', ownerUserId: 'admin', messageId: 'message', receivedAt: NOW,
    receivedDate: '2026-10-25', rawObjectKey: 'emails/message.eml', processingStatus: 'processed', createdAt: NOW });
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage([100, 100]);
    const stream = pdf.context.stream(scanBytes || new Uint8Array([0xff, 0xd8, 1 + index, 0xff, 0xd9]), {
      Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
    });
    page.node.newXObject('Scan', pdf.context.register(stream));
  }
  const bytes = await pdf.save();
  const sourceHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  await insertPaymentReceiptFile(DB, { id: 'file', batchId: 'batch', filename: 'source.pdf', mimeType: 'application/pdf',
    byteSize: bytes.length, sha256: sourceHash, objectKey: 'attachments/source.pdf', pageCount: 2, processingStatus: 'processed', createdAt: NOW });
  await insertPaymentReceipt(DB, { id: 'receipt', ownerUserId: 'admin', batchId: 'batch', fileId: 'file', sourcePages: [2],
    sourcePageLabel: '2', objectKey: 'receipts/receipt.pdf', sha256: 'receipt-fingerprint', recognitionStatus: 'recognized',
    matchStatus: 'matched', bondShortName: '26苏交CP008', securityCode: '042680338', paymentDate: '2026-10-26', amountFen: 42_000_000_000,
    recognizedText: '原始识别不能覆盖', createdAt: NOW });
  await insertPaymentReceiptMatch(DB, { id: 'match', ownerUserId: 'admin', receiptId: 'receipt', projectId: 'project', trancheId: 'tranche', createdAt: NOW });
  const calls = [];
  const env = { DB, AI_PROCESSING_APPROVED: 'true', AI: { async run(model, input) { calls.push({ model, input }); return literal(); } },
    PAYMENT_RECEIPTS: { async get(key) { assert.equal(key, 'attachments/source.pdf'); return { size: bytes.length, async arrayBuffer() { return bytes; } }; } }, ...overrides };
  const request = (body = { action: 'preview' }, options = {}) => onRequestPost({ env, params: { id: options.id || 'receipt' },
    request: new Request(options.url || 'http://127.0.0.1:8788/api/payment-receipts/receipt/identity-review', {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:8788', ...options.headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }) });
  return { DB, env, calls, request, bytes, state() {
    return { receipts: DB.sql.prepare('SELECT * FROM payment_receipts').all(), matches: DB.sql.prepare('SELECT * FROM payment_receipt_matches').all(),
      files: DB.sql.prepare('SELECT * FROM payment_receipt_files').all() };
  } };
}

test('preview/apply use stored evidence, preserve all business rows and reuse accepted results', async t => {
  const h = await fixture(t), before = h.state();
  const response = await h.request(); assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.proposal.status, 'verified');
  assert.equal(preview.proposal.pageNumber, 2);
  assert.equal(preview.proposal.name, '26苏交通CP008');
  assert.equal(preview.proposal.receiptSha256, undefined);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].input.messages[0].content[1].image_url.url, /\/9gC\/9k=$/);
  const apply = await h.request({ action: 'apply', reviewId: preview.reviewId, name: '客户端伪造简称' });
  assert.equal(apply.status, 200);
  assert.equal((await apply.json()).identityReview.name, '26苏交通CP008');
  assert.deepEqual(h.state(), before);
  assert.equal((await h.request({ action: 'apply', reviewId: preview.reviewId })).status, 200);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_review_accepted'").get().n, 1);
  const cached = await (await h.request()).json();
  assert.equal(cached.cached, true);
  assert.equal(h.calls.length, 1);
});

test('auth, origin, ownership and request limits reject before recognition', async t => {
  const h = await fixture(t);
  assert.equal((await h.request({}, { url: 'https://tempest07.com/api/payment-receipts/receipt/identity-review', headers: { Origin: 'https://tempest07.com' } })).status, 401);
  assert.equal((await h.request({}, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.request({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await h.request('x'.repeat(4097))).status, 413);
  assert.equal((await h.request({ action: 'preview' }, { id: 'not-owned' })).status, 404);
  h.DB.sql.prepare("UPDATE payment_receipts SET owner_user_id='other'").run();
  assert.equal((await h.request()).status, 404);
  assert.equal(h.calls.length, 0);
});

test('source changes or processing races after model completion cannot persist a proposal', async t => {
  for (const sql of ["UPDATE payment_receipt_files SET processing_status='regrouping'", "UPDATE payment_receipt_files SET updated_at='changed'",
    "UPDATE payment_receipts SET source_pages_json='[1]'", "UPDATE payment_receipts SET security_code='042680339'"]) {
    const h = await fixture(t);
    h.env.AI.run = async () => { h.DB.sql.exec(sql); return literal(); };
    assert.equal((await h.request()).status, 409, sql);
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  }
});

test('stale or conflicting proposals cannot apply, and raw original bytes are checked', async t => {
  const h = await fixture(t);
  const preview = await (await h.request()).json();
  h.DB.sql.prepare("UPDATE payment_receipt_files SET updated_at='changed'").run();
  assert.equal((await h.request({ action: 'apply', reviewId: preview.reviewId })).status, 409);
  assert.equal((await h.request({ action: 'apply', reviewId: 'unowned-review' })).status, 404);
  h.DB.sql.prepare('UPDATE payment_receipt_files SET updated_at=?').run(NOW);
  h.env.AI.run = async () => literal({ remittanceName: '26苏交通SCP008' });
  const conflict = await (await h.request()).json();
  assert.equal(conflict.proposal.status, 'conflict');
  assert.equal((await h.request({ action: 'apply', reviewId: conflict.reviewId })).status, 409);
  h.env.PAYMENT_RECEIPTS.get = async () => ({ async arrayBuffer() { return new Uint8Array([1, 2]); } });
  assert.equal((await h.request()).status, 409);
});

test('clear same-code image readings may correct wrong OCR years, products and issuer names', async t => {
  for (const bond_short_name of ['26苏交SCP008', '26苏交CP009', '25苏交CP008', '26苏交CP008A', '26苏通交CP008']) {
    const h = await fixture(t);
    h.DB.sql.prepare('UPDATE payment_receipts SET bond_short_name=?').run(bond_short_name);
    const response = await h.request();
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.proposal.status, 'verified', bond_short_name);
    assert.equal(preview.proposal.name, '26苏交通CP008');
    assert.equal((await h.request({ action: 'apply', reviewId: preview.reviewId })).status, 200);
    assert.equal(h.DB.sql.prepare('SELECT bond_short_name FROM payment_receipts').get().bond_short_name, bond_short_name);
  }
});

test('remote recognition approval and local adapter destinations are enforced without leaking errors', async t => {
  const h = await fixture(t);
  h.env.AI_PROCESSING_APPROVED = 'false';
  assert.equal((await h.request()).status, 503);
  h.env.AI = undefined;
  h.env.CF_PAGES_BRANCH = 'local';
  for (const base of ['http://127.0.0.1.evil.example:11434', 'https://127.0.0.1:11434', 'http://user@127.0.0.1:11434', 'http://127.0.0.1:11434/other']) {
    h.env.PAYMENT_RECEIPT_LOCAL_AI_URL = base;
    assert.equal((await h.request()).status, 503, base);
  }
  h.env.AI_PROCESSING_APPROVED = 'true';
  h.env.AI = { async run() { throw Error('secret-vendor-response'); } };
  const response = await h.request();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.proposal.reason, 'ai_unavailable');
  assert.ok(!JSON.stringify(result).includes('secret-vendor-response'));
});

test('the explicit local adapter uses bounded Qwen context and never follows remote redirects', async t => {
  const h = await fixture(t);
  h.env.AI = undefined;
  h.env.CF_PAGES_BRANCH = 'local';
  h.env.PAYMENT_RECEIPT_LOCAL_AI_URL = 'http://127.0.0.1:11434';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    calls.push({ url: String(url), input });
    return Response.json({ message: { content: JSON.stringify(literal()) } });
  });
  const result = await (await h.request()).json();
  assert.equal(result.proposal.status, 'verified');
  assert.equal(result.proposal.model, 'qwen3-vl:8b-instruct');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(calls[0].input.redirect, 'manual');
  const body = JSON.parse(calls[0].input.body);
  assert.equal(body.keep_alive, 0);
  assert.equal(body.options.num_ctx, 8192);
  assert.equal(body.options.num_predict, 400);
  h.env.CF_PAGES_BRANCH = 'main';
  assert.equal((await h.request()).status, 503);
  assert.equal(calls.length, 1);
});

const deepseekScan = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 0xff, 0xd9]);
const ocrKey = 'ocr-only-test-key-123456789';

test('explicit DeepSeek OCR uses only its dedicated key ahead of the legacy binding and preserves apply guards', async t => {
  const h = await fixture(t, { OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_OCR_API_KEY: ocrKey,
    DEEPSEEK_API_KEY: 'issuance-only-test-key-123456789' }, deepseekScan);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    calls.push({ url: String(url), input });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(literal()) } }] });
  });
  const before = h.state();
  const response = await h.request();
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.proposal.model, 'deepseek-flash');
  assert.equal(preview.proposal.status, 'verified');
  assert.equal(h.calls.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].input.headers.Authorization, `Bearer ${ocrKey}`);
  const body = JSON.parse(calls[0].input.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.max_tokens, 400);
  assert.match(body.messages[0].content[0].text, /两处都存在时分别读取/);
  assert.deepEqual(h.state(), before);
  assert.equal((await h.request({ action: 'apply', reviewId: preview.reviewId })).status, 200);
  assert.deepEqual(h.state(), before);
});

test('explicit DeepSeek OCR fails closed when its key or remote-processing approval is missing', async t => {
  for (const overrides of [
    { OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'issuance-key-cannot-be-used-12345' },
    { OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_OCR_API_KEY: ocrKey, AI_PROCESSING_APPROVED: 'false' },
  ]) {
    const h = await fixture(t, overrides, deepseekScan);
    const response = await h.request();
    assert.equal(response.status, 503);
    assert.equal(h.calls.length, 0);
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  }
});

test('DeepSeek OCR authentication and throttling errors remain safe and never fall back or retry', async t => {
  for (const status of [401, 429]) {
    const h = await fixture(t, { OCR_AI_PROVIDER: 'deepseek', DEEPSEEK_OCR_API_KEY: ocrKey }, deepseekScan);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('private-vendor-details', { status }); });
    const response = await h.request();
    assert.equal(response.status, status === 429 ? 429 : 503);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private-vendor-details|ocr-only-test-key/);
    assert.equal(requests, 1);
    assert.equal(h.calls.length, 0);
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
    t.mock.restoreAll();
  }
});

test('manual names allow explicit human product corrections while rejecting unsafe or empty input', () => {
  assert.equal(normalizeManualReceiptName('  26苏交通ＳＣＰ００８（人工核对）  '), '26苏交通SCP008(人工核对)');
  assert.equal(normalizeManualReceiptName('苏交通测试券'), '苏交通测试券');
  for (const value of ['', '   ', 'x'.repeat(101), '26测试\nCP001', '\u200b26测试CP001', '26测试\u0000CP001', '<>', null, {}]) {
    assert.equal(normalizeManualReceiptName(value), '', String(value));
  }
});

const manualBody = (name = '26苏交通SCP008', extra = {}) => ({ action: 'manual', name,
  expectedUpdatedAt: NOW, expectedFileUpdatedAt: NOW, expectedIdentityReviewId: '', ...extra });

test('manual correction is separate audited evidence, idempotent, and never calls AI or rewrites business fields', async t => {
  const h = await fixture(t), before = h.state();
  h.env.PAYMENT_RECEIPTS.get = async () => { throw Error('manual edits do not read or upload PDF bytes'); };
  const result = await h.request(manualBody()); assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.identityReview.source, 'manual');
  assert.equal(payload.identityReview.name, '26苏交通SCP008');
  assert.equal(payload.identityReview.readings, undefined, 'manual input cannot fabricate visual evidence');
  assert.equal(payload.receipt.bondShortName, '26苏交CP008');
  assert.equal(payload.receipt.fileUpdatedAt, NOW);
  assert.deepEqual(h.state(), before);
  assert.equal(h.calls.length, 0);
  const row = h.DB.sql.prepare("SELECT * FROM payment_receipt_events WHERE event_type='identity_name_manually_corrected'").get();
  const detail = JSON.parse(row.detail_json);
  assert.equal(detail.previousName, '26苏交CP008'); assert.equal(detail.newName, '26苏交通SCP008');
  assert.equal(detail.editedBy, 'admin'); assert.equal(detail.pageNumber, 2);
  assert.equal(detail.receiptSha256, 'receipt-fingerprint'); assert.ok(detail.fileSha256);
  assert.equal(detail.expectedCode, '042680338'); assert.equal(detail.readings, undefined);
  const repeat = await h.request(manualBody()); assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).cached, true);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_name_manually_corrected'").get().n, 1);
  const second = await h.request(manualBody('苏交通测试券', { expectedIdentityReviewId: payload.reviewId }));
  assert.equal(second.status, 200); const next = await second.json();
  assert.equal(next.identityReview.name, '苏交通测试券');
  assert.equal(next.identityReview.previousName, '26苏交通SCP008');
  assert.deepEqual(h.state(), before);
});

test('manual correction requires current receipt, file and optional prior identity versions', async t => {
  for (const change of [{ expectedUpdatedAt: '' }, { expectedUpdatedAt: 'old' }, { expectedFileUpdatedAt: '' },
    { expectedFileUpdatedAt: 'old' }, { expectedIdentityReviewId: 'stale' }]) {
    const h = await fixture(t);
    assert.equal((await h.request(manualBody('26测试CP001', change))).status, 409, JSON.stringify(change));
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  }
  const h = await fixture(t);
  assert.equal((await h.request(manualBody('26测试\nCP001'))).status, 400);
  assert.equal((await h.request(manualBody(), { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.request(manualBody(), { id: 'not-owned' })).status, 404);
  h.DB.sql.prepare("UPDATE payment_receipts SET owner_user_id='another-owner'").run();
  assert.equal((await h.request(manualBody())).status, 404);
  assert.equal(h.calls.length, 0);
});

test('manual event insertion fences a processing or source race instead of writing against old data', async t => {
  for (const mutation of ["UPDATE payment_receipt_files SET updated_at='changed'", "UPDATE payment_receipts SET updated_at='changed'",
    "UPDATE payment_receipt_files SET processing_status='regrouping'", "UPDATE payment_receipts SET security_code='042680339'"]) {
    const h = await fixture(t), prepare = h.DB.prepare;
    let changed = false;
    const wrap = (sql, statement) => ({ ...statement, bind(...values) { return wrap(sql, statement.bind(...values)); },
      async run() { if (!changed && /INSERT OR IGNORE INTO payment_receipt_events/.test(sql)) { changed = true; h.DB.sql.exec(mutation); } return statement.run(); } });
    h.DB.prepare = sql => wrap(sql, prepare(sql));
    assert.equal((await h.request(manualBody())).status, 409, mutation);
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  }
});

test('explicit force preview re-detects an adopted name but leaves the accepted identity untouched', async t => {
  const h = await fixture(t);
  const saved = await (await h.request(manualBody())).json();
  const before = h.state();
  const cached = await (await h.request({ action: 'preview', reuse: true })).json();
  assert.equal(cached.cached, true); assert.equal(cached.identityReview.source, 'manual'); assert.equal(h.calls.length, 0);
  const forced = await h.request({ action: 'preview', force: true, reuse: true });
  assert.equal(forced.status, 200); const suggestion = await forced.json();
  assert.equal(suggestion.cached, false); assert.equal(suggestion.proposal.name, '26苏交通CP008');
  assert.equal(suggestion.identityReview, undefined); assert.equal(h.calls.length, 1);
  const current = await (await h.request({ action: 'preview' })).json();
  assert.equal(current.identityReview.reviewId, saved.identityReview.reviewId);
  assert.equal(current.identityReview.name, '26苏交通SCP008');
  assert.deepEqual(h.state(), before);
});

function pauseNextIdentityEvent(h, eventType) {
  let reached, release;
  const entered = new Promise(resolve => { reached = resolve; }), released = new Promise(resolve => { release = resolve; });
  const prepare = h.DB.prepare; let paused = false;
  const wrap = (sql, statement, bindings = []) => ({ ...statement,
    bind(...values) { return wrap(sql, statement.bind(...values), values); },
    async run() {
      if (!paused && /INSERT OR IGNORE INTO payment_receipt_events/.test(sql) && bindings[1] === eventType) {
        paused = true; reached(); await released;
      }
      return statement.run();
    } });
  h.DB.prepare = sql => wrap(sql, prepare(sql));
  return { entered, release: () => release() };
}

test('the manual event CAS rejects a different edit committed between reading and inserting', async t => {
  const h = await fixture(t), before = h.state(), gate = pauseNextIdentityEvent(h, 'identity_name_manually_corrected');
  const oldRequest = h.request(manualBody('26较早人工简称'));
  await gate.entered;
  const newer = await h.request(manualBody('26较新人工简称')); assert.equal(newer.status, 200);
  gate.release(); assert.equal((await oldRequest).status, 409);
  const current = await (await h.request()).json(); assert.equal(current.identityReview.name, '26较新人工简称');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_name_manually_corrected'").get().n, 1);
  assert.deepEqual(h.state(), before);
});

test('simultaneous retries of the same manual edit create exactly one audit record', async t => {
  const h = await fixture(t), gate = pauseNextIdentityEvent(h, 'identity_name_manually_corrected');
  const first = h.request(manualBody()); await gate.entered;
  assert.equal((await h.request(manualBody())).status, 200); gate.release();
  assert.equal((await first).status, 200);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_name_manually_corrected'").get().n, 1);
});

test('an old AI proposal cannot replace a later manual correction; a fresh explicit recheck can be adopted', async t => {
  const h = await fixture(t), preview = await (await h.request()).json(), before = h.state();
  const manual = await (await h.request(manualBody())).json();
  assert.equal((await h.request({ action: 'apply', reviewId: preview.reviewId })).status, 409);
  const forced = await (await h.request({ action: 'preview', force: true })).json();
  const applied = await h.request({ action: 'apply', reviewId: forced.reviewId }); assert.equal(applied.status, 200);
  assert.equal((await applied.json()).identityReview.name, '26苏交通CP008');
  assert.notEqual((await (await h.request()).json()).identityReview.reviewId, manual.identityReview.reviewId);
  assert.deepEqual(h.state(), before);
});

test('an AI adoption paused before INSERT cannot overwrite a concurrently committed manual correction', async t => {
  const h = await fixture(t), preview = await (await h.request()).json();
  const gate = pauseNextIdentityEvent(h, 'identity_review_accepted');
  const oldApply = h.request({ action: 'apply', reviewId: preview.reviewId }); await gate.entered;
  assert.equal((await h.request(manualBody())).status, 200); gate.release();
  assert.equal((await oldApply).status, 409);
  assert.equal((await (await h.request()).json()).identityReview.source, 'manual');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='identity_review_accepted'").get().n, 0);
});
