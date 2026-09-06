import { PROJECT_SCREENSHOT_BRANCHES } from "./project-screenshot-ocr.js";
import { inspectProjectScreenshotImageHeader } from "./project-screenshot-image.js";

export const PROJECT_VISION_MODEL = "qwen3-vl:8b-instruct";
export const PROJECT_VISION_REVISION = "project-table-20260905-1";
export const MAX_VISION_IMAGE_BYTES = 30 * 1024 * 1024;

export function validateVisionImage(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_VISION_IMAGE_BYTES) throw new Error("图片为空或超过 30MB。");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (!(mimeType === "image/jpeg" && jpeg || mimeType === "image/png" && png || mimeType === "image/webp" && webp)) {
    throw new Error("视觉识别支持 PNG、JPEG、WebP 图片。");
  }
  const dimensions = inspectProjectScreenshotImageHeader(bytes);
  if (!dimensions?.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > 16000
    || dimensions.width * dimensions.height > 18000000) throw new Error("图片尺寸无效或过大，请裁剪至 1800 万像素、最长边 16000 像素以内。");
}

export function validateVisionOutput(output) {
  if (!output || !Array.isArray(output.entries) || output.entries.length > 100
    || !Array.isArray(output.warnings) || output.warnings.length > 100
    || output.warnings.some((item) => typeof item !== "string" || item.length > 1000)) throw new Error("视觉模型返回格式无效。");
  const warnings = [...output.warnings];
  const entries = output.entries.map((item, index) => {
    if (typeof item?.branch !== "string" || typeof item?.fullName !== "string"
      || item.branch.length > 30 || item.fullName.length > 300) throw new Error("视觉模型返回字段无效。");
    const branch = item.branch.trim();
    const fullName = item.fullName.trim();
    if (!PROJECT_SCREENSHOT_BRANCHES.includes(branch) || !fullName) warnings.push(`第 ${index + 1} 行的分行或债券名称需要人工核对。`);
    return { branch, fullName };
  });
  return { entries, warnings };
}

