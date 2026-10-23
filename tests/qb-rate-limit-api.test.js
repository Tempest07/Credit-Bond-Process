import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as coupons } from '../functions/api/bond-list/coupons.js';
import { onRequestPost as valuations } from '../functions/api/bond-list/valuations.js';
import { onRequestPost as lookup } from '../functions/api/bond-list/lookup.js';
import { onRequestPost as paymentCodes } from '../functions/api/payment-todo/codes.js';
import { onRequestGet as curve } from '../functions/api/dm/curve.js';
import { onRequestGet as details } from '../functions/api/dm/lookup.js';
import { qbRateLimitResponse } from '../functions/api/qb/errors.js';

const origin = 'http://127.0.0.1:8814';
const env = { QB_ACCESS_KEY: 'fixture-key', BOND_DATA_SOURCE_MODE: 'qb' };
const cases = [
  ['coupons', coupons, { codes: ['012682405.IB'] }],
  ['valuations', valuations, { codes: ['012682405.IB'] }],
  ['lookup', lookup, { names: ['26测试SCP001'] }],
  ['codes', paymentCodes, { names: ['26测试SCP001'] }],
  ['curve?curve=cdb', curve],
  ['lookup?securityId=012682405.IB', details],
];

for (const businessStatus of [false, true]) {
  test(`QB ${businessStatus ? 'HTTP 200/body 429' : 'HTTP 429'} survives API boundaries without DM access or leaking body`, async () => {
    const saved = globalThis.fetch;
    try {
      for (const [path, handler, body] of cases) {
        let calls = 0;
        globalThis.fetch = async (url, options) => {
          calls++;
          assert.equal(new URL(url).origin, 'https://data-api.qeubee.cn');
          assert.equal(options.headers['X-Access-Key'], env.QB_ACCESS_KEY);
          return new Response(JSON.stringify({ code: 429, message: 'fixture-private-upstream-message' }), {
            status: businessStatus ? 200 : 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '17' },
          });
        };
        const request = new Request(`${origin}/api/${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { Origin: origin, 'X-Bond-List': '1', 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const response = await handler({ request, env });
        assert.equal(response.status, 429, path);
        assert.equal(response.headers.get('Retry-After'), '17');
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { source: 'QB', code: 'qb_rate_limited', error: 'QB 接口限流，请稍后重试。', retryAfter: 17 });
        assert.ok(calls > 0 && calls <= 4, `${path}: ${calls} requests`);
      }
    } finally { globalThis.fetch = saved; }
  });
}

test('QB API does not invent a retry window or convert unrelated failures into rate limiting', async () => {
  assert.equal(qbRateLimitResponse(new Error('timeout')), null);
  for (const retryAfter of [undefined, null, '', -1, 1.5, 'tomorrow', '17\r\nX-Test: unsafe', Number.MAX_SAFE_INTEGER + 1]) {
    const response = qbRateLimitResponse({ status: 429, retryAfter });
    assert.equal(response.headers.get('Retry-After'), null);
    assert.equal((await response.json()).retryAfter, undefined);
  }
});
