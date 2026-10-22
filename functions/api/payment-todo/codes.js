import { requireUser, json } from '../_auth.js';
import { makeDmClient, validateDmConfig, rowsFromDm, isExplicitlyCancelledIssueRow } from '../dm/lookup.js';
import { checkWriteRequest, readBody, normalizeName, matchRows } from '../bond-list/_shared.js';
import { withDataSources } from '../qb/fallback.js';

const BASIC_INFO_PATH = '/dm-quant-func-service/api/v1/bond/basic-info/info';

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const rejected = checkWriteRequest(context.request);
  if (rejected) return rejected;

  let names;
  try {
    const body = await readBody(context.request, 20000);
    if (!Array.isArray(body?.names) || !body.names.length || body.names.length > 20
      || body.names.some(name => typeof name !== 'string' || !name.trim() || name.length > 120)) throw new Error('names');
    names = [...new Set(body.names.map(name => name.trim()))];
  } catch {
    return json({ error: '每次最多查询 20 个有效债券简称。' }, 400);
  }
  const configError = validateDmConfig(context.env);
  if (configError) return configError;

  try {
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
    return json(withDataSources({ source: 'DM', fetchedAt: new Date().toISOString(), results: matchPaymentTodoCodeRows(names, rows) }, client));
  } catch {
    return json({ error: 'DM 债券代码查询暂时失败或超时，请稍后重试。' }, 502);
  }
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
