import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { replaceProjectWithDmLookup, durationParts, durationToDays } from "../core.js";
import { normalizeLookupPayload } from "../bond-identity.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness() {
  const context = vm.createContext({
    normalizeLookupPayload,
    durationParts, durationToDays,
    normalizeDmTenor: value => value || "",
    parseDmInquiryRange: () => ({ low: null, high: null }),
    sumFinite: () => null,
    numberOrNull: value => value == null ? null : Number(value),
    valueHasContent: value => value != null && value !== "",
    normalizeGuaranteeInfo: () => ({ guarantors: [] }),
    escapeRegExpForPattern: value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  });
  for (const name of [
    "projectPatchFromDmLookup", "checkedDmLookupPayload", "projectDmUsableTranches",
    "sortProjectDmTranches", "compactProjectShortNames", "projectCompactShortNameParts",
    "compareProjectShortNameOrder", "projectShortNameSortParts", "normalizeProjectShortNameForSort",
    "projectLetterSortValue", "uniqueNonEmpty", "assignProjectDmValueWithSource", "assignProjectDmValue",
    "projectSourceFromDmIssueGroup", "normalizedProjectFieldSource", "dmProjectFullNameForProject",
  ]) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf("\nfunction ", start + 1)), context);
  }
  return context;
}

test("DM 26鄂交05 remains 05 when a stale cloud group contains only 03/04", () => {
  const context = harness();
  const patch = context.projectPatchFromDmLookup({
    query: { shortName: "26鄂交05" },
    normalized: { shortName: "26鄂交05", securityId: "525044.SZ" },
    issueGroup: { source: "cloud-db", tranches: [
      { shortName: "26鄂交03", status: "issued", isQueriedInput: false, isDmMatched: false },
      { shortName: "26鄂交04", status: "issued", isQueriedInput: false, isDmMatched: false },
    ] },
  });
  const project = replaceProjectWithDmLookup({ shortName: "26鄂交03/04", shortNames: ["26鄂交03", "26鄂交04"] }, patch);
  assert.equal(project.shortName, "26鄂交05");
  assert.deepEqual(project.shortNames, ["26鄂交05"]);
  assert.equal(project.tranchePricing.length, 1);
});

test("a direct code match keeps the target but does not admit an unproven sibling", () => {
  const context = harness();
  const group = { tranches: [{ shortName: "26鄂交05", securityId: "525044.SZ" }, { shortName: "26鄂交06" }] };
  const payload = { query: { securityId: "525044" }, normalized: { shortName: "26鄂交05", securityId: "525044.SZ" }, issueGroup: group };
  const checked = context.checkedDmLookupPayload(payload);
  assert.deepEqual(checked.issueGroup.tranches.map(row => row.shortName), ["26鄂交05"]);
  assert.equal(context.projectPatchFromDmLookup(payload).shortName, "26鄂交05");
  assert.equal(context.checkedDmLookupPayload({ query: { securityId: "525044.SH" }, issueGroup: group }).issueGroup, null);
});

test("base MTN queries retain A/B tranches without crossing issuance numbers", () => {
  const context = harness();
  const group = { tranches: [{ shortName: "26广州产投MTN003A" }, { shortName: "26广州产投MTN003B" }] };
  const payload = { normalized: { shortName: "26广州产投MTN003" }, issueGroup: group };
  assert.equal(context.projectPatchFromDmLookup(payload).shortName, "26广州产投MTN003A/B");
  assert.equal(context.checkedDmLookupPayload({ ...payload, normalized: { shortName: "26广州产投MTN005" } }).issueGroup, null);
});

test("an explicit reallocation from the queried bond retains the destination", () => {
  const context = harness();
  const group = { tranches: [
    { shortName: "26测试MTN001A", status: "reallocated", reallocationTargetShortName: "26测试MTN001B" },
    { shortName: "26测试MTN001B", status: "issued" },
  ] };
  const payload = { query: { shortName: "26测试MTN001A" }, normalized: { shortName: "26测试MTN001A" }, issueGroup: group };
  assert.equal(context.projectPatchFromDmLookup(payload).shortName, "26测试MTN001B");
  delete group.tranches[0].reallocationTargetShortName;
  assert.equal(context.projectPatchFromDmLookup(payload).shortName, "26测试MTN001A");
});

test("ABS plan and class grouping retains its existing identity rules", () => {
  const context = harness();
  const group = { instrumentType: "ABS", tranches: [{ shortName: "优先A" }, { shortName: "优先B" }] };
  assert.deepEqual(context.checkedDmLookupPayload({ query: { fullName: "测试专项计划" }, issueGroup: group }).issueGroup, group);
  const normalizedGroup = { tranches: group.tranches };
  assert.deepEqual(context.checkedDmLookupPayload({ normalized: { isAbs: true, issueGroup: normalizedGroup } }).issueGroup, normalizedGroup);
});

test('QB fills preserve per-field source when constructing a new project', () => {
  const context = harness();
  const patch = context.projectPatchFromDmLookup({ normalized: {
    shortName: '26测试MTN001', securityId: '102600001.IB', durationText: '3年', issueScaleYi: 5,
    impliedRating: 'AA+', fieldSource: { shortName: 'QB', durationText: 'QB', issueScaleYi: 'QB' },
    ratingSource: { impliedRating: 'qb-implied-rating' },
  } });
  assert.equal(patch.shortName, '26测试MTN001');
  assert.equal(patch.sourceMap.shortName, 'qb');
  assert.equal(patch.sourceMap.durationText, 'qb');
  assert.equal(patch.sourceMap.issueScale, 'qb');
  assert.equal(patch.sourceMap.hiddenRating, 'qb');
  assert.equal(patch.hiddenRatingSource, 'qb-implied-rating');
});
