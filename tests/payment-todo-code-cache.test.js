import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { queryCloudPaymentCodes, PaymentCodeCacheError, nextChinaDay } from '../functions/api/payment-todo/_code-cache.js';
import { onRequestPost } from '../functions/api/payment-todo/codes.js';
import { __test__ as dm } from '../functions/api/dm/lookup.js';

const name = '26测试MTN001';
const today = Date.parse('2026-10-23T03:00:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
function d1() {
  const sql = new DatabaseSync(':memory:');
  const statements = [];
  let fail = '';
  function prepare(query) {
    statements.push(query);
    const make = bindings => ({
      bind: (...values) => make(values),
      execute() {
        if (fail && query.includes(fail)) throw Error('private-schema-error-or-token');
        const statement = sql.prepare(query);
        if (statement.columns().length) return { success: true, results: statement.all(...bindings).map(row => ({ ...row })), meta: { changes: 0 } };
        const result = statement.run(...bindings);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
      async run() { return this.execute(); },
      async first() { return this.execute().results[0] || null; },
    });
    return make([]);
  }
  return {
    prepare, statements, sql,
    setFail(value) { fail = value; },
    async batch(batch) {
      sql.exec('BEGIN');
      try { const results = batch.map(statement => statement.execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
}
function payload(names, code = '102600001.IB', source = 'DM') {
  return { source, fetchedAt: '2026-10-01T02:00:00Z', results: Object.fromEntries(names.map(value => [value,
    { status: 'matched', matches: [{ name: value, code, market: '银行间' }] }])) };
}
function apiRequest(body, mode = 'dm') {
  return new Request('http://127.0.0.1:8814/api/payment-todo/codes', { method: 'POST',
    headers: { Origin: 'http://127.0.0.1:8814', 'X-Bond-List': '1', 'X-Bond-Data-Source': mode, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
}

test('cloud cache is shared across clients and width aliases and expires at Beijing midnight', async () => {
  const db = d1(); let calls = 0, at = today;
  const lookup = async names => { calls++; return payload(names, calls === 1 ? '102600001.IB' : '102600002.IB'); };
  const query = names => queryCloudPaymentCodes(db, { names, mode: 'dm', lookup, now: () => at });
  const first = await query([name]);
  assert.equal(first.results[name].cached, false);
  assert.equal(first.results[name].checkedAt, new Date(today).toISOString());
  assert.equal(first.results[name].fetchedAt, '2026-10-01T02:00:00Z');
  assert.equal(first.results[name].nextCheckAt, '2026-10-23T16:00:00.000Z');
  assert.equal((await query([name])).results[name].cached, true);
  const alias = '２６测试 ｍｔｎ００１';
  assert.equal((await query([alias])).results[alias].matches[0].code, '102600001.IB');
  at = Date.parse('2026-10-23T15:59:59.999Z'); await query([name]); assert.equal(calls, 1);
  at++; const changed = await query([name]);
  assert.equal(calls, 2);
  assert.equal(changed.results[name].matches[0].code, '102600002.IB');
  assert.equal(changed.results[name].checkedAt, '2026-10-23T16:00:00.000Z');
  assert.equal(nextChinaDay(Date.parse('2026-12-31T16:00:00Z')), Date.parse('2027-01-01T16:00:00Z'));
  assert.ok(db.statements.every(sql => /payment_todo_code_cache/.test(sql)), 'only the independent cache table is accessed');
});

test('each selected source has an independent shared cache and force bypasses a fresh success', async () => {
  const db = d1(); let calls = 0;
  const query = (mode, force = false) => queryCloudPaymentCodes(db, { names: [name], mode, force, now: () => today,
    lookup: async names => { calls++; return payload(names, `${102600000 + calls}.IB`, mode === 'qb' ? 'QB' : 'DM'); } });
  assert.equal((await query('dm')).results[name].matches[0].provider, 'DM');
  assert.equal((await query('qb')).results[name].matches[0].provider, 'QB');
  assert.equal((await query('auto')).results[name].matches[0].provider, 'DM');
  assert.equal((await query('dm')).results[name].matches[0].code, '102600001.IB');
  assert.equal(calls, 3);
  assert.equal((await query('dm', true)).results[name].matches[0].code, '102600004.IB');
  assert.equal(calls, 4);
});

test('cached mixed batches keep each actual provider instead of relabelling all results from the selected mode', async () => {
  const db = d1(), second = '26测试MTN002';
  for (const [value, source] of [[name, 'DM'], [second, 'QB']]) {
    await queryCloudPaymentCodes(db, { names: [value], mode: 'auto', now: () => today,
      lookup: async names => payload(names, '102600001.IB', source) });
  }
  const result = await queryCloudPaymentCodes(db, { names: [name, second], mode: 'auto', now: () => today,
    lookup: async () => { throw Error('cached results must not query upstream'); } });
  assert.equal(result.source, 'DM+QB');
  assert.equal(result.results[name].matches[0].provider, 'DM');
  assert.equal(result.results[second].matches[0].provider, 'QB');
  assert.equal(result.results[name].cached, true);
  assert.equal(result.results[second].cached, true);
});

test('empty QB results in automatic mode retain their actual source on shared-cache hits', async () => {
  const db = d1(); let calls = 0;
  const query = () => queryCloudPaymentCodes(db, { names: [name], mode: 'auto', now: () => today,
    lookup: async () => { calls++; return { source: 'QB', fetchedAt: new Date(today).toISOString(), results: { [name]: { status: 'missing', matches: [] } } }; } });
  for (let index = 0; index < 2; index++) {
    const result = await query();
    assert.equal(result.source, 'QB');
    assert.equal(result.results[name].source, 'QB');
    assert.equal(result.results[name].status, 'missing');
    assert.equal(result.results[name].cached, index === 1);
  }
  assert.equal(calls, 1);
});

test('failed or ambiguous daily checks retain verified code and retry exactly after sixty seconds', async () => {
  for (const failure of ['error', 'missing', 'ambiguous']) {
    const db = d1(); let at = today, calls = 0;
    const lookup = async names => {
      calls++;
      if (calls !== 2) return payload(names, calls > 2 ? '102600002.IB' : '102600001.IB');
      if (failure === 'error') throw Error('private-upstream-token');
      return { source: 'DM', fetchedAt: new Date(at).toISOString(), results: { [name]: { status: failure, matches: [] } } };
    };
    const query = () => queryCloudPaymentCodes(db, { names: [name], mode: 'dm', lookup, now: () => at });
    await query(); at = nextChinaDay(today);
    const failed = (await query()).results[name];
    assert.equal(failed.status, 'matched');
    assert.equal(failed.matches[0].code, '102600001.IB');
    assert.equal(failed.refreshStatus, failure);
    assert.equal(failed.checkedAt, new Date(today).toISOString());
    assert.equal(failed.fetchedAt, '2026-10-01T02:00:00Z');
    assert.equal(failed.nextCheckAt, new Date(at + 60_000).toISOString());
    assert.doesNotMatch(JSON.stringify(failed), /private|token/);
    at += 59_999; await query(); assert.equal(calls, 2);
    at++; assert.equal((await query()).results[name].matches[0].code, '102600002.IB');
    assert.equal(calls, 3);
  }
});

test('failed new names also share their retry delay without inventing a successful code', async () => {
  const db = d1(); let calls = 0, at = today;
  const query = () => queryCloudPaymentCodes(db, { names: [name], mode: 'dm', now: () => at,
    lookup: async () => { calls++; throw Error('private-upstream-token'); } });
  for (let i = 0; i < 2; i++) {
    const result = await query();
    assert.equal(result.results[name].status, 'error');
    assert.equal(result.results[name].checkedAt, '');
    assert.equal(result.results[name].nextCheckAt, new Date(today + 60_000).toISOString());
    assert.equal(result.terminalError.status, 502);
  }
  assert.equal(calls, 1); at += 60_000; await query(); assert.equal(calls, 2);
});

test('atomic leases merge concurrent normal and forced clients, retaining old code while checking', async () => {
  for (const old of [false, true]) {
    const db = d1(); let at = today, calls = 0, resolve;
    if (old) await queryCloudPaymentCodes(db, { names: [name], mode: 'dm', now: () => at, lookup: async names => payload(names) });
    at = nextChinaDay(today);
    const query = force => queryCloudPaymentCodes(db, { names: [name], mode: 'dm', force, now: () => at,
      lookup: async () => { calls++; return new Promise(done => { resolve = done; }); } });
    const first = query(true); await tick();
    const second = await query(true), third = await query(false);
    assert.equal(calls, 1);
    for (const other of [second, third]) {
      assert.equal(other.results[name].refreshStatus, 'loading');
      assert.equal(other.results[name].status, old ? 'matched' : 'loading');
      assert.equal(other.results[name].matches[0]?.code, old ? '102600001.IB' : undefined);
      assert.equal(other.results[name].nextCheckAt, new Date(at + 35_000).toISOString());
    }
    resolve(payload([name], '102600002.IB'));
    assert.equal((await first).results[name].matches[0].code, '102600002.IB');
  }
});

test('expired lease recovery cannot be overwritten by its delayed former owner', async () => {
  const db = d1(); let at = today, resolveOld, calls = 0;
  const lookup = async names => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : payload(names, '102600002.IB');
  const query = () => queryCloudPaymentCodes(db, { names: [name], mode: 'dm', lookup, now: () => at });
  const old = query(); await tick();
  at += 35_001; const recovered = await query();
  assert.equal(recovered.results[name].matches[0].code, '102600002.IB');
  resolveOld(payload([name], '102600001.IB'));
  assert.equal((await old).results[name].matches[0].code, '102600002.IB');
  assert.equal((await query()).results[name].matches[0].code, '102600002.IB');
  assert.equal(calls, 2);
});

test('a lookup crossing Beijing midnight is checked on its completion day, not the upstream data day', async () => {
  const db = d1(); let at = Date.parse('2026-10-23T15:59:59Z'), calls = 0;
  const query = () => queryCloudPaymentCodes(db, { names: [name], mode: 'dm', now: () => at,
    lookup: async names => { calls++; at += 2000; return payload(names); } });
  const result = (await query()).results[name];
  assert.equal(result.checkedAt, '2026-10-23T16:00:01.000Z');
  assert.equal(result.nextCheckAt, '2026-10-24T16:00:00.000Z');
  await query(); assert.equal(calls, 1);
});

test('invalid matched identities never enter the verified cloud cache', async () => {
  for (const mutate of [
    response => { response.results[name].matches[0].name += 'A'; },
    response => { response.results[name].matches[0].provider = 'manual'; },
    response => { response.source = 'unsupported'; },
    response => { response.results[name].matches[0].code = '12345.SH'; },
  ]) {
    const db = d1();
    const result = await queryCloudPaymentCodes(db, { names: [name], mode: 'dm', now: () => today,
      lookup: async names => { const response = payload(names); mutate(response); return response; } });
    assert.equal(result.results[name].status, 'error');
    assert.equal(result.results[name].checkedAt, '');
    assert.equal(db.sql.prepare('SELECT verified_json FROM payment_todo_code_cache').get().verified_json, null);
  }
});

test('schema, claim and commit errors stop safely instead of bypassing the shared cache', async () => {
  for (const failure of ['CREATE TABLE', 'INSERT INTO', 'UPDATE payment_todo_code_cache SET']) {
    const db = d1(); let calls = 0;
    db.setFail(failure);
    await assert.rejects(queryCloudPaymentCodes(db, { names: [name], mode: 'dm', now: () => today,
      lookup: async names => { calls++; return payload(names); } }), PaymentCodeCacheError);
    assert.equal(calls, failure.startsWith('UPDATE') ? 1 : 0);
  }
  const db = d1(); db.setFail('CREATE TABLE');
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('external call forbidden'); };
  try {
    const response = await onRequestPost({ request: apiRequest({ names: [name] }), env: { DB: db, INNO_APP_KEY: 'fixture', INNO_APP_SECRET: '1234567890abcdef' } });
    assert.equal(response.status, 503); assert.equal(calls, 0);
    assert.equal((await response.json()).code, 'payment_code_cache_unavailable');
  } finally { globalThis.fetch = original; }
});

test('API cache hits use D1 only and preserve auth, no-store, force and provider provenance', async () => {
  const db = d1(), secret = '1234567890abcdef';
  const env = { DB: db, INNO_APP_KEY: 'fixture', INNO_APP_SECRET: secret };
  let calls = 0; const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ data: dm.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data: [{ secShortName: name, securityId: `${102600000 + calls}.IB` }] }), secret) }));
  };
  try {
    const call = async body => {
      const response = await onRequestPost({ request: apiRequest(body), env });
      assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      return response.json();
    };
    assert.equal((await call({ names: [name] })).results[name].cached, false);
    assert.equal((await call({ names: [name], force: false })).results[name].cached, true);
    assert.equal(calls, 1);
    const forced = await call({ names: [name], force: true });
    assert.equal(calls, 2); assert.equal(forced.results[name].matches[0].code, '102600002.IB');
    assert.equal(forced.results[name].matches[0].provider, 'DM');
  } finally { globalThis.fetch = original; }
});

test('temporarily missing source configuration does not block verified cloud codes', async () => {
  const db = d1();
  await queryCloudPaymentCodes(db, { names: [name], mode: 'dm', lookup: async names => payload(names) });
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('no configured source may be requested'); };
  try {
    const fresh = await onRequestPost({ request: apiRequest({ names: [name] }), env: { DB: db } });
    assert.equal(fresh.status, 200);
    assert.equal((await fresh.json()).results[name].cached, true);
    const forced = await onRequestPost({ request: apiRequest({ names: [name], force: true }), env: { DB: db } });
    assert.equal(forced.status, 200);
    const kept = (await forced.json()).results[name];
    assert.equal(kept.status, 'matched'); assert.equal(kept.refreshStatus, 'error');
    assert.equal(kept.matches[0].code, '102600001.IB');
    for (let index = 0; index < 2; index++) {
      const missing = await onRequestPost({ request: apiRequest({ names: ['26新项目MTN001'] }), env: { DB: db } });
      assert.equal(missing.status, 503);
      assert.equal((await missing.json()).code, 'payment_code_source_unavailable');
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('QB rate limiting without an old code retains HTTP 429 and Retry-After across cached retries', async () => {
  const db = d1(); let calls = 0; const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ code: 429, message: 'private-upstream-key' }), { headers: { 'Retry-After': '17' } }); };
  try {
    const env = { DB: db, QB_ACCESS_KEY: 'fixture-key', BOND_DATA_SOURCE_MODE: 'qb' };
    for (let index = 0; index < 2; index++) {
      const response = await onRequestPost({ request: apiRequest({ names: [name] }, 'qb'), env });
      assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '17');
      assert.deepEqual(await response.json(), { source: 'QB', code: 'qb_rate_limited', error: 'QB 接口限流，请稍后重试。', retryAfter: 17 });
    }
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('QB rate limiting during a forced check keeps the verified cached code and its provenance in HTTP 200', async () => {
  const db = d1();
  await queryCloudPaymentCodes(db, { names: [name], mode: 'qb', now: Date.now,
    lookup: async names => payload(names, '102600001.IB', 'QB') });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 429, message: 'private-upstream-key' }), { headers: { 'Retry-After': '17' } });
  try {
    const env = { DB: db, QB_ACCESS_KEY: 'fixture-key', BOND_DATA_SOURCE_MODE: 'qb' };
    const response = await onRequestPost({ request: apiRequest({ names: [name], force: true }, 'qb'), env });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source, 'QB');
    assert.equal(result.results[name].status, 'matched');
    assert.equal(result.results[name].refreshStatus, 'error');
    assert.equal(result.results[name].matches[0].code, '102600001.IB');
    assert.equal(result.results[name].matches[0].provider, 'QB');
    assert.doesNotMatch(JSON.stringify(result), /private|key|fixture|token/);
  } finally { globalThis.fetch = original; }
});
