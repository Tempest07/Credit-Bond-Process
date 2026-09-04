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

test("copies OFR as taken and BID as given", () => {
  const row = {
    securityId: "102482906.IB",
    shortName: "24山东机场MTN001",
    bid: { yield: 2.31 },
    ofr: { yield: 2.32 },
  };
  assert.equal(__test__.buildQuoteCopyText(row, "ofr"), "102482906.IB 24山东机场MTN001 taken 2.3200");
  assert.equal(__test__.buildQuoteCopyText(row, "bid"), "102482906.IB 24山东机场MTN001 given 2.3100");
});
