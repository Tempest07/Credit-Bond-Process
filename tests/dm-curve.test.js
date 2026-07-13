import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet, __test__ as curveTest } from "../functions/api/dm/curve.js";

const CURVE_NAME = "中债国开债收益率曲线";

test("DM policy-bank curve returns the latest same-date 3M to 1Y nodes", async () => {
  const calls = [];
  const response = await onRequestGet(curveContext({
    url: "http://127.0.0.1:8788/api/dm/curve?curve=cdb&asOf=2026-07-14",
    post: async (path, request) => {
      calls.push({ path, request });
      return [
        curveRow({ term: 0.75, rate: 1.43, date: "2026-07-12" }),
        curveRow({ term: 1, rate: 1.48, date: "2026-07-13", camel: true }),
        curveRow({ term: 0.25, rate: 1.35, date: "2026-07-13" }),
        curveRow({ term: 0.5, rate: 1.39, date: "2026-07-13" }),
        curveRow({ term: 0.75, rate: 999, date: "2026-07-13" }),
        curveRow({ term: 0.75, rate: 1.41, date: "2026-07-13", name: "中债农发行债收益率曲线" }),
        curveRow({ term: 0.75, rate: 1.42, date: "2026-07-13", source: 20 }),
      ];
    },
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "DM");
  assert.equal(payload.curveName, CURVE_NAME);
  assert.equal(payload.actualValuationDate, "2026-07-13");
  assert.equal(payload.partial, true);
  assert.equal(payload.stale, false);
  assert.deepEqual(payload.missingTerms, ["9M"]);
  assert.deepEqual(payload.nodes.map((node) => [node.tenor, node.yieldPct]), [
    ["3M", 1.35],
    ["6M", 1.39],
    ["9M", null],
    ["1Y", 1.48],
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/dm-quant-func-service/api/v1/bond/yield-curve/data");
  assert.deepEqual(calls[0].request.curveTermList, ["0.25", "0.5", "0.75", "1"]);
  assert.equal(calls[0].request.curveName, CURVE_NAME);
  assert.equal(calls[0].request.dataSource, "18");
  assert.equal(calls[0].request.curveType, "1");
  assert.equal(calls[0].request.startDate, "2026-07-07");
  assert.equal(calls[0].request.endDate, "2026-07-14");
  assert.match(payload.retrievedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("DM policy-bank curve never fills a missing latest node from an older date", () => {
  const snapshot = curveTest.latestCurveSnapshot([
    curveRow({ term: 0.25, rate: 1.31, date: "2026-07-13" }),
    curveRow({ term: 0.5, rate: 1.35, date: "2026-07-13" }),
    curveRow({ term: 0.75, rate: 1.4, date: "2026-07-12" }),
    curveRow({ term: 1, rate: 1.44, date: "2026-07-13" }),
  ], curveTest.curve, "2026-07-14");

  assert.equal(snapshot.actualValuationDate, "2026-07-13");
  assert.equal(snapshot.nodes.find((node) => node.tenor === "9M").yieldPct, null);
  assert.deepEqual(snapshot.missingTerms, ["9M"]);
});

test("DM policy-bank curve reports empty data and validates the requested date", async () => {
  const emptyResponse = await onRequestGet(curveContext({ post: async () => [] }));
  const emptyPayload = await emptyResponse.json();
  assert.equal(emptyResponse.status, 200);
  assert.equal(emptyPayload.ok, false);
  assert.equal(emptyPayload.reason, "noCurveData");
  assert.equal(emptyPayload.source, "DM");

  const invalidResponse = await onRequestGet(curveContext({
    url: "http://127.0.0.1:8788/api/dm/curve?asOf=2026-02-30",
    post: async () => [],
  }));
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).reason, "invalidAsOf");
});

test("DM policy-bank curve hides upstream error details", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await onRequestGet(curveContext({
      post: async () => {
        throw new Error("upstream secret diagnostic body");
      },
    }));
    const text = await response.text();
    assert.equal(response.status, 502);
    assert.doesNotMatch(text, /secret diagnostic/i);
    assert.match(text, /国开债曲线读取失败/);
  } finally {
    console.error = originalError;
  }
});

function curveContext({ url = "http://127.0.0.1:8788/api/dm/curve?asOf=2026-07-14", post }) {
  return {
    request: new Request(url),
    env: { INNO_APP_KEY: "test-key", INNO_APP_SECRET: "test-secret" },
    data: { dmClient: { post } },
  };
}

function curveRow({ term, rate, date, name = CURVE_NAME, source = 18, curveType = 1, camel = false }) {
  if (camel) {
    return {
      dataSource: source,
      curveChName: name,
      curveTerm: term,
      curveType,
      valuationDate: date,
      yield: rate,
    };
  }
  return {
    data_source: source,
    curve_ch_name: name,
    curve_term: term,
    curve_type: curveType,
    valuation_date: date,
    yield: rate,
  };
}
