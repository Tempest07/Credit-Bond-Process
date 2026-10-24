import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentReceiptReaderEntries,
  paymentReceiptReaderSelection,
  paymentReceiptReaderPreview,
} from "../payment-receipt-reader.js";

test("reader entries preserve group order and distinguish IDs shared by different kinds", () => {
  const receipts = [{ id: "same" }, { id: "receipt-2" }];
  const files = [{ id: "same" }, { id: "file-2" }];
  const batches = [{ id: "same" }, { id: "batch-2" }];
  const entries = paymentReceiptReaderEntries(receipts, files, batches);
  assert.deepEqual(entries.map(({ key, kind }) => ({ key, kind })), [
    { key: "receipt:same", kind: "receipt" },
    { key: "receipt:receipt-2", kind: "receipt" },
    { key: "file:same", kind: "file" },
    { key: "file:file-2", kind: "file" },
    { key: "batch:same", kind: "batch" },
    { key: "batch:batch-2", kind: "batch" },
  ]);
  assert.equal(entries[0].value, receipts[0]);
  assert.equal(entries[2].value, files[0]);
  assert.equal(entries[4].value, batches[0]);
  assert.deepEqual(paymentReceiptReaderEntries(), []);
});

test("review excludes only matched receipts and keeps pending originals and batches", () => {
  const receipts = ["matched", "review", "unmatched", "duplicate", "error", undefined]
    .map((matchStatus, index) => ({ id: String(index), matchStatus }));
  const files = [{ id: "original", matchStatus: "matched" }];
  const batches = [{ id: "batch", matchStatus: "matched" }];
  assert.deepEqual(paymentReceiptReaderEntries(receipts, files, batches, "review").map(entry => entry.key), [
    "receipt:1", "receipt:2", "receipt:3", "receipt:4", "receipt:5", "file:original", "batch:batch",
  ]);
  assert.equal(paymentReceiptReaderEntries(receipts, files, batches, "all").length, 8);
});

test("selection survives refresh and chooses the first available entry after deletion or filtering", () => {
  const receipts = [{ id: "one", matchStatus: "matched" }, { id: "two", matchStatus: "review" }];
  const all = paymentReceiptReaderEntries(receipts);
  assert.equal(paymentReceiptReaderSelection(all, "receipt:two"), "receipt:two");
  assert.equal(paymentReceiptReaderSelection(paymentReceiptReaderEntries(receipts.map(item => ({ ...item }))), "receipt:two"), "receipt:two");
  assert.equal(paymentReceiptReaderSelection(all.slice(0, 1), "receipt:two"), "receipt:one");
  assert.equal(paymentReceiptReaderSelection(paymentReceiptReaderEntries(receipts, [], [], "review"), "receipt:one"), "receipt:two");
  assert.equal(paymentReceiptReaderSelection(all, "file:two"), "receipt:one");
  assert.equal(paymentReceiptReaderSelection([], "receipt:two"), "");
  assert.equal(paymentReceiptReaderSelection(), "");
});

test("empty loading and error states preserve selection so retry can restore it", () => {
  for (const options of [{ loading: true }, { error: true }, { loading: true, error: true }]) {
    assert.equal(paymentReceiptReaderSelection([], "receipt:two", options), "receipt:two");
    assert.equal(paymentReceiptReaderSelection([], "", options), "");
    const refreshed = paymentReceiptReaderEntries([{ id: "one" }, { id: "two" }]);
    assert.equal(paymentReceiptReaderSelection(refreshed, "receipt:two", options), "receipt:two");
    assert.equal(paymentReceiptReaderSelection(refreshed, "receipt:deleted", options), "receipt:one");
  }
});

test("receipt preview encodes the ID and opens the first source page at a relative same-origin URL", () => {
  const entry = paymentReceiptReaderEntries([{
    id: "a/b ?#中文", sourcePages: [4, 9], sourceFilename: "合并缴款单.pdf", bondShortName: "测试债", subject: "邮件主题",
  }])[0];
  assert.deepEqual(paymentReceiptReaderPreview(entry), {
    url: "./api/payment-receipts/a%2Fb%20%3F%23%E4%B8%AD%E6%96%87/source",
    selectionKey: "receipt:a/b ?#中文",
    initialPage: 4,
    label: "合并缴款单.pdf",
  });
  const preview = paymentReceiptReaderPreview(entry);
  assert.equal(new URL(preview.url, "https://tempest07.com/bond-centre/").pathname,
    "/bond-centre/api/payment-receipts/a%2Fb%20%3F%23%E4%B8%AD%E6%96%87/source");
});

test("receipt preview defaults invalid first pages to one and uses the available title", () => {
  for (const page of [undefined, null, 0, -1, 1.5, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const entry = { kind: "receipt", value: { id: "r", sourcePages: [page, 3] } };
    assert.equal(paymentReceiptReaderPreview(entry).initialPage, 1);
  }
  assert.equal(paymentReceiptReaderPreview({ kind: "receipt", value: { id: "r" } }).initialPage, 1);
  assert.equal(paymentReceiptReaderPreview({ kind: "receipt", value: { id: "r", bondShortName: "测试债", subject: "主题" } }).label, "测试债");
  assert.equal(paymentReceiptReaderPreview({ kind: "receipt", value: { id: "r", subject: "主题" } }).label, "主题");
  assert.equal(paymentReceiptReaderPreview({ kind: "receipt", value: { id: "r" } }).label, "缴款单原件");
});

test("original file preview always starts at page one and batches have no preview", () => {
  assert.deepEqual(paymentReceiptReaderPreview({
    kind: "file", value: { id: "file/1", sourceFilename: "原件.pdf", sourcePages: [7] },
  }), { url: "./api/payment-receipt-files/file%2F1/file", selectionKey: "file:file/1", initialPage: 1, label: "原件.pdf" });
  assert.equal(paymentReceiptReaderPreview({ kind: "file", value: { id: "f", subject: "待识别邮件" } }).label, "待识别邮件");
  assert.equal(paymentReceiptReaderPreview({ kind: "file", value: { id: "f" } }).label, "缴款单原件");
  assert.equal(paymentReceiptReaderPreview({ kind: "batch", value: { id: "b" } }), null);
  assert.equal(paymentReceiptReaderPreview(null), null);
  assert.equal(paymentReceiptReaderPreview(), null);
});

test("receipts from one attachment share a canonical original but retain their selection and source page", () => {
  const entries = paymentReceiptReaderEntries([
    { id: "first", fileId: "file/1", sourcePages: [9, 10, 11] },
    { id: "second", fileId: "file/1", sourcePages: [8] },
  ]);
  const [first, second] = entries.map(paymentReceiptReaderPreview);
  assert.equal(first.url, "./api/payment-receipt-files/file%2F1/file");
  assert.equal(first.url, second.url);
  assert.equal(first.selectionKey, "receipt:first");
  assert.equal(second.selectionKey, "receipt:second");
  assert.equal(first.initialPage, 9);
  assert.equal(second.initialPage, 8);
});
