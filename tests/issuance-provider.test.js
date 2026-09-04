import assert from "node:assert/strict";
import test from "node:test";
import { ISSUANCE_FIELDS } from "../issuance-recognition.js";
import { ISSUANCE_MODEL } from "../functions/api/_issuance-model.js";
import {
  LOCAL_ISSUANCE_MODEL,
  LOCAL_ISSUANCE_PROMPT_REVISION,
  localProviderConfig,
  recognizeIssuanceWithProviders,
} from "../functions/api/_issuance-provider.js";
import { createLocalIssuanceGateway } from "../tools/serve-local-issuance-ai.mjs";

const token = "local-test-token-0123456789-abcdefghijk";
const text = "26测试MTN001A，代码102600001，3年，实际发行5亿元，票面1.59%，全场3.86倍，边际2.86倍，2026年9月3日缴款。";
const request = { text, noticeDate: "2026-09-02", tranches: [{ id: "a", shortName: "26测试MTN001A", securityCode: "", durationText: "3Y" }] };

test("local provider is disabled by default and cloud behavior remains unchanged", async () => {
  let localCalls = 0;
  let cloudCalls = 0;
  const result = await recognizeIssuanceWithProviders(request, {
    AI: { async run(model) { cloudCalls++; assert.equal(model, ISSUANCE_MODEL); return modelResponse(); } },
  }, { fetchImpl: async () => { localCalls++; throw new Error("must not run"); } });
  assert.equal(localCalls, 0);
  assert.equal(cloudCalls, 1);
  assert.equal(result.provider, "workers-ai");
  assert.equal(result.fallbackFrom, undefined);
});

test("a clean local result avoids a Cloudflare inference", async () => {
  let cloudCalls = 0;
  const result = await recognizeIssuanceWithProviders(request, localEnv({
    AI: { async run() { cloudCalls++; return modelResponse(); } },
  }), { fetchImpl: async (_url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers["CF-Access-Client-Id"], "access-id");
    return gatewayResponse(extracted());
  } });
  assert.equal(cloudCalls, 0);
  assert.equal(result.canApply, true);
  assert.equal(result.provider, "local-ollama");
  assert.equal(result.model, LOCAL_ISSUANCE_MODEL);
});

test("local warnings are strict failures and fall back to Cloudflare", async () => {
  let cloudCalls = 0;
  const incomplete = extracted();
  incomplete.items[0].fields.paymentDate = { raw: null, evidence: "" };
  const result = await recognizeIssuanceWithProviders(request, localEnv({
    AI: { async run() { cloudCalls++; return modelResponse(); } },
  }), { fetchImpl: async () => gatewayResponse(incomplete) });
  assert.equal(cloudCalls, 1);
  assert.equal(result.canApply, true);
  assert.equal(result.provider, "workers-ai");
  assert.equal(result.fallbackFrom, "local-ollama");
  assert.equal(result.fallbackReason, "local_warnings");
});

test("offline, incompatible and misconfigured local gateways all use the cloud fallback", async () => {
  for (const [env, fetchImpl, reason] of [
    [localEnv({ AI: cloudAI() }), async () => { throw new TypeError("connect failed"); }, "local_unavailable"],
    [localEnv({ AI: cloudAI() }), async () => new Response("{}", { status: 200 }), "local_protocol"],
    [{ ...localEnv({ AI: cloudAI() }), ISSUANCE_LOCAL_AI_TOKEN: "short" }, async () => gatewayResponse(extracted()), "local_config"],
  ]) {
    const result = await recognizeIssuanceWithProviders(request, env, { fetchImpl });
    assert.equal(result.provider, "workers-ai");
    assert.equal(result.fallbackReason, reason);
  }
});

test("local-only development works, while no available provider fails closed", async () => {
  const local = await recognizeIssuanceWithProviders(request, localEnv(), { fetchImpl: async () => gatewayResponse(extracted()) });
  assert.equal(local.provider, "local-ollama");
  await assert.rejects(() => recognizeIssuanceWithProviders(request, {}), (error) => error.code === "NO_CLOUD_FALLBACK");
});

test("local configuration requires HTTPS off-machine and paired Access credentials", () => {
  assert.throws(() => localProviderConfig(localEnv({ ISSUANCE_LOCAL_AI_URL: "http://example.com/infer" })), /HTTPS/);
  assert.throws(() => localProviderConfig(localEnv({ ISSUANCE_LOCAL_AI_ACCESS_CLIENT_SECRET: "" })), /together/);
  assert.equal(localProviderConfig({}), null);
});

test("the loopback gateway requires a token and returns only the fixed model protocol", async (t) => {
  const server = createLocalIssuanceGateway({
    token,
    timeoutMs: 5000,
    logger: { log() {}, warn() {} },
    extract: async (input) => ({ output: extracted(), model: LOCAL_ISSUANCE_MODEL, promptRevision: LOCAL_ISSUANCE_PROMPT_REVISION, attempts: 1, calls: [] }),
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/v1/issuance-recognition`;
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.model, LOCAL_ISSUANCE_MODEL);
  assert.equal(payload.promptRevision, LOCAL_ISSUANCE_PROMPT_REVISION);
  assert.deepEqual(payload.output, extracted());
});

function localEnv(extra = {}) {
  return {
    ISSUANCE_LOCAL_AI_ENABLED: "true",
    ISSUANCE_LOCAL_AI_URL: "http://127.0.0.1:11435/v1/issuance-recognition",
    ISSUANCE_LOCAL_AI_TOKEN: token,
    ISSUANCE_LOCAL_AI_ACCESS_CLIENT_ID: "access-id",
    ISSUANCE_LOCAL_AI_ACCESS_CLIENT_SECRET: "access-secret",
    ...extra,
  };
}

function cloudAI() {
  return { async run() { return modelResponse(); } };
}

function gatewayResponse(output) {
  return Response.json({ output, model: LOCAL_ISSUANCE_MODEL, promptRevision: LOCAL_ISSUANCE_PROMPT_REVISION, attempts: 1, calls: [] });
}

function modelResponse(value = extracted()) {
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] };
}

function extracted() {
  const fields = Object.fromEntries(Object.keys(ISSUANCE_FIELDS).map((key) => [key, { raw: null, evidence: "" }]));
  const values = {
    securityCode: ["102600001", "代码102600001"],
    durationText: ["3年", "3年"],
    issueScale: ["5亿元", "实际发行5亿元"],
    couponRate: ["1.59%", "票面1.59%"],
    fullMarketMultiple: ["3.86倍", "全场3.86倍"],
    marginalMultiple: ["2.86倍", "边际2.86倍"],
    paymentDate: ["2026年9月3日", "2026年9月3日缴款"],
  };
  for (const [key, [raw, evidence]] of Object.entries(values)) fields[key] = { raw, evidence };
  return { sharedEvidence: [], items: [{ shortName: request.tranches[0].shortName, sourceText: text, outcome: "issued", outcomeEvidence: "", fields }] };
}
