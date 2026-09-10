import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeExperience } from '../tools/local-valuation-model.mjs';
import { ValuationStore } from '../tools/valuation-store.mjs';
import { valuationSample } from '../tools/valuation-sample.mjs';

test('experience cannot invert feedback or reintroduce erroneous model reasoning', async () => {
  const run = { evidence: valuationSample(), result: { badExplanation: '按估值源差异加3.7bp' } };
  const reason = '不要把估值源差异当作市场溢价，期限调整需有曲线依据。';
  const feedback = { targetIndex: 0, reason, finalYield: 2.02 };
  const options = { invokeImpl: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.feedbackReason, reason);
    assert.equal('result' in input, false);
    assert.equal(JSON.stringify(input).includes('3.7bp'), false);
    return { output: { proposal: reason } };
  } };
  assert.equal(await proposeExperience(run, feedback, options), reason);
  for (const proposal of ['期限调整后根据市场利差修正', '期限调整需有曲线依据。', null, 42]) {
    await assert.rejects(proposeExperience(run, feedback, { invokeImpl: async () => ({ output: { proposal } }) }), /完整人工理由/);
  }
  assert.equal(await proposeExperience(run, feedback, { invokeImpl: async () => ({ output: { proposal: '' } }) }), '');
  assert.equal(await proposeExperience(run, { ...feedback, reason: '' }, { invokeImpl: () => { throw new Error('should skip'); } }), '');
});

test('legacy confirmed learning is preserved, withheld with notice, and restored only after explicit review', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valuation-learning-evidence-'));
  try {
    const file = join(dir, 'records.json'), store = new ValuationStore(file), evidence = valuationSample();
    const run = await store.addRun(evidence, {}, 'test');
    await store.finishRun(run.id, { output: { results: [] } });
    const { feedback } = await store.addFeedback(run.id, { targetIndex: 0, finalYield: 2.02, reason: '不能用估值源分歧加点' });
    const proposal = await store.addProposal(run, feedback, feedback.reason);
    await store.setExperience(proposal.id, { status: 'confirmed', text: proposal.text, revision: 1 });
    await store.mutate(d => { delete d.experiences[0].learningVersion; });
    const before = await readFile(file, 'utf8');
    const learning = await store.learning(evidence);
    assert.deepEqual(learning, { reviewRequired: 1, experiences: [], cases: [] });
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal((await store.read()).experiences[0].status, 'confirmed');
    await store.setExperience(proposal.id, { status: 'confirmed', text: '期限调整必须引用实际曲线节点，估值源分歧不是加点依据', revision: 2 });
    const restored = await new ValuationStore(file).learning(evidence);
    assert.equal(restored.experiences.length, 1);
    assert.equal(restored.cases.length, 1);
    assert.equal(restored.reviewRequired, undefined);
    const saved = (await store.read()).experiences[0];
    assert.equal(saved.learningVersion, 2);
    assert.equal(saved.feedbackReason, feedback.reason);
    assert.equal(saved.audit.at(-1).learningVersion, 1);
    await store.setExperience(proposal.id, { status: 'disabled', text: saved.text, revision: 3 });
    assert.deepEqual(await store.learning(evidence), { experiences: [], cases: [] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
