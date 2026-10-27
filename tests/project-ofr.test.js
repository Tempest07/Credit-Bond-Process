import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalOfrCode, formatOfrQuote, ofrYieldFromValuation, projectOfrCandidates, resolveOfrBranch, sameProjectOfrRow } from '../project-ofr.js';

const project = (extra = {}) => ({ id: 'p', resultConfirmed: true, status: '待缴款', branch: '广州分行', venue: '银行间',
  tranches: [{ id: 't', shortName: '26测试SCP001', resultStatus: '中标', winningAmountWan: 3000,
    securityCode: '012690001.IB', marketValuation: 9.9, initialMarketValuation: 1.6, initialMarketValuationAt: '2026-10-27T00:00:00Z' }], ...extra });

test('OFR uses a five basis point yield subtraction with four decimal precision and normal quote syntax', () => {
  assert.equal(ofrYieldFromValuation(1.6), 1.55);
  assert.equal(ofrYieldFromValuation(1.4893), 1.4393);
  for (const value of [undefined, null, '1.6', 0, -.2, .05, Infinity, NaN, 101]) assert.equal(ofrYieldFromValuation(value), null);
  assert.equal(formatOfrQuote({securityCode:'012690001.ib',shortName:'26测试SCP001',ofrYield:1.55}), '012690001.IB，26测试SCP001，1.55*ofr');
  assert.equal(formatOfrQuote({shortName:'26测试SCP001',ofrYield:2}), '26测试SCP001，2*ofr');
});

test('only confirmed positively awarded owned varieties are candidates, never outsourced-only or cancelled ones', () => {
  const base = project(), before = JSON.stringify(base);
  assert.equal(projectOfrCandidates(base)[0].initialMarketValuation, 1.6);
  assert.equal(projectOfrCandidates(base)[0].ofrYield, 1.55, 'editable current valuation is not the price basis');
  assert.deepEqual(projectOfrCandidates({...base,resultConfirmed:false}), []);
  assert.deepEqual(projectOfrCandidates({...base,status:'已结束'}), []);
  for (const extra of [{winningAmountWan:0},{winningAmountWan:null,outsourcedBids:[{winningAmountWan:3000}]},
    {resultStatus:'未中标'},{allocationNote:'本品种全部回拨'},{allocationNote:'取消发行'},{shortName:'26测试MTN001A/B(科创债)'}]) {
    assert.deepEqual(projectOfrCandidates({...base,tranches:[{...base.tranches[0],...extra}]}), [], JSON.stringify(extra));
  }
  assert.equal(JSON.stringify(base), before);
});

test('missing legacy entry snapshots remain explicitly missing and are never invented from editable valuations', () => {
  const base = project(); delete base.tranches[0].initialMarketValuation; delete base.tranches[0].initialMarketValuationAt;
  const candidate = projectOfrCandidates(base)[0];
  assert.equal(candidate.initialMarketValuation, null); assert.equal(candidate.ofrYield, null);
  assert.equal(candidate.needsValuationConfirmation, true);
});

test('branch aliases map uniquely to existing section names and ambiguous province aliases need a choice', () => {
  const titles=['广东（广州）','浙江（杭州）','浙江（宁波）','北京/上海'];
  assert.equal(resolveOfrBranch('兴业银行广州分行',titles),'广东（广州）');
  assert.equal(resolveOfrBranch('上海分行',titles),'北京/上海');
  assert.equal(resolveOfrBranch('浙江分行',titles),''); assert.equal(resolveOfrBranch('厦门分行',titles),'');
  assert.equal(canonicalOfrCode('012690001','银行间'),'012690001.IB');
  assert.equal(canonicalOfrCode('F012690001.IB'),'');
  assert.equal(canonicalOfrCode('525001','深交所'),'525001.SZ');
});

test('row identity tolerates manual repricing and code supplementation, but not another branch, side or code', () => {
  const transfer={branchTitle:'广东（广州）',securityCode:'012690001.IB',shortName:'26测试SCP001'};
  const row={branch:'广东（广州）',code:'012690001.IB',name:'26测试SCP001',quote:'1.99*ofr',direction:'ofr'};
  assert.equal(sameProjectOfrRow(transfer,row),true);
  assert.equal(sameProjectOfrRow({...transfer,securityCode:''},row),true);
  for (const extra of [{branch:'浙江（杭州）'},{direction:'bid'},{code:'012690002.IB'}]) assert.equal(sameProjectOfrRow(transfer,{...row,...extra}),false);
});
