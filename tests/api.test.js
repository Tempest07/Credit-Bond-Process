import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as onLoginPost } from "../functions/api/auth/login.js";
import { onRequestPost as onLogoutPost } from "../functions/api/auth/logout.js";
import { onRequestGet as onSessionGet } from "../functions/api/auth/session.js";
import { onRequestGet as onRemindersGet } from "../functions/api/reminders.js";
import { onRequestGet as onPaymentReceiptsGet } from "../functions/api/payment-receipts.js";
import { onRequestGet as onPaymentReceiptCoverageGet } from "../functions/api/payment-receipt-coverage.js";
import {
  onRequestDelete as onPaymentReceiptDelete,
  onRequestPatch as onPaymentReceiptPatch,
} from "../functions/api/payment-receipts/[id].js";
import { onRequestGet as onPaymentReceiptFileGet } from "../functions/api/payment-receipts/[id]/file.js";
import { onRequestGet as onPaymentReceiptSourceGet } from "../functions/api/payment-receipts/[id]/source.js";
import { onRequestGet as onPaymentReceiptEmailGet } from "../functions/api/payment-receipts/[id]/email.js";
import { onRequestGet as onPendingReceiptFileGet } from "../functions/api/payment-receipt-files/[id]/file.js";
import { onRequestGet as onPendingReceiptEmailGet } from "../functions/api/payment-receipt-files/[id]/email.js";
import { onRequestGet as onPendingReceiptPagesGet } from "../functions/api/payment-receipt-files/[id]/pages.js";
import { onRequestPost as onPendingReceiptRegroupPost } from "../functions/api/payment-receipt-files/[id]/regroup.js";
import { onRequestGet as onPendingReceiptBatchEmailGet } from "../functions/api/payment-receipt-batches/[id]/email.js";
import { onRequestGet, onRequestPut } from "../functions/api/state.js";
import { onRequestGet as onStateHistoryGet } from "../functions/api/state-history.js";
import {
  onRequestGet as onStateSnapshotGet,
  onRequestPost as onStateSnapshotPost,
} from "../functions/api/state-history/[id].js";

test("rejects remote state access without a gateway assertion", async () => {
  const response = await onRequestGet({
    env: {},
    request: new Request("https://example.com/api/state"),
  });
  assert.equal(response.status, 401);
});

test("protects every payment-receipt archive, mutation and original-file route", async () => {
  const calls = [
    () => onPaymentReceiptsGet({ env: {}, request: new Request("https://example.com/api/payment-receipts") }),
    () => onPaymentReceiptCoverageGet({ env: {}, request: new Request("https://example.com/api/payment-receipt-coverage") }),
    () => onPaymentReceiptPatch({
      env: {},
      params: { id: "receipt-1" },
      request: new Request("https://example.com/api/payment-receipts/receipt-1", { method: "PATCH" }),
    }),
    () => onPaymentReceiptDelete({
      env: {},
      params: { id: "receipt-1" },
      request: new Request("https://example.com/api/payment-receipts/receipt-1", { method: "DELETE" }),
    }),
    () => onPaymentReceiptFileGet({ env: {}, params: { id: "receipt-1" }, request: new Request("https://example.com/api/payment-receipts/receipt-1/file") }),
    () => onPaymentReceiptSourceGet({ env: {}, params: { id: "receipt-1" }, request: new Request("https://example.com/api/payment-receipts/receipt-1/source") }),
    () => onPaymentReceiptEmailGet({ env: {}, params: { id: "receipt-1" }, request: new Request("https://example.com/api/payment-receipts/receipt-1/email") }),
    () => onPendingReceiptFileGet({ env: {}, params: { id: "file-1" }, request: new Request("https://example.com/api/payment-receipt-files/file-1/file") }),
    () => onPendingReceiptEmailGet({ env: {}, params: { id: "file-1" }, request: new Request("https://example.com/api/payment-receipt-files/file-1/email") }),
    () => onPendingReceiptPagesGet({ env: {}, params: { id: "file-1" }, request: new Request("https://example.com/api/payment-receipt-files/file-1/pages") }),
    () => onPendingReceiptRegroupPost({ env: {}, params: { id: "file-1" }, request: new Request("https://example.com/api/payment-receipt-files/file-1/regroup", { method: "POST" }) }),
    () => onPendingReceiptBatchEmailGet({ env: {}, params: { id: "batch-1" }, request: new Request("https://example.com/api/payment-receipt-batches/batch-1/email") }),
  ];

  for (const call of calls) assert.equal((await call()).status, 401);
});

test("filters the receipt archive by payment date and excludes undated pending items", async () => {
  const DB = createReceiptArchiveListDb();
  const response = await onPaymentReceiptsGet({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/payment-receipts?date=2026-07-17"),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.receipts[0].archiveDate, "2026-07-17");
  assert.deepEqual(payload.pendingFiles, []);
  assert.deepEqual(payload.pendingBatches, []);
  assert.equal(DB.pendingQueries, 0);
  assert.match(DB.receiptQuery, /r\.payment_date = \?/);
  assert.doesNotMatch(DB.receiptQuery, /COALESCE\s*\(\s*r\.payment_date/i);
});

test("shows undated pending originals only in the all-dates archive", async () => {
  const DB = createReceiptArchiveListDb();
  const response = await onPaymentReceiptsGet({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/payment-receipts"),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.pendingFiles[0].archiveDate, "");
  assert.equal(payload.pendingBatches[0].archiveDate, "");
  assert.equal(payload.pendingFiles[0].receivedAt, "2026-07-21T14:00:00.000Z");
  assert.equal(payload.pendingBatches[0].receivedAt, "2026-07-21T14:00:00.000Z");
  assert.equal(DB.pendingQueries, 2);
});

test("deletes only a duplicate receipt and its exclusively owned R2 archives", async () => {
  const DB = createReceiptDeletionDb({ matchStatus: "duplicate", fileReceiptCount: 1, batchFileCount: 1 });
  let deletedKeys = null;
  const response = await onPaymentReceiptDelete({
    env: {
      DB,
      PAYMENT_RECEIPTS: {
        async delete(keys) { deletedKeys = keys; },
      },
    },
    params: { id: "receipt-duplicate" },
    request: new Request("http://127.0.0.1:8788/api/payment-receipts/receipt-duplicate?action=delete-duplicate", {
      method: "DELETE",
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.deleted, true);
  assert.equal(payload.deletedSourceFile, true);
  assert.equal(payload.deletedEmailArchive, true);
  assert.equal(payload.storageCleanup, true);
  assert.deepEqual(deletedKeys, ["receipts/duplicate.pdf", "attachments/duplicate.pdf", "emails/duplicate.eml"]);
  assert.ok(DB.mutations.some((sql) => /DELETE FROM payment_receipts[\s\S]+match_status = 'duplicate'/i.test(sql)));
  assert.ok(DB.mutations.some((sql) => /receipt_duplicate_deleted/i.test(sql)));
});

test("preserves shared source archives when deleting one duplicate receipt", async () => {
  const DB = createReceiptDeletionDb({ matchStatus: "duplicate", fileReceiptCount: 2, batchFileCount: 1 });
  let deletedKeys = null;
  const response = await onPaymentReceiptDelete({
    env: {
      DB,
      PAYMENT_RECEIPTS: {
        async delete(keys) { deletedKeys = keys; },
      },
    },
    params: { id: "receipt-duplicate" },
    request: new Request("http://127.0.0.1:8788/api/payment-receipts/receipt-duplicate?action=delete-duplicate", {
      method: "DELETE",
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.deletedSourceFile, false);
  assert.equal(payload.deletedEmailArchive, false);
  assert.deepEqual(deletedKeys, ["receipts/duplicate.pdf"]);
});

test("refuses to delete a non-duplicate payment receipt", async () => {
  const DB = createReceiptDeletionDb({ matchStatus: "matched" });
  let storageTouched = false;
  const response = await onPaymentReceiptDelete({
    env: {
      DB,
      PAYMENT_RECEIPTS: {
        async delete() { storageTouched = true; },
      },
    },
    params: { id: "receipt-duplicate" },
    request: new Request("http://127.0.0.1:8788/api/payment-receipts/receipt-duplicate?action=delete-duplicate", {
      method: "DELETE",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(storageTouched, false);
  assert.equal(DB.mutations.some((sql) => /DELETE FROM payment_receipts/i.test(sql)), false);
});

test("blocks manual receipt regrouping while automatic PDF processing is active", async () => {
  const DB = createRegroupGuardDb({
    id: "file-1",
    batch_id: "batch-1",
    processing_status: "processing",
    updated_at: "2026-07-21T01:00:00.000Z",
  });
  let objectReads = 0;
  const response = await onPendingReceiptRegroupPost({
    env: { DB, PAYMENT_RECEIPTS: { async get() { objectReads += 1; return null; } } },
    params: { id: "file-1" },
    request: new Request("http://127.0.0.1:8788/api/payment-receipt-files/file-1/regroup", {
      method: "POST",
      body: JSON.stringify({ groups: [[1]], blankPages: [], expectedUpdatedAt: "2026-07-21T01:00:00.000Z" }),
    }),
  });
  assert.equal(response.status, 409);
  assert.equal(objectReads, 0);
});

test("rejects a stale manual receipt regroup revision before touching R2", async () => {
  const DB = createRegroupGuardDb({
    id: "file-1",
    batch_id: "batch-1",
    processing_status: "review",
    updated_at: "2026-07-21T02:00:00.000Z",
  });
  let objectReads = 0;
  const response = await onPendingReceiptRegroupPost({
    env: { DB, PAYMENT_RECEIPTS: { async get() { objectReads += 1; return null; } } },
    params: { id: "file-1" },
    request: new Request("http://127.0.0.1:8788/api/payment-receipt-files/file-1/regroup", {
      method: "POST",
      body: JSON.stringify({ groups: [[1]], blankPages: [], expectedUpdatedAt: "2026-07-21T01:00:00.000Z" }),
    }),
  });
  assert.equal(response.status, 409);
  assert.equal(objectReads, 0);
});

test("allows local D1 access without a gateway assertion", async () => {
  const DB = createMockDb();
  const response = await onRequestGet({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state"),
  });
  assert.equal(response.status, 200);
});

test("rejects an invalid gateway assertion", async () => {
  const response = await onRequestPut({
    env: { GATEWAY_AUTH_SECRET: "correct" },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { "X-Tempest-Auth": "bad-token" },
      body: JSON.stringify({ data: { version: 1, issuers: [] } }),
    }),
  });
  assert.equal(response.status, 401);
});

test("rejects ordinary 50206 records from the ABS approval collection", async () => {
  const DB = createMockDb();
  const response = await onRequestPut({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: 0,
        data: {
          version: 5,
          issuers: [],
          absCreditApprovals: [{ id: "wrong", businessCode: "50206" }],
        },
      }),
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /只能保存业务代码 50217/);
});

test("accepts and preserves project ledger records under admin", async () => {
  const DB = createMockDb();
  const token = await gatewayToken("correct");
  const response = await onRequestPut({
    env: { GATEWAY_AUTH_SECRET: "correct", DB },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { "X-Tempest-Auth": token },
      body: JSON.stringify({
        expectedRevision: 0,
        data: {
          version: 3,
          issuers: [],
          absCreditApprovals: [{
            id: "a1",
            businessCode: "50217",
            enhancerIssuerId: "i1",
            enhancerName: "测试增信方",
            scopeType: "SHELF",
            shelfName: "测试储架",
          }],
          projects: [{ id: "p1", shortName: "26测试01", tranches: [{ id: "t1", prepaymentNumber: "W2026071500003" }] }],
          protocolTransfers: [{ id: "t1", code: "281926.SH", shortName: "26光交01" }],
          secondaryInventoryPositions: [{ id: "s1", code: "280680.SH", shortName: "25联投17", quantityWan: 5000 }],
          secondaryOrders: [{ id: "o1", code: "280680.SH", shortName: "25联投17", side: "offer", quantityWan: 2000 }],
          secondaryTrades: [{
            id: "f1",
            code: "280680.SH",
            shortName: "25联投17",
            side: "sell",
            quantityWan: 1000,
            tradeRecordSource: "trade-phraser-54d42a6",
            tradeRecord: {
              谈判日: "2026-07-23",
              交易日: "2026-07-24",
              债券代码: "280680.SH",
              "面值（万元）": "1000",
            },
          }],
          ftpCurve: { y1: 1.5 },
          reminderState: { dailyMailSentDates: ["2026-07-10"] },
        },
      }),
    }),
  });
  const saved = JSON.parse(DB.userStates.get("admin").data);
  assert.equal(response.status, 200);
  assert.equal(saved.projects[0].shortName, "26测试01");
  assert.equal(saved.version, 5);
  assert.equal(saved.absCreditApprovals[0].businessCode, "50217");
  assert.equal(saved.absCreditApprovals[0].shelfName, "测试储架");
  assert.equal(saved.projects[0].tranches[0].prepaymentNumber, "W2026071500003");
  assert.equal(saved.protocolTransfers[0].code, "281926.SH");
  assert.equal(saved.secondaryInventoryPositions[0].quantityWan, 5000);
  assert.equal(saved.secondaryOrders[0].side, "offer");
  assert.equal(saved.secondaryTrades[0].quantityWan, 1000);
  assert.equal(saved.secondaryTrades[0].tradeRecordSource, "trade-phraser-54d42a6");
  assert.equal(saved.secondaryTrades[0].tradeRecord["债券代码"], "280680.SH");
  assert.equal(saved.ftpCurve.y1, 1.5);
  assert.deepEqual(saved.reminderState.dailyMailSentDates, ["2026-07-10"]);
  const payload = await response.clone().json();
  assert.equal(payload.revision, 1);
  assert.equal(payload.snapshot.revision, 1);
  assert.equal(JSON.parse(DB.legacyState.data).projects[0].shortName, "26测试01");
});

test("preserves a stale writer as a conflict snapshot instead of overwriting current state", async () => {
  const DB = createMockDb();
  const first = await onRequestPut({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: 0,
        meta: { source: "autosave", clientId: "client-a", clientLabel: "设备 A" },
        data: { version: 5, issuers: [{ id: "a", legalName: "来源 A" }] },
      }),
    }),
  });
  const second = await onRequestPut({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: 0,
        meta: { source: "autosave", clientId: "client-b", clientLabel: "设备 B" },
        data: { version: 5, issuers: [{ id: "b", legalName: "来源 B" }] },
      }),
    }),
  });
  const conflict = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(JSON.parse(DB.userStates.get("admin").data).issuers[0].legalName, "来源 A");
  assert.equal(conflict.revision, 1);
  assert.equal(conflict.conflictSnapshot.status, "conflict");
  assert.equal(conflict.conflictSnapshot.clientLabel, "设备 B");

  const historyResponse = await onStateHistoryGet({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state-history"),
  });
  const history = await historyResponse.json();
  assert.equal(history.snapshots.some((snapshot) => snapshot.revision === 1 && snapshot.status === "accepted"), true);
  assert.equal(history.snapshots.some((snapshot) => snapshot.status === "conflict"), true);

  const detailResponse = await onStateSnapshotGet({
    env: { DB },
    params: { id: encodeURIComponent(conflict.conflictSnapshot.id) },
    request: new Request(`http://127.0.0.1:8788/api/state-history/${encodeURIComponent(conflict.conflictSnapshot.id)}`),
  });
  const detail = await detailResponse.json();
  assert.equal(detail.snapshot.data.issuers[0].legalName, "来源 B");

  const revertResponse = await onStateSnapshotPost({
    env: { DB },
    params: { id: conflict.conflictSnapshot.id },
    request: new Request(`http://127.0.0.1:8788/api/state-history/${conflict.conflictSnapshot.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "revert", expectedRevision: 1, meta: { clientLabel: "设备 A" } }),
    }),
  });
  const reverted = await revertResponse.json();
  assert.equal(revertResponse.status, 200);
  assert.equal(reverted.revision, 2);
  assert.equal(reverted.snapshot.saveReason, "revert");
  assert.equal(reverted.snapshot.restoredFromSnapshotId, conflict.conflictSnapshot.id);
  assert.equal(JSON.parse(DB.userStates.get("admin").data).issuers[0].legalName, "来源 B");
  assert.equal([...DB.snapshots.values()].some((snapshot) => snapshot.revision === 1), true);
});

test("requires a base revision and rejects state bodies beyond the D1-safe limit", async () => {
  const DB = createMockDb();
  const missingRevision = await onRequestPut({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state", {
      method: "PUT",
      body: JSON.stringify({ data: { version: 5, issuers: [] } }),
    }),
  });
  assert.equal(missingRevision.status, 428);

  const tooLarge = await onRequestPut({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: 0,
        data: { version: 5, issuers: [{ id: "large", legalName: "超大主体", notes: "x".repeat(1_810_000) }] },
      }),
    }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).code, "state_too_large");
});

test("reads migrated legacy state with gateway auth", async () => {
  const DB = createMockDb({
    legacyData: {
      version: 3,
      issuers: [{ id: "issuer-1", legalName: "测试主体" }],
      projects: [],
    },
  });
  const token = await gatewayToken("correct");
  const stateResponse = await onRequestGet({
    env: { GATEWAY_AUTH_SECRET: "correct", DB },
    request: new Request("https://example.com/api/state", {
      headers: { "X-Tempest-Auth": token },
    }),
  });
  assert.equal(stateResponse.status, 200);
  const statePayload = await stateResponse.json();
  assert.equal(statePayload.user.username, "admin");
  assert.equal(statePayload.user.nickname, "管理员");
  assert.equal(statePayload.data.issuers[0].legalName, "测试主体");
});

test("returns unified reminders for the Android app bridge", async () => {
  const DB = createMockDb();
  const writeResponse = await onRequestPut({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state", {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: 0,
        data: {
          version: 4,
          issuers: [],
          projects: [
            { id: "p1", shortName: "26测试SCP001", status: "未投标", cutoffAt: "2026-07-08T18:00", cutoffTimeConfirmed: true },
            {
              id: "p2",
              shortName: "26缴款SCP001",
              status: "待缴款",
              resultConfirmed: true,
              tranches: [{ id: "t1", shortName: "26缴款SCP001", resultStatus: "中标", paymentDate: "2026-07-08" }],
            },
          ],
          protocolTransfers: [],
        },
      }),
    }),
  });
  assert.equal(writeResponse.status, 200);

  const response = await onRemindersGet({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/reminders?now=2026-07-08T09:00:00%2B08:00"),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.user.username, "admin");
  assert.equal(payload.reminders.some((item) => item.kind === "flow-mail"), true);
  assert.equal(payload.reminders.some((item) => item.kind === "project-payment" && item.pushPolicy === "daily"), true);
});

test("project auth session only reflects gateway auth", async () => {
  const token = await gatewayToken("correct");
  const sessionResponse = await onSessionGet({
    env: { GATEWAY_AUTH_SECRET: "correct" },
    request: new Request("https://example.com/api/auth/session", {
      headers: { "X-Tempest-Auth": token },
    }),
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.nickname, "管理员");
});

test("project auth session accepts the shared tempest07 cookie", async () => {
  const token = await gatewayToken("correct");
  const sessionResponse = await onSessionGet({
    env: { GATEWAY_AUTH_SECRET: "correct" },
    request: new Request("https://tempest07.com/bond-centre/api/auth/session", {
      headers: { Cookie: `tempest07_session=${encodeURIComponent(token)}` },
    }),
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.username, "admin");
});

test("project login and logout routes are disabled", async () => {
  const loginResponse = await onLoginPost({
    env: {},
    request: new Request("https://example.com/api/auth/login", { method: "POST" }),
  });
  assert.equal(loginResponse.status, 410);

  const logoutResponse = await onLogoutPost({
    env: {},
    request: new Request("https://example.com/api/auth/logout", { method: "POST" }),
  });
  assert.equal(logoutResponse.status, 410);
});

async function gatewayToken(secret, payload = {}) {
  const body = Buffer.from(JSON.stringify({
    sub: "admin",
    username: "admin",
    nickname: "管理员",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 300,
    ...payload,
  })).toString("base64url");
  return `${body}.${await hmacHex(secret, body)}`;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createMockDb({ legacyData = null } = {}) {
  const users = new Map();
  const userStates = new Map();
  const snapshots = new Map();
  let legacyState = legacyData
    ? { data: JSON.stringify(legacyData), updated_at: "2026-07-02T00:00:00.000Z" }
    : null;

  const db = {
    users,
    userStates,
    snapshots,
    get legacyState() { return legacyState; },
    prepare(sql) {
      let values = [];
      const statement = {
        sql,
        bind(...args) {
          values = args;
          return this;
        },
        async run() {
          if (/CREATE TABLE|CREATE INDEX|ALTER TABLE/i.test(sql)) return result(0);
          if (/INSERT INTO users/i.test(sql)) {
            const [id, username, nickname, passwordSalt, passwordHash, now] = values;
            users.set(username, {
              id,
              username,
              nickname,
              role: "admin",
              password_salt: passwordSalt,
              password_hash: passwordHash,
              created_at: now,
              updated_at: now,
            });
            return result(1);
          }
          if (/UPDATE user_app_state/i.test(sql)) {
            const [data, updatedAt, revision, userId, expectedRevision] = values;
            const current = userStates.get(userId);
            if (!current || current.revision !== expectedRevision) return result(0);
            userStates.set(userId, { ...current, data, updated_at: updatedAt, revision });
            return result(1);
          }
          if (/INSERT INTO user_app_state\s*\(/i.test(sql)) {
            const [userId, data, updatedAt] = values;
            const current = userStates.get(userId);
            userStates.set(userId, {
              user_id: userId,
              data,
              updated_at: updatedAt,
              revision: current?.revision || 0,
            });
            return result(1);
          }
          if (/INSERT OR IGNORE INTO user_app_state_snapshots/i.test(sql) && /FROM user_app_state/i.test(sql)) {
            let changes = 0;
            for (const row of userStates.values()) {
              if ([...snapshots.values()].some((snapshot) => snapshot.user_id === row.user_id && snapshot.revision === row.revision)) continue;
              const id = `${row.user_id}:revision:${row.revision}`;
              snapshots.set(id, {
                id,
                user_id: row.user_id,
                revision: row.revision,
                base_revision: row.revision > 0 ? row.revision - 1 : null,
                data: row.data,
                saved_at: row.updated_at,
                status: "accepted",
                save_reason: "migration",
                client_id: "",
                client_label: "历史云端状态",
                restored_from_snapshot_id: null,
                summary_json: '{"total":0,"collections":{},"settings":[]}',
                byte_size: Buffer.byteLength(row.data),
              });
              changes += 1;
            }
            return result(changes);
          }
          if (/INSERT INTO user_app_state_snapshots/i.test(sql) && /'conflict'/i.test(sql)) {
            const [id, userId, baseRevision, data, savedAt, saveReason, clientId, clientLabel, summaryJson, byteSize] = values;
            snapshots.set(id, {
              id,
              user_id: userId,
              revision: null,
              base_revision: baseRevision,
              data,
              saved_at: savedAt,
              status: "conflict",
              save_reason: saveReason,
              client_id: clientId,
              client_label: clientLabel,
              restored_from_snapshot_id: null,
              summary_json: summaryJson,
              byte_size: byteSize,
            });
            return result(1);
          }
          if (/INSERT INTO user_app_state_snapshots/i.test(sql) && /'accepted'/i.test(sql)) {
            const [id, userId, revision, baseRevision, data, savedAt, saveReason, clientId, clientLabel, restoredFrom, summaryJson, byteSize] = values;
            const current = userStates.get(userId);
            if (!current || current.revision !== revision || current.updated_at !== savedAt) return result(0);
            snapshots.set(id, {
              id,
              user_id: userId,
              revision,
              base_revision: baseRevision,
              data,
              saved_at: savedAt,
              status: "accepted",
              save_reason: saveReason,
              client_id: clientId,
              client_label: clientLabel,
              restored_from_snapshot_id: restoredFrom,
              summary_json: summaryJson,
              byte_size: byteSize,
            });
            return result(1);
          }
          if (/INSERT INTO app_state/i.test(sql)) {
            const [data, updatedAt, userId, revision] = values;
            const current = userStates.get(userId);
            if (!current || current.revision !== revision || current.updated_at !== updatedAt) return result(0);
            legacyState = { data, updated_at: updatedAt };
            return result(1);
          }
          if (/DELETE FROM user_app_state_snapshots/i.test(sql)) return result(0);
          return result(0);
        },
        async first() {
          if (/SELECT id FROM users WHERE username/i.test(sql)) {
            const user = users.get(values[0]);
            return user ? { id: user.id } : null;
          }
          if (/SELECT user_id FROM user_app_state WHERE user_id/i.test(sql)) {
            const row = userStates.get(values[0]);
            return row ? { user_id: row.user_id } : null;
          }
          if (/SELECT data, updated_at\s+FROM app_state/i.test(sql)) return legacyState;
          if (/SELECT data, updated_at, revision\s+FROM user_app_state/i.test(sql)) {
            return userStates.get(values[0]) || null;
          }
          if (/FROM user_app_state_snapshots/i.test(sql) && /WHERE user_id = \?1 AND id = \?2/i.test(sql)) {
            const row = snapshots.get(values[1]);
            return row?.user_id === values[0] ? row : null;
          }
          return null;
        },
        async all() {
          if (/PRAGMA table_info\(user_app_state\)/i.test(sql)) return { results: [{ name: "revision" }] };
          if (/FROM user_app_state_snapshots/i.test(sql)) {
            const rows = [...snapshots.values()]
              .filter((row) => row.user_id === values[0])
              .sort((left, right) => right.saved_at.localeCompare(left.saved_at))
              .slice(0, Number(values[1] || 50));
            return { results: rows };
          }
          return { results: [] };
        },
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return db;
}

function result(changes) {
  return { success: true, meta: { changes } };
}

function createReceiptArchiveListDb() {
  const receiptRow = {
    id: "receipt-1",
    payment_date: "2026-07-17",
    received_date: "2026-07-21",
    received_at: "2026-07-21T14:00:00.000Z",
  };
  const pendingRow = {
    id: "pending-1",
    received_date: "2026-07-21",
    received_at: "2026-07-21T14:00:00.000Z",
  };
  const db = {
    receiptQuery: "",
    pendingQueries: 0,
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
        async run() { return {}; },
        async first() {
          if (/SELECT id FROM users WHERE username/i.test(sql)) return { id: "admin" };
          if (/SELECT user_id FROM user_app_state WHERE user_id/i.test(sql)) return { user_id: "admin" };
          return null;
        },
        async all() {
          if (/PRAGMA table_info\(payment_receipt_files\)/i.test(sql)) {
            return { results: [{ name: "page_analysis_json" }, { name: "grouping_json" }] };
          }
          if (/PRAGMA table_info\(payment_receipt_batches\)/i.test(sql)) {
            return { results: [{ name: "raw_sha256" }] };
          }
          if (/FROM payment_receipts r\s+JOIN payment_receipt_batches/i.test(sql)) {
            db.receiptQuery = sql;
            return { results: [receiptRow] };
          }
          if (/FROM payment_receipt_files f\s+JOIN payment_receipt_batches/i.test(sql)) {
            db.pendingQueries += 1;
            return { results: [pendingRow] };
          }
          if (/FROM payment_receipt_batches b/i.test(sql)) {
            db.pendingQueries += 1;
            return { results: [pendingRow] };
          }
          return { results: [] };
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({}));
    },
  };
  return db;
}

function createRegroupGuardDb(file) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
        async first() {
          if (/SELECT f\.\*, b\.received_date/i.test(sql)) {
            return values[1] === file.id ? { ...file, received_date: "2026-07-21" } : null;
          }
          if (/SELECT id FROM users WHERE username/i.test(sql)) return { id: "admin" };
          return null;
        },
      };
    },
  };
}

function createReceiptDeletionDb({ matchStatus = "duplicate", fileReceiptCount = 1, batchFileCount = 1 } = {}) {
  const mutations = [];
  const receiptRow = {
    id: "receipt-duplicate",
    owner_user_id: "admin",
    batch_id: "batch-duplicate",
    file_id: "file-duplicate",
    source_pages_json: "[1]",
    source_page_label: "1",
    object_key: "receipts/duplicate.pdf",
    mime_type: "application/pdf",
    sha256: "duplicate-sha",
    payment_date: "2026-07-17",
    amount_fen: 30_000_000_000,
    bond_short_name: "26保利08",
    security_code: "245694.SH",
    recognized_text: "26保利08",
    recognition_status: "recognized",
    match_status: matchStatus,
    candidate_json: "[]",
    error_message: "",
    sender: "internal@example.com",
    subject: "重复缴款单",
    received_at: "2026-07-21T01:00:00.000Z",
    received_date: "2026-07-21",
    source_filename: "duplicate.pdf",
    blank_pages_json: "[]",
  };
  return {
    mutations,
    prepare(sql) {
      let values = [];
      return {
        sql,
        bind(...args) {
          values = args;
          return this;
        },
        async run() {
          if (/INSERT|UPDATE|DELETE/i.test(sql)) mutations.push(sql);
          return { meta: { changes: 1 } };
        },
        async all() {
          if (/PRAGMA table_info\(payment_receipt_files\)/i.test(sql)) {
            return { results: [{ name: "page_analysis_json" }, { name: "grouping_json" }] };
          }
          if (/PRAGMA table_info\(payment_receipt_batches\)/i.test(sql)) {
            return { results: [{ name: "raw_sha256" }] };
          }
          return { results: [] };
        },
        async first() {
          if (/SELECT id FROM users WHERE username/i.test(sql)) return { id: "admin" };
          if (/SELECT user_id FROM user_app_state WHERE user_id/i.test(sql)) return { user_id: "admin" };
          if (/SELECT r\.id, r\.batch_id, r\.file_id, r\.match_status/i.test(sql)) {
            return {
              id: receiptRow.id,
              batch_id: receiptRow.batch_id,
              file_id: receiptRow.file_id,
              match_status: matchStatus,
              receipt_object_key: receiptRow.object_key,
              file_object_key: "attachments/duplicate.pdf",
              raw_object_key: "emails/duplicate.eml",
              file_receipt_count: fileReceiptCount,
              batch_file_count: batchFileCount,
            };
          }
          if (/FROM payment_receipts r[\s\S]+WHERE r\.owner_user_id/i.test(sql)) {
            return values[1] === receiptRow.id ? receiptRow : null;
          }
          if (/SELECT data, updated_at FROM app_state/i.test(sql)) return null;
          return null;
        },
      };
    },
    async batch(statements) {
      statements.forEach((statement) => {
        if (/INSERT|UPDATE|DELETE/i.test(statement.sql)) mutations.push(statement.sql);
      });
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}
