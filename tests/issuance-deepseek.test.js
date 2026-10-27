import assert from "node:assert/strict";
import test from "node:test";
import { ISSUANCE_FIELDS } from "../issuance-recognition.js";
import { deepseekProviderConfig, recognizeIssuanceWithDeepseek, DEEPSEEK_ISSUANCE_ENDPOINT } from "../functions/api/_issuance-deepseek.js";

const apiKey = "sk-test-only-deepseek-key-0123456789";
const env = { DEEPSEEK_API_KEY: apiKey };
const text = "26测试MTN001A，代码102600001，3年，实际发行5亿元，票面1.63%，全场3.86倍，边际2.86倍，2026年10月28日缴款。";
const request = { text, noticeDate: "2026-10-27", tranches: [{ id: "a", shortName: "26测试MTN001A", securityCode: "102600001", durationText: "3Y" }] };

test("DeepSeek configuration fails closed without a safe key, supported model and bounded deadline", () => {
  for (const values of [{}, { DEEPSEEK_API_KEY: "short" }, { DEEPSEEK_API_KEY: apiKey + "\n" },
    { ...env, DEEPSEEK_MODEL: "other-model" }, { ...env, ISSUANCE_DEEPSEEK_TIMEOUT_MS: 4999 },
    { ...env, ISSUANCE_DEEPSEEK_TIMEOUT_MS: 90001 }, { ...env, ISSUANCE_DEEPSEEK_TIMEOUT_MS: "NaN" }]) {
    assert.throws(() => deepseekProviderConfig(values), error => error.code === "DEEPSEEK_CONFIG" && error.status === 503 && Boolean(error.publicMessage));
  }
  const config = deepseekProviderConfig(env);
  assert.equal(config.model, "deepseek-flash"); assert.equal(config.timeoutMs, 45000);
  assert.equal(config.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(deepseekProviderConfig({ ...env, DEEPSEEK_MODEL: "deepseek-v4-pro" }).model, "deepseek-v4-pro");
});

test("a clean result uses only the official endpoint, disables thinking and sends minimal business inputs", async () => {
  let calls = 0;
  const input = { ...request, project: { valuation: 9.87654321 }, tranches: [{ ...request.tranches[0], bidRate: 8.7654321, winningAmountWan: 999999 }] };
  const result = await recognizeIssuanceWithDeepseek(input, { ...env, DEEPSEEK_BASE_URL: "https://attacker.invalid/", AI: { run() { throw Error("not allowed"); } } }, {
    fetchImpl: async (url, init) => {
      calls++; assert.equal(url, DEEPSEEK_ISSUANCE_ENDPOINT); assert.equal(init.method, "POST"); assert.equal(init.redirect, "manual");
      assert.equal(init.headers.Authorization, "Bearer " + apiKey);
      const body = JSON.parse(init.body);
      assert.equal(body.model, "deepseek-flash"); assert.equal(body.stream, false); assert.equal(body.temperature, 0);
      assert.deepEqual(body.thinking, { type: "disabled" }); assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body.reasoning_effort, undefined); assert.equal(body.response_format.json_schema, undefined);
      assert.deepEqual(JSON.parse(body.messages[1].content), { notice: text, candidates: ["26测试MTN001A"] });
      assert.match(body.messages[0].content, /JSON Schema/); assert.match(body.messages[0].content, /票面利率1.63/);
      assert.equal(init.body.includes("9.87654321"), false); assert.equal(init.body.includes("8.7654321"), false); assert.equal(init.body.includes(apiKey), false);
      return completion(extracted());
    },
  });
  assert.equal(calls, 1); assert.equal(result.provider, "deepseek"); assert.equal(result.model, "deepseek-flash");
  assert.equal(result.canApply, true); assert.equal(result.items[0].couponRate, 1.63); assert.equal(result.attempts, 1);
  assert.equal(result.items[0].paymentDate, "2026-10-28");
});

test("coupon wording including a bare number is accepted only with the original evidence", async () => {
  for (const phrase of ["票面1.63%", "票面利率1.63", "最终边际1.63%"] ) {
    const current = { ...request, text: text.replace("票面1.63%", phrase) };
    const output = extracted(current.text);
    output.items[0].fields.couponRate = { raw: phrase.endsWith("%") ? "1.63%" : "1.63", evidence: phrase };
    const result = await recognizeIssuanceWithDeepseek(current, env, { fetchImpl: async () => completion(output) });
    assert.equal(result.canApply, true); assert.equal(result.items[0].couponRate, 1.63); assert.equal(result.attempts, 1);
  }
});

test("an omitted coupon gets one original-notice correction even when the legacy repair flag is false", async () => {
  let calls = 0;
  const missing = extracted(); missing.items[0].fields.couponRate = { raw: null, evidence: "" };
  const result = await recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (calls === 1) return completion(missing);
    assert.equal(body.messages.length, 4); assert.equal(body.messages[2].role, "assistant");
    assert.match(body.messages[3].content, /尚无明确最终票息/); assert.match(body.messages[3].content, /不得虚构缺失信息/);
    return completion(extracted());
  } });
  assert.equal(calls, 2); assert.equal(result.canApply, true); assert.equal(result.items[0].couponRate, 1.63); assert.equal(result.attempts, 2);
});

test("undisclosed final interest remains blocked after the single correction", async () => {
  let calls = 0;
  const current = { ...request, text: text.replace("票面1.63%", "最终利率尚未公布") };
  const output = extracted(current.text); output.items[0].outcome = "unknown"; output.items[0].fields.couponRate = { raw: null, evidence: "" };
  const result = await recognizeIssuanceWithDeepseek(current, env, { fetchImpl: async () => { calls++; return completion(output); } });
  assert.equal(calls, 2); assert.equal(result.canApply, false); assert.equal(result.items[0].couponRate, null);
  assert.ok(result.errors.some(error => error.includes("尚无明确最终票息")));
});

test("invalid or cross-notice evidence cannot be adopted after repeated model claims", async () => {
  let calls = 0;
  const output = extracted(); output.items[0].fields.couponRate = { raw: "9.99%", evidence: "票面9.99%" };
  const result = await recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => { calls++; return completion(output); } });
  assert.equal(calls, 2); assert.equal(result.canApply, false); assert.equal(result.items[0].couponRate, null);
  assert.ok(result.errors.some(error => error.includes("摘录与原文不符")));
});

test("missing optional notice fields remain warnings without unnecessary repeated inference", async () => {
  let calls = 0;
  const current = { ...request, text: text.replace("实际发行5亿元，", "") };
  const output = extracted(current.text); output.items[0].fields.issueScale = { raw: null, evidence: "" };
  const result = await recognizeIssuanceWithDeepseek(current, env, { fetchImpl: async () => { calls++; return completion(output); } });
  assert.equal(calls, 1); assert.equal(result.canApply, true); assert.equal(result.items[0].issueScale, null); assert.equal(result.warnings.length, 1);
});

test("malformed, empty, incomplete-schema and truncated JSON may recover only once", async () => {
  for (const first of [() => new Response("invalid outer JSON"), () => completion(null, { content: "" }),
    () => completion({ items: [], sharedEvidence: [], unexpected: true }), () => completion(extracted(), { finishReason: "length" }),
    () => completion(null, { content: "```json\n{}\n```" })]) {
    let calls = 0;
    const result = await recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => ++calls === 1 ? first() : completion(extracted()) });
    assert.equal(calls, 2); assert.equal(result.canApply, true); assert.equal(result.attempts, 2);
  }
  let calls = 0;
  await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => { calls++; return completion({ items: [] }); } }),
    error => error.code === "DEEPSEEK_PROTOCOL" && error.status === 502);
  assert.equal(calls, 2);
});

test("authentication, balance, rate limit, server and redirect failures are safe and never immediately retried", async () => {
  for (const [upstreamStatus, code, status] of [[401, "DEEPSEEK_AUTH", 503], [402, "DEEPSEEK_BALANCE", 503],
    [429, "DEEPSEEK_RATE_LIMIT", 429], [500, "DEEPSEEK_UNAVAILABLE", 503], [503, "DEEPSEEK_UNAVAILABLE", 503],
    [302, "DEEPSEEK_REDIRECT", 502], [400, "DEEPSEEK_UPSTREAM", 502], [422, "DEEPSEEK_UPSTREAM", 502]]) {
    let calls = 0;
    await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => {
      calls++; return new Response(apiKey + " " + text, { status: upstreamStatus, headers: { "Retry-After": "15", Location: "https://attacker.invalid/" } });
    } }), error => {
      assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.upstreamStatus, upstreamStatus);
      assert.equal(error.publicMessage.includes(apiKey), false); assert.equal(error.publicMessage.includes(text), false);
      if (upstreamStatus === 429) assert.equal(error.retryAfter, 15);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("all redirect responses fail without following, retrying or disclosing the destination", async () => {
  for (const status of [300, 301, 302, 303, 304, 307, 308, 200]) {
    let calls = 0;
    const destination = 'https://attacker.invalid/?key=' + apiKey;
    const response = new Response(null, { status, headers: { Location: destination } });
    if (status === 200) Object.defineProperty(response, 'redirected', { value: true });
    await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async (url, init) => {
      calls++; assert.equal(url, DEEPSEEK_ISSUANCE_ENDPOINT); assert.equal(init.redirect, 'manual'); return response;
    } }), error => {
      assert.equal(error.code, 'DEEPSEEK_REDIRECT'); assert.equal(error.status, 502); assert.equal(error.upstreamStatus, status);
      assert.equal(error.publicMessage.includes(destination), false); assert.equal(error.publicMessage.includes(apiKey), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("Retry-After metadata is bounded and ignores invalid or past values", async () => {
  for (const [header, expected] of [["999999", 3600], ["-20", undefined], ["malformed", undefined], ["Thu, 01 Jan 1970 00:00:00 GMT", undefined]]) {
    await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": header } }) }),
      error => { assert.equal(error.retryAfter, expected); return true; });
  }
});

test("unbounded declared or streamed response bodies are cancelled and not retried", async () => {
  for (const declared of [true, false]) {
    let cancelled = false, calls = 0;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256001)); }, cancel() { cancelled = true; } });
    await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => {
      calls++; return new Response(body, { headers: declared ? { "Content-Length": "256001" } : {} });
    } }), error => error.code === "DEEPSEEK_RESPONSE_TOO_LARGE" && error.status === 502);
    assert.equal(calls, 1); assert.equal(cancelled, true);
  }
});

test("network errors never expose upstream details or configured credentials", async () => {
  let calls = 0;
  await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => {
    calls++; throw new TypeError("network " + apiKey + " " + text);
  } }), error => { assert.equal(error.code, "DEEPSEEK_UNAVAILABLE"); assert.equal(error.publicMessage.includes(apiKey), false); assert.equal(error.publicMessage.includes(text), false); return true; });
  assert.equal(calls, 1);
});

test("parent cancellation aborts inference and does not make a repair call", async () => {
  const controller = new AbortController(); let calls = 0, childSignal;
  const promise = recognizeIssuanceWithDeepseek(request, env, { signal: controller.signal, fetchImpl: async (_url, init) => {
    calls++; childSignal = init.signal; return new Promise(() => {});
  } });
  controller.abort("private parent abort detail");
  await assert.rejects(promise, error => error.code === "DEEPSEEK_ABORTED" && error.name === "AbortError" && !error.publicMessage.includes("private"));
  assert.equal(calls, 1); assert.equal(childSignal.aborted, true);
  const already = new AbortController(); already.abort();
  await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { signal: already.signal, fetchImpl: async () => { throw Error("must not fetch"); } }), error => error.code === "DEEPSEEK_ABORTED");
});

test("initial and correction calls share a single deadline instead of resetting their budgets", async () => {
  let calls = 0; const signals = [];
  await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { timeoutMs: 100, fetchImpl: async (_url, init) => {
    signals.push(init.signal); calls++;
    await delay(65, init.signal);
    return calls === 1 ? completion({}) : completion(extracted());
  } }), error => error.code === "DEEPSEEK_TIMEOUT" && error.status === 504);
  assert.equal(calls, 2); assert.equal(signals[0], signals[1]); assert.equal(signals[1].aborted, true);
});

test("a stalled response stream is cancelled at the shared deadline", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; } });
  await assert.rejects(recognizeIssuanceWithDeepseek(request, env, { timeoutMs: 20, fetchImpl: async () => new Response(body) }),
    error => error.code === "DEEPSEEK_TIMEOUT");
  assert.equal(cancelled, true);
});

test("model-generated validation diagnostics cannot echo the configured secret", async () => {
  const output = extracted(); output.items[0].sourceText = request.tranches[0].shortName + apiKey;
  const result = await recognizeIssuanceWithDeepseek(request, env, { fetchImpl: async () => completion(output) });
  assert.equal(result.canApply, false); assert.equal(result.attempts, 2); assert.equal(JSON.stringify(result).includes(apiKey), false);
});

function completion(output, { content = JSON.stringify(output), finishReason = "stop" } = {}) {
  return Response.json({ choices: [{ finish_reason: finishReason, message: { content, reasoning_content: "must not be returned" } }] });
}

function extracted(sourceText = text) {
  const fields = Object.fromEntries(Object.keys(ISSUANCE_FIELDS).map(name => [name, { raw: null, evidence: "" }]));
  const values = { securityCode: ["102600001", "代码102600001"], durationText: ["3年", "3年"], issueScale: ["5亿元", "实际发行5亿元"],
    couponRate: ["1.63%", "票面1.63%"], fullMarketMultiple: ["3.86倍", "全场3.86倍"], marginalMultiple: ["2.86倍", "边际2.86倍"],
    paymentDate: ["2026年10月28日", "2026年10月28日缴款"] };
  for (const [name, [raw, evidence]] of Object.entries(values)) fields[name] = { raw, evidence };
  return { items: [{ shortName: request.tranches[0].shortName, sourceText, outcome: "issued", outcomeEvidence: "", fields }], sharedEvidence: [] };
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
