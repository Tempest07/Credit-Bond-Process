import assert from "node:assert/strict";
import test from "node:test";
import { issuanceModelInput } from "../functions/api/_issuance-model.js";
import { LOCAL_ISSUANCE_MODEL, LOCAL_ISSUANCE_PROMPT_REVISION, localOllamaConfig, recognizeIssuanceWithLocalOllama, toOllamaChatRequest } from "../tools/local-issuance-ollama.mjs";

const request = {
  text: "26测试MTN001，代码102600001，3年，实际发行5亿元，票面1.59%，全场3.86倍，边际2.86倍，2026年9月3日缴款。",
  noticeDate: "2026-09-02",
  tranches: [{ id: "a", shortName: "26测试MTN001", securityCode: "", durationText: "3Y" }],
};

test("local evaluation is locked to loopback gpt-oss:20b", () => {
  assert.equal(localOllamaConfig({}).model, LOCAL_ISSUANCE_MODEL);
  assert.throws(() => localOllamaConfig({ OLLAMA_URL: "https://ollama.com" }), /localhost/);
  assert.throws(() => localOllamaConfig({ OLLAMA_MODEL: "gpt-oss:120b-cloud" }), /must be gpt-oss:20b/);
  assert.throws(() => localOllamaConfig({ OLLAMA_REASONING_EFFORT: "extreme" }), /low, medium or high/);
});

test("local request preserves the production prompt and schema", () => {
  const input = issuanceModelInput(request);
  const body = toOllamaChatRequest(input, localOllamaConfig({}));
  assert.equal(body.model, LOCAL_ISSUANCE_MODEL);
  assert.match(body.messages[0].content, /本地20b复核补充/);
  assert.ok(body.messages[0].content.startsWith(input.messages[0].content));
  assert.deepEqual(body.messages.slice(1), input.messages.slice(1));
  assert.deepEqual(body.format, input.response_format.json_schema.schema);
  assert.equal(body.think, "medium");
  assert.equal(body.options.temperature, 0);
  assert.equal(body.options.num_ctx, 16384);
  assert.equal(body.options.num_predict, 12000);
});

test("local response still passes through application validation", async () => {
  const modelResult = extracted();
  const fetchImpl = async () => new Response(JSON.stringify({
    done: true,
    done_reason: "stop",
    message: { role: "assistant", content: JSON.stringify(modelResult) },
    total_duration: 1_500_000,
    load_duration: 500_000,
    prompt_eval_count: 100,
    eval_count: 50,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const result = await recognizeIssuanceWithLocalOllama(request, { fetchImpl, env: {} });
  assert.equal(result.canApply, true, result.errors.join(";"));
  assert.equal(result.provider, "local-ollama");
  assert.equal(result.promptRevision, LOCAL_ISSUANCE_PROMPT_REVISION);
  assert.equal(result.items[0].couponRate, 1.59);
  assert.deepEqual(result.calls, [{ totalMs: 2, loadMs: 1, promptTokens: 100, outputTokens: 50 }]);
});

function extracted() {
  const empty = () => ({ raw: null, evidence: "" });
  return {
    sharedEvidence: [],
    items: [{
      shortName: "26测试MTN001",
      sourceText: request.text,
      outcome: "issued",
      outcomeEvidence: "",
      fields: {
        securityCode: { raw: "102600001", evidence: "代码102600001" },
        durationText: { raw: "3年", evidence: "3年" },
        issueScale: { raw: "5亿元", evidence: "实际发行5亿元" },
        couponRate: { raw: "1.59%", evidence: "票面1.59%" },
        fullMarketMultiple: { raw: "3.86倍", evidence: "全场3.86倍" },
        marginalMultiple: { raw: "2.86倍", evidence: "边际2.86倍" },
        paymentDate: { raw: "2026年9月3日", evidence: "2026年9月3日缴款" },
        startDate: empty(),
      },
    }],
  };
}
