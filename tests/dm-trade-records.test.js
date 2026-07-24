import assert from "node:assert/strict";
import test from "node:test";

import {
  __test__,
  onRequestPost,
} from "../functions/api/dm/trade-records.js";

const BASIC_INFO_PATH = "/dm-quant-func-service/api/v1/bond/basic-info/info";
const MARKET_DATA_PATH = "/dm-quant-func-service/api/v1/bond/market-data/date";

test("maps the three former Wind formula fields to batched DM values", async () => {
  const calls = [];
  const response = await onRequestPost(context({
    rows: [
      { id: "secondary:one", securityId: "102682206.IB", negotiationDate: "2026-07-24" },
      { id: "secondary:two", securityId: "102682402.IB", negotiationDate: "2026-07-24" },
    ],
    post: async (path, request) => {
      calls.push({ path, request });
      if (path === BASIC_INFO_PATH) {
        return [
          { security_id: "102682206.IB", sec_short_name: "19.9Y(休2)", bond_type_desc: "公司债" },
          { security_id: "102682402.IB", sec_short_name: "26青岛城投MTN003", bond_type_desc: "中期票据" },
        ];
      }
      assert.equal(path, MARKET_DATA_PATH);
      return [
        { security_id: "102682206.IB", issue_date: "2026-07-23", data_source: 1, cb_reliability: "推荐", cb_ytm: 2.335 },
        { security_id: "102682206.IB", issue_date: "2026-07-24", data_source: 1, cb_ytm: 9.999 },
        { security_id: "102682402.IB", issue_date: "2026-07-22", data_source: 3, cb_ytm: 1.97 },
      ];
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.rows[0].shortName, "19.9Y(休2)");
  assert.equal(payload.rows[0].bondType, "公司债");
  assert.equal(payload.rows[0].valuationYield, 2.335);
  assert.equal(payload.rows[0].valuationDate, "2026-07-23");
  assert.equal(payload.rows[1].valuationYield, 1.97);
  assert.equal(payload.rows[1].valuationDate, "2026-07-22");
  assert.deepEqual(payload.formulaMapping, {
    shortName: "bond/basic-info/info.secShortName",
    bondType: "bond/basic-info/info.bondTypeDesc",
    valuationYield: "bond/market-data/date.cbYte/cbYtm（按中债推荐口径）",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.securityIdList.length, 2);
  assert.equal(calls[1].request.securityIdList.length, 2);
  assert.equal(calls[1].request.startDate, "2026-07-16");
  assert.equal(calls[1].request.endDate, "2026-07-23");
  assert.deepEqual(calls[1].request.dataSourceList, [1, 3, 4, 7]);
  assert.ok(calls[1].request.fieldNames.includes("cbYtm"));
  assert.ok(calls[1].request.fieldNames.includes("cbYte"));
});

test("does not use an exercise yield for an ordinary bond", () => {
  const result = __test__.buildResult(
    {
      id: "secondary:one",
      securityId: "102682206.IB",
      requestedDate: "2026-07-23",
    },
    { security_id: "102682206.IB", sec_short_name: "测试债", bond_type_desc: "公司债" },
    [{ security_id: "102682206.IB", issue_date: "2026-07-23", cb_yte: 1.8 }],
  );
  assert.equal(result.valuationYield, null);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.missing, ["估值收益率"]);
});

test("uses cbYte for an exercisable bond and records the actual basis", () => {
  const result = __test__.buildResult(
    {
      id: "secondary:one",
      securityId: "102682206.IB",
      requestedDate: "2026-07-23",
    },
    {
      security_id: "102682206.IB",
      sec_short_name: "测试含权债",
      bond_type_desc: "公司债",
      next_option_date: "2028-07-23",
    },
    [{
      security_id: "102682206.IB",
      issue_date: "2026-07-23",
      cb_reliability: "推荐",
      cb_ytm: 2.15,
      cb_yte: 1.88,
    }],
  );

  assert.equal(result.valuationYield, 1.88);
  assert.equal(result.valuationField, "cbYte");
  assert.equal(result.status, "complete");
});

test("falls back to cbYtm when an exercisable bond has no cbYte", () => {
  const result = __test__.buildResult(
    {
      id: "secondary:one",
      securityId: "102682206.IB",
      requestedDate: "2026-07-23",
    },
    {
      security_id: "102682206.IB",
      sec_short_name: "测试含权债",
      bond_type_desc: "公司债",
      next_option_date: "2028-07-23",
    },
    [{
      security_id: "102682206.IB",
      issue_date: "2026-07-23",
      cb_reliability: "推荐",
      cb_ytm: 2.15,
    }],
  );

  assert.equal(result.valuationYield, 2.15);
  assert.equal(result.valuationField, "cbYtm");
});

test("recognizes a special exercise tenor even when DM omits the next option date", () => {
  assert.equal(__test__.bondPrefersExerciseYield({ bond_matu: "3+2Y" }, "2026-07-23"), true);
  assert.equal(__test__.bondPrefersExerciseYield({ bond_matu: "5Y" }, "2026-07-23"), false);
});

test("validates rows and derives the exact Wind-compatible negotiation-date-minus-one request date", () => {
  assert.deepEqual(__test__.normalizeRequestRows([
    { id: "one", securityId: "102682206.ib", negotiationDate: "2026-07-01" },
    { id: "bad", securityId: "", negotiationDate: "2026-07-01" },
  ]), [{
    id: "one",
    securityId: "102682206.IB",
    negotiationDate: "2026-07-01",
    requestedDate: "2026-06-30",
  }]);
});

function context({ rows, post }) {
  return {
    request: new Request("http://127.0.0.1:8788/api/dm/trade-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    }),
    env: { INNO_APP_KEY: "test-key", INNO_APP_SECRET: "test-secret" },
    data: { dmClient: { post } },
  };
}
