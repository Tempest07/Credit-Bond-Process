import assert from "node:assert/strict";
import test from "node:test";
import { appendBidSubmission, finalizeProjectBid, normalizeProjectRecord, projectCardBidSummary } from "../lifecycle.js";

function submitted() {
  return appendBidSubmission({
    shortName: "26测试MTN001A/B", venue: "银行间", sponsorStatus: "非我行主承",
    tranches: [
      { id: "a", shortName: "26测试MTN001A", durationText: "3Y", bidLevels: [{ bidRate: 1.5999, bidAmount: 0.5 }, { bidRate: 1.61, bidAmount: 1 }] },
      { id: "b", shortName: "26测试MTN001B", durationText: "5Y", bidLevels: [{ bidRate: 1.7, bidAmount: 0.25 }],
        outsourcedBids: [{ managerName: "测试管理人", bidRate: 1.72, bidAmount: 0.1 }] },
    ],
  }).project;
}

test("cards show latest submitted positions with full rate precision and equal tranche labels", () => {
  const summary = projectCardBidSummary(submitted());
  assert.equal(summary.sequence, 1);
  assert.equal(summary.isFinal, false);
  assert.equal(summary.hasDraftChanges, false);
  assert.deepEqual(summary.tranches, [
    { shortName: "26测试MTN001A", duration: "3年", positions: [
      { label: "表内", rate: "1.5999%", amount: "0.5亿" }, { label: "表内", rate: "1.61%", amount: "1亿" }] },
    { shortName: "26测试MTN001B", duration: "5年", positions: [
      { label: "表内", rate: "1.7%", amount: "0.25亿" }, { label: "委外 · 测试管理人", rate: "1.72%", amount: "0.1亿" }] },
  ]);
});

test("unsent changes are flagged, never substituted for the submitted card rates", () => {
  const project = submitted();
  project.tranches[0].bidLevels[0].bidRate = 1.65;
  const draft = projectCardBidSummary(project);
  assert.equal(draft.hasDraftChanges, true);
  assert.equal(draft.tranches[0].positions[0].rate, "1.5999%");
  const second = appendBidSubmission(project).project;
  assert.equal(projectCardBidSummary(second).sequence, 2);
  assert.equal(projectCardBidSummary(second).tranches[0].positions[0].rate, "1.65%");
  assert.equal(projectCardBidSummary(finalizeProjectBid(second).project).isFinal, true);
});

test("cards retain bid context until payment completes, including partial payments", () => {
  const project = submitted();
  for (const status of ["已投标", "已投标结束", "待缴款", "部分中标", "未中标"]) {
    assert.ok(projectCardBidSummary({ ...project, status }));
  }
  const partiallyPaid = normalizeProjectRecord({ ...project, status: "待缴款", resultConfirmed: true,
    tranches: project.tranches.map((t, i) => ({ ...t, resultStatus: "中标", winningAmountWan: 1000, paymentCompleted: i === 0 })),
  });
  assert.equal(projectCardBidSummary(partiallyPaid).tranches.length, 2);
  partiallyPaid.tranches.forEach(t => { t.paymentCompleted = true; });
  assert.equal(projectCardBidSummary(partiallyPaid), null);
  for (const status of ["未投标", "待投标", "已结束", "已缴款"]) {
    assert.equal(projectCardBidSummary({ ...project, status }), null);
  }
});

test("missing history stays blank except for clearly labelled historical resulted records", () => {
  const project = submitted();
  assert.equal(projectCardBidSummary({ ...project, bidSubmissions: [] }), null);
  const historical = normalizeProjectRecord({ ...project, status: "待缴款", bidSubmissions: [] });
  const summary = projectCardBidSummary(historical);
  assert.equal(summary.sequence, null);
  assert.equal(summary.isFinal, false);
  assert.equal(summary.hasDraftChanges, false);
  assert.equal(summary.tranches[0].positions[0].rate, "1.5999%");
  assert.equal(projectCardBidSummary(normalizeProjectRecord({ status: "待缴款" })), null);
});
