import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, matchCouponRows, normalizeCouponCode } from '../functions/api/bond-list/coupons.js';
import { __test__ as dm } from '../functions/api/dm/lookup.js';

const secret = '1234567890abcdef';
const env = { INNO_APP_KEY: 'test', INNO_APP_SECRET: secret };
function request(body, headers = {}, url = 'http://127.0.0.1:8814/api/bond-list/coupons') {
  return new Request(url, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:8814', 'X-Bond-List': '1', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('coupon API enforces the existing login, same-origin and module-header gates', async () => {
  const production = request({ codes: ['123456.SH'] }, {}, 'https://credit-bond-process.pages.dev/api/bond-list/coupons');
  assert.equal((await onRequestPost({ request: production, env })).status, 401);
  for (const headers of [{ Origin: 'https://evil.example' }, { 'X-Bond-List': '' }]) {
    assert.equal((await onRequestPost({ request: request({ codes: ['123456.SH'] }, headers), env })).status, 403);
  }
});

test('coupon API bounds the batch and requires an explicit valid market code', async () => {
  const invalid = [
    null, {}, { codes: [] }, { codes: '123456.SH' },
    { codes: Array.from({ length: 21 }, () => '123456.SH') },
    ...['123456', 'SH123456', '123456.HK', '12345.SH', '1234567890123.SH', '12345.IB', '1234567890123.IB', '123456.SH\nx', '__proto__', 123456, null].map(code => ({ codes: [code] })),
  ];
  for (const body of invalid) {
    assert.equal((await onRequestPost({ request: request(body), env })).status, 400);
  }
  const tooLarge = request({ codes: ['123456.SH'], extra: 'x'.repeat(10000) });
  assert.equal((await onRequestPost({ request: tooLarge, env })).status, 400);
  assert.equal(normalizeCouponCode(' 012682405.ib '), '012682405.IB');
  assert.equal(normalizeCouponCode('123456.BJ'), '123456.BJ');
  assert.equal(normalizeCouponCode('256800002.SH'), '256800002.SH');
});

test('coupon API reports absent DM configuration without starting a lookup', async () => {
  const result = await onRequestPost({ request: request({ codes: ['123456.SH'] }), env: {} });
  assert.equal(result.status, 503);
});

test('coupon API uses encrypted DM basic-info and documented coupon/classification fields', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.match(url, /\/bond\/basic-info\/info$/);
    assert.deepEqual(JSON.parse(dm.sm4DecryptFromBase64Url(init.body, secret)), {
      securityIdList: ['123456.SH', '102600001.IB'],
      fieldNames: ['securityId', 'secShortName', 'newCoupRate', 'rateTypeParDesc', 'bondTypeDesc', 'specialItem', 'paymentOrder'],
    });
    assert.equal(init.headers['X-Dm-App-Key'], 'test');
    assert.ok(init.signal);
    return new Response(JSON.stringify({ data: dm.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data: [
      { securityId: '123456.SH', secShortName: '26测试01', newCoupRate: 2.5, issCoupRate: 4.8, rateTypeParDesc: '固定利率', bondTypeDesc: '公司债券' },
      { security_id: '102600001.IB', sec_short_name: '26测试MTN001', new_coup_rate: '0', rate_type_par_desc: '零息' },
      { securityId: '999999.SH', newCoupRate: 9.9 },
    ] }), secret) }));
  };
  try {
    const result = await onRequestPost({ request: request({ codes: ['123456.sh', '102600001.IB', '123456.SH'] }), env });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    const payload = await result.json();
    assert.equal(payload.source, 'DM');
    assert.match(payload.sourcePath, /\/bond\/basic-info\/info$/);
    assert.ok(Number.isFinite(Date.parse(payload.fetchedAt)));
    assert.deepEqual(Object.keys(payload.results), ['123456.SH', '102600001.IB']);
    assert.deepEqual(payload.results['123456.SH'], {
      status: 'matched', couponRate: 2.5, name: '26测试01', rateType: '固定利率',
      bondType: '公司债', attributes: [], typeDescription: '公司债券',
    });
    assert.equal(payload.results['102600001.IB'].couponRate, 0);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('coupon matching never associates another venue or a partial code', () => {
  const result = matchCouponRows(['123456.SH', '123456.SZ'], [
    { securityId: '123456.IB', newCoupRate: 3 },
    { securityId: '123456', newCoupRate: 4 },
    { securityId: '123456.SH', security_id: '123456.SZ', newCoupRate: 5 },
    { securityId: '123456.SZ', newCoupRate: 2.75 },
  ]);
  assert.equal(result['123456.SH'].status, 'missing');
  assert.equal(result['123456.SH'].reason, 'not_found');
  assert.equal(result['123456.SZ'].couponRate, 2.75);
  const longCode = matchCouponRows(['256800002.SH'], [
    { securityId: '256800002.IB', newCoupRate: 4.5 },
    { security_id: '256800002.SH', sec_short_name: '26锡城02', new_coup_rate: 1.68 },
  ]);
  assert.deepEqual(longCode['256800002.SH'], {
    status: 'matched', couponRate: 1.68, name: '26锡城02', rateType: '',
    bondType: '未知', attributes: [], typeDescription: '',
  });
});

test('coupon matching keeps percent values and zero without guessing units', () => {
  for (const [raw, expected] of [[0, 0], ['0.00', 0], [2.5, 2.5], [' 2.5000% ', 2.5], [0.025, 0.025]]) {
    assert.equal(matchCouponRows(['123456.SH'], [{ securityId: '123456.SH', newCoupRate: raw }])['123456.SH'].couponRate, expected);
  }
});

test('coupon matching never substitutes issuance, quote, discount yield or floating formulas', () => {
  for (const raw of [undefined, null, '', ' ', '-', 'N/A', true, -1, 'LPR+50BP', '2%-3%', '2,50', Infinity]) {
    const item = matchCouponRows(['123456.SH'], [{
      securityId: '123456.SH', newCoupRate: raw, issCoupRate: 4.8,
      couponRate: 3, issueRate: 4, refYield: 2, rateTypeParDesc: '浮动利率',
    }])['123456.SH'];
    assert.equal(item.status, 'missing');
    assert.equal(item.reason, 'coupon_unavailable');
    assert.equal(item.couponRate, null);
    assert.equal(item.rateType, '浮动利率');
  }
  const floating = matchCouponRows(['123456.SH'], [{ securityId: '123456.SH', newCoupRate: 2.4, rateTypeParDesc: '浮动利率' }])['123456.SH'];
  assert.equal(floating.status, 'matched');
  assert.equal(floating.couponRate, 2.4);
});

test('coupon matching rejects contradictory rows and contradictory coupon aliases', () => {
  const row = { securityId: '123456.SH', newCoupRate: 2.5, secShortName: '26测试01' };
  assert.equal(matchCouponRows(['123456.SH'], [row, { ...row }])['123456.SH'].status, 'matched');
  for (const changed of [{ ...row, newCoupRate: 2.6 }, { ...row, secShortName: '另一只债' }, { ...row, newCoupRate: undefined }]) {
    assert.equal(matchCouponRows(['123456.SH'], [row, changed])['123456.SH'].reason, 'ambiguous');
  }
  assert.equal(matchCouponRows(['123456.SH'], [{ ...row, new_coup_rate: 3 }])['123456.SH'].reason, 'coupon_unavailable');
  assert.throws(() => matchCouponRows(['123456.SH'], [null]));
});

test('bond classification uses DM type descriptions and retains the source description', () => {
  const cases = [
    ['超短期融资券', 'SCP'], ['SCP', 'SCP'], ['短期融资券', 'CP'], ['CP', 'CP'],
    ['中期票据', 'MTN'], ['MTN', 'MTN'], ['定向工具', 'PPN'], ['非公开定向债务融资工具', 'PPN'],
    ['公司债券', '公司债'], ['非公开发行公司债券', '公司债'], ['企业债券', '企业债'],
    ['金融债券', '金融债'], ['商业银行债', '金融债'], ['政策性银行债券', '金融债'],
    ['商业银行二级资本债券', '金融债'], ['证券公司债券', '金融债'], ['保险公司资本补充债券', '金融债'],
    ['总损失吸收能力非资本债券', '金融债'], ['TLAC非资本债券', '金融债'],
    ['资产支持证券', 'ABS'], ['资产支持票据', 'ABS'], ['资产支持商业票据', 'ABS'], ['ABN', 'ABS'],
    ['国债', '政府债'], ['记账式附息国债', '政府债'], ['地方政府专项债券', '政府债'],
    ['可转换债券', '其他'], ['同业存单', '其他'],
    ['', '未知'], ['未知', '未知'], ['--', '未知'], ['公司债券/中期票据', '未知'], ['公司债券/金融债券', '未知'],
  ];
  for (const [description, expected] of cases) {
    const item = matchCouponRows(['123456.SH'], [{ securityId: '123456.SH', newCoupRate: 2, bondTypeDesc: description }])['123456.SH'];
    assert.equal(item.bondType, expected, description);
    assert.equal(item.typeDescription, description);
  }
});

test('bond type remains available without a coupon and never comes from security names', () => {
  const result = matchCouponRows(['123456.SH', '102600001.IB', '102600002.IB'], [
    { securityId: '123456.SH', bond_type_desc: '公司债券', special_item: '发行人续期选择权' },
    { securityId: '102600001.IB', secShortName: '26测试MTN001(永续/TLAC)', secFullName: '二级资本债券', newCoupRate: 2 },
  ]);
  assert.equal(result['123456.SH'].status, 'missing');
  assert.equal(result['123456.SH'].reason, 'coupon_unavailable');
  assert.equal(result['123456.SH'].bondType, '公司债');
  assert.deepEqual(result['123456.SH'].attributes, ['永续']);
  assert.equal(result['102600001.IB'].bondType, '未知');
  assert.deepEqual(result['102600001.IB'].attributes, []);
  assert.equal(result['102600002.IB'].reason, 'not_found');
  assert.equal(result['102600002.IB'].bondType, '未知');
});

test('independent attributes require explicit affirmative DM classification or terms evidence', () => {
  const cases = [
    [{ bondTypeDesc: '商业银行无固定期限债券' }, ['永续']],
    [{ bondTypeDesc: '可续期公司债券' }, ['永续']],
    [{ bondTypeDesc: '证券公司永续次级债券' }, ['永续']],
    [{ bondTypeDesc: '商业银行二级资本债券' }, ['二级资本']],
    [{ bondTypeDesc: 'TLAC非资本债券' }, ['TLAC']],
    [{ paymentOrder: '二级资本债券' }, ['二级资本']],
    [{ specialItem: '发行人续期选择权；TLAC条款' }, ['永续', 'TLAC']],
    [{ special_item: '总损失吸收能力条款' }, ['TLAC']],
    [{ paymentOrder: '次级债权', specialItem: '投资者回售选择权、调整票面利率选择权、递延付息' }, []],
    [{ specialItem: '非永续，不属于二级资本，不涉及TLAC' }, []],
    [{ specialItem: '无发行人续期选择权；TLAC：否；二级资本不适用' }, []],
  ];
  for (const [fields, expected] of cases) {
    const item = matchCouponRows(['123456.SH'], [{ securityId: '123456.SH', ...fields }])['123456.SH'];
    assert.deepEqual(item.attributes, expected, JSON.stringify(fields));
  }
});

test('contradictory DM classification aliases or records fail closed', () => {
  const row = { securityId: '123456.SH', newCoupRate: 2, bondTypeDesc: '中期票据' };
  const cases = [
    [row, { ...row, bondTypeDesc: '公司债券' }],
    [{ ...row, bond_type_desc: '公司债券' }],
    [{ ...row, specialItem: '发行人续期选择权', special_item: '无特殊条款' }],
    [{ ...row, paymentOrder: '普通债权', payment_order: '二级资本债券' }],
    [{ ...row, bondTypeDesc: 8 }],
  ];
  for (const rows of cases) {
    const item = matchCouponRows(['123456.SH'], rows)['123456.SH'];
    assert.equal(item.status, 'missing');
    assert.equal(item.reason, 'ambiguous');
    assert.equal(item.couponRate, null);
    assert.equal(item.bondType, '未知');
    assert.deepEqual(item.attributes, []);
  }
});

test('coupon API redacts upstream failure details', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('sensitive-token-must-not-leak'); };
  try {
    const result = await onRequestPost({ request: request({ codes: ['123456.SH'] }), env });
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /sensitive-token/);
  } finally { globalThis.fetch = original; }
});
