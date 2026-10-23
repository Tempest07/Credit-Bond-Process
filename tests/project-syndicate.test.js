import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  createProjectRecord,
  isExternalInterbankProject,
  normalizeProjectRecord,
  upsertProject,
} from "../lifecycle.js";
import { validateState } from "../functions/api/state.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function load(context, ...names) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start, name);
    vm.runInContext(source.slice(start, end), context);
  }
}

function externalProject(input = {}) {
  return normalizeProjectRecord({
    id: "p1", shortName: "26测试MTN001A/B", venue: "银行间", sponsorStatus: "非我行主承",
    targetQuoteNote: "1.60% 3000万", notes: "原资料", ...input,
  });
}

test("syndicate controls apply only to explicitly external interbank projects", () => {
  assert.equal(isExternalInterbankProject(externalProject()), true);
  for (const venue of ["", "上交所", "深交所", "北交所", "交易所", "银行间市场", "interbank"]) {
    assert.equal(isExternalInterbankProject({ venue, sponsorStatus: "非我行主承" }), false, venue);
  }
  for (const sponsorStatus of ["", "牵头", "联席", "我行主承", "身份待补"]) {
    assert.equal(isExternalInterbankProject({ venue: "银行间", sponsorStatus }), false, sponsorStatus);
  }
  assert.equal(isExternalInterbankProject({}), false);
});

test("older projects do not acquire a persisted syndicate flag or infer it from a bid action", () => {
  const project = externalProject({
    tranches: [{ id: "t1", shortName: "26测试MTN001", bidAction: "参团+投标", bidRate: 1.6, bidAmount: 0.3 }],
  });
  assert.equal(Object.hasOwn(project, "syndicateJoined"), false);
  const saved = upsertProject({ issuers: [], projects: [] }, project);
  const reloaded = normalizeProjectRecord(JSON.parse(JSON.stringify(validateState(saved))).projects[0]);
  assert.equal(Object.hasOwn(reloaded, "syndicateJoined"), false);
  assert.equal(reloaded.tranches[0].bidAction, "参团+投标");
});

test("only explicit booleans are accepted as stored syndicate participation", () => {
  for (const value of [true, false]) {
    const project = externalProject({ syndicateJoined: value });
    assert.equal(Object.hasOwn(project, "syndicateJoined"), true);
    assert.equal(project.syndicateJoined, value);
  }
  for (const value of [undefined, null, 0, 1, "true", "false", {}, []]) {
    assert.equal(Object.hasOwn(externalProject({ syndicateJoined: value }), "syndicateJoined"), false);
  }
});

test("participation survives creation, validation, JSON reload and upsert independently of notes", () => {
  for (const joined of [true, false]) {
    const created = createProjectRecord({
      shortName: "26测试MTN001", venue: "银行间", sponsorStatus: "非我行主承",
    }, null, {}, { syndicateJoined: joined, targetQuoteNote: "目标 3000 万", notes: "保留资料" });
    const saved = upsertProject({ issuers: [], projects: [] }, created);
    const reloaded = normalizeProjectRecord(JSON.parse(JSON.stringify(validateState(saved))).projects[0]);
    assert.equal(reloaded.syndicateJoined, joined);
    assert.equal(reloaded.targetQuoteNote, "目标 3000 万");
    assert.equal(reloaded.notes, "保留资料");
  }
  const legacy = createProjectRecord({ shortName: "旧项目" }, null, {});
  assert.equal(Object.hasOwn(legacy, "syndicateJoined"), false);
});

test("project-level participation covers multiple tranches and interbank ABN without rewriting them", () => {
  for (const instrumentType of ["", "ABN", "ABS"]) {
    const project = externalProject({
      instrumentType,
      syndicateJoined: true,
      tranches: [
        { id: "ta", shortName: "26测试A", durationText: "3Y", bidAction: "投标" },
        { id: "tb", shortName: "26测试B", durationText: "5Y", bidAction: "改标" },
      ],
    });
    assert.equal(isExternalInterbankProject(project), true);
    assert.equal(project.syndicateJoined, true);
    assert.equal(project.tranches.length, 2);
    assert.deepEqual(project.tranches.map(item => item.bidAction), ["投标", "改标"]);
    assert.ok(project.tranches.every(item => !Object.hasOwn(item, "syndicateJoined")));
  }
});

test("re-recognition preserves manual participation and leaves older absent flags absent", () => {
  const context = vm.createContext({
    createProjectRecord, normalizeProjectRecord,
    mergeExistingProjectTranches: (_previous, next) => next.tranches,
  });
  load(context, "buildLedgerProjectRecord");
  for (const joined of [undefined, true, false]) {
    const existing = externalProject({ syndicateJoined: joined });
    const updated = context.buildLedgerProjectRecord({
      shortName: existing.shortName, issueScale: 8, venue: "银行间", sponsorStatus: "非我行主承",
    }, null, { suggestion: { trancheSuggestions: [] } }, existing, { cutoffAt: "2026-10-23T18:00" });
    assert.equal(updated.id, existing.id);
    assert.equal(updated.issueScale, 8);
    assert.equal(Object.hasOwn(updated, "syndicateJoined"), typeof joined === "boolean");
    assert.equal(updated.syndicateJoined, joined);
    assert.equal(updated.targetQuoteNote, existing.targetQuoteNote);
    assert.equal(updated.notes, existing.notes);
  }
});

function saveHarness(project = externalProject()) {
  let pending;
  let snapshot;
  let writes = 0;
  let flushes = 0;
  const context = vm.createContext({
    state: { issuers: [], projects: [project] },
    projectAutoSaveTimer: null,
    projectTargetNotes: { flush() { flushes += 1; return true; } },
    isExternalInterbankProject,
    upsertProject,
    saveProjectDraftNow() {
      context.projectAutoSaveTimer = null;
      context.state = upsertProject(context.state, pending);
    },
    persistState() { writes += 1; snapshot = JSON.stringify(context.state); },
  });
  load(context, "saveProjectSyndicateJoined", "flushProjectDraftToLocal");
  return {
    context,
    setPending(patch = {}) {
      pending = { ...context.state.projects[0], notes: "详情刚更新的资料", ...patch };
      context.projectAutoSaveTimer = 1;
    },
    get writes() { return writes; },
    get flushes() { return flushes; },
    get saved() { return snapshot ? JSON.parse(snapshot) : null; },
  };
}

test("participation toggle flushes both detail and inline-note drafts before reading the project", () => {
  const h = saveHarness();
  h.setPending();
  h.context.projectTargetNotes = { flush() {
    assert.equal(h.context.projectAutoSaveTimer, null);
    assert.equal(h.context.state.projects[0].notes, "详情刚更新的资料");
    h.context.state = upsertProject(h.context.state, { ...h.context.state.projects[0], targetQuoteNote: "备注刚编辑" });
    return true;
  } };
  assert.equal(h.context.saveProjectSyndicateJoined("p1", true), true);
  assert.equal(h.saved.projects[0].syndicateJoined, true);
  assert.equal(h.saved.projects[0].notes, "详情刚更新的资料");
  assert.equal(h.saved.projects[0].targetQuoteNote, "备注刚编辑");
  assert.equal(h.writes, 1);
});

test("failed inline-note flushing stops participation updates and persistence", () => {
  const h = saveHarness();
  const previous = h.context.state;
  h.context.projectTargetNotes = { flush: () => false };
  assert.equal(h.context.saveProjectSyndicateJoined("p1", true), false);
  assert.equal(h.context.state, previous);
  assert.equal(h.writes, 0);
  assert.equal(Object.hasOwn(h.context.state.projects[0], "syndicateJoined"), false);
  h.context.projectTargetNotes = { flush() { throw new Error("note save failed"); } };
  assert.throws(() => h.context.saveProjectSyndicateJoined("p1", true), /note save failed/);
  assert.equal(h.context.state, previous);
  assert.equal(h.writes, 0);
});

test("same participation state is a no-op after flushing and cancellation stores explicit false", () => {
  const legacy = saveHarness();
  assert.equal(legacy.context.saveProjectSyndicateJoined("p1", false), true);
  assert.equal(legacy.writes, 0);
  assert.equal(Object.hasOwn(legacy.context.state.projects[0], "syndicateJoined"), false);
  const h = saveHarness(externalProject({ syndicateJoined: true }));
  assert.equal(h.context.saveProjectSyndicateJoined("p1", true), true);
  assert.equal(h.writes, 0);
  assert.equal(h.flushes, 1);
  assert.equal(h.context.saveProjectSyndicateJoined("p1", false), true);
  assert.equal(h.saved.projects[0].syndicateJoined, false);
  assert.equal(h.writes, 1);
  assert.equal(h.context.saveProjectSyndicateJoined("p1", false), true);
  assert.equal(h.writes, 1);
});

test("participation rejects missing and ineligible projects including eligibility changed by a pending draft", () => {
  const h = saveHarness();
  assert.throws(() => h.context.saveProjectSyndicateJoined("deleted", true));
  assert.equal(h.writes, 0);
  h.setPending({ sponsorStatus: "联席" });
  assert.throws(() => h.context.saveProjectSyndicateJoined("p1", true));
  assert.equal(h.context.state.projects[0].sponsorStatus, "联席");
  assert.equal(h.writes, 0);
  assert.equal(Object.hasOwn(h.context.state.projects[0], "syndicateJoined"), false);
  for (const project of [externalProject({ venue: "上交所" }), externalProject({ sponsorStatus: "" })]) {
    const invalid = saveHarness(project);
    assert.throws(() => invalid.context.saveProjectSyndicateJoined("p1", true));
    assert.equal(invalid.writes, 0);
  }
});

test("persistence failure restores the state after flushing and a retry saves participation", () => {
  const h = saveHarness();
  h.setPending();
  const persist = h.context.persistState;
  h.context.persistState = () => { throw new Error("quota"); };
  assert.throws(() => h.context.saveProjectSyndicateJoined("p1", true), /quota/);
  assert.equal(Object.hasOwn(h.context.state.projects[0], "syndicateJoined"), false);
  assert.equal(h.context.state.projects[0].notes, "详情刚更新的资料");
  h.context.persistState = persist;
  assert.equal(h.context.saveProjectSyndicateJoined("p1", true), true);
  assert.equal(h.saved.projects[0].syndicateJoined, true);
  assert.equal(h.saved.projects[0].notes, "详情刚更新的资料");
});

test("participation changes do not rewrite bid actions, submissions, results, payments or remarks", () => {
  const project = externalProject({
    status: "待缴款", resultConfirmed: true, resultAdvertisement: "发行结果原文",
    tranches: [
      { id: "ta", shortName: "26测试MTN001A", bidAction: "投标", bidRate: 1.6, bidAmount: 0.3,
        resultStatus: "中标", winningRate: 1.6, winningAmountWan: 3000, paymentDate: "2026-10-26",
        prepaymentNumber: "W2026102300010", prepaymentRecordedAt: "2026-10-23T10:00:00Z" },
      { id: "tb", shortName: "26测试MTN001B", bidAction: "参团+投标", bidRate: 1.8, bidAmount: 0.2 },
    ],
    bidSubmissions: [{ id: "bid1", sequence: 1, submittedAt: "2026-10-23T09:00:00Z", tranches: [
      { trancheId: "ta", shortName: "26测试MTN001A", bidAction: "投标", bidLevels: [{ id: "l1", bidRate: 1.6, bidAmount: 0.3 }] },
    ] }],
  });
  const h = saveHarness(project);
  h.context.saveProjectSyndicateJoined("p1", true);
  h.context.saveProjectSyndicateJoined("p1", false);
  const saved = h.saved.projects[0];
  for (const key of ["tranches", "bidSubmissions", "status", "resultConfirmed", "resultAdvertisement", "notes", "targetQuoteNote", "createdAt"]) {
    assert.deepEqual(saved[key], project[key], key);
  }
  assert.equal(saved.syndicateJoined, false);
});
