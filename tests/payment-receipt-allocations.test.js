import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readPaymentReceiptAllocations, expandPaymentReceiptAllocationGroup } from '../payment-receipt-allocations.js';
import { selectPaymentReceiptMatch } from '../payment-receipts.js';
import { paymentReceiptSourceCodes } from '../payment-receipt-security.js';

// The native-table layout and rows reproduce the existing Qingxin page. Only
// the public bond fields are retained; bank/contact details are unnecessary.
const TABLE = `青岛国信发展(集团)有限责任公司2026年面向专业投资者公开发行公司债券(第四期)配售确认及缴款通知书
债券简称 债券代码 发行规模 (万
元) 期限 票面利率 /
价格
获配面值
(万元)
缴款金额
(万元)
26 青信 07 245774.SH 74,000.00 5 年 1.88% 10,000.00 10,000.00
26 青信 08 245775.SH 26,000.00 10 年 2.40% 5,000.00 5,000.00
请贵公司将上述应缴款项于 2026 年 07 月 29 日 15:00 前划至簿记管理人指定账户。
请注明“26青信0708缴款机构简称”。`;
const structured = [
  { name: '26青信07', code: '245774.SH', amountWan: 10000, coupon_rate: '1.88%', tenor: '5年' },
  { name: '26青信08', code: '245775.SH', amount_text: '5,000.00万元', coupon_rate: 2.4, tenor: '10年' },
];
const page = fields => ({ pageNumber: 1, classification: 'receipt_start', recognizedText: TABLE, fields: fields || {} });
const group = { pageNumbers: [1], pageLabel: '1', index: 0 };

test('the actual two-row native table keeps each payment amount separate from issuance size and the following row', () => {
  const rows = readPaymentReceiptAllocations(TABLE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.bondShortName, row.securityCode, row.amountFen, row.paymentDate, row.couponRate, row.tenor]), [
    ['26青信07', '245774.SH', 10000000000, '2026-07-29', '1.88%', '5 年'],
    ['26青信08', '245775.SH', 5000000000, '2026-07-29', '2.40%', '10 年'],
  ]);
  assert.ok(rows.every(row => !row.requiresReview));
});

test('new AI allocations arrays override inconsistent main-page fields without borrowing another row amount', () => {
  const rows = readPaymentReceiptAllocations('', { bondShortName: '26青信07', securityCode: '245774.SH', amountFen: 5000000000,
    paymentDate: '2026-07-29', allocations: structured });
  assert.deepEqual(rows.map(row => [row.bondShortName, row.securityCode, row.amountFen]), [
    ['26青信07', '245774.SH', 10000000000], ['26青信08', '245775.SH', 5000000000],
  ]);
});

test('a new snake-case AI response accepts shared date and literal per-row name/code/amount fields', () => {
  const rows = readPaymentReceiptAllocations('', { payment_date: '2026年7月29日', allocations: [
    { bond_short_name: '26 青信 07', security_code: '245774.SH', amount_text: '10,000.00万元' },
    { bond_short_name: '26 青信 08', security_code: '245775.SH', amount_text: '5,000.00万元' },
  ] });
  assert.deepEqual(rows.map(row => [row.bondShortName, row.amountFen, row.paymentDate]), [
    ['26青信07', 10000000000, '2026-07-29'], ['26青信08', 5000000000, '2026-07-29'],
  ]);
});

test('two logical receipts share their physical source page but have independent labels and code-clean recognized text', () => {
  const analysis = page({ paymentDate: '2026-07-29' }), before = structuredClone(analysis);
  const receipts = expandPaymentReceiptAllocationGroup(group, [analysis]);
  assert.deepEqual(receipts.map(row => row.pageNumbers), [[1], [1]]);
  assert.deepEqual(receipts.map(row => row.pageLabel), ['1#245774.SH', '1#245775.SH']);
  assert.deepEqual(receipts.map(row => row.physicalPageLabel), ['1', '1']);
  assert.equal(receipts[0].recognized.amountFen, 10000000000);
  assert.equal(receipts[1].recognized.amountFen, 5000000000);
  for (const row of receipts) {
    assert.deepEqual([...new Set(paymentReceiptSourceCodes(row.recognized.recognizedText).map(code => code.text))], [row.recognized.securityCode]);
    assert.doesNotMatch(row.recognized.recognizedText, new RegExp(row.allocationKey === '245774.SH' ? '245775|26青信08' : '245774|26青信07'));
  }
  assert.deepEqual(analysis, before, 'the full raw page OCR is retained without edits');
});

test('the two rows independently match the correct 07/08 project tranches', () => {
  const projects = [{ id: 'project', shortName: '26青信07/08', tranches: [
    { id: 'seven', shortName: '26青信07', securityCode: '', paymentDate: '2026-07-29', winningAmountWan: 10000 },
    { id: 'eight', shortName: '26青信08', securityCode: '', paymentDate: '2026-07-29', winningAmountWan: 5000 },
  ] }];
  const matches = expandPaymentReceiptAllocationGroup(group, [page()]).map(row => selectPaymentReceiptMatch(row.recognized, projects));
  assert.deepEqual(matches.map(match => [match.status, match.trancheId]), [['matched', 'seven'], ['matched', 'eight']]);
});

test('row order and corrected amounts do not change security-based IDs, labels or fallback fingerprint identities', () => {
  const first = expandPaymentReceiptAllocationGroup(group, [page({ allocations: structured })]);
  const second = expandPaymentReceiptAllocationGroup(group, [page({ allocations: [{ ...structured[1], amountWan: 6000 }, structured[0]] })]);
  const receiptId = row => createHash('sha256').update(`file:${row.pageNumbers.join(',')}|allocation:${row.allocationKey}`).digest('hex');
  for (const row of first) {
    const other = second.find(value => value.allocationKey === row.allocationKey);
    assert.equal(receiptId(row), receiptId(other));
    assert.equal(row.pageLabel, other.pageLabel);
  }
  assert.notEqual(receiptId(first[0]), receiptId(first[1]));
  assert.notEqual('source-sha|allocation:' + first[0].allocationKey, 'source-sha|allocation:' + first[1].allocationKey);
});

test('common continuation pages remain attached to both logical records without contaminating row text', () => {
  const receipts = expandPaymentReceiptAllocationGroup({ ...group, pageNumbers: [1, 2], pageLabel: '1-2' }, [page(),
    { pageNumber: 2, classification: 'continuation', recognizedText: '26青信07/08共同盖章页', fields: {} }]);
  assert.deepEqual(receipts.map(row => row.sourcePages), [[1, 2], [1, 2]]);
  assert.deepEqual(receipts.map(row => row.sourcePageLabel), ['1-2#245774.SH', '1-2#245775.SH']);
  assert.ok(receipts.every(row => !row.recognized.recognizedText.includes('共同盖章页')));
});

test('a single-tranche receipt keeps the old physical label and its original OCR text', () => {
  const text = '债券简称 26测试MTN001\n债券代码 102699001\n缴款日期 2026-07-29\n缴款金额 1000万元';
  const [receipt] = expandPaymentReceiptAllocationGroup({ pageNumbers: [3], pageLabel: '3' }, [
    { pageNumber: 3, classification: 'receipt_start', recognizedText: text, fields: {} },
  ]);
  assert.equal(receipt.allocationKey, '');
  assert.equal(receipt.pageLabel, '3');
  assert.deepEqual(receipt.sourcePages, [3]);
  assert.equal(receipt.recognized.bondShortName, '26测试MTN001');
  assert.equal(receipt.recognized.amountFen, 1000000000);
  assert.equal(receipt.recognized.recognizedText, text);
});

test('a shared remittance memo does not create another allocation absent an actual second table row', () => {
  const text = TABLE.replace(/^26 青信 08.*\n/m, '');
  assert.equal(readPaymentReceiptAllocations(text).length, 1);
  const receipts = expandPaymentReceiptAllocationGroup(group, [{ ...page(), recognizedText: text }]);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].allocationKey, '');
  assert.equal(receipts[0].recognized.amountFen, 10000000000);
});

test('units and missing fields are explicit; unknown amounts are never filled from the page-level amount', () => {
  const rows = readPaymentReceiptAllocations('', { paymentDate: '2026-07-29', amountFen: 99999999, allocations: [
    { name: '26青信07', code: '245774.SH', amount_text: '0.01万元' },
    { name: '26青信08', code: '245775.SH', amount_text: '5000' },
  ] });
  assert.equal(rows[0].amountFen, 10000);
  assert.equal(rows[1].amountFen, null);
  assert.equal(rows[1].requiresReview, true);
});

test('a shared prepayment number cannot collapse equal allocations of distinct securities', () => {
  const receipts = expandPaymentReceiptAllocationGroup(group, [page({ prepaymentNumber: 'W202607290000001', paymentDate: '2026-07-29',
    allocations: structured.map(row => ({ ...row, amountFen: 1000000 })) })]);
  assert.ok(receipts.every(row => row.recognized.prepaymentNumber === ''));
  assert.deepEqual(receipts.map(row => row.allocationKey), ['245774.SH', '245775.SH']);
  const explicitShared = expandPaymentReceiptAllocationGroup(group, [page({ paymentDate: '2026-07-29',
    allocations: structured.map(row => ({ ...row, amountFen: 1000000, prepaymentNumber: 'W202607290000001' })) })]);
  assert.ok(explicitShared.every(row => row.recognized.prepaymentNumber === ''));
});

test('an incomplete single allocation does not borrow a contradictory page-level amount', () => {
  const [receipt] = expandPaymentReceiptAllocationGroup(group, [page({ amountFen: 999999999,
    allocations: [{ name: '26青信07', code: '245774.SH', amount_text: 'unknown' }] })]);
  assert.equal(receipt.recognized.amountFen, null);
  assert.equal(receipt.requiresReview, true);
});

test('identical repeated rows collapse, while disagreeing allocations for one code remain manual', () => {
  const rows = readPaymentReceiptAllocations('', { paymentDate: '2026-07-29', allocations: [structured[0], structured[0],
    { ...structured[0], amountWan: 5000 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requiresReview, true);
  assert.equal(rows[0].amountFen, 10000000000);
});

test('invalid or absent market information is retained without inventing a corrected code or suffix', () => {
  const rows = readPaymentReceiptAllocations('', { allocations: [
    { name: '26青信07', code: '2457748.SH', amountWan: 10000 },
    { name: '26青信08', code: '245775', amountWan: 5000 },
  ] });
  assert.equal(rows[0].securityCode, '2457748.SH');
  assert.equal(rows[0].requiresReview, true);
  assert.equal(rows[1].securityCode, '245775');
  assert.equal(rows[1].allocationKey, '245775');
});

test('a transposed table with one zero allocation uses the explicit total only for the positive tranche', () => {
  const text = `配售缴款通知书
债券简称 26工投K4 26工投K5
债券代码 245599.SH 245600.SH
债券期限 5年 10年
发行价格 100元 100元
票面利率 1.71% 2.29%
获配面值(万元) 0 8,000
缴款金额合计(万元) 8,000
缴款截止时间 2026年7月9日15:00前`;
  const allocations = readPaymentReceiptAllocations(text);
  assert.equal(allocations.length, 1);
  assert.deepEqual([allocations[0].bondShortName, allocations[0].securityCode, allocations[0].amountFen], ['26工投K5', '245600.SH', 8000000000]);
  const [receipt] = expandPaymentReceiptAllocationGroup(group, [{ ...page(), recognizedText: text }]);
  assert.equal(receipt.pageLabel, '1'); assert.equal(receipt.allocationKey, '');
  assert.doesNotMatch(receipt.recognized.recognizedText, /245599|26工投K4/);
});

test('repeated labelled tranche blocks exclude an explicit dash while retaining unknown blank amounts for review', () => {
  const text = `配售缴款通知书
债券简称 26海控03 债券代码 284224.SH
发行期限 3年
票面利率 1.8%
获配面值(万元) 5,000 缴款金额(万元) 5,000
债券简称 26海控04 债券代码 284225.SH
发行期限 5年
票面利率 2.02%
获配面值(万元) - 缴款金额(万元) -
请贵公司于2026年10月15日17:00前缴款。`;
  assert.equal(readPaymentReceiptAllocations(text).length, 1);
  const [receipt] = expandPaymentReceiptAllocationGroup(group, [{ ...page(), recognizedText: text }]);
  assert.equal(receipt.recognized.bondShortName, '26海控03');
  assert.equal(receipt.recognized.amountFen, 5000000000);
  assert.doesNotMatch(receipt.recognized.recognizedText, /284225|26海控04/);
  const unknown = readPaymentReceiptAllocations(text.replace('缴款金额(万元) -', '缴款金额(万元) '));
  assert.equal(unknown.length, 2);
  assert.equal(unknown[1].amountFen, null); assert.equal(unknown[1].requiresReview, true);
});

test('the Yuexin native table preserves the two actual allocated amounts without a market suffix guess', () => {
  const text = `配售缴款通知书
债券简称 债券代码 发行规模(万元) 期限 票面利率 获配面值(万元) 缴款金额(万元)
26 越新 G1 524963 30,000.00 5 年 1.89% 4,000.00 4,000.00
26 越新 G2 524964 20,000.00 10 年 2.45% 2,000.00 2,000.00
请贵公司于2026年8月20日15:00前缴款。`;
  const allocations = readPaymentReceiptAllocations(text);
  assert.deepEqual(allocations.map(row => [row.bondShortName, row.securityCode, row.amountFen]), [
    ['26越新G1', '524963', 4000000000], ['26越新G2', '524964', 2000000000],
  ]);
});

test('explicitly unallocated AI rows are filtered while blank unknown rows remain visible and reviewable', () => {
  const fields = { paymentDate: '2026-07-29', allocations: [
    { ...structured[0], amountWan: 0 }, { ...structured[1], amount_text: '-' },
  ] };
  assert.deepEqual(readPaymentReceiptAllocations('', fields), []);
  assert.deepEqual(expandPaymentReceiptAllocationGroup(group, [page(fields)]), []);
  fields.allocations[1].amount_text = '';
  const active = readPaymentReceiptAllocations('', fields);
  assert.equal(active.length, 1); assert.equal(active[0].requiresReview, true);
});

test('the actual Jinjin table joins a complete market suffix wrapped onto the following line', () => {
  const text = `配售确认及缴款通知书
债券简称 债券代码 发行规模(万元) 期限 票面利率 获配面值(万元) 缴款金额(万元)
26晋金03 246129.S
H 50,000.00 3年 1.68% 15,000.00 15,000.00
26晋金04 246130.S
H 50,000.00 5年 1.80% 5,000.00 5,000.00
请贵公司于2026年09月23日15:00前缴款。`;
  const rows = readPaymentReceiptAllocations(text);
  assert.deepEqual(rows.map(row => [row.bondShortName, row.securityCode, row.amountFen]), [
    ['26晋金03', '246129.SH', 15000000000], ['26晋金04', '246130.SH', 5000000000],
  ]);
  assert.ok(rows.every(row => !row.requiresReview));
  const logical = expandPaymentReceiptAllocationGroup(group, [{ ...page(), recognizedText: text }]);
  assert.equal(logical.length, 2);
  assert.deepEqual(logical.map(row => row.sourcePageLabel), ['1#246129.SH', '1#246130.SH']);
});
