const ADMIN_USER_ID = "admin";
const ADMIN_USERNAME = "admin";
const ADMIN_NICKNAME = "管理员";
const GATEWAY_AUTH_HEADER = "X-Tempest-Auth";
const SESSION_COOKIE = "tempest07_session";

export const EMPTY_APP_STATE = {
  version: 4,
  issuers: [],
  projects: [],
  protocolTransfers: [],
  secondaryInventoryPositions: [],
  secondaryOrders: [],
  secondaryTrades: [],
  ftpCurve: {},
  reminderState: {},
  updatedAt: null,
};

export async function requireUser(context) {
  const gatewayUser = await gatewayUserFromRequest(context.request, context.env);
  if (gatewayUser) return { user: gatewayUser };
  if (isLocalRequest(context.request)) return { user: adminUser() };
  return { response: json({ error: "Unauthorized" }, 401) };
}

export async function ensureAuthSchema(db) {
  if (!db) throw new Error("Cloudflare D1 binding DB is not configured");
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_app_state (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await ensureAdminUser(db);
  await migrateLegacyStateToAdmin(db);
}

export async function readUserAppState(db, userId) {
  const row = await db.prepare(`
    SELECT data, updated_at
    FROM user_app_state
    WHERE user_id = ?1
  `).bind(userId).first();
  return {
    data: row?.data ? JSON.parse(row.data) : { ...EMPTY_APP_STATE },
    updatedAt: row?.updated_at || null,
  };
}

export async function writeUserAppState(db, userId, data, updatedAt) {
  await db.prepare(`
    INSERT INTO user_app_state (user_id, data, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(data), updatedAt).run();
}

export function adminUser() {
  return {
    id: ADMIN_USER_ID,
    username: ADMIN_USERNAME,
    nickname: ADMIN_NICKNAME,
    role: "admin",
  };
}

export function publicUser(row = {}) {
  return {
    id: String(row.id || ""),
    username: String(row.username || ""),
    nickname: String(row.nickname || row.username || ""),
    role: String(row.role || "user"),
  };
}

export async function gatewayUserFromRequest(request, env = {}) {
  const secret = gatewayAuthSecret(env);
  if (!secret) return null;
  const token = request.headers.get(GATEWAY_AUTH_HEADER) || cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifySignedPayload(token, secret);
  if (!payload || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (payload.username !== ADMIN_USERNAME) return null;
  return publicUser({
    id: payload.sub || ADMIN_USER_ID,
    username: payload.username || ADMIN_USERNAME,
    nickname: payload.nickname || ADMIN_NICKNAME,
    role: payload.role || "admin",
  });
}

export function isLocalRequest(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function apiHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...apiHeaders(), ...extraHeaders },
  });
}

async function ensureAdminUser(db) {
  const existing = await db.prepare("SELECT id FROM users WHERE username = ?1").bind(ADMIN_USERNAME).first();
  if (existing) return;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO users (id, username, nickname, role, password_salt, password_hash, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'admin', ?4, ?5, ?6, ?6)
  `).bind(ADMIN_USER_ID, ADMIN_USERNAME, ADMIN_NICKNAME, "gateway", "disabled", now).run();
}

async function migrateLegacyStateToAdmin(db) {
  const existing = await db.prepare("SELECT user_id FROM user_app_state WHERE user_id = ?1").bind(ADMIN_USER_ID).first();
  if (existing) return;

  let legacy = null;
  try {
    legacy = await db.prepare("SELECT data, updated_at FROM app_state WHERE id = 1").first();
  } catch {
    legacy = null;
  }
  const updatedAt = legacy?.updated_at || new Date().toISOString();
  const data = legacy?.data || JSON.stringify({ ...EMPTY_APP_STATE, updatedAt });
  await db.prepare(`
    INSERT INTO user_app_state (user_id, data, updated_at)
    VALUES (?1, ?2, ?3)
  `).bind(ADMIN_USER_ID, data, updatedAt).run();
}

async function verifySignedPayload(token, secret) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !secret) return null;
  const expected = await hmacHex(secret, body);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    return JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(value || "")));
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function base64UrlDecode(value) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function gatewayAuthSecret(env = {}) {
  return String(env.TEMPEST_AUTH_SECRET || env.GATEWAY_AUTH_SECRET || "").trim();
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("=") || "");
    } catch {
      return "";
    }
  }
  return "";
}
