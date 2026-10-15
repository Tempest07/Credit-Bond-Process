import test from 'node:test';
import assert from 'node:assert/strict';
import { sameBondIdentity, sameIssuance, normalizeLookupPayload, validateIssueGroup } from '../bond-identity.js';

const bond = { shortName: '26测试05', securityId: '123005.SH', issuerName: '测试公司', fullName: '测试公司2026年公司债券(第二期)(品种一)', subscribeDate: '2026-10-15' };
test('security conflicts veto matching names, while bare and qualified codes match', () => {
  assert.equal(sameBondIdentity(bond, { ...bond, securityId: '123005.SZ' }), false);
  assert.equal(sameBondIdentity(bond, { ...bond, securityId: '123006.SH' }), false);
  assert.equal(sameBondIdentity(bond, { ...bond, securityId: '123005' }), true);
});
test('same-day adjacent serials need explicit same-issue full names', () => {
  const sibling = { ...bond, shortName: '26测试06', securityId: '123006.SH', fullName: '测试公司2026年公司债券(第二期)(品种二)' };
  assert.equal(sameIssuance(bond, sibling), true);
  assert.equal(sameIssuance(bond, { ...sibling, fullName: '测试公司2026年公司债券(第三期)' }), false);
  assert.equal(sameIssuance(bond, { ...sibling, fullName: '' }), false);
  assert.equal(sameIssuance(bond, { ...sibling, subscribeDate: '2026-10-14' }), false);
  assert.equal(sameIssuance(bond, { ...sibling, issuerName: '另一家公司' }), false);
});
test('a target present inside a polluted group does not legitimize the entire group', () => {
  const group = { totalScale: 100, issueName: '26测试03/04/05', tranches: [{ shortName: '26测试03' }, { shortName: '26测试04' }, bond] };
  const clean = validateIssueGroup(group, bond, { shortName: bond.shortName });
  assert.deepEqual(clean.tranches, [bond]);
  assert.equal(clean.totalScale, null);
  assert.equal(clean.issueName, bond.shortName);
  assert.equal(group.tranches.length, 3);
});
test('known-code mismatch is rejected even if it shares a name with the target anchor', () => {
  const polluted = { tranches: [{ ...bond, securityId: 'WRONG05.SH' }, { shortName: '26测试06' }] };
  assert.equal(validateIssueGroup(polluted, bond), null);
});
test('invalid sibling reallocation is removed, explicit within-issue destination is preserved', () => {
  const a = { shortName: '26测试MTN001A', status: 'issued' };
  const b = { shortName: '26测试MTN001B', status: 'reallocated', reallocationTargetShortName: '26其他MTN999' };
  assert.deepEqual(validateIssueGroup({ tranches: [a, b] }, a).tranches, [a]);
  b.reallocationTargetShortName = a.shortName;
  assert.deepEqual(validateIssueGroup({ tranches: [a, b] }, a).tranches, [a, b]);
});
test('normalized identity cannot silently change the requested bond', () => {
  const result = normalizeLookupPayload({ ok: true, normalized: bond, query: { shortName: '26测试03' } });
  assert.equal(result.ok, false);
  assert.match(result.identityError, /简称/);
  assert.equal(normalizeLookupPayload(result).identityError, result.identityError);
  assert.equal(normalizeLookupPayload({ normalized: bond, query: { fullName: bond.fullName } }).identityError, '');
});
test('only explicit DM cross-market aliases allow a code or name change', () => {
  const normalized = { ...bond, identityAliases: [{ shortName: '26跨市场05', securityId: '987005.IB' }] };
  assert.equal(normalizeLookupPayload({ normalized, query: { shortName: '26跨市场05', securityId: '987005.IB' } }).identityError, '');
  assert.match(normalizeLookupPayload({ normalized, query: { shortName: '26跨市场05', securityId: 'WRONG05.IB' } }).identityError, /代码/);
  assert.match(normalizeLookupPayload({ normalized, query: { shortName: '26跨市场06' } }).identityError, /简称/);
});
test('sanitization is idempotent and updates both payload group locations', () => {
  const payload = { ok: true, query: { shortName: bond.shortName }, normalized: { ...bond, issueGroup: { tranches: [bond, { shortName: '26测试03' }] } } };
  const clean = normalizeLookupPayload(payload);
  assert.deepEqual(clean, normalizeLookupPayload(clean));
  assert.deepEqual(clean.issueGroup, clean.normalized.issueGroup);
});

test('an issued base with a known code cannot be replaced by unproven uncoded A/B records', () => {
  const group = { tranches: [{ shortName: '26测试MTN001A' }, { shortName: '26测试MTN001B' }] };
  assert.equal(validateIssueGroup(group, { shortName: '26测试MTN001', securityId: '1.IB' }), null);
  assert.equal(validateIssueGroup(group, { shortName: '26测试MTN001' }), group);
});

test('explicit combined input cannot override a known issuer or date contradiction', () => {
  for (const conflict of [{ issuerName: '另一家公司' }, { subscribeDate: '2026-09-01' }]) {
    const group = { tranches: [bond, { ...bond, shortName: '26测试06', securityId: '123006.SH', ...conflict }] };
    assert.deepEqual(validateIssueGroup(group, bond, { shortName: '26测试05/06' }).tranches, [bond]);
  }
});

test('stale cloud anchor metadata cannot reintroduce a prior issuance around a correct code', () => {
  for (const stale of [{ subscribeDate: '2026-09-01' }, { fullName: '测试公司2026年公司债券(第一期)' }]) {
    const anchor = { ...bond, ...stale };
    const old = { ...anchor, shortName: '26测试03', securityId: '123003.SH' };
    assert.equal(validateIssueGroup({ tranches: [anchor, old] }, bond), null);
  }
});
