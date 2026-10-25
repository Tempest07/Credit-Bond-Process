import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, __test__ } from '../functions/api/dm/lookup.js';
import { basicFallback } from '../functions/api/qb/basic.js';
import { marketFallback } from '../functions/api/qb/market.js';
import { mergeRows } from '../functions/api/qb/fallback.js';

const root = '/dm-quant-func-service/api/v1';
const base = '26苏元禾MTN003';
const issuer = '苏州元禾控股股份有限公司';
const names = [`${base}A(科创债)`, `${base}B(科创债)`];
const issues = names.map((name, i) => ({ sec_shrt_nm: name, ss_sec_code: `S6575${3 - i}.IB`,
  inst_nm: issuer, sec_full_nm: '苏州元禾控股股份有限公司2026年度第三期中期票据',
  iss_strt_dt: '2026-10-26', iss_end_dt: '2026-10-26', pay_dt: '2026-10-27', sec_trm: i ? '5Y' : '3Y',
  sts: '发行中', pln_iss_sz: '5亿', bid_low_lim: i ? 1.5 : 1.4, bid_upr_lim: i ? 2 : 1.9,
  ofr_type: '公募', bond_typ: '中期票据', listed_market: '银行间' }));

test('attribute discovery preserves complete cloud labels and requires the entire core identity', () => {
  const state = { projects: [{ shortName: `${base}A/B(绿色)`, tranches: [{ shortName: `${base}A` }] },
    { shortName: '26别家MTN003A/B(绿色)' }, { shortName: '25苏元禾MTN003A/B(绿色)' },
    { shortName: '26苏元禾MTN004A/B(绿色)' }, { shortName: '26苏元禾PPN003A/B(绿色)' }] };
  const candidates = __test__.attributedShortNameCandidates(base, state);
  assert.ok(candidates.includes(`${base}A(绿色)`));
  assert.ok(candidates.includes(`${base}B(绿色)`));
  assert.ok(names.every(name => candidates.includes(name)));
  assert.ok(candidates.every(name => name.startsWith(base)));
  assert.ok(__test__.attributedShortNameCandidates(`${base}A`, state).every(name => name.startsWith(`${base}A`)));
  assert.deepEqual(__test__.attributedShortNameCandidates('苏元禾'), []);
});

test('QB preserves exact pre-issue identity without sending temporary identifiers to dimension lookup', async () => {
  const calls = [];
  const client = { today: '2026-10-25', fetchedAt: '2026-10-25T12:00:00Z', async query(api, params) {
    calls.push({ api, params });
    if (api !== 'creditBondIssueInfo') throw new Error('temporary code must not reach dimension lookup');
    return issues.filter(row => row.sec_shrt_nm === params.sec_shrt_nm);
  } };
  const rows = await basicFallback(`${root}/bond/basic-info/info`, { secShortNameList: names }, client);
  assert.deepEqual(rows.map(row => row.secShortName), names);
  assert.ok(rows.every(row => !row.securityId && row.qbPreIssueCode.startsWith('S')));
  assert.equal(calls.length, 2);
  const primary = await marketFallback(`${root}/bond/primary/data`, {
    secShortNameList: names, issuerFullName: issuer, startDate: '2026-10-26', endDate: '2026-10-26',
  }, client);
  assert.deepEqual(primary.map(row => row.planIssueAmount), [50000, 50000]);
  assert.deepEqual(primary.map(row => row.subscribeRate), ['1.4-1.9', '1.5-2']);
  assert.ok(primary.every(row => !row.securityId));
  assert.deepEqual(await marketFallback(`${root}/bond/primary/data`, {
    secShortNameList: names, issuerFullName: issuer, endDate: '2026-10-25',
  }, client), [], 'a future plan must still respect the requested end date');
});

test('QB pre-issue evidence cannot merge conflicting same-name issuers or catalogue identifiers', () => {
  const row = { secShortName: names[0], issuerName: issuer, qbPreIssueCode: 'S65753.IB',
    _qb: { apiNames: ['creditBondIssueInfo'], fieldMap: {} } };
  for (const extra of [{ ...row, issuerName: '另一发行人有限公司' }, { ...row, qbPreIssueCode: 'S99999.IB' }]) {
    assert.deepEqual(mergeRows(`${root}/bond/basic-info/info`, [], [row, extra]), []);
  }
});

test('auto fallback cannot fill same-name DM pre-issue data from a different QB issuer', () => {
  const dm = { secShortName: names[0], issuerName: issuer, bondMatu: '3Y' };
  for (const issuerField of ['issuerName', 'issuerFullName']) {
    const qb = { secShortName: names[0], [issuerField]: '另一发行人有限公司',
      qbPreIssueCode: 'S65753.IB', issCoupRate: 2, _qb: { apiNames: ['creditBondIssueInfo'] } };
    for (const path of [`${root}/bond/basic-info/info`, `${root}/bond/primary/data`]) {
      assert.deepEqual(mergeRows(path, [dm], [qb]), [dm]);
    }
  }
});

for (const mode of ['dm', 'qb', 'auto']) {
  test(`${mode}: omitted theme discovers verified A/B with independent plans and no fabricated formal codes`, async () => {
    const originalFetch = globalThis.fetch, secret = '1234567890abcdef', calls = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(input); calls.push(url.pathname);
      if (url.hostname === 'data-api.qeubee.cn') {
        assert.notEqual(mode, 'dm');
        const data = url.pathname.endsWith('/creditBondIssueInfo')
          ? issues.filter(row => row.sec_shrt_nm === url.searchParams.get('sec_shrt_nm')) : [];
        return Response.json({ code: 200, data });
      }
      assert.notEqual(mode, 'qb');
      const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
      let data = [];
      if (mode === 'dm' && url.pathname.endsWith('/basic-info/info')) data = issues
        .filter(row => request.secShortNameList?.includes(row.sec_shrt_nm))
        .map(row => ({ secShortName: row.sec_shrt_nm, issuerName: row.inst_nm, secFullName: row.sec_full_nm,
          bondMatu: row.sec_trm, issStartDate: row.iss_strt_dt }));
      if (mode === 'dm' && url.pathname.endsWith('/primary/data')) data = { list: issues.map(row => ({
        secShortName: row.sec_shrt_nm, issuerFullName: row.inst_nm, secFullName: row.sec_full_nm,
        issueStartDate: row.iss_strt_dt, payDate: row.pay_dt, bondIssueTenor: row.sec_trm,
        planIssueAmount: 50000, subscribeRate: `${row.bid_low_lim}-${row.bid_upr_lim}`, publicOfferingStatus: '公募',
      })) };
      return Response.json({ data: __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret) });
    };
    try {
      const params = new URLSearchParams({ shortName: base, startDate: '2026-10-26', endDate: '2026-10-26' });
      const response = await onRequestGet({ env: { APP_PASSWORD: 'pw', INNO_APP_KEY: 'app',
        INNO_APP_SECRET: secret, QB_ACCESS_KEY: 'test-key' },
        request: new Request(`http://127.0.0.1/api/dm/lookup?${params}`, {
          headers: { Authorization: 'Bearer pw', 'X-Bond-Data-Source': mode },
        }) });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.noDmBondResult, false);
      assert.equal(result.identityError, '');
      assert.deepEqual(result.issueGroup.tranches.map(row => row.shortName), names);
      assert.deepEqual(result.issueGroup.tranches.map(row => row.tenor), ['3Y', '5Y']);
      assert.deepEqual(result.issueGroup.tranches.map(row => row.planScale), [5, 5]);
      assert.ok(result.issueGroup.tranches.every(row => !row.securityId));
      assert.equal(result.normalized.securityId, '');
      assert.equal(result.source, mode === 'dm' ? undefined : 'QB');
    } finally { globalThis.fetch = originalFetch; }
  });
}
