import test from "node:test";
import assert from "node:assert/strict";

import {
  __test__,
  lookupWindImpliedRating,
  windImpliedRatingEnabled,
} from "../functions/api/_wind.js";

test("Wind implied-rating lookup stays disabled without a server-side secret", async () => {
  let called = false;
  const result = await lookupWindImpliedRating({}, {
    securityId: "012680994.IB",
    fetchImpl: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });

  assert.equal(windImpliedRatingEnabled({}), false);
  assert.equal(called, false);
  assert.equal(result.status, "not_configured");
  assert.equal(result.rating, "");
});

test("Wind implied-rating lookup parses MCP SSE rows and matches the requested bond", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push(request);
    if (request.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: request.id, result: {} });
    }
    const contentText = JSON.stringify({
      data: {
        data: [{
          columns: [
            { name: "Wind代码" },
            { name: "证券简称" },
            { name: "隐含评级_中债" },
            { name: "数据日期" },
          ],
          rows: [
            ["012680111.IB", "26其他SCP001", "AAA", "2026-07-10"],
            ["012680994.IB", "26武商SCP003", "AA(2)", "2026-07-13"],
          ],
        }],
      },
      error: null,
    });
    const payload = {
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: contentText }], isError: false },
    };
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const result = await lookupWindImpliedRating({ WIND_API_KEY: "server-secret" }, {
    securityId: "012680994.IB",
    fetchImpl,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].params.arguments.question, "012680994.IB中债隐含评级");
  assert.equal(result.status, "ok");
  assert.equal(result.rating, "AA(2)");
  assert.equal(result.windCode, "012680994.IB");
  assert.equal(result.shortName, "26武商SCP003");
  assert.equal(result.asOf, "2026-07-13");
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
});

test("Wind implied-rating parser only accepts the ChinaBond implied-rating column", () => {
  const contentText = JSON.stringify({
    data: {
      data: [{
        columns: [{ name: "主体评级" }, { name: "隐含评级_中债" }],
        rows: [["AAA", "AAA-"]],
      }],
    },
    error: null,
  });
  const rows = __test__.windRowsFromMcpResult({
    content: [{ type: "text", text: contentText }],
    isError: false,
  });
  const matched = __test__.bestWindImpliedRatingRow(rows);

  assert.equal(matched.rating, "AAA-");
});

test("Wind implied-rating lookup does not select an identified non-matching bond", async () => {
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: request.id, result: {} });
    }
    const contentText = JSON.stringify({
      data: {
        data: [{
          columns: [{ name: "Wind代码" }, { name: "证券简称" }, { name: "隐含评级_中债" }],
          rows: [["012680111.IB", "26其他SCP001", "AAA"]],
        }],
      },
      error: null,
    });
    return Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: contentText }], isError: false },
    });
  };

  const result = await lookupWindImpliedRating({ WIND_API_KEY: "server-secret" }, {
    securityId: "012680994.IB",
    shortName: "26武商SCP003",
    fetchImpl,
  });

  assert.equal(result.status, "no_result");
  assert.equal(result.rating, "");
});

test("Wind implied-rating lookup does not expose upstream error bodies", async () => {
  const result = await lookupWindImpliedRating({ WIND_API_KEY: "server-secret" }, {
    securityId: "012680994.IB",
    fetchImpl: async () => new Response("provider-internal-detail", { status: 401 }),
  });

  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "WIND_HTTP_ERROR");
  assert.equal(result.error, "Wind 服务请求失败");
  assert.equal(JSON.stringify(result).includes("provider-internal-detail"), false);
});
