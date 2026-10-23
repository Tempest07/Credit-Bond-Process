const ORIGIN = 'https://data-api.qeubee.cn';
const PREFIX = '/sumscope/common/api/';
const ALLOWED = new Set(['bondDimInfo', 'creditBondIssueInfo', 'issuerInfo', 'activeBondInfoByIssuer',
  'bondRatingLatest', 'institutionRating', 'cdcBondValuation', 'csiBondValuation', 'cdcCurveDictNew', 'cdcYieldCurveHis', 'cdcYieldCurveYtd']);
const MAX_BYTES = 1500000;

export function createQbClient(env, { signal, deadline = Date.now() + 28000 } = {}) {
  const cache = new Map(), queue = [];
  let active = 0, calls = 0, blockedError;
  const client = {
    today: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    fetchedAt: new Date().toISOString(),
    scope: { codes: new Set(), names: new Set(), basicByCode: new Map(), issuerNameBySocietyCode: new Map() },
    throwIfBlocked() { if (blockedError) throw blockedError; },
    async query(apiName, params = {}, options = {}) {
      if (!ALLOWED.has(apiName)) throw new Error('QB 接口不在已核实的只读目录中。');
      if (!env.QB_ACCESS_KEY) throw new Error('QB 备用数据源尚未配置。');
      signal?.throwIfAborted();
      options.signal?.throwIfAborted();
      if (blockedError) throw blockedError;
      const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ''));
      const key = apiName + JSON.stringify(Object.entries(clean).sort(([a], [b]) => a.localeCompare(b)));
      if (cache.has(key)) return cache.get(key);
      const pending = run(apiName, clean, options.signal);
      cache.set(key, pending);
      return pending;
    },
  };
  return client;

  async function run(apiName, params, callSignal) {
    if (blockedError) throw blockedError;
    if (++calls > 32) throw new Error('QB 本次查询已达到请求上限，请缩小查询范围。');
    if (active >= 4) await new Promise(resolve => queue.push(resolve));
    active++;
    try {
      signal?.throwIfAborted();
      callSignal?.throwIfAborted();
      if (blockedError) throw blockedError;
      const remaining = Math.min(6500, deadline - Date.now());
      if (remaining <= 0) throw new DOMException('数据查询超时。', 'TimeoutError');
      const timeout = AbortSignal.timeout(remaining);
      const querySignal = AbortSignal.any([signal, callSignal, timeout].filter(Boolean));
      const url = new URL(PREFIX + apiName, ORIGIN);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
      const response = await fetch(url, { headers: { 'X-Access-Key': env.QB_ACCESS_KEY, Accept: 'application/json' },
        signal: querySignal, redirect: 'manual' });
      if (!response.ok) {
        const error = response.status === 429 ? rateLimitedError(response.headers.get('Retry-After'))
          : new Error(`QB ${apiName} HTTP ${response.status}`);
        if (error.status === 429) blockedError ||= error;
        await response.body?.cancel();
        throw error;
      }
      const value = JSON.parse(await readBounded(response));
      const rows = unwrap(value, response.headers.get('Retry-After'));
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('QB 返回格式无效。');
      return rows;
    } catch (error) {
      if (error?.status === 429) blockedError ||= error;
      throw error;
    } finally {
      active--;
      queue.shift()?.();
    }
  }
}

function unwrap(value, retryAfter) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') throw new Error('QB 返回格式无效。');
  if (value.code === 429 || value.code === '429') throw rateLimitedError(retryAfter);
  if ('code' in value && ![0, 200, '0', '200', '0000', '000000', 'SUCCESS'].includes(value.code)) throw new Error('QB 查询未成功。');
  if (value.success === false) throw new Error('QB 查询未成功。');
  for (const key of ['data', 'result', 'rows', 'list', 'records', 'content']) {
    if (value[key] !== null && value[key] !== undefined) return unwrap(value[key], retryAfter);
  }
  throw new Error('QB 返回格式无效。');
}

function rateLimitedError(value) {
  const seconds = typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Object.assign(new Error('QB 请求过于频繁，请稍后重试。'), {
    status: 429, code: 'qb_rate_limited',
    ...(Number.isSafeInteger(seconds) ? { retryAfter: seconds } : {}),
  });
}

export function isQbStopError(error) {
  return error?.status === 429 || ['AbortError', 'TimeoutError'].includes(error?.name);
}

async function readBounded(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('QB 响应超过安全大小。'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('QB 响应超过安全大小。'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export const __test__ = { unwrap };
