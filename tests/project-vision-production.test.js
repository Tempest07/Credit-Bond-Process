import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createLocalIssuanceGateway } from "../tools/serve-local-issuance-ai.mjs";
import { onRequestPost } from "../functions/api/project-screenshot/recognize.js";
import { PROJECT_VISION_MODEL, PROJECT_VISION_REVISION, validateVisionImage, validateVisionOutput } from "../project-screenshot-vision.js";

const jpeg = new Uint8Array([255,216,255,192,0,11,8,0,10,0,10,1,1,17,0]);
const token = "test-only-token-not-a-production-secret";
const env = { ISSUANCE_LOCAL_AI_ENABLED: "true", ISSUANCE_LOCAL_AI_URL: "https://local-ai.example/v1/issuance-recognition", ISSUANCE_LOCAL_AI_TOKEN: token };
const output = { model: PROJECT_VISION_MODEL, promptRevision: PROJECT_VISION_REVISION,
  entries: [{ branch: "南京分行", fullName: "测试甲有限公司2026年度第二期中期票据" }, { branch: "南京分行", fullName: "测试乙有限公司2026年度第八期超短期融资券" }], warnings: [] };
const request = (headers = {}, host = "localhost") => new Request(`http://${host}/api/project-screenshot/recognize`, { method: "POST", headers: { "Content-Type": "image/jpeg", ...headers }, body: jpeg });

test("vision API enforces authentication and origin before forwarding", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json(output); };
  assert.equal((await onRequestPost({ request: request({}, "example.com"), env, fetchImpl })).status, 401);
  assert.equal((await onRequestPost({ request: request({ Origin: "https://evil.example" }), env, fetchImpl })).status, 403);
  assert.equal((await onRequestPost({ request: request({ "Content-Type": "image/svg+xml" }), env, fetchImpl })).status, 415);
  assert.equal((await onRequestPost({ request: request({ "Content-Length": "31457281" }), env, fetchImpl })).status, 413);
  assert.equal(calls, 0);
});

test("vision API forwards original bytes and server-only credentials; projects only validated output", async () => {
  const response = await onRequestPost({ request: request(), env: { ...env, ISSUANCE_LOCAL_AI_ACCESS_CLIENT_ID: "test-id", ISSUANCE_LOCAL_AI_ACCESS_CLIENT_SECRET: "test-secret" }, fetchImpl: async (url, options) => {
    assert.equal(String(url), "https://local-ai.example/v1/project-screenshot");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers["CF-Access-Client-Secret"], "test-secret");
    assert.deepEqual(options.body, jpeg);
    return Response.json({ ...output, privateDebug: "must not reach browser" });
  } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.entries, output.entries);
  assert.equal(body.privateDebug, undefined);
});

test("vision API supports the Pages runtime without an incoming request signal", async () => {
  const incoming = request();
  Object.defineProperty(incoming, "signal", { value: undefined });
  const response = await onRequestPost({ request: incoming, env, fetchImpl: async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(output);
  } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries, output.entries);
});

test("vision API surfaces busy/offline and rejects wrong model or truncated protocol", async () => {
  for (const [upstream, expected] of [[new Response("busy", { status: 429 }), 429], [new Response("offline", { status: 502 }), 503], [Response.json({ ...output, model: "wrong" }), 503], [Response.json({ ...output, entries: [{ branch: 7 }] }), 503]]) {
    assert.equal((await onRequestPost({ request: request(), env, fetchImpl: async () => upstream })).status, expected);
  }
  assert.equal((await onRequestPost({ request: request(), env: {}, fetchImpl: async () => { throw new Error("must not call"); } })).status, 503);
});

test("vision contract retains incomplete rows for manual review and bounds decoded dimensions", () => {
  const incomplete = validateVisionOutput({ entries: [{ branch: "", fullName: "" }], warnings: [] });
  assert.equal(incomplete.entries.length, 1);
  assert.equal(incomplete.warnings.length, 1);
  const large = new Uint8Array(24);
  large.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(large.buffer); view.setUint32(16, 16000); view.setUint32(20, 16000);
  assert.throws(() => validateVisionImage(large, "image/png"), /尺寸/);
});

test("authenticated gateway shares one inference slot; issuance protocol remains compatible", async (t) => {
  let release; let notify;
  const entered = new Promise((resolve) => { notify = resolve; });
  const gateway = createLocalIssuanceGateway({ token, logger: { log() {}, warn() {} },
    recognizeVision: async (image, type) => { assert.equal(type, "image/jpeg"); assert.deepEqual(new Uint8Array(image), jpeg); notify(); await new Promise((resolve) => { release = resolve; }); return output; },
    extract: async (value) => ({ output: value, model: "gpt-oss:20b", attempts: 1 }),
  });
  gateway.listen(0, "127.0.0.1"); await once(gateway, "listening");
  t.after(() => { release?.(); gateway.closeAllConnections(); gateway.close(); });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  assert.equal((await fetch(`${base}/v1/project-screenshot`, { method: "POST", body: jpeg })).status, 401);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" };
  const pending = fetch(`${base}/v1/project-screenshot`, { method: "POST", headers, body: jpeg });
  await entered;
  const issuance = { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ request: { text: "test notice" } }) };
  assert.equal((await fetch(`${base}/v1/issuance-recognition`, issuance)).status, 429);
  release(); assert.equal((await pending).status, 200);
  const result = await (await fetch(`${base}/v1/issuance-recognition`, issuance)).json();
  assert.equal(result.model, "gpt-oss:20b"); assert.equal(result.output.text, "test notice");
});
