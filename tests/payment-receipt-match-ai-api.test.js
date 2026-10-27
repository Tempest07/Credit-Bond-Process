import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile, insertPaymentReceipt, insertPaymentReceiptMatch } from '../functions/api/_payment-receipts.js';
import { onRequestPost } from '../functions/api/payment-receipts/[id]/match-review.js';
import { receipt, projects, output } from './helpers/payment-match-ai-fixture.js';

const NOW = '2026-10-27T08:00:00.000Z';
const key = 'second-receipt-match-key-123456789';
const modelResponse = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

async function fixture(t) {
  const DB = createMemoryD1(); t.after(() => DB.sql.close());
  const prepare = DB.prepare;
  const wrap = statement => ({ ...statement, bind(...values) { return wrap(statement.bind(...values)); }, async all() { return statement.execute(); } });
  DB.prepare = query => wrap(prepare(query));
  await ensureAuthSchema(DB); await ensurePaymentReceiptSchema(DB);
  await DB.prepare('INSERT OR REPLACE INTO user_app_state (user_id, data, updated_at, revision) VALUES (?, ?, ?, ?)')
    .bind('admin', JSON.stringify({ projects }), NOW, 7).run();
  await insertPaymentReceiptBatch(DB, { id: 'b1', ownerUserId: 'admin', messageId: 'm1', receivedAt: NOW, receivedDate: '2026-10-27', processingStatus: 'processed', rawObjectKey: 'original.eml', createdAt: NOW });
  await insertPaymentReceiptFile(DB, { id: 'f1', batchId: 'b1', filename: 'original.pdf', mimeType: 'application/pdf', byteSize: 120, sha256: 'original-file-hash', objectKey: 'original.pdf', pageCount: 1, processingStatus: 'processed', createdAt: NOW });
  await insertPaymentReceipt(DB, { ...receipt, id: 'r1', ownerUserId: 'admin', batchId: 'b1', fileId: 'f1', sha256: 'receipt-hash', sourcePages: [1], sourcePageLabel: '1', objectKey: 'derived.pdf', recognitionStatus: 'recognized', matchStatus: 'review', createdAt: NOW });
  const env = { DB, AI_PROCESSING_APPROVED: 'true', DEEPSEEK_OCR_API_KEY: key, DEEPSEEK_API_KEY: 'first-key-cannot-be-used-12345' };
  const calls = [];
  let handler = () => modelResponse(output);
  const request = (body = { expectedUpdatedAt: NOW }, { id = 'r1', url = 'http://127.0.0.1:8788/api/payment-receipts/r1/match-review', headers = {} } = {}) =>
    onRequestPost({ env, params: { id }, request: new Request(url, { method: 'POST', headers: { Origin: new URL(url).origin, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
      fetchImpl: async (url, input) => { calls.push({ url, input }); return handler(url, input); } });
  return { DB, env, calls, request, setHandler(value) { handler = value; }, business() { return {
    receipts: DB.sql.prepare('SELECT * FROM payment_receipts').all(), matches: DB.sql.prepare('SELECT * FROM payment_receipt_matches').all(),
    files: DB.sql.prepare('SELECT * FROM payment_receipt_files').all(), state: DB.sql.prepare('SELECT * FROM user_app_state').all(),
  }; } };
}

test('recommendation uses the second key, caches in cloud events and never changes business records', async t => {
  const h = await fixture(t), before = h.business();
  const response = await h.request(); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.recommendations[0].projectId, 'p1');
  assert.equal(result.expectedUpdatedAt, NOW); assert.equal(result.receiptId, 'r1');
  assert.equal(result.cached, false); assert.equal(result.model, 'deepseek-flash');
  assert.equal(h.calls[0].input.headers.Authorization, `Bearer ${key}`);
  assert.equal(h.calls[0].input.redirect, 'manual');
  assert.doesNotMatch(h.calls[0].input.body, /PRIVATE_BANK_ACCOUNT|PRIVATE_CREDIT_APPROVAL|无关发行公司/);
  const cached = await (await h.request()).json();
  assert.equal(cached.cached, true); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.business(), before);
  h.DB.sql.prepare('UPDATE user_app_state SET revision=revision+1').run();
  assert.equal((await (await h.request()).json()).cached, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='receipt_match_ai_review'").get().n, 1);
});

test('authentication, same origin, ownership, body and receipt version gates run before the model', async t => {
  const h = await fixture(t);
  assert.equal((await h.request({}, { url: 'https://tempest07.com/api/payment-receipts/r1/match-review' })).status, 401);
  assert.equal((await h.request({}, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.request({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await h.request('x'.repeat(2049))).status, 413);
  assert.equal((await h.request({})).status, 428);
  assert.equal((await h.request({ expectedUpdatedAt: 'old' })).status, 409);
  assert.equal((await h.request(undefined, { id: 'foreign' })).status, 404);
  h.DB.sql.prepare("UPDATE payment_receipt_batches SET owner_user_id='other'").run();
  assert.equal((await h.request()).status, 404); assert.equal(h.calls.length, 0);
});

test('processing and explicit remote authorization/key gates cannot fall back to another purpose', async t => {
  const h = await fixture(t);
  h.env.AI_PROCESSING_APPROVED = 'false'; assert.equal((await h.request()).status, 503);
  h.env.AI_PROCESSING_APPROVED = 'true'; delete h.env.DEEPSEEK_OCR_API_KEY;
  assert.equal((await h.request()).status, 503);
  assert.equal(h.calls.length, 0);
  h.env.DEEPSEEK_OCR_API_KEY = key;
  h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='regrouping'").run();
  assert.equal((await h.request()).status, 409);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
});

test('source, accepted identity or project changes after model completion discard stale suggestions', async t => {
  for (const sql of ["UPDATE payment_receipts SET updated_at='changed'", "UPDATE payment_receipt_files SET sha256='changed'",
    "UPDATE user_app_state SET revision=revision+1", "UPDATE payment_receipts SET amount_fen=200000000", "UPDATE payment_receipt_files SET processing_status='regrouping'"]) {
    const h = await fixture(t);
    h.setHandler(() => { h.DB.sql.exec(sql); return modelResponse(output); });
    assert.equal((await h.request()).status, 409, sql);
    assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  }
});

test('only literal supported candidate suggestions survive, without enabling automatic assignment', async t => {
  const h = await fixture(t);
  h.setHandler(() => modelResponse({ recommendations: [{ ...output.recommendations[0], projectId: 'invented' }], warnings: [] }));
  const result = await (await h.request()).json();
  assert.deepEqual(result.recommendations, []); assert.match(result.warnings.join(''), /已忽略/);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_matches').get().n, 0);
});

test('upstream failures do not retry or retain a pending cache and expose no vendor response', async t => {
  const h = await fixture(t);
  h.setHandler(() => new Response('private-vendor-secret', { status: 429 }));
  const response = await h.request();
  assert.equal(response.status, 429); assert.doesNotMatch(JSON.stringify(await response.json()), /private-vendor-secret/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.DB.sql.prepare('SELECT COUNT(*) n FROM payment_receipt_events').get().n, 0);
  h.setHandler(() => modelResponse(output));
  assert.equal((await h.request()).status, 200); assert.equal(h.calls.length, 2);
});

test('same-input concurrent requests share a cloud lease instead of making a second model call', async t => {
  const h = await fixture(t);
  let release, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  h.setHandler(() => { started(); return new Promise(resolve => { release = () => resolve(modelResponse(output)); }); });
  const first = h.request(); await startedPromise;
  assert.equal((await h.request()).status, 409); assert.equal(h.calls.length, 1);
  release(); assert.equal((await first).status, 200);
});

test('code conflicts return no candidate without sending any model request', async t => {
  const h = await fixture(t);
  h.DB.sql.prepare("UPDATE payment_receipts SET security_code='042600001.SZ'").run();
  const result = await (await h.request()).json();
  assert.deepEqual(result.recommendations, []); assert.equal(h.calls.length, 0);
});

test('a candidate occupied by a different receipt before or during review is not recommended', async t => {
  for (const during of [false, true]) {
    const h = await fixture(t);
    const occupy = async () => {
      await insertPaymentReceiptFile(h.DB, { id: 'f2', batchId: 'b1', filename: 'another.pdf', mimeType: 'application/pdf', byteSize: 120,
        sha256: 'another-file-hash', objectKey: 'another.pdf', pageCount: 1, processingStatus: 'processed', createdAt: NOW });
      await insertPaymentReceipt(h.DB, { ...receipt, id: 'r2', ownerUserId: 'admin', batchId: 'b1', fileId: 'f2', sha256: 'another-receipt',
        sourcePages: [1], sourcePageLabel: '1', objectKey: 'another.pdf', recognitionStatus: 'recognized', matchStatus: 'review', createdAt: NOW });
      await insertPaymentReceiptMatch(h.DB, { id: 'other-match', ownerUserId: 'admin', receiptId: 'r2', projectId: 'p1', trancheId: 't1', matchSource: 'manual' });
    };
    if (during) h.setHandler(async () => { await occupy(); return modelResponse(output); });
    else await occupy();
    const response = await h.request();
    assert.equal(response.status, during ? 409 : 200);
    if (!during) assert.deepEqual((await response.json()).recommendations, []);
    assert.equal(h.calls.length, during ? 1 : 0);
    assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_events WHERE event_type='receipt_match_ai_review'").get().n, 0);
    assert.equal(h.DB.sql.prepare("SELECT COUNT(*) n FROM payment_receipt_matches WHERE receipt_id='r1'").get().n, 0);
  }
});

test('changed relevant project evidence invalidates the cache while untouched business fields remain intact', async t => {
  const h = await fixture(t);
  assert.equal((await h.request()).status, 200);
  const state = JSON.parse(h.DB.sql.prepare("SELECT data FROM user_app_state WHERE user_id='admin'").get().data);
  state.projects[0].tranches[0].winningAmountWan = 200;
  h.DB.sql.prepare("UPDATE user_app_state SET data=?, revision=revision+1 WHERE user_id='admin'").run(JSON.stringify(state));
  assert.equal((await (await h.request()).json()).cached, false);
  assert.equal(h.calls.length, 2);
  assert.equal(h.DB.sql.prepare("SELECT amount_fen FROM payment_receipts WHERE id='r1'").get().amount_fen, receipt.amountFen);
});
