export function normalizeMarketImpliedRating(value = "") {
  const text = String(value ?? "").normalize("NFKC").trim().toUpperCase();
  return /^(?:AAA[+-]?|AA(?:[+-]|\(2\))?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D)$/.test(text) ? text : "";
}
