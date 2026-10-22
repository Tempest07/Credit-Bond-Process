import test from 'node:test';
import assert from 'node:assert/strict';
import { basicFallback } from '../functions/api/qb/basic.js';

const ROOT = '/dm-quant-func-service/api/v1';
const BASIC = `${ROOT}/bond/basic-info/info`;
const OUTSTANDING = `${ROOT}/bond/basic-info/outstanding-bonds`;
const code = '012682405.IB';
const name = '26鼓风机SCP002';
const fetchedAt = '2026-10-22T05:00:00.000Z';
const dimension = {
  ss_sec_code: code, sec_shrt_nm: name, sec_full_nm: '测试2026年度第二期超短期融资券',
  issuer_nm: '测试有限公司', issuer_code: 'S001211', coupon_rt_cur: 1.38, coupon_rt_iss: 1.38,
  trade_dt: '2026-10-22', sec_trm: '270D', trm_unit: 'D', inst_rating_nm_cur: 'AA+',
  issuer_rating_agcy: '中诚信国际', iss_sz: 50000, otstd_amnt: 50000,
};
const issue = {
  ss_sec_code: code, sec_shrt_nm: name, inst_nm: '测试有限公司', bond_typ: '超短期融资券',
  issuer_rating: 'AA', tot_actl_iss_amt: 5, coupon_rt: 1.38, sts: '已截标', pay_dt: 20261013,
};
function client(responses = {}) {
  const calls = [];
  return {
    calls, today: '2026-10-22', fetchedAt,
    async query(api, params) {
      calls.push({ api, params });
      const response = responses[api] ?? [];
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response(params) : structuredClone(response);
    },
  };
}

test('QB basic adapter owns only its two documented DM paths', async () => {
  const c = client();
  assert.equal(await basicFallback('/bond/primary/data', {}, c), null);
  assert.equal(await basicFallback('/company/basic-info/info', {}, c), null);
  assert.deepEqual(c.calls, []);
});

test('option metadata does not spend one issuance query per bond in a valuation batch', async () => {
  const c = client({ bondDimInfo: [dimension] });
  const result = await basicFallback(BASIC, { securityIdList: [code], fieldNames: ['securityId','secShortName','nextOptionDate','bondMatu','specialItem'] }, c);
  assert.equal(result[0].securityId, code);
  assert.deepEqual(c.calls.map(call => call.api), ['bondDimInfo']);
});

test('QB basic query is bounded, requires full market code or exact name, and never scans a table', async () => {
  for (const input of [ {}, { securityIdList: ['012682405'] }, { securityIdList: ['012682405.HK'] },
    { secShortNameList: [''] }, { secShortNameList: ['测试,另一券'] },
    { securityIdList: Array.from({ length: 21 }, (_, i) => `${100000 + i}.SH`) } ]) {
    const c = client();
    assert.deepEqual(await basicFallback(BASIC, input, c), []);
    assert.deepEqual(c.calls, []);
  }
});

test('QB exact-code fallback maps current coupon and identity, keeps provenance and converts only known units', async () => {
  const c = client({ bondDimInfo: [dimension], creditBondIssueInfo: [issue] });
  const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
  assert.deepEqual(c.calls, [
    { api: 'bondDimInfo', params: { ss_sec_code: code, page: 1, pageSize: 20 } },
    { api: 'creditBondIssueInfo', params: { sec_shrt_nm: name } },
  ]);
  assert.equal(row.securityId, code);
  assert.equal(row.newCoupRate, 1.38);
  assert.equal(row.issuerRating, 'AA+', 'current dimension rating outranks old issuance rating');
  assert.equal(row.actuIssAmut, 50000);
  assert.equal(row.newSize, undefined, 'undocumented dimension amount unit must not be guessed');
  assert.equal(row.circuAmut, undefined);
  assert.equal(row.payDate, '2026-10-13');
  assert.equal(row.issueStatusDesc, '已截标');
  assert.equal(row.bondTypeDesc, '超短期融资券');
  assert.deepEqual(row._qb.apiNames, ['bondDimInfo', 'creditBondIssueInfo']);
  assert.equal(row._qb.fieldMap.newCoupRate, 'coupon_rt_cur');
  assert.equal(row._qb.units.newCoupRate, '%');
  assert.equal(row._qb.date, '2026-10-22');
  assert.equal(row._qb.fetchedAt, fetchedAt);
});

test('QB exact name lookup discovers full codes and preserves tranche / suffix ambiguity', async () => {
  const tranche = '26测试MTN001A';
  const c = client({
    creditBondIssueInfo: [
      { ...issue, sec_shrt_nm: tranche, ss_sec_code: '102600001.IB' },
      { ...issue, sec_shrt_nm: tranche, ss_sec_code: '123456.SH' },
      { ...issue, sec_shrt_nm: '26测试MTN001B', ss_sec_code: '102600002.IB' },
    ],
    bondDimInfo: [
      { ...dimension, sec_shrt_nm: tranche, ss_sec_code: '102600001.IB' },
      { ...dimension, sec_shrt_nm: tranche, ss_sec_code: '123456.SH' },
    ],
  });
  const rows = await basicFallback(BASIC, { secShortNameList: [tranche] }, c);
  assert.deepEqual(rows.map(row => row.securityId).sort(), ['102600001.IB', '123456.SH']);
  assert.equal(c.calls[0].params.sec_shrt_nm, tranche);
  assert.equal(c.calls[1].params.ss_sec_code, '102600001.IB,123456.SH');
});

test('QB ignores off-target returned codes even if a vendor response includes extra rows', async () => {
  const c = client({ bondDimInfo: [dimension, { ...dimension, ss_sec_code: '123456.SH' }], creditBondIssueInfo: [issue] });
  assert.deepEqual((await basicFallback(BASIC, { securityIdList: [code] }, c)).map(row => row.securityId), [code]);
});

test('QB cancellation and failure status survives both absent dimension and conflicting status rows', async () => {
  for (const status of ['取消发行', '发行失败', '流标']) {
    const c = client({ creditBondIssueInfo: [{ ...issue, sts: status }] });
    const [row] = await basicFallback(BASIC, { secShortNameList: [name] }, c);
    assert.equal(row.issueStatusDesc, status);
    assert.equal(row.securityId, code);
    assert.equal(row.newCoupRate, undefined, 'issuance rate is not the current coupon');
    assert.deepEqual(row._qb.apiNames, ['creditBondIssueInfo']);
  }
  const c = client({ bondDimInfo: [dimension], creditBondIssueInfo: [issue, { ...issue, sts: '取消发行' }] });
  const rows = await basicFallback(BASIC, { securityIdList: [code] }, c);
  assert.deepEqual(rows.map(row => row.issueStatusDesc), ['已截标', '取消发行']);
});

test('QB disabled debt rating / undocumented enum descriptions are never used', async () => {
  const c = client({ bondDimInfo: [{ ...dimension, bond_rating_nm_cur: 'AAA', scn: 'SUB', coupon_rt_typ_code: 'FRB' }] });
  const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
  assert.equal(row.bondRating, undefined);
  assert.equal(row.paymentOrder, undefined);
  assert.equal(row.rateTypeParDesc, undefined);
  assert.equal(row.bondTypeDesc, undefined);
  assert.equal(row.qbPaymentOrderCode, 'SUB');
  assert.equal(row.qbRateTypeCode, 'FRB');
});

test('QB dates use Shanghai calendar semantics and callable / perpetual evidence stays explicit', async () => {
  const c = client({ bondDimInfo: [{ ...dimension, trade_dt: '2026-10-21T16:00:00.000Z',
    nxt_strike_dt: '2027-01-01T16:00:00.000Z', is_perpetual_bond: 'Y', embeddedopt: 'Y',
    trm_strc: '3+N', is_municipal: 'N' }] });
  const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
  assert.equal(row._qb.date, '2026-10-22');
  assert.equal(row.nextOptionDate, '2027-01-02');
  assert.equal(row.bondMatu, '3+N');
  assert.equal(row.specialItem, '永续债；含权债');
  assert.equal(row.cityAnnexFlag, 0);
  assert.equal(row._qb.fieldMap.specialItem, 'is_perpetual_bond,embeddedopt');
});

test('QB issuance enrichment cannot overwrite authoritative perpetual / exercise term structure', async () => {
  for (const structure of ['3+N', '3+2']) {
    const c = client({
      bondDimInfo: [{ ...dimension, trm_strc: structure, sec_trm: '5Y' }],
      creditBondIssueInfo: [{ ...issue, sec_trm: '3Y', tot_actl_iss_amt: 10 }],
    });
    const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
    assert.equal(row.bondMatu, structure);
    assert.equal(row._qb.fieldMap.bondMatu, 'trm_strc');
    assert.equal(row.actuIssAmut, 100000, 'other valid issuance enrichment still applies');
    assert.equal(row.issueStatusDesc, '已截标');
  }
});

test('QB keeps raw NON / ETS / PUT option enums from dimension or issuance without translating them', async () => {
  for (const option of ['NON', 'ETS', 'PUT']) {
    const c = client({
      bondDimInfo: [{ ...dimension, opt_typ_code: option }],
      creditBondIssueInfo: [{ ...issue, opt_typ_code: 'OTHER' }],
    });
    const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
    assert.equal(row.qbOptionTypeCode, option, 'dimension option enum must survive issuance enrichment');
    assert.equal(row._qb.fieldMap.qbOptionTypeCode, 'opt_typ_code');
    assert.equal(row.specialItem, undefined, 'an untranslated enum must not fabricate a clause description');
    const issueOnly = client({ creditBondIssueInfo: [{ ...issue, opt_typ_code: option }] });
    const [preIssue] = await basicFallback(BASIC, { secShortNameList: [name] }, issueOnly);
    assert.equal(preIssue.qbOptionTypeCode, option);
    assert.deepEqual(preIssue._qb.apiNames, ['creditBondIssueInfo']);
  }
});

test('QB status conflicts remain separate exact-code evidence and duplicate rows do not invent a cancellation', async () => {
  const original = [issue, { ...issue }, { ...issue, sts: '发行失败' },
    { ...issue, ss_sec_code: '123456.SH', sts: '取消发行' }];
  for (const dimensions of [[dimension], []]) {
    const c = client({ bondDimInfo: dimensions, creditBondIssueInfo: original });
    const rows = await basicFallback(BASIC, { securityIdList: [code], secShortNameList: [name] }, c);
    const targetRows = rows.filter(row => row.securityId === code);
    assert.deepEqual(targetRows.map(row => row.issueStatusDesc), ['已截标', '发行失败']);
    assert.equal(targetRows.some(row => row.issueStatusDesc === '取消发行'), false);
    assert.equal(rows.find(row => row.securityId === '123456.SH')?.issueStatusDesc, '取消发行');
  }
  assert.deepEqual(original.map(row => row.sts), ['已截标', '已截标', '发行失败', '取消发行'], 'raw statuses are unchanged');
});

test('QB will not leak a later snapshot into historical requests or accept a future snapshot', async () => {
  const c = client();
  assert.deepEqual(await basicFallback(BASIC, { securityIdList: [code], endDate: '2026-10-20' }, c), []);
  assert.deepEqual(c.calls, []);
  const future = client({ bondDimInfo: [{ ...dimension, trade_dt: '2026-10-23' }] });
  assert.deepEqual(await basicFallback(BASIC, { securityIdList: [code] }, future), []);
});

test('QB missing / invalid numeric fields stay absent while zero coupon remains valid', async () => {
  const c = client({ bondDimInfo: [{ ...dimension, coupon_rt_cur: 0, coupon_rt_iss: null, par_val: 'bad' }] });
  const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
  assert.equal(row.newCoupRate, 0);
  assert.equal(row.issCoupRate, undefined);
  assert.equal(row.bondParVal, undefined);
});

test('QB issuance description failure does not discard a valid dimension coupon', async () => {
  const c = client({ bondDimInfo: [dimension], creditBondIssueInfo: new Error('unavailable') });
  const [row] = await basicFallback(BASIC, { securityIdList: [code] }, c);
  assert.equal(row.newCoupRate, 1.38);
  assert.equal(row.issueStatusDesc, undefined);
  assert.deepEqual(row._qb.apiNames, ['bondDimInfo']);
});

test('QB outstanding lookup requires exact issuer identity then ins_code, never societyCode', async () => {
  const c = client({
    issuerInfo: [{ issuer_name: '测试有限公司', institution_code: 'S001211' }, { issuer_name: '相似测试有限公司', institution_code: 'A000001' }],
    activeBondInfoByIssuer: [dimension, { ...dimension, issuer_code: 'A000001' }, { ...dimension, ss_sec_code: '123456.SH', issuer_nm: '另一家公司' }],
  });
  const [row] = await basicFallback(OUTSTANDING, { issuerFullName: '测试有限公司' }, c);
  assert.deepEqual(c.calls, [
    { api: 'issuerInfo', params: { issuer_name: '测试有限公司' } },
    { api: 'activeBondInfoByIssuer', params: { ins_code: 'S001211' } },
  ]);
  assert.equal(row.securityId, code);
  assert.equal(row.societyCode, undefined);
  assert.deepEqual(row._qb.apiNames, ['issuerInfo', 'activeBondInfoByIssuer']);
  assert.equal(row._qb.fieldMap.issuerName, 'issuer_nm');
  const noName = client();
  assert.deepEqual(await basicFallback(OUTSTANDING, { societyCode: '00000000' }, noName), []);
  assert.deepEqual(noName.calls, []);
});

test('QB ambiguous issuers and subsequent DM offset pages do not repeat or invent outstanding bonds', async () => {
  const c = client({ issuerInfo: [
    { issuer_name: '测试有限公司', institution_code: 'A000001' },
    { issuer_name: '测试有限公司', institution_code: 'A000002' },
  ] });
  assert.deepEqual(await basicFallback(OUTSTANDING, { issuerFullName: '测试有限公司' }, c), []);
  assert.equal(c.calls.length, 1);
  const page = client();
  assert.deepEqual(await basicFallback(OUTSTANDING, { issuerFullName: '测试有限公司', offset: 20 }, page), []);
  assert.deepEqual(page.calls, []);
});

test('QB rejects invalid upstream response shapes and propagates identity-query failures', async () => {
  for (const response of [{ data: [] }, [null], [['bad']]]) {
    await assert.rejects(basicFallback(BASIC, { securityIdList: [code] }, client({ bondDimInfo: response })), /invalid_qb_response/);
  }
  await assert.rejects(basicFallback(BASIC, { secShortNameList: [name] }, client({ creditBondIssueInfo: new Error('unavailable') })), /unavailable/);
});
