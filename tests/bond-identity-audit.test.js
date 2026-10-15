import test from 'node:test';
import assert from 'node:assert/strict';
import { auditBondIdentities, expandAuditNames, snapshotAccounts } from '../tools/audit-bond-identities.mjs';

test('audit handles abbreviated numeric and alphabetic multi-tranche names', () => {
  assert.deepEqual(expandAuditNames('26鄂交03/04'), ['26鄂交03', '26鄂交04']);
  assert.deepEqual(expandAuditNames('26示例MTN001A/B'), ['26示例MTN001A', '26示例MTN001B']);
  assert.deepEqual(expandAuditNames('26示例MTN001A/B(绿色)'), ['26示例MTN001A(绿色)', '26示例MTN001B(绿色)']);
  const report = auditBondIdentities({ projects: [{ id: 'p', shortName: '26鄂交03/04', tranches: [{ shortName: '26鄂交03' }, { shortName: '26鄂交04' }] }] });
  assert.equal(report.summary.findings, 0);
});

test('audit finds contradictions but never guesses which field to overwrite', () => {
  const snapshot = { projects: [{ id: 'p', shortName: '26鄂交05', opinion: 'private manual opinion', tranches: [{ shortName: '26鄂交03', securityCode: '525023.SZ', securityId: '525044.SZ', pricingRate: 1.8 }] }] };
  const before = structuredClone(snapshot);
  const report = auditBondIdentities(snapshot);
  assert.deepEqual(report.findings.map(f => f.kind), ['conflicting-code-fields', 'project-tranche-name-mismatch']);
  assert.equal(report.summary.certainCorrections, 0);
  assert.ok(report.findings.every(f => f.suggestedCorrection === null));
  assert.equal(JSON.stringify(report).includes('private manual opinion'), false);
  assert.deepEqual(snapshot, before);
});

test('audit compares codes with compatible venues and keeps account scopes separate', () => {
  const project = (id, shortName, securityCode) => ({ id, shortName, tranches: [{ shortName, securityCode }] });
  const report = auditBondIdentities([
    { user_id: 'a', projects: [project('1', '26甲01', '123.SH'), project('2', '26乙01', '123.SZ'), project('3', '26丙01', '123')] },
    { user_id: 'b', projects: [project('4', '26丁01', '123.SH')] },
  ]);
  assert.equal(report.summary.findings, 2);
  assert.ok(report.findings.every(f => f.account === 'a' && f.projectId === '3'));
});

test('valid reallocation and ABS class names are not classified as mismatch', () => {
  const report = auditBondIdentities({ projects: [
    { id: '1', shortName: '26示例MTN001A', tranches: [{ shortName: '26示例MTN001B', allocationNote: '品种一全额回拨至品种二' }] },
    { id: '2', shortName: '某资产支持专项计划', instrumentType: 'ABS', tranches: [{ shortName: '优先A' }, { shortName: '次级' }] },
  ] });
  assert.equal(report.summary.findings, 0);
});

test('Wrangler snapshots are supported and malformed snapshots fail explicitly', () => {
  assert.equal(snapshotAccounts([{ results: [{ user_id: 'a', projects: '[]' }] }]).length, 1);
  assert.throws(() => snapshotAccounts({ other: [] }), /incomplete audit/);
});
