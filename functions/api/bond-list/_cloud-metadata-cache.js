import { couponMetadataComplete, couponMetadataUsable, supplementCouponMetadata } from '../../../bond-list-metadata.js';

const TABLE = 'bond_list_metadata_cache';
const LEASE_MS = 35_000;
const FOREVER = 253402300799999;
const DAY_MS = 86_400_000;
const CHINA_OFFSET = 8 * 60 * 60_000;
const PROVIDERS = new Set(['DM', 'QB', 'DM+QB']);

export class BondMetadataCacheError extends Error {
  constructor() { super('Bond metadata cloud cache unavailable'); }
}

export function nextChinaMetadataDay(at) {
  return (Math.floor((at + CHINA_OFFSET) / DAY_MS) + 1) * DAY_MS - CHINA_OFFSET;
}

async function operation(run) {
  try { return await run(); } catch { throw new BondMetadataCacheError(); }
}

function assertResults(results) {
  if (!Array.isArray(results) || results.some(result => result?.success === false)) throw new BondMetadataCacheError();
  return results;
}

async function ensureSchema(db) {
  if (!db?.prepare || !db?.batch) throw new BondMetadataCacheError();
  const result = await operation(() => db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    mode TEXT NOT NULL, kind TEXT NOT NULL, security_code TEXT NOT NULL,
    verified_json TEXT, checked_at TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL DEFAULT '',
    result_json TEXT NOT NULL DEFAULT '{"status":"loading"}', refresh_status TEXT NOT NULL DEFAULT 'loading',
    next_check_at INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
    error_http_status INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', retry_after INTEGER,
    PRIMARY KEY (mode, kind, security_code)
  )`).run());
  if (result?.success === false) throw new BondMetadataCacheError();
}

function validSuccess(result, kind, code) {
  if (result?.status !== 'matched' || !PROVIDERS.has(result.provider)) return false;
  if (kind === 'coupons') return typeof result.couponRate === 'number' && Number.isFinite(result.couponRate) && result.couponRate >= 0;
  return typeof result.yield === 'number' && Number.isFinite(result.yield) && result.yield > -5 && result.yield < 25
    && result.institution === (code.endsWith('.IB') ? '中债' : '中证')
    && /^\d{4}-\d{2}-\d{2}$/.test(result.date || '') && ['行权', '到期'].includes(result.basis);
}

function decode(value) {
  try { const result = JSON.parse(value || 'null'); return result && typeof result === 'object' && !Array.isArray(result) ? result : null; }
  catch { throw new BondMetadataCacheError(); }
}

function verifiedResult(row, kind, code) {
  const result = decode(row?.verified_json);
  if (result && (!validSuccess(result, kind, code) || !Number.isFinite(Date.parse(row.checked_at)))) throw new BondMetadataCacheError();
  return result;
}

function renderRow(row, kind, code, at, refreshed) {
  const verified = verifiedResult(row, kind, code);
  const current = decode(row?.result_json) || { status: 'error' };
  const partial = kind === 'coupons' && couponMetadataUsable(current);
  const loading = Boolean(row?.lease_token) && row.lease_until > at;
  return {
    ...(verified || (loading ? { status: 'loading' } : current)),
    checkedAt: verified ? row.checked_at : '', fetchedAt: verified ? row.fetched_at : current.fetchedAt || '',
    nextCheckAt: kind === 'coupons' && couponMetadataComplete(verified) && !loading ? '' : new Date(loading ? row.lease_until : row.next_check_at).toISOString(),
    refreshStatus: loading ? 'loading' : row.refresh_status,
    refreshFailed: Boolean(!loading && (verified ? row.refresh_status !== 'matched' : partial && row.refresh_status === 'error')),
    cached: !refreshed,
    ...(kind === 'coupons' && (verified || current).couponRate === 0 ? { couponConfirmationRequired: true } : {}),
    ...(row.error_http_status === 429 ? { retryAfter: row.retry_after, reason: 'rate_limited' } : {}),
  };
}

/** Shared supplier metadata only. Never reads or writes business state or snapshots. */
export async function queryCloudBondMetadata(db, { codes, mode, kind, lookup, now = Date.now }) {
  if (!['coupons', 'valuations'].includes(kind) || !['auto', 'dm', 'qb'].includes(mode)) throw new BondMetadataCacheError();
  await ensureSchema(db);
  const read = code => db.prepare(`SELECT * FROM ${TABLE} WHERE mode = ?1 AND kind = ?2 AND security_code = ?3`).bind(mode, kind, code);
  const rows = new Map();
  const initial = assertResults(await operation(() => db.batch(codes.map(read))));
  const at = now(), token = crypto.randomUUID();
  const due = [];
  const legacyPartial = new Map();
  codes.forEach((code, index) => {
    const row = initial[index]?.results?.[0];
    if (row) {
      const verified = verifiedResult(row, kind, code);
      rows.set(code, row);
      if (kind === 'coupons' && verified && row.next_check_at === FOREVER && !couponMetadataComplete(verified)) {
        legacyPartial.set(code, row.verified_json);
      }
    }
    if (!row || (row.next_check_at <= at || legacyPartial.has(code)) && row.lease_until <= at) due.push(code);
  });
  if (due.length) {
    const claims = assertResults(await operation(() => db.batch(due.flatMap(code => [
      db.prepare(`INSERT INTO ${TABLE} (mode, kind, security_code, lease_token, lease_until)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(mode, kind, security_code) DO UPDATE SET lease_token = excluded.lease_token, lease_until = excluded.lease_until
        WHERE ${TABLE}.lease_until <= ?6 AND (${TABLE}.next_check_at <= ?6
          OR (?7 = 1 AND ${TABLE}.next_check_at = ?8 AND ${TABLE}.verified_json IS ?9))`)
        .bind(mode, kind, code, token, at + LEASE_MS, at, Number(legacyPartial.has(code)), FOREVER, legacyPartial.get(code) ?? null), read(code),
    ]))));
    due.forEach((code, index) => {
      const row = claims[index * 2 + 1]?.results?.[0];
      if (!row) throw new BondMetadataCacheError();
      verifiedResult(row, kind, code); rows.set(code, row);
    });
  }
  const owned = codes.filter(code => rows.get(code)?.lease_token === token);
  const refreshed = new Set();
  let payload, lookupError;
  if (owned.length) {
    try { payload = await lookup(owned); } catch (error) { lookupError = error; }
    const completed = now();
    const status = lookupError ? Number(lookupError.status) === 429 || lookupError.code === 'qb_rate_limited' ? 429
      : lookupError.code === 'dm_valuation_access_denied' || Number(lookupError.status) === 503 ? 503 : 502 : 0;
    const retry = lookupError?.retryAfter;
    const retryAfter = /^\d+$/.test(String(retry)) && Number.isSafeInteger(Number(retry)) ? Number(retry) : null;
    const updates = owned.map(code => {
      const previous = rows.get(code);
      const raw = !lookupError && payload?.results?.[code];
      const provider = PROVIDERS.has(raw?.provider) ? raw.provider : PROVIDERS.has(payload?.source) ? payload.source : status === 429 || mode === 'qb' ? 'QB' : 'DM';
      const fetchedAt = Number.isFinite(Date.parse(payload?.fetchedAt)) ? payload.fetchedAt : new Date(completed).toISOString();
      let current = raw && ['matched', 'missing', 'error'].includes(raw.status) ? { ...raw, provider, fetchedAt,
        ...(payload.sourcePath ? { sourcePath: payload.sourcePath } : {}),
        ...(payload.sourcePaths ? { sourcePaths: payload.sourcePaths } : {}),
      } : { status: 'error', provider, fetchedAt };
      const retained = verifiedResult(previous, kind, code);
      const previousPartial = kind === 'coupons' ? decode(previous.result_json) : null;
      const previousMetadata = retained || (couponMetadataUsable(previousPartial) ? previousPartial : null);
      if (kind === 'coupons') current = supplementCouponMetadata(previousMetadata, current);
      if (current.status === 'matched' && !validSuccess(current, kind, code)) current = { status: 'error', provider, fetchedAt };
      if (status === 429) current.reason = 'rate_limited';
      if (lookupError?.code === 'dm_valuation_access_denied') current.reason = lookupError.code;
      const matched = current.status === 'matched';
      const verified = matched ? current : retained;
      const changed = matched && current !== retained;
      // Before the coupon arrives, retain trusted classification through failed attempts
      // in result_json. verified_json keeps its existing valid-coupon contract.
      const retainedPartial = kind === 'coupons' && !retained && previousMetadata && !couponMetadataUsable(current);
      return { ...previous,
        verified_json: verified ? JSON.stringify(verified) : null,
        checked_at: changed ? new Date(completed).toISOString() : previous.checked_at,
        fetched_at: changed ? current.fetchedAt : previous.fetched_at,
        result_json: JSON.stringify(retainedPartial ? previousMetadata : current), refresh_status: retainedPartial ? 'error' : current.status,
        next_check_at: matched ? kind === 'coupons' ? couponMetadataComplete(verified) ? FOREVER : 0 : nextChinaMetadataDay(completed)
          : status === 429 ? Math.min(FOREVER, completed + (retryAfter ?? 60) * 1000) : 0,
        lease_token: '', lease_until: 0, error_http_status: status,
        error_code: lookupError?.code === 'dm_valuation_access_denied' ? lookupError.code : '', retry_after: retryAfter,
      };
    });
    const writes = updates.map((row, index) => db.prepare(`UPDATE ${TABLE}
      SET verified_json = ?1, checked_at = ?2, fetched_at = ?3, result_json = ?4, refresh_status = ?5, next_check_at = ?6,
        lease_token = '', lease_until = 0, error_http_status = ?7, error_code = ?8, retry_after = ?9
      WHERE mode = ?10 AND kind = ?11 AND security_code = ?12 AND lease_token = ?13`)
      .bind(row.verified_json, row.checked_at, row.fetched_at, row.result_json, row.refresh_status, row.next_check_at,
        row.error_http_status, row.error_code, row.retry_after, mode, kind, owned[index], token));
    const committed = assertResults(await operation(() => db.batch(writes)));
    for (let index = 0; index < owned.length; index++) {
      const code = owned[index];
      if (committed[index]?.meta?.changes === 1) { rows.set(code, updates[index]); refreshed.add(code); }
      else {
        const row = await operation(() => read(code).first());
        if (!row) throw new BondMetadataCacheError();
        rows.set(code, row);
      }
    }
  }
  const results = Object.fromEntries(codes.map(code => [code, renderRow(rows.get(code), kind, code, now(), refreshed.has(code))]));
  const terminalRows = codes.map(code => rows.get(code));
  const limited = terminalRows.filter(row => row.error_http_status === 429);
  const terminalError = Object.values(results).every(result => result.status === 'error') && terminalRows.every(row => row.error_http_status > 0)
    ? { status: limited.length ? 429 : terminalRows.every(row => row.error_http_status === 503) ? 503 : 502,
      code: terminalRows.find(row => row.error_code)?.error_code || '', retryAfter: limited.find(row => row.retry_after !== null)?.retry_after } : null;
  const providers = new Set(Object.values(results).map(result => result.provider).filter(value => PROVIDERS.has(value)));
  const source = providers.has('DM+QB') || providers.has('DM') && providers.has('QB') ? 'DM+QB' : providers.values().next().value || (mode === 'qb' ? 'QB' : 'DM');
  const paths = [...new Set(Object.values(results).flatMap(result => result.sourcePaths || result.sourcePath || []))];
  return { source, sourcePath: paths.join(', '), sourcePaths: paths, fetchedAt: new Date(now()).toISOString(), cache: 'cloud', results, terminalError,
    ...(payload?.dataSources ? { dataSources: payload.dataSources } : {}),
    ...(limited.length ? { rateLimited: true, retryAfter: limited.find(row => row.retry_after !== null)?.retry_after ?? 60 } : {}),
  };
}
