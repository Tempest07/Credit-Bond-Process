import test from 'node:test';
import assert from 'node:assert/strict';
import { findOpinionFieldRanges } from '../opinion-field-locator.js';
import { generateOpinion, parseProjectBrief } from '../core.js';

const located = (text, field) => findOpinionFieldRanges(text, field).map(({ start, end }) => text.slice(start, end));

test('locates placeholders in the real ordinary-bond template without changing it', () => {
  const text = generateOpinion(parseProjectBrief(''), null).opinion;
  assert.deepEqual(located(text, { kind: 'issuer' }), ['【待补充债券全称】']);
  assert.deepEqual(located(text, { kind: 'scale' }), ['【待补充发行规模】']);
  assert.deepEqual(located(text, { kind: 'creditRatio' }), ['【待补充比例】']);
  assert.deepEqual(located(text, { kind: 'amount' }), ['【待补充投资金额】', '【待补充投资金额】']);
  assert.deepEqual(located(text, { kind: 'approver' }), ['【待确认终批层级】']);
});

test('repeated numbers are scoped to issuance, credit terms, and investment amounts', () => {
  const text = '联动投资甲公司中期票据。预计发行规模2亿元，期限2年。授信方面，总行批2亿，公募，20%，私募10%，3年。拟申请投资金额不超过2亿元、一级投标利率不低于2%。建议投资金额不超过2亿元、投资比例不超过最终发行规模的20%。本笔业务由处室终批。';
  assert.deepEqual(located(text, { kind: 'creditRatio', value: 20 }), ['20%']);
  assert.deepEqual(located(text, { kind: 'scale' }), ['2亿元']);
  assert.deepEqual(located(text, { kind: 'amount' }), ['2亿元', '2亿元']);
  assert.deepEqual(located(text, { kind: 'suggestedRatio' }), ['20%']);
  assert.deepEqual(located(text, { kind: 'approver' }), ['本笔业务由处室终批。']);
  const { start } = findOpinionFieldRanges(text, { kind: 'creditRatio', value: 20 })[0];
  assert.ok(start < text.indexOf('拟申请'));
});

test('uses the current hand-edited text and does not fall back to unrelated numbers', () => {
  const text = '补充说明\n\n预计发行规模 3.25亿元。授信方面，投资比例30%。拟申请投资金额不超过1.5亿元。';
  assert.deepEqual(located(text, { kind: 'scale' }), ['3.25亿元']);
  assert.deepEqual(located(text, { kind: 'amount' }), ['1.5亿元']);
  assert.deepEqual(located(text, { kind: 'creditRatio', value: 20 }), []);
  assert.deepEqual(located('原投资金额已删除，发行规模2亿元。', { kind: 'amount' }), []);
  assert.deepEqual(located('授信方面，审批层级为总行。', { kind: 'approver' }), []);
});

test('covers ABS naming and amounts separately from ordinary-bond credit clauses', () => {
  const text = '上海分行拟与资金营运中心联动投资“测试专项计划”，发行规模10亿元，其中优先A档8亿元。授信方面，50217批单。上海分行拟申请投标优先A档金额不超过1亿元。拟建议投标优先A档金额不超过0.8亿元。本笔业务由处室终批。';
  assert.deepEqual(located(text, { kind: 'issuer' }), ['测试专项计划']);
  assert.deepEqual(located(text, { kind: 'amount' }), ['1亿元', '0.8亿元']);
  assert.deepEqual(located(text, { kind: 'creditRatio' }), []);
  assert.deepEqual(located(text, { kind: 'literal', value: '优先A档' }), ['优先A档', '优先A档', '优先A档']);
});

test('literal matches preserve metacharacters and markup as text', () => {
  const text = '优先A(1)+档 <img src=x onerror=alert(1)>；优先A(1)+档';
  assert.deepEqual(located(text, { kind: 'literal', value: '优先A(1)+档' }), ['优先A(1)+档', '优先A(1)+档']);
  assert.deepEqual(located(text, { kind: 'literal', value: '' }), []);
});
