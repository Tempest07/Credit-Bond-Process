import test from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, __test__ } from "../functions/api/dm/lookup.js";

function encryptedDmResponse(data, secret) {
  const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
  return Response.json({ data: encrypted });
}

function ratingLookupFetch({ secret, calls, dmImpliedRating = "", windRating = "AA" }) {
  return async (url, init) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.includes("mcp.wind.com.cn/vserver_analytics_data/mcp/")) {
      assert.equal(init.headers.Authorization, "Bearer wind-key");
      const request = JSON.parse(init.body);
      if (request.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: request.id, result: {} });
      }
      assert.equal(request.method, "tools/call");
      assert.equal(request.params.name, "get_financial_data");
      assert.equal(request.params.arguments.question, "012681111.IB中债隐含评级");
      const text = JSON.stringify({
        data: {
          data: [{
            columns: [
              { name: "Wind代码", type: "string" },
              { name: "证券简称", type: "string" },
              { name: "隐含评级_中债", type: "string" },
            ],
            rows: [["012681111.IB", "26测试SCP001", windRating]],
          }],
        },
        error: null,
      });
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text }], isError: false },
      });
    }

    const request = JSON.parse(__test__.sm4DecryptFromBase64Url(init.body, secret));
    if (requestUrl.includes("/bond/basic-info/info")) {
      return encryptedDmResponse([{
        security_id: "012681111.IB",
        sec_short_name: "26测试SCP001",
        sec_full_name: "测试集团有限公司2026年度第一期超短期融资券",
        issuer_name: "测试集团有限公司",
        society_code: "91320000123456789X",
        bond_matu: "270D",
      }], secret);
    }
    if (requestUrl.includes("/bond/primary/data")) {
      return encryptedDmResponse({
        list: [{
          security_id: "012681111.IB",
          sec_short_name: "26测试SCP001",
          issuer_full_name: "测试集团有限公司",
          bond_issue_tenor: "270D",
          plan_issue_amount: 70000,
        }],
      }, secret);
    }
    if (requestUrl.includes("/company/basic-info/info")) {
      return encryptedDmResponse([{
        com_full_name: "测试集团有限公司",
        society_code: "91320000123456789X",
      }], secret);
    }
    if (requestUrl.includes("/company/rating/data")) {
      assert.deepEqual(request, { societyCodeList: ["91320000123456789X"] });
      return encryptedDmResponse([{
        com_chi_name: "测试集团有限公司",
        society_code: "91320000123456789X",
        rating_date: "2026-07-16",
        rating: "AAA",
        rating_institution_short_name: "中诚信国际",
        data_source: "外部评级",
      }], secret);
    }
    if (requestUrl.includes("/bond/rating/data")) return encryptedDmResponse([], secret);
    if (requestUrl.includes("/bond/analysis/implied-rating")) {
      return encryptedDmResponse(dmImpliedRating ? [{
        security_id: "012681111.IB",
        sec_short_name: "26测试SCP001",
        rating_date: "2026-07-16",
        cb_implied_rating: dmImpliedRating,
        cs_implied_rating: "AA",
      }] : [], secret);
    }
    if (requestUrl.includes("/bond/default-rate/data")) return encryptedDmResponse([], secret);
    throw new Error(`unexpected request: ${requestUrl}`);
  };
}

test("DM V2.5 rating fields take precedence and skip Wind", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = ratingLookupFetch({ secret, calls, dmImpliedRating: "AA+" });

  try {
    const response = await onRequestGet({
      env: { INNO_APP_KEY: "app", INNO_APP_SECRET: secret, WIND_API_KEY: "wind-key" },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?securityId=012681111.IB"),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json();

    assert.equal(payload.normalized.subjectRating, "AAA");
    assert.equal(payload.normalized.ratingAgency, "中诚信国际");
    assert.equal(payload.normalized.impliedRating, "AA+");
    assert.equal(payload.normalized.ratingSource.subjectRating, "dm-rating-api");
    assert.equal(payload.normalized.ratingSource.ratingAgency, "dm-rating-api");
    assert.equal(payload.normalized.ratingSource.impliedRating, "dm-rating-api");
    assert.deepEqual(payload.diagnostic.rating.filledFromDmRatingApi, ["subjectRating", "ratingAgency", "impliedRating"]);
    assert.deepEqual(payload.diagnostic.rating.filledFromWind, []);
    assert.equal(payload.diagnostic.rating.windImpliedRating.status, "skipped_dm_available");
    assert.equal(payload.raw.windImpliedRating.rating, "");
    assert.ok(!calls.some((url) => url.includes("mcp.wind.com.cn")));
    assert.equal(calls.length, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Wind is called only when DM V2.5 has no implied rating", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = ratingLookupFetch({ secret, calls, dmImpliedRating: "", windRating: "AA" });

  try {
    const response = await onRequestGet({
      env: { INNO_APP_KEY: "app", INNO_APP_SECRET: secret, WIND_API_KEY: "wind-key" },
      request: new Request("http://127.0.0.1:8788/api/dm/lookup?securityId=012681111.IB"),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json();

    assert.equal(payload.normalized.subjectRating, "AAA");
    assert.equal(payload.normalized.ratingAgency, "中诚信国际");
    assert.equal(payload.normalized.impliedRating, "AA");
    assert.equal(payload.normalized.ratingSource.impliedRating, "wind-analytics");
    assert.deepEqual(payload.diagnostic.rating.filledFromWind, ["impliedRating"]);
    assert.equal(payload.diagnostic.rating.windImpliedRating.status, "ok");
    assert.equal(payload.raw.windImpliedRating.rating, "AA");
    assert.ok(calls.some((url) => url.includes("mcp.wind.com.cn")));
    assert.equal(calls.length, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Wind fallback never overwrites an available DM implied rating", () => {
  const dmNormalized = {
    subjectRating: "AAA",
    ratingAgency: "中诚信国际",
    impliedRating: "AA+",
    impliedRatingAsOf: "2026-07-16",
    ratingSource: { impliedRating: "dm-rating-api" },
  };
  const retained = __test__.applyWindImpliedRating(dmNormalized, {
    status: "ok",
    rating: "AA",
    asOf: "2026-07-16",
  }, true);
  assert.deepEqual(retained, dmNormalized);

  const fallback = __test__.applyWindImpliedRating({
    subjectRating: "AAA",
    ratingAgency: "中诚信国际",
    impliedRating: "",
  }, {
    status: "ok",
    rating: "AA",
    asOf: "2026-07-16",
  }, true);
  assert.equal(fallback.impliedRating, "AA");
  assert.equal(fallback.impliedRatingAsOf, "2026-07-16");
  assert.equal(fallback.ratingSource.impliedRating, "wind-analytics");
});
