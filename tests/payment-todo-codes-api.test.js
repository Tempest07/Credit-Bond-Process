import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, matchPaymentTodoCodeRows } from '../functions/api/payment-todo/codes.js';
import { __test__ as dm } from '../functions/api/dm/lookup.js';

const secret = '1234567890abcdef';
const env = { INNO_APP_KEY: 'test', INNO_APP_SECRET: secret };
function request(body, headers = {}, url = 'http://127.0.0.1:8814/api/payment-todo/codes') {
  return new Request(url, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:8814', 'X-Bond-List': '1', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function dmResponse(rows) {
  return new Response(JSON.stringify({ data: dm.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data: rows }), secret) }));
}

test('payment code API retains the login, origin and module-header gates', async () => {
  assert.equal((await onRequestPost({ request: request({ names: ['测试'] }, {}, 'https://credit-bond-process.pages.dev/api/payment-todo/codes'), env })).status, 401);
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }, { 'X-Bond-List': '' }]) {
    assert.equal((await onRequestPost({ request: request({ names: ['测试'] }, headers), env })).status, 403);
  }
});

test('payment code API bounds the names and streamed body before querying DM', async () => {
  for (const body of [null, {}, { names: [] }, { names: '测试' }, { names: Array(21).fill('测试') },
    ...[null, 123, '', ' ', 'x'.repeat(121)].map(name => ({ names: [name] })),
    { names: ['测试'], extra: 'x'.repeat(20000) },
    ...[null, 'true', 1, {}, []].map(force => ({ names: ['测试'], force }))]) {
    assert.equal((await onRequestPost({ request: request(body), env })).status, 400);
  }
  const malformed = new Request('http://127.0.0.1:8814/api/payment-todo/codes', {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:8814', 'X-Bond-List': '1' }, body: '{',
  });
  assert.equal((await onRequestPost({ request: malformed, env })).status, 400);
  assert.equal((await onRequestPost({ request: request({ names: ['测试'] }), env: {} })).status, 503);
});

test('matching preserves tranche and BC identity while normalizing width, whitespace and case', () => {
  const names = ['26测试MTN001A', '26测试MTN001B', '26测试MTN001', '26测试（BC）', '26测试', '26测试（科创）'];
  const result = matchPaymentTodoCodeRows(names, [
    { sec_short_name: '２６测试 ｍｔｎ００１ａ', security_id: '102600001.IB' },
    { secShortName: '26测试MTN002B', securityId: '102600002.IB' },
    { secShortName: '26测试(BC)', securityId: '123456.SH' },
    { secShortName: '26测试', securityId: '123457.SH' },
  ]);
  assert.equal(result[names[0]].matches[0].code, '102600001.IB');
  assert.equal(result[names[1]].status, 'missing');
  assert.equal(result[names[2]].status, 'missing');
  assert.equal(result[names[3]].matches[0].code, '123456.SH');
  assert.equal(result[names[4]].matches[0].code, '123457.SH');
  assert.equal(result[names[5]].status, 'missing', 'another requested base name cannot satisfy an annotated name');
});

test('cancelled, failed and withdrawn issues never supply a payment code', () => {
  for (const fields of [
    { issueStatusDesc: '取消发行' }, { issue_status: '发行失败' },
    { issuance_status_desc: '流标' }, { issuanceStatus: 'withdrawn' },
    { secFullName: '测试债券（终止发行）' }, { sec_full_name: 'cancelled issue' },
  ]) {
    const row = { secShortName: '26测试MTN001', securityId: '102600001.IB', ...fields };
    assert.equal(matchPaymentTodoCodeRows(['26测试MTN001'], [row])['26测试MTN001'].status, 'missing');
  }
  const active = { secShortName: '26测试MTN001', securityId: '102600002.IB' };
  const result = matchPaymentTodoCodeRows(['26测试MTN001'], [
    { ...active, securityId: '102600001.IB', issue_status_desc: '取消发行' }, active,
  ]);
  assert.deepEqual(result['26测试MTN001'], { status: 'matched', matches: [{ code: '102600002.IB', name: '26测试MTN001', market: '' }] });
});

test('only a single valid complete code is accepted and duplicate rows are harmless', () => {
  const name = '26测试MTN001';
  const row = { secShortName: name, securityId: '102600001.IB' };
  assert.equal(matchPaymentTodoCodeRows([name], [row, { ...row }])[name].status, 'matched');
  assert.equal(matchPaymentTodoCodeRows([name], [row, { ...row, securityId: '123456.SH' }])[name].status, 'ambiguous');
  for (const securityId of ['', '102600001', '123456.HK', '12345.SH']) {
    assert.equal(matchPaymentTodoCodeRows([name], [{ ...row, securityId }])[name].status, 'error');
  }
  assert.equal(matchPaymentTodoCodeRows([name], [{ ...row, securityId: '102600001', secondary_market: '银行间' }])[name].matches[0].code, '102600001.IB');
  assert.equal(matchPaymentTodoCodeRows([name], [{ ...row, securityId: 'SH123456' }])[name].matches[0].code, '123456.SH');
  assert.throws(() => matchPaymentTodoCodeRows([name], [{ message: 'invalid upstream shape' }]));
});

test('API without a DB fixture queries basic-info in shared-deadline batches', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const names = Array.from({ length: 7 }, (_, index) => '26测试MTN00' + (index + 1));
  globalThis.fetch = async (url, init) => {
    assert.match(url, /\/bond\/basic-info\/info$/);
    assert.equal(init.headers['X-Dm-App-Key'], 'test');
    const body = JSON.parse(dm.sm4DecryptFromBase64Url(init.body, secret));
    assert.deepEqual(Object.keys(body), ['secShortNameList']);
    calls.push({ names: body.secShortNameList, signal: init.signal });
    return dmResponse(body.secShortNameList.map(name => ({ secShortName: name, securityId: '10260000' + (names.indexOf(name) + 1) + '.IB' })));
  };
  try {
    const response = await onRequestPost({ request: request({ names: [...names, names[0]] }), env });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const payload = await response.json();
    assert.equal(payload.source, 'DM');
    assert.ok(Number.isFinite(Date.parse(payload.fetchedAt)));
    assert.deepEqual(Object.keys(payload.results), names);
    assert.deepEqual(calls.map(call => call.names.length), [5, 2]);
    assert.deepEqual(calls.flatMap(call => call.names), names);
    assert.ok(calls[0].signal);
    assert.equal(calls[0].signal, calls[1].signal);
    assert.equal(payload.results[names[6]].matches[0].code, '102600007.IB');
  } finally { globalThis.fetch = original; }
});

test('one expired deadline stops further batches and returns no partial or sensitive results', async () => {
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  let calls = 0;
  AbortSignal.timeout = milliseconds => { assert.equal(milliseconds, 25000); return controller.signal; };
  globalThis.fetch = async () => {
    calls++;
    controller.abort(new Error('sensitive-timeout-detail'));
    return dmResponse([{ secShortName: '26测试1', securityId: '123456.SH' }]);
  };
  try {
    const response = await onRequestPost({ request: request({ names: Array.from({ length: 6 }, (_, i) => '26测试' + i) }), env });
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /sensitive|results|123456/);
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});

test('API redacts upstream exceptions and malformed payload details', async () => {
  const original = globalThis.fetch;
  try {
    for (const fetcher of [
      async () => { throw new Error('sensitive-upstream-token'); },
      async () => dmResponse([{ secret: 'sensitive-upstream-token' }]),
    ]) {
      globalThis.fetch = fetcher;
      const response = await onRequestPost({ request: request({ names: ['26测试MTN001'] }), env });
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /sensitive|upstream|token/);
    }
  } finally { globalThis.fetch = original; }
});
