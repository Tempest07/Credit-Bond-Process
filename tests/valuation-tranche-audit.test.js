import test from 'node:test';
import assert from 'node:assert/strict';
import { collectModelValuationEvidence, onRequestGet } from '../functions/api/dm/valuation.js';
import { __test__ as dmCrypto } from '../functions/api/dm/lookup.js';
import { buildCalculationEvidence, validateValuationOutput } from '../valuation-model.js';

const issuerName = '审计合成主体有限公司';
const bonds = [
  { securityId: '102600021.IB', secShortName: '26测试MTN021', issuerName, remainingTenor: '3Y',
    bondIssueTenor: '3+2Y', nextOptionDate: '2029-09-07', bondTypeDesc: '中期票据' },
  { securityId: '102600022.IB', secShortName: '26测试MTN022', issuerName, remainingTenor: '5Y',
    bondIssueTenor: '5Y', bondTypeDesc: '中期票据' },
];
function marketRows(ids) {
  return bonds.filter(bond => ids.includes(bond.securityId)).map(bond => ({
    ...bond, valuationDate: '2026-09-08', cbYtm: bond.securityId === bonds[0].securityId ? 3 : 2.5,
    cbYte: bond.securityId === bonds[0].securityId ? 2 : 1.5, cbReliability: '推荐',
  }));
}
function fakeDm() {
  return { async post(path, body) {
    if (path.endsWith('/outstanding-bonds') || path.endsWith('/info')) return bonds;
    if (path.endsWith('/date')) return marketRows(body.securityIdList);
    throw new Error(`Unexpected endpoint ${path}`);
  } };
}
function outputFor(evidence) {
  return { results: evidence.targets.map((target, targetIndex) => {
    const original = evidence.candidates.find(c => c.securityId === target.candidateSecurityIds[0]);
    return { targetIndex, center: original.rate, low: null, high: null, reasons: ['使用本品种同结构可比券'],
      limitations: ['本次为未调整期限参考'], excluded: [], comparables: [{ securityId: original.securityId, weight: 1,
        tenorAdjustmentBp: 0, marketAdjustmentBp: 0, adjustedYield: original.rate, rationale: '使用已提供的同口径估值',
        tenorBasis: { method: 'none', securityIds: [] } }] };
  }) };
}

test('F13 mixed exercise and ordinary targets have independent profiles, candidate pools and yield bases in either order', async () => {
  for (const durationText of ['3+2Y/5Y', '5Y/3+2Y']) {
    const evidence = await collectModelValuationEvidence(fakeDm(), {
      issuerName, shortName: '26测试MTN001A/B', durationText, offeringType: '公募', venue: '银行间',
    }, { now: new Date('2026-09-09T09:00:00Z') });
    assert.equal(evidence.candidates.length, 2);
    for (const target of evidence.targets) {
      assert.equal(target.profile.exercisable, target.hasExercise);
      assert.deepEqual(target.candidateSecurityIds, [bonds[target.hasExercise ? 0 : 1].securityId]);
      const candidate = evidence.candidates.find(c => c.securityId === target.candidateSecurityIds[0]);
      assert.equal(candidate.yieldBasis, target.hasExercise ? '行权收益率' : '到期收益率');
      assert.equal(candidate.rate, target.hasExercise ? 2 : 2.5);
    }
    const output = outputFor(evidence);
    assert.equal(validateValuationOutput(output, evidence).ok, true);
    for (const targetIndex of [0, 1]) {
      const poisoned = structuredClone(output);
      poisoned.results[targetIndex].comparables = structuredClone(output.results[1 - targetIndex].comparables);
      poisoned.results[targetIndex].center = output.results[1 - targetIndex].center;
      assert.equal(validateValuationOutput(poisoned, evidence).ok, false, durationText);
    }
    for (const aid of buildCalculationEvidence(evidence)) {
      assert.ok(evidence.targets[aid.targetIndex].candidateSecurityIds.includes(aid.securityId));
    }
  }
});

test('F13 legacy evidence with aggregate exercise profile is still checked against each explicit target', async () => {
  const evidence = await collectModelValuationEvidence(fakeDm(), {
    issuerName, shortName: '26测试MTN001A/B', durationText: '3+2Y/5Y', offeringType: '公募', venue: '银行间',
  }, { now: new Date('2026-09-09T09:00:00Z') });
  const output = outputFor(evidence);
  for (const target of evidence.targets) { delete target.profile; delete target.candidateSecurityIds; }
  assert.equal(validateValuationOutput(output, evidence).ok, true);
  const call = output.results[0];
  output.results[1] = { ...structuredClone(call), targetIndex: 1 };
  assert.equal(validateValuationOutput(output, evidence).ok, false);
});

test('F13 a plain target cannot use a YTE quote even when candidate flags claim it is plain', async () => {
  const evidence = await collectModelValuationEvidence(fakeDm(), {
    issuerName, shortName: '26测试MTN001', durationText: '5Y', offeringType: '公募', venue: '银行间',
  }, { now: new Date('2026-09-09T09:00:00Z') });
  assert.deepEqual(evidence.candidates.map(c => c.securityId), [bonds[1].securityId]);
  const output = outputFor(evidence);
  evidence.candidates[0].yieldBasis = '行权收益率';
  assert.equal(validateValuationOutput(output, evidence).ok, false);
});

test('F13 the authenticated valuation API filters the comparable set separately for both target tranches', async t => {
  const secret = '1234567890abcdef';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls += 1;
    const body = JSON.parse(dmCrypto.sm4DecryptFromBase64Url(init.body, secret));
    let data;
    if (String(url).endsWith('/outstanding-bonds') || String(url).endsWith('/info')) data = bonds;
    else if (String(url).endsWith('/date')) data = marketRows(body.securityIdList);
    else throw new Error(`Unexpected mocked endpoint ${url}`);
    return Response.json({ data: dmCrypto.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret) });
  });
  const query = new URLSearchParams({ issuerName, shortName: '26测试MTN001A/B', durationText: '3+2Y/5Y',
    offeringType: '公募', venue: '银行间', valuationDate: '2026-09-08' });
  const response = await onRequestGet({ env: { APP_PASSWORD: 'pw', INNO_APP_KEY: 'app', INNO_APP_SECRET: secret },
    request: new Request(`http://127.0.0.1:8788/api/dm/valuation?${query}`, { headers: { Authorization: 'Bearer pw' } }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.trancheSuggestions.length, 2);
  for (const suggestion of payload.trancheSuggestions) {
    const call = suggestion.index === 0;
    assert.equal(suggestion.preferredYield, call ? '行权收益率' : '到期收益率');
    assert.deepEqual(suggestion.comparableItems.map(c => c.securityId), [bonds[call ? 0 : 1].securityId]);
  }
  assert.ok(calls > 0);
});
