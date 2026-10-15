import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, __test__ } from '../functions/api/dm/lookup.js';

const issuer = '湖北交通投资集团有限公司';
const row = (serial, date) => ({
  sec_short_name: `26鄂交${serial}`, security_id: `TEST${serial}.SH`,
  issuer_name: issuer, issuer_full_name: issuer,
  ...(date ? { subscribe_date: date } : {}),
});

async function lookup(t, basic, primary, projects = [], query = '26鄂交05') {
  const secret = '1234567890abcdef';
  t.mock.method(globalThis, 'fetch', async url => {
    const data = url.includes('/bond/basic-info/info') ? basic
      : url.includes('/bond/primary/data') ? { list: primary } : [];
    return new Response(JSON.stringify({ data: __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret) }));
  });
  const response = await onRequestGet({
    env: { APP_PASSWORD: 'pw', INNO_APP_KEY: 'app', INNO_APP_SECRET: secret,
      DB: { prepare() { return { bind() { return this; }, async first() { return { data: JSON.stringify({ projects, issuers: [] }) }; } }; } },
    },
    request: new Request(`http://127.0.0.1/api/dm/lookup?${new URLSearchParams({ shortName: query })}`, {
      headers: { Authorization: 'Bearer pw' },
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('26鄂交05 with sparse basic data does not inherit older 03/04 tranches', async t => {
  const payload = await lookup(t, [row('05')], [row('03', '2026-09-15'), row('04', '2026-09-15')]);
  assert.equal(payload.normalized.shortName, '26鄂交05');
  assert.equal(payload.issueGroup, null);
});

test('missing issuance dates cannot establish that adjacent exchange serials are siblings', async t => {
  const payload = await lookup(t, [row('05')], [row('03'), row('04'), row('05')]);
  assert.equal(payload.normalized.shortName, '26鄂交05');
  assert.equal(payload.issueGroup, null);
});

test('same issue full name, issuer and date establish 05/06 while excluding old 03/04', async t => {
  const fullName = '湖北交通投资集团有限公司2026年公司债券(第二期)';
  const current = { ...row('05', '2026-10-15'), sec_full_name: fullName };
  const sibling = { ...row('06', '2026-10-15'), sec_full_name: fullName };
  const payload = await lookup(t, [current], [row('03', '2026-09-15'), row('04', '2026-09-15'), current, sibling]);
  assert.deepEqual(payload.issueGroup.tranches.map(item => item.shortName), ['26鄂交05', '26鄂交06']);
});

test('same issuer and day alone cannot combine adjacent serials', async t => {
  const payload = await lookup(t, [row('05')], [row('05', '2026-10-15'), row('06', '2026-10-15')]);
  assert.equal(payload.issueGroup, null);
});

test('same short name with a conflicting primary code cannot contaminate basic identity or fields', async t => {
  const payload = await lookup(t, [row('05')], [{ ...row('05', '2026-10-15'), security_id: 'WRONG01.SH', bond_issue_tenor: '30Y' }]);
  assert.equal(payload.normalized.securityId, 'TEST05.SH');
  assert.notEqual(payload.normalized.durationText, '30Y');
});

test('a cloud group containing the target plus unproven older siblings cannot overwrite it', async t => {
  const payload = await lookup(t, [row('05', '2026-10-15')], [], [{
    shortName: '26鄂交03/04/05', issuerName: issuer,
    tranches: ['03', '04', '05'].map(serial => ({ shortName: `26鄂交${serial}`, securityCode: `TEST${serial}.SH`, durationText: '10Y' })),
  }]);
  assert.equal(payload.issueGroup, null);
  assert.equal(payload.normalized.shortName, '26鄂交05');
});

test('same-name cloud code conflicts never match or fill target fields', async t => {
  const payload = await lookup(t, [row('05')], [], [{ shortName: '26鄂交05/06', issuerName: issuer,
    tranches: [{ shortName: '26鄂交05', securityCode: 'WRONG01.SH' }, { shortName: '26鄂交06', securityCode: 'WRONG02.SH' }],
  }]);
  assert.equal(payload.issueGroup, null);
});

test('multiple active codes for an exact short name require selection instead of picking the first', async t => {
  const payload = await lookup(t, [row('05'), { ...row('05'), security_id: 'OTHER05.SZ' }], []);
  assert.equal(payload.ok, false);
  assert.equal(payload.requiresSelection, true);
  assert.equal(payload.suggestions.length, 2);
  assert.equal(payload.normalized, undefined);
});

test('missing result fields never prove a full reallocation', async t => {
  const a = { sec_short_name: '26测试MTN001A', security_id: '1.IB', issuer_name: issuer };
  const payload = await lookup(t, [a], [], [{ shortName: '26测试MTN001A/B', issuerName: issuer, resultConfirmed: true,
    tranches: [{ shortName: a.sec_short_name, securityCode: '1.IB' },
      { shortName: '26测试MTN001B', securityCode: '2.IB', actualScale: 10, winningRate: 2 }],
  }], a.sec_short_name);
  assert.equal(payload.issueGroup.tranches[0].status, 'unknown');
  assert.equal(payload.issueGroup.tranches[0].reallocationTargetShortName, '');
});

test('historical opinion containing the current full name cannot replace 05 with cloud 03/04', async t => {
  const fullName = '湖北交通投资集团有限公司2026年面向专业投资者公开发行公司债券(第二期)';
  const current = { ...row('05', '2026-10-15'), sec_full_name: fullName };
  const payload = await lookup(t, [current], [current], [{
    id: 'old-issue', shortName: '26鄂交03/04', issuerName: issuer,
    cutoffAt: '2026-09-21T18:00', opinion: `申请投资${fullName}。`,
    tranches: [{ shortName: '26鄂交03', securityCode: '525023.SZ', winningRate: 1.72 },
      { shortName: '26鄂交04', securityCode: '525024.SZ', winningRate: 2.03 }],
  }]);
  assert.equal(payload.ok, true);
  assert.equal(payload.normalized.shortName, '26鄂交05');
  assert.equal(payload.normalized.subscribeDate, '2026-10-15');
  assert.equal(payload.issueGroup, null);
});
