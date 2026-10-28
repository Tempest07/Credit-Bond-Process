import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRecord, normalizeProjectRecord, upsertProject } from '../lifecycle.js';
import { buildPaymentReceiptCoverage, selectPaymentReceiptMatch } from '../payment-receipts.js';
import { validateState } from '../functions/api/state.js';

const project = (id, extra = {}) => ({
  id, shortName: `26测试${id}`, status: '待缴款',
  tranches: [{ id: `t-${id}`, shortName: `26测试${id}`, resultStatus: '中标',
    winningAmountWan: 1000, securityCode: '012682531.IB', paymentDate: '2026-10-29' }],
  ...extra,
});

test('explicit project opt-out removes all its tranches from expected receipts without touching source data', () => {
  const projects = [project('required'), project('ignored', { paymentReceiptRequired: false,
    tranches: [...project('ignored').tranches, { id: 'paid', paymentDate: '2026-10-29', paymentCompleted: true }] })];
  const matches = [{ projectId: 'ignored', trancheId: 't-ignored', receiptId: 'saved-receipt', matchSource: 'manual' }];
  const before = structuredClone({ projects, matches });
  const result = buildPaymentReceiptCoverage(projects, matches, { date: '2026-10-29' });
  assert.deepEqual({ expected: result.expected, covered: result.covered, missing: result.missing },
    { expected: 1, covered: 0, missing: 1 });
  assert.deepEqual(result.targets.map(row => row.projectId), ['required']);
  assert.deepEqual({ projects, matches }, before);
});

test('restoring a project receipt requirement immediately restores its existing correspondence', () => {
  const ignored = project('1', { paymentReceiptRequired: false });
  const matches = [{ projectId: '1', trancheId: 't-1', receiptId: 'r', matchSource: 'manual' }];
  assert.equal(buildPaymentReceiptCoverage([ignored], matches).expected, 0);
  const restored = { ...ignored, paymentReceiptRequired: true };
  const result = buildPaymentReceiptCoverage([restored], matches);
  assert.equal(result.expected, 1);
  assert.equal(result.covered, 1);
  assert.equal(result.missing, 0);
  assert.equal(result.targets[0].receiptId, 'r');
  assert.equal(result.targets[0].matchSource, 'manual');
});

test('only explicit false opts out; legacy, ABS and unrecognized values keep the existing requirement', () => {
  for (const value of [undefined, true, null, 'false', 0]) {
    const ordinary = project('1', { paymentReceiptRequired: value });
    const abs = { ...ordinary, instrumentType: 'ABS', absInfo: { dealName: '测试计划' } };
    assert.equal(buildPaymentReceiptCoverage([ordinary]).expected, 1, String(value));
    assert.equal(buildPaymentReceiptCoverage([abs]).expected, 1, `ABS ${value}`);
  }
});

test('a saved original receipt can still match a project that opted out of missing-receipt reminders', () => {
  const ignored = project('1', { paymentReceiptRequired: false });
  const before = structuredClone(ignored);
  const result = selectPaymentReceiptMatch({ securityCode: '012682531', bondShortName: '26测试1',
    paymentDate: '2026-10-29', amountFen: 1_000_000_000 }, [ignored]);
  assert.equal(result.status, 'matched');
  assert.equal(result.projectId, '1');
  assert.equal(result.trancheId, 't-1');
  assert.deepEqual(ignored, before);
});

test('project opt-out survives cloud validation, serialization and normal edit round trips', () => {
  const initial = normalizeProjectRecord(project('1', { paymentReceiptRequired: false }));
  const first = validateState({ issuers: [], projects: [initial] });
  const loaded = normalizeProjectRecord(JSON.parse(JSON.stringify(first)).projects[0]);
  assert.equal(loaded.paymentReceiptRequired, false);
  const edited = upsertProject(first, { ...loaded, notes: '保留项目资料', targetQuoteNote: '1.63 3e' });
  assert.equal(edited.projects[0].paymentReceiptRequired, false);
  assert.equal(edited.projects[0].notes, '保留项目资料');
  assert.equal(edited.projects[0].targetQuoteNote, '1.63 3e');
  const restored = upsertProject(edited, { ...edited.projects[0], paymentReceiptRequired: true });
  assert.equal(normalizeProjectRecord(restored.projects[0]).paymentReceiptRequired, true);
  assert.equal(buildPaymentReceiptCoverage(restored.projects).expected, 1);
});

test('legacy project normalization remains field-compatible and project creation preserves an explicit choice', () => {
  for (const value of [undefined, null, 'false', 0]) {
    assert.equal(Object.hasOwn(normalizeProjectRecord(project('1', { paymentReceiptRequired: value })), 'paymentReceiptRequired'), false);
  }
  for (const value of [true, false]) {
    const created = createProjectRecord({ shortName: '26测试SCP001' }, null, {}, { paymentReceiptRequired: value });
    assert.equal(created.paymentReceiptRequired, value);
  }
});

test('a unique full bond short name and payment day match despite missing amount and issuer text', () => {
  const projects = [project('甲', { tranches: [{ id: 'a', shortName: '26苏元禾MTN003A(科创债)', paymentDate: '2026-10-29' }] }),
    project('乙', { tranches: [{ id: 'b', shortName: '26苏元禾MTN003B(科创债)', paymentDate: '2026-10-29' }] })];
  const result = selectPaymentReceiptMatch({ bondShortName: '26 苏元禾 MTN003A（科创债）', paymentDate: '2026-10-29' }, projects);
  assert.equal(result.status, 'matched');
  assert.equal(result.projectId, '甲');
  assert.equal(result.trancheId, 'a');
  assert.equal(result.candidates[0].signals.amount, false);
  assert.equal(result.candidates[0].signals.issuerName, false);
});

test('full-name day matching does not accept abbreviations, undated or duplicated identities, or conflicting securities', () => {
  const candidate = { id: 'a', shortName: '26越秀租赁MTN001', paymentDate: '2026-10-29' };
  const unrelated = { id: 'b', shortName: '26其他MTN001', paymentDate: '2026-10-29' };
  const projects = [project('1', { tranches: [candidate, unrelated] })];
  for (const receipt of [
    { bondShortName: '26越秀租MTN001', paymentDate: '2026-10-29' },
    { bondShortName: '26越秀租赁MTN001' },
    { bondShortName: '26越秀租赁MTN001', paymentDate: '2026-10-28' },
  ]) assert.notEqual(selectPaymentReceiptMatch(receipt, projects).status, 'matched');
  const duplicate = [...projects, project('2', { tranches: [{ ...candidate, id: 'duplicate' }] })];
  assert.notEqual(selectPaymentReceiptMatch({ bondShortName: candidate.shortName, paymentDate: candidate.paymentDate }, duplicate).status, 'matched');
  const coded = [project('1', { tranches: [{ ...candidate, securityCode: '102683476.IB' }, unrelated] })];
  for (const securityCode of ['102683475.IB', '102683476.SH']) {
    const result = selectPaymentReceiptMatch({ bondShortName: candidate.shortName, paymentDate: candidate.paymentDate, securityCode }, coded);
    assert.notEqual(result.status, 'matched');
  }
});

test('a full qualified name ranks above a different candidate whose name is just a substring', () => {
  const projects = [project('plain', { tranches: [{ id: 'plain', shortName: '26测试01', paymentDate: '2026-10-29' }] }),
    project('science', { tranches: [{ id: 'science', shortName: '26测试01(科创债)', paymentDate: '2026-10-29' }] })];
  const result = selectPaymentReceiptMatch({ bondShortName: '26测试01(科创债)', paymentDate: '2026-10-29' }, projects);
  assert.equal(result.status, 'matched');
  assert.equal(result.projectId, 'science');
});

test('unrelated bonds from another desk are archived even when their day and amount match our project', () => {
  const own = project('own', { issuerName: '自有项目公司', tranches: [{ id: 't', shortName: '26自有SCP001',
    paymentDate: '2026-10-29', winningAmountWan: 5000 }] });
  const result = selectPaymentReceiptMatch({ bondShortName: '26别家SCP005', securityCode: '012682888',
    paymentDate: '2026-10-29', amountFen: 5_000_000_000, recognizedText: '债券简称 26别家SCP005' }, [own]);
  assert.equal(result.status, 'unmatched');
  assert.deepEqual(result.candidates, []);
  const sameIssuer = selectPaymentReceiptMatch({ bondShortName: '26自有SCP009', paymentDate: '2026-10-29',
    recognizedText: '发行人 自有项目公司' }, [own]);
  assert.equal(sameIssuer.status, 'review');
});

test('clear nonowned names or valid nonowned codes suppress unrelated date-and-amount candidates', () => {
  const projects = ['1', '2'].map((suffix) => project(suffix, { issuerName: '已有发行人', tranches: [{
    id: `t-${suffix}`, shortName: `26已有SCP00${suffix}`, securityCode: `01268253${suffix}`,
    paymentDate: '2026-10-29', winningAmountWan: 1000,
  }] }));
  for (const fields of [
    { bondShortName: '26外部SCP001' },
    { securityCode: '012682888' },
    { securityCode: '246129.SH' },
    { bondShortName: '26外部SCP001', securityCode: '012682888' },
  ]) {
    const result = selectPaymentReceiptMatch({ ...fields, paymentDate: '2026-10-29', amountFen: 1_000_000_000 }, projects);
    assert.equal(result.status, 'unmatched', JSON.stringify(fields));
    assert.deepEqual(result.candidates, []);
  }
});

test('missing, invalid or internally conflicting identity remains visible for review rather than silently archived', () => {
  const projects = ['1', '2'].map(suffix=>project(suffix));
  for (const fields of [
    {}, { bondShortName: '无法看清' }, { securityCode: '1026837774' },
    { securityCode: '246129.SH', recognizedText: '证券代码246129.SZ' },
    { bondShortName: '26外部SCP001', securityCode: '1026837774' },
    { bondShortName: '26外部SCP001', securityCode: '246129.SH', recognizedText: '债券代码246130.SH' },
  ]) {
    const result = selectPaymentReceiptMatch({ ...fields, paymentDate: '2026-10-29', amountFen: 1_000_000_000 }, projects);
    assert.equal(result.status, 'review', JSON.stringify(fields));
    assert.equal(result.projectId, '');
    assert.equal(result.candidates.length, 2);
  }
});
