import { normalizeName } from '../bond-list/_shared.js';

const TABLE = 'payment_todo_code_cache';
const CODE = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/;
const PROVIDERS = new Set(['DM', 'QB', 'DM+QB']);
const RETRY_MS = 60_000;
const LEASE_MS = 35_000; // Longer than the code endpoint's shared 25-second upstream deadline.
const DAY_MS = 86_400_000;
const CHINA_OFFSET_MS = 8 * 60 * 60_000;

export class PaymentCodeCacheError extends Error {
  constructor() { super('Payment code cloud cache unavailable'); }
}

export function nextChinaDay(now) {
  return (Math.floor((now + CHINA_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - CHINA_OFFSET_MS;
}

async function cacheOperation(operation) {
  try { return await operation(); }
  catch { throw new PaymentCodeCacheError(); }
}

function assertResults(results) {
  if (!Array.isArray(results) || results.some(result => result?.success === false)) throw new PaymentCodeCacheError();
  return results;
}

async function ensureSchema(db) {
  const result = await cacheOperation(() => db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    mode TEXT NOT NULL, name_key TEXT NOT NULL,
    verified_json TEXT, checked_at TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL DEFAULT '',
    result_json TEXT NOT NULL DEFAULT '{"status":"loading","matches":[]}',
    refresh_status TEXT NOT NULL DEFAULT 'loading', next_check_at INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
    error_http_status INTEGER NOT NULL DEFAULT 0, retry_after INTEGER,
    PRIMARY KEY (mode, name_key)
  )`).run());
  if (result?.success === false) throw new PaymentCodeCacheError();
}

function readResult(value, key, fallbackSource = '') {
  let result;
  try { result = typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
  if (!result || !Array.isArray(result.matches)) return null;
  const matches = result.matches.map(match => ({ ...match,
    provider: match?.provider || fallbackSource,
  }));
  if (result.status === 'matched') {
    if (matches.length !== 1 || !CODE.test(matches[0]?.code) || typeof matches[0]?.name !== 'string'
      || normalizeName(matches[0].name) !== key || !PROVIDERS.has(matches[0].provider)) return null;
  } else if (!['missing', 'ambiguous', 'error', 'loading'].includes(result.status)) return null;
  return { status: result.status, matches, ...(PROVIDERS.has(result.source) ? { source: result.source } : {}) };
}

function renderRow(row, key, at, cached) {
  const verified = readResult(row?.verified_json, key);
  const current = readResult(row?.result_json, key) || { status: 'error', matches: [] };
  const loading = Boolean(row?.lease_token) && row.lease_until > at;
  return {
    ...(verified || (loading ? { status: 'loading', matches: [] } : current)),
    checkedAt: verified ? row.checked_at : '',
    fetchedAt: row?.fetched_at || '',
    nextCheckAt: new Date(loading ? row.lease_until : row.next_check_at).toISOString(),
    refreshStatus: loading ? 'loading' : row.refresh_status,
    cached,
  };
}

function responseSource(results, mode, fallback = '') {
  const sources = new Set(Object.values(results).flatMap(result => result.matches.length
    ? result.matches.map(match => match.provider) : [result.source]).filter(source => PROVIDERS.has(source)));
  if (sources.has('DM+QB') || sources.has('DM') && sources.has('QB')) return 'DM+QB';
  return sources.values().next().value || (PROVIDERS.has(fallback) ? fallback : mode === 'qb' ? 'QB' : 'DM');
}

/** Shared market identity cache, deliberately separate from user/project business state. */
export async function queryCloudPaymentCodes(db, { names, mode, force = false, lookup, now = Date.now }) {
  await ensureSchema(db);
  const entries = [...new Map(names.map(name => [normalizeName(name), name])).entries()];
  const rows = new Map();
  const at = now(), token = crypto.randomUUID();
  // The conditional upsert is the cross-client lock. The following SELECT runs
  // in the same D1 transaction, so no Worker-local map or paid-query polling is needed.
  const claims = await cacheOperation(() => db.batch(entries.flatMap(([key]) => [
    db.prepare(`INSERT INTO ${TABLE} (mode, name_key, lease_token, lease_until)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(mode, name_key) DO UPDATE SET lease_token = excluded.lease_token, lease_until = excluded.lease_until
      WHERE ${TABLE}.lease_until <= ?5 AND (?6 = 1 OR ${TABLE}.next_check_at <= ?5)`)
      .bind(mode, key, token, at + LEASE_MS, at, force ? 1 : 0),
    db.prepare(`SELECT * FROM ${TABLE} WHERE mode = ?1 AND name_key = ?2`).bind(mode, key),
  ])));
  assertResults(claims);
  entries.forEach(([key], index) => {
    const row = claims[index * 2 + 1]?.results?.[0];
    if (!row) throw new PaymentCodeCacheError();
    rows.set(key, row);
  });
  const owned = entries.filter(([key]) => rows.get(key).lease_token === token);
  const refreshed = new Set();
  let payload, lookupError;
  if (owned.length) {
    try { payload = await lookup(owned.map(([, name]) => name)); }
    catch (error) { lookupError = error; }
    const completed = now();
    const writes = [], updates = [];
    for (const [key, name] of owned) {
      const previous = rows.get(key);
      const result = !lookupError && readResult(payload?.results?.[name], key, payload?.source);
      const current = result || { status: 'error', matches: [] };
      const previousResult = readResult(previous.result_json, key);
      const source = PROVIDERS.has(payload?.source) ? payload.source
        : Number(lookupError?.status) === 429 || lookupError?.code === 'qb_rate_limited' ? 'QB' : previousResult?.source;
      if (source) current.source = source;
      const matched = current.status === 'matched';
      const verified = matched ? current : readResult(previous.verified_json, key);
      const upstreamDate = typeof payload?.fetchedAt === 'string' && Number.isFinite(Date.parse(payload.fetchedAt)) ? payload.fetchedAt : new Date(completed).toISOString();
      const retryAfter = lookupError?.retryAfter;
      const validRetry = retryAfter !== '' && retryAfter !== null && retryAfter !== undefined
        && /^\d+$/.test(String(retryAfter)) && Number.isSafeInteger(Number(retryAfter));
      const update = {
        ...previous, verified_json: verified ? JSON.stringify(verified) : null,
        checked_at: matched ? new Date(completed).toISOString() : previous.checked_at,
        fetched_at: !matched && verified ? previous.fetched_at : upstreamDate,
        result_json: JSON.stringify(current), refresh_status: current.status,
        next_check_at: matched ? nextChinaDay(completed) : completed + RETRY_MS,
        lease_token: '', lease_until: 0,
        error_http_status: lookupError ? Number(lookupError.status) === 429 || lookupError.code === 'qb_rate_limited' ? 429 : Number(lookupError.status) === 503 ? 503 : 502 : 0,
        retry_after: validRetry ? Number(retryAfter) : null,
      };
      updates.push([key, update]);
      writes.push(db.prepare(`UPDATE ${TABLE} SET verified_json = ?1, checked_at = ?2, fetched_at = ?3,
        result_json = ?4, refresh_status = ?5, next_check_at = ?6, lease_token = '', lease_until = 0,
        error_http_status = ?7, retry_after = ?8 WHERE mode = ?9 AND name_key = ?10 AND lease_token = ?11`)
        .bind(update.verified_json, update.checked_at, update.fetched_at, update.result_json,
          update.refresh_status, update.next_check_at, update.error_http_status, update.retry_after, mode, key, token));
    }
    const committed = assertResults(await cacheOperation(() => db.batch(writes)));
    for (let index = 0; index < updates.length; index++) {
      const [key, update] = updates[index];
      if (committed[index]?.meta?.changes === 1) { rows.set(key, update); refreshed.add(key); }
      else {
        // An expired owner must not overwrite a newer client's result.
        const row = await cacheOperation(() => db.prepare(`SELECT * FROM ${TABLE} WHERE mode = ?1 AND name_key = ?2`).bind(mode, key).first());
        if (!row) throw new PaymentCodeCacheError();
        rows.set(key, row);
      }
    }
  }
  const results = Object.fromEntries(names.map(name => {
    const key = normalizeName(name);
    return [name, renderRow(rows.get(key), key, now(), !refreshed.has(key))];
  }));
  const terminalRows = [...rows.values()];
  const terminalError = Object.values(results).every(result => result.status === 'error')
    && terminalRows.every(row => row.error_http_status > 0)
    ? { status: terminalRows.every(row => row.error_http_status === 429) ? 429 : terminalRows.every(row => row.error_http_status === 503) ? 503 : 502,
      retryAfter: terminalRows.find(row => row.retry_after !== null)?.retry_after } : null;
  return {
    source: responseSource(results, mode, payload?.source || (terminalError?.status === 429 ? 'QB' : '')),
    fetchedAt: payload?.fetchedAt || new Date(now()).toISOString(), results, cache: 'cloud', terminalError,
    ...(payload?.dataSources ? { dataSources: payload.dataSources } : {}),
  };
}
