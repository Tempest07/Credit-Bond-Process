import assert from "node:assert/strict";
import test from "node:test";

import { __test__, onRequestPost } from "../functions/api/dm/realtime-quotes.js";

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const REALTIME_QUOTE_PATH = "/dm-quant-func-service/api/v1/bond/market-data/realtime-quote";

test("resolves mixed codes and exact short names before requesting one realtime batch", async () => {
  const calls = [];
  const response = await onRequestPost(context({
    queries: ["102482906.IB", "24山东机场MTN001"],
    post: async (path, request) => {
      calls.push({ path, request });
      if (path === BASIC_INFO_PATH && request.securityIdList) {
        return [{ security_id: "102482906.IB", sec_short_name: "24山东机场MTN001", remaining_tenor: "1.32Y" }];
      }
      if (path === BASIC_INFO_PATH && request.secShortNameList) {
        return [{ security_id: "102482906.IB", sec_short_name: "24山东机场MTN001", remaining_tenor: "1.32Y" }];
      }
      assert.equal(path, REALTIME_QUOTE_PATH);
      return [{
        security_id: "102482906.IB",
        sec_short_name: "24山东机场MTN001",
        issue_date: "2026-09-04",
        broker_issue_time: "11:09:27",
        broker_bid_yield: 2.345,
        broker_bid_volume_value: 2000,
        broker_ofr_yield: 2.32,
        broker_ofr_volume_value: 3000,
        broker_bid_yield_sub_ofr: 0.025,
      }];
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].securityId, "102482906.IB");
  assert.equal(payload.rows[0].status, "two-sided");
  assert.deepEqual(payload.rows[0].bid, { yield: 2.345, netPrice: null, volumeWan: 2000 });
  assert.deepEqual(payload.rows[0].ofr, { yield: 2.32, netPrice: null, volumeWan: 3000 });
  assert.equal(payload.rows[0].source, "DM 经纪商聚合");
  assert.equal(payload.diagnostic.brokerBreakdownAvailable, false);
  assert.equal(calls.filter((call) => call.path === REALTIME_QUOTE_PATH).length, 1);
  assert.deepEqual(calls.at(-1).request.securityIdList, ["102482906.IB"]);
});

test("keeps an explicit code visible when basic info has not resolved it yet", async () => {
  const response = await onRequestPost(context({
    queries: ["250004"],
    post: async (path) => path === BASIC_INFO_PATH ? [] : [],
  }));
  const payload = await response.json();

  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].securityId, "250004");
  assert.equal(payload.rows[0].status, "no-quote");
  assert.deepEqual(payload.unresolved, []);
});

test("reports unmatched names separately and validates the 200-security limit", async () => {
  const missing = await onRequestPost(context({
    queries: ["不存在的债券"],
    post: async () => [],
  }));
  const missingPayload = await missing.json();
  assert.equal(missingPayload.rows.length, 0);
  assert.deepEqual(missingPayload.unresolved, [{ query: "不存在的债券", reason: "DM 基础资料未匹配到精确简称" }]);

  const tooMany = await onRequestPost(context({
    queries: Array.from({ length: 201 }, (_, index) => String(100000 + index)),
    post: async () => [],
  }));
  assert.equal(tooMany.status, 400);
});

test("normalizes duplicate inputs and classifies supported security ids", () => {
  assert.deepEqual(__test__.normalizeQueries([" 250004 ", "250004", "26测试MTN001"]), ["250004", "26测试MTN001"]);
  assert.equal(__test__.looksLikeSecurityId("102482906.ib"), true);
  assert.equal(__test__.looksLikeSecurityId("250004"), true);
  assert.equal(__test__.looksLikeSecurityId("26测试MTN001"), false);
});

function context({ queries, post }) {
  return {
    request: new Request("http://127.0.0.1:8788/api/dm/realtime-quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
    }),
    env: { INNO_APP_KEY: "test-key", INNO_APP_SECRET: "test-secret" },
    data: { dmClient: { post } },
  };
}
