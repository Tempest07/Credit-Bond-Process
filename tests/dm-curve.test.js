import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet, __test__ as curveTest } from "../functions/api/dm/curve.js";

const CURVE_NAME = "中债国开债收益率曲线";

test("DM policy-bank curve batches and returns the latest same-date 0.1Y to 1Y nodes", async () => {
  const calls = [];
  const response = await onRequestGet(curveContext({
    url: "http://127.0.0.1:8788/api/dm/curve?curve=cdb&asOf=2026-07-14",
    post: async (path, request) => {
      calls.push({ path, request });
      if (request.curveTermList.includes("0.1")) {
        return [
          curveRow({ term: 0.1, rate: 1.28, date: "2026-07-13" }),
          curveRow({ term: 0.2, rate: 1.32, date: "2026-07-13" }),
          curveRow({ term: 0.25, rate: 1.35, date: "2026-07-13" }),
          curveRow({ term: 0.3, rate: 1.36, date: "2026-07-13" }),
          curveRow({ term: 0.4, rate: 1.38, date: "2026-07-13" }),
        ];
      }
      if (request.curveTermList.includes("0.5")) {
        return [
          curveRow({ term: 0.5, rate: 1.39, date: "2026-07-13" }),
          curveRow({ term: 0.6, rate: 1.4, date: "2026-07-13" }),
          curveRow({ term: 0.7, rate: 1.41, date: "2026-07-13" }),
          curveRow({ term: 0.75, rate: 1.43, date: "2026-07-12" }),
          curveRow({ term: 0.75, rate: 999, date: "2026-07-13" }),
          curveRow({ term: 0.75, rate: 1.41, date: "2026-07-13", name: "中债农发行债收益率曲线" }),
          curveRow({ term: 0.75, rate: 1.42, date: "2026-07-13", source: 20 }),
          curveRow({ term: 0.8, rate: 1.44, date: "2026-07-13" }),
        ];
      }
      return [
        curveRow({ term: 0.9, rate: 1.46, date: "2026-07-13" }),
        curveRow({ term: 1, rate: 1.48, date: "2026-07-13", camel: true }),
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
  assert.deepEqual(payload.missingTerms, ["0.75Y"]);
  assert.deepEqual(payload.derivedTerms, []);
  assert.deepEqual(payload.nodes.map((node) => [node.tenor, node.yieldPct]), [
    ["0.1Y", 1.28],
    ["0.2Y", 1.32],
    ["0.25Y", 1.35],
    ["0.3Y", 1.36],
    ["0.4Y", 1.38],
    ["0.5Y", 1.39],
    ["0.6Y", 1.4],
    ["0.7Y", 1.41],
    ["0.75Y", null],
    ["0.8Y", 1.44],
    ["0.9Y", 1.46],
    ["1Y", 1.48],
  ]);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.path === "/dm-quant-func-service/api/v1/bond/yield-curve/data"));
  assert.ok(calls.every((call) => call.request.curveTermList.length <= 5));
  assert.deepEqual(calls.map((call) => call.request.curveTermList), [
    ["0.1", "0.2", "0.25", "0.3", "0.4"],
    ["0.5", "0.6", "0.7", "0.75", "0.8"],
    ["0.9", "1"],
  ]);
  assert.equal(calls[0].request.curveName, CURVE_NAME);
  assert.equal(calls[0].request.dataSource, "18");
  assert.equal(calls[0].request.curveType, "1");
  assert.equal(calls[0].request.startDate, "2026-07-07");
  assert.equal(calls[0].request.endDate, "2026-07-14");
  assert.match(payload.retrievedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("DM policy-bank curve interpolates within current anchors but never extrapolates or uses an older node", () => {
  const snapshot = curveTest.latestCurveSnapshot([
    curveRow({ term: 0.25, rate: 1.31, date: "2026-07-13" }),
    curveRow({ term: 0.5, rate: 1.35, date: "2026-07-13" }),
    curveRow({ term: 0.75, rate: 1.4, date: "2026-07-12" }),
    curveRow({ term: 1, rate: 1.44, date: "2026-07-13" }),
  ], curveTest.curve, "2026-07-14");

  assert.equal(snapshot.actualValuationDate, "2026-07-13");
  assert.equal(snapshot.nodes.find((node) => node.tenor === "0.1Y").yieldPct, null);
  assert.equal(snapshot.nodes.find((node) => node.tenor === "0.2Y").yieldPct, null);
  assert.equal(snapshot.nodes.find((node) => node.tenor === "0.3Y").yieldPct, 1.318);
  assert.equal(snapshot.nodes.find((node) => node.tenor === "0.3Y").method, "derived-linear");
  assert.equal(snapshot.nodes.find((node) => node.tenor === "0.75Y").yieldPct, null);
  assert.deepEqual(snapshot.missingTerms, ["0.1Y", "0.2Y", "0.75Y"]);
  assert.deepEqual(snapshot.derivedTerms, ["0.3Y", "0.4Y", "0.6Y", "0.7Y", "0.8Y", "0.9Y"]);
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
