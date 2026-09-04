import assert from "node:assert/strict";
import test from "node:test";

import { __test__, onRequestPost } from "../functions/api/dm/realtime-valuations.js";

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const MARKET_DATA_DATE_PATH = "/dm-quant-func-service/api/v1/bond/market-data/date";

test("returns latest ChinaBond and CSI valuations with the correct exercise basis", async () => {
  const calls = [];
  const response = await onRequestPost(context({
    securityIds: ["102482906.IB"],
    post: async (path, request) => {
      calls.push({ path, request });
      if (path === BASIC_INFO_PATH) {
        return [{
          security_id: "102482906.IB",
          sec_short_name: "24山东机场MTN001",
          next_option_date: "2027-06-01",
        }];
      }
      assert.equal(path, MARKET_DATA_DATE_PATH);
      return [
        {
          security_id: "102482906.IB",
          issue_date: "2026-09-03",
          data_source: 1,
          cb_reliability: "推荐",
          cb_ytm: 2.3,
          cb_yte: 2.28,
          cb_npte: 100.1234,
          cs_reliability: "推荐",
          cs_ytm: 2.31,
          cs_yte: 2.29,
          cs_npte: 100.101,
        },
        {
          security_id: "102482906.IB",
          issue_date: "2026-09-04",
          data_source: 1,
          cb_reliability: "推荐",
          cb_ytm: 2.27,
          cb_yte: 2.25,
          cb_npte: 100.2234,
          cs_reliability: "推荐",
          cs_ytm: 2.28,
          cs_yte: 2.26,
          cs_npte: 100.201,
        },
      ];
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.rows[0].preferredBasis, "行权");
  assert.deepEqual(payload.rows[0].chinaBond, {
    securityId: "102482906.IB",
    date: "2026-09-04",
    yield: 2.25,
    netPrice: 100.2234,
    basis: "行权",
    field: "cbYte",
    reliability: "推荐",
    dataSource: 1,
  });
  assert.equal(payload.rows[0].chinaSecurities.yield, 2.26);
  assert.equal(calls.filter((call) => call.path === MARKET_DATA_DATE_PATH).length, 1);
  assert.deepEqual(calls.at(-1).request.dataSourceList, [1, 3, 4, 7]);
  assert.ok(calls.at(-1).request.fieldNames.includes("cbYtm"));
  assert.ok(calls.at(-1).request.fieldNames.includes("csYte"));
});

test("uses maturity valuation for an ordinary bond and preserves missing institutions", () => {
  const result = __test__.buildValuationRow({
    securityId: "250004.IB",
    basic: { security_id: "250004.IB", sec_short_name: "25测试债04" },
    requestedDate: "2026-09-04",
    marketRows: [{
      security_id: "250004.IB",
      issue_date: "2026-09-04",
      cb_ytm: 1.955,
      cb_nptm: 101.02,
    }],
  });

  assert.equal(result.preferredBasis, "到期");
  assert.equal(result.chinaBond.yield, 1.955);
  assert.equal(result.chinaBond.basis, "到期");
  assert.equal(result.chinaSecurities, null);
});

test("batches market-data requests at the DM five-security limit", async () => {
  const calls = [];
  const securityIds = Array.from({ length: 11 }, (_, index) => `${String(250001 + index).padStart(6, "0")}.IB`);
  const response = await onRequestPost(context({
    securityIds,
    post: async (path, request) => {
      calls.push({ path, request });
      return [];
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.rows.length, 11);
  const marketCalls = calls.filter((call) => call.path === MARKET_DATA_DATE_PATH);
  assert.equal(marketCalls.length, 3);
  assert.deepEqual(marketCalls.map((call) => call.request.securityIdList.length), [5, 5, 1]);
});

function context({ securityIds, post }) {
  return {
    request: new Request("http://127.0.0.1:8788/api/dm/realtime-valuations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ securityIds }),
    }),
    env: { INNO_APP_KEY: "test-key", INNO_APP_SECRET: "test-secret" },
    data: { dmClient: { post } },
  };
}
