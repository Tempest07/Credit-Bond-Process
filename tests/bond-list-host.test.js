import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function loadFunctions(context, names) {
  for (const name of names) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, `app.js defines ${name}`);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
  }
}

function classList(initial = []) {
  const classes = new Set(initial);
  return {
    contains: name => classes.has(name),
    toggle(name, enabled) {
      const next = enabled === undefined ? !classes.has(name) : Boolean(enabled);
      if (next) classes.add(name); else classes.delete(name);
      return next;
    },
  };
}

function gateHarness({ locked = true, error = true, access = true, active = true } = {}) {
  const main = { classList: classList(locked ? ["cloud-locked"] : []) };
  const gate = { classList: classList(error ? ["cloud-gate-error"] : ["cloud-gate-idle"]) };
  const view = { classList: classList(active ? ["active"] : []), dataset: { view: "bond-list" } };
  const otherView = { classList: classList(["active"]), dataset: { view: "ledger" } };
  const controller = { hasAccess: () => access, clearAccess: () => { access = false; } };
  const $ = selector => {
    if (selector === ".main") return main;
    if (selector === "#cloudGate") return gate;
    if (selector.includes("bond-list")) return selector.includes(".active") && !active ? null : view;
    if (selector === ".view.active") return active ? view : otherView;
    throw new Error(`Unexpected cloud-gate selector: ${selector}`);
  };
  const context = vm.createContext({
    $, document: { querySelector: $ }, bondListController: controller,
    currentGatewayUser: { username: "admin" }, updateAuthUi: () => {},
    paymentReceiptPreview: null, paymentReceiptInspectorSignature: "",
    paymentReceiptIdentityReviews: new Map(),
  });
  loadFunctions(context, ["syncBondListCloudGate"]);
  return { context, main, gate, controller,
    setAccess(next) { access = next; },
    setActive(next) { active = next; view.classList.toggle("active", next); },
  };
}

test("host unlocks only the active authorized OFR module during a main-library error", () => {
  for (const locked of [false, true]) for (const error of [false, true]) {
    for (const access of [false, true]) for (const active of [false, true]) {
      const h = gateHarness({ locked, error, access, active });
      h.context.syncBondListCloudGate();
      assert.equal(h.main.classList.contains("bond-list-available"), locked && error && access && active,
        JSON.stringify({ locked, error, access, active }));
      assert.equal(h.main.classList.contains("cloud-locked"), locked, "the host lock itself remains intact");
    }
  }
});

test("login and connecting gates stay closed even with previously authorized OFR access", () => {
  for (const state of ["cloud-gate-idle", "cloud-gate-connecting", "cloud-gate-success"]) {
    const h = gateHarness();
    h.context.syncBondListCloudGate();
    assert.equal(h.main.classList.contains("bond-list-available"), true);
    h.gate.classList.toggle("cloud-gate-error", false);
    h.gate.classList.toggle(state, true);
    h.context.syncBondListCloudGate();
    assert.equal(h.main.classList.contains("bond-list-available"), false, state);
  }
});

test("an OFR 401 access revocation and navigation away both remove the exception", () => {
  const h = gateHarness();
  h.context.syncBondListCloudGate();
  assert.equal(h.main.classList.contains("bond-list-available"), true);
  h.setAccess(false);
  h.context.syncBondListCloudGate();
  assert.equal(h.main.classList.contains("bond-list-available"), false);
  h.setAccess(true);
  h.context.syncBondListCloudGate();
  assert.equal(h.main.classList.contains("bond-list-available"), true);
  h.setActive(false);
  h.context.syncBondListCloudGate();
  assert.equal(h.main.classList.contains("bond-list-available"), false);
});

test("clearing the shared login session revokes OFR authorization before updating its gate", () => {
  const h = gateHarness();
  let cleared = false;
  h.context.paymentReceiptPreview = { clear() { cleared = true; } };
  h.context.syncBondListCloudGate();
  loadFunctions(h.context, ["clearPaymentReceiptIdentityReviews", "clearAuthSession"]);
  h.context.clearAuthSession();
  assert.equal(h.context.currentGatewayUser, null);
  assert.equal(cleared, true, "private PDF buffers and Blob links must be revoked at logout");
  assert.equal(h.controller.hasAccess(), false);
  assert.equal(h.main.classList.contains("bond-list-available"), false);
});

function idleHarness(options = {}) {
  const elements = new Map();
  const calls = [];
  let paused = false;
  const $ = key => {
    if (!elements.has(key)) elements.set(key, { textContent: "", disabled: false });
    return elements.get(key);
  };
  const context = vm.createContext({
    $, AbortController,
    idleExitInProgress: false, idleWarningTimer: null, idleCountdownTimer: null,
    idleLastActivityAt: 0, syncConflictActive: options.conflict || false,
    isLocalApiMode: () => false,
    clearTimeout: () => {}, clearInterval: () => {}, setTimeout: () => 1,
    flushProjectDraftToLocal: () => calls.push("project-local"),
    bondListController: {
      async flushSave() { calls.push("ofr-flush"); paused = true; return options.ofrSaved !== false; },
      resume() { calls.push("ofr-resume"); paused = false; },
    },
    saveSecondaryPendingDraft: async () => { calls.push("secondary-pending"); return options.pendingSaved !== false; },
    saveSecondaryLedgerDraft: async () => { calls.push("secondary-ledger"); return options.ledgerSaved !== false; },
    saveCloudState: async () => { calls.push("cloud-save"); return options.cloudSaved !== false; },
    setSyncStatus: () => {},
    showToast: message => calls.push(`toast:${message}`),
    scheduleIdleWarning: () => calls.push("schedule-idle"),
    fetch: async (url, init) => {
      calls.push("logout");
      assert.equal(url, "/auth/logout");
      assert.equal(init.method, "POST");
      assert.equal(paused, true, "OFR lookup remains paused until logout finishes");
      return options.logout ? options.logout() : { ok: true, json: async () => ({ ok: true }) };
    },
    location: { replace: url => { calls.push(`redirect:${url}`); } },
  });
  loadFunctions(context, ["flushStateBeforeIdleExit", "performIdleSaveAndLogout"]);
  return { context, calls, $, isPaused: () => paused };
}

test("a failed idle save or logout resumes OFR through the actual host error branch", async () => {
  for (const options of [
    { ofrSaved: false }, { pendingSaved: false }, { ledgerSaved: false }, { cloudSaved: false },
    { conflict: true },
    { logout: () => ({ ok: false, json: async () => ({ error: "退出失败" }) }) },
    { logout: () => { throw new Error("网络不可用"); } },
  ]) {
    const h = idleHarness(options);
    await h.context.performIdleSaveAndLogout();
    assert.equal(h.calls.filter(call => call === "ofr-resume").length, 1);
    assert.equal(h.isPaused(), false);
    assert.equal(h.context.idleExitInProgress, false);
    assert.equal(h.$("#idleContinueButton").disabled, false);
    assert.equal(h.$("#idleExitNowButton").disabled, false);
    assert.equal(h.$("#idleExitTitle").textContent, "自动退出已暂停");
    assert.equal(h.calls.some(call => call.startsWith("redirect:")), false);
    assert.equal(h.calls.includes("schedule-idle"), true);
  }
});

test("successful idle logout never resumes OFR before redirecting", async () => {
  let resolveLogout;
  const response = new Promise(resolve => { resolveLogout = resolve; });
  const h = idleHarness({ logout: () => response });
  const exiting = h.context.performIdleSaveAndLogout();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.includes("logout"), true);
  assert.equal(h.calls.includes("ofr-resume"), false);
  assert.equal(h.isPaused(), true);
  assert.equal(h.$("#idleContinueButton").disabled, true);
  resolveLogout({ ok: true, json: async () => ({ ok: true }) });
  await exiting;
  assert.equal(h.calls.includes("ofr-resume"), false);
  assert.equal(h.isPaused(), true);
  assert.equal(h.calls.at(-1), "redirect:/login/?next=%2Fbond-centre%2F");
  assert.equal(h.calls.includes("schedule-idle"), false);
});
