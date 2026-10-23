import { createQbClient, isQbStopError } from './client.js';
import { basicFallback } from './basic.js';
import { marketFallback } from './market.js';
import { ratingsCurvesFallback } from './ratings-curves.js';
import { resolveDataSourceMode } from '../_data-source.js';

const present = value => value !== null && value !== undefined && !(typeof value === 'string' && (!value.trim() || /^(?:--?|—|N\/?A|NULL|NONE|NAN)$/i.test(value.trim()))) && !(typeof value === 'number' && !Number.isFinite(value));
const canonical = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const snake = key => key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const numericFields = new Set(['newcouprate','isscouprate','couponrate','planissueamount','actuissueamount','actuissamut',
  'cbytm','cbyte','cbnptm','cbnpte','csytm','csyte','csnptm','csnpte','yield']);
const validField = (value, key) => present(value) && (!numericFields.has(key.replaceAll('_','').toLowerCase())
  || typeof value === 'number' || typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value)));
const get = (row, key) => validField(row?.[key], key) ? row[key] : validField(row?.[snake(key)], key) ? row[snake(key)] : undefined;
const code = row => canonical(get(row, 'securityId'));
const name = row => canonical(get(row, 'secShortName') || get(row, 'comFullName') || get(row, 'comChiName'));
const day = row => String(get(row, 'valuationDate') || get(row, 'ratingDate') || get(row, 'issueStartDate') || get(row, 'issueDate') || '').slice(0, 10);
const fieldsOf = row => Object.keys(row || {}).filter(key => !key.startsWith('_') && present(row[key]));
const list = value => Array.isArray(value) ? value : value ? [value] : [];

export function rows(value) {
  if (Array.isArray(value)) return value.filter(row => row && typeof row === 'object' && !Array.isArray(row));
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'result', 'rows', 'list', 'records', 'content']) if (key in value) return rows(value[key]);
  return fieldsOf(value).length ? [value] : [];
}

// A client and its identity cache belong to one incoming request, never a user-
// independent Worker global. QB is attempted only after the DM result is known.
export function createFallbackClient(env, request, dm, { qbClient, dmTimeoutMs = 4500 } = {}) {
  const mode = resolveDataSourceMode(env, request);
  if (mode === 'dm' || mode !== 'qb' && !env.QB_ACCESS_KEY && !qbClient) return dm;
  const qb = qbClient || createQbClient(env, { signal: request?.signal });
  const used = new Set(), events = [], unavailable = new Map();
  function remember(input, result = []) {
    for (const target of list(input.securityIdList)) qb.scope.codes.add(canonical(target));
    for (const target of list(input.secShortNameList)) qb.scope.names.add(String(target).trim());
    for (const row of result) {
      const id = code(row), shortName = get(row, 'secShortName');
      if (id) { qb.scope.codes.add(id); qb.scope.basicByCode.set(id, { ...qb.scope.basicByCode.get(id), ...row }); }
      if (shortName) qb.scope.names.add(shortName);
      const society = get(row, 'societyCode'), issuer = get(row, 'issuerName') || get(row, 'comFullName') || get(row, 'comChiName');
      if (society && issuer) qb.scope.issuerNameBySocietyCode.set(canonical(society), issuer);
    }
  }
  return {
    sourceInfo() { return { mode, primary: mode === 'qb' ? 'QB' : 'DM', fallback: mode === 'auto' ? 'QB' : null,
      used: [...used], fallbackUsed: mode === 'auto' && used.has('QB'), events: events.slice() }; },
    async post(path, input = {}, options = {}) {
      const signal = options.signal || request?.signal;
      signal?.throwIfAborted();
      remember(input);
      let original, dmRows = [], dmError;
      if (mode === 'qb') { /* Explicit QB mode never calls DM. */ }
      else if (unavailable.has(path)) dmError = unavailable.get(path);
      else try {
        const timeout = AbortSignal.timeout(dmTimeoutMs);
        const dmSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        original = await dm.post(path, input, { ...options, signal: dmSignal });
        dmRows = rows(original);
        if (dmRows.length) used.add('DM');
      } catch (error) {
        signal?.throwIfAborted();
        dmError = error;
        if (/HTTP (?:401|403|429)|无订阅|Timeout|timed? ?out|abort/i.test(String(error?.message))) unavailable.set(path, error);
      }
      remember(input, dmRows);
      if (!dmError && complete(dmRows, input)) return original;
      const adaptedInput = { ...input };
      if (!adaptedInput.comChiNameList && list(input.societyCodeList).length) {
        adaptedInput.comChiNameList = list(input.societyCodeList).map(value => qb.scope.issuerNameBySocietyCode.get(canonical(value))).filter(Boolean);
      }
      // Per-call cancellation also cancels the upstream QB fetches. The request
      // cache deduplicates identical, concurrent reads across consumers.
      const client = Object.assign(Object.create(qb), { query: (api, params) => qb.query(api, params, { signal }) });
      let qbRows;
      try {
        qbRows = await dispatch(path, adaptedInput, client);
        qb.throwIfBlocked?.();
      }
      catch (error) {
        signal?.throwIfAborted();
        if (isQbStopError(error)) throw error;
        if (mode === 'qb') throw new Error('QB 查询暂时失败，请稍后重试。');
        if (dmError) throw new Error('DM 与 QB 均未取得可用数据，请稍后重试。');
        return original;
      }
      signal?.throwIfAborted();
      if (!qbRows?.length) {
        if (mode === 'qb') {
          if (qbRows === null) throw new Error('QB 暂无该功能的同口径数据。');
          return [];
        }
        if (dmError) throw new Error('DM 未取得数据，QB 暂无同口径数据。');
        return original;
      }
      const merged = mergeRows(path, dmRows, qbRows);
      const qbFields = merged.filter(row => row._qb && fieldsOf(row).some(field => row._fieldSources?.[field] === 'QB'));
      if (!qbFields.length) { if (mode === 'qb') return []; if (dmError) throw new Error('DM 未取得数据，QB 返回的数据身份或口径不明确。'); return original; }
      used.add('QB');
      for (const row of qbFields) events.push({ path, apiNames: row._qb.apiNames || [], date: row._qb.date || '',
        fields: fieldsOf(row).filter(field => row._fieldSources?.[field] === 'QB') });
      remember(input, merged);
      return replaceRows(original, merged);
    },
  };
}

function replaceRows(original, merged) {
  if (!original || Array.isArray(original) || typeof original !== 'object') return merged;
  for (const key of ['list', 'data', 'result', 'rows', 'records', 'content']) {
    if (Array.isArray(original[key])) return { ...original, [key]: merged };
    if (original[key] && typeof original[key] === 'object') return { ...original, [key]: replaceRows(original[key], merged) };
  }
  return merged;
}

function complete(dmRows, input) {
  if (!dmRows.length) return false;
  const fields = list(input.fieldNames);
  if (!fields.length) return false;
  const codes = list(input.securityIdList).map(canonical);
  const targets = codes.length ? codes.map(id => dmRows.filter(row => code(row) === id)) : [dmRows];
  return targets.every(group => group.length && fields.every(field => group.some(row => present(get(row, field)))));
}

async function dispatch(path, input, client) {
  // Adapters cap a batch, while the shared request budget bounds the complete
  // page. Split larger quote lists rather than silently dropping later bonds.
  const key = ['securityIdList', 'secShortNameList'].find(key => list(input[key]).length > 20);
  if (key) {
    const output = [];
    for (let i = 0; i < input[key].length; i += 20) output.push(...(await dispatch(path, { ...input, [key]: input[key].slice(i, i + 20) }, client) || []));
    return output;
  }
  for (const adapter of [basicFallback, marketFallback, ratingsCurvesFallback]) {
    const result = await adapter(path, input, client);
    if (result !== null) return result;
  }
  return null;
}

function keyFor(path, row) {
  if (/curve/.test(path)) return [get(row, 'curveChName'), day(row), get(row, 'curveTerm'), get(row, 'curveType'), get(row, 'dataSource')].join('|');
  const identity = code(row) || name(row);
  if (!identity) return '';
  if (/market-data\/date|rating\/data|implied-rating|default-rate/.test(path)) return [identity, day(row), canonical(get(row, 'ratingInstitutionShortName'))].join('|');
  if (/primary\/data/.test(path)) return [identity, day(row)].join('|');
  return identity;
}

function ambiguousBasic(rows) {
  const bad = new Set(), byCode = new Map();
  for (const row of rows) {
    const id = code(row); if (!id) continue;
    if (!byCode.has(id)) byCode.set(id, new Map());
    const evidence = byCode.get(id);
    for (const field of ['secShortName', 'issuerName', 'issuerFullName', 'issueStatusDesc']) {
      const value = get(row, field); if (!present(value)) continue;
      if (!evidence.has(field)) evidence.set(field, new Set());
      evidence.get(field).add(canonical(value));
      if (evidence.get(field).size > 1) bad.add(id);
    }
  }
  return bad;
}

export function mergeRows(path, dmRows, qbRows) {
  const output = dmRows.map(row => ({ ...row }));
  const invalid = /basic-info\/info|primary\/data/.test(path) ? ambiguousBasic(qbRows) : new Set();
  const pairs = { cbYtm: 'cbNptm', cbNptm: 'cbYtm', cbYte: 'cbNpte', cbNpte: 'cbYte',
    csYtm: 'csNptm', csNptm: 'csYtm', csYte: 'csNpte', csNpte: 'csYte' };
  for (const row of qbRows) {
    if (invalid.has(code(row))) continue;
    const key = keyFor(path, row); if (!key) continue;
    let target = output.find(candidate => keyFor(path, candidate) === key);
    // An unrequested alternate date must not supersede any already available DM
    // observation. Keep institution, date, yield and price together.
    const relatedDm = dmRows.filter(candidate => code(row) ? code(candidate) === code(row) : name(candidate) === name(row));
    const ratingObservation = /\/(?:company|bond)\/rating\/data$/.test(path);
    const completeRating = candidate => present(get(candidate, 'rating')) && present(get(candidate, 'ratingInstitutionShortName')) && Boolean(day(candidate));
    if (ratingObservation && !target && relatedDm.some(completeRating)) continue;
    const independentRating = ratingObservation && !target && completeRating(row);
    const additional = {};
    for (const field of fieldsOf(row)) {
      if (present(get(target, field))) continue;
      if (!independentRating && relatedDm.some(candidate => present(get(candidate, field))) && !['securityId', 'secShortName', 'valuationDate', 'ratingDate', 'issueDate', 'dataSource'].includes(field)) continue;
      if (!independentRating && !target && relatedDm.some(candidate => present(get(candidate, field))) && !['securityId', 'secShortName', 'valuationDate', 'ratingDate'].includes(field)) continue;
      const partner = pairs[field];
      if (partner && target && present(get(target, partner)) && (!present(get(row, partner)) || Number(get(target, partner)) !== Number(get(row, partner)))) continue;
      additional[field] = row[field];
      if (target && snake(field) !== field && snake(field) in target && !validField(target[snake(field)], field)) additional[snake(field)] = row[field];
    }
    for (const [price, yieldField] of Object.entries({ cbNptm: 'cbYtm', cbNpte: 'cbYte', csNptm: 'csYtm', csNpte: 'csYte' })) {
      if (price in additional && !present(get(target, yieldField)) && !present(additional[yieldField])) delete additional[price];
    }
    if (!Object.keys(additional).some(field => !['securityId', 'secShortName', 'valuationDate', 'ratingDate', 'issueDate', 'dataSource'].includes(field))) continue;
    if (!target) { target = {}; output.push(target); }
    const fieldSources = { ...Object.fromEntries(fieldsOf(target).map(field => [field, target._fieldSources?.[field] || 'DM'])),
      ...Object.fromEntries(Object.keys(additional).map(field => [field, 'QB'])) };
    const hadDm = Object.values(fieldSources).includes('DM');
    Object.assign(target, additional, { _provider: hadDm ? 'DM+QB' : 'QB', _fieldSources: fieldSources,
      _qb: { ...row._qb, fieldMap: { ...target._qb?.fieldMap, ...row._qb?.fieldMap },
        apiNames: [...new Set([...(target._qb?.apiNames || []), ...(row._qb?.apiNames || [])])] } });
  }
  return output;
}

export function withDataSources(payload, client) {
  const info = client?.sourceInfo?.();
  if (!info?.fallbackUsed && info?.mode !== 'qb') return payload;
  const source = info.mode === 'qb' ? 'QB' : info.used.includes('DM') ? 'DM+QB' : 'QB';
  const apis = [...new Set((info.events || []).flatMap(event => event.apiNames || []))];
  return { ...payload, source, dataSources: info,
    ...('sourcePath' in payload ? { sourcePath: source === 'QB' ? apis.join(', ') : payload.sourcePath,
      sourcePaths: [payload.sourcePath, ...apis].filter(Boolean) } : {}) };
}
