export function paymentReceiptReaderEntries(receipts = [], files = [], batches = [], view = "all") {
  return [
    ...receipts.filter(receipt => view !== "review" || receipt.matchStatus !== "matched")
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
      ? `./api/payment-receipts/${encodeURIComponent(value.id)}/source`
      : `./api/payment-receipt-files/${encodeURIComponent(value.id)}/file`,
    initialPage: kind === "receipt" && Number.isSafeInteger(firstPage) && firstPage > 0 ? firstPage : 1,
    label: value.sourceFilename || value.bondShortName || value.subject || "缴款单原件",
  };
}
