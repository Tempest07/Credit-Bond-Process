import { BOND_TYPES } from './bond-list-filter.js?v=20261026release5362';

const textPresent = value => typeof value === 'string' && Boolean(value.trim())
  && !/^(?:未知|不详|暂无|未分类|N\/?A|NULL|NONE|[-—]+)$/i.test(value.trim());
const fields = {
  couponRate: value => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  name: textPresent,
  rateType: textPresent,
  bondType: value => value !== '未知' && BOND_TYPES.includes(value),
};

export function couponMetadataUsable(result) {
  return result?.status === 'matched' || result?.status === 'missing' && result.reason === 'coupon_unavailable';
}

/** A usable coupon is retained even while the other basic fields need another lookup. */
export function couponMetadataComplete(result, zeroConfirmed = false) {
  return result?.status === 'matched' && Object.entries(fields).every(([key, valid]) => valid(result[key]))
    && (result.couponRate !== 0 || zeroConfirmed);
}

/** Supplement only missing fields; each retained value keeps its actual source/time. */
export function supplementCouponMetadata(previous, incoming) {
  if (!couponMetadataUsable(previous) || !couponMetadataUsable(incoming)) return incoming;
  const result = { ...previous };
  const added = Object.keys(fields).filter(key => !fields[key](previous[key]) && fields[key](incoming[key]));
  // Zero is an unconfirmed candidate, so a later positive supplier coupon can resolve it.
  if (previous.couponRate === 0 && fields.couponRate(incoming.couponRate) && incoming.couponRate > 0) added.push('couponRate');
  const takeClassification = added.includes('bondType');
  if (takeClassification) {
    result.attributes = previous.attributes?.length ? previous.attributes : incoming.attributes || [];
    result.typeDescription = textPresent(previous.typeDescription) ? previous.typeDescription : incoming.typeDescription || '';
  } else if (previous.bondType === incoming.bondType && !textPresent(previous.typeDescription)
    && textPresent(incoming.typeDescription)) {
    added.push('typeDescription');
  }
  if (!added.length) return previous;
  const source = (value, key) => value.fieldSources?.[key] || value.provider;
  const fetchedAt = (value, key) => value.fieldFetchedAt?.[key] || value.fetchedAt;
  result.fieldSources = { ...previous.fieldSources };
  result.fieldFetchedAt = { ...previous.fieldFetchedAt };
  for (const key of Object.keys(fields)) {
    const value = added.includes(key) ? incoming : previous;
    if (!fields[key](value[key])) continue;
    result[key] = value[key];
    if (source(value, key)) result.fieldSources[key] = source(value, key);
    if (fetchedAt(value, key)) result.fieldFetchedAt[key] = fetchedAt(value, key);
  }
  if (added.includes('typeDescription')) result.typeDescription = incoming.typeDescription;
  if (takeClassification || added.includes('typeDescription')) {
    for (const key of takeClassification ? ['typeDescription', 'attributes'] : ['typeDescription']) {
      const retained = key === 'attributes' ? previous.attributes?.length : textPresent(previous.typeDescription);
      const value = retained ? previous : incoming;
      if (source(value, key)) result.fieldSources[key] = source(value, key);
      if (fetchedAt(value, key)) result.fieldFetchedAt[key] = fetchedAt(value, key);
    }
  }
  const providers = new Set(Object.values(result.fieldSources));
  result.provider = providers.has('DM+QB') || providers.has('DM') && providers.has('QB') ? 'DM+QB'
    : providers.has('QB') ? 'QB' : previous.provider || incoming.provider;
  result.sourcePaths = [...new Set([previous, incoming].flatMap(value => value.sourcePaths || value.sourcePath || []))];
  result.sourcePath = result.sourcePaths.join(', ');
  result.fetchedAt = incoming.fetchedAt || previous.fetchedAt;
  result.status = fields.couponRate(result.couponRate) ? 'matched' : incoming.status;
  if (result.status === 'matched') delete result.reason;
  else result.reason = 'coupon_unavailable';
  return result;
}
