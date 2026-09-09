import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { formatNumber } from '../core.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function renderValuationSuggestionCard('), app.indexOf('function renderWarnings('));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(item, offering = '公募', mode = 'beta') {
  const context = { document: { documentElement: { dataset: { ui: mode } } }, formatNumber, escapeHtml, escapeAttribute: escapeHtml, round: (n, d) => Math.round(n * 10 ** d) / 10 ** d };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf("function numberOrNull("), app.indexOf("function round(")) + source, context);
  return context.renderValuationSuggestionCard(item, offering);
}
const item = { durationText:'3Y', center:1.8, low:1.7, high:1.9, confidence:'中', profileLabel:'MTN · 银行间 · 非永续', method:'期限调整', comparableItems:[{ shortName:'<示例>', durationText:'2.8Y', rate:1.75, source:'DM 中债', yieldBasis:'到期收益率', valuationDate:'2026-09-09', adjustment:0.01 }] };
test('approved UI retains rates, provenance and bp units, with collapsed details', () => {
  const html = render(item);
  for (const text of ['1.8%', '1.7% — 1.9%', 'DM 中债', '到期收益率', '2026-09-09', '+1bp', '公募', '&lt;示例&gt;']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<details open|非永续|模型研判|人工修正与学习/);
  assert.equal((html.match(/<details>/g) || []).length, 2);
});
test('reference-only and unknown offering do not manufacture estimates or public status', () => {
  const html = render({...item, referenceOnly:true, center:null, low:null, high:null, comparableItems:[]}, '');
  assert.match(html, /暂无可靠建议/);
  assert.match(html, /发行方式待确认/);
  assert.doesNotMatch(html, /0%|公募/);
});
test('legacy layout and perpetual label remain supported', () => {
  assert.match(render(item, '公募', 'legacy'), /valuation-suggestion-card/);
  assert.doesNotMatch(render(item, '公募', 'legacy'), /valuation-beta-card/);
  assert.match(render({...item, profileLabel:'MTN · 银行间 · 永续'}, 'private'), /永续.*私募/);
});
