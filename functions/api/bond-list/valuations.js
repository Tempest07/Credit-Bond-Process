import { requireUser, json } from '../_auth.js';
import { makeDmClient, validateDmConfig, rowsFromDm, pickFirstDateString } from '../dm/lookup.js';
import { checkWriteRequest, readBody } from './_shared.js';
import { normalizeCouponCode } from './coupons.js';
import { withDataSources } from '../qb/fallback.js';
import { qbRateLimitResponse } from '../qb/errors.js';
import { rowProvenance } from '../qb/provenance.js';
import { resolveDataSourceMode } from '../_data-source.js';
import { BondMetadataCacheError, queryCloudBondMetadata } from './_cloud-metadata-cache.js';

const BASIC_INFO_PATH = '/dm-quant-func-service/api/v1/bond/basic-info/info';
const MARKET_DATA_PATH = '/dm-quant-func-service/api/v1/bond/market-data/date';
const DATA_SOURCES = [1, 3, 4, 7];
const LOOKBACK_DAYS = 7;
const BASIC_FIELDS = ['securityId', 'nextOptionDate', 'bondMatu', 'specialItem'];
const VALUATION_FIELDS = [
  'securityId', 'issueDate', 'dataSource',
  'cbReliability', 'cbYtm', 'cbYte', 'cbNptm', 'cbNpte',
  'csReliability', 'csYtm', 'csYte', 'csNptm', 'csNpte',
];

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const rejected = checkWriteRequest(context.request);
  if (rejected) return rejected;
  let codes;
  try {
    const body = await readBody(context.request, 10000);
    if (!Array.isArray(body?.codes) || !body.codes.length || body.codes.length > 20) throw new Error('codes');
    codes = body.codes.map(normalizeCouponCode);
    if (codes.some(code => !code)) throw new Error('codes');
    codes = [...new Set(codes)];
  } catch {
    return json({ error: '每次最多查询 20 个含市场后缀的有效债券代码。' }, 400);
  }
  const requestedDate = chinaToday();
  try {
    const { terminalError, ...payload } = await queryCloudBondMetadata(context.env.DB, {
      codes, kind: 'valuations', mode: resolveDataSourceMode(context.env, context.request),
      lookup: async requested => {
        if (validateDmConfig(context.env, context.request)) throw Object.assign(new Error('Metadata source unavailable'), { status: 503 });
        const dm = context.data?.dmClient || makeDmClient(context.env, context.request);
        const startDate = offsetDate(requestedDate, -LOOKBACK_DAYS);
        const signal = AbortSignal.timeout(20000), batches = [];
        for (let start = 0; start < requested.length; start += 5) batches.push(requested.slice(start, start + 5));
        try {
          const [basic, ...market] = await Promise.all([
            dm.post(BASIC_INFO_PATH, { securityIdList: requested, fieldNames: BASIC_FIELDS }, { signal }),
            ...batches.map(securityIdList => dm.post(MARKET_DATA_PATH, {
              securityIdList, dataSourceList: DATA_SOURCES, startDate, endDate: requestedDate, fieldNames: VALUATION_FIELDS,
            }, { signal })),
          ]);
          signal.throwIfAborted();
          return withDataSources({ source: 'DM', sourcePath: MARKET_DATA_PATH, fetchedAt: new Date().toISOString(), requestedDate,
            results: matchValuationRows(requested, checkedRows(basic), market.flatMap(checkedRows), requestedDate),
          }, dm);
        } catch (error) {
          if (/\bGW-000-4006\b/.test(String(error?.message || ''))) throw Object.assign(new Error('Valuation access denied'), { status: 503, code: 'dm_valuation_access_denied' });
          throw error;
        }
      },
    });
    if (terminalError) throw Object.assign(new Error('Valuation query unavailable'), terminalError);
    return json({ ...payload, requestedDate });
  } catch (error) {
    if (error instanceof BondMetadataCacheError) return json({ code: 'bond_metadata_cache_unavailable', error: '债券资料云端缓存暂时不可用，请稍后重试。' }, 503);
    const limited = qbRateLimitResponse(error);
    if (limited) return limited;
    if (error.code === 'dm_valuation_access_denied') {
      return json({ code: 'dm_valuation_access_denied', error: 'DM 当前估值请求被拒绝（GW-000-4006），请核对该应用的接口授权或调用配置。' }, 503);
    }
    if (Number(error.status) === 503) return json({ code: 'bond_metadata_source_unavailable', error: '债券资料数据源暂未配置，请检查工作区数据源后重试。' }, 503);
    return json({ error: '估值查询暂时失败或超时，请稍后重试。' }, 502);
  }
}

function checkedRows(raw) {
  const rows = rowsFromDm(raw);
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('invalid_dm_response');
  return rows;
}

function rowCode(row) {
  const codes = [row.securityId, row.security_id].filter(value => value !== null && value !== undefined).map(normalizeCouponCode);
  return codes.length && codes.every(Boolean) && new Set(codes).size === 1 ? codes[0] : '';
}

function numericField(row, camel, snake) {
  const raw = [row[camel], row[snake]].filter(value => value !== null && value !== undefined);
  const values = raw.map(value => typeof value === 'number' ? value
    : typeof value === 'string' && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(value) ? Number(value) : NaN);
  return values.length && values.every(Number.isFinite) && new Set(values).size === 1 ? values[0] : null;
}

function dateField(row, camel, snake) {
  const keys = [camel, snake].filter(key => row[key] !== null && row[key] !== undefined && row[key] !== '');
  const dates = keys.map(key => pickFirstDateString(row, [key]));
  return dates.length && dates.every(isIsoDate) && new Set(dates).size === 1 ? dates[0] : '';
}

function marketDate(row) {
  return row.valuationDate !== undefined || row.valuation_date !== undefined
    ? dateField(row, 'valuationDate', 'valuation_date') : dateField(row, 'issueDate', 'issue_date');
}

function basicPrefersExercise(row, requestedDate) {
  const nextOptionDate = dateField(row, 'nextOptionDate', 'next_option_date');
  if (nextOptionDate && nextOptionDate >= requestedDate) return true;
  const text = [row.bondMatu, row.bond_matu, row.specialItem, row.special_item].filter(value => typeof value === 'string').join(' ');
  return /\d+(?:\.\d+)?\s*[Y年]?\s*\+\s*(?:\d|N)|永续|可续期|发行人续期选择权|回售|赎回|调整票面利率|投资者选择权|发行人选择权/i.test(text);
}

function reliabilityRank(text) {
  if (/不推荐|not[\s_-]*recommended/i.test(text)) return 0;
  if (/推荐|recommended/i.test(text)) return 3;
  return /辅助|参考/i.test(text) ? 2 : text ? 1 : 0;
}

export function matchValuationRows(codes, basicRows, marketRows, requestedDate) {
  const results = Object.create(null);
  const earliestDate = offsetDate(requestedDate, -LOOKBACK_DAYS);
  for (const code of codes) {
    const interbank = code.endsWith('.IB');
    const prefix = interbank ? 'cb' : 'cs';
    const preferExercise = basicRows.filter(row => rowCode(row) === code).some(row => basicPrefersExercise(row, requestedDate));
    const preferredBasis = preferExercise ? '行权' : '到期';
    const empty = {
      status: 'missing', institution: interbank ? '中债' : '中证', yield: null, netPrice: null,
      basis: preferredBasis, field: '', date: '', preferredBasis, basisFallback: false,
    };
    const candidates = marketRows.filter(row => rowCode(row) === code).map(row => {
      const date = marketDate(row);
      const ytm = numericField(row, prefix + 'Ytm', prefix + '_ytm');
      const yte = numericField(row, prefix + 'Yte', prefix + '_yte');
      const validYield = value => typeof value === 'number' && Number.isFinite(value) && value > -5 && value < 25;
      const exercise = preferExercise && validYield(yte);
      const value = exercise ? yte : ytm;
      const netPrice = numericField(row, prefix + (exercise ? 'Npte' : 'Nptm'), prefix + (exercise ? '_npte' : '_nptm'));
      const reliability = String(row[prefix + 'Reliability'] ?? row[prefix + '_reliability'] ?? '').trim();
      const source = numericField(row, 'dataSource', 'data_source');
      return { date, yield: validYield(value) ? value : null, netPrice: netPrice !== null && netPrice > 0 ? netPrice : null,
        ...rowProvenance(row, [prefix + (exercise ? 'Yte' : 'Ytm'), prefix + (exercise ? '_yte' : '_ytm'), prefix + (exercise ? 'Npte' : 'Nptm'), prefix + (exercise ? '_npte' : '_nptm')]),
        basis: exercise ? '行权' : '到期', field: prefix + (exercise ? 'Yte' : 'Ytm'), reliability,
        dataSource: source, sourceRank: DATA_SOURCES.includes(source) ? DATA_SOURCES.indexOf(source) : DATA_SOURCES.length };
    }).filter(item => item.date && item.date >= earliestDate && item.date <= requestedDate && item.yield !== null)
      .sort((a, b) => b.date.localeCompare(a.date) || reliabilityRank(b.reliability) - reliabilityRank(a.reliability) || a.sourceRank - b.sourceRank);
    const chosen = candidates[0];
    if (!chosen) {
      const failed = marketRows.some(row => Array.isArray(row?._qb?.failedInstitutions)
        && row._qb.failedInstitutions.some(item => item?.institution === (interbank ? 'CDC' : 'CSI')
          && Array.isArray(item.securityIdList) && item.securityIdList.includes(code)
          && isIsoDate(item.date) && item.date >= earliestDate && item.date <= requestedDate));
      results[code] = failed ? { ...empty, status: 'error', reason: 'upstream_failed', provider: 'QB' } : empty;
      continue;
    }
    const tied = candidates.filter(item => item.date === chosen.date && reliabilityRank(item.reliability) === reliabilityRank(chosen.reliability) && item.sourceRank === chosen.sourceRank);
    if (tied.some(item => item.yield !== chosen.yield || item.basis !== chosen.basis || item.netPrice !== chosen.netPrice)) {
      results[code] = { ...empty, reason: 'ambiguous' }; continue;
    }
    const { sourceRank, ...valuation } = chosen;
    results[code] = { ...empty, ...valuation, status: 'matched', basisFallback: chosen.basis !== preferredBasis };
  }
  return results;
}

function chinaToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function offsetDate(date, days) {
  const shifted = new Date(date + 'T00:00:00Z');
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const __test__ = { chinaToday, basicPrefersExercise };
