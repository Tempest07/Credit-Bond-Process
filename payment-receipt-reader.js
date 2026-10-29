export function paymentReceiptReaderEntries(receipts = [], files = [], batches = [], view = "all") {
  return [
    ...receipts.filter(receipt => view !== "review" || ["review", "error"].includes(receipt.matchStatus))
      .map(value => ({ key: `receipt:${value.id}`, kind: "receipt", value })),
    ...files.map(value => ({ key: `file:${value.id}`, kind: "file", value })),
    ...batches.map(value => ({ key: `batch:${value.id}`, kind: "batch", value })),
  ];
}

export function paymentReceiptReaderSelection(entries = [], currentKey = "", { loading = false, error = false } = {}) {
  if (entries.some(entry => entry.key === currentKey)) return currentKey;
  if (entries.length) return entries[0].key;
  return loading || error ? currentKey : "";
}

export function paymentReceiptReaderPreview(entry) {
  if (!entry || !["receipt", "file"].includes(entry.kind)) return null;
  const { kind, value } = entry;
  const firstPage = value.sourcePages?.[0];
  return {
    url: kind === "receipt"
      ? value.fileId ? `./api/payment-receipt-files/${encodeURIComponent(value.fileId)}/file`
        : `./api/payment-receipts/${encodeURIComponent(value.id)}/source`
      : `./api/payment-receipt-files/${encodeURIComponent(value.id)}/file`,
    selectionKey: entry.key || `${kind}:${value.id}`,
    initialPage: kind === "receipt" && Number.isSafeInteger(firstPage) && firstPage > 0 ? firstPage : 1,
    label: value.sourceFilename || value.bondShortName || value.subject || "缴款单原件",
  };
}

// A logical allocation may share a physical page with another bond. Its
// database suffix is an identity key, while the reader shows PDF page numbers.
export function paymentReceiptPageLabel(value = {}) {
  return String(typeof value === 'string' ? value : value.sourcePageLabel || '')
    .replace(/#.*$/, '');
}

export function paymentReceiptAmountDifference(receipt = {}, tranche = {}) {
  const actual = receipt.amountFen, expected = Math.round(Number(tranche.winningAmountWan) * 1_000_000);
  return Number.isSafeInteger(actual) && actual > 0 && Number.isSafeInteger(expected) && expected > 0
    && Math.abs(actual - expected) > 1 ? {receiptFen: actual, projectFen: expected} : null;
}
