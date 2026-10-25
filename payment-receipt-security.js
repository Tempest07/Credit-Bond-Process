/** Preserve the full code and market; a missing suffix is unknown, not another market. */
export function paymentReceiptCodeIdentity(value = '') {
  const text = String(value || '').normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g, '').toUpperCase();
  if (!text) return null;
  const match = text.match(/^(\d{6}|\d{9})(?:\.(IB|SH|SZ))?$/);
  return match ? { body: match[1], market: match[2] || '', text } : { invalid: true, text };
}

export function samePaymentReceiptCode(left, right) {
  return Boolean(left && right && !left.invalid && !right.invalid && left.body === right.body
    && (!left.market || !right.market || left.market === right.market));
}

/** Labelled codes and complete market-qualified tokens are identity evidence. */
export function paymentReceiptSourceCodes(text = '') {
  const raw = String(text || '').normalize('NFKC');
  const labelled = [...raw.matchAll(/(?:债\s*券\s*(?:代\s*码|编\s*码)|证\s*券\s*代\s*码)\s*[:：]?\s*([A-Z]?\d{6,18}(?:\s*\.\s*[A-Z]{2})?)/gi)]
    .map(match => paymentReceiptCodeIdentity(match[1]));
  const qualified = [...raw.matchAll(/(?<![A-Z0-9])(?:\d{6}|\d{9})\s*\.\s*(?:IB|SH|SZ)(?![A-Z0-9])/gi)]
    .map(match => paymentReceiptCodeIdentity(match[0]));
  return [...labelled, ...qualified];
}
