const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const PURPOSE_KEYS = { 'project-intake': 'DEEPSEEK_API_KEY', 'receipt-match': 'DEEPSEEK_OCR_API_KEY' };

/** Approved text tasks only: project intake uses key 1; receipt matching key 2. */
export async function runDeepseekText(env, input, options = {}) {
  const keyName = PURPOSE_KEYS[input?.purpose];
  if (!keyName) throw failure('PURPOSE', 400, '不支持的识别用途。');
  const key = env?.[keyName];
  if (typeof key !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(key)) throw failure('CONFIG', 503, '当前识别用途的服务端密钥尚未配置。');
  const messages = input.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 4
    || messages.some(message => !['system','user'].includes(message?.role) || typeof message.content !== 'string')
    || messages.reduce((size,message) => size + message.content.length,0) > 64000) throw failure('INPUT',400,'识别材料无效或过长。');
  const maxTokens = input.maxTokens || 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) throw failure('INPUT',400,'识别长度配置无效。');
  const timeoutMs = options.timeoutMs ?? 45000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 90000) throw failure('CONFIG',503,'识别超时配置无效。');
  const controller = new AbortController(); let rejectDeadline;
  const deadline = new Promise((_,reject) => { rejectDeadline = reject; });
  const stop = error => { controller.abort(error); rejectDeadline(error); };
  const abort = () => stop(failure('ABORTED',499,'识别请求已取消。'));
  if (options.signal?.aborted) { abort(); return deadline; }
  options.signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(() => stop(failure('TIMEOUT',504,'识别超时，请稍后重试。')),timeoutMs);
  try {
    return await Promise.race([invoke(),deadline]);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort',abort); }

  async function invoke() {
    let response;
    try {
      response = await (options.fetchImpl || fetch)(ENDPOINT,{method:'POST',redirect:'manual',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
        body:JSON.stringify({model:'deepseek-flash',messages,stream:false,temperature:0,max_tokens:maxTokens,
          thinking:{type:'disabled'},response_format:{type:'json_object'}})});
    } catch { active(); throw failure('UNAVAILABLE',503,'识别服务暂时无法连接。'); }
    active();
    if (response.redirected || response.status >= 300 && response.status < 400) { cancel(response); throw failure('REDIRECT',502,'识别服务返回异常跳转。'); }
    if (!response.ok) {
      cancel(response);
      const status = response.status;
      const messages = {401:'识别密钥无效。',403:'当前密钥没有识别权限。',402:'识别账户余额不足。',429:'识别请求过于频繁，请稍后重试。'};
      throw failure('UPSTREAM',status === 429 ? 429 : status >= 500 || [401,402,403].includes(status) ? 503 : 502,
        messages[status] || '识别服务暂时不可用。',{upstreamStatus:status});
    }
    const data = await boundedJson(response,controller.signal);
    active();
    const choice = data?.choices?.[0], content = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim() || content.includes(key)) throw protocol();
    let output; try { output = JSON.parse(content); } catch { throw protocol(); }
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw protocol();
    return {output,model:'deepseek-flash',provider:'deepseek'};
  }
  function active() { if (controller.signal.aborted) throw controller.signal.reason; }
}

async function boundedJson(response,signal) {
  const limit = 256000;
  if (Number(response.headers.get('Content-Length')) > limit) { cancel(response); throw protocol(); }
  const reader = response.body?.getReader(); if (!reader) throw protocol();
  const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const {done,value} = await reader.read(); if (signal.aborted) throw signal.reason;
      if (done) break;
      size += value.byteLength; if (size > limit) { abort(); throw protocol(); } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw protocol(); }
  } finally { signal.removeEventListener('abort',abort); reader.releaseLock(); }
}
function cancel(response) { void response.body?.cancel().catch(() => {}); }
function protocol() { return failure('PROTOCOL',502,'识别结果不完整或格式无效，请重试。'); }
function failure(code,httpStatus,publicMessage,extra={}) { return Object.assign(new Error(publicMessage),{code:`DEEPSEEK_TASK_${code}`,httpStatus,status:httpStatus,publicMessage,retryable:false,...extra}); }
