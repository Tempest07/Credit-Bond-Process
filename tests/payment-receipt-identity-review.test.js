import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile, insertPaymentReceipt, insertPaymentReceiptMatch } from '../functions/api/_payment-receipts.js';
import { onRequestPost } from '../functions/api/payment-receipts/[id]/identity-review.js';
import { parseReceiptIdentityReview, compatibleReceiptNameCorrection, runReceiptIdentityReview } from '../payment-receipt-identity-review.js';

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
  for (const data of [literal({ nameField: '' }), literal({ remittanceName: '' }), literal({ securityCode: '871010177599000105' }),
    literal({ uncertainties: ['有两张缴款单'] }), { ...literal(), uncertainties: undefined }]) {
    assert.equal(parseReceiptIdentityReview(data, '042680338').status, 'unavailable');
  }
});

test('a verified correction permits issuer tail completion but never another complete identity', () => {
  assert.equal(compatibleReceiptNameCorrection('26苏交CP008', '26苏交通CP008'), true);
  assert.equal(compatibleReceiptNameCorrection('某某公司2026年公开发行债券', '26苏交通CP008'), true);
  assert.equal(compatibleReceiptNameCorrection('26苏交通CP008', '26苏交通CP008(绿色)'), true);
  for (const target of ['26苏交通SCP008', '26苏交通CP009', '25苏交通CP008', '26苏交通CP008A', '26中交航CP008']) {
    assert.equal(compatibleReceiptNameCorrection('26苏交CP008', target), false, target);
  }
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

async function fixture(t, overrides = {}) {
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
    const stream = pdf.context.stream(new Uint8Array([0xff, 0xd8, 1 + index, 0xff, 0xd9]), {
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
  await insertPaymentReceiptMatch(DB, { id: 'match', ownerUserId: 'admin', receiptId: 'receipt', projectId: 'project', trancheId: 'tranche' });
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

test('two agreeing AI readings cannot silently replace an explicitly conflicting stored identity', async t => {
  for (const bond_short_name of ['26苏交SCP008', '26苏交CP009', '25苏交CP008', '26苏交CP008A', '26苏通交CP008']) {
    const h = await fixture(t);
    h.DB.sql.prepare('UPDATE payment_receipts SET bond_short_name=?').run(bond_short_name);
    const response = await h.request();
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.proposal.status, 'conflict', bond_short_name);
    assert.equal(preview.proposal.reason, 'source_name_conflict', bond_short_name);
    assert.equal((await h.request({ action: 'apply', reviewId: preview.reviewId })).status, 409);
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
