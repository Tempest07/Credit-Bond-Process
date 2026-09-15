import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readLocalBetaPolicy, localBetaSyncText, localBetaManualHeaders } from "../local-beta-policy.js";
import { __test__ } from "../realtime-quotes.js";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const marker = { id: "isolated-test", snapshotAt: "2026-09-15T00:00:00Z", manualQuotesOnly: true };
const localPolicy = readLocalBetaPolicy("localhost", marker);
const flush = () => new Promise(resolve => setImmediate(resolve));

function appFunction(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(app);
  assert.ok(match, name);
  const end = app.indexOf("\nfunction ", match.index + 1);
  const asyncEnd = app.indexOf("\nasync function ", match.index + 1);
  return app.slice(match.index, Math.min(...[end, asyncEnd, app.length].filter(n => n >= 0)));
}

test("only a complete server marker on an exact loopback host enables manual-only Beta", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.deepEqual(readLocalBetaPolicy(host, marker), marker);
  }
  for (const host of ["tempest07.com", "credit-bond-process.pages.dev", "localhost.example.com", "192.168.1.2", ""]) {
    assert.equal(readLocalBetaPolicy(host, marker), null);
  }
  for (const invalid of [undefined, null, {}, { ...marker, manualQuotesOnly: false },
    { ...marker, manualQuotesOnly: "true" }, { ...marker, id: "" }, { ...marker, snapshotAt: null }]) {
    assert.equal(readLocalBetaPolicy("localhost", invalid), null);
  }
  const input = { ...marker };
  const policy = readLocalBetaPolicy("localhost", input);
  input.manualQuotesOnly = false;
  assert.equal(policy.manualQuotesOnly, true);
  assert.ok(Object.isFrozen(policy));
});

test("sync wording identifies the local copy without changing production text", () => {
  assert.equal(localBetaSyncText("云端已确认", localPolicy), "本地副本已确认");
  assert.equal(localBetaSyncText("本地 D1 已同步", localPolicy), "本地副本已同步");
  assert.equal(localBetaSyncText("云端版本 3", null), "云端版本 3");
});

test("the manual header is minted only for explicit local manual requests", () => {
  assert.deepEqual(localBetaManualHeaders(localPolicy, true), { "X-Beta-Manual-Refresh": "1" });
  for (const manual of [false, undefined, "true", 1]) assert.deepEqual(localBetaManualHeaders(localPolicy, manual), {});
  assert.deepEqual(localBetaManualHeaders(null, true), {});
});

function harness(t, policy = localPolicy, fetchResult) {
  const timers = new Map();
  const calls = [];
  let timerId = 0, now = 0;
  const emitter = () => ({
    listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); },
    fire(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn({ currentTarget: this, ...event }); },
  });
  const node = () => Object.assign(emitter(), {
    textContent: "", dataset: {}, removed: false,
    remove() { this.removed = true; },
    setAttribute() {},
  });
  const nodes = new Map();
  for (const selector of ["#realtimeQuoteRefreshButton", "#realtimeQuotePauseButton", "#realtimeQuoteInterval",
    "#realtimeQuoteCountdown", "#realtimeQuoteLiveState", "#realtimeQuoteStatusDetail",
    "#realtimeQuoteLastRefresh", "#realtimeQuoteEmptyState p", ".realtime-footnote span:last-child"]) nodes.set(selector, node());
  nodes.get("#realtimeQuoteInterval").closest = () => nodes.get("#realtimeQuoteInterval");
  nodes.get("#realtimeQuoteCountdown").parentElement = nodes.get("#realtimeQuoteCountdown");
  const label = node();
  nodes.get("#realtimeQuoteLiveState").querySelector = () => label;
  const root = {
    querySelector(selector) { const n = nodes.get(selector); return n?.removed ? null : n || null; },
    classList: { remove() {} },
  };
  const doc = Object.assign(emitter(), { hidden: false, querySelector: () => null });
  const win = Object.assign(emitter(), {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay, repeat: delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  let c;
  t.after(() => c?.destroy());
  for (const [key, value] of Object.entries({ window: win, document: doc, localStorage: {
    getItem: key => key.includes("watchlist") ? JSON.stringify({ watchlist: [{ query: "250004.IB" }], intervalMs: 15000 }) : null,
    setItem() {},
  } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (fetchResult) return fetchResult(url, options);
    return Response.json({ ok: true, fetchedAt: new Date().toISOString(), rows: url.includes("valuations")
      ? [{ securityId: "250004.IB" }]
      : [{ query: "250004.IB", securityId: "250004.IB", bid: {}, ofr: {} }], unresolved: [] });
  });
  // Keep real initialization, event bindings, status, scheduling and fetch logic.
  // Table layout and import-dialog focus are unrelated to the request policy.
  const Controller = __test__.RealtimeQuoteController;
  t.mock.method(Controller.prototype, "render", function () { this.renderStatus(); });
  t.mock.method(Controller.prototype, "renderTable", () => {});
  t.mock.method(Controller.prototype, "closeImportDialog", () => {});
  c = new Controller(root);
  const originalRefresh = c.refresh;
  const context = vm.createContext({ LOCAL_BETA: policy, window: win, localBetaManualHeaders });
  vm.runInContext(appFunction("configureLocalBetaQuotes"), context);
  context.configureLocalBetaQuotes(c);
  return { c, calls, timers, nodes, label, doc, win, originalRefresh,
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
        timer.fn();
        await flush();
      }
      now = end;
    },
  };
}

test("local restored pool, import, navigation, visibility, focus and automatic controls never fetch", async t => {
  const h = harness(t);
  const { c, calls, nodes, doc, win, timers } = h;
  assert.equal(c.watchlist.length, 1);
  assert.equal(timers.size, 0, "constructor ticker was cancelled before navigation");
  c.setActive(true);
  c.setActive(false);
  doc.hidden = true; doc.fire("visibilitychange");
  doc.hidden = false; doc.fire("visibilitychange");
  win.fire("focus");
  c.pendingImports = [{ query: "250005.IB" }];
  c.confirmImport();
  c.removeQuery("250005.IB");
  // Even stale references to the removed controls cannot reactivate polling.
  nodes.get("#realtimeQuotePauseButton").fire("click");
  nodes.get("#realtimeQuoteInterval").value = "15";
  nodes.get("#realtimeQuoteInterval").fire("change");
  c.syncPolling({ immediate: true });
  await c.refresh();
  await h.advance(16 * 60_000);
  assert.equal(calls.length, 0);
  assert.equal(timers.size, 0);
  assert.equal(c.shouldPoll(), false);
  assert.equal(c.nextRefreshAt, 0);
  assert.equal(h.label.textContent, "手动刷新");
  for (const selector of ["#realtimeQuoteInterval", "#realtimeQuotePauseButton", "#realtimeQuoteCountdown"]) assert.equal(nodes.get(selector).removed, true);

  nodes.get("#realtimeQuoteRefreshButton").fire("click");
  nodes.get("#realtimeQuoteRefreshButton").fire("click");
  assert.equal(calls.length, 1, "the click immediately requests DM, duplicate clicks do not race");
  assert.equal(calls[0].url, "./api/dm/realtime-quotes");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers["X-Beta-Manual-Refresh"], "1");
  assert.deepEqual(JSON.parse(calls[0].options.body), { queries: ["250004.IB"] });
  await flush();
  assert.equal(calls.length, 2, "manual quote refresh may also obtain a valuation snapshot");
  assert.equal(calls[1].url, "./api/dm/realtime-valuations");
  assert.equal(calls[1].options.headers["X-Beta-Manual-Refresh"], "1");
  c.valuationFetchedAt = "2000-01-01T00:00:00Z";
  await h.advance(16 * 60_000);
  assert.equal(calls.length, 2, "expired valuations do not create a timer or request");
  assert.equal(timers.size, 0);
  assert.equal(c.loading, false);
});

test("local failure and abort never retry; the next manual click still works", async t => {
  for (const outcome of ["http", "timeout", "network", "abort"]) await t.test(outcome, async t => {
    const h = harness(t, localPolicy, () => {
      if (outcome === "http") return Response.json({ ok: false, error: "DM unavailable" }, { status: 502 });
      if (outcome === "timeout") return Response.json({ ok: false, error: "DM timeout" }, { status: 504 });
      throw Object.assign(new Error("DM unavailable"), { name: outcome === "abort" ? "AbortError" : "Error" });
    });
    await h.c.refresh({ manual: true });
    assert.equal(h.c.loading, false);
    await h.advance(16 * 60_000);
    h.doc.fire("visibilitychange"); h.win.fire("focus"); h.c.setActive(true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
    await h.c.refresh({ manual: true });
    assert.equal(h.calls.length, 2);
  });
});

test("a failed attached valuation snapshot does not schedule its own retry", async t => {
  const h = harness(t, localPolicy, url => url.includes("valuations")
    ? Response.json({ ok: false, error: "valuation unavailable" }, { status: 502 })
    : Response.json({ ok: true, rows: [{ query: "250004.IB", securityId: "250004.IB", bid: {}, ofr: {} }], unresolved: [] }));
  await h.c.refresh({ manual: true });
  await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.c.valuationError, "valuation unavailable");
  h.c.valuationRetryAt = 0;
  await h.advance(16 * 60_000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
});

test("production and unmarked localhost retain the original automatic polling", async t => {
  for (const policy of [readLocalBetaPolicy("tempest07.com", marker), readLocalBetaPolicy("localhost", undefined)]) {
    await t.test("no local policy", async t => {
      const h = harness(t, policy);
      assert.equal(h.c.refresh, h.originalRefresh);
      assert.equal(h.nodes.get("#realtimeQuotePauseButton").removed, false);
      h.c.setActive(true);
      await flush();
      assert.equal(h.calls.length, 2);
      await h.advance(15000);
      assert.equal(h.calls.length, 3, "production poll continues without another click");
      assert.ok(h.calls.every(call => !("X-Beta-Manual-Refresh" in call.options.headers)));
    });
  }
});

test("secondary automatic enrichment is blocked but manual buttons reach the existing DM path", async () => {
  for (const name of ["enrichSecondaryPendingFromDm", "enrichSecondaryLedgerFromDm"]) {
    let calls = 0;
    const context = vm.createContext({
      LOCAL_BETA: localPolicy, secondaryLedgerDateValue: () => "2026-09-15",
      ensureSecondaryPendingDraft: () => [], ensureSecondaryLedgerDraft: () => [],
      tradeRecordDmRequestRows: () => [{ id: "one" }],
      tradeRecordDmDependencyKey: () => "same", secondaryPendingDmRequestKey: () => "same",
      updateSecondaryPendingControls() {}, updateSecondaryLedgerControls() {},
      requestTradeRecordDmRows: async (_rows, options) => {
        assert.equal(options.manual, calls === 0);
        calls++; return { rows: [], failedIds: [], errors: [] };
      },
      secondaryPendingDraftRows: [], secondaryLedgerDraftRows: [],
      mergeTradeRecordDmResults: rows => rows, markTradeRecordDmErrors: rows => rows,
      cloneTradeRecordDraftRows: rows => rows, renderSecondaryTrades() {}, renderSecondaryLedger() {}, showToast() {},
    });
    vm.runInContext(appFunction(name), context);
    await context[name]({ automatic: true });
    assert.equal(calls, 0);
    await context[name]({ refresh: true });
    assert.equal(calls, 1);
    context.LOCAL_BETA = null;
    await context[name]({ automatic: true });
    assert.equal(calls, 2, "production auto-enrichment remains enabled");
  }
});

test("local startup curve load is suppressed; explicit refresh still reaches the existing endpoint", async () => {
  let calls = 0;
  const context = vm.createContext({ LOCAL_BETA: localPolicy,
    $: () => ({}), policyCurveController: null, AbortController, localBetaManualHeaders,
    renderPolicyCurveMessage() {}, authHeaders: () => ({}), DM_POLICY_CURVE_URL: "./api/dm/curve?curve=cdb",
    fetch: async (url, options) => {
      assert.equal(url, "./api/dm/curve?curve=cdb");
      assert.equal(options.headers["X-Beta-Manual-Refresh"], "1");
      calls++; throw new Error("offline fixture");
    },
  });
  vm.runInContext(appFunction("loadPolicyCurve"), context);
  await context.loadPolicyCurve();
  assert.equal(calls, 0);
  await context.loadPolicyCurve({ refresh: true });
  assert.equal(calls, 1);
});

test("trade-record batches carry the local manual header, while automatic calls make no request", async () => {
  const calls = [];
  const context = vm.createContext({ LOCAL_BETA: localPolicy, localBetaManualHeaders,
    DM_TRADE_RECORDS_URL: "./api/dm/trade-records", authHeaders: () => ({}), parseJson: JSON.parse,
    fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ ok: true, rows: [] }); },
  });
  vm.runInContext(appFunction("requestTradeRecordDmRows"), context);
  const rows = Array.from({ length: 81 }, (_, i) => ({ id: String(i) }));
  await context.requestTradeRecordDmRows(rows);
  assert.equal(calls.length, 0);
  await context.requestTradeRecordDmRows(rows, { manual: true });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === "./api/dm/trade-records" && call.options.headers["X-Beta-Manual-Refresh"] === "1"));
  context.LOCAL_BETA = null;
  await context.requestTradeRecordDmRows(rows, { manual: true });
  assert.ok(calls.slice(2).every(call => !("X-Beta-Manual-Refresh" in call.options.headers)));
});
