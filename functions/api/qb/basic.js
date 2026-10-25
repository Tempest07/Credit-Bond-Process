// QB schemas checked with getApiDetail on 2026-10-22. This adapter only emits
// documented equivalents; vendor enum codes and amounts with unknown units are
// deliberately not promoted to DM descriptions / amounts.
const BASIC = '/bond/basic-info/info';
const OUTSTANDING = '/bond/basic-info/outstanding-bonds';
const MAX_TARGETS = 20;
const CODE = /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/;
const PRE_ISSUE_CODE = /^S\d{5,12}\.IB$/;

export async function basicFallback(path, input = {}, client) {
  const route = String(path || '').replace(/^\/dm-quant-func-service\/api\/v1/, '');
  if (route !== BASIC && route !== OUTSTANDING) return null;
  // These QB endpoints are current snapshots, not point-in-time history. Do not
  // inject today's coupon / rating into a caller's historical request.
  const cutoff = dateValue(input.asOfDate ?? input.as_of_date ?? input.endDate ?? input.end_date ?? input.date);
  if (cutoff && cutoff < client.today) return [];
  if (route === OUTSTANDING) return outstanding(input, client);

  const codes = targetList(input.securityIdList ?? input.security_id_list, normalizeCode);
  const names = targetList(input.secShortNameList ?? input.sec_short_name_list, normalizeNameInput);
  if ((!codes.length && !names.length) || codes.length + names.length > MAX_TARGETS) return [];
  const byName = new Map();
  if (names.length) {
    await mapLimited(names, async name => {
      const rows = await query(client, 'creditBondIssueInfo', { sec_shrt_nm: name });
      byName.set(nameKey(name), rows.filter(row => nameKey(row.sec_shrt_nm) === nameKey(name)));
    });
  }
  const discovered = [...byName.values()].flat().map(row => normalizeCode(row.ss_sec_code)).filter(Boolean);
  const requestedCodes = [...new Set([...codes, ...discovered])];
  if (requestedCodes.length > MAX_TARGETS) return [];
  const codeSet = new Set(requestedCodes);
  const dimensions = requestedCodes.length ? (await query(client, 'bondDimInfo', {
    ss_sec_code: requestedCodes.join(','), page: 1, pageSize: MAX_TARGETS,
  })).filter(row => codeSet.has(normalizeCode(row.ss_sec_code)) && snapshotAllowed(row, client.today)) : [];

  // Dimension data contains only type / status enum codes. Exact issuance rows
  // provide their documented Chinese descriptions and preserve cancelled issues.
  const metadataOnly = Array.isArray(input.fieldNames) && input.fieldNames.length
    && input.fieldNames.every(field => ['securityId', 'secShortName', 'nextOptionDate', 'bondMatu', 'specialItem'].includes(field));
  const enrichNames = (metadataOnly ? [] : [...new Set(dimensions.map(row => normalizeNameInput(row.sec_shrt_nm)).filter(Boolean))])
    .filter(name => !byName.has(nameKey(name)));
  await mapLimited(enrichNames, async name => {
    // A description-only endpoint failure must not discard a valid current
    // coupon / identity already obtained from bondDimInfo.
    const rows = await query(client, 'creditBondIssueInfo', { sec_shrt_nm: name }).catch(() => []);
    byName.set(nameKey(name), rows.filter(row => nameKey(row.sec_shrt_nm) === nameKey(name)));
  });
  const output = [];
  const dimensionCodes = new Set();
  for (const row of dimensions) {
    const code = normalizeCode(row.ss_sec_code);
    const name = nameKey(row.sec_shrt_nm);
    if (names.length && !codes.includes(code) && !names.some(value => nameKey(value) === name)) continue;
    const matches = (byName.get(name) || []).filter(issue => normalizeCode(issue.ss_sec_code) === code);
    dimensionCodes.add(code);
    // Keep distinct issue rows: conflicting statuses must not be silently lost.
    for (const issue of matches.length ? matches : [null]) output.push(mapBasicRow(row, issue, client));
  }
  // Pre-issue / cancelled bonds can be absent from the dimension table. Retain
  // their exact code + status so existing issue-safety checks can exclude them.
  for (const issues of byName.values()) {
    for (const issue of issues) {
      const code = normalizeCode(issue.ss_sec_code);
      if ((code && codeSet.has(code) && !dimensionCodes.has(code)) || isPreIssueCode(issue.ss_sec_code)) {
        output.push(mapBasicRow(null, issue, client));
      }
    }
  }
  return dedupe(output);
}

async function outstanding(input, client) {
  // QB has no documented unified social-credit-code query. Never mistake that
  // identifier for its institution_code / ins_code.
  const name = normalizeNameInput(input.issuerFullName ?? input.issuer_full_name);
  if (!name || Number(input.offset || 0) > 0) return [];
  const issuers = (await query(client, 'issuerInfo', { issuer_name: name }))
    .filter(row => nameKey(row.issuer_name) === nameKey(name));
  const codes = [...new Set(issuers.map(row => cleanText(row.institution_code)).filter(Boolean))];
  if (codes.length !== 1) return [];
  const rows = await query(client, 'activeBondInfoByIssuer', { ins_code: codes[0] });
  return dedupe(rows.filter(row => cleanText(row.issuer_code) === codes[0]
    && (!cleanText(row.issuer_nm) || nameKey(row.issuer_nm) === nameKey(name))
    && normalizeCode(row.ss_sec_code) && snapshotAllowed(row, client.today))
    .map(row => mapBasicRow(row, null, client, ['issuerInfo', 'activeBondInfoByIssuer'])));
}

function mapBasicRow(dimension, issue, client, apiNames = null) {
  const row = dimension || {};
  const result = {};
  const fieldMap = {};
  const units = {};
  const set = (target, raw, source, transform = cleanText) => {
    if (raw === undefined || raw === null || raw === '') return;
    const value = transform(raw);
    if (value === null || value === '') return;
    result[target] = value;
    fieldMap[target] = source;
  };
  for (const [target, source] of Object.entries({
    securityId: 'ss_sec_code', secShortName: 'sec_shrt_nm', secFullName: 'sec_full_nm', issuerName: 'issuer_nm',
    bondMatu: 'sec_trm', bondMatuUnitPar: 'trm_unit', remainingTenor: 'residual_maturity',
    issuerRating: 'inst_rating_nm_cur', issuerRatingAgency: 'issuer_rating_agcy',
    isCrosMar: 'is_crs_market', province: 'prvn', industry: 'idst_swname1_cur',
    qbIssuerCode: 'issuer_code', qbBondTypeCode: 'bond_typ', qbBondSubtypeCode: 'bond_subtyp',
    qbPaymentOrderCode: 'scn', qbRateTypeCode: 'coupon_rt_typ_code', qbOptionTypeCode: 'opt_typ_code',
    qbCouponFrequencyCode: 'coupon_freq', qbListingStatusCode: 'listing_sts',
  })) set(target, row[source], source);
  if (cleanText(row.trm_strc)) set('bondMatu', row.trm_strc, 'trm_strc');
  for (const [target, source] of Object.entries({
    issStartDate: 'iss_strt_dt', inteStartDate: 'val_dt', listDate: 'listing_dt', matuPayDate: 'maturity_dt',
    nextOptionDate: 'nxt_strike_dt', nextCouponDate: 'nxt_coupon_dt', payDate: 'pay_dt',
  })) set(target, row[source], source, dateValue);
  for (const [target, source] of Object.entries({ newCoupRate: 'coupon_rt_cur', issCoupRate: 'coupon_rt_iss', bondParVal: 'par_val' })) {
    set(target, row[source], source, numberValue);
    if (target in result) units[target] = target === 'bondParVal' ? '元' : '%';
  }
  if (row.is_municipal === 'Y' || row.is_municipal === 'N') {
    set('cityAnnexFlag', row.is_municipal, 'is_municipal', value => value === 'Y' ? 1 : 0);
  }
  const special = [];
  const specialFields = [];
  if (row.is_perpetual_bond === 'Y') { special.push('永续债'); specialFields.push('is_perpetual_bond'); }
  if (row.embeddedopt === 'Y') { special.push('含权债'); specialFields.push('embeddedopt'); }
  if (special.length) set('specialItem', special.join('；'), specialFields.join(','));

  if (issue) {
    for (const [target, source] of Object.entries({
      securityId: 'ss_sec_code', secShortName: 'sec_shrt_nm', secFullName: 'sec_full_nm', issuerName: 'inst_nm',
      bondTypeDesc: 'bond_typ', bondSubtypeDesc: 'bond_subtyp', issueStatusDesc: 'sts',
      issuerRating: 'issuer_rating', bondRating: 'bond_rating', publicOfferingStatus: 'ofr_type',
      undeName: 'bookrunner', bondMatu: 'sec_trm', marketDesc: 'listed_market', qbOptionTypeCode: 'opt_typ_code',
    })) {
      if (target === 'issuerRating' && result.issuerRating) continue;
      // The structure carries renewal / exercise legs (for example 3+N).
      // An issuance row's plain 3Y term must not erase those legs.
      if (target === 'bondMatu' && cleanText(row.trm_strc)) continue;
      // Keep the current dimension's exact option enum, including NON. An
      // issuance-only row may still supply the same documented raw enum.
      if (target === 'qbOptionTypeCode' && result.qbOptionTypeCode) continue;
      set(target, issue[source], source, target === 'securityId' ? normalizeCode : cleanText);
    }
    // QB assigns S-prefixed catalogue identifiers before the formal code exists.
    // Preserve that evidence without presenting it as an issued security code.
    if (isPreIssueCode(issue.ss_sec_code)) set('qbPreIssueCode', issue.ss_sec_code, 'ss_sec_code');
    for (const [target, source] of Object.entries({
      issStartDate: 'iss_strt_dt', issEndDate: 'iss_end_dt', payDate: 'pay_dt',
      listDate: 'listing_dt', matuPayDate: 'maturity_dt',
    })) set(target, issue[source], source, dateValue);
    set('issCoupRate', issue.coupon_rt, 'coupon_rt', numberValue);
    if (result.issCoupRate !== undefined) units.issCoupRate = '%';
    // QB explicitly documents this one as 亿元; DM basic-info issuance scale is
    // 万元. Do not use the dimension table's iss_sz / otstd_amnt: units unknown.
    set('actuIssAmut', issue.tot_actl_iss_amt, 'tot_actl_iss_amt', value => {
      const amount = numberValue(value);
      return amount === null || amount < 0 ? null : amount * 10000;
    });
    if ('actuIssAmut' in result) units.actuIssAmut = '万元（QB 原字段亿元 × 10000）';
  }
  result._qb = {
    apiNames: apiNames || [...(dimension ? ['bondDimInfo'] : []), ...(issue ? ['creditBondIssueInfo'] : [])],
    date: dateValue(row.trade_dt), fetchedAt: client.fetchedAt, fieldMap, units,
  };
  return result;
}

async function query(client, apiName, params) {
  const rows = await client.query(apiName, params);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('invalid_qb_response');
  }
  return rows;
}

async function mapLimited(items, fn) {
  for (let index = 0; index < items.length; index += 4) await Promise.all(items.slice(index, index + 4).map(fn));
}

function targetList(value, normalizer) {
  const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  if (list.length > MAX_TARGETS || list.some(item => !normalizer(item))) return [];
  return [...new Set(list.map(normalizer))];
}

function normalizeCode(value) { const text = cleanText(value).toUpperCase(); return CODE.test(text) ? text : ''; }
function isPreIssueCode(value) { return PRE_ISSUE_CODE.test(cleanText(value).toUpperCase()); }
function normalizeNameInput(value) {
  return typeof value === 'string' && value.trim().length <= 160 && !/[\r\n,，]/u.test(value) ? value.trim() : '';
}
function nameKey(value) { return cleanText(value).normalize('NFKC').replace(/\s+/gu, '').toUpperCase(); }
function cleanText(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''; }
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function snapshotAllowed(row, today) { const date = dateValue(row.trade_dt); return !date || date <= today; }
function dedupe(rows) { return [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]; }

function dateValue(value) {
  let text = cleanText(value);
  if (/^\d{8}$/.test(text)) text = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const stamp = Date.parse(text);
    return Number.isFinite(stamp) ? new Date(stamp + 8 * 3600000).toISOString().slice(0, 10) : '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const stamp = Date.parse(text + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === text ? text : '';
}
