import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as onLoginPost } from "../functions/api/auth/login.js";
import { onRequestPost as onLogoutPost } from "../functions/api/auth/logout.js";
import { onRequestGet as onSessionGet } from "../functions/api/auth/session.js";
import { onRequestGet, onRequestPut } from "../functions/api/state.js";

test("requires APP_PASSWORD to be configured", async () => {
  const response = await onRequestGet({
    env: {},
    request: new Request("https://example.com/api/state"),
  });
  assert.equal(response.status, 503);
});

test("allows local D1 access without APP_PASSWORD", async () => {
  const DB = createMockDb();
  const response = await onRequestGet({
    env: { DB },
    request: new Request("http://127.0.0.1:8788/api/state"),
  });
  assert.equal(response.status, 200);
});

test("rejects an incorrect API password", async () => {
  const response = await onRequestPut({
    env: { APP_PASSWORD: "correct" },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { Authorization: "Bearer incorrect" },
      body: JSON.stringify({ data: { version: 1, issuers: [] } }),
    }),
  });
  assert.equal(response.status, 401);
});

test("accepts and preserves project ledger records under admin", async () => {
  const DB = createMockDb();
  const response = await onRequestPut({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { Authorization: "Bearer correct" },
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
  assert.equal(saved.secondaryTrades[0].side, "sell");
  assert.equal(saved.ftpCurve.y1, 1.5);
});

test("logs in admin and reads migrated legacy state", async () => {
  const DB = createMockDb({
    legacyData: {
      version: 3,
      issuers: [{ id: "issuer-1", legalName: "测试主体" }],
      projects: [],
    },
  });
  const loginResponse = await onLoginPost({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct" }),
      headers: { "Content-Type": "application/json" },
    }),
  });
  assert.equal(loginResponse.status, 200);
  const loginPayload = await loginResponse.json();
  assert.equal(loginPayload.user.username, "admin");
  assert.equal(loginPayload.user.nickname, "管理员");
  assert.ok(loginPayload.token);

  const stateResponse = await onRequestGet({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/state", {
      headers: { Authorization: `Bearer ${loginPayload.token}` },
    }),
  });
  assert.equal(stateResponse.status, 200);
  const statePayload = await stateResponse.json();
  assert.equal(statePayload.user.username, "admin");
  assert.equal(statePayload.data.issuers[0].legalName, "测试主体");
});

test("sets a persistent session cookie and authenticates API calls with it", async () => {
  const DB = createMockDb({
    legacyData: {
      version: 3,
      issuers: [{ id: "issuer-cookie", legalName: "Cookie主体" }],
      projects: [],
    },
  });
  const loginResponse = await onLoginPost({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "correct" }),
      headers: { "Content-Type": "application/json" },
    }),
  });
  assert.equal(loginResponse.status, 200);
  const setCookie = loginResponse.headers.get("Set-Cookie");
  assert.match(setCookie, /bond_centre_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Max-Age=2592000/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = setCookie.split(";")[0];
  const sessionResponse = await onSessionGet({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/auth/session", {
      headers: { Cookie: cookie },
    }),
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.nickname, "管理员");

  const stateResponse = await onRequestGet({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/state", {
      headers: { Cookie: cookie },
    }),
  });
  assert.equal(stateResponse.status, 200);
  const statePayload = await stateResponse.json();
  assert.equal(statePayload.data.issuers[0].legalName, "Cookie主体");

  const logoutResponse = await onLogoutPost({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    }),
  });
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get("Set-Cookie"), /Max-Age=0/);
});

function createMockDb({ legacyData = null } = {}) {
  const users = new Map();
  const sessions = new Map();
  const userStates = new Map();
  const legacyState = legacyData
    ? { data: JSON.stringify(legacyData), updated_at: "2026-07-02T00:00:00.000Z" }
    : null;

  const db = {
    users,
    sessions,
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
            const [id, username, nickname, salt, passwordHash, now] = values;
            users.set(username, {
              id,
              username,
              nickname,
              role: "admin",
              password_salt: salt,
              password_hash: passwordHash,
              created_at: now,
              updated_at: now,
            });
            return {};
          }
          if (/INSERT INTO sessions/i.test(sql)) {
            const [tokenHash, userId, createdAt, expiresAt] = values;
            sessions.set(tokenHash, { token_hash: tokenHash, user_id: userId, created_at: createdAt, expires_at: expiresAt });
            return {};
          }
          if (/DELETE FROM sessions/i.test(sql)) {
            sessions.delete(values[0]);
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
          if (/password_salt/i.test(sql) && /FROM users/i.test(sql)) {
            return users.get(values[0]) || null;
          }
          if (/FROM sessions s/i.test(sql)) {
            const session = sessions.get(values[0]);
            if (!session || session.expires_at <= values[1]) return null;
            return [...users.values()].find((user) => user.id === session.user_id) || null;
          }
          if (/SELECT user_id FROM user_app_state/i.test(sql)) {
            return userStates.get(values[0]) ? { user_id: values[0] } : null;
          }
          if (/FROM user_app_state/i.test(sql)) {
            return userStates.get(values[0]) || null;
          }
          if (/FROM app_state/i.test(sql)) return legacyState;
          return null;
        },
      };
    },
  };

  return db;
}
