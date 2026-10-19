import test from 'node:test';
import assert from 'node:assert/strict';
import { BOND_TYPES, quoteRows, filterQuotes, quoteOutput } from '../bond-list-filter.js';

const sections = [
  { title: '北京', text: ' 102600001.ib，26测试MTN001，2.1*OFR 5000 \n102600002.IB,26测试SCP001,估值-2*bid\n\n未补码MTN，净价100*offer' },
  { title: '杭州', text: '102600001.IB，26测试MTN001，OFR估值-2*\n123456.SH，26测试01，2.05bid\n123457.SH，26测试02，2.0*ofr / 2.1*bid\n123458.SH，26测试03，待报' }
];
const metadata = new Map([
  ['102600001.IB', { status: 'matched', couponRate: 2.3, bondType: 'MTN', attributes: ['永续'] }],
  ['102600002.IB', { status: 'missing', couponRate: null, bondType: 'SCP' }],
  ['123456.SH', { status: 'matched', couponRate: 0, bondType: '公司债' }],
  ['123457.SH', { status: 'matched', couponRate: 3.5, bondType: '金融债', attributes: ['二级资本'] }],
  ['123458.SH', { status: 'missing', couponRate: null }]
]);

test('rows keep quote identity, original name/text and duplicate holdings without mutating editor data', () => {
  const snapshot = JSON.stringify(sections);
  const rows = quoteRows(sections, metadata);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(row => [row.sectionIndex, row.lineIndex]), [[0, 0], [0, 1], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]]);
  assert.equal(rows[0].raw, ' 102600001.ib，26测试MTN001，2.1*OFR 5000 ');
  assert.equal(rows[0].code, '102600001.IB');
  assert.equal(rows[0].name, '26测试MTN001');
  assert.equal(rows[3].code, rows[0].code);
  assert.equal(rows[3].branch, '杭州');
  rows[0].attributes.push('测试');
  assert.deepEqual(metadata.get('102600001.IB').attributes, ['永续']);
  assert.equal(JSON.stringify(sections), snapshot);
});

test('type and coupon are metadata facts, never guesses from short name or quote', () => {
  const rows = quoteRows(sections, metadata);
  assert.equal(rows[2].bondType, '未知');
  assert.equal(rows[2].couponRate, null);
  assert.equal(rows[1].bondType, 'SCP');
  assert.equal(rows[1].couponRate, null);
  assert.equal(rows[4].couponRate, 0);
  assert.equal(rows[0].couponRate, 2.3);
  assert.equal(rows[0].metadataStatus, 'matched');
  assert.equal(rows[2].metadataStatus, 'uncoded');
  assert.equal(quoteRows([{ title: 'A', text: '123459.SH，券，2*ofr' }])[0].metadataStatus, 'pending');
});

test('metadata object has the same meaning as Map and unrecognized nonempty type stays distinct from missing type', () => {
  const source = [{ title: 'A', text: '123456.sh，原文券名，2*ofr' }];
  const result = { couponRate: 2.1, bondType: '可交换债', name: '元数据券名', attributes: ['可交换'] };
  assert.deepEqual(quoteRows(source, { '123456.SH': result }), quoteRows(source, new Map([['123456.SH', result]])));
  assert.equal(quoteRows(source, { '123456.SH': result })[0].bondType, '其他');
  assert.equal(quoteRows(source, { '123456.SH': result })[0].name, '原文券名');
  assert.equal(quoteRows(source, { '123456.SH': { bondType: '  mtn ' } })[0].bondType, 'MTN');
  assert.ok(BOND_TYPES.includes('未知'));
});

test('direction comes only from explicit quote markers, including pasted prefixes and no-star suffixes', () => {
  assert.deepEqual(quoteRows(sections, metadata).map(row => row.direction), ['ofr', 'bid', 'ofr', 'ofr', 'bid', 'both', 'unknown']);
  const rows = quoteRows([{ title: 'A', text: [
    '123456.SH，26bid公司01，净价100',
    '26ofr公司，2.5',
    '测试券，bidding 100',
    '测试券，reoffer 100',
    '测试券，offr100',
    '测试券，OFFER 100',
    '测试券，2.0ofr',
    '测试券，BID估值+1*',
    '测试券，OFR/BID 2.0/2.1'
  ].join('\n') }]);
  assert.deepEqual(rows.map(row => row.direction), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'ofr', 'ofr', 'bid', 'both']);
});

test('default returns all rows in source order; type alternatives are OR and different conditions are AND', () => {
  const rows = quoteRows(sections, metadata);
  assert.deepEqual(filterQuotes(rows), { rows, active: false, error: '' });
  const result = filterQuotes(rows, { types: ['MTN', '金融债'], side: 'ofr', couponOp: 'gte', couponMin: '2.30' });
  assert.equal(result.error, '');
  assert.equal(result.active, true);
  assert.deepEqual(result.rows.map(row => row.code), ['102600001.IB', '102600001.IB', '123457.SH']);
  assert.equal(filterQuotes(rows, { types: ['SCP'], side: 'ofr' }).rows.length, 0);
});

test('both-side quotes match either side while missing directions match neither', () => {
  const rows = quoteRows(sections, metadata);
  assert.deepEqual(filterQuotes(rows, { side: 'bid' }).rows.map(row => row.direction), ['bid', 'bid', 'both']);
  assert.deepEqual(filterQuotes(rows, { side: 'ofr' }).rows.map(row => row.direction), ['ofr', 'ofr', 'ofr', 'both']);
  assert.equal(filterQuotes(rows, { side: 'bid', missing: 'side' }).rows.length, 0);
});

test('coupon comparisons use percentage units and correct strict/inclusive decimal boundaries', () => {
  const rows = quoteRows(sections, metadata);
  const rates = filters => filterQuotes(rows, filters).rows.map(row => row.couponRate);
  assert.deepEqual(rates({ couponOp: 'gt', couponMin: '2.30' }), [3.5]);
  assert.deepEqual(rates({ couponOp: 'gte', couponMin: '2.30' }), [2.3, 2.3, 3.5]);
  assert.deepEqual(rates({ couponOp: 'lt', couponMin: '2.30' }), [0]);
  assert.deepEqual(rates({ couponOp: 'lte', couponMin: '2.30' }), [2.3, 2.3, 0]);
  assert.deepEqual(rates({ couponOp: 'between', couponMin: '2.3', couponMax: '3.5' }), [2.3, 2.3, 3.5]);
  assert.deepEqual(rates({ couponOp: 'between', couponMin: '2.3', couponMax: '2.30' }), [2.3, 2.3]);
  assert.deepEqual(rates({ couponOp: 'gte', couponMin: '2.31' }), [3.5]);
  assert.deepEqual(rates({ couponOp: 'lte', couponMin: 0 }), [0]);
  assert.deepEqual(rates({ couponOp: 'lt', couponMin: '0.025' }), [0]);
});

test('missing metadata can be isolated and never becomes zero coupon or a quoted direction', () => {
  const rows = quoteRows(sections, metadata);
  assert.deepEqual(filterQuotes(rows, { missing: 'coupon' }).rows.map(row => row.name), ['26测试SCP001', '未补码MTN', '26测试03']);
  assert.deepEqual(filterQuotes(rows, { missing: 'type' }).rows.map(row => row.name), ['未补码MTN', '26测试03']);
  assert.deepEqual(filterQuotes(rows, { missing: 'side' }).rows.map(row => row.name), ['26测试03']);
  assert.equal(filterQuotes(rows, { missing: 'coupon', couponOp: 'gte', couponMin: '0' }).rows.length, 0);
  for (const couponRate of ['', '2.5', -1, NaN, Infinity, undefined]) {
    const row = quoteRows([{ title: 'A', text: '123456.SH，券，2*ofr' }], { '123456.SH': { couponRate } })[0];
    assert.equal(row.couponRate, null);
  }
});

test('invalid coupon thresholds produce useful errors and no copyable result rows', () => {
  const rows = quoteRows(sections, metadata);
  for (const couponMin of ['', ' ', '-0.01', '-1', NaN, Infinity, 'NaN', 'Infinity', '2%', '0x10', null]) {
    const result = filterQuotes(rows, { couponOp: 'gte', couponMin });
    assert.deepEqual(result.rows, []);
    assert.ok(result.error.includes('票面利率'));
    assert.equal(result.active, true);
  }
  for (const filters of [
    { couponOp: 'between', couponMin: '2', couponMax: '' },
    { couponOp: 'between', couponMin: '3', couponMax: '2' },
    { couponOp: 'between', couponMin: '0', couponMax: '-1' },
    { couponOp: 'other', couponMin: '2' }
  ]) {
    const result = filterQuotes(rows, filters);
    assert.deepEqual(result.rows, []);
    assert.ok(result.error);
  }
  assert.equal(filterQuotes(rows, { couponOp: 'any', couponMin: '-1', couponMax: 'invalid' }).error, '');
});

test('copied selection retains raw quote formats, duplicate rows and separate repeated branch headings', () => {
  const input = [
    { title: '北京', text: ' 123456.SH，原名A，2.0*ofr 5000\n 123456.SH,原名A,2.1*ofr  3000  \n123456.SH，原名A，2.2*bid' },
    { title: '杭州', text: '654321.SZ，原名B，2.3*ofr' },
    { title: '北京', text: ' 123456.SH，原名A，2.4*ofr ' }
  ];
  const rows = filterQuotes(quoteRows(input), { side: 'ofr' }).rows;
  assert.equal(quoteOutput(rows), 'OFR/BID\n\n北京\n123456.SH，原名A，2.0*ofr 5000\n 123456.SH,原名A,2.1*ofr  3000\n\n杭州\n654321.SZ，原名B，2.3*ofr\n\n北京\n123456.SH，原名A，2.4*ofr');
  assert.equal(rows.length, 4);
  assert.equal(quoteOutput([...rows].reverse()), quoteOutput(rows));
  assert.equal(quoteOutput([]), 'OFR/BID');
  assert.equal(input[0].text.startsWith(' '), true);
});

test('empty sections are skipped and market-qualified code validation rejects partial/unsupported identities', () => {
  assert.deepEqual(quoteRows([{ title: '空', text: ' \n\n' }]), []);
  const rows = quoteRows([{ title: 'A', text: ['12345.SH，券，2*ofr', '123456.HK，券，2*ofr', '1234567890123.IB，券，2*ofr', '123456，券，2*ofr', '123456789012.bj，券，2*ofr'].join('\n') }]);
  assert.deepEqual(rows.map(row => row.code), ['', '', '', '', '123456789012.BJ']);
});

test('copy preserves original blank separators and quote whitespace through all and filtered results', () => {
  const input = [
    { title: '陕西', text: '\n \n 123456.SH，券A，2.0*ofr  5000 \n123457.SH,券B,2.1*bid \n\n \t \n 123458.SH，券C，2.2*ofr  3000  \n\n' },
    { title: '空分行', text: '\n \t\n' },
    { title: '上海', text: ' 123459.SH，券D，2.3*ofr  ' }
  ];
  const rows = quoteRows(input);
  const previousOutput = 'OFR/BID' + input.filter(section => section.text.trim())
    .map(section => '\n\n' + section.title + '\n' + section.text.trim()).join('');
  assert.equal(quoteOutput(filterQuotes(rows).rows), previousOutput);
  assert.deepEqual(rows[2].blankBefore, ['', ' \t ']);
  const selected = filterQuotes(rows, { side: 'ofr' }).rows;
  assert.equal(quoteOutput(selected), 'OFR/BID\n\n陕西\n123456.SH，券A，2.0*ofr  5000 \n\n \t \n 123458.SH，券C，2.2*ofr  3000\n\n上海\n123459.SH，券D，2.3*ofr');
  assert.ok(!quoteOutput(selected).includes('券B'));
  assert.equal(quoteOutput([rows[2]]), 'OFR/BID\n\n陕西\n123458.SH，券C，2.2*ofr  3000');
  assert.equal(input[0].text.endsWith('\n\n'), true);
});
