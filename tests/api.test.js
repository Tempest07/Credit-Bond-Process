import test from "node:test";
import assert from "node:assert/strict";

import { onRequestGet, onRequestPut } from "../functions/api/state.js";

test("requires APP_PASSWORD to be configured", async () => {
  const response = await onRequestGet({
    env: {},
    request: new Request("https://example.com/api/state"),
  });
  assert.equal(response.status, 503);
});

test("rejects an incorrect API password", async () => {
  const response = await onRequestPut({
    env: { APP_PASSWORD: "correct" },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { Authorization: "Bearer incorrect" },
      body: JSON.stringify({ data: { version: 1, issuers: [] } }),
    }),
  });
  assert.equal(response.status, 401);
});

test("accepts and preserves project ledger records", async () => {
  let saved = null;
  const DB = {
    prepare(sql) {
      return {
        bind(data) {
          if (sql.includes("INSERT INTO app_state")) saved = JSON.parse(data);
          return this;
        },
        async run() {},
      };
    },
  };
  const response = await onRequestPut({
    env: { APP_PASSWORD: "correct", DB },
    request: new Request("https://example.com/api/state", {
      method: "PUT",
      headers: { Authorization: "Bearer correct" },
      body: JSON.stringify({
        data: {
          version: 3,
          issuers: [],
          projects: [{ id: "p1", shortName: "26测试01" }],
          protocolTransfers: [{ id: "t1", code: "281926.SH", shortName: "26光交01" }],
          secondaryInventoryPositions: [{ id: "s1", code: "280680.SH", shortName: "25联投17", quantityWan: 5000 }],
          secondaryOrders: [{ id: "o1", code: "280680.SH", shortName: "25联投17", side: "offer", quantityWan: 2000 }],
          secondaryTrades: [{ id: "f1", code: "280680.SH", shortName: "25联投17", side: "sell", quantityWan: 1000 }],
          ftpCurve: { y1: 1.5 },
        },
      }),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(saved.projects[0].shortName, "26测试01");
  assert.equal(saved.protocolTransfers[0].code, "281926.SH");
  assert.equal(saved.secondaryInventoryPositions[0].quantityWan, 5000);
  assert.equal(saved.secondaryOrders[0].side, "offer");
  assert.equal(saved.secondaryTrades[0].side, "sell");
  assert.equal(saved.ftpCurve.y1, 1.5);
});
