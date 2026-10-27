import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePaymentReceiptMatchAi, paymentReceiptMatchAiMessages, validatePaymentReceiptMatchAi,
  paymentReceiptMatchAiFingerprint } from '../payment-receipt-match-ai.js';

import { receipt, projects, output } from './helpers/payment-match-ai-fixture.js';

test('AI only sees bounded relevant real candidates and no raw account, credit or unrelated project material', () => {
  const prepared = preparePaymentReceiptMatchAi(receipt, projects);
  assert.deepEqual(prepared.candidates.map(value => [value.projectId, value.trancheId]), [['p1', 't1']]);
  const sent = JSON.stringify(paymentReceiptMatchAiMessages(prepared));
  assert.doesNotMatch(sent, /PRIVATE_|无关发行公司|p2/);
  assert.equal(prepared.receipt.amountYuan, '1000000.00');
  assert.equal(prepared.candidates[0].fields.winningAmountWan, '100');
});

test('code and market conflicts, invalid codes and already occupied targets are hard exclusions', () => {
  for (const securityCode of ['042600002.IB', '042600001.SZ', 'F042600001', '6222123456789012']) {
    assert.equal(preparePaymentReceiptMatchAi({ ...receipt, securityCode }, projects).candidates.length, 0, securityCode);
  }
  assert.equal(preparePaymentReceiptMatchAi(receipt, projects, { unavailableTargets: [{ projectId: 'p1', trancheId: 't1' }] }).candidates.length, 0);
  const noIdentity = { ...receipt, securityCode: '', bondShortName: '未识别', recognizedText: '' };
  assert.equal(preparePaymentReceiptMatchAi(noIdentity, projects).candidates.length, 0);
});

test('model IDs and every receipt/candidate quote must belong to the supplied actual evidence', () => {
  const prepared = preparePaymentReceiptMatchAi(receipt, projects);
  const valid = validatePaymentReceiptMatchAi(output, prepared);
  assert.equal(valid.recommendations[0].shortName, '26测试CP001');
  assert.equal(valid.recommendations[0].evidence[0].receiptLabel, '债券代码');
  for (const mutate of [
    value => { value.projectId = 'nonexistent'; },
    value => { value.trancheId = 'foreign-tranche'; },
    value => { value.evidence[0].receiptQuote = '042600009.IB'; },
    value => { value.evidence[0].candidateQuote = '042600009.IB'; },
    value => { value.evidence[0].receiptField = 'privateAccounts'; },
    value => { value.evidence = []; },
    value => { value.evidence = [{ receiptField: 'paymentDate', receiptQuote: '2026-10-27', candidateField: 'paymentDate', candidateQuote: '2026-10-27' }]; },
  ]) {
    const input = structuredClone(output); mutate(input.recommendations[0]);
    const result = validatePaymentReceiptMatchAi(input, prepared);
    assert.equal(result.recommendations.length, 0);
    assert.match(result.warnings.join(''), /已忽略/);
  }
  assert.throws(() => validatePaymentReceiptMatchAi({ recommendations: 'invalid' }, prepared));
});

test('fingerprints are stable for the same bounded input and change with evidence, candidates or versions', async () => {
  const prepared = preparePaymentReceiptMatchAi(receipt, projects);
  const first = await paymentReceiptMatchAiFingerprint(prepared, { revision: 1 });
  assert.equal(first, await paymentReceiptMatchAiFingerprint(structuredClone(prepared), { revision: 1 }));
  assert.notEqual(first, await paymentReceiptMatchAiFingerprint(prepared, { revision: 2 }));
  assert.notEqual(first, await paymentReceiptMatchAiFingerprint(preparePaymentReceiptMatchAi({ ...receipt, amountFen: 200000000 }, projects), { revision: 1 }));
});
