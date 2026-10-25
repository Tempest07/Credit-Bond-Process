import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { analyzePaymentReceiptPage } from "../payment-receipt-worker.js";
import { recognizePaymentReceiptText, selectPaymentReceiptMatch } from "../payment-receipts.js";

test("real OCR normalization and receipt parsing cannot turn a bank-account substring into an exact security", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([100, 100]);
  const image = document.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    Type: "XObject", Subtype: "Image", Width: 2, Height: 2,
    ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode",
  });
  page.node.newXObject("Image", document.context.register(image));
  const pdfBytes = await document.save({ useObjectStreams: false });
  for (const security_code of ["", "6222123456789012"]) {
    let calls = 0;
    const env = { AI_PROCESSING_APPROVED: "true", AI: { async run() {
      calls++;
      return { response: { classification: "receipt_start", confidence: 0.98, document_title: "配售缴款通知书 银行账号6222123456789012",
        bond_short_name: "26其他SCP001", security_code, payment_date: "2026-10-25", amount_text: "2000万元",
        bank_reference: "6222123456789012" } };
    } } };
    const analyzed = await analyzePaymentReceiptPage(env, pdfBytes, 1);
    assert.match(analyzed.recognizedText, /6222123456789012/);
    const receipt = recognizePaymentReceiptText(analyzed.recognizedText, analyzed.fields);
    const result = selectPaymentReceiptMatch(receipt, [{ id: "p", tranches: [{ id: "t", shortName: "26测试SCP001",
      securityCode: "123456", paymentDate: "2026-10-26", winningAmountWan: 1000 }] }]);
    assert.equal(calls, 1);
    assert.notEqual(result.status, "matched");
    assert.equal(result.projectId, "");
    assert.ok(result.candidates.every(candidate => !candidate.signals.securityCode));
  }
});
