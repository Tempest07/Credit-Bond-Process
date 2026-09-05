import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const preference = await readFile(new URL("../ui-preference.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("switching from classic to beta does not open a retained project selection from the list", () => {
  for (const pane of ["list", "overview", "detail"]) {
    const opened = [];
    const context = vm.createContext({
      $: () => ({ dataset: { view: "ledger" } }),
      ledgerMobilePane: pane, selectedProjectId: "previously-selected-project",
      setProjectWorkspaceOpen: value => opened.push(value),
      syncLedgerMobilePane() {}, switchView() {}, renderProtocolTransferList() {},
      scheduleLiquidMotionSync() {}, requestAnimationFrame() {}, positionResultEntryPanel() {},
    });
    const start = app.indexOf("function handleUiModeChange(");
    const end = app.indexOf("\nfunction ", start + 1);
    vm.runInContext(app.slice(start, end), context);
    context.handleUiModeChange({ detail: { enabled: true } });
    assert.deepEqual(opened, [pane === "detail"]);
  }
});

test("first visit and invalid preferences retain the classic UI; only an explicit true enables beta", () => {
  for (const stored of [null, "false", "invalid", "true"]) {
    const root = { dataset: {} };
    const links = [{ media: "not all" }, { media: "not all" }, { media: "not all" }];
    const reads = [];
    vm.runInNewContext(preference, {
      document: { documentElement: root, querySelectorAll: () => links },
      localStorage: { getItem: key => { reads.push(key); return stored; } },
    });
    assert.deepEqual(reads, ["bond-centre-ui-beta"]);
    assert.equal(root.dataset.ui, stored === "true" ? "beta" : "legacy");
    assert.ok(links.every(link => link.media === (stored === "true" ? "all" : "not all")));
  }
});

test("blocked browser storage still starts in the classic UI", () => {
  const root = { dataset: {} };
  vm.runInNewContext(preference, {
    document: { documentElement: root, querySelectorAll: () => [] },
    localStorage: { getItem() { throw new Error("storage denied"); } },
  });
  assert.equal(root.dataset.ui, "legacy");
});

test("switching UI keeps an open issuance result review intact", () => {
  let closed = 0;
  const panel = { hidden: false, contains: () => false };
  const context = vm.createContext({
    $: selector => selector === "#resultEntryPanel" ? panel : null,
    closeResultEntryPanel: () => { closed++; },
  });
  const start = app.indexOf("function handleResultEntryOutsidePointer(");
  const end = app.indexOf("\nfunction ", start + 1);
  vm.runInContext(app.slice(start, end), context);
  context.handleResultEntryOutsidePointer({ target: { closest: selector => selector === "#uiBetaControl" ? {} : null } });
  assert.equal(closed, 0);
  context.handleResultEntryOutsidePointer({ target: { closest: () => null } });
  assert.equal(closed, 1);
});

test("classic desktop details stay interactive while beta details follow their open state", () => {
  for (const beta of [false, true]) {
    const workspace = { dataset: { open: "false" }, inert: true };
    const context = vm.createContext({
      $: selector => selector === "#projectWorkspace" ? workspace : null,
      isUiBeta: () => beta, isCompactLedger: () => false,
      ledgerMobilePane: "list", syncLedgerMobilePane() {},
    });
    const start = app.indexOf("function setProjectWorkspaceOpen(");
    const end = app.indexOf("\nfunction ", start + 1);
    vm.runInContext(app.slice(start, end), context);
    context.setProjectWorkspaceOpen(false);
    assert.equal(workspace.inert, beta);
    context.setProjectWorkspaceOpen(true);
    assert.equal(workspace.inert, false);
    assert.equal(workspace.dataset.open, String(beta));
  }
});

test("classic mobile only permits interaction with the selected detail pane", () => {
  const workspace = { dataset: {}, inert: false };
  const context = vm.createContext({
    $: () => workspace, isUiBeta: () => false, isCompactLedger: () => true,
    ledgerMobilePane: "list",
  });
  const start = app.indexOf("function setProjectWorkspaceOpen(");
  const end = app.indexOf("\nfunction ", start + 1);
  vm.runInContext(app.slice(start, end), context);
  context.setProjectWorkspaceOpen(false);
  assert.equal(workspace.inert, true);
  context.ledgerMobilePane = "detail";
  context.setProjectWorkspaceOpen(true);
  assert.equal(workspace.inert, false);
});
