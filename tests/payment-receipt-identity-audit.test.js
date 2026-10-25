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

test("PDF text fallback rejects an unlabelled full security or market conflict even without structured code fields", async () => {
  const document = await PDFDocument.create();
  document.addPage([100, 100]);
  const pdfBytes = await document.save();
  const projects = [{ id: "p", shortName: "26测试01", tranches: [{ id: "t", shortName: "26测试01",
    securityCode: "246129.SH", paymentDate: "2026-10-26", winningAmountWan: 1000 }] }];
  for (const code of ["246130.SH", "246129.SZ"]) {
    for (const identity of [`（${code}）`, ` ${code} `, `（${code.replace(".", " . ")}）`,
      `（${code.replace(/[0-9A-Z.]/g, character => String.fromCharCode(character.charCodeAt(0) + 0xfee0))}）`]) {
      const text = `配售缴款通知书\n债券简称26测试01${identity}\n缴款日期2026-10-26\n缴款金额1000万元`;
      const analysis = await analyzePaymentReceiptPage({ AI: {
        async toMarkdown() { return { format: "text", data: text }; },
      } }, pdfBytes, 1);
      assert.equal(analysis.analysisSource, "pdf-text-fallback");
      assert.equal(analysis.classification, "receipt_start");
      assert.deepEqual(analysis.fields, {}, "this path has no structured AI security field to enforce the conflict");
      const recognized = recognizePaymentReceiptText(analysis.recognizedText, analysis.fields);
      assert.equal(recognized.amountFen, 1_000_000_000);
      const result = selectPaymentReceiptMatch(recognized, projects);
      assert.equal(result.status, "review", identity);
      assert.equal(result.projectId, "", identity);
      assert.equal(result.trancheId, "", identity);
      assert.equal(result.candidates[0].securityCodeConflict, true, identity);
    }
  }
});

test("unlabelled complete codes can confirm the same security while account tails with a market suffix are never exact-code evidence", async () => {
  const document = await PDFDocument.create();
  document.addPage([100, 100]);
  const pdfBytes = await document.save();
  for (const [projectCode, sourceCode] of [["246129.SH", "246129.SH"], ["012682531.IB", "012682531 . IB"]]) {
    const text = `配售缴款通知书\n债券简称26测试01（${sourceCode}）\n缴款日期2026-10-26\n缴款金额1000万元`;
    const analysis = await analyzePaymentReceiptPage({ AI: {
      async toMarkdown() { return { format: "text", data: text }; },
    } }, pdfBytes, 1);
    const result = selectPaymentReceiptMatch(recognizePaymentReceiptText(analysis.recognizedText, analysis.fields), [
      { id: "p", tranches: [{ id: "t", shortName: "26测试01", securityCode: projectCode,
        paymentDate: "2026-10-26", winningAmountWan: 1000 }] },
    ]);
    assert.equal(result.status, "matched", sourceCode);
    assert.equal(result.projectId, "p");
    assert.equal(result.candidates[0].signals.securityCode, true);
    assert.equal(result.candidates[0].securityCodeConflict, false);
  }
  for (const account of ["6222246129.SH", "6222012682531.IB", "F246129.SH"]) {
    const result = selectPaymentReceiptMatch({ recognizedText: `银行账号${account}\n缴款金额2000万元`, paymentDate: "2026-10-25" }, [
      { id: "p", tranches: [{ id: "t", shortName: "26测试01", securityCode: "246129.SH",
        paymentDate: "2026-10-26", winningAmountWan: 1000 }] },
    ]);
    assert.notEqual(result.status, "matched", account);
    assert.ok(result.candidates.every(candidate => !candidate.signals.securityCode), account);
  }
});
