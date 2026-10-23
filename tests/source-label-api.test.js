import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as lookup, __test__ as lookupTest } from '../functions/api/dm/lookup.js';
import { onRequestGet as curve } from '../functions/api/dm/curve.js';
import { onRequestGet as valuation } from '../functions/api/dm/valuation.js';
import { onRequestPost as quotes } from '../functions/api/dm/realtime-quotes.js';
import { onRequestPost as realtimeValuations } from '../functions/api/dm/realtime-valuations.js';
import { onRequestPost as trades } from '../functions/api/dm/trade-records.js';

const origin = 'http://127.0.0.1:8814';
const env = { QB_ACCESS_KEY: 'fixture-key', BOND_DATA_SOURCE_MODE: 'qb' };
function context(path, body, post = async () => []) {
  return {
    env,
    request: new Request(`${origin}/api/dm/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: origin, 'X-Bond-List': '1', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    data: { dmClient: { post, sourceInfo: () => ({ mode: 'qb', used: ['QB'], events: [] }) } },
  };
}

test('forced QB lookup with an empty response never describes DM as the queried provider', async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(new URL(url).origin, 'https://data-api.qeubee.cn');
    return Response.json({ code: 0, data: [] });
  };
  try {
    const response = await lookup(context('lookup?securityId=012682405.IB'));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.noResult, true);
    assert.equal(result.source, 'QB');
    assert.match(result.hint, /没有匹配到该债券/);
    assert.doesNotMatch(result.hint, /DM/);
    assert.doesNotMatch(result.diagnostic.noResult.reason, /DM/);
    assert.ok(calls > 0);
  } finally { globalThis.fetch = saved; }
});

test('forced QB full-name candidate failures retain QB attribution without inventing a DM failure', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).origin, 'https://data-api.qeubee.cn');
    return Response.json({ error: 'fixture error' }, { status: 503 });
  };
  try {
    const response = await lookup(context(`lookup?fullName=${encodeURIComponent('测试集团有限公司2026年度第一期中期票据')}`));
    const result = await response.json();
    assert.equal(result.source, 'QB');
    assert.match(result.error, /候选查询未完成/);
    assert.doesNotMatch(result.error, /DM/);
    assert.ok(result.diagnostic.fullNameDiscovery.errors.length > 0);
    assert.ok(result.diagnostic.fullNameDiscovery.errors.every(message => !message.includes('DM')));
  } finally { globalThis.fetch = saved; }
});

test('QB curve success and empty results preserve actual source and generic hints', async () => {
  for (const successful of [true, false]) {
    const response = await curve(context('curve?asOf=2026-10-22', null, async (_, input) => successful
      ? input.curveTermList.map(term => ({ curveChName: '中债国开债收益率曲线', dataSource: 18, curveType: 1,
        curveTerm: Number(term), valuationDate: '2026-10-22', yield: 1.5, _provider: 'QB' })) : []));
    const result = await response.json();
    assert.equal(result.source, 'QB');
    assert.equal(result.ok, successful);
    assert.doesNotMatch(result.hint || '', /DM/);
    if (successful) assert.equal(result.actualValuationDate, '2026-10-22');
  }
});

test('forced QB rating notes distinguish direct QB retrieval from an automatic supplement', () => {
  const normalized = { subjectRating: 'AAA', ratingAgency: '中诚信国际',
    ratingSource: { subjectRating: 'qb-rating-api', ratingAgency: 'qb-rating-api' } };
  const qb = lookupTest.ratingDiagnostic({}, {}, {}, null, normalized, false, false, 'qb');
  assert.match(qb.note, /已通过 QB 取得主体评级、评级机构/);
  assert.doesNotMatch(qb.note, /DM|补齐/);
  const mixed = lookupTest.ratingDiagnostic({}, {}, {}, null, normalized, false, false, 'auto');
  assert.match(mixed.note, /已有 DM 数据保持优先/);
  const empty = lookupTest.ratingDiagnostic({}, {}, {}, null, {}, false, false, 'qb');
  assert.doesNotMatch(empty.note, /DM/);
  const historicalDm = { impliedRating: 'AA+', ratingSource: { impliedRating: 'dm-rating-api' } };
  assert.match(lookupTest.ratingDiagnostic(historicalDm, {}, {}, null, historicalDm, false, false, 'qb').note, /^DM V2.5/);
});

test('QB failures and rate limits survive realtime and trade API boundaries without generic DM hints', async () => {
  for (const [handler, path, body] of [
    [quotes, 'realtime-quotes', { queries: ['012682405.IB'] }],
    [realtimeValuations, 'realtime-valuations', { securityIds: ['012682405.IB'] }],
    [trades, 'trade-records', { rows: [{ id: 'one', securityId: '012682405.IB', negotiationDate: '2026-10-23' }] }],
  ]) {
    for (const limited of [false, true]) {
      const error = Object.assign(new Error(limited ? 'QB rate limit' : 'QB 查询暂时失败'),
        limited ? { status: 429, code: 'qb_rate_limited' } : {});
      const response = await handler(context(path, body, async () => { throw error; }));
      const result = await response.json();
      assert.equal(response.status, limited ? 429 : 502, path);
      assert.doesNotMatch(`${result.error || ''} ${result.hint || ''}`, /DM/, path);
      if (limited) { assert.equal(result.code, 'qb_rate_limited'); assert.equal(result.source, 'QB'); }
    }
  }
});

test('valuation assistant input and upstream failure hints follow the selected data source', async () => {
  const missing = await (await valuation(context('valuation'))).json();
  assert.equal(missing.reason, 'missingIssuer');
  assert.doesNotMatch(missing.hint, /DM/);
  const saved = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).origin, 'https://data-api.qeubee.cn');
    return Response.json({ code: 429, message: 'rate limit exceeded' });
  };
  try {
    const response = await valuation(context(`valuation?issuerName=${encodeURIComponent('测试集团有限公司')}&durationText=3Y`));
    const result = await response.json();
    assert.equal(response.status, 429);
    assert.equal(result.code, 'qb_rate_limited');
    assert.equal(result.source, 'QB');
  } finally { globalThis.fetch = saved; }
});
