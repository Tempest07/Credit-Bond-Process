import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildPrepaymentNumber, normalizeProjectRecord, deriveProjectStatus, upsertProject } from '../lifecycle.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function harness() {
  const project = normalizeProjectRecord({
    id: 'project', shortName: '26测试MTN001', resultConfirmed: true, status: '待缴款', targetQuoteNote: '保留备注',
    tranches: [false, true].map((paymentCompleted, index) => ({
      id: 'tranche-' + index, shortName: '26测试MTN00' + (index + 1), resultStatus: '中标',
      winningRate: 1.8, winningAmountWan: 3000, paymentDate: '2026-10-21', paymentCompleted,
      prepaymentNumber: 'W202610210000' + index, prepaymentRecordedAt: '2026-10-21T01:00:00.000Z',
    })),
  });
  project.status = deriveProjectStatus(project);
  const input = { value: '', focus() {} };
  const context = vm.createContext({
    normalizeProjectRecord, deriveProjectStatus, upsertProject, buildPrepaymentNumber,
    state: { projects: [project, { id: 'unrelated', customField: 'unchanged' }], issuers: [{ id: 'issuer' }] },
    activePrepaymentTarget: { projectId: 'project', trancheId: 'tranche-0', numberDate: '2026-10-21' },
    $: () => input, saves: 0, renders: 0, closes: 0, messages: [],
    closePrepaymentEntry() { context.closes++; context.activePrepaymentTarget = null; },
    persistState() { context.saves++; }, renderProjectWorkspace() { context.renders++; },
    showToast(message) { context.messages.push(message); },
  });
  for (const name of ['savePrepaymentEntry', 'updatePrepaymentEntry']) {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(app.slice(start, app.indexOf('\nfunction ', start + 1)), context);
  }
  return { context, input };
}

test('clearing a recorded number preserves payment results, sibling tranches and other records', () => {
  const { context, input } = harness();
  input.value = '1'; // A partially edited suffix must not block the explicit clear action.
  const before = structuredClone(context.state);
  context.updatePrepaymentEntry('');
  const actual = context.state.projects[0];
  const expected = before.projects[0];
  expected.tranches[0].prepaymentNumber = '';
  expected.tranches[0].prepaymentRecordedAt = '';
  expected.updatedAt = actual.updatedAt;
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  assert.deepEqual(context.state.projects[1], before.projects[1]);
  assert.deepEqual(context.state.issuers, before.issuers);
  assert.equal(context.saves, 1);
  assert.equal(context.renders, 1);
  assert.equal(context.closes, 1);
  assert.match(context.messages[0], /已清除预缴款编号/);
});

test('the existing three-digit save still records a number and does not complete payment', () => {
  const { context, input } = harness();
  input.value = '123';
  context.savePrepaymentEntry({ preventDefault() {} });
  const tranche = context.state.projects[0].tranches[0];
  assert.equal(tranche.prepaymentNumber, 'W2026102100123');
  assert.ok(tranche.prepaymentRecordedAt);
  assert.equal(tranche.paymentCompleted, false);
  assert.equal(context.saves, 1);
  assert.equal(context.closes, 1);
});

test('invalid input and a stale target do not save or close the dialog', () => {
  const { context, input } = harness();
  input.value = '1';
  context.savePrepaymentEntry({ preventDefault() {} });
  context.activePrepaymentTarget.trancheId = 'removed-tranche';
  context.updatePrepaymentEntry('');
  assert.equal(context.saves, 0);
  assert.equal(context.closes, 0);
  assert.equal(context.renders, 0);
});
