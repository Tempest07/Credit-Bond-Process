import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as onLoginPost } from "../functions/api/auth/login.js";
import { onRequestPost as onLogoutPost } from "../functions/api/auth/logout.js";
import { onRequestGet as onSessionGet } from "../functions/api/auth/session.js";
import { onRequestGet, onRequestPut } from "../functions/api/state.js";

test("rejects remote state access without a gateway assertion", async () => {
  const response = await onRequestGet({
    env: {},
    request: new Request("https://example.com/api/state"),
  });
  assert.equal(response.status, 401);
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
          projects: [{ id: "p1", shortName: "26测试01" }],
          protocolTransfers: [{ id: "t1", code: "281926.SH", shortName: "26光交01" }],
          secondaryInventoryPositions: [{ id: "s1", code: "280680.SH", shortName: "25联投17", quantityWan: 5000 }],
          secondaryOrders: [{ id: "o1", code: "280680.SH", shortName: "25联投17", side: "offer", quantityWan: 2000 }],
          secondaryTrades: [{ id: "f1", code: "280680.SH", shortName: "25联投17", side: "sell", quantityWan: 1000 }],
          ftpCurve: { y1: 1.5 },
        },
      }),
    }),
  });
  const saved = JSON.parse(DB.userStates.get("admin").data);
  assert.equal(response.status, 200);
  assert.equal(saved.projects[0].shortName, "26测试01");
  assert.equal(saved.protocolTransfers[0].code, "281926.SH");
  assert.equal(saved.secondaryInventoryPositions[0].quantityWan, 5000);
  assert.equal(saved.secondaryOrders[0].side, "offer");
  assert.equal(saved.secondaryTrades[0].quantityWan, 1000);
  assert.equal(saved.ftpCurve.y1, 1.5);
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
