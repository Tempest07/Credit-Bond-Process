import { requireUser, json } from '../_auth.js';
import { makeDmClient, validateDmConfig, rowsFromDm } from '../dm/lookup.js';
import { checkWriteRequest, readBody, nameCandidates, matchRows } from './_shared.js';

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const rejected = checkWriteRequest(context.request);
  if (rejected) return rejected;
  const configError = validateDmConfig(context.env);
  if (configError) return configError;
  let names;
  try {
    const body = await readBody(context.request, 20000);
    if (!Array.isArray(body?.names) || !body.names.length || body.names.length > 20 || body.names.some(n => typeof n !== 'string' || !n.trim() || n.length > 120)) throw new Error('names');
    names = [...new Set(body.names.map(n => n.trim()))];
  } catch { return json({error:'每次最多查询 20 个债券简称'}, 400); }
  try {
    const client = makeDmClient(context.env, context.request);
    const query = [...new Set(names.flatMap(nameCandidates))];
    const rows = [];
    const signal = AbortSignal.timeout(25000);
    for (let start = 0; start < query.length; start += 5) {
      const raw = await client.post('/dm-quant-func-service/api/v1/bond/basic-info/info', {secShortNameList:query.slice(start,start+5)}, {signal});
      rows.push(...rowsFromDm(raw));
    }
    return json({results:matchRows(names,rows)});
  } catch {
    return json({error:'DM 查询暂时失败或超时，请稍后重试。报价原文已保留。'}, 502);
  }
}
