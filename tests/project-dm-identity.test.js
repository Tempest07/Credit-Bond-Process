import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { replaceProjectWithDmLookup } from "../core.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness() {
  const context = vm.createContext({
    normalizeDmTenor: value => value || "",
    parseDmInquiryRange: () => ({ low: null, high: null }),
    sumFinite: () => null,
    numberOrNull: value => value == null ? null : Number(value),
    valueHasContent: value => value != null && value !== "",
    normalizeGuaranteeInfo: () => ({ guarantors: [] }),
    escapeRegExpForPattern: value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  });
  for (const name of [
    "projectPatchFromDmLookup", "projectDmIssueGroupForIdentity", "projectDmUsableTranches",
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

test("a direct code match keeps a valid group even when queried by a bare code", () => {
  const context = harness();
  const group = { tranches: [{ shortName: "26鄂交05", securityId: "525044.SZ" }, { shortName: "26鄂交06" }] };
  assert.equal(context.projectDmIssueGroupForIdentity({ query: { securityId: "525044" }, issueGroup: group }), group);
  assert.equal(context.projectDmIssueGroupForIdentity({ query: { securityId: "525044.SH" }, issueGroup: group }), null);
});

test("base MTN queries retain A/B tranches without crossing issuance numbers", () => {
  const context = harness();
  const group = { tranches: [{ shortName: "26广州产投MTN003A" }, { shortName: "26广州产投MTN003B" }] };
  const payload = { normalized: { shortName: "26广州产投MTN003" }, issueGroup: group };
  assert.equal(context.projectPatchFromDmLookup(payload).shortName, "26广州产投MTN003A/B");
  assert.equal(context.projectDmIssueGroupForIdentity({ ...payload, normalized: { shortName: "26广州产投MTN005" } }), null);
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
  assert.equal(context.projectDmIssueGroupForIdentity({ query: { fullName: "测试专项计划" }, issueGroup: group }), group);
  const normalizedGroup = { tranches: group.tranches };
  assert.equal(context.projectDmIssueGroupForIdentity({ normalized: { isAbs: true, issueGroup: normalizedGroup } }), normalizedGroup);
});
