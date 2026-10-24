import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { durationParts, durationToDays, normalizeBondFullNameForProject, calculateAbsTrancheSharePct, inferAbsClassNameFromShortName } from '../core.js';
import { normalizeLookupPayload } from '../bond-identity.js';
import { dataProviderLabel } from '../market-data-source.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function load(context, names) {
  for (const name of names) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    const tail = source.slice(start), end = tail.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(end < 0 ? tail : tail.slice(0, end + 1), context);
  }
}
function projectHarness() {
  let nextId = 0;
  const context = vm.createContext({ normalizeLookupPayload, durationParts, durationToDays, normalizeBondFullNameForProject,
    calculateAbsTrancheSharePct, inferAbsClassNameFromShortName, dataProviderLabel,
    crypto: { randomUUID: () => `test-${++nextId}` }, normalizeGuaranteeInfo: () => ({ guarantors: [] }) });
  load(context, ['projectPatchFromDmLookup', 'checkedDmLookupPayload', 'projectDmUsableTranches', 'sortProjectDmTranches',
    'compactProjectShortNames', 'projectCompactShortNameParts', 'compareProjectShortNameOrder', 'projectShortNameSortParts',
    'normalizeProjectShortNameForSort', 'projectLetterSortValue', 'uniqueNonEmpty', 'assignProjectDmValueWithSource',
    'assignProjectDmValue', 'projectSourceFromDmIssueGroup', 'normalizedProjectFieldSource', 'dmProjectFullNameForProject',
    'normalizeDmTenor', 'parseDmInquiryRange', 'compactProjectDurations', 'sumFinite', 'numberOrNull', 'round',
    'escapeRegExpForPattern', 'projectAbsInfoFromDm', 'normalizeProjectAbsInfo', 'normalizeProjectAbsTranche',
    'markAbsInfoSources', 'buildProjectDmRecognitionMarks', 'sourcedRecognitionMark', 'recognitionMark', 'valueHasContent']);
  return context;
}

test('single-bond inquiry ranges retain QB provenance while legacy ranges stay DM', () => {
  const context = projectHarness();
  for (const [fieldSource, expected] of [[{ inquiryRange: 'QB' }, 'qb'], [{}, 'dm']]) {
    const patch = context.projectPatchFromDmLookup({ normalized: {
      shortName: '26测试MTN001', securityId: '102600001.IB', inquiryRange: '1.5-1.8', fieldSource,
    } });
    const marks = context.buildProjectDmRecognitionMarks(patch);
    assert.equal(patch.inquiryLow, 1.5); assert.equal(patch.inquiryHigh, 1.8);
    for (const key of ['inquiryLow', 'inquiryHigh', 'inquiryRanges.0.low', 'inquiryRanges.0.high']) assert.equal(patch.sourceMap[key], expected);
    assert.equal(marks.inquiryLow.source, expected); assert.equal(marks.inquiryHigh.source, expected);
  }
});

function absPayload(providers = ['QB', '', 'DM+QB']) {
  return { source: 'DM+QB', normalized: { isAbs: true, instrumentType: 'ABS',
    absInfo: { planName: '测试资产支持专项计划', totalScale: 6, underlyingAsset: '应收账款' }, fieldSource: { absInfo: 'QB' } },
    issueGroup: { instrumentType: 'ABS', source: 'dm', provider: 'DM+QB', issueName: '测试资产支持专项计划',
      tranches: providers.map((provider, index) => ({ source: 'dm', ...(provider ? { provider } : {}),
        shortName: `26测试优先${String.fromCharCode(65 + index)}`, securityId: `12345${index}.SH`, trancheLevel: `优先${index + 1}级`,
        planScale: index + 1, sharePct: index === 1 ? null : 25, tenor: '2Y', debtRating: 'AAA', inquiryRange: '1.5-1.8' })) } };
}

test('ABS recognition marks use each real tranche provider and retain derived percentages', () => {
  const context = projectHarness(), input = absPayload();
  const patch = context.projectPatchFromDmLookup(input), marks = context.buildProjectDmRecognitionMarks(patch);
  assert.equal(patch.sourceMap['abs.underlyingAsset'], 'qb');
  assert.equal(marks['abs.underlyingAsset'].source, 'qb');
  assert.equal(marks.fullName.source, 'qb');
  for (const [index, expected] of ['qb', 'dm', 'dm+qb'].entries()) {
    for (const field of ['className', 'shortName', 'scale', 'expectedTerm', 'debtRating', 'inquiryLow', 'inquiryHigh']) {
      assert.equal(patch.sourceMap[`abs.tranches.${index}.${field}`], expected, `${index}.${field}`);
      assert.equal(marks[`abs.tranches.${index}.${field}`].source, expected, `${index}.${field}`);
    }
    assert.equal(patch.absInfo.tranches[index].classNameSource, expected);
    assert.equal('provider' in patch.absInfo.tranches[index], false, 'does not add a persistent provider field');
  }
  assert.equal(marks['abs.tranches.1.sharePct'].source, 'derived');
  assert.equal(patch.absInfo.tranches[1].sharePctSource, 'derived');
  assert.equal(marks['abs.tranches.0.sharePct'].source, 'qb');
  assert.equal(marks['abs.tranches.2.sharePct'].source, 'dm+qb');
});

test('ABS legacy data without providers continues to show DM despite the selected route elsewhere', () => {
  const context = projectHarness(), input = absPayload(['', '', '']);
  delete input.source; delete input.normalized.fieldSource; delete input.issueGroup.provider;
  const patch = context.projectPatchFromDmLookup(input), marks = context.buildProjectDmRecognitionMarks(patch);
  assert.equal(marks.fullName.source, 'dm');
  assert.equal(marks['abs.underlyingAsset'].source, 'dm');
  for (let index = 0; index < 3; index++) assert.equal(marks[`abs.tranches.${index}.shortName`].source, 'dm');
});

test('ABS normalized-only values inherit actual payload and tranche provenance without adding storage fields', () => {
  const context = projectHarness();
  const patch = context.projectPatchFromDmLookup({ source: 'QB', normalized: { isAbs: true,
    fullName: '测试资产支持专项计划', fieldSource: { fullName: 'QB' }, absInfo: { type: 'ABS', totalScale: 1,
      underlyingAsset: '应收账款', tranches: [{ shortName: '26测试优先A', className: '优先A级', scale: 1, sharePct: 100 }] } } });
  const marks = context.buildProjectDmRecognitionMarks(patch);
  assert.equal(marks.fullName.source, 'qb');
  assert.equal(marks['abs.underlyingAsset'].source, 'qb');
  assert.equal(marks['abs.tranches.0.shortName'].source, 'qb');
  assert.equal(marks['abs.tranches.0.sharePct'].source, 'qb');
  assert.equal('provider' in patch.absInfo.tranches[0], false);
});

test('multi-tranche inquiry ranges keep their own provider instead of assigning the aggregate group to every range', () => {
  const context = projectHarness();
  const patch = context.projectPatchFromDmLookup({ normalized: { shortName: '26测试MTN001' }, issueGroup: {
    source: 'dm', provider: 'DM+QB', tranches: [
      { shortName: '26测试MTN001A', provider: 'QB', source: 'dm', inquiryRange: '1.5-1.8' },
      { shortName: '26测试MTN001B', source: 'dm', inquiryRange: '1.9-2.1' },
    ],
  } });
  assert.equal(patch.sourceMap.inquiryLow, 'qb');
  assert.equal(patch.sourceMap['inquiryRanges.0.low'], 'qb');
  assert.equal(patch.sourceMap['inquiryRanges.1.low'], 'dm');
  assert.equal(context.buildProjectDmRecognitionMarks(patch)['inquiryRanges.1.low'].source, 'dm');
});

test('secondary summaries show business counts while leaving legacy and actual source metadata intact', () => {
  for (const name of ['updateSecondaryPendingControls', 'updateSecondaryLedgerControls']) {
    for (const [rows, expected] of [
      [[{ dmLookup: { status: 'complete' } }], '1 笔完整'],
      [[{ dmLookup: { status: 'complete', provider: 'QB' } }], '1 笔完整'],
      [[{ dmLookup: { status: 'complete' } }, { dmLookup: { status: 'partial', provider: 'QB' } }], '1 笔完整 · 1 笔待补'],
      [[{ dmLookup: { status: 'error', provider: 'QB', error: '保留原错误明细' } }], '资料查询 1 笔失败 · 可重试'],
      [[], '待读取资料'],
    ]) {
      const elements = new Map(), $ = selector => {
        if (!elements.has(selector)) elements.set(selector, { classList: { toggle() {} }, setAttribute() {} });
        return elements.get(selector);
      };
      const context = vm.createContext({ $, dataProviderLabel, currentDataSourceLabel: () => 'QB', tradeRecordDirtyCellCount: () => 0,
        secondaryPendingDraftRows: rows, secondaryLedgerDraftRows: rows, secondaryPendingSavePending: false, secondaryLedgerSavePending: false,
        secondaryPendingDmLoading: false, secondaryLedgerDmLoading: false, secondaryPendingUndoStack: [], secondaryLedgerUndoStack: [],
        secondaryPendingShowAllColumns: false, secondaryPendingQuickDelete: false });
      const original = JSON.stringify(rows);
      load(context, [name]); context[name]();
      const selector = name === 'updateSecondaryPendingControls' ? '#secondaryPendingDmStatus' : '#secondaryLedgerDmStatus';
      assert.equal(elements.get(selector).textContent, expected, name);
      assert.equal(JSON.stringify(rows), original, 'summary rendering must not rewrite provider or error metadata');
    }
  }
});
