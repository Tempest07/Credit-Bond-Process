import assert from "node:assert/strict";
import test from "node:test";

import { parseRealtimeQuoteImportText } from "../realtime-quotes.js";

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
