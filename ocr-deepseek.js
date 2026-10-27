import { inspectProjectScreenshotImageHeader } from './project-screenshot-image.js';

export const DEEPSEEK_OCR_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_OCR_MODEL = 'deepseek-flash';
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256000;

/** Server-only OCR adapter. Never reads the separate issuance-result key. */
export function selectDeepSeekOcr(env = {}, options = {}) {
  const provider = String(env.OCR_AI_PROVIDER || 'legacy').trim().toLowerCase();
  if (provider === 'legacy') return null;
  if (provider !== 'deepseek') throw failure('CONFIG', 503, 'OCR 服务配置无效，请检查服务端配置。');
  const key = env.DEEPSEEK_OCR_API_KEY;
  if (typeof key !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(key)) {
    throw failure('CONFIG', 503, 'OCR 专用密钥尚未配置或格式无效。');
  }
  const model = env.DEEPSEEK_OCR_MODEL || DEEPSEEK_OCR_MODEL;
  if (model !== DEEPSEEK_OCR_MODEL) throw failure('CONFIG', 503, 'OCR 图像模型配置无效。');
  const timeoutMs = options.timeoutMs ?? Number(env.DEEPSEEK_OCR_TIMEOUT_MS || 60000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 90000) throw failure('CONFIG', 503, 'OCR 超时配置无效。');
  return {
    model, provider: 'deepseek',
    async run(_legacyModel, input) {
      const messages = visionMessages(input?.messages);
      const maxTokens = Number(input?.max_tokens || 4096);
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw failure('INPUT', 400, 'OCR 输出长度配置无效。');
      const body = JSON.stringify({ model, messages, stream: false, temperature: 0, max_tokens: maxTokens,
        thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
      return withDeadline(async signal => {
        let response;
        try {
          response = await (options.fetchImpl || fetch)(DEEPSEEK_OCR_ENDPOINT, {
            method: 'POST', redirect: 'manual', signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body,
          });
        } catch { active(signal); throw failure('UNAVAILABLE', 503, '图像识别服务暂时无法连接，请稍后重试。'); }
        active(signal);
        if (response.redirected || response.status >= 300 && response.status < 400) {
          cancel(response);
          throw failure('REDIRECT', 502, '图像识别服务返回异常跳转。', { upstreamStatus: response.status });
        }
        if (!response.ok) { cancel(response); throw httpFailure(response); }
        const result = await boundedJson(response, signal);
        const choice = result?.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim() || content.includes(key)) {
          throw failure('PROTOCOL', 502, '图像识别结果不完整，请裁剪图片后重试。');
        }
        let output;
        try { output = JSON.parse(content); } catch { throw failure('PROTOCOL', 502, '图像识别结果格式无效，请重试。'); }
        if (!output || typeof output !== 'object' || Array.isArray(output)) throw failure('PROTOCOL', 502, '图像识别结果格式无效，请重试。');
        return { response: content, model, provider: 'deepseek' };
      }, timeoutMs, options.signal);
    },
  };
}

function visionMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 4) throw failure('INPUT', 400, 'OCR 请求格式无效。');
  let imageCount = 0, imageBytes = 0, textLength = 0;
  const output = messages.map(message => {
    if (!['system', 'user'].includes(message?.role)) throw failure('INPUT', 400, 'OCR 请求角色无效。');
    if (typeof message.content === 'string') { textLength += message.content.length; return { role: message.role, content: message.content }; }
    if (message.role !== 'user' || !Array.isArray(message.content) || message.content.length > 12) throw failure('INPUT', 400, 'OCR 图片必须放在用户消息中。');
    return { role: 'user', content: message.content.map(part => {
      if (part?.type === 'text' && typeof part.text === 'string') { textLength += part.text.length; return { type: 'text', text: part.text }; }
      const url = part?.image_url?.url;
      if (part?.type !== 'image_url' || typeof url !== 'string' || url.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) {
        throw failure('INPUT', 400, 'OCR 只接受大小受限的内嵌图片。');
      }
      const match = url.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match || match[2].length % 4) throw failure('INPUT', 400, 'OCR 图片格式无效。');
      let binary;
      try { binary = atob(match[2]); } catch { throw failure('INPUT', 400, 'OCR 图片编码无效。'); }
      imageCount++; imageBytes += binary.length;
      if (imageCount > 6 || imageBytes > MAX_IMAGE_BYTES) throw failure('INPUT', 413, 'OCR 图片过大，请裁剪或分批识别。');
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const dimensions = inspectProjectScreenshotImageHeader(bytes);
      if (!dimensions?.width || !dimensions.height || dimensions.format !== match[1]) throw failure('INPUT', 400, 'OCR 图片内容无效。');
      if (Math.max(dimensions.width, dimensions.height) > 8192 || dimensions.width * dimensions.height > 18000000) {
        throw failure('INPUT', 413, 'OCR 图片尺寸过大，请裁剪至最长边 8192 像素以内。');
      }
      return { type: 'image_url', image_url: { url, detail: 'original' } };
    }) };
  });
  if (!imageCount || textLength > 64000) throw failure('INPUT', 400, 'OCR 需要图片，且文字不得超过长度限制。');
  return output;
}

async function boundedJson(response, signal) {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) { cancel(response); throw protocolFailure(); }
  const reader = response.body?.getReader();
  if (!reader) throw protocolFailure();
  const chunks = []; let length = 0;
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) {
      active(signal); const { done, value } = await reader.read(); active(signal);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) { stop(); throw protocolFailure(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw protocolFailure(); }
  } catch (error) { active(signal); if (error?.code?.startsWith('DEEPSEEK_OCR_')) throw error; throw protocolFailure(); }
  finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
}

function httpFailure(response) {
  const status = response.status, extra = { upstreamStatus: status };
  if ([401, 403].includes(status)) return failure('AUTH', 503, 'OCR 专用密钥无效或没有图像识别权限。', extra);
  if (status === 402) return failure('BALANCE', 503, 'OCR 账户余额不足，请检查账户余额。', extra);
  if (status === 429) return failure('RATE_LIMIT', 429, '图像识别请求过于频繁，请稍后重试。', extra);
  return failure('UPSTREAM', status >= 500 ? 503 : 502, '图像识别服务暂时不可用，请稍后重试。', extra);
}
async function withDeadline(task, timeoutMs, parentSignal) {
  const controller = new AbortController(); let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const stop = error => { if (!controller.signal.aborted) controller.abort(error); rejectDeadline(error); };
  const onAbort = () => stop(failure('ABORTED', 499, '图像识别请求已取消。', { name: 'AbortError' }));
  if (parentSignal?.aborted) { onAbort(); return deadline; }
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(failure('TIMEOUT', 504, '图像识别超时，请裁剪图片后重试。', { name: 'TimeoutError' })), timeoutMs);
  try { return await Promise.race([task(controller.signal), deadline]); }
  finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', onAbort); }
}
function active(signal) { if (signal.aborted) throw signal.reason; }
function cancel(response) { void response.body?.cancel().catch(() => {}); }
function protocolFailure() { return failure('PROTOCOL', 502, '图像识别服务返回格式异常，请重试。'); }
function failure(code, httpStatus, publicMessage, extra = {}) {
  return Object.assign(new Error(publicMessage), { code: `DEEPSEEK_OCR_${code}`, httpStatus, status: httpStatus, publicMessage, retryable: false, nonRetryable: true, ...extra });
}
