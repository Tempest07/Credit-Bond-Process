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
