import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as valuationHandler, matchValuationRows, __test__ } from '../functions/api/bond-list/valuations.js';
import { __test__ as dmCrypto } from '../functions/api/dm/lookup.js';
import { createMemoryD1 } from './helpers/d1-memory.js';

const onRequestPost = context => valuationHandler({ request: context.request, data: context.data, env: { DB: createMemoryD1(), ...context.env } });

const asOf = '2026-10-22';
const secret = '1234567890abcdef';
const env = { INNO_APP_KEY: 'test', INNO_APP_SECRET: secret };
const ib = '102600001.IB';
const sh = '123456.SH';
function request(body, headers = {}, url = 'http://127.0.0.1:8814/api/bond-list/valuations') {
  return new Request(url, { method: 'POST', headers: {
    Origin: 'http://127.0.0.1:8814', 'X-Bond-List': '1', 'Content-Type': 'application/json', ...headers,
  }, body: JSON.stringify(body) });
}
function match(codes, marketRows, basicRows = []) {
  return matchValuationRows(codes, basicRows, marketRows, asOf);
}

test('valuation API applies login, origin and module-header gates before DM access', async () => {
  const context = { env, data: { dmClient: { post() { throw new Error('must-not-run'); } } } };
  const production = request({ codes: [ib] }, {}, 'https://credit-bond-process.pages.dev/api/bond-list/valuations');
  assert.equal((await onRequestPost({ ...context, request: production })).status, 401);
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-Bond-List': '' }]) {
    assert.equal((await onRequestPost({ ...context, request: request({ codes: [ib] }, headers) })).status, 403);
  }
});

test('valuation API bounds JSON and batches and requires explicit full market codes', async () => {
  const invalid = [null, {}, { codes: [] }, { codes: sh }, { codes: Array(21).fill(sh) },
    ...['123456', 'SH123456', '123456.HK', '12345.SH', '1234567890123.IB', sh + '\nx', '__proto__', 123456, null].map(code => ({ codes: [code] })),
    { codes: [ib], extra: 'x'.repeat(10000) }];
  for (const body of invalid) assert.equal((await onRequestPost({ request: request(body), env })).status, 400);
  const broken = new Request('http://127.0.0.1:8814/api/bond-list/valuations', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:8814', 'X-Bond-List': '1' }, body: '{',
  });
  assert.equal((await onRequestPost({ request: broken, env })).status, 400);
  assert.equal((await onRequestPost({ request: request({ codes: [ib] }), env: {} })).status, 503);
});

test('interbank and every exchange use their mandated institutions without cross-institution fallback', () => {
  const codes = [ib, sh, '123456.SZ', '123456.BJ'];
  const result = match(codes, codes.map(securityId => ({ securityId, issueDate: asOf, cbYtm: 1.5, cbNptm: 101, csYtm: 1.6, csNptm: 102 })));
  assert.deepEqual([result[ib].institution, result[ib].yield, result[ib].netPrice, result[ib].field], ['中债', 1.5, 101, 'cbYtm']);
  for (const code of codes.slice(1)) assert.deepEqual([result[code].institution, result[code].yield, result[code].netPrice, result[code].field], ['中证', 1.6, 102, 'csYtm']);
  const absent = match([ib, sh], [
    { securityId: ib, issueDate: asOf, csYtm: 1.6, csNptm: 102 },
    { securityId: sh, issueDate: asOf, cbYtm: 1.5, cbNptm: 101 },
  ]);
  for (const code of [ib, sh]) assert.equal(absent[code].status, 'missing');
  assert.equal(absent[ib].yield, null);
  assert.equal(absent[sh].netPrice, null);
});

test('exact full codes and consistent aliases are required on returned DM rows', () => {
  const result = match([ib, sh], [
    { securityId: '102600001', issueDate: asOf, cbYtm: 1.5 },
    { securityId: '123456.IB', issueDate: asOf, csYtm: 1.6 },
    { securityId: sh, security_id: '123456.SZ', issueDate: asOf, csYtm: 1.7 },
  ]);
  assert.equal(result[ib].status, 'missing');
  assert.equal(result[sh].status, 'missing');
});

test('a failed mandated QB institution remains an error while other valid institutions and bonds survive', () => {
  const failed = [{ institution: 'CDC', apiName: 'cdcBondValuation', date: asOf, errorCode: 'qb_upstream_failed', securityIdList: [ib] }];
  const rows = [{ securityId: ib, issueDate: asOf, csYtm: 1.7, _qb: { failedInstitutions: failed } },
    { securityId: sh, issueDate: asOf, csYtm: 1.8, _qb: { failedInstitutions: failed } }];
  const result = match([ib, sh], rows);
  assert.equal(result[ib].status, 'error');
  assert.equal(result[ib].reason, 'upstream_failed');
  assert.equal(result[ib].yield, null);
  assert.equal(result[sh].status, 'matched');
  assert.equal(result[sh].yield, 1.8);
  assert.equal(match([ib], [{ securityId: sh, issueDate: asOf, csYtm: 1.8, _qb: { failedInstitutions: failed } }])[ib].status, 'error');
  assert.equal(match([ib], [{ securityId: ib, issueDate: asOf, cbYtm: 1.5, _qb: { failedInstitutions: failed } }])[ib].status, 'matched');
  assert.equal(match([ib], [{ securityId: sh, issueDate: asOf, csYtm: 1.8 }])[ib].status, 'missing');
});

test('latest valid date wins; future, invalid and more than seven-day-old values are excluded', () => {
  const result = match([ib], [
    { securityId: ib, issueDate: '2026-10-21', cbYtm: 1.5 },
    { securityId: ib, issueDate: '2026-10-22', cbYtm: 1.6 },
    { securityId: ib, issueDate: '2026-10-23', cbYtm: 1.7 },
    { securityId: ib, issueDate: '2026-02-30', cbYtm: 1.8 },
    { securityId: ib, issueDate: '2026-10-14', cbYtm: 1.9 },
  ]);
  assert.equal(result[ib].yield, 1.6);
  assert.equal(result[ib].date, asOf);
  for (const issueDate of ['2026-10-23', '2026-02-30', '2026-10-14', '']) {
    assert.equal(match([ib], [{ securityId: ib, issueDate, cbYtm: 1.5 }])[ib].status, 'missing');
  }
  assert.equal(match([ib], [{ securityId: ib, issueDate: '2026-10-15', cbYtm: 1.5 }])[ib].status, 'matched');
});

test('valuation date is used instead of an unrelated issue date and contradictory date aliases fail closed', () => {
  const row = { securityId: ib, valuationDate: '2026-10-21', issueDate: '2026-10-01', cbYtm: 1.5 };
  assert.equal(match([ib], [row])[ib].date, '2026-10-21');
  assert.equal(match([ib], [{ ...row, valuation_date: asOf }])[ib].status, 'missing');
  assert.equal(match([ib], [{ ...row, valuationDate: 'invalid' }])[ib].status, 'missing');
});

test('ordinary bonds use maturity yield and its net price and never silently substitute exercise', () => {
  const result = match([ib], [{ securityId: ib, issueDate: asOf, cbYtm: 1.5, cbYte: 1.6, cbNptm: 101, cbNpte: 102 }])[ib];
  assert.deepEqual([result.yield, result.netPrice, result.basis, result.field, result.basisFallback], [1.5, 101, '到期', 'cbYtm', false]);
  assert.equal(match([ib], [{ securityId: ib, issueDate: asOf, cbYte: 1.6, cbNpte: 102 }])[ib].status, 'missing');
  const missingPrice = match([ib], [{ securityId: ib, issueDate: asOf, cbYtm: 1.5, cbNpte: 102 }])[ib];
  assert.equal(missingPrice.netPrice, null);
});

test('exercise bonds select exercise yield and matching price, and explicitly label a maturity fallback', () => {
  for (const code of [ib, sh]) {
    const prefix = code === ib ? 'cb' : 'cs';
    const basic = [{ securityId: code, nextOptionDate: '2028-10-22' }];
    const row = { securityId: code, issueDate: asOf, [prefix + 'Ytm']: 1.6, [prefix + 'Yte']: 1.5, [prefix + 'Nptm']: 101, [prefix + 'Npte']: 102 };
    const exercise = match([code], [row], basic)[code];
    assert.deepEqual([exercise.yield, exercise.netPrice, exercise.basis, exercise.field, exercise.preferredBasis, exercise.basisFallback], [1.5, 102, '行权', prefix + 'Yte', '行权', false]);
    const fallback = match([code], [{ ...row, [prefix + 'Yte']: undefined }], basic)[code];
    assert.deepEqual([fallback.yield, fallback.netPrice, fallback.basis, fallback.field, fallback.preferredBasis, fallback.basisFallback], [1.6, 101, '到期', prefix + 'Ytm', '行权', true]);
    const missingPrice = match([code], [{ ...row, [prefix + 'Npte']: undefined }], basic)[code];
    assert.equal(missingPrice.netPrice, null);
  }
});

test('exercise preference uses option dates and structured terms rather than a bond name', () => {
  for (const basic of [{ bondMatu: '3+2Y' }, { bondMatu: '5+N' }, { specialItem: '发行人续期选择权' }, { next_option_date: asOf }]) {
    assert.equal(__test__.basicPrefersExercise(basic, asOf), true);
  }
  assert.equal(__test__.basicPrefersExercise({ nextOptionDate: '2026-10-21', bondMatu: '5Y' }, asOf), false);
  assert.equal(__test__.basicPrefersExercise({ secShortName: '测试永续债' }, asOf), false);
  assert.equal(__test__.chinaToday(new Date('2026-10-21T16:00:00Z')), asOf);
});

test('missing or malformed numeric values remain missing instead of inventing zero or using prices', () => {
  for (const cbYtm of [null, undefined, '', ' ', false, true, '1.5%', '估值+1', Infinity, -5, 25]) {
    const result = match([ib], [{ securityId: ib, issueDate: asOf, cbYtm, cbNptm: 100, couponRate: 1.5, csYtm: 1.7 }])[ib];
    assert.equal(result.status, 'missing', String(cbYtm));
    assert.equal(result.yield, null);
    assert.equal(result.netPrice, null);
  }
  for (const cbYtm of [0, '0', -0.1, ' 1.5 ']) assert.equal(match([ib], [{ securityId: ib, issueDate: asOf, cbYtm }])[ib].yield, Number(cbYtm));
  assert.equal(match([ib], [{ securityId: ib, issueDate: asOf, cbYtm: 1.5, cb_ytm: 1.6 }])[ib].status, 'missing');
  assert.equal(match([ib], [])[ib].status, 'missing');
});

test('same-date recommendation and source preference are deterministic and contradictory tied values are missing', () => {
  const row = { securityId: ib, issueDate: asOf, cbYtm: 1.5, cbReliability: '推荐', dataSource: 1 };
  const result = match([ib], [{ ...row, cbReliability: '参考', cbYtm: 1.7 }, { ...row, dataSource: 3, cbYtm: 1.6 }, row])[ib];
  assert.equal(result.yield, 1.5);
  assert.equal(result.reliability, '推荐');
  assert.equal(result.dataSource, 1);
  assert.equal(match([ib], [row, { ...row, cbYtm: 1.6 }])[ib].reason, 'ambiguous');
});

test('API batches 20 unique codes by five, keeps all full codes and uses only read-only DM endpoints', async () => {
  const calls = [];
  const codes = Array.from({ length: 20 }, (_, index) => String(123456 + index) + '.SH');
  const response = await onRequestPost({ request: request({ codes }), env, data: { dmClient: { async post(path, body, options) {
    calls.push({ path, body, options });
    if (path.endsWith('/basic-info/info')) return [];
    return body.securityIdList.map(securityId => ({ security_id: securityId, issue_date: body.endDate, cs_ytm: 1.5, cs_nptm: 100 }));
  } } }, get DB() { throw new Error('D1 must not be touched'); } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.source, 'DM');
  assert.ok(Number.isFinite(Date.parse(payload.fetchedAt)));
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.slice(1).map(call => call.body.securityIdList.length), [5, 5, 5, 5]);
  assert.ok(calls.every(call => call.options.signal));
  assert.ok(calls.slice(1).every(call => call.path.endsWith('/bond/market-data/date')));
  assert.deepEqual(calls[1].body.dataSourceList, [1, 3, 4, 7]);
  assert.equal(payload.results[codes[0]].yield, 1.5);
  assert.equal(Object.keys(payload.results).length, 20);
});

test('API uses the existing encrypted DM client, normalizes casing and deduplicates input', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(dmCrypto.sm4DecryptFromBase64Url(init.body, secret));
    seen.push({ url, body });
    assert.equal(init.headers['X-Dm-App-Key'], 'test');
    const data = String(url).endsWith('/market-data/date') ? [{ securityId: ib, issueDate: body.endDate, cbYtm: 1.5 }] : [];
    return new Response(JSON.stringify({ data: dmCrypto.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret) }));
  };
  try {
    const response = await onRequestPost({ request: request({ codes: [' ' + ib.toLowerCase() + ' ', ib] }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(seen.map(call => call.body.securityIdList), [[ib], [ib]]);
    assert.equal((await response.json()).results[ib].yield, 1.5);
  } finally { globalThis.fetch = original; }
});

test('upstream failures, timeouts and malformed rows fail safely without secret details or a fake result', async () => {
  for (const post of [async () => { throw new Error('sensitive-token-must-not-leak'); },
    async () => { throw new DOMException('sensitive-token-timeout', 'TimeoutError'); }, async () => [null]]) {
    const response = await onRequestPost({ request: request({ codes: [ib] }), env, data: { dmClient: { post } } });
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.doesNotMatch(text, /sensitive-token|"matched"|"yield":0/);
    assert.match(text, /暂时失败或超时/);
  }
});

test('a DM function access rejection is explicit without asserting the whole valuation service is unsubscribed', async () => {
  const response = await onRequestPost({ request: request({ codes: [ib] }), env, data: { dmClient: {
    async post() { throw new Error('DM HTTP 429: {"code":"GW-000-4006","message":"无订阅套餐","traceId":"private-upstream-value"}'); },
  } } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'dm_valuation_access_denied', error: 'DM 当前估值请求被拒绝（GW-000-4006），请核对该应用的接口授权或调用配置。' });
});
