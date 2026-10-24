import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataProviderLabel, dataSourceModeLabel, renderDataSourceLabels } from '../market-data-source.js';

test('request labels distinguish the selected mode from an actual returned provider', () => {
  assert.equal(dataSourceModeLabel('dm'), 'DM');
  assert.equal(dataSourceModeLabel('qb'), 'QB');
  assert.equal(dataSourceModeLabel('auto'), '自动');
  for (const invalid of ['', undefined, null, 'DM', 'manual', 'toString']) {
    assert.equal(dataSourceModeLabel(invalid), '数据源');
  }
  assert.equal(dataProviderLabel({ provider: 'DM' }), 'DM');
  assert.equal(dataProviderLabel({ provider: 'QB' }), 'QB');
  assert.equal(dataProviderLabel({ provider: 'DM+QB' }), 'DM+QB');
});

test('static templates follow repeated mode changes without rewriting successful sources or live states', () => {
  const staticCopy = { dataset: { sourceTemplate: '通过 {source} 查询；当前请求来源：{source}。' }, textContent: '' };
  const savedSource = { dataset: {}, textContent: 'DM · 2026-10-22 · 1.55%' };
  const loadingState = { dataset: {}, textContent: 'QB 读取中…' };
  const document = { querySelectorAll(selector) {
    assert.equal(selector, '[data-source-template]');
    return [staticCopy];
  } };
  renderDataSourceLabels(document, 'qb');
  assert.equal(staticCopy.textContent, '通过 QB 查询；当前请求来源：QB。');
  renderDataSourceLabels(document, 'auto');
  assert.equal(staticCopy.textContent, '通过 自动 查询；当前请求来源：自动。');
  renderDataSourceLabels(document, 'dm');
  assert.equal(staticCopy.textContent, '通过 DM 查询；当前请求来源：DM。');
  assert.equal(staticCopy.dataset.sourceTemplate, '通过 {source} 查询；当前请求来源：{source}。');
  assert.equal(savedSource.textContent, 'DM · 2026-10-22 · 1.55%');
  assert.equal(loadingState.textContent, 'QB 读取中…');
  assert.doesNotThrow(() => renderDataSourceLabels(undefined, 'qb'));
});

test('the page keeps the source switch without route templates or routing descriptions in product copy', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tags = [...html.matchAll(/<[^>]+data-source-template="([^"]*)"[^>]*>/g)];
  assert.equal(tags.length, 0, 'ordinary copy does not interpolate the selected request mode');
  const main = html.split('id="releaseNotesDialog"')[0];
  assert.match(main, /data-view-target="dm-test">数据查询<\/button>/);
  assert.doesNotMatch(main, />DM 查询测试<|>DM 测试<|>未读取 DM<|>DM 待读取</);
  assert.doesNotMatch(main, /DM\s*→\s*QB|请求来源：|后续来源：|data-source-description/);
  for (const mode of ['auto','dm','qb']) assert.match(main,new RegExp('data-source-mode="'+mode+'"'));
  assert.match(html, /经纪商实时行情已暂停/, 'the suspended broker feed remains explicitly unavailable');
});
