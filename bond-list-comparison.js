const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const DIRECTION = '(ofr|offer|bid)';
// A second decimal without a quantity unit could be another quote, so do not infer it.
const QUANTITY = '(?:\\d+(?:\\.\\d+)?\\s*(?:万元?|亿元?|张|手)|\\d+)';
const TRAILING_QUANTITY = '(?:\\s+|\\s*\\*\\s*)' + QUANTITY;
const numberFirst = new RegExp('^(净价\\s*|收益率\\s*)?(' + NUMBER + ')\\s*(%)?\\s*\\*?\\s*'
  + DIRECTION + '(?:' + TRAILING_QUANTITY + ')?$', 'i');
const directionFirst = new RegExp('^' + DIRECTION + '\\s*\\*?\\s*(净价\\s*|收益率\\s*)?('
  + NUMBER + ')\\s*(%)?(?:' + TRAILING_QUANTITY + ')?$', 'i');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function tolerance(...values) {
  return Number.EPSILON * Math.max(1, ...values.map(Math.abs)) * 8;
}

function difference(value, reference) {
  const gap = value - reference;
  return Math.abs(gap) <= tolerance(value, reference) ? 0 : gap;
}

function parseQuote(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replaceAll('％', '%').replaceAll('＊', '*');
  const suffix = numberFirst.exec(text);
  const prefix = suffix ? null : directionFirst.exec(text);
  if (!suffix && !prefix) return null;
  const label = (suffix ? suffix[1] : prefix[2])?.trim() || '';
  const number = Number(suffix ? suffix[2] : prefix[3]);
  const percent = suffix ? suffix[3] : prefix[4];
  const side = (suffix ? suffix[4] : prefix[1]).toLowerCase();
  if (!Number.isFinite(number)) return null;
  const kind = label === '净价' ? 'netPrice' : 'yield';
  if (kind === 'netPrice' && (percent || number <= 0)) return null;
  // Large unlabelled numbers may be price shorthand, not percentage yields.
  if (kind === 'yield' && label !== '收益率' && !percent && Math.abs(number) >= 30) return null;
  return { kind, value: number, direction: side === 'offer' ? 'ofr' : side };
}

/**
 * Rates are percentages (1.60 means 1.60%), couponGapBp is in bp.
 * Warning gap retains its quote unit: percentage points for yield, yuan for net price.
 * Only a matched valuation is eligible; missing values are never coerced to zero.
 */
export function compareQuoteToValuation(quoteRow, valuation, closeBp = 5) {
  const parsedQuote = parseQuote(quoteRow?.quote);
  const result = { couponNear: false, couponGapBp: null, parsedQuote, warning: null };
  if (valuation?.status !== 'matched') return result;

  const referenceYield = valuation.yield;
  const coupon = quoteRow?.couponRate;
  if (isFiniteNumber(coupon) && coupon >= 0 && isFiniteNumber(referenceYield)) {
    result.couponGapBp = difference(coupon, referenceYield) * 100;
    result.couponNear = isFiniteNumber(closeBp) && closeBp >= 0
      && Math.abs(result.couponGapBp) <= closeBp + tolerance(coupon * 100, referenceYield * 100, closeBp);
  }

  if (!parsedQuote) return result;
  if (parsedQuote.kind === 'yield' && isFiniteNumber(referenceYield)) {
    const gap = difference(parsedQuote.value, referenceYield);
    if (gap > 0) result.warning = { kind: 'yield', gap };
  } else if (parsedQuote.kind === 'netPrice'
    && isFiniteNumber(valuation.netPrice) && valuation.netPrice > 0) {
    const gap = difference(parsedQuote.value, valuation.netPrice);
    if (gap < 0) result.warning = { kind: 'netPrice', gap };
  }
  return result;
}
