import assert from "node:assert/strict";
import test from "node:test";

import { __test__, parseRealtimeQuoteImportEntries, parseRealtimeQuoteImportText } from "../realtime-quotes.js";

test("parses newline, CSV and rich quote clipboard inputs without duplicating securities", () => {
  const result = parseRealtimeQuoteImportText(`
代码,简称
102482906.IB,24山东机场MTN001
250004
BID 4.24Y 102482906.IB 24山东机场MTN001 2.34%* 3000
26测试MTN001
  `);

  assert.deepEqual(result, ["102482906.IB", "250004", "26测试MTN001"]);
});

test("accepts multiple short names separated by whitespace", () => {
  assert.deepEqual(parseRealtimeQuoteImportText("26测试MTN001 26测试SCP002"), ["26测试MTN001", "26测试SCP002"]);
});

test("filters obvious region headings without rejecting valid bond short names", () => {
  assert.deepEqual(parseRealtimeQuoteImportText(`
陕西（西安）
山东（青岛）
华东地区
24国开10
大秦转债
26测试MTN001
  `), ["24国开10", "大秦转债", "26测试MTN001"]);
  assert.deepEqual(__test__.mergeWatchItems([], ["江苏", "广东（广州）", "浦发转债"]), [{
    query: "浦发转债",
    label: "",
    alerts: [],
  }]);
});

test("removes exact DM-unmatched names from the live watchlist", () => {
  const result = __test__.pruneUnresolvedWatchItems([
    { query: "24国开10", label: "", alerts: [] },
    { query: "疑似简称", label: "疑似简称", alerts: [] },
  ], [{ query: "疑似简称", reason: "DM 基础资料未匹配到精确简称" }]);

  assert.deepEqual(result.watchlist.map((item) => item.query), ["24国开10"]);
  assert.deepEqual(result.removed.map((item) => item.query), ["疑似简称"]);
});

test("keeps imported short name, buy/sell direction and target on the same bond", () => {
  const result = parseRealtimeQuoteImportEntries(`
102482906.IB 24山东机场MTN001 买入 2.34%
102482906.IB 24山东机场MTN001 卖出 2.30
  `);

  assert.deepEqual(result, [{
    query: "102482906.IB",
    label: "24山东机场MTN001",
    alerts: [
      { side: "buy", metric: "yield", target: 2.34 },
      { side: "sell", metric: "yield", target: 2.3 },
    ],
  }]);
});

test("supports explicit net-price targets", () => {
  assert.deepEqual(parseRealtimeQuoteImportEntries("250004.IB 25测试债04 买入 净价 99.85"), [{
    query: "250004.IB",
    label: "25测试债04",
    alerts: [{ side: "buy", metric: "netPrice", target: 99.85 }],
  }]);
});

test("evaluates target crossings against OFR for buys and BID for sells", () => {
  const row = {
    bid: { yield: 2.29, netPrice: 101.2 },
    ofr: { yield: 2.35, netPrice: 99.8 },
  };
  assert.equal(__test__.targetIsMet(row, { side: "buy", metric: "yield", target: 2.34 }), true);
  assert.equal(__test__.targetIsMet(row, { side: "sell", metric: "yield", target: 2.3 }), true);
  assert.equal(__test__.targetIsMet(row, { side: "buy", metric: "netPrice", target: 100 }), true);
  assert.equal(__test__.targetIsMet(row, { side: "sell", metric: "netPrice", target: 101 }), true);
});

test("classifies quote improvements with side-aware bond yield logic", () => {
  assert.equal(__test__.describeQuoteChange({ yield: 2.35 }, { yield: 2.34 }, "bid").quality, "improved");
  assert.equal(__test__.describeQuoteChange({ yield: 2.35 }, { yield: 2.36 }, "bid").quality, "worsened");
  assert.equal(__test__.describeQuoteChange({ yield: 2.34 }, { yield: 2.35 }, "ofr").quality, "improved");
  assert.equal(__test__.describeQuoteChange({ netPrice: 100 }, { netPrice: 99.9 }, "ofr").quality, "improved");
});

test("copies OFR as TKN and BID as GVN", () => {
  const takenRow = {
    securityId: "042680222.IB",
    shortName: "26陕西建工CP005",
    ofr: { yield: 5.55 },
  };
  const givenRow = {
    securityId: "102682494.IB",
    shortName: "26长电MTN004",
    bid: { yield: 2.055 },
  };
  assert.equal(__test__.buildQuoteCopyText(takenRow, "ofr"), "042680222.IB 26陕西建工CP005 TKN 5.5500");
  assert.equal(__test__.buildQuoteCopyText(givenRow, "bid"), "102682494.IB 26长电MTN004 GVN 2.0550");
});

test("clamps and restores persisted realtime column widths", () => {
  assert.equal(__test__.clampColumnWidth("identity", 80), 120);
  assert.equal(__test__.clampColumnWidth("identity", 360), 360);
  assert.equal(__test__.clampColumnWidth("identity", 900), 720);
  assert.deepEqual(__test__.normalizeColumnWidths({ identity: "360", bid: 20, unknown: 200 }), { identity: 360, bid: 64 });
  assert.deepEqual(__test__.normalizeColumnWidths(null), {});
});

test('pause cancels scheduling and requests; only manual refresh runs until resumed', async (t) => {
  const previousWindow = globalThis.window;
  let cleared = 0, scheduled = 0, calls = 0;
  globalThis.window = { clearTimeout: () => cleared++, setTimeout: () => ++scheduled };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
  const c = Object.create(__test__.RealtimeQuoteController.prototype);
  const inflight = new AbortController();
  Object.assign(c, { paused: false, watchlist: [{query:'250004'}], rows: [], loading: false,
    fetchController: inflight, requestSequence: 0, intervalMs: 20000, lastFetchedAt: new Date().toISOString(),
    renderStatus() {}, render() {} });
  c.togglePaused();
  assert.equal(c.paused, true);
  assert.equal(inflight.signal.aborted, true);
  assert.equal(c.nextRefreshAt, 0);
  await c.refresh();
  assert.equal(calls, 0);
  await c.refresh({manual:true});
  assert.equal(calls, 1);
  assert.equal(scheduled, 0);
  assert.equal(c.paused, true);
  c.togglePaused();
  assert.equal(c.paused, false);
  assert.equal(scheduled, 1);
  assert.ok(cleared > 0);
});

function sourceResetController(overrides = {}) {
  const c = Object.create(__test__.RealtimeQuoteController.prototype);
  Object.assign(c, {
    active: true, paused: false, dmSuspended: false, watchlist: [{ query: '102600001.IB', alerts: [] }], pendingImports: [{ query: '26待导入' }],
    rows: [{ securityId: '102600001.IB', source: 'DM' }], unresolved: [], valuations: new Map([['102600001.IB', { source: 'DM' }]]),
    loading: false, valuationLoading: false, requestSequence: 0, valuationSequence: 0,
    fetchController: null, valuationController: null, refreshTimer: 1, changeTimer: 2,
    lastFetchedAt: '', valuationFetchedAt: '', valuationRetryAt: 0, error: '', valuationError: '', intervalMs: 20000,
    liveChanges: new Map(), unseenChanges: new Map(), alertStates: new Map(), alertEvents: [{ id: 'existing-alert' }],
    render() {}, renderStatus() {}, renderTable() {}, renderValuationStatus() {},
    captureQuoteChanges() {}, evaluateAlerts() {}, onToast() {}, save() {},
    ...overrides,
  });
  return c;
}

const settleSource = () => new Promise(resolve => setImmediate(resolve));

test('source reset aborts old quotes and a late response cannot overwrite or suspend the new source', async t => {
  const previousWindow = globalThis.window;
  globalThis.window = { clearTimeout() {}, setTimeout: () => 1 };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const pending = [];
  t.mock.method(globalThis, 'fetch', (_url, init) => new Promise(resolve => pending.push({ init, resolve })));
  const c = sourceResetController({ maybeRefreshValuations() {} });
  const old = c.refresh();
  assert.equal(pending.length, 1);
  c.resetDataSource();
  assert.equal(pending[0].init.signal.aborted, true);
  assert.equal(pending.length, 2);
  assert.equal(c.rows.length, 0);
  pending[1].resolve(new Response(JSON.stringify({ ok: true, rows: [{ securityId: '102600001.IB', source: 'QB' }], unresolved: [] })));
  await settleSource();
  assert.equal(c.rows[0].source, 'QB');
  pending[0].resolve(new Response(JSON.stringify({ code: 'DM_REALTIME_SUSPENDED', error: 'old response' }), { status: 403 }));
  await old;
  assert.equal(c.rows[0].source, 'QB');
  assert.equal(c.dmSuspended, false);
  assert.equal(c.paused, false);
});

test('source reset prevents a late valuation from writing data or clearing the new request state', async t => {
  const previousWindow = globalThis.window;
  globalThis.window = { clearTimeout() {}, setTimeout: () => 1 };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const pending = [];
  t.mock.method(globalThis, 'fetch', (_url, init) => new Promise(resolve => pending.push({ init, resolve })));
  const c = sourceResetController({ paused: true });
  const old = c.maybeRefreshValuations([{ securityId: '102600001.IB' }], { force: true });
  c.resetDataSource();
  assert.equal(pending[0].init.signal.aborted, true);
  assert.equal(c.valuations.size, 0);
  const next = c.maybeRefreshValuations([{ securityId: '102600001.IB' }], { force: true });
  const nextController = c.valuationController;
  pending[0].resolve(new Response(JSON.stringify({ ok: true, rows: [{ securityId: '102600001.IB', provider: 'DM' }] })));
  await old;
  assert.equal(c.valuations.size, 0);
  assert.equal(c.valuationLoading, true);
  assert.equal(c.valuationController, nextController);
  pending[1].resolve(new Response(JSON.stringify({ ok: true, rows: [{ securityId: '102600001.IB', provider: 'QB' }], fetchedAt: '2026-10-23T01:00:00Z' })));
  await next;
  assert.equal(c.valuations.get('102600001.IB').provider, 'QB');
  assert.equal(c.valuationLoading, false);
  assert.equal(c.paused, true);
});

test('source reset preserves pause, suspension, watchlist and background polling policy', async t => {
  const previousWindow = globalThis.window;
  let scheduled = 0, calls = 0;
  globalThis.window = { clearTimeout() {}, setTimeout: () => ++scheduled };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not fetch'); });
  for (const flags of [{ paused: true }, { paused: true, dmSuspended: true, error: '访问已暂停' }, { active: false }]) {
    const c = sourceResetController(flags);
    const watchlist = c.watchlist, imports = c.pendingImports, events = c.alertEvents;
    c.resetDataSource();
    assert.equal(c.watchlist, watchlist);
    assert.equal(c.pendingImports, imports);
    assert.equal(c.alertEvents, events);
    assert.equal(c.paused, flags.paused ?? false);
    assert.equal(c.dmSuspended, flags.dmSuspended ?? false);
    assert.equal(c.rows.length, 0);
    assert.equal(c.valuations.size, 0);
    assert.equal(c.valuationRetryAt, 0);
    if (flags.dmSuspended) assert.equal(c.error, '访问已暂停');
  }
  assert.equal(calls, 0);
  assert.equal(scheduled, 1);
});
