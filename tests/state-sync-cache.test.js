import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { localBetaSyncText } from "../local-beta-policy.js";
import { statePayloadEquals } from "../state-history.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function loadFunctions(context, names) {
  for (const name of names) {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    const rest = source.slice(start);
    const end = rest.slice(1).search(/\n(?:async )?function /);
    vm.runInContext(end < 0 ? rest : rest.slice(0, end + 1), context);
  }
}

function harness(errorName = "QuotaExceededError") {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) {
      const classes = new Set();
      const element = {
        textContent: "", hidden: false, disabled: false, dataset: {},
        classList: {
          add: (...names) => names.forEach(name => classes.add(name)),
          remove: (...names) => names.forEach(name => classes.delete(name)),
          toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
          contains: name => classes.has(name),
        },
        closest: () => element,
      };
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  const requests = [];
  const toasts = [];
  const timers = [];
  const gates = [];
  const storage = new Map();
  let storageError = errorName ? new DOMException("synthetic browser storage failure", errorName) : null;
  let reply = () => ({ ok: true, status: 200, json: async () => ({ revision: 8, updatedAt: "2026-10-25T12:00:00.000Z" }) });
  let renders = 0;
  const initial = { version: 5, issuers: [], absCreditApprovals: [], projects: [{ id: "local", note: "unsaved edit" }], ftpCurve: {} };
  const context = vm.createContext({
    $, structuredClone, localBetaSyncText, statePayloadEquals,
    LOCAL_BETA: null, LOCAL_KEY: "test-state", LOCAL_CACHE_VERSION: 2,
    API_URL: "./api/state", DEFAULT_STATE: structuredClone(initial),
    state: structuredClone(initial), cloudAvailable: true,
    localStateDirty: false, localCacheWriteFailed: false,
    localBaseRevision: 7, cloudRevision: 7, cloudUpdatedAt: null,
    localChangeGeneration: 0, localDirtyAt: null, syncConflictActive: false,
    activeStateSnapshotId: "", cloudSaveQueue: Promise.resolve(),
    localStorage: { setItem(key, value) { if (storageError) throw storageError; storage.set(key, value); } },
    fetch: async (url, options = {}) => { requests.push({ url, options }); return reply(url, options); },
    showToast: message => toasts.push(message), authHeaders: () => ({}),
    stateSaveMeta: saveSource => ({ source: saveSource, clientId: "cache-test" }),
    formatStateSnapshotTime: value => value, isLocalApiMode: () => false,
    normalizeLoadedState: value => structuredClone(value),
    ftpCurveNeedsMigration: () => false, issuerBranchNeedsMigration: () => false, creditModelNeedsMigration: () => false,
    renderStateDependentViews: () => { renders += 1; },
    setCurrentUser: () => {}, updateAuthUi: () => {},
    clearAuthSession: () => {}, redirectToGatewayLogin: () => {},
    restoreLedgerMobileViewport: () => {},
    updateCloudGateCopy: () => {}, syncBondListCloudGate: () => {},
    window: { setTimeout: callback => { timers.push(callback); } },
    document: { dispatchEvent: event => gates.push(event.detail) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  loadFunctions(context, [
    "persistLocal", "setSyncStatus", "setCloudGate", "markLocalStateDirty", "persistState",
    "saveCloudState", "saveCloudStateSnapshot", "handleStateConflict", "loadCloudState",
  ]);
  return {
    context, $, requests, toasts, storage, gates,
    setReply: value => { reply = value; },
    recoverStorage: () => { storageError = null; },
    runTimers: () => { while (timers.length) timers.shift()(); },
    get renders() { return renders; },
  };
}

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("quota and denied storage failures remain explicit until a successful cache retry", () => {
  for (const errorName of ["QuotaExceededError", "SecurityError"]) {
    const h = harness(errorName);
    h.context.localStateDirty = true;
    assert.equal(h.context.persistLocal(), false, errorName);
    assert.equal(h.context.localCacheWriteFailed, true);
    assert.equal(h.storage.size, 0);
    assert.match(h.$("#syncDetail").textContent, /本机缓存未保存.*仅保留在当前页面/);
    assert.match(h.toasts[0], /缓存保存失败.*云端保存/);
    h.context.persistLocal();
    assert.equal(h.toasts.length, 1, "repeated cache attempts do not flood the page with warnings");
    h.context.setSyncStatus("正在上传", "正在等待云端");
    assert.match(h.$("#syncDetail").textContent, /本机缓存未保存/);
    h.recoverStorage();
    assert.equal(h.context.persistLocal(), true);
    assert.equal(h.context.localCacheWriteFailed, false);
    assert.equal(JSON.parse(h.storage.get("test-state")).dirty, true);
    assert.equal(h.$("#syncStatus").textContent, "本机缓存已恢复");
    assert.doesNotMatch(h.$("#syncDetail").textContent, /本机缓存未保存/);
  }
});

test("automatic persistence still reaches a successful cloud PUT when quota or storage permission is unavailable", async () => {
  for (const errorName of ["QuotaExceededError", "SecurityError"]) {
    const h = harness(errorName);
    assert.doesNotThrow(() => h.context.persistState());
    assert.equal(await h.context.cloudSaveQueue, true, errorName);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].options.method, "PUT");
    const submitted = JSON.parse(h.requests[0].options.body);
    assert.equal(submitted.expectedRevision, 7);
    assert.equal(submitted.meta.source, "autosave");
    assert.equal(submitted.data.projects[0].note, "unsaved edit");
    assert.equal(h.context.localChangeGeneration, 1);
    assert.equal(h.context.localBaseRevision, 8);
    assert.equal(h.context.cloudRevision, 8);
    assert.equal(h.context.localStateDirty, false);
    assert.equal(h.context.localDirtyAt, null);
    assert.equal(h.context.cloudAvailable, true);
    assert.equal(h.context.localCacheWriteFailed, true);
    assert.equal(h.$("#syncStatus").textContent, "D1 已确认");
    assert.match(h.$("#syncDetail").textContent, /本机缓存未保存.*云端版本已确认/);
    assert.equal(h.$("#cloudGate").hidden, true);
    assert.equal(h.$("#saveCloudButton").disabled, false);
    assert.equal(h.$("#exportDataButton").disabled, false);
  }
});

test("manual cloud save stays usable during a browser cache failure and keeps its revision precondition", async () => {
  const h = harness("SecurityError");
  h.context.localStateDirty = true;
  const generation = h.context.localChangeGeneration;
  assert.equal(await h.context.saveCloudState({ source: "manual", markChange: false }), true);
  assert.equal(h.context.localChangeGeneration, generation);
  const submitted = JSON.parse(h.requests[0].options.body);
  assert.equal(submitted.meta.source, "manual");
  assert.equal(submitted.expectedRevision, 7);
  assert.equal(h.context.localStateDirty, false);
  assert.equal(h.context.localCacheWriteFailed, true);
  assert.equal(h.$("#saveCloudButton").disabled, false);
});

test("a successful cloud GET is connected and unlocks the page even if its local cache cannot be written", async () => {
  const h = harness();
  const remote = { version: 5, issuers: [{ legalName: "云端主体" }], absCreditApprovals: [], projects: [], ftpCurve: {} };
  h.setReply(() => response(200, { data: remote, revision: 9, updatedAt: "2026-10-25T12:00:00.000Z" }));
  await h.context.loadCloudState();
  h.runTimers();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.method, undefined);
  assert.equal(h.context.state.issuers[0].legalName, "云端主体");
  assert.equal(h.context.localBaseRevision, 9);
  assert.equal(h.context.localStateDirty, false);
  assert.equal(h.context.cloudAvailable, true);
  assert.equal(h.context.localCacheWriteFailed, true);
  assert.equal(h.$("#syncStatus").textContent, "D1 已连接");
  assert.match(h.$("#syncDetail").textContent, /本机缓存未保存.*云端版本已确认/);
  assert.equal(h.$("#cloudGate").hidden, true);
  assert.equal(h.gates.some(gate => gate.state === "error"), false);
  assert.equal(h.$("#saveCloudButton").disabled, false);
  assert.ok(h.renders >= 1);
});

test("a real cloud failure returns false without a second storage exception and preserves save and export recovery", async () => {
  const h = harness();
  h.setReply(() => response(503, { error: "synthetic cloud unavailable" }));
  assert.equal(await h.context.saveCloudState({ source: "manual" }), false);
  assert.equal(h.context.localStateDirty, true);
  assert.equal(h.context.localCacheWriteFailed, true);
  assert.equal(h.context.cloudAvailable, false);
  assert.equal(h.context.localBaseRevision, 7);
  assert.equal(h.context.state.projects[0].note, "unsaved edit");
  assert.equal(h.$("#syncStatus").textContent, "D1 同步失败");
  assert.match(h.$("#syncDetail").textContent, /未确认的修改仅保留在当前页面/);
  assert.match(h.$("#cloudGateDetail").textContent, /尚未持久保存.*导出备份或重试/);
  assert.doesNotMatch(h.$("#cloudGateDetail").textContent, /本机数据仍保留/);
  assert.equal(h.$("#cloudGate").hidden, false);
  assert.equal(h.$("#saveCloudButton").disabled, false);
  assert.equal(h.$("#exportDataButton").disabled, false);
  h.setReply(() => response(200, { revision: 8 }));
  assert.equal(await h.context.saveCloudState({ source: "manual", markChange: false }), true);
  assert.equal(h.context.localStateDirty, false);
  assert.equal(h.$("#cloudGate").hidden, true);
});

test("cache failure never bypasses a real revision conflict or allows another PUT through the conflict gate", async () => {
  const h = harness("SecurityError");
  h.setReply(() => response(409, { revision: 12, updatedAt: "2026-10-25T12:00:00.000Z" }));
  assert.equal(await h.context.saveCloudState({ source: "manual" }), false);
  assert.equal(h.context.syncConflictActive, true);
  assert.equal(h.context.cloudRevision, 12);
  assert.equal(h.context.localBaseRevision, 7);
  assert.equal(h.context.localStateDirty, true);
  assert.equal(h.context.state.projects[0].note, "unsaved edit");
  assert.equal(h.$("#syncStatus").textContent, "检测到版本冲突");
  assert.match(h.$("#syncDetail").textContent, /本机缓存未保存/);
  assert.equal(h.$("#saveCloudButton").disabled, true);
  assert.equal(h.$("#exportDataButton").disabled, false);
  assert.equal(await h.context.saveCloudState({ source: "manual" }), false);
  h.context.cloudAvailable = true;
  h.context.persistState();
  assert.equal(await h.context.cloudSaveQueue, false);
  assert.equal(h.requests.length, 1);
});

test("dirty local edits survive a cloud GET and still use their original revision when cache writes fail", async () => {
  const h = harness();
  h.context.localStateDirty = true;
  h.setReply((url, options) => options.method === "PUT"
    ? response(409, { revision: 12 })
    : response(200, { data: { version: 5, issuers: [], absCreditApprovals: [], projects: [{ id: "remote" }], ftpCurve: {} }, revision: 12 }));
  await h.context.loadCloudState();
  assert.equal(h.requests.length, 2);
  assert.equal(JSON.parse(h.requests[1].options.body).expectedRevision, 7);
  assert.equal(h.context.state.projects[0].id, "local");
  assert.equal(h.context.syncConflictActive, true);
  assert.equal(h.context.localStateDirty, true);
  assert.equal(h.$("#cloudGate").hidden, false);
  assert.equal(h.$("#saveCloudButton").disabled, true);
  assert.equal(h.$("#exportDataButton").disabled, false);
});
