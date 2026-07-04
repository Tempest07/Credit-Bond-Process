const ADMIN_USER_ID = "admin";
const ADMIN_USERNAME = "admin";
const ADMIN_NICKNAME = "管理员";
const SESSION_COOKIE = "bond_centre_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export const EMPTY_APP_STATE = {
  version: 4,
  issuers: [],
  projects: [],
  protocolTransfers: [],
  secondaryInventoryPositions: [],
  secondaryOrders: [],
  secondaryTrades: [],
  ftpCurve: {},
  updatedAt: null,
};

export async function requireUser(context) {
  const token = requestToken(context.request);
  const legacyPassword = adminPassword(context.env);
  const local = isLocalRequest(context.request);

  if (!local && !legacyPassword && !token) {
    return { response: json({ error: "Pages Secret APP_PASSWORD 尚未配置" }, 503) };
  }

  if (token && legacyPassword && token === legacyPassword) {
    return { user: adminUser() };
  }

  if (local && !token) {
    return { user: adminUser() };
  }

  if (!token) return { response: json({ error: "Unauthorized" }, 401) };
  if (!context.env.DB && legacyPassword) return { response: json({ error: "Unauthorized" }, 401) };
  if (!context.env.DB) return { response: json({ error: "Cloudflare D1 binding DB 尚未配置" }, 503) };

  await ensureAuthSchema(context.env.DB, context.env, { allowDefaultPassword: local });
  const tokenHash = await sha256Hex(token);
  const row = await context.env.DB.prepare(`
    SELECT u.id, u.username, u.nickname, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return { response: json({ error: "Unauthorized" }, 401) };
  return { user: publicUser(row), tokenHash };
}

export async function loginUser(db, env, { username, password }, options = {}) {
  if (!db) throw new Error("Cloudflare D1 binding DB 尚未配置");
  await ensureAuthSchema(db, env, options);
  const user = await db.prepare(`
    SELECT id, username, nickname, role, password_salt, password_hash
    FROM users
    WHERE username = ?1
  `).bind(String(username || "").trim()).first();
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) return null;
  const session = await createSession(db, user.id);
  return { ...session, user: publicUser(user) };
}

export async function logoutUser(db, token) {
  if (!db || !token) return;
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
}

export function requestToken(request) {
  return bearerToken(request) || cookieValue(request, SESSION_COOKIE);
}

export async function ensureAuthSchema(db, env = {}, options = {}) {
  if (!db) throw new Error("Cloudflare D1 binding DB 尚未配置");
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
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_app_state (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  await ensureAdminUser(db, env, options);
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

export function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

export function sessionCookie(token, request) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("=") || "");
  }
  return "";
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

async function ensureAdminUser(db, env, options) {
  const existing = await db.prepare("SELECT id FROM users WHERE username = ?1").bind(ADMIN_USERNAME).first();
  if (existing) return;
  const password = adminPassword(env) || (options.allowDefaultPassword ? "admin" : "");
  if (!password) throw new Error("Pages Secret APP_PASSWORD 尚未配置");
  const now = new Date().toISOString();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  await db.prepare(`
    INSERT INTO users (id, username, nickname, role, password_salt, password_hash, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'admin', ?4, ?5, ?6, ?6)
  `).bind(ADMIN_USER_ID, ADMIN_USERNAME, ADMIN_NICKNAME, salt, passwordHash, now).run();
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

async function createSession(db, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString();
  await db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(tokenHash, userId, createdAt.toISOString(), expiresAt).run();
  return { token, expiresAt };
}

async function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  return timingSafeEqual(await hashPassword(password, salt), expectedHash);
}

async function hashPassword(password, salt) {
  return sha256Hex(`${salt}:${password}`);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function adminPassword(env = {}) {
  return String(env.ADMIN_PASSWORD || env.APP_PASSWORD || "").trim();
}
