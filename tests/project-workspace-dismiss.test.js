import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
function harness({ pending = true, open = true } = {}) {
  const effects = [];
  const workspace = { dataset: { open: String(open) }, contains: (target) => target.inside, addEventListener() {} };
  const form = { hidden: false };
  const tools = { open: true, contains: target => target.insideTools };
  const listeners = [];
  const context = vm.createContext({
    isUiBeta: () => true,
    handleUiModeChange() {},
    document: { addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }) },
    projectAutoSaveTimer: pending ? 7 : null,
    projectTargetNotes: null,
    $: (selector) => ({ "#workspaceTools": tools, "#projectWorkspace": workspace, "#projectForm": form, "#projectId": { value: "p1" } })[selector],
    clearTimeout: (timer) => effects.push(["cancel", timer]),
    readProjectForm: () => ({ id: "p1", opinion: "latest unsaved edit" }),
    saveProjectRecordNow: (draft) => effects.push(["save", draft.opinion]),
    setProjectWorkspaceOpen: (value) => { effects.push(["open", value]); workspace.dataset.open = String(value); },
    navigateLedgerMobilePane: (pane, options) => effects.push(["navigate", pane, options.focusSelected]),
  });
  for (const name of ["bindWorkspaceChrome", "closeLedgerProjectDetail", "handleProjectWorkspaceOutsideClick", "flushProjectDraftToLocal", "saveProjectDraftNow"]) {
    const start = app.indexOf(`function ${name}(`);
    const end = app.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(app.slice(start, end), context);
  }
  return { context, effects, workspace, tools, listeners };
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

test("recognition queue controls and panel contents leave pending project edits open", () => {
  for (const ancestor of ["#issuanceQueuePanel", "#issuanceQueueToggle"]) {
    const { context, effects, workspace } = harness();
    context.handleProjectWorkspaceOutsideClick({ target: {
      closest: selector => selector.split(",").map(value => value.trim()).includes(ancestor) ? {} : null,
    } });
    assert.deepEqual(effects, [], `${ancestor} must not flush or close the project`);
    assert.equal(workspace.dataset.open, "true");
    assert.equal(context.projectAutoSaveTimer, 7);
  }
});

test("recognition queue interactions preserve both open workspace surfaces", () => {
  for (const ancestor of ["#issuanceQueuePanel", "#issuanceQueueToggle"]) {
    const { context, effects, workspace, tools, listeners } = harness();
    context.bindWorkspaceChrome();
    const event = { target: {
      closest: selector => selector.split(",").map(value => value.trim()).includes(ancestor) ? {} : null,
    } };
    for (const listener of listeners.filter(item => item.type === "click")) listener.handler(event);
    assert.equal(tools.open, true, `${ancestor} must not collapse workspace tools`);
    assert.equal(workspace.dataset.open, "true");
    assert.deepEqual(effects, []);
  }
});

test("workspace tools retain their normal inside and outside click behavior", () => {
  const { context, effects, tools, listeners } = harness({ open: false });
  context.bindWorkspaceChrome();
  const click = target => listeners.filter(item => item.type === "click").forEach(item => item.handler({ target }));
  click({ insideTools: true, closest: () => null });
  assert.equal(tools.open, true);
  click({ closest: () => null });
  assert.equal(tools.open, false);
  assert.deepEqual(effects, []);
});

test("dragging from project content to the outside does not dismiss or save the project", () => {
  for (const origin of [{ inside: true },
    { closest: selector => selector.includes('[role="dialog"]') ? {} : null },
    { closest: selector => selector.includes('#issuanceQueuePanel') ? {} : null }]) {
    const { context, effects, workspace, listeners } = harness();
    context.bindWorkspaceChrome();
    const emit = (type, event) => listeners.filter(item => item.type === type && item.capture).forEach(item => item.handler(event));
    emit("pointerdown", { target: origin });
    // Browser click targets the common ancestor when the two endpoints differ.
    emit("click", { detail: 1, target: { closest: () => null } });
    assert.equal(workspace.dataset.open, "true");
    assert.deepEqual(effects, []);
    assert.equal(context.projectAutoSaveTimer, 7);
    // The next intentional outside click still dismisses and flushes edits.
    emit("pointerdown", { target: { closest: () => null } });
    emit("click", { detail: 1, target: { closest: () => null } });
    assert.equal(workspace.dataset.open, "false");
    assert.ok(effects.some(([type]) => type === "save"));
  }
});

test("cancelled and keyboard gestures cannot retain a stale inside-pointer exemption", () => {
  for (const cancel of [false, true]) {
    const { context, effects, workspace, listeners } = harness();
    context.bindWorkspaceChrome();
    const emit = (type, event) => listeners.filter(item => item.type === type && item.capture).forEach(item => item.handler(event));
    emit("pointerdown", { target: { inside: true } });
    if (cancel) emit("pointercancel", {});
    emit("click", { detail: cancel ? 1 : 0, target: { closest: () => null } });
    assert.equal(workspace.dataset.open, "false");
    assert.ok(effects.some(([type]) => type === "save"));
  }
});

test("a fresh outside press after a drag without a click still dismisses the project", () => {
  const { context, workspace, listeners } = harness();
  context.bindWorkspaceChrome();
  const emit = (type, event) => listeners.filter(item => item.type === type && item.capture).forEach(item => item.handler(event));
  emit("pointerdown", { target: { inside: true } });
  emit("pointerdown", { target: { closest: () => null } });
  emit("click", { detail: 1, target: { closest: () => null } });
  assert.equal(workspace.dataset.open, "false");
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
