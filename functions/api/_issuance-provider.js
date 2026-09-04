import { ISSUANCE_MODEL, issuanceModelInput, issuanceRepairInput, readIssuanceModelOutput } from "./_issuance-model.js";
import { validateSemanticResult } from "../../issuance-recognition.js";

export const LOCAL_ISSUANCE_MODEL = "gpt-oss:20b";
export const LOCAL_ISSUANCE_PROMPT_REVISION = "local-20b-20260904-1";
export const DEFAULT_LOCAL_ISSUANCE_TIMEOUT_MS = 45000;
export const DEFAULT_CLOUD_ISSUANCE_TIMEOUT_MS = 90000;

export async function recognizeIssuanceWithProviders(request, env, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const parentSignal = options.signal;
  let fallbackReason = null;

  try {
    const local = localProviderConfig(env);
    if (local) {
      try {
        const payload = await withTimeout(
          (signal) => invokeLocalGateway(request, local, fetchImpl, signal),
          local.timeoutMs,
          parentSignal,
          "LOCAL_TIMEOUT",
          "本地识别超时。",
        );
        const result = validateSemanticResult(request, payload.output);
        if (result.canApply && result.warnings.length === 0) {
          return {
            ...result,
            provider: "local-ollama",
            model: LOCAL_ISSUANCE_MODEL,
            promptRevision: LOCAL_ISSUANCE_PROMPT_REVISION,
            attempts: payload.attempts,
          };
        }
        fallbackReason = result.canApply ? "local_warnings" : "local_validation";
      } catch (error) {
        if (parentSignal?.aborted) throw error;
        fallbackReason = classifyLocalFailure(error);
      }
    }
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    fallbackReason = "local_config";
  }

  if (!env?.AI) {
    const error = new Error(fallbackReason
      ? "本地语义识别未通过，且 Cloudflare AI 兜底尚未配置；本次未改动项目。"
      : "语义识别服务尚未配置 AI 绑定，请联系管理员；本次未改动项目。");
    error.code = "NO_CLOUD_FALLBACK";
    throw error;
  }

  const cloud = await withTimeout(
    (signal) => invokeCloudflare(request, env.AI, signal),
    options.cloudTimeoutMs || DEFAULT_CLOUD_ISSUANCE_TIMEOUT_MS,
    parentSignal,
    "CLOUD_TIMEOUT",
    "识别超时，请稍后重试；本次未改动项目。",
  );
  return {
    ...cloud.result,
    provider: "workers-ai",
    model: ISSUANCE_MODEL,
    attempts: cloud.attempts,
    ...(fallbackReason ? { fallbackFrom: "local-ollama", fallbackReason } : {}),
  };
}

export function localProviderConfig(env = {}) {
  if (env.ISSUANCE_LOCAL_AI_ENABLED !== "true") return null;
  if (!env.ISSUANCE_LOCAL_AI_URL) throw new Error("ISSUANCE_LOCAL_AI_URL is required when local AI is enabled.");
  const url = new URL(env.ISSUANCE_LOCAL_AI_URL);
  if (url.username || url.password || url.hash) throw new Error("Local AI URL must not contain credentials or a fragment.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("Local AI gateway must use HTTPS except on loopback during local development.");
  }
  const token = env.ISSUANCE_LOCAL_AI_TOKEN;
  if (typeof token !== "string" || !/^[\x21-\x7e]{32,512}$/.test(token)) {
    throw new Error("ISSUANCE_LOCAL_AI_TOKEN must be a 32-512 character header-safe secret.");
  }
  const accessClientId = env.ISSUANCE_LOCAL_AI_ACCESS_CLIENT_ID || "";
  const accessClientSecret = env.ISSUANCE_LOCAL_AI_ACCESS_CLIENT_SECRET || "";
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) throw new Error("Both Cloudflare Access service-token values are required together.");
  const timeoutMs = readTimeout(env.ISSUANCE_LOCAL_AI_TIMEOUT_MS);
  return { url, token, accessClientId, accessClientSecret, timeoutMs };
}

async function invokeLocalGateway(request, config, fetchImpl, signal) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.token}`,
  };
  if (config.accessClientId) {
    headers["CF-Access-Client-Id"] = config.accessClientId;
    headers["CF-Access-Client-Secret"] = config.accessClientSecret;
  }
  const response = await fetchImpl(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ request }),
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Local AI gateway returned HTTP ${response.status}.`);
    error.code = "LOCAL_HTTP";
    throw error;
  }
  const payload = await readBoundedResponseJson(response, 256000);
  if (payload?.model !== LOCAL_ISSUANCE_MODEL || payload?.promptRevision !== LOCAL_ISSUANCE_PROMPT_REVISION
    || !Number.isInteger(payload?.attempts) || payload.attempts < 1 || payload.attempts > 2
    || !payload.output || typeof payload.output !== "object") {
    const error = new Error("Local AI gateway returned an incompatible response.");
    error.code = "LOCAL_PROTOCOL";
    throw error;
  }
  return payload;
}

async function invokeCloudflare(request, ai, signal) {
  const input = issuanceModelInput(request);
  const invoke = async (body) => readIssuanceModelOutput(await ai.run(ISSUANCE_MODEL, body, { signal }));
  const first = await invoke(input);
  let result = validateSemanticResult(request, first);
  let attempts = 1;
  if (!result.canApply && result.needsModelRepair && !signal.aborted) {
    attempts = 2;
    result = validateSemanticResult(request, await invoke(issuanceRepairInput(input, first, result.errors)));
  }
  return { result, attempts };
}

async function withTimeout(task, timeoutMs, parentSignal, code, message) {
  const controller = new AbortController();
  let timer;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const fail = (error) => {
    if (!controller.signal.aborted) controller.abort(error);
    rejectDeadline(error);
  };
  const onAbort = () => {
    const error = new Error("请求已取消。");
    error.name = "AbortError";
    error.code = "REQUEST_ABORTED";
    fail(error);
  };
  if (parentSignal?.aborted) onAbort();
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => {
    const error = new Error(message);
    error.name = "TimeoutError";
    error.code = code;
    fail(error);
  }, timeoutMs);
  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

async function readBoundedResponseJson(response, limit) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) throw protocolError();
  const reader = response.body?.getReader();
  if (!reader) throw protocolError();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw protocolError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw protocolError(); }
}

function protocolError() {
  const error = new Error("Local AI gateway returned invalid JSON.");
  error.code = "LOCAL_PROTOCOL";
  return error;
}

function classifyLocalFailure(error) {
  if (error?.code === "LOCAL_TIMEOUT" || error?.name === "TimeoutError") return "local_timeout";
  if (error?.code === "LOCAL_PROTOCOL") return "local_protocol";
  if (error?.code === "LOCAL_HTTP") return "local_http";
  return "local_unavailable";
}

function readTimeout(value) {
  if (value == null || value === "") return DEFAULT_LOCAL_ISSUANCE_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 5000 || timeout > 60000) throw new Error("ISSUANCE_LOCAL_AI_TIMEOUT_MS must be 5000-60000.");
  return timeout;
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
