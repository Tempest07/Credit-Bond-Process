import { PROJECT_VISION_MODEL, PROJECT_VISION_REVISION, PROJECT_VISION_SCHEMA as schema, PROJECT_VISION_PROMPT as prompt, validateVisionImage, validateVisionOutput } from "../project-screenshot-vision.js";
export { PROJECT_VISION_MODEL, PROJECT_VISION_REVISION, MAX_VISION_IMAGE_BYTES, validateVisionImage, validateVisionOutput } from "../project-screenshot-vision.js";

export async function recognizeProjectWithLocalVision(bytes, mimeType, options = {}) {
  validateVisionImage(bytes, mimeType);
  const started = Date.now();
  const response = await (options.fetchImpl || fetch)("http://127.0.0.1:11434/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    body: JSON.stringify({
      model: PROJECT_VISION_MODEL, stream: false, format: schema, keep_alive: 0,
      messages: [{ role: "system", content: prompt }, { role: "user", content: "请转录这张项目表。", images: [bytes.toString("base64")] }],
      options: { temperature: 0, seed: 0, num_ctx: 16384, num_predict: 4096 },
    }),
  });
  if (!response.ok) throw new Error(`本地视觉模型调用失败（HTTP ${response.status}）。`);
  const result = await response.json();
  if (!result.done || result.done_reason === "length") throw new Error("视觉模型输出不完整，请缩小截图范围后重试。");
  const output = validateVisionOutput(JSON.parse(result.message?.content || "null"));
  return { ...output, model: PROJECT_VISION_MODEL, promptRevision: PROJECT_VISION_REVISION, elapsedMs: Date.now() - started };
}
