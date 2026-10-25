import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/issuance-results/recognize.js";

test("issuance recognition accepts the legacy Request contract without a signal", async () => {
  const request = new Request("http://localhost/api/issuance-results/recognize", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "26测试MTN001 尚未公布发行结果", tranches: [{ id: "a", shortName: "26测试MTN001" }] }),
  });
  let calls = 0;
  const response = await onRequestPost({
    request: { url: request.url, headers: request.headers, body: request.body },
    env: { AI: { async run(_model, _input, options) {
      calls++;
      assert.equal(options.signal.aborted, false);
      return { response: JSON.stringify({ items: [], sharedEvidence: [] }) };
    } } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).canApply, false);
  assert.equal(calls, 1);
});
