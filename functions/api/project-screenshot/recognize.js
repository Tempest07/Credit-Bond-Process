import { requireUser, json } from "../_auth.js";
import { localProviderConfig } from "../_issuance-provider.js";
import { MAX_VISION_IMAGE_BYTES, PROJECT_VISION_MODEL, PROJECT_VISION_REVISION, validateVisionImage, validateVisionOutput } from "../../../project-screenshot-vision.js";

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const origin = context.request.headers.get("Origin");
  if (origin && origin !== new URL(context.request.url).origin && origin !== "https://tempest07.com") return json({ error: "不允许跨站调用。" }, 403);
  const mimeType = context.request.headers.get("Content-Type")?.split(";")[0].toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return json({ error: "请使用 PNG、JPEG、WebP 图片。" }, 415);
  let bytes;
  try {
    bytes = await readBoundedBytes(context.request, MAX_VISION_IMAGE_BYTES);
    validateVisionImage(bytes, mimeType);
  } catch (error) { return json({ error: error.message }, error.status || 400); }
  try {
    // Reuse the authenticated local AI gateway and Access credentials already used for issuance.
    const local = localProviderConfig(context.env);
    if (!local) return json({ error: "本地视觉服务尚未启用。" }, 503);
    const headers = { "Content-Type": mimeType, "Authorization": `Bearer ${local.token}` };
    if (local.accessClientId) {
      headers["CF-Access-Client-Id"] = local.accessClientId;
      headers["CF-Access-Client-Secret"] = local.accessClientSecret;
    }
    const url = new URL("/v1/project-screenshot", local.url);
    // Pages only supplies an incoming signal when enable_request_signal is enabled.
    const timeoutSignal = AbortSignal.timeout(90000);
    const signal = context.request.signal ? AbortSignal.any([context.request.signal, timeoutSignal]) : timeoutSignal;
    const started = Date.now();
    const response = await (context.fetchImpl || fetch)(url, { method: "POST", headers, body: bytes, signal, redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel();
      return json({ error: response.status === 429 ? "本地模型正在处理其他任务，请稍后重试。" : "本地视觉服务暂时不可用，请确认电脑和 Ollama 已启动。" }, response.status === 429 ? 429 : 503);
    }
    const result = JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 256000)));
    if (result.model !== PROJECT_VISION_MODEL || result.promptRevision !== PROJECT_VISION_REVISION) throw new Error("Invalid model protocol");
    const output = validateVisionOutput(result);
    return json({ ...output, model: result.model, promptRevision: result.promptRevision, elapsedMs: Date.now() - started });
  } catch (error) {
    const timeout = ["AbortError", "TimeoutError"].includes(error?.name);
    return json({ error: timeout ? "图片识别超时，请裁剪或分段后重试。" : "本地视觉服务暂时不可用，请稍后重试。" }, timeout ? 504 : 503);
  }
}

async function readBoundedBytes(message, limit) {
  const tooLarge = () => Object.assign(new Error("请求内容超过大小限制。"), { status: 413 });
  if (Number(message.headers.get("Content-Length")) > limit) throw tooLarge();
  const reader = message.body?.getReader();
  if (!reader) throw new Error("内容为空。");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
