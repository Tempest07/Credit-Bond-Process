import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness({ pending = true, open = true } = {}) {
  const effects = [];
  const workspace = { dataset: { open: String(open) }, contains: (target) => target.inside };
  const form = { hidden: false };
  const context = vm.createContext({
    isUiBeta: () => true,
    projectAutoSaveTimer: pending ? 7 : null,
    $: (selector) => ({ "#projectWorkspace": workspace, "#projectForm": form, "#projectId": { value: "p1" } })[selector],
    clearTimeout: (timer) => effects.push(["cancel", timer]),
    readProjectForm: () => ({ id: "p1", opinion: "latest unsaved edit" }),
    saveProjectRecordNow: (draft) => effects.push(["save", draft.opinion]),
    setProjectWorkspaceOpen: (value) => { effects.push(["open", value]); workspace.dataset.open = String(value); },
    navigateLedgerMobilePane: (pane, options) => effects.push(["navigate", pane, options.focusSelected]),
  });
  for (const name of ["closeLedgerProjectDetail", "handleProjectWorkspaceOutsideClick", "flushProjectDraftToLocal", "saveProjectDraftNow"]) {
    const start = app.indexOf(`function ${name}(`);
    const end = app.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(app.slice(start, end), context);
  }
  return { context, effects, workspace };
}

test("outside click flushes the pending edit before closing and does not steal focus", () => {
  const { context, effects, workspace } = harness();
  context.handleProjectWorkspaceOutsideClick({ target: { closest: () => null } });
  assert.ok(effects.some(([type, value]) => type === "cancel" && value === 7));
  assert.deepEqual(effects.filter(([type]) => type !== "cancel"), [
    ["save", "latest unsaved edit"], ["open", false], ["navigate", "list", false],
  ]);
  assert.equal(context.projectAutoSaveTimer, null);
  assert.equal(workspace.dataset.open, "false");
});

test("inside clicks and detached dialog controls leave the project open", () => {
  for (const target of [{ inside: true }, { closest: () => ({ role: "dialog" }) }]) {
    const { context, effects, workspace } = harness();
    context.handleProjectWorkspaceOutsideClick({ target });
    assert.deepEqual(effects, []);
    assert.equal(workspace.dataset.open, "true");
  }
});

test("clicking to open a project is not mistaken for dismissing an existing one", () => {
  const { context, effects } = harness({ open: false });
  context.handleProjectWorkspaceOutsideClick({ target: { closest: () => null } });
  assert.deepEqual(effects, []);
});

test("the UI switch does not dismiss or refill an open project with pending inputs", () => {
  const { context, effects, workspace } = harness();
  context.handleProjectWorkspaceOutsideClick({ target: {
    closest: selector => selector.includes("#uiBetaControl") ? {} : null,
  } });
  assert.deepEqual(effects, []);
  assert.equal(workspace.dataset.open, "true");
});

test("explicit close also flushes drafts; unchanged projects do not get redundant saves", () => {
  const changed = harness();
  changed.context.closeLedgerProjectDetail();
  assert.deepEqual(changed.effects.at(-1), ["navigate", "list", true]);
  assert.ok(changed.effects.some(([type]) => type === "save"));
  const unchanged = harness({ pending: false });
  unchanged.context.closeLedgerProjectDetail();
  assert.deepEqual(unchanged.effects, [["open", false], ["navigate", "list", true]]);
});
