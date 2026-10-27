import { ISSUANCE_SCHEMA, issuanceModelInput, issuanceRepairInput } from "./_issuance-model.js";
import { ISSUANCE_FIELDS, validateRecognitionRequest, validateSemanticResult } from "../../issuance-recognition.js";

export const DEEPSEEK_ISSUANCE_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEFAULT_DEEPSEEK_ISSUANCE_MODEL = "deepseek-flash";
export const DEFAULT_DEEPSEEK_ISSUANCE_TIMEOUT_MS = 45000;
const MAX_RESPONSE_BYTES = 256000;
const models = new Set(["deepseek-flash", "deepseek-v4-pro"]);

export function deepseekProviderConfig(env = {}) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{16,512}$/.test(apiKey)) {
    throw failure("DEEPSEEK_CONFIG", 503, "DeepSeek 密钥尚未配置或格式无效，请检查服务端配置；本次未改动项目。");
  }
  const model = env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_ISSUANCE_MODEL;
  if (!models.has(model)) throw failure("DEEPSEEK_CONFIG", 503, "DeepSeek 识别模型配置无效，请检查服务端配置；本次未改动项目。");
  const timeoutMs = Number(env.ISSUANCE_DEEPSEEK_TIMEOUT_MS || DEFAULT_DEEPSEEK_ISSUANCE_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 90000) {
    throw failure("DEEPSEEK_CONFIG", 503, "DeepSeek 识别超时配置无效，请检查服务端配置；本次未改动项目。");
  }
  return { apiKey, model, timeoutMs, endpoint: DEEPSEEK_ISSUANCE_ENDPOINT };
}

export async function recognizeIssuanceWithDeepseek(rawRequest, env, options = {}) {
  const config = deepseekProviderConfig(env);
  const request = validateRecognitionRequest(rawRequest);
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 90000) {
    throw failure("DEEPSEEK_CONFIG", 503, "DeepSeek 识别超时配置无效，请检查服务端配置；本次未改动项目。");
  }
  const input = deepseekInput(request);
  return withDeadline(async (signal) => {
    let current = input;
    for (let attempts = 1; attempts <= 2; attempts++) {
      ensureActive(signal);
      let output;
      try {
        output = await invokeDeepseek(current, config, options.fetchImpl || fetch, signal);
      } catch (error) {
        ensureActive(signal);
        if (attempts === 1 && error.repairable === true) {
          current = issuanceRepairInput(input, { items: [], sharedEvidence: [] }, ["上一轮未返回完整有效的 JSON，请重新从 notice 摘录并返回符合 schema 的完整 JSON，不得补造信息。"]);
          continue;
        }
        throw error;
      }
      ensureActive(signal);
      let result;
      try { result = validateSemanticResult(request, output); }
      catch { throw failure("DEEPSEEK_VALIDATION_INTERNAL", 502, "识别结果校验暂时不可用，请稍后重试；本次未改动项目。"); }
      if (result.canApply || attempts === 2) {
        // Validation diagnostics can quote untrusted model text; never echo a key.
        return { ...result, errors: redact(result.errors, config.apiKey), warnings: redact(result.warnings, config.apiKey),
          provider: "deepseek", model: config.model, attempts };
      }
      // Missing coupon fields are also eligible for this one bounded correction.
      // A truly undisclosed final rate still fails the unchanged validator.
      current = issuanceRepairInput(input, output, result.errors);
    }
  }, timeoutMs, options.signal);
}

function deepseekInput(request) {
  const original = issuanceModelInput(request);
  const schema = structuredClone(ISSUANCE_SCHEMA);
  schema.properties.items.items.properties.shortName.enum = ["", ...new Set(request.tranches.map(item => item.shortName))];
  const supplement = `
JSON 输出要求：只输出一个 JSON 对象，不使用 Markdown。必须满足下列 JSON Schema，items 和 sharedEvidence 始终为数组：
${JSON.stringify(schema)}
JSON 结构示例：{"items":[],"sharedEvidence":[]}。实际通知中有对应品种时按 schema 完整填写，所有 fields 均应存在；未披露的字段用 {"raw":null,"evidence":""}。
在发行结果通知中，“票面1.63%”“票面利率1.63”“最终票面1.63%”“发行利率1.63%”都可表达 couponRate，并不要求一定出现“最终边际”字样。数字含义必须由本品种原文支持；原文没有百分号时 raw 逐字保留“1.63”，不得擅加百分号。“边际1.2倍”是 marginalMultiple，不能作为票息。未披露最终票息、只有询价区间或发行取消时，仍须按原规则保留空值，不得推测。`;
  return {
    stream: false, temperature: 0, max_tokens: original.max_tokens,
    response_format: { type: "json_object" }, thinking: { type: "disabled" },
    messages: original.messages.map((message, index) => index === 0 ? { ...message, content: message.content + supplement } : message),
  };
}

async function invokeDeepseek(input, config, fetchImpl, signal) {
  let response;
  try {
    response = await fetchImpl(DEEPSEEK_ISSUANCE_ENDPOINT, {
      method: "POST", redirect: "manual", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ ...input, model: config.model }),
    });
  } catch {
    ensureActive(signal);
    throw failure("DEEPSEEK_UNAVAILABLE", 503, "DeepSeek 暂时无法连接，请稍后重试；本次未改动项目。");
  }
  ensureActive(signal);
  // Workers supports manual/follow, not the browser-only error mode. Reject
  // redirects explicitly so Authorization is never forwarded to another host.
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    void response.body?.cancel().catch(() => {});
    throw failure("DEEPSEEK_REDIRECT", 502, "DeepSeek 返回异常跳转，请检查服务端连接；本次未改动项目。", { upstreamStatus: response.status });
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw httpFailure(response);
  }
  const payload = await readBoundedJson(response, signal);
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw failure("DEEPSEEK_TRUNCATED", 502, "DeepSeek 返回内容被截断，请缩短通知后重试；本次未改动项目。", { repairable: true });
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw protocolFailure();
  let output;
  try { output = JSON.parse(content); } catch { throw protocolFailure(); }
  if (!validOutputShape(output)) throw protocolFailure();
  return output;
}

function validOutputShape(output) {
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const fieldNames = Object.keys(ISSUANCE_FIELDS);
  return exact(output, ["items", "sharedEvidence"]) && Array.isArray(output.sharedEvidence)
    && output.sharedEvidence.length <= 100 && output.sharedEvidence.every(value => typeof value === "string")
    && Array.isArray(output.items) && output.items.length <= 10 && output.items.every(item =>
      exact(item, ["shortName", "sourceText", "outcome", "outcomeEvidence", "fields"])
      && [item.shortName, item.sourceText, item.outcome, item.outcomeEvidence].every(value => typeof value === "string")
      && ["issued", "cancelled", "reallocated", "unknown"].includes(item.outcome)
      && exact(item.fields, fieldNames) && fieldNames.every(name => {
        const field = item.fields[name];
        return exact(field, ["raw", "evidence"]) && (field.raw === null || typeof field.raw === "string") && typeof field.evidence === "string";
      }));
}

async function readBoundedJson(response, signal) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw failure("DEEPSEEK_RESPONSE_TOO_LARGE", 502, "DeepSeek 返回内容超过识别上限，请缩短通知后重试；本次未改动项目。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw protocolFailure();
  const chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      ensureActive(signal);
      const { done, value } = await reader.read();
      ensureActive(signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        cancel();
        throw failure("DEEPSEEK_RESPONSE_TOO_LARGE", 502, "DeepSeek 返回内容超过识别上限，请缩短通知后重试；本次未改动项目。");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw protocolFailure(); }
  } catch (error) {
    ensureActive(signal);
    if (error?.code?.startsWith("DEEPSEEK_")) throw error;
    throw protocolFailure();
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

function httpFailure(response) {
  const upstreamStatus = response.status;
  if (upstreamStatus === 401) return failure("DEEPSEEK_AUTH", 503, "DeepSeek 密钥无效或已失效，请检查服务端配置；本次未改动项目。", { upstreamStatus });
  if (upstreamStatus === 402) return failure("DEEPSEEK_BALANCE", 503, "DeepSeek 账户余额不足，请检查账户余额；本次未改动项目。", { upstreamStatus });
  if (upstreamStatus === 429) {
    const value = response.headers.get("Retry-After");
    const seconds = /^\d+$/.test(value || "") ? Number(value) : Math.ceil((Date.parse(value || "") - Date.now()) / 1000);
    const retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : undefined;
    return failure("DEEPSEEK_RATE_LIMIT", 429, "DeepSeek 请求过于频繁，请稍后重试；本次未改动项目。", { upstreamStatus, ...(retryAfter ? { retryAfter } : {}) });
  }
  if (upstreamStatus >= 500) return failure("DEEPSEEK_UNAVAILABLE", 503, "DeepSeek 服务暂时不可用，请稍后重试；本次未改动项目。", { upstreamStatus });
  return failure("DEEPSEEK_UPSTREAM", 502, "DeepSeek 请求未成功，请检查服务端配置或稍后重试；本次未改动项目。", { upstreamStatus });
}

async function withDeadline(task, timeoutMs, parentSignal) {
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const stop = error => { if (!controller.signal.aborted) controller.abort(error); rejectDeadline(error); };
  const onAbort = () => stop(failure("DEEPSEEK_ABORTED", 499, "识别请求已取消；本次未改动项目。", { name: "AbortError" }));
  if (parentSignal?.aborted) { onAbort(); return deadline; }
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop(failure("DEEPSEEK_TIMEOUT", 504, "DeepSeek 识别超时，请稍后重试；本次未改动项目。", { name: "TimeoutError" })), timeoutMs);
  try { return await Promise.race([task(controller.signal), deadline]); }
  finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", onAbort); }
}

function ensureActive(signal) { if (signal.aborted) throw signal.reason; }
function redact(values, key) { return values.map(value => String(value).split(key).join("[已隐藏]")); }
function protocolFailure() { return failure("DEEPSEEK_PROTOCOL", 502, "DeepSeek 返回格式异常，请重新识别；本次未改动项目。", { repairable: true }); }
function failure(code, status, publicMessage, extra = {}) { return Object.assign(new Error(publicMessage), { code, status, publicMessage, ...extra }); }
