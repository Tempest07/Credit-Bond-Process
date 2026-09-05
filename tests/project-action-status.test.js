import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { appendBidSubmission, finalizeProjectBid, normalizeProjectRecord } from "../lifecycle.js";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness(project) {
  let current = structuredClone(project);
  const elements = new Map();
  const saves = [];
  const context = vm.createContext({
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    },
    readProjectForm: () => structuredClone(current),
    saveProjectRecordNow: draft => { current = normalizeProjectRecord(draft); saves.push(current); },
    closeResultEntryPanel() {}, setResultEntryFieldsVisible() {}, showToast() {},
    updateProjectResultQueueState() {},
  });
  for (const name of ["projectActionAvailability", "setProjectActionStatus", "updateProjectActionButtons"]) {
    const start = app.indexOf(`function ${name}(`);
    const end = app.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(app.slice(start, end), context);
  }
  return { context, elements, saves, current: () => current };
}

test("project actions allow direct termination throughout bidding and withdrawal after termination", () => {
  for (const [status, terminate, withdraw] of [
    ["未投标", true, false], ["已投标", true, true],
    ["已投标结束", true, false], ["已结束", false, true],
    ...["部分中标", "已中标", "未中标", "待缴款", "已缴款"].map(status => [status, false, false]),
  ]) {
    const h = harness({ status });
    h.context.updateProjectActionButtons({ status });
    assert.equal(h.elements.get("#terminateProjectButton").disabled, !terminate, status);
    assert.equal(h.elements.get("#markUnbidButton").disabled, !withdraw, status);
  }
});

test("finalized multi-tranche project terminates and withdraws without losing bids or current edits", () => {
  const draft = normalizeProjectRecord({
    id: "action-test", shortName: "测试MTN001A/B", venue: "银行间",
    tranches: [
      { id: "a", shortName: "测试MTN001A", durationText: "3Y", suggestedRatio: 20,
        bidLevels: [{ bidRate: 1.6, bidAmount: 1 }],
        outsourcedBids: [{ managerName: "测试机构", bidRate: 1.65, bidAmount: 0.5 }] },
      { id: "b", shortName: "测试MTN001B", durationText: "5Y", suggestedRatio: 20,
        bidLevels: [{ bidRate: 1.8, bidAmount: 2 }] },
    ],
  });
  const final = finalizeProjectBid(appendBidSubmission(draft).project).project;
  assert.equal(final.status, "已投标结束");
  final.opinion = "保留尚未自动保存的流程意见";
  const h = harness(final);
  for (const status of ["已结束", "未投标"]) {
    h.context.setProjectActionStatus(status);
    const saved = h.current();
    assert.equal(saved.status, status);
    assert.equal(saved.resultConfirmed, false);
    assert.equal(saved.finalBidSubmissionId, "");
    assert.equal(saved.opinion, final.opinion);
    assert.deepEqual(saved.tranches, final.tranches);
    assert.deepEqual(saved.bidSubmissions, final.bidSubmissions);
  }
  assert.equal(h.saves.length, 2);
  assert.equal(appendBidSubmission(h.current()).submission.sequence, 2);
});

test("result-confirmed and payment projects cannot be terminated or withdrawn by the action handler", () => {
  for (const project of [
    { status: "已投标结束", resultConfirmed: true },
    ...["部分中标", "已中标", "未中标", "待缴款", "已缴款"].map(status => ({ status })),
  ]) {
    const h = harness(project);
    h.context.updateProjectActionButtons(project);
    assert.equal(h.elements.get("#terminateProjectButton").disabled, true);
    assert.equal(h.elements.get("#markUnbidButton").disabled, true);
    h.context.setProjectActionStatus("已结束");
    h.context.setProjectActionStatus("未投标");
    assert.equal(h.saves.length, 0);
    assert.deepEqual(h.current(), project);
  }
});
