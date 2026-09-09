import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function experienceScope(evidence) {
  const t = evidence.target;
  return JSON.stringify([Boolean(evidence.sample), t.issuerName, t.profile?.bondClass, t.offeringType, t.profile?.market, Boolean(t.profile?.perpetual), Boolean(t.profile?.subordinated), Boolean(t.profile?.structured), Boolean(t.profile?.exercisable), evidence.targets.map(t => [t.years, t.hasExercise])]);
}
export class ValuationStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async read() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.runs) || !Array.isArray(data.experiences)) throw new Error('估值记录格式不兼容，已停止写入');
      return data;
    } catch (e) { if (e.code === 'ENOENT') return { version: 1, runs: [], experiences: [] }; throw e; }
  }
  mutate(fn) {
    const task = this.queue.then(async () => {
      const data = await this.read();
      const result = fn(data);
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await rename(tmp, this.file);
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async learning(evidence) {
    const data = await this.read();
    const scope = experienceScope(evidence);
    const active = data.experiences.filter(e => e.scope === scope && e.status === 'confirmed').slice(-8);
    const confirmedFeedback = new Set(active.map(e => e.feedbackId));
    return {
      experiences: active.map(e => ({ id: e.id, text: e.text, confirmedAt: e.updatedAt })),
      cases: data.runs.filter(r => r.status === 'complete' && experienceScope(r.evidence) === scope && r.feedback?.some(f => confirmedFeedback.has(f.id))).slice(-3).map(r => ({ id: r.id, date: r.createdAt, historicalOnly: true, corrections: r.feedback.filter(f => confirmedFeedback.has(f.id)).map(f => ({ target: r.evidence.targets[f.targetIndex], reason: f.reason })) })),
    };
  }
  addRun(evidence, learning, model) {
    return this.mutate(d => { const run = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'running', evidence, learning, model, feedback: [] }; d.runs.push(run); return run; });
  }
  finishRun(id, result, error) {
    return this.mutate(d => { const r = d.runs.find(r => r.id === id); if (!r) throw new Error('分析不存在'); Object.assign(r, { status: error ? 'failed' : 'complete', result, error, completedAt: new Date().toISOString() }); return r; });
  }
  addFeedback(id, { targetIndex, finalYield, reason }) {
    return this.mutate(d => {
      const r = d.runs.find(r => r.id === id);
      if (!r || r.status !== 'complete') throw new Error('分析尚未完成');
      if (!Number.isInteger(targetIndex) || !r.evidence.targets[targetIndex]) throw new Error('目标期限无效');
      if (typeof finalYield !== 'number' || !Number.isFinite(finalYield) || finalYield <= 0 || finalYield > 50) throw new Error('人工估值必须为0—50之间的百分数');
      if (typeof reason !== 'string' || reason.length > 2000) throw new Error('修正理由过长');
      const f = { id: randomUUID(), targetIndex, finalYield, reason: reason.trim(), createdAt: new Date().toISOString() };
      r.feedback.push(f); return { run: r, feedback: f };
    });
  }
  addProposal(run, feedback, text) {
    return this.mutate(d => { const e = { id: randomUUID(), runId: run.id, feedbackId: feedback.id, scope: experienceScope(run.evidence), issuerName: run.evidence.target.issuerName, sample: run.evidence.sample, text, status: 'pending', revision: 1, updatedAt: new Date().toISOString(), audit: [] }; d.experiences.push(e); return e; });
  }
  setExperience(id, { status, text, revision }) {
    return this.mutate(d => {
      const e = d.experiences.find(e => e.id === id);
      if (!e) throw new Error('经验不存在');
      if (e.revision !== revision) throw Object.assign(new Error('经验已变化，请刷新后重试'), { status: 409 });
      if (!['confirmed','disabled'].includes(status) || typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('经验内容或状态无效');
      e.audit.push({ status: e.status, text: e.text, at: e.updatedAt });
      Object.assign(e, { status, text: text.trim(), revision: revision + 1, updatedAt: new Date().toISOString() }); return e;
    });
  }
}
