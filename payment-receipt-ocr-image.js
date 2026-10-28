import { inspectProjectScreenshotImageHeader } from './project-screenshot-image.js';

// The binding consumes compressed bytes directly; the Worker never decodes a
// 600-dpi page into a large pixel buffer or exposes the private scan via a URL.
const MAX_SOURCE_BYTES = 20_000_000;
const MAX_SOURCE_PIXELS = 100_000_000;
const MAX_SOURCE_EDGE = 12_000;
export const PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES = 10_000_000;
const MAX_OCR_EDGE = 8192;
const MAX_OCR_PIXELS = 18_000_000;
const IMAGE_TIMEOUT_MS = 30_000;

/** Prepare only an OCR copy. Original PDF and extracted bytes stay unchanged. */
export async function preparePaymentReceiptOcrImage(env, image) {
  if (!image) return image;
  const bytes = image.bytes instanceof Uint8Array ? image.bytes
    : image.bytes instanceof ArrayBuffer ? new Uint8Array(image.bytes) : null;
  if (!bytes?.byteLength) throw failure('INPUT', '原件图像内容无效，原件已保留。', 400);
  const header = inspectProjectScreenshotImageHeader(bytes);
  const expectedFormat = ({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' })[image.mimeType];
  if (!expectedFormat || !header || header.format !== expectedFormat) throw failure('INPUT', '原件图像格式无效，原件已保留。', 400);
  // Extractors already inspect the PDF image dictionary. Prefer a complete
  // encoded header whenever available, so stale dictionary dimensions cannot
  // accidentally send an oversized image to the OCR provider.
  const width = validDimension(header?.width) ? header.width : Number(image.width);
  const height = validDimension(header?.height) ? header.height : Number(image.height);
  if (!validDimension(width) || !validDimension(height)) throw failure('INPUT', '无法读取原件图像尺寸，原件已保留。', 400);
  if (Math.max(width, height) <= MAX_OCR_EDGE && width * height <= MAX_OCR_PIXELS
      && bytes.byteLength <= PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES) return image;
  if (bytes.byteLength > MAX_SOURCE_BYTES || width * height > MAX_SOURCE_PIXELS || Math.max(width, height) > MAX_SOURCE_EDGE) {
    throw failure('SOURCE_LIMIT', '原件图像超出自动处理范围，原件已保留。', 413);
  }
  if (typeof env?.IMAGES?.input !== 'function') {
    throw failure('CONFIG', '图像缩放服务尚未配置，原件已保留。', 503);
  }
  const bounds = width > height ? { width: 3200, height: 2400 } : { width: 2400, height: 3200 };
  let result;
  try {
    result = await withDeadline(async signal => {
      const output = await env.IMAGES.input(new Blob([bytes], { type: image.mimeType }).stream())
        .transform({ ...bounds, fit: 'scale-down' })
        .output({ format: 'image/jpeg', quality: 90 });
      if (signal.aborted) throw failure('TIMEOUT', '原件图像处理超时，原件已保留。', 504);
      const response = await output.response({ headers: { 'Cache-Control': 'private, no-store' } });
      if (!response?.ok || !response.body) throw failure('PROCESSING', '原件图像处理失败，原件已保留。', 502);
      return boundedBytes(response, signal);
    });
  } catch (error) {
    if (error?.code?.startsWith('PAYMENT_RECEIPT_IMAGE_')) throw error;
    // Never return a processor error body: it may contain document content or
    // internal request details. There is no fallback to a public image URL.
    throw failure('PROCESSING', '原件图像处理失败，原件已保留。', 502);
  }
  const resized = inspectProjectScreenshotImageHeader(result);
  if (resized?.format !== 'jpeg' || !validDimension(resized.width) || !validDimension(resized.height)
      || resized.width > bounds.width || resized.height > bounds.height
      || resized.width > width || resized.height > height
      || Math.abs((resized.width / resized.height) / (width / height) - 1) > 0.02) {
    throw failure('OUTPUT', '原件图像处理结果无效，原件已保留。', 502);
  }
  return { ...image, bytes: result, mimeType: 'image/jpeg', width: resized.width, height: resized.height,
    resized: true, sourceWidth: width, sourceHeight: height };
}

function validDimension(value) { return Number.isSafeInteger(value) && value > 0; }

async function boundedBytes(response, signal) {
  if (Number(response.headers.get('Content-Length')) > PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES) {
    void response.body.cancel().catch(() => {});
    throw failure('OUTPUT_LIMIT', '原件图像处理结果过大，原件已保留。', 502);
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw failure('TIMEOUT', '原件图像处理超时，原件已保留。', 504);
      const { done, value } = await reader.read();
      if (signal.aborted) throw failure('TIMEOUT', '原件图像处理超时，原件已保留。', 504);
      if (done) break;
      length += value.byteLength;
      if (length > PAYMENT_RECEIPT_OCR_IMAGE_MAX_BYTES) {
        stop(); throw failure('OUTPUT_LIMIT', '原件图像处理结果过大，原件已保留。', 502);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}

async function withDeadline(task) {
  const controller = new AbortController(); let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(failure('TIMEOUT', '原件图像处理超时，原件已保留。', 504)); }, IMAGE_TIMEOUT_MS);
  });
  try { return await Promise.race([task(controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}

function failure(code, message, status) {
  return Object.assign(new Error(message), { code: 'PAYMENT_RECEIPT_IMAGE_' + code, status, httpStatus: status,
    publicMessage: message, nonRetryable: true, retryable: false });
}
