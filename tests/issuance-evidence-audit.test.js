import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemanticResult } from '../issuance-recognition.js';
import { applySemanticIssuanceResult, normalizeProjectRecord } from '../lifecycle.js';
import { onRequestPost } from '../functions/api/issuance-results/recognize.js';

const A = '26测试MTN001A', B = '26测试MTN001B';
const tranches = [{ id: 'a', shortName: A }, { id: 'b', shortName: B }];
const makeRequest = text => ({ text, noticeDate: '2026-10-25', tranches });
const issued = (name, source, rate, evidence = `票面${rate}`) => ({ shortName: name, sourceText: source,
  outcome: 'issued', fields: { couponRate: { raw: rate, evidence } } });
const savedProject = () => normalizeProjectRecord({ id: 'p', shortName: `${A}/B`, tranches: tranches.map(t => ({
  ...t, winningRate: 1.7, winningAmountWan: 1000, paymentDate: '2026-10-26', paymentCompleted: true,
})) });

test('F05 a numeric quote cropped out of another tranche cannot become shared evidence', () => {
  for (const separator of ['；', '，', '\n', '\n\n']) {
    const sourceA = `${A}，票面1.70%`, sourceB = `${B}，票面2.30%`;
    const request = makeRequest(sourceA + separator + sourceB);
    for (const sharedEvidence of [['票面2.30%'], ['2.30%'], [sourceB]]) {
      const model = { sharedEvidence, items: [issued(A, sourceA, '2.30%', '票面2.30%')] };
      const result = validateSemanticResult(request, model);
      assert.equal(result.canApply, false, `${separator}:${sharedEvidence}`);
      assert.equal(result.items[0].couponRate, null);
      assert.equal(result.needsModelRepair, true);
      const project = savedProject(), before = structuredClone(project);
      assert.throws(() => applySemanticIssuanceResult(project, result, request.text));
      assert.deepEqual(project, before);
    }
  }
});

test('F05 explicit code or market conflicts veto application even when the model omits the code field', () => {
  const shortName = '26测试01';
  for (const securityCode of ['246130.SH', '246129.SZ', '246130.SZ', '２４６１２９ ． ＳＺ']) {
    for (const identifier of [`证券代码${securityCode}`, `（${securityCode}）`]) {
      const text = `${shortName}，${identifier}，票面2.30%`;
      const request = { text, noticeDate: '2026-10-25', tranches: [{ id: 'a', shortName, securityCode: '246129.SH' }] };
      for (const omitCode of [false, true]) {
        const item = issued(shortName, text, '2.30%');
        if (!omitCode) item.fields.securityCode = { raw: securityCode, evidence: identifier };
        const parsed = validateSemanticResult(request, { items: [item] });
        assert.equal(parsed.canApply, false, `${identifier}, omit=${omitCode}`);
        assert.match(parsed.errors.join('；'), /券码|交易市场/);
        const project = normalizeProjectRecord({ id: 'p', shortName, tranches: [
          { id: 'a', shortName, securityCode: '246129.SH', winningRate: 1.7, winningAmountWan: 1000 },
        ] });
        const before = structuredClone(project);
        assert.throws(() => applySemanticIssuanceResult(project, parsed, text));
        assert.deepEqual(project, before);
      }
    }
  }
});

test('F05 bare and full matching codes remain compatible and a transfer destination keeps its own code', () => {
  const shortName = '26测试01';
  for (const [targetCode, sourceCode] of [['246129.SH', '246129'], ['246129', '246129.SH'], ['246129.SH', '246129.SH']]) {
    const text = `${shortName}，证券代码${sourceCode}，票面2.30%`;
    const request = { text, noticeDate: '2026-10-25', tranches: [{ id: 'a', shortName, securityCode: targetCode }] };
    for (const omitCode of [false, true]) {
      const item = issued(shortName, text, '2.30%');
      if (!omitCode) item.fields.securityCode = { raw: sourceCode, evidence: `证券代码${sourceCode}` };
      const parsed = validateSemanticResult(request, { items: [item] });
      assert.equal(parsed.canApply, true, parsed.errors.join('；'));
    }
  }
  const text = `${A}，证券代码246129.SH，全部回拨至${B}（246130.SH）`;
  const request = { text, noticeDate: '2026-10-25', tranches: [
    { ...tranches[0], securityCode: '246129.SH' }, { ...tranches[1], securityCode: '246130.SH' },
  ] };
  const parsed = validateSemanticResult(request, { items: [{ shortName: A, sourceText: text,
    outcome: 'reallocated', outcomeEvidence: `全部回拨至${B}（246130.SH）`, fields: {} }] });
  assert.equal(parsed.canApply, true, parsed.errors.join('；'));
});

test('F05 cropped model source and shared fields cannot hide original code or market conflicts', () => {
  const shortName = '26测试01';
  for (const securityCode of ['246129.SZ', '246130.SH']) {
    for (const identifier of [`证券代码${securityCode}`, `（${securityCode}）`]) {
      for (const text of [`${shortName}，${identifier}，票面2.30%`, `${identifier}，${shortName}，票面2.30%`,
        `${identifier}\n${shortName}，票面2.30%`, `${shortName}，票面2.30%\n${identifier}`]) {
        const request = { text, noticeDate: '2026-10-25', tranches: [{ id: 'a', shortName, securityCode: '246129.SH' }] };
        for (const sourceText of [shortName, text.endsWith(`${shortName}，票面2.30%`) ? `${shortName}，票面2.30%` : shortName]) {
          const model = { sharedEvidence: ['票面2.30%'], items: [issued(shortName, sourceText, '2.30%')] };
          const parsed = validateSemanticResult(request, model);
          assert.equal(parsed.canApply, false, text);
          assert.match(parsed.errors.join('；'), /券码|交易市场/);
          const before = normalizeProjectRecord({ id: 'p', shortName, tranches: [{ id: 'a', shortName,
            securityCode: '246129.SH', winningRate: 1.7, winningAmountWan: 1000 }] });
          const project = structuredClone(before);
          assert.throws(() => applySemanticIssuanceResult(project, parsed, text));
          assert.deepEqual(project, before);
        }
      }
    }
  }
});

test('F05 explicit common fields retain each named tranche identity instead of comparing all sibling codes to one target', () => {
  const pricing = `${A}（246129.SH）、${B}（246130.SH）票面均为1.70%`;
  const request = { text: pricing, noticeDate: '2026-10-25', tranches: [
    { ...tranches[0], securityCode: '246129.SH' }, { ...tranches[1], securityCode: '246130.SH' },
  ] };
  const result = validateSemanticResult(request, { sharedEvidence: [pricing], items: [
    issued(A, `${A}（246129.SH）`, '1.70%', '票面均为1.70%'), issued(B, `${B}（246130.SH）`, '1.70%', '票面均为1.70%'),
  ] });
  assert.equal(result.canApply, true, result.errors.join('；'));
  assert.deepEqual(result.items.map(item => item.couponRate), [1.7, 1.7]);
});

test('F05 multiple named-owner scopes retain codes on separate lines and cannot swap known identities', () => {
  const targets = [{ id: 'a', shortName: '26测试01A', securityCode: '246129.SH' },
    { id: 'b', shortName: '26测试01B', securityCode: '246130.SH' }];
  const shared = '两个品种票面均2.30%';
  for (const [aCode, bCode] of [['246129.SZ', '246130.SH'], ['246130.SH', '246129.SH']]) {
    const text = `26测试01A\n证券代码${aCode}\n26测试01B\n证券代码${bCode}\n${shared}`;
    for (const source of ['26测试01A', `26测试01A\n证券代码${aCode}`]) {
      const parsed = validateSemanticResult({ text, tranches: targets, noticeDate: '2026-10-25' }, {
        sharedEvidence: [shared], items: [issued('26测试01A', source, '2.30%', '票面均2.30%')],
      });
      assert.equal(parsed.canApply, false, `${aCode}/${bCode}/${source}`);
      const project = normalizeProjectRecord({ id: 'p', shortName: '26测试01A/B', tranches: targets.map(t => ({ ...t, winningRate: 1.7 })) });
      const before = structuredClone(project);
      assert.throws(() => applySemanticIssuanceResult(project, parsed, text));
      assert.deepEqual(project, before);
    }
  }
  const text = `26测试01A\n证券代码246129.SH\n26测试01B\n证券代码246130.SH\n${shared}`;
  const parsed = validateSemanticResult({ text, tranches: targets, noticeDate: '2026-10-25' }, {
    sharedEvidence: [shared], items: [issued('26测试01A', '26测试01A\n证券代码246129.SH', '2.30%', '票面均2.30%')],
  });
  assert.equal(parsed.canApply, true, parsed.errors.join('；'));
});

test('F05 a different tranche cancellation remains visible inside the outcome evidence', () => {
  for (const outcome of ['cancelled', 'reallocated']) {
    const fact = outcome === 'cancelled' ? `${B}取消发行` : `${B}全部回拨至A`;
    const request = makeRequest(`${A}正常发行，${fact}。`);
    const result = validateSemanticResult(request, { items: [{ shortName: A, sourceText: request.text,
      outcome, outcomeEvidence: fact, fields: {} }] });
    assert.equal(result.canApply, false, outcome);
    assert.match(result.errors.join('；'), /其他品种|本品种/);
    assert.throws(() => applySemanticIssuanceResult(savedProject(), result, request.text));
    const onlyA = validateSemanticResult({ ...request, tranches: [tranches[0]] }, { items: [{
      shortName: A, sourceText: request.text, outcome, outcomeEvidence: fact, fields: {},
    }] });
    assert.equal(onlyA.canApply, false, 'an unselected bond in the notice still cannot cancel the selected bond');
  }
});

test('F05 a transfer recipient cannot be treated as the tranche that has stopped issuing', () => {
  const source = `${A}全部回拨至${B}`;
  const request = makeRequest(source);
  assert.equal(validateSemanticResult(request, { items: [{ shortName: B, sourceText: source,
    outcome: 'reallocated', outcomeEvidence: source, fields: {} }] }).canApply, false);
  const valid = validateSemanticResult(request, { items: [{ shortName: A, sourceText: source,
    outcome: 'reallocated', outcomeEvidence: `全部回拨至${B}`, fields: {} }] });
  assert.equal(valid.canApply, true, valid.errors.join('；'));
  const before = savedProject();
  const updated = applySemanticIssuanceResult(before, valid, request.text);
  assert.equal(updated.tranches[0].winningAmountWan, 0);
  assert.equal(updated.tranches[0].paymentDate, '');
  assert.deepEqual(updated.tranches[1], before.tranches[1]);
});

test('F05 explicit common pricing and dates still apply to both named tranches', () => {
  const sourceA = `${A}，实际2亿元`, sourceB = `${B}，实际3亿元`;
  const pricing = 'A、B票面均为1.70%', payment = '两个品种统一于2026年10月26日缴款';
  const request = makeRequest(`${sourceA}；${sourceB}。${pricing}。${payment}。`);
  const model = { sharedEvidence: [pricing, payment], items: [
    issued(A, sourceA, '1.70%', '票面均为1.70%'), issued(B, sourceB, '1.70%', '票面均为1.70%'),
  ] };
  for (const item of model.items) item.fields.paymentDate = { raw: '2026年10月26日', evidence: payment };
  const result = validateSemanticResult(request, model);
  assert.equal(result.canApply, true, result.errors.join('；'));
  assert.deepEqual(result.items.map(item => item.couponRate), [1.7, 1.7]);
  assert.deepEqual(result.items.map(item => item.paymentDate), ['2026-10-26', '2026-10-26']);
});

test('F05 a shared issue statement does not turn later private rates into common prices', () => {
  const sourceA = `${A}，票面1.70%`;
  const shared = `A、B均正常发行，${A}票面1.70%，${B}票面2.30%`;
  const request = makeRequest(`${sourceA}。${shared}。`);
  const result = validateSemanticResult(request, { sharedEvidence: [shared], items: [issued(A, sourceA, '2.30%')] });
  assert.equal(result.canApply, false);
  const wholeNotice = `${sourceA}；${B}票面2.30%。两个品种统一于2026年10月26日缴款。`;
  for (const evidence of ['票面2.30%', wholeNotice]) {
    const wrong = validateSemanticResult(makeRequest(wholeNotice), { sharedEvidence: [wholeNotice],
      items: [issued(A, sourceA, '2.30%', evidence)] });
    assert.equal(wrong.canApply, false, evidence);
  }
});

test('F05 an A tranche cannot borrow an AB tranche source by name-prefix matching', () => {
  const request = makeRequest('26测试MTN001AB，票面2.30%');
  const result = validateSemanticResult(request, { items: [issued(A, request.text, '2.30%')] });
  assert.equal(result.canApply, false);
});

test('F05 the real recognition API repairs once and still blocks cross-tranche evidence before application', async () => {
  const sourceA = `${A}，票面1.70%`, request = makeRequest(`${sourceA}；${B}，票面2.30%。`);
  const model = { sharedEvidence: ['票面2.30%'], items: [issued(A, sourceA, '2.30%')] };
  let calls = 0;
  const response = await onRequestPost({ env: { AI: { async run() {
    calls += 1;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(model) } }] };
  } } }, request: new Request('http://localhost/api/issuance-results/recognize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(calls, 2);
  assert.equal(result.canApply, false);
  assert.throws(() => applySemanticIssuanceResult(savedProject(), result, request.text));
});
