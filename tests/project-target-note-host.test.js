import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createProjectRecord, normalizeProjectRecord, upsertProject } from "../lifecycle.js";
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

test("manual target notes survive normalization, state validation and a JSON reload independently of source notes", () => {
  const text = "目标 3000 万\n1.50% 以内";
  const record = createProjectRecord({ shortName: "26测试MTN001" }, null, {}, {
    targetQuoteNote: `  ${text.replace(/\n/g, "\r\n")}  `, notes: "原始资料",
  });
  const saved = upsertProject({ issuers: [], projects: [] }, record);
  const reloaded = normalizeProjectRecord(JSON.parse(JSON.stringify(validateState(saved))).projects[0]);
  assert.equal(reloaded.targetQuoteNote, text);
  assert.equal(reloaded.notes, "原始资料");
  assert.equal(reloaded.sourceText, "");
  assert.equal(normalizeProjectRecord({ shortName: "旧项目" }).targetQuoteNote, "");
  assert.equal(normalizeProjectRecord({ targetQuoteNote: "字".repeat(2100) }).targetQuoteNote.length, 2100);
});

test("re-recognition updates project facts while retaining the manually entered target note", () => {
  const existing = normalizeProjectRecord({
    id: "p1", shortName: "26测试MTN001", targetQuoteNote: "5000 万，1.8%", notes: "原资料", paymentReceiptRequired: false,
  });
  const context = vm.createContext({
    createProjectRecord, normalizeProjectRecord,
    mergeExistingProjectTranches: (_previous, next) => next.tranches,
  });
  load(context, "buildLedgerProjectRecord");
  const updated = context.buildLedgerProjectRecord({ shortName: existing.shortName, issueScale: 8 }, null,
    { suggestion: { trancheSuggestions: [] } }, existing, { cutoffAt: "2026-10-20T18:00" });
  assert.equal(updated.id, existing.id);
  assert.equal(updated.issueScale, 8);
  assert.equal(updated.targetQuoteNote, existing.targetQuoteNote);
  assert.equal(updated.notes, existing.notes);
  assert.equal(updated.paymentReceiptRequired, false);
});

function saveHarness() {
  let pending;
  let snapshot;
  let writes = 0;
  const context = vm.createContext({
    state: { issuers: [], projects: [normalizeProjectRecord({ id: "p1", shortName: "26测试MTN001", targetQuoteNote: "原备注" })] },
    projectAutoSaveTimer: null,
    upsertProject,
    saveProjectDraftNow() {
      context.projectAutoSaveTimer = null;
      context.state = upsertProject(context.state, pending);
    },
    persistState() { writes += 1; snapshot = JSON.stringify(context.state); },
  });
  load(context, "saveProjectTargetQuoteNote", "flushProjectDraftToLocal");
  return {
    context,
    setPending() {
      pending = { ...context.state.projects[0], notes: "详情中刚修改的资料" };
      context.projectAutoSaveTimer = 1;
    },
    get writes() { return writes; },
    get saved() { return JSON.parse(snapshot); },
  };
}

test("an older detail-form autosave lands before the target note and cannot revert it", () => {
  const h = saveHarness();
  h.setPending();
  h.context.saveProjectTargetQuoteNote("p1", "目标 3000 万");
  assert.equal(h.context.projectAutoSaveTimer, null);
  assert.equal(h.saved.projects[0].targetQuoteNote, "目标 3000 万");
  assert.equal(h.saved.projects[0].notes, "详情中刚修改的资料");
  h.context.saveProjectTargetQuoteNote("p1", "目标 3000 万");
  assert.equal(h.writes, 1);
  h.context.saveProjectTargetQuoteNote("p1", "");
  assert.equal(h.saved.projects[0].targetQuoteNote, "");
});

test("local storage failure leaves the old value so a retry actually persists the note", () => {
  const h = saveHarness();
  const persist = h.context.persistState;
  h.context.persistState = () => { throw new Error("quota"); };
  assert.throws(() => h.context.saveProjectTargetQuoteNote("p1", "新备注"), /quota/);
  assert.equal(h.context.state.projects[0].targetQuoteNote, "原备注");
  h.context.persistState = persist;
  h.context.saveProjectTargetQuoteNote("p1", "新备注");
  assert.equal(h.saved.projects[0].targetQuoteNote, "新备注");
  assert.throws(() => h.context.saveProjectTargetQuoteNote("deleted", "备注"), /项目已不存在/);
});

test("page-exit flushing saves the pending form first and propagates inline save failure", () => {
  const h = saveHarness();
  h.setPending();
  h.context.projectTargetNotes = { flush() {
    assert.equal(h.context.projectAutoSaveTimer, null);
    assert.equal(h.context.state.projects[0].notes, "详情中刚修改的资料");
    return false;
  } };
  assert.equal(h.context.flushProjectDraftToLocal(), false);
  h.context.projectTargetNotes = { flush: () => true };
  assert.equal(h.context.flushProjectDraftToLocal(), true);
});
