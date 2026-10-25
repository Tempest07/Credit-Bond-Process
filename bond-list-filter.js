export const BOND_TYPES = Object.freeze([
  'SCP', 'CP', 'MTN', 'PPN', '公司债', '企业债', '金融债', 'ABS', '政府债', '其他', '未知'
]);

const codePattern = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/i;
const couponOperators = new Set(['any', 'gt', 'gte', 'lt', 'lte', 'between']);
const sides = new Set(['all', 'ofr', 'bid']);
const missingFields = new Set(['all', 'coupon', 'type', 'side']);

function metadataFor(metadata, code) {
  if (!code || !metadata) return null;
  if (metadata instanceof Map) return metadata.get(code) || null;
  return Object.hasOwn(metadata, code) ? metadata[code] : null;
}

function directionOf(quote) {
  const ofr = /(?:^|[^a-z_])(?:ofr|offer)(?=$|[^a-z_])/i.test(quote);
  const bid = /(?:^|[^a-z_])bid(?=$|[^a-z_])/i.test(quote);
  return ofr && bid ? 'both' : ofr ? 'ofr' : bid ? 'bid' : 'unknown';
}

function typeOf(value) {
  const type = typeof value === 'string' ? value.trim() : '';
  if (!type) return '未知';
  const normalized = /^[a-z]+$/i.test(type) ? type.toUpperCase() : type;
  return BOND_TYPES.includes(normalized) ? normalized : '其他';
}

export function quoteRows(sections, metadata = {}, zeroConfirmed = () => false) {
  const rows = [];
  for (const [sectionIndex, section] of (sections || []).entries()) {
    let blankBefore = [];
    for (const [lineIndex, raw] of String(section.text || '').split(/\r?\n/).entries()) {
      if (!raw.trim()) {
        blankBefore.push(raw);
        continue;
      }
      const fields = raw.split(/[，,]/);
      const first = fields[0].trim();
      const coded = codePattern.test(first);
      const code = coded ? first.toUpperCase() : '';
      const name = coded ? fields[1]?.trim() || first : first;
      const quote = fields.slice(coded ? 2 : 1).join(',').trim();
      const result = metadataFor(metadata, code);
      const couponNeedsConfirmation = result?.couponRate === 0 && !zeroConfirmed(code, result);
      const couponRate = typeof result?.couponRate === 'number' && Number.isFinite(result.couponRate)
        && result.couponRate >= 0 && !couponNeedsConfirmation ? result.couponRate : null;
      rows.push({
        sectionIndex, lineIndex, branch: section.title || '', raw, blankBefore, code, name, quote,
        direction: directionOf(quote), couponRate, couponNeedsConfirmation, bondType: typeOf(result?.bondType),
        attributes: Array.isArray(result?.attributes) ? result.attributes.filter(value => typeof value === 'string') : [],
        metadataStatus: result?.status || (coded ? 'pending' : 'uncoded')
      });
      blankBefore = [];
    }
  }
  return rows;
}

function threshold(value, label) {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!text) return { error: '请输入' + label + '（%）。' };
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    || !Number.isFinite(Number(text)) || Number(text) < 0) {
    return { error: label + '须为大于或等于 0 的有效数值（%）。' };
  }
  return { value: Number(text) };
}

export function filterQuotes(rows, filters = {}) {
  const { types = [], side = 'all', couponOp = 'any', couponMin = '', couponMax = '', missing = 'all' } = filters || {};
  const selectedTypes = Array.isArray(types) ? types : [];
  const active = selectedTypes.length > 0 || side !== 'all' || couponOp !== 'any' || missing !== 'all';
  const invalid = error => ({ rows: [], active, error });
  if (!couponOperators.has(couponOp)) return invalid('请选择有效的票面利率条件。');
  if (!sides.has(side)) return invalid('请选择有效的报价方向。');
  if (!missingFields.has(missing)) return invalid('请选择有效的缺失信息条件。');
  let min, max;
  if (couponOp !== 'any') {
    const lower = threshold(couponMin, couponOp === 'between' ? '票面利率下限' : '票面利率阈值');
    if (lower.error) return invalid(lower.error);
    min = lower.value;
    if (couponOp === 'between') {
      const upper = threshold(couponMax, '票面利率上限');
      if (upper.error) return invalid(upper.error);
      max = upper.value;
      if (min > max) return invalid('票面利率下限不能大于上限。');
    }
  }
  const filtered = (rows || []).filter(row => {
    if (selectedTypes.length && !selectedTypes.includes(row.bondType)) return false;
    if (side !== 'all' && row.direction !== side && row.direction !== 'both') return false;
    const coupon = row.couponRate;
    const hasCoupon = typeof coupon === 'number' && Number.isFinite(coupon) && coupon >= 0;
    if (missing === 'coupon' && hasCoupon) return false;
    if (missing === 'type' && row.bondType !== '未知') return false;
    if (missing === 'side' && row.direction !== 'unknown') return false;
    if (couponOp !== 'any') {
      if (!hasCoupon) return false;
      if (couponOp === 'gt' && !(coupon > min)) return false;
      if (couponOp === 'gte' && !(coupon >= min)) return false;
      if (couponOp === 'lt' && !(coupon < min)) return false;
      if (couponOp === 'lte' && !(coupon <= min)) return false;
      if (couponOp === 'between' && !(coupon >= min && coupon <= max)) return false;
    }
    return true;
  });
  return { rows: filtered, active, error: '' };
}

export function quoteOutput(rows) {
  const groups = new Map();
  const ordered = [...(rows || [])].sort((a, b) => a.sectionIndex - b.sectionIndex || a.lineIndex - b.lineIndex);
  for (const row of ordered) {
    if (!groups.has(row.sectionIndex)) groups.set(row.sectionIndex, { branch: row.branch, lines: [] });
    groups.get(row.sectionIndex).lines.push(...(row.blankBefore || []), row.raw);
  }
  return 'OFR/BID' + [...groups.values()].map(group => '\n\n' + group.branch + '\n' + group.lines.join('\n').trim()).join('');
}
