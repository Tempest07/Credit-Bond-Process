import { issuanceModelInput, issuanceRepairInput, readIssuanceModelOutput } from "../functions/api/_issuance-model.js";
import { validateRecognitionRequest, validateSemanticResult } from "../issuance-recognition.js";

export const LOCAL_ISSUANCE_MODEL = "gpt-oss:20b";
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_NUM_CTX = 16384;
export const DEFAULT_OLLAMA_REASONING_EFFORT = "medium";
export const LOCAL_ISSUANCE_PROMPT_REVISION = "local-20b-20260904-1";
const LOCAL_ISSUANCE_REMINDER = `本地20b复核补充；不得放宽或替代原有规则：
1. 返回前重新逐句扫描 notice 的开头、共享句和末尾。像“A、B都是……，均按……”及“缴款安排均为……”这样的共同原句，必须完整逐字加入 sharedEvidence；引用共同字段时，evidence 必须来自该 sharedEvidence。
2. 像“B于……缴款”这样的末尾专属句必须并入 B 对应品种的 sourceText，并提取其日期，不能因它位于下一行或末尾而遗漏。
3. outcome 为 cancelled 或 reallocated 时，除已披露的 securityCode 外，所有 fields 一律 raw=null、evidence=""；原计划规模、原期限、询价区间及其他品种字段都不能带入。
4. 每个字段的 evidence 必须逐字存在于该品种 sourceText 或 sharedEvidence；不能只在 fields 中引用而漏登记对应原句。`;

export function localOllamaConfig(env = process.env) {
  const url = new URL(env.OLLAMA_URL || DEFAULT_OLLAMA_URL);
  if (!isLoopback(url.hostname)) throw new Error("OLLAMA_URL must remain on localhost for isolated evaluation.");
  if (url.protocol !== "http:") throw new Error("The local Ollama evaluation endpoint must use loopback HTTP.");
  url.pathname = url.pathname.replace(/\/$/, "");

  const model = env.OLLAMA_MODEL || LOCAL_ISSUANCE_MODEL;
  if (model !== LOCAL_ISSUANCE_MODEL) throw new Error(`OLLAMA_MODEL must be ${LOCAL_ISSUANCE_MODEL}; cloud or alternate models are not allowed in this evaluation.`);

  const numCtx = Number(env.OLLAMA_NUM_CTX || DEFAULT_OLLAMA_NUM_CTX);
  if (!Number.isInteger(numCtx) || numCtx < 4096 || numCtx > 65536) throw new Error("OLLAMA_NUM_CTX must be an integer between 4096 and 65536.");
  const reasoningEffort = env.OLLAMA_REASONING_EFFORT || DEFAULT_OLLAMA_REASONING_EFFORT;
  if (!["low", "medium", "high"].includes(reasoningEffort)) throw new Error("OLLAMA_REASONING_EFFORT must be low, medium or high.");
  return { url, model, numCtx, reasoningEffort };
}

export function toOllamaChatRequest(input, config = localOllamaConfig()) {
  return {
    model: config.model,
    messages: input.messages.map((message, index) => index === 0 && message.role === "system"
      ? { ...message, content: `${message.content}\n\n${LOCAL_ISSUANCE_REMINDER}` }
      : { ...message }),
    stream: false,
    format: input.response_format.json_schema.schema,
    think: config.reasoningEffort,
    keep_alive: "10m",
    options: {
      temperature: input.temperature,
      num_ctx: config.numCtx,
      num_predict: input.max_tokens,
      seed: 0,
    },
  };
}

export async function recognizeIssuanceWithLocalOllama(rawRequest, options = {}) {
  const request = validateRecognitionRequest(rawRequest);
  const extracted = await extractIssuanceWithLocalOllama(request, options);
  const result = validateSemanticResult(request, extracted.output);
  return { ...result, model: extracted.model, provider: "local-ollama", promptRevision: extracted.promptRevision, attempts: extracted.attempts, calls: extracted.calls };
}

export async function extractIssuanceWithLocalOllama(rawRequest, options = {}) {
  const request = validateRecognitionRequest(rawRequest);
  const config = options.config || localOllamaConfig(options.env);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 180000;
  const input = issuanceModelInput(request);
  const first = await invokeOllama(input, { config, fetchImpl, timeoutMs, signal: options.signal });
  let result = validateSemanticResult(request, first.output);
  const calls = [first.metrics];
  let output = first.output;

  if (!result.canApply && result.needsModelRepair) {
    const repaired = await invokeOllama(issuanceRepairInput(input, first.output, result.errors), { config, fetchImpl, timeoutMs, signal: options.signal });
    calls.push(repaired.metrics);
    output = repaired.output;
  }

  return { output, model: config.model, promptRevision: LOCAL_ISSUANCE_PROMPT_REVISION, attempts: calls.length, calls };
}

async function invokeOllama(input, { config, fetchImpl, timeoutMs, signal }) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(new URL("/api/chat", config.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toOllamaChatRequest(input, config)),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  if (!response.ok) throw new Error(`Local Ollama request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const normalized = {
    choices: [{
      finish_reason: payload.done_reason || "stop",
      message: { content: payload.message?.content },
    }],
  };
  return {
    output: readIssuanceModelOutput(normalized),
    metrics: {
      totalMs: nanosToMs(payload.total_duration),
      loadMs: nanosToMs(payload.load_duration),
      promptTokens: payload.prompt_eval_count ?? null,
      outputTokens: payload.eval_count ?? null,
    },
  };
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function nanosToMs(value) {
  return Number.isFinite(value) ? Math.round(value / 1_000_000) : null;
}
