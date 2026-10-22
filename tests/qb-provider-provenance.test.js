import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldProvider, rowProvenance } from '../functions/api/qb/provenance.js';
import { dataProviderLabel, marketDataProvenance } from '../market-data-source.js';
import { matchCouponRows } from '../functions/api/bond-list/coupons.js';
import { matchValuationRows } from '../functions/api/bond-list/valuations.js';
import { matchPaymentTodoCodeRows } from '../functions/api/payment-todo/codes.js';
import { __test__ as trades } from '../functions/api/dm/trade-records.js';
import { __test__ as lookup } from '../functions/api/dm/lookup.js';
import { normalizeSecondaryTrades } from '../secondary-inventory.js';
import { buildTradeRecordRows, applyTradeRecordRowsToState } from '../trade-record-ledger.js';

const code = '102600001.IB';
const date = '2026-10-22';
const info = { apiNames: ['cdcBondValuation'], date, fetchedAt: '2026-10-22T01:00:00Z', fieldMap: { cbYtm: 'val_yield' } };

test('field provenance distinguishes QB supplements from retained DM fields without changing legacy rows', () => {
  assert.deepEqual(rowProvenance({ securityId: code }), {});
  const row = { _provider: 'DM+QB', _qb: info, _fieldSources: { cbYtm: 'QB', secShortName: 'DM' } };
  assert.equal(fieldProvider(row, ['cbYtm', 'cb_ytm']), 'QB');
  assert.equal(fieldProvider(row, ['secShortName']), 'DM');
  assert.equal(fieldProvider(row, ['cbYtm', 'secShortName']), 'DM+QB');
  assert.deepEqual(rowProvenance(row, ['secShortName']), {});
  assert.equal(rowProvenance(row, ['cbYtm']).providerInfo.date, date);
  assert.equal(dataProviderLabel({ dataSources: { used: ['DM', 'QB'] } }), 'DM+QB');
  assert.equal(dataProviderLabel('manual', ''), '');
  assert.deepEqual(marketDataProvenance({ provider: 'QB', providerInfo: info }).providerInfo.apiNames, ['cdcBondValuation']);
});

test('coupon and code matchers retain the exact QB identity and rate provider', () => {
  const row = { securityId: code, secShortName: '26测试MTN001', newCoupRate: 1.55, bondTypeDesc: '中期票据', _provider: 'QB', _qb: info };
  const coupon = matchCouponRows([code], [row])[code];
  assert.equal(coupon.couponRate, 1.55);
  assert.equal(coupon.provider, 'QB');
  assert.equal(coupon.fieldSources.couponRate, 'QB');
  const matched = matchPaymentTodoCodeRows(['26测试MTN001'], [row])['26测试MTN001'];
  assert.equal(matched.status, 'matched');
  assert.equal(matched.matches[0].provider, 'QB');
  assert.equal(matched.matches[0].code, code);
});

test('valuation provider follows the selected institution field and data date', () => {
  const row = { securityId: code, issueDate: date, cbYtm: 1.51, cbNptm: 100.1, csYtm: 1.6,
    _provider: 'DM+QB', _qb: info, _fieldSources: { cbYtm: 'QB', cbNptm: 'QB', csYtm: 'DM' } };
  const valuation = matchValuationRows([code], [], [row], date)[code];
  assert.equal(valuation.institution, '中债');
  assert.equal(valuation.provider, 'QB');
  assert.equal(valuation.providerInfo.date, date);
  assert.equal(valuation.date, date);
  assert.equal(valuation.yield, 1.51);
});

test('trade result records per-field DM/QB sources and saved ledger round trips keep QB attribution', () => {
  const result = trades.buildResult({ id: 'one', securityId: code, requestedDate: date },
    { securityId: code, secShortName: '26测试MTN001', bondTypeDesc: '中期票据' },
    [{ securityId: code, issueDate: date, cbYtm: 1.51, _provider: 'QB', _qb: info }]);
  assert.equal(result.provider, 'DM+QB');
  assert.deepEqual(result.fieldSources, { shortName: 'DM', bondType: 'DM', valuationYield: 'QB' });
  const state = { secondaryTrades: normalizeSecondaryTrades([{ id: 'one', code, shortName: '26测试MTN001', tradeDate: date,
    frontOfficeDone: true, tradeRecord: { 债券代码: code, 谈判日: date, 交易日: date, 估值收益率: '1.51' },
    tradeRecordSources: { 估值收益率: 'qb' }, tradeRecordDm: { status: 'complete', valuationDate: date, provider: 'DM+QB', providerInfo: info } }]) };
  const rows = buildTradeRecordRows(state, date);
  assert.equal(rows[0].fieldSources['估值收益率'], 'qb');
  assert.equal(rows[0].dmLookup.providerInfo.apiNames[0], 'cdcBondValuation');
  rows[0].dirty = true;
  const saved = applyTradeRecordRowsToState(state, rows).secondaryTrades[0];
  assert.equal(saved.tradeRecordSources['估值收益率'], 'qb');
  assert.equal(saved.tradeRecordDm.provider, 'DM+QB');
  assert.equal(saved.tradeRecordDm.valuationDate, date);
});

test('lookup traces QB basic fields while keeping a retained DM rating attributed to DM', () => {
  const row = { securityId: code, secShortName: '26测试MTN001', issuerName: '测试有限公司', bondMatu: '3Y',
    subjectRating: 'AAA', ratingAgency: '中诚信国际', impliedRating: 'AA+',
    _provider: 'DM+QB', _qb: info, _fieldSources: {
      securityId: 'DM', secShortName: 'QB', issuerName: 'QB', bondMatu: 'QB',
      subjectRating: 'DM', ratingAgency: 'DM', impliedRating: 'QB',
    } };
  const normalized = lookup.normalizeDmLookup({ shortName: '', securityId: code, fullName: '', basic: { rows: [row] }, primary: { rows: [] }, company: null });
  assert.equal(normalized.fieldSource.shortName, 'QB');
  assert.equal(normalized.fieldSource.issuerName, 'QB');
  assert.equal(normalized.fieldSource.durationText, 'QB');
  assert.equal(normalized.fieldSource.subjectRating, undefined);
  assert.equal(normalized.ratingSource.subjectRating, undefined);
  assert.equal(normalized.ratingSource.impliedRating, 'qb-discovery');
});

test('a QB dedicated rating supplements missing fields but cannot override an existing DM rating or its date', () => {
  const row = { rating: 'AA+', _provider: 'QB', _qb: info };
  const match = lookup.dedicatedRatingMatch('companyRating', '/company/rating/data', 'rating', 'AA+', date, row);
  const discovery = { values: { subjectRating: 'AA+', subjectRatingAsOf: date }, matches: { subjectRating: match }, authoritativeFields: ['subjectRating', 'subjectRatingAsOf'] };
  const retained = lookup.applyDmRatingDiscovery({ subjectRating: 'AAA', subjectRatingAsOf: '2026-09-01' }, discovery);
  assert.equal(retained.subjectRating, 'AAA');
  assert.equal(retained.subjectRatingAsOf, '2026-09-01');
  const filled = lookup.applyDmRatingDiscovery({ subjectRating: '' }, discovery);
  assert.equal(filled.subjectRating, 'AA+');
  assert.equal(filled.subjectRatingAsOf, date);
  assert.equal(filled.ratingSource.subjectRating, 'qb-rating-api');
  assert.equal(filled.fieldSource.subjectRating, 'QB');
  assert.equal(filled.ratingProviderInfo.subjectRating.date, date);
  const restored = lookup.applyDmRatingDiscovery(filled, { values: { subjectRating: 'AAA' }, matches: { subjectRating: lookup.dedicatedRatingMatch('companyRating', '/company/rating/data', 'rating', 'AAA', date) }, authoritativeFields: ['subjectRating'] });
  assert.equal(restored.subjectRating, 'AAA');
  assert.equal(restored.ratingSource.subjectRating, 'dm-rating-api');
  assert.equal(restored.fieldSource.subjectRating, 'DM');
  const sameRating = lookup.applyDmRatingDiscovery({ subjectRating: 'AA+', ratingAgency: '' }, {
    values: { subjectRating: 'AA+', ratingAgency: '中诚信国际' },
    matches: { subjectRating: match, ratingAgency: { ...match, path: 'rating_institution_short_name' } },
    authoritativeFields: ['subjectRating', 'ratingAgency'],
  });
  assert.equal(sameRating.subjectRating, 'AA+');
  assert.equal(sameRating.ratingSource.subjectRating, undefined);
  assert.equal(sameRating.ratingAgency, '中诚信国际');
  assert.equal(sameRating.ratingSource.ratingAgency, 'qb-rating-api');
});

test('rating diagnostics identify QB fills and preserve the original DM-only shape and note', () => {
  const dm = { subjectRating: 'AAA', ratingAgency: '中诚信国际', impliedRating: 'AA+', ratingSource: { impliedRating: 'dm-rating-api' } };
  const legacy = lookup.ratingDiagnostic(dm, {}, {}, null, dm, false, false);
  assert.equal('filledFromQb' in legacy, false);
  assert.deepEqual(legacy.filledFromDm, ['subjectRating', 'ratingAgency', 'impliedRating']);
  assert.match(legacy.note, /^DM V2\.5 专用评级接口/);
  const mixed = { ...dm, subjectRating: 'AA+', ratingSource: { ...dm.ratingSource, subjectRating: 'qb-rating-api' }, fieldSource: { subjectRating: 'QB' } };
  const diagnostic = lookup.ratingDiagnostic(mixed, {}, {}, null, mixed, false, false);
  assert.deepEqual(diagnostic.filledFromQb, ['subjectRating']);
  assert.deepEqual(diagnostic.filledFromDm, ['ratingAgency', 'impliedRating']);
  assert.match(diagnostic.note, /主体评级已由 QB 补齐/);
  assert.match(diagnostic.note, /已有 DM 数据保持优先/);
  assert.doesNotMatch(diagnostic.note, /未发现|did not find/);
});
