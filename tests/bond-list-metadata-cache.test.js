import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryD1 } from './helpers/d1-memory.js';
import { BondMetadataCacheError, nextChinaMetadataDay, queryCloudBondMetadata } from '../functions/api/bond-list/_cloud-metadata-cache.js';
import { onRequestPost as coupons } from '../functions/api/bond-list/coupons.js';
import { onRequestPost as valuations } from '../functions/api/bond-list/valuations.js';
import { __test__ as dm } from '../functions/api/dm/lookup.js';

const code = '012682405.IB', other = '123456.SH';
const today = Date.parse('2026-10-24T03:00:00Z');
function payload(codes, kind = 'coupons', source = 'DM', at = today) {
  return { source, sourcePath: source === 'QB' ? 'bondDimInfo' : '/basic-info/info', fetchedAt: new Date(at).toISOString(), results: Object.fromEntries(codes.map(value => [value,
    kind === 'coupons' ? { status: 'matched', couponRate: 1.5, name: '26测试SCP001', bondType: 'SCP', rateType: '固定' }
      : { status: 'matched', yield: 1.6, netPrice: 100.1, institution: value.endsWith('.IB') ? '中债' : '中证', basis: '到期', date: '2026-10-23', field: value.endsWith('.IB') ? 'cbYtm' : 'csYtm' },
  ])) };
}
function request(body = { codes: [code] }, mode = 'dm', path = 'coupons') {
  return new Request(`http://127.0.0.1:8835/api/bond-list/${path}`, { method: 'POST', headers: {
    Origin: 'http://127.0.0.1:8835', 'Content-Type': 'application/json', 'X-Bond-List': '1', 'X-Bond-Data-Source': mode,
  }, body: JSON.stringify(body) });
}

test('successful static metadata is shared indefinitely while preserving per-code provenance and lookup time', async () => {
  const db = createMemoryD1(); let at = today, calls = 0;
  const query = () => queryCloudBondMetadata(db, { codes: [code], kind: 'coupons', mode: 'auto', now: () => at,
    lookup: async codes => { calls++; return payload(codes, 'coupons', 'QB', today - 1000); } });
  const fresh = (await query()).results[code];
  assert.equal(fresh.cached, false);
  assert.equal(fresh.checkedAt, new Date(today).toISOString());
  assert.equal(fresh.fetchedAt, new Date(today - 1000).toISOString());
  at += 400 * 86400_000;
  const cached = await query();
  assert.equal(calls, 1);
  assert.equal(cached.source, 'QB');
  assert.equal(cached.results[code].provider, 'QB');
  assert.equal(cached.results[code].sourcePath, 'bondDimInfo');
  assert.equal(cached.results[code].nextCheckAt, '');
  assert.equal(cached.results[code].fetchedAt, fresh.fetchedAt);
  assert.equal(cached.results[code].cached, true);
  assert.ok(db.statements.every(sql => sql.includes('bond_list_metadata_cache')));
});

test('daily valuation expires at Beijing midnight by successful query day, not valuation data day', async () => {
  const db = createMemoryD1(); let at = today, calls = 0;
  const query = () => queryCloudBondMetadata(db, { codes: [code], kind: 'valuations', mode: 'dm', now: () => at,
    lookup: async codes => { calls++; return payload(codes, 'valuations'); } });
  assert.equal((await query()).results[code].nextCheckAt, '2026-10-24T16:00:00.000Z');
  at = Date.parse('2026-10-24T15:59:59.999Z'); await query(); assert.equal(calls, 1);
  at++; const nextDay = (await query()).results[code];
  assert.equal(calls, 2); assert.equal(nextDay.date, '2026-10-23');
  assert.equal(nextDay.checkedAt, '2026-10-24T16:00:00.000Z');
  assert.equal(nextChinaMetadataDay(Date.parse('2026-12-31T16:00:00Z')), Date.parse('2027-01-01T16:00:00Z'));
});

test('mixed cached providers and zero coupons retain their original source and collection time', async () => {
  const db = createMemoryD1();
  for (const [value, source, rate, at] of [[code, 'DM', 0, today - 1000], [other, 'QB', 1.5, today]]) {
    await queryCloudBondMetadata(db, { codes: [value], kind: 'coupons', mode: 'auto', now: () => at,
      lookup: async codes => { const result = payload(codes, 'coupons', source, at); result.results[value].couponRate = rate; return result; } });
  }
  const result = await queryCloudBondMetadata(db, { codes: [code, other], kind: 'coupons', mode: 'auto', now: () => today + 1000,
    lookup: async () => { throw Error('must use shared successful data'); } });
  assert.equal(result.source, 'DM+QB'); assert.equal(result.results[code].couponRate, 0);
  assert.equal(result.results[code].provider, 'DM'); assert.equal(result.results[other].provider, 'QB');
  assert.notEqual(result.results[code].fetchedAt, result.results[other].fetchedAt);
});

test('a query completing across midnight uses its completion day', async () => {
  const db = createMemoryD1(); let at = Date.parse('2026-10-24T15:59:59Z'), calls = 0;
  const query = () => queryCloudBondMetadata(db, { codes: [code], kind: 'valuations', mode: 'dm', now: () => at,
    lookup: async codes => { calls++; at += 2000; return payload(codes, 'valuations'); } });
  const result = (await query()).results[code];
  assert.equal(result.checkedAt, '2026-10-24T16:00:01.000Z');
  assert.equal(result.nextCheckAt, '2026-10-25T16:00:00.000Z');
  await query(); assert.equal(calls, 1);
});

test('kind, selected source and full market code are separate cache identities', async () => {
  const db = createMemoryD1(); let calls = 0;
  for (const [kind, mode, security] of [['coupons', 'dm', other], ['coupons', 'qb', other], ['coupons', 'auto', other], ['valuations', 'dm', other], ['coupons', 'dm', '123456.SZ']]) {
    for (let repeat = 0; repeat < 2; repeat++) await queryCloudBondMetadata(db, { codes: [security], kind, mode, now: () => today,
      lookup: async codes => { calls++; return payload(codes, kind, mode === 'qb' ? 'QB' : 'DM'); } });
  }
  assert.equal(calls, 5);
});

test('ordinary failures and missing results retry next refresh without freezing old values or losing a verified valuation', async () => {
  for (const failure of ['missing', 'error', 'throw']) {
    const db = createMemoryD1(); let calls = 0, at = today;
    const query = () => queryCloudBondMetadata(db, { codes: [code], kind: 'valuations', mode: 'dm', now: () => at,
      lookup: async codes => {
        calls++;
        if (calls === 2) { if (failure === 'throw') throw Error('private-secret'); return { results: { [code]: { status: failure } } }; }
        return payload(codes, 'valuations');
      } });
    const good = (await query()).results[code]; at = nextChinaMetadataDay(today);
    const failed = (await query()).results[code];
    assert.equal(failed.status, 'matched'); assert.equal(failed.refreshFailed, true);
    assert.equal(failed.checkedAt, good.checkedAt); assert.equal(failed.fetchedAt, good.fetchedAt);
    assert.equal(failed.yield, good.yield);
    assert.doesNotMatch(JSON.stringify(failed), /private-secret/);
    assert.equal((await query()).results[code].refreshFailed, false); assert.equal(calls, 3);
  }
  const db = createMemoryD1(); let calls = 0;
  const query = () => queryCloudBondMetadata(db, { codes: [code], kind: 'coupons', mode: 'dm', now: () => today,
    lookup: async () => { calls++; return { results: { [code]: { status: 'missing', couponRate: null } } }; } });
  await query(); await query(); assert.equal(calls, 2);
});

test('concurrent clients share one lease and an expired owner cannot overwrite newer results', async () => {
  const db = createMemoryD1(); let release, at = today, calls = 0;
  const started = new Promise(resolve => { release = resolve; });
  const query = lookup => queryCloudBondMetadata(db, { codes: [code], kind: 'coupons', mode: 'dm', now: () => at, lookup });
  const first = query(async codes => { calls++; await started; return payload(codes); });
  while (!calls) await new Promise(resolve => setImmediate(resolve));
  const concurrent = await query(async () => { throw Error('duplicate paid request'); });
  assert.equal(concurrent.results[code].status, 'loading');
  at += 35_001;
  await query(async codes => { calls++; const result = payload(codes); result.results[code].couponRate = 2; return result; });
  release(); const late = await first;
  assert.equal(calls, 2); assert.equal(late.results[code].couponRate, 2);
});

test('429 has a shared cooldown, mixed batches signal rate limits and do not mark failed data as successful', async () => {
  const db = createMemoryD1(); let at = today, calls = 0;
  await queryCloudBondMetadata(db, { codes: [code], kind: 'coupons', mode: 'qb', now: () => at, lookup: async codes => payload(codes, 'coupons', 'QB') });
  const query = () => queryCloudBondMetadata(db, { codes: [code, other], kind: 'coupons', mode: 'qb', now: () => at,
    lookup: async () => { calls++; throw Object.assign(Error('private-rate-message'), { status: 429, retryAfter: 8 }); } });
  const first = await query();
  assert.equal(first.rateLimited, true); assert.equal(first.terminalError, null);
  assert.equal(first.results[code].status, 'matched'); assert.equal(first.results[other].status, 'error');
  assert.equal(first.results[other].checkedAt, '');
  at += 7999; await query(); assert.equal(calls, 1);
  at++; await query(); assert.equal(calls, 2);
});

test('missing or broken D1 fails closed before any paid request and does not expose database errors', async () => {
  let calls = 0;
  for (const db of [undefined, { prepare() { throw Error('private-database'); }, batch() {} }]) {
    await assert.rejects(queryCloudBondMetadata(db, { codes: [code], kind: 'coupons', mode: 'dm', lookup: async () => { calls++; } }), BondMetadataCacheError);
  }
  assert.equal(calls, 0);
  const brokenRead = createMemoryD1(); brokenRead.setFail('SELECT');
  await assert.rejects(queryCloudBondMetadata(brokenRead, { codes: [code], kind: 'coupons', mode: 'dm', lookup: async () => { calls++; } }), BondMetadataCacheError);
  assert.equal(calls, 0);
  for (const endpoint of [coupons, valuations]) {
    const response = await endpoint({ request: request(), env: {} });
    assert.equal(response.status, 503);
    const body = await response.json(); assert.equal(body.code, 'bond_metadata_cache_unavailable');
    assert.doesNotMatch(JSON.stringify(body), /private-database/);
  }
});

test('API serves shared successes without configured suppliers, while auth and invalid requests cannot read the cache', async () => {
  const db = createMemoryD1(), secret = '1234567890abcdef';
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ data: dm.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data: [{ securityId: code, newCoupRate: 1.3 }] }), secret) })); };
  try {
    assert.equal((await coupons({ request: request(), env: { DB: db, INNO_APP_KEY: 'test', INNO_APP_SECRET: secret } })).status, 200);
    const cached = await coupons({ request: request({ codes: [code], force: true }), env: { DB: db } });
    assert.equal(cached.status, 200); assert.equal((await cached.json()).results[code].couponRate, 1.3); assert.equal(calls, 1);
    const count = db.statements.length;
    assert.equal((await coupons({ request: request({ codes: [] }), env: { DB: db } })).status, 400);
    assert.equal(db.statements.length, count);
    const unauthorized = new Request('https://tempest07.com/api/bond-list/coupons', { method: 'POST', body: '{}' });
    assert.equal((await coupons({ request: unauthorized, env: { DB: db } })).status, 401);
    assert.equal(db.statements.length, count);
  } finally { globalThis.fetch = original; }
});
