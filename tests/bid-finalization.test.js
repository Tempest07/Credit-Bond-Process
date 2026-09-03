import assert from "node:assert/strict";
import test from "node:test";
import {
  appendBidSubmission, dashboardCounts, deriveProjectStatus, finalizeProjectBid,
  hasUnsubmittedBidChanges, normalizeProjectRecord, projectMatchesStatusFilter,
  reopenProjectBid, upsertProject,
} from "../lifecycle.js";
import { buildUnifiedReminders } from "../reminders.js";

function draft() {
  return normalizeProjectRecord({
    id: "final-bid-test", shortName: "26测试MTN001A/B", venue: "银行间", sponsorStatus: "非我行主承",
    cutoffAt: "2026-09-03T18:00", cutoffTimeConfirmed: true,
    tranches: [
      { id: "a", shortName: "26测试MTN001A", durationText: "3Y", suggestedRatio: 20,
        bidLevels: [{ bidRate: 1.6, bidAmount: 1 }],
        outsourcedBids: [{ managerName: "测试机构", bidRate: 1.62, bidAmount: 0.5 }] },
      { id: "b", shortName: "26测试MTN001B", durationText: "5Y", suggestedRatio: 20,
        bidLevels: [{ bidRate: 1.8, bidAmount: 2 }] },
    ],
  });
}

test("final confirmation binds the latest submitted round and survives state round-trips", () => {
  const first = appendBidSubmission(draft()).project;
  assert.equal(first.status, "已投标");
  assert.equal(hasUnsubmittedBidChanges(first), false); // AUTO first-round action must not become a dirty draft.
  const final = finalizeProjectBid(first);
  assert.deepEqual(final.issues, []);
  assert.equal(final.project.status, "已投标结束");
  assert.equal(final.project.finalBidSubmissionId, first.bidSubmissions[0].id);
  assert.deepEqual(final.project.bidSubmissions, first.bidSubmissions);
  assert.equal(deriveProjectStatus(final.project), "已投标结束");
  const restored = normalizeProjectRecord(JSON.parse(JSON.stringify(upsertProject({ projects: [] }, final.project).projects[0])));
  assert.equal(restored.status, "已投标结束");
  assert.equal(restored.finalBidSubmissionId, final.project.finalBidSubmissionId);
  assert.deepEqual(restored.tranches, final.project.tranches);
});

test("continue bidding reopens without deleting bids or history; next submission clears final confirmation", () => {
  const first = appendBidSubmission(draft()).project;
  const final = finalizeProjectBid(first).project;
  const reopened = reopenProjectBid(final);
  assert.deepEqual(reopened.issues, []);
  assert.equal(reopened.project.status, "已投标");
  assert.equal(reopened.project.finalBidSubmissionId, "");
  assert.deepEqual(reopened.project.tranches, final.tranches);
  assert.deepEqual(reopened.project.bidSubmissions, final.bidSubmissions);
  const second = appendBidSubmission(reopened.project);
  assert.equal(second.submission.sequence, 2);
  assert.equal(second.submission.tranches[0].bidAction, "改标");
  assert.equal(hasUnsubmittedBidChanges(second.project), false);
  const finalAgain = finalizeProjectBid(second.project).project;
  assert.equal(finalAgain.finalBidSubmissionId, second.submission.id);
  assert.equal(appendBidSubmission(finalAgain).project.finalBidSubmissionId, "");
});

test("old awaiting-result records remain editable and never become final automatically", () => {
  const old = normalizeProjectRecord({ ...draft(), status: "已投标待结果", bidSubmissions: [] });
  assert.equal(old.status, "已投标");
  assert.equal(old.finalBidSubmissionId, "");
  assert.equal(old.bidSubmissions.length, 1);
  assert.ok(old.bidSubmissions[0].id.startsWith("legacy-"));
  assert.equal(finalizeProjectBid(old).project.status, "已投标结束");
  assert.equal(projectMatchesStatusFilter({ status: "已投标待结果" }, "bidding"), true);
});

test("changed own or outsourced terms invalidate final status at the shared normalization boundary", () => {
  const final = finalizeProjectBid(appendBidSubmission(draft()).project).project;
  const changes = [
    p => { p.tranches[0].bidLevels[0].bidRate = 1.7; },
    p => { p.tranches[0].bidLevels[0].bidAmount = 1.1; },
    p => { p.tranches[0].suggestedRatio = 30; },
    p => { p.tranches[0].durationText = "4Y"; },
    p => { p.tranches[0].bidAction = "改标"; },
    p => { p.tranches[0].outsourcedBids[0].managerName = "另一机构"; },
    p => { p.tranches[0].outsourcedBids[0].bidRate = 1.7; },
    p => { p.tranches[0].outsourcedBids[0].bidAmount = 0.8; },
    p => { p.tranches[0].outsourcedBids = []; },
    p => { p.tranches.pop(); },
    p => { p.tranches[0].bidLevels.push({ bidRate: 1.9, bidAmount: null }); },
  ];
  for (const change of changes) {
    const next = structuredClone(final);
    change(next);
    const normalized = normalizeProjectRecord(next);
    assert.equal(normalized.status, "已投标");
    assert.equal(normalized.finalBidSubmissionId, "");
    assert.ok(finalizeProjectBid(normalized).issues.length);
    assert.deepEqual(normalized.bidSubmissions, final.bidSubmissions);
  }
});

test("valuation, result metadata, cutoff and regenerated field IDs do not reopen finalized bidding", () => {
  const final = finalizeProjectBid(appendBidSubmission(draft()).project).project;
  const updated = normalizeProjectRecord({ ...final, ftpCost: 1.5, cutoffAt: "2026-09-03T19:00",
    tranches: final.tranches.map(t => ({ ...t, marketValuation: 1.8, pricingRate: 1.9, paymentDate: "2026-09-04",
      bidLevels: t.bidLevels.map(level => ({ ...level, id: crypto.randomUUID() })) })),
  });
  assert.equal(updated.status, "已投标结束");
  assert.equal(updated.finalBidSubmissionId, final.finalBidSubmissionId);
});

test("unsubmitted, terminated and resulted records cannot be marked final or reopened", () => {
  assert.ok(finalizeProjectBid(draft()).issues.length);
  const final = finalizeProjectBid(appendBidSubmission(draft()).project).project;
  for (const status of ["未中标", "已中标", "待缴款", "已缴款", "已结束"]) {
    const project = normalizeProjectRecord({ ...final, status });
    assert.ok(finalizeProjectBid(project).issues.length);
    assert.ok(reopenProjectBid(project).issues.length);
    assert.equal(appendBidSubmission(project).submission, null);
  }
  const wrongRound = normalizeProjectRecord({ ...final, finalBidSubmissionId: "not-the-latest-round" });
  assert.equal(wrongRound.status, "已投标");
});

test("both bid stages transition into existing award and payment outcomes", () => {
  const submitted = appendBidSubmission(draft()).project;
  for (const project of [submitted, finalizeProjectBid(submitted).project]) {
    const notWon = normalizeProjectRecord({ ...project, resultConfirmed: true,
      tranches: project.tranches.map(t => ({ ...t, resultStatus: "未中标" })),
    });
    assert.equal(deriveProjectStatus(notWon), "未中标");
    assert.equal(projectMatchesStatusFilter(notWon, "resulted"), true);
    assert.equal(projectMatchesStatusFilter(notWon, "bidding"), false);
    assert.equal(projectMatchesStatusFilter(notWon, "bidFinal"), false);
    const payment = normalizeProjectRecord({ ...project, resultConfirmed: true,
      tranches: project.tranches.map(t => ({ ...t, resultStatus: "中标", winningAmountWan: 10000, paymentDate: "2026-09-04" })),
    });
    assert.equal(deriveProjectStatus(payment), "待缴款");
    payment.tranches.forEach(t => { t.paymentCompleted = true; });
    assert.equal(deriveProjectStatus(payment), "已缴款");
  }
});

test("top counts and status filtering share the same four-stage membership", () => {
  const submitted = appendBidSubmission(draft()).project;
  const projects = [draft(), submitted, finalizeProjectBid(submitted).project,
    ...["部分中标", "已中标", "未中标", "待缴款", "已缴款", "已结束"].map(status => normalizeProjectRecord({ ...draft(), status })),
  ];
  const counts = dashboardCounts(projects);
  for (const filter of ["toBid", "bidding", "bidFinal", "resulted"]) {
    assert.equal(counts[filter], projects.filter(p => projectMatchesStatusFilter(p, filter)).length);
  }
  assert.equal(counts.bidding, 1);
  assert.equal(counts.bidFinal, 1);
  assert.equal(counts.resulted, 5);
  assert.equal(counts.awaitingResult, 2);
  assert.equal(projects.filter(p => projectMatchesStatusFilter(p, "待缴款")).length, 1);
});

test("result reminders cover editable and finalized bids without classifying either as unbid", () => {
  const submitted = appendBidSubmission(draft()).project;
  const final = { ...finalizeProjectBid(submitted).project, id: "final" };
  const reminders = buildUnifiedReminders({ projects: [submitted, final] }, new Date("2026-09-03T19:00:00"));
  assert.deepEqual(reminders.filter(r => r.kind === "project-result").map(r => r.sourceId).sort(), ["final", "final-bid-test"]);
  assert.equal(reminders.some(r => r.kind === "project-bid" || r.kind === "flow-mail"), false);
});
