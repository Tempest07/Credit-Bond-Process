import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dataProviderLabel, dataSourceModeLabel } from '../market-data-source.js';
import { normalizeLookupPayload } from '../bond-identity.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function loadFunctions(context, names) {
  for (const name of names) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `actual app function ${name} exists`);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:async )?function |\nvoid initialize\(/);
    vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
  }
}

function harness(mode = 'qb') {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', innerHTML: '', disabled: false, hidden: false,
      dataset: {}, scrollTop: 0, classList: { contains: () => false },
    });
    return elements.get(selector);
  };
  const context = vm.createContext({
    $, mode, dataSourceControl: { getMode: () => context.mode }, dataProviderLabel, dataSourceModeLabel,
    projectDmRequest: null, dmLookupRequest: null, dmLastPayload: null,
    normalizeLookupPayload, AbortController, URLSearchParams,
    document: { activeElement: null }, PROJECT_SCREENSHOT_BRANCHES: ['北京'], projectScreenshotRows: [],
    syncProjectScreenshotCopyControls() {},
  });
  loadFunctions(context, [
    'currentDataSourceLabel', 'refreshMarketDataLabels', 'setProjectDmLookupBusy', 'setDmLookupBusy',
    'escapeHtml', 'escapeAttribute', 'checkedDmLookupPayload', 'dmPayloadSourceLabel',
    'lookupProjectScreenshotEntry', 'finalizeProjectScreenshotLookupRow',
    'renderProjectScreenshotResults', 'projectScreenshotResolvedShortNames',
    'secondaryLedgerDmRowStatus', 'secondaryLedgerDmCellTitle',
  ]);
  return { context, $ };
}

test('project and query actions use business copy in every source mode while idle and loading', () => {
  const h = harness();
  for (const mode of ['dm', 'qb', 'auto']) {
    h.context.mode = mode;
    h.context.setProjectDmLookupBusy(false);
    h.context.setDmLookupBusy(false);
    assert.equal(h.$('#projectDmLookupButton').textContent, '读取资料');
    assert.equal(h.$('#dmLookupButton').textContent, '查询资料');
    assert.equal(h.$('#projectDmLookupButton').disabled, false);
    h.context.setProjectDmLookupBusy(true);
    h.context.setDmLookupBusy(true);
    assert.equal(h.$('#projectDmLookupButton').textContent, '正在读取…');
    assert.equal(h.$('#projectDmStatus').textContent, '正在读取…');
    assert.equal(h.$('#dmLookupButton').textContent, '正在查询…');
    assert.equal(h.$('#dmLookupButton').disabled, true);
  }
});

test('source changes clear stale failure and idle labels while retaining successful historical attribution', () => {
  const h = harness('qb');
  h.$('#projectDmStatus').textContent = 'DM 查询失败';
  h.$('#dmLookupStatus').textContent = '查询失败 · DM · HTTP 429';
  h.$('#projectDmAssist').innerHTML = 'DM 查询失败';
  h.context.dmLastPayload = { ok: false };
  h.context.refreshMarketDataLabels({ resetRequestState: true });
  assert.equal(h.$('#projectDmStatus').textContent, '未读取资料');
  assert.equal(h.$('#dmLookupStatus').textContent, '等待查询');
  assert.equal(h.$('#projectDmAssist').hidden, true);
  assert.equal(h.$('#projectDmAssist').innerHTML, '');
  assert.match(h.$('#dmNormalizedOutput').innerHTML, /重新查询/);
  h.context.mode = 'auto';
  h.context.refreshMarketDataLabels();
  assert.equal(h.$('#projectDmStatus').textContent, '未读取资料');
  assert.equal(h.$('#dmLookupStatus').textContent, '等待查询');

  h.$('#projectDmStatus').textContent = '已读取 DM+云端数据库';
  h.$('#dmLookupStatus').textContent = '查询成功 · DM · HTTP 200';
  h.context.dmLastPayload = { ok: true, source: 'DM' };
  h.$('#projectDmAssist').hidden = false;
  h.$('#projectDmAssist').innerHTML = 'DM 已带入新增项目';
  h.context.mode = 'qb';
  h.context.refreshMarketDataLabels({ resetRequestState: true });
  assert.equal(h.$('#projectDmStatus').textContent, '已读取 DM+云端数据库');
  assert.equal(h.$('#dmLookupStatus').textContent, '查询成功 · DM · HTTP 200');
  assert.equal(h.$('#projectDmLookupButton').textContent, '读取资料');
  assert.equal(h.$('#projectDmAssist').hidden, false);
  assert.equal(h.$('#projectDmAssist').innerHTML, 'DM 已带入新增项目');
  h.$('#projectDmStatus').textContent = '已读取资料';
  h.context.mode = 'auto';
  h.context.refreshMarketDataLabels({ resetRequestState: true });
  assert.equal(h.$('#projectDmStatus').textContent, '已读取资料');
  assert.equal(h.$('#projectDmAssist').hidden, false);
  assert.equal(h.$('#projectDmAssist').innerHTML, 'DM 已带入新增项目');
});

test('project lookup failures use business copy while a successful assistant retains its real provider', () => {
  const h = harness('qb');
  Object.assign(h.context, { renderProjectDmIssueGroup: () => '', formatNumber: String });
  loadFunctions(h.context, ['renderProjectDmAssist', 'numberOrNull']);
  h.context.renderProjectDmAssist({ ok: false, error: '接口暂不可用' });
  assert.match(h.$('#projectDmAssist').innerHTML, /债券资料查询失败/);
  assert.doesNotMatch(h.$('#projectDmAssist').innerHTML, /DM 查询失败/);
  h.context.mode = 'auto';
  h.context.renderProjectDmAssist({ ok: false, error: '接口暂不可用' });
  assert.match(h.$('#projectDmAssist').innerHTML, /债券资料查询失败/);
  assert.doesNotMatch(h.$('#projectDmAssist').innerHTML, /自动|→|DM|QB/);
  h.context.mode = 'dm';
  h.context.renderProjectDmAssist({ ok: true, source: 'QB', normalized: { shortName: '26测试MTN001' } });
  assert.match(h.$('#projectDmAssist').innerHTML, /QB 已带入新增项目/);
  assert.doesNotMatch(h.$('#projectDmAssist').innerHTML, /DM 已带入/);
});

test('a QB screenshot lookup keeps QB verification through finalization and subsequent mode changes', async () => {
  const h = harness('qb');
  const entry = { id: 'row-1', sessionId: 1, revision: 1, branch: '北京', draftFullName: '测试债券全称', fullName: '测试债券全称' };
  h.context.requestProjectScreenshotDmLookup = async () => ({
    response: { ok: true },
    payload: { ok: true, source: 'QB', diagnostic: { dmMatched: true }, normalized: {
      shortName: '26测试MTN001', fullName: '测试债券全称', securityId: '102600001.IB', issuerName: '测试有限公司',
    } },
  });
  const resolved = await h.context.lookupProjectScreenshotEntry(entry);
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.provider, 'QB');
  const row = h.context.finalizeProjectScreenshotLookupRow(entry, resolved);
  assert.equal(row.verifiedProvider, 'QB');
  assert.equal(row.verifiedShortName, '26测试MTN001');
  h.context.projectScreenshotRows = [row];
  h.context.renderProjectScreenshotResults();
  assert.match(h.$('#projectScreenshotOutput').innerHTML, /QB 已核验/);
  h.context.mode = 'dm';
  h.context.renderProjectScreenshotResults();
  assert.match(h.$('#projectScreenshotOutput').innerHTML, /QB 已核验/);
  assert.doesNotMatch(h.$('#projectScreenshotOutput').innerHTML, /DM 已核验/);
  const retryFailure = h.context.finalizeProjectScreenshotLookupRow(row, { status: 'error', dmVerified: false, error: '请求失败' });
  assert.equal(retryFailure.verifiedProvider, 'QB');
  assert.equal(retryFailure.verifiedShortName, '26测试MTN001');
});

test('secondary status preserves real DM, QB and mixed history and never invents a provider for failures', () => {
  const h = harness('qb');
  for (const provider of [undefined, 'DM', 'QB', 'DM+QB']) {
    const row = { dmLookup: { status: 'complete', valuationDate: '2026-10-22', ...(provider ? { provider } : {}) } };
    const status = h.context.secondaryLedgerDmRowStatus(row);
    assert.equal(status.label, provider || 'DM');
    assert.match(status.title, /2026-10-22/);
    h.context.mode = 'dm';
    assert.equal(h.context.secondaryLedgerDmRowStatus(row).label, provider || 'DM');
  }
  const partial = h.context.secondaryLedgerDmRowStatus({ dmLookup: { status: 'partial', provider: 'QB', missing: ['估值收益率'] } });
  assert.equal(partial.label, 'QB');
  assert.match(partial.title, /QB 部分返回：估值收益率/);
  for (const status of ['error', 'missing']) {
    const row = { dmLookup: { status } };
    assert.doesNotMatch(h.context.secondaryLedgerDmRowStatus(row).title, /DM/);
    assert.doesNotMatch(h.context.secondaryLedgerDmCellTitle(row, '估值收益率'), /DM/);
  }
  const mixed = { dmLookup: { status: 'complete', provider: 'DM+QB', valuationDate: '2026-10-22' }, fieldSources: { 估值收益率: 'qb', 债券简称: 'dm' } };
  assert.match(h.context.secondaryLedgerDmCellTitle(mixed, '估值收益率'), /^QB /);
  assert.equal(h.context.secondaryLedgerDmCellTitle(mixed, '债券简称'), 'DM 债券简称');
});

test('changing source aborts an old project request and ignores a late response even if transport ignores abort', async () => {
  const h = harness('dm');
  const requests = [];
  const applied = [];
  Object.assign(h.context, {
    project: {}, dataSourceGeneration: 0, valuationAssistTimer: null, valuationAssistController: null,
    policyCurveController: null, valuationAssistRequestKey: '', renderedValuationPayload: null,
    secondaryPendingDmLoading: false, secondaryLedgerDmLoading: false,
    secondaryPendingDmAttemptKey: '', secondaryLedgerDmAttemptKey: '', clearTimeout,
    briefTemplatePlaceholders: () => [], looksLikeSecurityId: () => false, authHeaders: () => ({}), showToast() {},
    fetch: (_url, options) => new Promise(resolve => requests.push({ options, resolve })),
    renderProjectDmAssist() {}, applyDmLookupToCurrentProject: payload => applied.push(payload), pushProjectDmHistoryFromCurrent() {},
    resetModelValuationAssist() {}, paymentTodoCodes: { resetDataSource() {} },
    bondListController: { resetDataSource() {} }, realtimeQuoteController: { resetDataSource() {} },
    updateSecondaryPendingControls() {}, updateSecondaryLedgerControls() {},
  });
  loadFunctions(h.context, ['runProjectDmLookup', 'cancelProjectDmLookup', 'cancelDmLookup', 'handleDataSourceChange']);
  const pending = h.context.runProjectDmLookup('26测试MTN001');
  assert.equal(requests.length, 1);
  h.context.mode = 'qb';
  h.context.handleDataSourceChange();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(h.$('#projectDmLookupButton').textContent, '读取资料');
  assert.equal(h.$('#projectDmStatus').textContent, '未读取资料');
  requests[0].resolve({ ok: true, status: 200, json: async () => ({ ok: true, source: 'DM', normalized: { shortName: '26测试MTN001' } }) });
  await pending;
  assert.equal(applied.length, 0);
  assert.equal(h.$('#projectDmStatus').textContent, '未读取资料');
});

test('a screenshot response from the previous source cannot be accepted after switching modes', async () => {
  const h = harness('dm');
  let answer;
  Object.assign(h.context, {
    dataSourceGeneration: 0, DOMException, window: { setTimeout, clearTimeout }, authHeaders: () => ({}),
    fetch: () => new Promise(resolve => { answer = resolve; }),
  });
  loadFunctions(h.context, ['requestProjectScreenshotDmLookup']);
  const pending = h.context.requestProjectScreenshotDmLookup({ fullName: '测试债券全称' });
  h.context.mode = 'qb';
  h.context.dataSourceGeneration++;
  answer({ ok: true, json: async () => ({ ok: true, source: 'DM', normalized: { shortName: '26测试MTN001' } }) });
  await assert.rejects(pending, /旧查询已取消/);
});
