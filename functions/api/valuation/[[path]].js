import { requireUser, json } from '../_auth.js';
import { localProviderConfig } from '../_issuance-provider.js';
import { makeDmClient, validateDmConfig } from '../dm/lookup.js';
import { collectModelValuationEvidence } from '../dm/valuation.js';
import { validateValuationOutput, VALUATION_PROMPT_VERSION } from '../../../valuation-model.js';

export async function onRequest(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const { request, env } = context;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin && origin !== 'https://tempest07.com') return json({ error: '不允许跨站调用。' }, 403);
  const action = Array.isArray(context.params?.path) ? context.params.path.join('/') : String(context.params?.path || '');
  const method = request.method;
  if (!(method === 'GET' && /^(status|history|runs\/[a-f0-9-]+)$/.test(action)) && !(method === 'POST' && /^(analyze|feedback|experience)$/.test(action))) return json({ error: '接口不存在。' }, 404);
  let body = {};
  if (method === 'POST') {
    if (request.headers.get('Content-Type')?.split(';')[0].toLowerCase() !== 'application/json') return json({ error: '请使用 JSON。' }, 415);
    try {
      const input = await readJson(request, 16000);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      // Do not forward browser-supplied identity, evidence, model or historical results.
      if (action === 'analyze') {
        const target = {};
        for (const k of ['issuerName','societyCode','shortName','fullName','durationText','offeringType','venue','hiddenRating']) {
          const value = input.target?.[k] ?? '';
          if (typeof value !== 'string' || value.length > 300) throw new Error();
          target[k] = value.trim();
        }
        if (!target.issuerName || !target.shortName || !target.durationText) throw new Error();
        body = { target };
      } else if (action === 'feedback') body = { runId: input.runId, targetIndex: input.targetIndex, finalYield: input.finalYield, reason: input.reason };
      else body = { id: input.id, revision: input.revision, text: input.text, status: input.status };
    } catch { return json({ error: '请求资料无效或过长。' }, 400); }
  }
  try {
    const config = localProviderConfig(env);
    if (!config) return json({ error: '实验估值服务尚未启用。' }, 503);
    const timeout = AbortSignal.timeout(90000);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    if (action === 'analyze') {
      const missing = validateDmConfig(env);
      if (missing) return missing;
      const client = makeDmClient(env, request);
      body = { evidence: await (context.collectEvidence || collectModelValuationEvidence)({ post: (p,b) => client.post(p,b,{ signal }) }, body.target) };
    }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` };
    if (config.accessClientId) {
      headers['CF-Access-Client-Id'] = config.accessClientId;
      headers['CF-Access-Client-Secret'] = config.accessClientSecret;
    }
    const response = await (context.fetchImpl || fetch)(new URL('/v1/valuation', config.url), {
      method: 'POST', headers, body: JSON.stringify({ userId: auth.user.id, action, method, body }), signal, redirect: 'manual',
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages = { 429: '模型正在处理其他任务，请稍后重试。', 400: '本次处理未完成，请核对资料；已保存的记录可在历史中查看。', 409: '记录已被修改，请刷新后重试。', 404: '记录不存在。' };
      return json({ error: messages[response.status] || '实验估值服务离线或超时，请确认电脑与本地模型服务已启动。' }, messages[response.status] ? response.status : 503);
    }
    const result = await readJson(response, 2000000);
    if (action === 'analyze') {
      const run = result.run;
      if (run?.result?.model !== 'gpt-oss:20b' || run.result.promptVersion !== VALUATION_PROMPT_VERSION || JSON.stringify(run.evidence) !== JSON.stringify(body.evidence) || !validateValuationOutput(run.result.output, body.evidence).ok) throw new Error('Invalid result');
    }
    if (action === 'status') result.dmConfigured = !validateDmConfig(env);
    return json(result);
  } catch (error) {
    return json({ error: ['TimeoutError','AbortError'].includes(error?.name) ? '实验估值超时，请稍后查看记录或重试。' : '实验估值暂时不可用，请稍后重试。' }, 503);
  }
}

async function readJson(message, limit) {
  if (Number(message.headers.get('Content-Length')) > limit) throw new Error('Too large');
  const reader = message.body?.getReader();
  if (!reader) throw new Error('Empty');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(data));
}
