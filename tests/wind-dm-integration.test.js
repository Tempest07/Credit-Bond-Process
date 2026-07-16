import test from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, __test__ } from "../functions/api/dm/lookup.js";

test("Wind replaces the DM implied rating when WIND_API_KEY is configured", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "1234567890abcdef";
  const calls = [];
  globalThis.fetch = async (url, init) => {
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
            rows: [["012681111.IB", "26测试SCP001", "AA"]],
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
    let data;
    if (requestUrl.includes("/bond/basic-info/info")) {
      data = [{
        security_id: "012681111.IB",
        sec_short_name: "26测试SCP001",
        sec_full_name: "测试集团有限公司2026年度第一期超短期融资券",
        issuer_name: "测试集团有限公司",
        society_code: "91320000123456789X",
        bond_matu: "270D",
        subject_rating: "AAA",
        rating_agency: "中诚信国际",
        implied_rating: "AA+",
      }];
    } else if (requestUrl.includes("/bond/primary/data")) {
      data = {
        list: [{
          security_id: "012681111.IB",
          sec_short_name: "26测试SCP001",
          issuer_full_name: "测试集团有限公司",
          bond_issue_tenor: "270D",
          plan_issue_amount: 70000,
        }],
      };
    } else {
      data = [{ com_full_name: "测试集团有限公司", society_code: "91320000123456789X" }];
    }
    const encrypted = __test__.sm4EncryptToBase64Url(JSON.stringify({ code: 0, data }), secret);
    return Response.json({ data: encrypted });
  };

  try {
    const response = await onRequestGet({
      env: {
        INNO_APP_KEY: "app",
        INNO_APP_SECRET: secret,
        WIND_API_KEY: "wind-key",
      },
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
    assert.equal(calls.length, 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an enabled Wind path never silently falls back to a DM implied rating", () => {
  const normalized = __test__.applyWindImpliedRating({
    subjectRating: "AAA",
    ratingAgency: "中诚信国际",
    impliedRating: "AA+",
    ratingSource: { impliedRating: "dm-discovery" },
  }, {
    status: "no_result",
    rating: "",
  }, true);

  assert.equal(normalized.impliedRating, "");
  assert.equal(normalized.impliedRatingAsOf, "");
  assert.equal(normalized.ratingSource, undefined);
});
