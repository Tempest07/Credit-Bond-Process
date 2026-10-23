import { json } from '../_auth.js';

export function qbRateLimitResponse(error) {
  if (Number(error?.status) !== 429 && error?.code !== 'qb_rate_limited') return null;
  const seconds = error.retryAfter;
  const valid = seconds !== '' && seconds !== undefined && seconds !== null
    && /^\d+$/.test(String(seconds)) && Number.isSafeInteger(Number(seconds)) && Number(seconds) >= 0;
  return json({ source: 'QB', code: 'qb_rate_limited', error: 'QB 接口限流，请稍后重试。',
    ...(valid ? { retryAfter: Number(seconds) } : {}) }, 429, valid ? { 'Retry-After': String(seconds) } : {});
}
