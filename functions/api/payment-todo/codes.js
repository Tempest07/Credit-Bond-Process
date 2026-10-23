import { requireUser, json } from '../_auth.js';
import { makeDmClient, validateDmConfig, rowsFromDm, isExplicitlyCancelledIssueRow } from '../dm/lookup.js';
import { checkWriteRequest, readBody, normalizeName, matchRows } from '../bond-list/_shared.js';
import { withDataSources } from '../qb/fallback.js';
import { qbRateLimitResponse } from '../qb/errors.js';
import { resolveDataSourceMode } from '../_data-source.js';
import { PaymentCodeCacheError, queryCloudPaymentCodes } from './_code-cache.js';

const BASIC_INFO_PATH = '/dm-quant-func-service/api/v1/bond/basic-info/info';

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const rejected = checkWriteRequest(context.request);
  if (rejected) return rejected;

  let names, force;
  try {
    const body = await readBody(context.request, 20000);
    if (!Array.isArray(body?.names) || !body.names.length || body.names.length > 20
      || body.names.some(name => typeof name !== 'string' || !name.trim() || name.length > 120)
      || body.force !== undefined && typeof body.force !== 'boolean') throw new Error('names');
    names = [...new Set(body.names.map(name => name.trim()))];
    force = body.force === true;
  } catch {
    return json({ error: '每次最多查询 20 个有效债券简称。' }, 400);
  }
  try {
    if (!context.env.DB) {
      const configError = validateDmConfig(context.env, context.request);
      if (configError) return configError;
      return json(await lookupPaymentCodeNames(context, names));
    }
    const lookup = requested => {
      if (validateDmConfig(context.env, context.request)) throw Object.assign(new Error('Market data source not configured'), { status: 503 });
      return lookupPaymentCodeNames(context, requested);
    };
    const { terminalError, ...payload } = await queryCloudPaymentCodes(context.env.DB, {
      names, force, mode: resolveDataSourceMode(context.env, context.request), lookup,
    });
    if (terminalError?.status === 429) return qbRateLimitResponse({ status: 429, retryAfter: terminalError.retryAfter });
    if (terminalError?.status === 503) return json({ code: 'payment_code_source_unavailable', error: '债券代码数据源暂未配置，请检查工作区数据源后重试。' }, 503);
    if (terminalError) return json({ error: '债券代码查询暂时失败或超时，请稍后重试。' }, 502);
    return json(payload);
  } catch (error) {
    if (error instanceof PaymentCodeCacheError) return json({ code: 'payment_code_cache_unavailable', error: '债券代码云端缓存暂时不可用，请稍后重试。' }, 503);
    const limited = qbRateLimitResponse(error);
    if (limited) return limited;
    return json({ error: '债券代码查询暂时失败或超时，请稍后重试。' }, 502);
  }
}

async function lookupPaymentCodeNames(context, names) {
  const client = makeDmClient(context.env, context.request);
  const query = [...new Set(names.flatMap(name => [name, name.normalize('NFKC')]))];
  const rows = [];
  const signal = AbortSignal.timeout(25000);
  for (let start = 0; start < query.length; start += 5) {
    signal.throwIfAborted();
    const raw = await client.post(BASIC_INFO_PATH, { secShortNameList: query.slice(start, start + 5) }, { signal });
    signal.throwIfAborted();
    rows.push(...rowsFromDm(raw));
  }
  return withDataSources({ source: 'DM', fetchedAt: new Date().toISOString(), results: matchPaymentTodoCodeRows(names, rows) }, client);
}

export function matchPaymentTodoCodeRows(names, rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof (row.secShortName ?? row.sec_short_name) !== 'string')) {
    throw new Error('invalid_dm_response');
  }
  const results = Object.create(null);
  for (const name of names) {
    // Match each tranche independently before the OFR/BID formatter can apply annotation aliases.
    const exact = rows.filter(row => normalizeName(row.secShortName ?? row.sec_short_name) === normalizeName(name)
      && !isExplicitlyCancelledIssueRow(row));
    results[name] = matchRows([name], exact)[name];
  }
  return results;
}
