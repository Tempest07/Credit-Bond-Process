import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { ensureAuthSchema } from '../functions/api/_auth.js';
import { ensurePaymentReceiptSchema, insertPaymentReceiptBatch, insertPaymentReceiptFile,
  insertPaymentReceipt, insertPaymentReceiptMatch } from '../functions/api/_payment-receipts.js';
import { requestPaymentReceiptRebuild, readPaymentReceiptRebuild } from '../functions/api/_payment-receipt-rebuild.js';
import { finalizePaymentReceiptRebuild } from '../payment-receipt-rebuild-finalize.js';

const NOW = '2026-10-29T02:00:00.000Z';
async function fixture(t, { same = true, projects = true } = {}) {
  const DB = createMemoryD1(); t.after(() => DB.sql.close()); DB.sql.exec('PRAGMA foreign_keys=ON');
  const prepare = DB.prepare, batch = DB.batch.bind(DB);
  let beforeBatch, beforeRun;
  const wrap = (query, statement) => ({ ...statement, query,
    bind(...values) { return wrap(query, statement.bind(...values)); },
    async all() { return statement.execute(); },
    async run() {
      if (beforeRun?.predicate(query)) { const hook = beforeRun; beforeRun = null; await hook.action(); }
      return statement.execute();
    },
  });
  DB.prepare = query => wrap(query, prepare(query));
  DB.batch = async statements => {
    if (beforeBatch && statements.some(statement => beforeBatch.predicate(statement.query))) {
      const hook = beforeBatch; beforeBatch = null; await hook.action();
    }
    return batch(statements);
  };
  await ensureAuthSchema(DB); await ensurePaymentReceiptSchema(DB);
  await insertPaymentReceiptBatch(DB, { id: 'batch', ownerUserId: 'admin', messageId: 'msg', receivedAt: NOW,
    receivedDate: '2026-10-29', rawObjectKey: 'original.eml', processingStatus: 'processed', createdAt: NOW });
  for (const [index, id] of ['a', 'b'].entries()) {
    await insertPaymentReceiptFile(DB, { id, batchId: 'batch', filename: id + '.pdf', mimeType: 'application/pdf', byteSize: 1,
      sha256: 'source-' + id, objectKey: id + '.pdf', pageCount: 1, processingStatus: 'processed', createdAt: NOW });
    await insertPaymentReceipt(DB, { id: 'r-' + id, ownerUserId: 'admin', batchId: 'batch', fileId: id,
      sourcePages: [1], sourcePageLabel: '1', objectKey: 'r-' + id + '.pdf', sha256: same ? 'fingerprint' : id,
      bondShortName: '26测试MTN001', securityCode: '102699001', paymentDate: '2026-10-29', amountFen: 1000000000,
      recognitionStatus: 'recognized', matchStatus: 'review', createdAt: index ? NOW : '2026-10-28T01:00:00.000Z' });
  }
  if (projects) DB.sql.prepare("UPDATE user_app_state SET data=? WHERE user_id='admin'").run(JSON.stringify({ projects: [{
    id: 'project', shortName: '26测试MTN001', tranches: [{ id: 'tranche', shortName: '26测试MTN001',
      securityCode: '102699001', paymentDate: '2026-10-29', winningAmountWan: 1000 }],
  }], issuers: [] }));
  const env = { DB }, run = await requestPaymentReceiptRebuild(env, 'admin', { all: true });
  DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='processed',error_message='',grouping_json=?").run(JSON.stringify({ processing: { rebuildId: run.rebuild.id, stage: 'complete' } }));
  DB.sql.prepare("UPDATE payment_receipts SET recognition_status='recognized',match_status='review',error_message=''").run();
  const completed = () => Boolean(DB.sql.prepare("SELECT id FROM payment_receipt_events WHERE id=?").get(run.rebuild.id + ':completed'));
  const receipt = id => DB.sql.prepare('SELECT * FROM payment_receipts WHERE id=?').get(id);
  const match = id => DB.sql.prepare('SELECT * FROM payment_receipt_matches WHERE receipt_id=?').get(id);
  const manual = id => insertPaymentReceiptMatch(DB, { id: 'manual-' + id, ownerUserId: 'admin', receiptId: id,
    projectId: 'manual-project', trancheId: 'manual-tranche', matchSource: 'manual', createdAt: '2026-10-29T03:00:00.000Z' });
  return { DB, env, id: run.rebuild.id, completed, receipt, match, manual,
    beforeBatch(predicate, action) { beforeBatch = { predicate, action }; },
    beforeRun(predicate, action) { beforeRun = { predicate, action }; },
  };
}

test('deleting a canonical receipt immediately before settlement does not turn the remaining copy into an orphan duplicate', async t => {
  const h = await fixture(t);
  h.beforeBatch(query => /receipt_duplicate_reconciled/.test(query), () => h.DB.sql.prepare("DELETE FROM payment_receipts WHERE id='r-a'").run());
  const result = await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  assert.equal(result.deferred, true);
  assert.equal(h.receipt('r-b').match_status, 'review');
  assert.equal(h.completed(), false);
  await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  assert.equal(h.receipt('r-b').match_status, 'matched');
  assert.equal(h.match('r-b').project_id, 'project');
  assert.equal(h.completed(), true);
});

test('a manual match committed during duplicate settlement wins and is never removed or marked duplicate', async t => {
  const h = await fixture(t);
  h.beforeBatch(query => /receipt_duplicate_reconciled/.test(query), () => h.manual('r-b'));
  const result = await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  assert.equal(result.deferred, true);
  assert.equal(h.receipt('r-b').match_status, 'matched');
  assert.equal(h.match('r-b').match_source, 'manual');
  assert.equal(h.completed(), false);
  await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  assert.equal(h.match('r-b').match_source, 'manual');
  assert.equal(h.receipt('r-a').match_status, 'duplicate');
});

test('the no-match update cannot overwrite a manual assignment made after its receipt read', async t => {
  const h = await fixture(t, { same: false, projects: false });
  h.beforeRun(query => /UPDATE payment_receipts AS r SET match_status=\?6/.test(query), () => h.manual('r-a'));
  const result = await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  assert.equal(result.deferred, true);
  assert.equal(h.receipt('r-a').match_status, 'matched');
  assert.equal(h.match('r-a').match_source, 'manual');
  assert.equal(h.completed(), false);
});

test('a new rebuild starting before automatic matching blocks stale matches and the old completion marker', async t => {
  const h = await fixture(t, { same: false });
  h.beforeBatch(query => /INSERT INTO payment_receipt_matches/.test(query), () => {
    h.DB.sql.prepare("UPDATE payment_receipt_files SET processing_status='reprocess_requested',grouping_json=?").run(JSON.stringify({ processing: { rebuildId: 'new-run', stage: 'queued' } }));
    h.DB.sql.prepare("UPDATE payment_receipts SET match_status='review',error_message='正在重新识别',updated_at='new-version'").run();
  });
  const result = await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  assert.equal(result.deferred, true);
  assert.equal(h.match('r-a'), undefined);
  assert.equal(h.match('r-b'), undefined);
  assert.equal(h.receipt('r-a').error_message, '正在重新识别');
  assert.equal(h.completed(), false);
});

test('a new file run already present before finalization causes no writes', async t => {
  const h = await fixture(t);
  h.DB.sql.prepare("UPDATE payment_receipt_files SET grouping_json=? WHERE id='b'").run(JSON.stringify({ processing: { rebuildId: 'new-run', stage: 'complete' } }));
  const before = h.DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all();
  assert.equal(await finalizePaymentReceiptRebuild(h.env, 'admin', h.id), null);
  assert.deepEqual(h.DB.sql.prepare('SELECT * FROM payment_receipts ORDER BY id').all(), before);
  assert.equal(h.completed(), false);
});

test('durable progress remains finalizing until the final sweep commits its completion marker', async t => {
  const h = await fixture(t);
  const before = await readPaymentReceiptRebuild(h.DB, 'admin', h.id);
  assert.equal(before.status, 'completed');
  assert.equal(before.finalized, false);
  assert.equal(before.finalizing, true);
  const repeated = await requestPaymentReceiptRebuild(h.env, 'admin', { all: true });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.rebuild.id, h.id);
  await finalizePaymentReceiptRebuild(h.env, 'admin', h.id);
  const after = await readPaymentReceiptRebuild(h.DB, 'admin', h.id);
  assert.equal(after.finalized, true);
  assert.equal(after.finalizing, false);
});

test('parallel finalizers preserve the unique project correspondence and append at most one completion event', async t => {
  const h = await fixture(t);
  await Promise.all([finalizePaymentReceiptRebuild(h.env, 'admin', h.id), finalizePaymentReceiptRebuild(h.env, 'admin', h.id)]);
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) count FROM payment_receipt_matches WHERE project_id='project'").get().count, 1);
  assert.equal(h.receipt('r-b').match_status, 'duplicate');
  assert.equal(h.DB.sql.prepare("SELECT COUNT(*) count FROM payment_receipt_events WHERE event_type='library_rebuild_completed'").get().count, 1);
});
