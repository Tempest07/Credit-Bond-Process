import { requireUser, json } from "../_auth.js";
import { ISSUANCE_MODEL, issuanceModelInput, issuanceRepairInput, readIssuanceModelOutput } from "../_issuance-model.js";
import { validateRecognitionRequest, validateSemanticResult } from "../../../issuance-recognition.js";

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const origin = context.request.headers.get("Origin");
  if (origin && origin !== new URL(context.request.url).origin && origin !== "https://tempest07.com") return json({ error: "不允许跨站调用。" }, 403);
  if (!context.request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "请使用 JSON 请求。" }, 415);
  let request;
  try { request = validateRecognitionRequest(await readBoundedJson(context.request)); }
  catch (error) { return json({ error: error.message }, 400); }
  if (!context.env.AI) return json({ error: "语义识别服务尚未配置 AI 绑定，请联系管理员；本次未改动项目。" }, 503);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  context.request.signal.addEventListener("abort", onAbort, { once: true });
  let timer;
  const started = Date.now();
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("识别超时，请稍后重试；本次未改动项目。")); }, 90000); });
    const input = issuanceModelInput(request);
    const invoke = (body) => Promise.race([context.env.AI.run(ISSUANCE_MODEL, body, { signal: controller.signal }), timeout]);
    const extracted = readIssuanceModelOutput(await invoke(input));
    let result = validateSemanticResult(request, extracted);
    let attempts = 1;
    if (!result.canApply && result.needsModelRepair && !controller.signal.aborted) {
      attempts = 2;
      result = validateSemanticResult(request, readIssuanceModelOutput(await invoke(issuanceRepairInput(input, extracted, result.errors))));
    }
    return json({ ...result, model: ISSUANCE_MODEL, attempts, noticeDate: request.noticeDate, elapsedMs: Date.now() - started });
  } catch (error) {
    // Do not log source notices, model output, credentials or upstream response bodies.
    console.warn("issuance_recognition_failed", { name: error?.name || "Error", elapsedMs: Date.now() - started });
    const known = /^(识别超时|模型)/.test(error?.message || "");
    return json({ error: known ? error.message : "语义识别暂时不可用，请稍后重试；本次未改动项目。" }, controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
    context.request.signal.removeEventListener("abort", onAbort);
  }
}

async function readBoundedJson(request) {
  if (Number(request.headers.get("Content-Length")) > 64000) throw new Error("请求内容过长。");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("请求内容为空。");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64000) { await reader.cancel(); throw new Error("请求内容过长。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("请求 JSON 格式无效。"); }
}
