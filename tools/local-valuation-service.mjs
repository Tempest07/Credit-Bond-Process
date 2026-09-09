import { fileURLToPath } from 'node:url';
import { collectModelValuationEvidence } from '../functions/api/dm/valuation.js';
import { makeDmClient } from '../functions/api/dm/lookup.js';
import { analyzeValuation, proposeExperience, installedValuationModels, DEFAULT_VALUATION_MODEL } from './local-valuation-model.mjs';
import { ValuationStore } from './valuation-store.mjs';
import { valuationSample } from './valuation-sample.mjs';

const PREFIX = '/bond-centre/api/valuation/';
export function createValuationService({ env = process.env, resolveEvidence, store = new ValuationStore(fileURLToPath(new URL('../.local-data/valuation-learning.json', import.meta.url))) } = {}) {
  let busy = false;
  const dmConfigured = () => Boolean(resolveEvidence || (env.INNO_APP_KEY && (env.INNO_APP_SECRET || env.INNO_SM4_KEY)));
  const ready = store.mutate(d => { for (const run of d.runs) if (run.status === 'running') Object.assign(run, { status: 'failed', error: '服务重启，分析已中断' }); });
  return async function handle(path, method, body, signal) {
    if (!path.startsWith(PREFIX)) return null;
    await ready;
    const action = path.slice(PREFIX.length);
    if (method === 'GET' && action === 'status') {
      let models = [], modelError = '';
      try { models = await installedValuationModels(); } catch { modelError = 'Ollama 未启动'; }
      return { dmConfigured: dmConfigured(), models, modelError, defaultModel: env.VALUATION_MODEL || DEFAULT_VALUATION_MODEL, busy, storage: 'local-file' };
    }
    if (method === 'GET' && action === 'history') {
      const d = await store.read();
      return { runs: d.runs.slice(-50).reverse().map(r => ({ id: r.id, createdAt: r.createdAt, status: r.status, shortName: r.evidence.target.shortName, sample: r.evidence.sample, model: r.model, feedbackCount: r.feedback.length })), experiences: d.experiences.slice(-100).reverse() };
    }
    if (method === 'GET' && /^runs\/[a-f0-9-]+$/.test(action)) {
      const run = (await store.read()).runs.find(r => r.id === action.slice(5));
      if (!run) throw Object.assign(new Error('记录不存在'), { status: 404 });
      return { run };
    }
    if (method !== 'POST') throw Object.assign(new Error('不支持此请求'), { status: 405 });
    if (action === 'experience') return { experience: await store.setExperience(body.id, body) };
    if (!['analyze','feedback'].includes(action)) throw Object.assign(new Error('接口不存在'), { status: 404 });
    if (busy) throw Object.assign(new Error('估值模型正在处理上一项任务，请稍后重试'), { status: 429 });
    busy = true;
    const timeoutSignal = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(240000)]);
    try {
      if (action === 'feedback') {
        const { run, feedback } = await store.addFeedback(body.runId, body);
        let experience = null, proposalError = '';
        if (feedback.reason) {
          try {
            const proposal = await proposeExperience(run, feedback, { model: run.model, signal: timeoutSignal });
            if (proposal) experience = await store.addProposal(run, feedback, proposal);
          } catch { proposalError = '修正已保存，模型未能生成经验建议；可稍后再补充修正理由。'; }
        }
        return { feedback, experience, proposalError };
      }
      const model = body.model || env.VALUATION_MODEL || DEFAULT_VALUATION_MODEL;
      if (typeof model !== 'string' || model.length > 160) throw new Error('模型名称无效');
      let evidence;
      if (resolveEvidence) evidence = await resolveEvidence(body);
      else if (body.sample === true) evidence = valuationSample();
      else {
        if (!dmConfigured()) throw Object.assign(new Error('本机未配置 DM 凭据，无法读取真实估值；可使用单独的演示案例。'), { status: 503 });
        const input = {};
        for (const k of ['issuerName','societyCode','shortName','fullName','durationText','offeringType','venue','hiddenRating']) {
          const value = body.target?.[k] || '';
          if (typeof value !== 'string' || value.length > 300) throw new Error('目标债资料无效');
          input[k] = value.trim();
        }
        const client = makeDmClient(env, new Request('http://127.0.0.1/'));
        const dm = { post: (p, b) => client.post(p, b, { signal: timeoutSignal }) };
        try { evidence = await collectModelValuationEvidence(dm, input); }
        catch { throw Object.assign(new Error(timeoutSignal.aborted ? '读取估值材料超时' : 'DM 取数失败，请核对本机凭据、接口权限及债券资料'), { status: 502 }); }
      }
      const learning = await store.learning(evidence);
      const run = await store.addRun(evidence, learning, model);
      try {
        const result = await analyzeValuation(evidence, learning, { model, signal: timeoutSignal });
        return { run: await store.finishRun(run.id, result) };
      } catch (e) {
        const error = timeoutSignal.aborted ? '本次推理超时或已取消' : e.message;
        await store.finishRun(run.id, null, error);
        throw Object.assign(new Error(error), { status: 502 });
      }
    } finally { busy = false; }
  };
}
