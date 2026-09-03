import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createProjectRecord, normalizeProjectRecord, resolveNewProjectCutoff, suggestProjectCutoff } from "../lifecycle.js";

const draft = { shortName: "26测试PPN001", venue: "银行间", durationText: "3Y", sourceText: "" };
const evening = new Date("2026-09-03T18:10:00");
const existing = normalizeProjectRecord({ ...draft, cutoffAt: "2026-09-03T18:00", cutoffSource: "簿记日期", cutoffTimeConfirmed: true });

test("same-name project preview resolves the saved date rather than a conflicting smart default", () => {
  assert.equal(suggestProjectCutoff(draft, null, evening).cutoffAt, "2026-09-04T18:00");
  const preview = resolveNewProjectCutoff(draft, null, evening, { existingProject: existing });
  assert.equal(preview.cutoffAt, "2026-09-03T18:00");
  assert.equal(preview.cutoffSource, "簿记日期");
  const saved = createProjectRecord(draft, null, {}, preview);
  assert.equal(saved.cutoffAt, preview.cutoffAt);
  assert.deepEqual(saved.cutoffHistory, []);
});

test("explicit next-business-day selection replaces the old deadline and records the change", () => {
  const preview = resolveNewProjectCutoff({ ...draft, subscribeDate: "2026-09-03" }, null, evening, {
    existingProject: existing, dayMode: "next-business-day",
  });
  const saved = createProjectRecord(draft, null, {}, preview);
  assert.equal(preview.cutoffAt, "2026-09-04T18:00");
  assert.equal(saved.cutoffAt, preview.cutoffAt);
  assert.equal(saved.cutoffSource, "新增时选择下一工作日");
  assert.equal(saved.cutoffHistory.length, 1);
  assert.equal(saved.cutoffHistory[0].from, "2026-09-03T18:00");
  assert.equal(saved.cutoffHistory[0].to, "2026-09-04T18:00");
  const sameAgain = resolveNewProjectCutoff(draft, null, evening, { existingProject: saved, dayMode: "next-business-day" });
  assert.deepEqual(sameAgain.cutoffHistory, saved.cutoffHistory);
});

test("manual existing dates stay intact in auto mode; explicit today really overrides them", () => {
  const manual = { ...existing, cutoffAt: "2026-09-07T19:30", cutoffSource: "手工延期", cutoffTimeConfirmed: false };
  const auto = resolveNewProjectCutoff({ ...draft, subscribeDate: "2026-09-04" }, null, evening, { existingProject: manual });
  assert.equal(auto.cutoffAt, manual.cutoffAt);
  assert.equal(auto.cutoffTimeConfirmed, false);
  assert.equal(auto.cutoffSource, "手工延期");
  const today = resolveNewProjectCutoff(draft, null, evening, { existingProject: manual, dayMode: "today" });
  assert.equal(today.cutoffAt, "2026-09-03T18:00");
  assert.equal(today.cutoffHistory[0].from, manual.cutoffAt);
});

test("new-project save pins the displayed preview across the default-time boundary", () => {
  const beforeCutoff = new Date("2026-09-03T17:59:00");
  const preview = resolveNewProjectCutoff(draft, null, beforeCutoff);
  const saved = createProjectRecord(draft, null, {}, { ...preview, referenceDate: evening });
  assert.equal(preview.cutoffAt, "2026-09-03T18:00");
  assert.equal(saved.cutoffAt, preview.cutoffAt);
  const newEvening = resolveNewProjectCutoff(draft, null, evening);
  assert.equal(createProjectRecord(draft, null, {}, newEvening).cutoffAt, "2026-09-04T18:00");
});

test("missing existing deadline uses new-project rules without mixing batch project dates", () => {
  const book = resolveNewProjectCutoff({ ...draft, subscribeDate: "2026-09-08" }, null, evening, { existingProject: { ...existing, cutoffAt: "" } });
  assert.equal(book.cutoffAt, "2026-09-08T18:00");
  assert.equal(book.cutoffSource, "簿记日期");
  const exchange = resolveNewProjectCutoff({ ...draft, venue: "上交所" }, null, evening);
  assert.equal(exchange.cutoffAt, "2026-09-03T19:00");
  assert.equal(resolveNewProjectCutoff(draft, null, evening).cutoffAt, "2026-09-04T18:00");
});

test("ledger save keeps batch existing deadlines despite a prior single-project day choice", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("function buildLedgerProjectRecord(");
  const end = app.indexOf("function mergeExistingProjectTranches(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    createProjectRecord, normalizeProjectRecord, resolveNewProjectCutoff,
    newProjectCutoffMode: "next-business-day",
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [evening])); } },
    mergeExistingProjectTranches: (_existing, created) => created.tranches,
  });
  vm.runInContext(app.slice(start, end), context);
  const generated = { suggestion: { trancheSuggestions: [] } };
  const savedBatch = context.buildLedgerProjectRecord(draft, null, generated, existing);
  assert.equal(savedBatch.cutoffAt, "2026-09-03T18:00");
  assert.equal(savedBatch.cutoffSource, "簿记日期");
  assert.deepEqual(savedBatch.cutoffHistory, []);
  const newBatch = context.buildLedgerProjectRecord(draft, null, generated);
  assert.equal(newBatch.cutoffAt, "2026-09-04T18:00");
  const preview = resolveNewProjectCutoff(draft, null, evening, { dayMode: "next-business-day", existingProject: existing });
  const explicitSingle = context.buildLedgerProjectRecord(draft, null, generated, existing, preview);
  assert.equal(explicitSingle.cutoffAt, preview.cutoffAt);
  assert.equal(explicitSingle.cutoffHistory.length, 1);
});
