import test from 'node:test';
import assert from 'node:assert/strict';
import { compareQuoteToValuation } from '../bond-list-comparison.js';

const valuation = Object.freeze({ status: 'matched', yield: 1.60, netPrice: 100.25, date: '2026-10-21', basis: '中债' });
const compare = (quote, values = valuation, couponRate = 1.60) => compareQuoteToValuation({ quote, couponRate }, values);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);

test('coupon closeness uses a signed bp gap and includes both 5 bp boundaries', () => {
  for (const couponRate of [1.55, 1.60, 1.65]) {
    const result = compare('1.5*ofr', valuation, couponRate);
    assert.equal(result.couponNear, true);
    closeTo(result.couponGapBp, (couponRate - 1.6) * 100);
  }
  assert.equal(compare('1.5*ofr', valuation, 1.5499).couponNear, false);
  assert.equal(compare('1.5*ofr', valuation, 1.6501).couponNear, false);
  assert.equal(compareQuoteToValuation({ quote: '', couponRate: 1.61 }, valuation, 1).couponNear, true);
  assert.equal(compareQuoteToValuation({ quote: '', couponRate: 1.611 }, valuation, 1).couponNear, false);
});

test('zero coupon and yield are actual numbers rather than missing data', () => {
  const result = compare('0.01bid', { status: 'matched', yield: 0, netPrice: null }, 0);
  assert.equal(result.couponNear, true);
  assert.equal(result.couponGapBp, 0);
  assert.deepEqual(result.warning, { kind: 'yield', gap: 0.01 });
});

test('only quote yield above valuation warns, for either explicit quote direction', () => {
  for (const quote of ['1.70*ofr', '1.7bid', '收益率1.7% ofr', 'ofr 1.7', 'BID 收益率 1.7％', '1.7*OFFER']) {
    const result = compare(quote);
    assert.equal(result.warning?.kind, 'yield');
    closeTo(result.warning.gap, 0.1);
    assert.equal(result.parsedQuote.kind, 'yield');
    assert.equal(result.parsedQuote.value, 1.7);
  }
  for (const quote of ['1.50*ofr', '1.60*ofr', '1.5bid', '1.6bid']) {
    assert.equal(compare(quote).warning, null);
  }
});

test('explicit net price never becomes a yield and reverses the comparison direction', () => {
  const result = compare('净价100*ofr');
  assert.deepEqual(result.parsedQuote, { kind: 'netPrice', value: 100, direction: 'ofr' });
  assert.deepEqual(result.warning, { kind: 'netPrice', gap: -0.25 });
  assert.deepEqual(compare('bid 净价100').warning, { kind: 'netPrice', gap: -0.25 });
  assert.equal(compare('净价100.25bid').warning, null);
  assert.equal(compare('净价101ofr').warning, null);
  assert.equal(compare('净价100ofr', { status: 'matched', yield: 1.60, netPrice: null }).warning, null);
});

test('large bare values cannot turn price shorthand into a yield warning', () => {
  for (const quote of ['100ofr', '100*ofr', 'ofr 100', '99.5bid 5000万', '30ofr', '-30bid']) {
    const result = compare(quote);
    assert.equal(result.parsedQuote, null, quote);
    assert.equal(result.warning, null, quote);
  }
  for (const quote of ['收益率30ofr', '30%ofr', 'ofr 收益率 100', 'bid 100％']) {
    assert.equal(compare(quote).parsedQuote?.kind, 'yield', quote);
    assert.equal(compare(quote).warning?.kind, 'yield', quote);
  }
  assert.equal(compare('29.99ofr').parsedQuote?.kind, 'yield');
  assert.equal(compare('净价100ofr').parsedQuote?.kind, 'netPrice');
});

test('one appended quantity does not change the parsed quote or comparison', () => {
  for (const quote of ['1.7*ofr 5000万', '1.7*ofr 5000', 'ofr 1.7 5000万元', '1.7ofr 0.5亿', '1.7ofr*5000', '1.7ofr 100张']) {
    const result = compare(quote);
    assert.deepEqual(result.parsedQuote, { kind: 'yield', value: 1.7, direction: 'ofr' }, quote);
    closeTo(result.warning.gap, 0.1);
  }
  assert.deepEqual(compare('净价100*ofr 5000万').parsedQuote, { kind: 'netPrice', value: 100, direction: 'ofr' });
});

test('ambiguous, relative, multiple-price and full-price quotes remain unparsed', () => {
  for (const quote of [
    '1.5-1.7ofr', '1.5~1.7ofr', '1.5/1.7ofr', '1.7ofr/1.5bid', 'ofr/bid 1.7',
    '1.7*ofr 1.8', '1.7ofr 5000 1.8bid', '1.7ofr 5000 3000', '1.7ofr 5000万/3000万',
    '全价100*ofr', 'ofr全价100', '估值+2*ofr', '估值-2bid', 'ofr估值+2bp',
    '1.7', '净价100', 'bidding 1.7', 'reoffer 1.7', '1.7offers', '1.7ofr备注',
    '净价100%ofr', '净价0ofr', '净价-1ofr', 'NaNofr', 'Infinitybid', '1e3ofr', '', null, 1.7
  ]) {
    const result = compare(quote);
    assert.equal(result.parsedQuote, null, String(quote));
    assert.equal(result.warning, null, String(quote));
  }
});

test('unmatched valuation never compares stale payload values', () => {
  for (const status of ['missing', 'pending', 'error', 'ambiguous', undefined]) {
    const result = compare('1.7ofr', { ...valuation, status });
    assert.equal(result.couponNear, false);
    assert.equal(result.couponGapBp, null);
    assert.equal(result.warning, null);
    assert.equal(result.parsedQuote?.value, 1.7);
  }
  assert.equal(compare('1.7ofr', null).warning, null);
});

test('null, numeric strings and nonfinite metadata do not become valid values', () => {
  for (const missing of [null, undefined, NaN, Infinity, -Infinity, '', '1.60', false]) {
    assert.equal(compare('1.7ofr', { ...valuation, yield: missing }).warning, null);
    assert.equal(compare('1.7ofr', { ...valuation, yield: missing }).couponGapBp, null);
    assert.equal(compareQuoteToValuation({ quote: '1.7ofr', couponRate: missing }, valuation).couponGapBp, null);
    assert.equal(compare('净价100ofr', { ...valuation, netPrice: missing }).warning, null);
  }
  assert.equal(compare('1.7ofr', valuation, -1).couponGapBp, null);
  assert.equal(compare('净价100ofr', { ...valuation, netPrice: 0 }).warning, null);
  assert.equal(compareQuoteToValuation(null, valuation).parsedQuote, null);
});

test('floating-point noise at equal prices cannot create a warning', () => {
  assert.equal(compare('1.6ofr', { ...valuation, yield: 1.6000000000000003 }).warning, null);
  assert.equal(compare('1.6bid', { ...valuation, yield: 1.5999999999999999 }).warning, null);
  assert.equal(compare('净价100.25ofr', { ...valuation, netPrice: 100.25000000000001 }).warning, null);
  assert.equal(compare('1.600001ofr').warning?.kind, 'yield');
});

test('custom closeness threshold cannot coerce an invalid value into a match', () => {
  for (const closeBp of [NaN, Infinity, -1, '5', null]) {
    const result = compareQuoteToValuation({ couponRate: 1.60 }, valuation, closeBp);
    assert.equal(result.couponNear, false);
    assert.equal(result.couponGapBp, 0);
  }
});

test('comparison preserves caller quote, metadata, basis and dates', () => {
  const row = Object.freeze({ quote: '  净价100*ofr 5000万  ', couponRate: 1.61 });
  const before = JSON.stringify({ row, valuation });
  compareQuoteToValuation(row, valuation);
  assert.equal(JSON.stringify({ row, valuation }), before);
});
