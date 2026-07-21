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

test("accepts and preserves project ledger records under admin", async () => {
  const DB = createMockDb();
  const token = await gatewayToken("correct");
  const response = await onRequestPut({
    env: { GATEWAY_AUTH_SECRET: "correct", DB },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { "X-Tempest-Auth": token },
      body: JSON.stringify({
        data: {
          version: 3,
          issuers: [],
          projects: [{ id: "p1", shortName: "26测试01", tranches: [{ id: "t1", prepaymentNumber: "W2026071500003" }] }],
          protocolTransfers: [{ id: "t1", code: "281926.SH", shortName: "26光交01" }],
          secondaryInventoryPositions: [{ id: "s1", code: "280680.SH", shortName: "25联投17", quantityWan: 5000 }],
          secondaryOrders: [{ id: "o1", code: "280680.SH", shortName: "25联投17", side: "offer", quantityWan: 2000 }],
          secondaryTrades: [{ id: "f1", code: "280680.SH", shortName: "25联投17", side: "sell", quantityWan: 1000 }],
          ftpCurve: { y1: 1.5 },
          reminderState: { dailyMailSentDates: ["2026-07-10"] },
        },
      }),
    }),
  });
  const saved = JSON.parse(DB.userStates.get("admin").data);
  assert.equal(response.status, 200);
  assert.equal(saved.projects[0].shortName, "26测试01");
  assert.equal(saved.projects[0].tranches[0].prepaymentNumber, "W2026071500003");
  assert.equal(saved.protocolTransfers[0].code, "281926.SH");
  assert.equal(saved.secondaryInventoryPositions[0].quantityWan, 5000);
  assert.equal(saved.secondaryOrders[0].side, "offer");
  assert.equal(saved.secondaryTrades[0].quantityWan, 1000);
  assert.equal(saved.ftpCurve.y1, 1.5);
  assert.deepEqual(saved.reminderState.dailyMailSentDates, ["2026-07-10"]);
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
  const legacyState = legacyData
    ? { data: JSON.stringify(legacyData), updated_at: "2026-07-02T00:00:00.000Z" }
    : null;

  const db = {
    users,
    userStates,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async run() {
          if (/CREATE TABLE/i.test(sql)) return {};
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
            return {};
          }
          if (/INSERT INTO user_app_state/i.test(sql)) {
            const [userId, data, updatedAt] = values;
            userStates.set(userId, { user_id: userId, data, updated_at: updatedAt });
            return {};
          }
          return {};
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
          if (/SELECT data, updated_at\s+FROM user_app_state/i.test(sql)) {
            return userStates.get(values[0]) || null;
          }
          return null;
        },
      };
    },
  };
  return db;
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
