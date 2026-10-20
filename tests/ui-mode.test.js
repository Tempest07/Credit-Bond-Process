import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const preference = await readFile(new URL("../ui-preference.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("startup login placeholder stays hidden only until the gate receives a real state", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../ui-mode.css", import.meta.url), "utf8");
  assert.match(html, /id="cloudGate" data-initializing/);
  assert.match(css, /\.cloud-gate\[data-initializing\]\{visibility:hidden\}/);
  const start = app.indexOf("function setCloudGate(");
  const end = app.indexOf("\nfunction ", start + 1);
  for (const [state, reason] of [["connecting"], ["idle"], ["error"], ["success"], ["error", "state_too_large"]]) {
    const nodes = new Map();
    const getNode = selector => {
      if (!nodes.has(selector)) nodes.set(selector, {
        dataset: { initializing: "" }, hidden: true,
        classList: { toggle() {}, remove() {}, add() {} },
        closest: () => ({ classList: { toggle() {} } }),
      });
      return nodes.get(selector);
    };
    const context = vm.createContext({
      $: getNode, syncConflictActive: false, isLocalApiMode: () => false,
      syncBondListCloudGate() {},
      updateCloudGateCopy() {}, document: { dispatchEvent() {} },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    });
    vm.runInContext(app.slice(start, end), context);
    context.setCloudGate(true, { state, reason });
    assert.equal("initializing" in getNode("#cloudGate").dataset, false);
    assert.equal(getNode("#cloudGate").hidden, false);
    assert.equal(getNode("#gatewayLoginLink").hidden, state === "connecting" || state === "success" || reason === "state_too_large");
    if (reason === "state_too_large") {
      assert.equal(getNode("#exportDataButton").disabled, false);
      assert.equal(getNode("#saveCloudButton").disabled, false);
    }
  }
});

test("capacity failures preserve the unsynced local copy and identify the gate error without logging out", async () => {
  const gates = [], persisted = [];
  const draft = { issuers: [{ id: "existing" }], projects: [{ id: "pending", targetQuoteNote: "本机待同步备注" }] };
  const before = JSON.stringify(draft);
  const context = vm.createContext({
    API_URL: "/api/state", localBaseRevision: 7, localStateDirty: false, cloudAvailable: true,
    setSyncStatus() {}, authHeaders: () => ({}), stateSaveMeta: () => ({ source: "manual" }),
    fetch: async () => ({ ok: false, status: 413, json: async () => ({ code: "state_too_large", error: "容量不足" }) }),
    persistLocal() { persisted.push("local"); }, setCloudGate(locked, config) { gates.push({ locked, config }); },
    clearAuthSession() { throw new Error("Must not log out for capacity errors"); },
    redirectToGatewayLogin() { throw new Error("Must not redirect for capacity errors"); },
  });
  const start = app.indexOf("async function saveCloudStateSnapshot(");
  const end = app.indexOf("\nfunction ", start + 1);
  vm.runInContext(app.slice(start, end), context);
  assert.equal(await context.saveCloudStateSnapshot(draft, { generation: 1, source: "manual" }), false);
  assert.equal(context.localStateDirty, true);
  assert.equal(context.localBaseRevision, 7);
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(persisted, ["local"]);
  assert.equal(gates[0].config.reason, "state_too_large");
});

test("switching from classic to beta does not open a retained project selection from the list", () => {
  for (const pane of ["list", "overview", "detail"]) {
    const opened = [];
    const context = vm.createContext({
      $: () => ({ dataset: { view: "ledger" } }),
      ledgerMobilePane: pane, selectedProjectId: "previously-selected-project",
      renderedValuationPayload: null,
      updateCloudGateCopy() {},
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
    const links = [{ media: "all" }, { media: "all" }, { media: "all" }];
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

test("beta CSS loads before the blocking preference script and first body paint", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const preferenceScript = html.match(/<script src="\.\/ui-preference\.js[^"\n]*"><\/script>/);
  assert.ok(preferenceScript);
  const sheets = [...html.matchAll(/<link[^>]*data-ui-beta[^>]*>/g)];
  assert.equal(sheets.length, 3);
  for (const sheet of sheets) {
    assert.match(sheet[0], /media="all"/);
    assert.ok(sheet.index < preferenceScript.index);
  }
  assert.ok(preferenceScript.index < html.indexOf("<body>"));
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
