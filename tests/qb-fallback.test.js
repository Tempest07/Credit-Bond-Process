import test from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackClient, mergeRows, withDataSources } from '../functions/api/qb/fallback.js';
import { makeDmClient, validateDmConfig } from '../functions/api/dm/lookup.js';
import { createValuationService } from '../tools/local-valuation-service.mjs';

const root = '/dm-quant-func-service/api/v1/';
const basic = root + 'bond/basic-info/info';
const market = root + 'bond/market-data/date';
const request = () => new Request('https://local.test/api');
const code = '012682405.IB';
const qbRow = (values = {}) => ({ securityId: code, secShortName: '26测试SCP001', ...values,
  _qb: { apiNames: ['test'], date: '2026-10-22', fieldMap: {} } });
function qb(query) {
  return { today: '2026-10-22', fetchedAt: '2026-10-22T01:00:00Z', query,
    scope: { codes: new Set(), names: new Set(), basicByCode: new Map(), issuerNameBySocietyCode: new Map() } };
}
function dimension(api) {
  return api === 'bondDimInfo' ? [{ ss_sec_code: code, sec_shrt_nm: '26测试SCP001', issuer_nm: '测试有限公司', coupon_rt_cur: 1.38, opt_typ_code: 'NON', trade_dt: '2026-10-22' }] : [];
}

test('no QB configuration preserves legacy DM client and configuration errors', () => {
  const raw = { post() {} };
  assert.equal(createFallbackClient({}, request(), raw), raw);
  assert.equal(withDataSources({ source: 'DM' }, raw).source, 'DM');
  assert.equal(validateDmConfig({ QB_ACCESS_KEY: 'server-only' }), null);
  assert.equal(validateDmConfig({}).status, 503);
});

test('successful complete DM response bypasses QB and stays byte-compatible', async () => {
  const original = [{ securityId: code, newCoupRate: 0 }];
  const c = createFallbackClient({}, request(), { post: async () => original }, { qbClient: qb(() => { throw Error('must not call'); }) });
  assert.equal(await c.post(basic, { securityIdList: [code], fieldNames: ['securityId', 'newCoupRate'] }), original);
  const payload = { source: 'DM', values: original };
  assert.equal(withDataSources(payload, c), payload);
});

test('DM error automatically switches to bounded QB adapter with truthful provenance', async () => {
  const c = createFallbackClient({}, request(), { post: async () => { throw Error('DM HTTP 429'); } }, { qbClient: qb(dimension) });
  const result = await c.post(basic, { securityIdList: [code], fieldNames: ['newCoupRate'] });
  assert.equal(result[0]._provider, 'QB');
  assert.equal(result[0].securityId, code);
  assert.ok(!JSON.stringify(c.sourceInfo()).includes('DM HTTP 429'));
  assert.equal(withDataSources({ source: 'DM', sourcePath: basic }, c).source, 'QB');
});

test('partial fields supplement missing only; zero, false and snake-case DM values survive', () => {
  const result = mergeRows(basic, [{ security_id: code, sec_short_name: '26测试SCP001', new_coup_rate: 0, active: false }],
    [qbRow({ newCoupRate: 2, active: true, issuerName: '测试有限公司' })]);
  assert.equal(result[0].new_coup_rate, 0);
  assert.equal(result[0].newCoupRate, undefined);
  assert.equal(result[0].active, false);
  assert.equal(result[0].issuerName, '测试有限公司');
  assert.equal(result[0]._provider, 'DM+QB');
  assert.equal(result[0]._fieldSources.new_coup_rate, 'DM');
  assert.equal(result[0]._fieldSources.issuerName, 'QB');
});

test('cross-date values never override DM nor create orphan price observations', () => {
  const original = { securityId: code, issueDate: '2026-10-21', cbYtm: 1.4 };
  const result = mergeRows(market, [original], [qbRow({ issueDate: '2026-10-22', cbYtm: 1.5, cbNptm: 100 })]);
  assert.deepEqual(result, [original]);
});

test('same-day mismatched yield-price pair cannot be combined from providers', () => {
  const original = { securityId: code, issueDate: '2026-10-22', cbYtm: 1.4 };
  const result = mergeRows(market, [original], [qbRow({ issueDate: '2026-10-22', cbYtm: 1.5, cbNptm: 100 })]);
  assert.equal(result[0].cbNptm, undefined);
  assert.equal(result[0].cbYtm, 1.4);
});

test('same-day matching pair can supplement missing price, preserves DM yield attribution', () => {
  const result = mergeRows(market, [{ securityId: code, issueDate: '2026-10-22', cbYtm: 1.5 }],
    [qbRow({ issueDate: '2026-10-22', cbYtm: 1.5, cbNptm: 100 })]);
  assert.equal(result[0].cbNptm, 100);
  assert.equal(result[0]._fieldSources.cbYtm, 'DM');
  assert.equal(result[0]._fieldSources.cbNptm, 'QB');
});

test('conflicting QB issuance statuses do not populate a fabricated active bond', () => {
  assert.deepEqual(mergeRows(basic, [], [qbRow({ issueStatusDesc: '正常发行' }), qbRow({ issueStatusDesc: '取消发行' })]), []);
  assert.deepEqual(mergeRows(basic, [], [qbRow({ issueStatusDesc: '正常发行' }), qbRow({ issueStatusDesc: null }), qbRow({ issueStatusDesc: '取消发行' })]), []);
});

test('blank or invalid numeric DM fields are missing, including invalid snake-case aliases', async () => {
  for (const missing of [' ', 'N/A', 'not a number']) {
    const c = createFallbackClient({}, request(), { post: async () => [{ securityId: code, new_coup_rate: missing }] },
      { qbClient: qb(api => api === 'bondDimInfo' ? [{ ss_sec_code: code, sec_shrt_nm: '26测试SCP001', coupon_rt_cur: 1.38 }] : []) });
    const result = await c.post(basic, { securityIdList: [code], fieldNames: ['newCoupRate'] });
    assert.ok(c.sourceInfo().fallbackUsed);
    const merged = mergeRows(basic, [{ securityId: code, new_coup_rate: missing }], [qbRow({ newCoupRate: 1.38 })]);
    assert.equal(merged[0].newCoupRate, 1.38);
    assert.equal(merged[0].new_coup_rate, 1.38);
  }
});

test('QB supplements preserve DM pagination envelopes and remaining DM pages', async () => {
  const c = createFallbackClient({}, request(), { post: async () => ({ list: [{ securityId: code }], maxOffset: 50 }) },
    { qbClient: qb(api => api === 'issuerInfo' ? [{ issuer_name: '测试有限公司', institution_code: 'one' }]
      : api === 'activeBondInfoByIssuer' ? [{ ss_sec_code: code, issuer_code: 'one', issuer_nm: '测试有限公司', coupon_rt_cur: 1.38 }] : []) });
  const result = await c.post(root + 'bond/basic-info/outstanding-bonds', { issuerFullName: '测试有限公司' });
  assert.equal(result.maxOffset, 50);
  assert.equal(result.list[0].newCoupRate, 1.38);
  assert.equal(result.list[0]._provider, 'DM+QB');
});

test('codes on different exchanges are never merged by their short name', () => {
  const dm = { securityId: '246018.SH', secShortName: '26同名01', newCoupRate: 1.5 };
  const result = mergeRows(basic, [dm], [qbRow({ securityId: '246018.IB', secShortName: '26同名01', newCoupRate: 2 })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].newCoupRate, 1.5);
});

test('incomplete DM rating observations do not strip a complete independent QB rating', () => {
  const path = root + 'bond/rating/data';
  for (const missing of ['ratingInstitutionShortName','ratingDate']) {
    const original = { securityId: code, rating: 'AAA', ratingDate: '2026-10-22', ratingInstitutionShortName: '联合资信', [missing]: '' };
    const result = mergeRows(path, [original], [qbRow({ rating:'AAA', ratingDate:'2026-10-22', ratingInstitutionShortName:'联合资信' })]);
    assert.deepEqual(result[0], original);
    assert.equal(result[1].rating, 'AAA');
    assert.equal(result[1].ratingDate, '2026-10-22');
    assert.equal(result[1].ratingInstitutionShortName, '联合资信');
    assert.equal(result[1]._provider, 'QB');
  }
});

test('complete DM ratings keep their observation when QB has another agency or date', () => {
  const original = { securityId: code, rating:'AAA', ratingDate:'2026-10-21', ratingInstitutionShortName:'联合资信' };
  assert.deepEqual(mergeRows(root+'bond/rating/data', [original], [qbRow({ rating:'AA+',ratingDate:'2026-10-22',ratingInstitutionShortName:'中诚信国际',ratingOutlook:'稳定' })]), [original]);
});

test('cancelled request never attempts QB and per-request caches are independent', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const c = createFallbackClient({}, request(), { post: async () => [] }, { qbClient: qb(() => { calls++; return []; }) });
  await assert.rejects(c.post(basic, {}, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const other = createFallbackClient({}, request(), { post: async () => [] }, { qbClient: qb(() => []) });
  assert.deepEqual(other.sourceInfo().used, []);
});

test('known failed DM path is not repeatedly sent during the same request', async () => {
  let count = 0;
  const c = createFallbackClient({}, request(), { post: async () => { count++; throw Error('DM HTTP 429'); } }, { qbClient: qb(dimension) });
  await c.post(basic, { securityIdList: [code] });
  await c.post(basic, { securityIdList: [code] });
  assert.equal(count, 1);
});

test('unsupported endpoint preserves a good DM response and reports safe missing data on failure', async () => {
  const original = [{ securityId: code, price: 1.5 }];
  const c = createFallbackClient({}, request(), { post: async () => original }, { qbClient: qb(() => []) });
  assert.equal(await c.post(root + 'bond/realtime/quotes', {}), original);
  const failing = createFallbackClient({}, request(), { post: async () => { throw Error('sensitive upstream detail'); } }, { qbClient: qb(() => []) });
  await assert.rejects(failing.post(root + 'bond/realtime/quotes', {}), error => !error.message.includes('sensitive'));
});

test('QB-only runtime routes missing DM credentials without encrypting invalid secrets', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(String(url).includes('bondDimInfo') ? dimension('bondDimInfo') : [])));
  const c = makeDmClient({ QB_ACCESS_KEY: 'test-server-secret' }, request());
  const result = await c.post(basic, { securityIdList: [code] });
  assert.equal(result[0].securityId, code);
  assert.equal(c.sourceInfo().used[0], 'QB');
});

test('local valuation service recognizes a QB-only server configuration', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [] }));
  const service = createValuationService({env:{QB_ACCESS_KEY:'server-only'},store:{mutate:async()=>{}}});
  const result = await service('/bond-centre/api/valuation/status','GET');
  assert.equal(result.dmConfigured,true);
});
