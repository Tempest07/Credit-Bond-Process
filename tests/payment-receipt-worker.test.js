import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import {
  analyzePaymentReceiptPage,
  extractPaymentReceiptPageImage,
  finalizeBatchStatus,
  paymentReceiptFingerprintMaterial,
  paymentReceiptMessageIdConflict,
  paymentReceiptRetryDelaySeconds,
  paymentReceiptWorkerReadiness,
  recordDeadLetterFailure,
  recipientAllowed,
} from "../payment-receipt-worker.js";
import { decodePaymentReceiptSubject } from "../functions/api/_payment-receipts.js";

async function scannedPagePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([100, 100]);
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const image = document.context.stream(jpegBytes, {
    Type: "XObject",
    Subtype: "Image",
    Width: 2,
    Height: 2,
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
    Filter: "DCTDecode",
  });
  const imageRef = document.context.register(image);
  page.node.newXObject("Image", imageRef);
  return document.save({ useObjectStreams: false });
}

test("fails closed when the dedicated receipt recipient is not configured", () => {
  assert.equal(recipientAllowed("payment-receipts@tempest07.com", ""), false);
  assert.equal(recipientAllowed("other@tempest07.com", "payment-receipts@tempest07.com"), false);
  assert.equal(recipientAllowed("PAYMENT-RECEIPTS@TEMPEST07.COM", "payment-receipts@tempest07.com"), true);
});

test("reports the Worker as not ready until every production safety gate is satisfied", () => {
  const bindings = {
    DB: {},
    PAYMENT_RECEIPTS: {},
    RECEIPT_QUEUE: {},
    AI: {},
    ALLOWED_SENDERS: "REPLACE_WITH_FORWARDER@example.com",
    EXPECTED_RECIPIENT: "payment-receipts@tempest07.com",
    AI_PROCESSING_APPROVED: "false",
  };
  const pending = paymentReceiptWorkerReadiness(bindings);
  assert.equal(pending.ready, false);
  assert.equal(pending.checks.allowedSenders, false);
  assert.equal(pending.checks.aiProcessingApproved, false);

  const malformed = paymentReceiptWorkerReadiness({
    ...bindings,
    ALLOWED_SENDERS: "not-an-email",
    AI_PROCESSING_APPROVED: "true",
  });
  assert.equal(malformed.checks.allowedSenders, false);

  const ready = paymentReceiptWorkerReadiness({
    ...bindings,
    ALLOWED_SENDERS: "internal-forwarder@example.com",
    AI_PROCESSING_APPROVED: "true",
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(Object.values(ready.checks), [true, true, true, true, true, true, true]);
});

test("backs queue retries off without exceeding fifteen minutes", () => {
  assert.equal(paymentReceiptRetryDelaySeconds(1), 15);
  assert.equal(paymentReceiptRetryDelaySeconds(2), 30);
  assert.equal(paymentReceiptRetryDelaySeconds(5), 240);
  assert.equal(paymentReceiptRetryDelaySeconds(20), 900);
});

test("restores the forced-review flag for Message-ID conflict batches", () => {
  assert.equal(paymentReceiptMessageIdConflict("<mail@example.com>#sha256:abcdef"), true);
  assert.equal(paymentReceiptMessageIdConflict("<mail@example.com>"), false);
});

test("ignores a late dead-letter message after its file has already recovered", async () => {
  const queries = [];
  const env = {
    DB: {
      prepare(sql) {
        queries.push(sql);
        return {
          bind() { return this; },
          async run() { return { meta: { changes: 0 } }; },
        };
      },
    },
  };
  const recorded = await recordDeadLetterFailure(env, {
    kind: "file",
    batchId: "batch-1",
    fileId: "file-already-processed",
  });
  assert.equal(recorded, false);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /processing_status = 'error'/);
});

test("does not finalize a batch before the email attachment pass completes", async () => {
  const queries = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { throw new Error("batch status must not be updated"); },
      };
    },
  };
  assert.equal(await finalizeBatchStatus(db, "batch-partial"), false);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /email_attachments_extracted/);
});

test("classifies and extracts one scanned receipt page through Workers AI", async () => {
  let request;
  const pdf = await scannedPagePdf();
  const result = await analyzePaymentReceiptPage({
    AI: {
      async run(model, input) {
        request = { model, input };
        return {
          response: JSON.stringify({
            classification: "receipt_start",
            confidence: 0.98,
            boundary_evidence: "标题与债券简称均位于首页",
            recognized_text: "债券简称 26灵天02 债券代码 283234.SH",
            payment_date: "2026-07-08",
            amount_text: "9,000万元",
            bond_short_name: "26灵天02",
            security_code: "283234.SH",
            prepayment_number: "",
            payer_name: "兴业银行股份有限公司资金营运中心",
            payee_name: "",
            bank_reference: "",
          }),
        };
      },
    },
  }, pdf, 1);

  assert.equal(request.model, "@cf/mistralai/mistral-small-3.1-24b-instruct");
  assert.equal(request.input.response_format, undefined);
  assert.equal(request.input.max_tokens, 600);
  assert.match(request.input.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(request.input.messages[0].content[0].text, /绝不能返回 blank/);
  assert.match(request.input.messages[0].content[0].text, /"classification":"receipt_start"/);
  assert.equal(result.classification, "receipt_start");
  assert.equal(result.analysisVersion, 3);
  assert.equal(result.analysisSource, "workers-ai-page-image");
  assert.equal(result.fields.securityCode, "283234.SH");
  assert.match(result.recognizedText, /9,000万元/);
});

test("downgrades a low-confidence page to uncertain and supplies prior-page context", async () => {
  let request;
  const pdf = await scannedPagePdf();
  const result = await analyzePaymentReceiptPage({
    AI: {
      async run(_model, input) {
        request = input;
        return {
          response: JSON.stringify({
            classification: "receipt_start",
            confidence: 0.62,
            boundary_evidence: "标题模糊",
            recognized_text: "疑似另一项目缴款通知",
            payment_date: "",
            amount_text: "",
            bond_short_name: "",
            security_code: "",
            prepayment_number: "",
            payer_name: "",
            payee_name: "",
            bank_reference: "",
          }),
        };
      },
    },
  }, pdf, 2, {
    classification: "receipt_start",
    recognizedText: "26示例01",
  });

  assert.equal(result.classification, "uncertain");
  assert.equal(result.confidence, 0.62);
  assert.match(request.messages[0].content[0].text, /26示例01/);
  assert.match(request.messages[0].content[0].text, /低于 0\.8/);
});

test("never accepts blank when OCR found a payment-notice title", async () => {
  const pdf = await scannedPagePdf();
  const result = await analyzePaymentReceiptPage({
    AI: {
      async run() {
        return {
          response: {
            classification: "blank",
            confidence: 0.95,
            boundary_evidence: "",
            recognized_text: "厦门思明国有控股集团有限公司配售确认及缴款通知书",
            payment_date: "2026-07-21",
            amount_text: "3,000.0000 万元人民币",
            bond_short_name: "26思明国控MTN002",
            security_code: "102602143",
            prepayment_number: "",
            payer_name: "",
            payee_name: "",
            bank_reference: "",
          },
        };
      },
    },
  }, pdf, 1);
  assert.equal(result.classification, "receipt_start");
  assert.equal(result.fields.securityCode, "102602143");
  assert.match(result.recognizedText, /3,000\.0000/);
});

test("preserves an explicit continuation even when a repeated title has date and amount fields", async () => {
  const pdf = await scannedPagePdf();
  const result = await analyzePaymentReceiptPage({
    AI: {
      async run() {
        return {
          response: {
            classification: "continuation",
            confidence: 0.95,
            boundary_evidence: "repeated header on the second page",
            document_title: "某项目配售确认及缴款通知书",
            payment_date: "2026-07-21",
            amount_text: "3,000.0000 万元人民币",
            bond_short_name: "26示例MTN001",
            security_code: "102600001",
            prepayment_number: "",
            payer_name: "",
          },
        };
      },
    },
  }, pdf, 2, {
    classification: "receipt_start",
    recognizedText: "26示例MTN001",
    fields: { securityCode: "102600001" },
  });
  assert.equal(result.classification, "continuation");
});

test("starts a new receipt when an apparent continuation has a different security code", async () => {
  const pdf = await scannedPagePdf();
  const result = await analyzePaymentReceiptPage({
    AI: {
      async run() {
        return {
          response: {
            classification: "continuation",
            confidence: 0.95,
            boundary_evidence: "table content",
            document_title: "",
            payment_date: "",
            amount_text: "10,000.0000 万元人民币",
            bond_short_name: "26格力SCP001",
            security_code: "012681818",
            prepayment_number: "",
            payer_name: "",
          },
        };
      },
    },
  }, pdf, 5, {
    classification: "receipt_start",
    recognizedText: "26江西交MTN006",
    fields: { securityCode: "102682629", bondShortName: "26江西交MTN006" },
  });
  assert.equal(result.classification, "receipt_start");
});

test("does not silently split a same-identity continuation when a security code drifts", async () => {
  const pdf = await scannedPagePdf();
  const envWith = (prepaymentNumber) => ({
    AI: {
      async run() {
        return {
          response: {
            classification: "continuation",
            confidence: 0.95,
            boundary_evidence: "same bond continuation",
            document_title: "",
            payment_date: "",
            amount_text: "",
            bond_short_name: "26示例MTN001",
            security_code: "102600002",
            prepayment_number: prepaymentNumber,
            payer_name: "",
          },
        };
      },
    },
  });
  const samePrepayment = await analyzePaymentReceiptPage(envWith("W2026072100001"), pdf, 2, {
    classification: "receipt_start",
    recognizedText: "26示例MTN001",
    fields: {
      securityCode: "102600001",
      prepaymentNumber: "W2026072100001",
      bondShortName: "26示例MTN001",
    },
  });
  assert.equal(samePrepayment.classification, "continuation");

  const noPrepayment = await analyzePaymentReceiptPage(envWith(""), pdf, 2, {
    classification: "receipt_start",
    recognizedText: "26示例MTN001",
    fields: { securityCode: "102600001", bondShortName: "26示例MTN001" },
  });
  assert.equal(noPrepayment.classification, "uncertain");
});

test("repairs bond suffixes and numeric codes placed in adjacent AI fields", async () => {
  const pdf = await scannedPagePdf();
  const result = await analyzePaymentReceiptPage({
    AI: {
      async run() {
        return {
          response: {
            classification: "receipt_start",
            confidence: 0.95,
            boundary_evidence: "",
            document_title: "杭州市实业投资集团有限公司配售确认及缴款通知书",
            payment_date: "2026-07-17",
            amount_text: "30,000.0000 万元人民币",
            bond_short_name: "26杭实投",
            security_code: "SCP007",
            prepayment_number: "012681821",
            payer_name: "",
          },
        };
      },
    },
  }, pdf, 1);
  assert.equal(result.fields.bondShortName, "26杭实投 SCP007");
  assert.equal(result.fields.securityCode, "012681821");
  assert.equal(result.fields.prepaymentNumber, "");
});

test("treats a successfully OCRed empty scan as blank but keeps OCR failures uncertain", async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const blank = await analyzePaymentReceiptPage({
    AI: {
      async run() { throw new Error("primary unavailable"); },
      async toMarkdown() { return { format: "text", data: "" }; },
    },
  }, pdf, 2);
  const failed = await analyzePaymentReceiptPage({
    AI: {
      async run() { throw new Error("primary unavailable"); },
      async toMarkdown() { throw new Error("ocr unavailable"); },
    },
  }, pdf, 2);

  assert.equal(blank.classification, "blank");
  assert.equal(failed.classification, "uncertain");
});

test("extracts the full-page JPEG scan and rejects placeholder Markdown as OCR", async () => {
  const pdf = await scannedPagePdf();
  const image = await extractPaymentReceiptPageImage(pdf);
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(image.width, 2);
  assert.deepEqual([...image.bytes], [0xff, 0xd8, 0xff, 0xd9]);

  const fallback = await analyzePaymentReceiptPage({
    AI: {
      async run() { throw new Error("primary unavailable"); },
      async toMarkdown() { return { format: "text", data: "Contents\nPage 1" }; },
    },
  }, pdf, 1);
  assert.equal(fallback.classification, "uncertain");
  assert.equal(fallback.analysisSource, "unavailable");
  assert.equal(fallback.recognizedText, "");
});

test("keeps meaningful embedded-text pages as continuations only after a trusted prior page", async () => {
  const document = await PDFDocument.create();
  document.addPage([100, 100]);
  const pdf = await document.save();
  const env = {
    AI: {
      async toMarkdown() { return { format: "text", data: "账户分配信息表\n承销手续费结算明细" }; },
    },
  };
  const continuation = await analyzePaymentReceiptPage(env, pdf, 2, {
    classification: "receipt_start",
    recognizedText: "某项目配售确认及缴款通知书",
  });
  const orphan = await analyzePaymentReceiptPage(env, pdf, 1, null);
  assert.equal(continuation.classification, "continuation");
  assert.equal(orphan.classification, "uncertain");
});

test("decodes RFC 2047 payment-receipt subjects while preserving ordinary text", () => {
  assert.equal(decodePaymentReceiptSubject("=?UTF-8?B?5rWL6K+V?="), "测试");
  assert.equal(decodePaymentReceiptSubject("=?UTF-8?Q?=E7=BC=B4=E6=AC=BE=E5=8D=95?="), "缴款单");
  assert.equal(decodePaymentReceiptSubject("普通缴款邮件"), "普通缴款邮件");
});

test("builds a stable business fingerprint independent of regenerated PDF bytes", () => {
  const receipt = {
    securityCode: "283234.SH",
    payerName: "兴业银行股份有限公司资金营运中心",
    paymentDate: "2026-07-08",
    amountFen: 9_000_000_000,
  };
  assert.equal(
    paymentReceiptFingerprintMaterial(receipt, "source-a", [1]),
    paymentReceiptFingerprintMaterial(receipt, "source-b", [7]),
  );
  assert.notEqual(
    paymentReceiptFingerprintMaterial({}, "source-a", [1]),
    paymentReceiptFingerprintMaterial({}, "source-b", [1]),
  );
});

test("ships a complete receipt archive UI while preserving manual payment confirmation", async () => {
  const [html, app, styles, worker, config] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../payment-receipt-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../payment-receipt-wrangler.example.jsonc", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-view-target="payment-receipts">缴款单/);
  assert.match(html, /id="paymentReceiptArchive"/);
  assert.match(html, /id="paymentReceiptExplorerButton"[^>]*>打开文件管理器</);
  assert.match(html, /id="paymentReceiptExplorerPanel"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /缴款单 → 缴款日期 → 原始 PDF/);
  assert.match(html, /缴款状态仍由人工确认/);
  assert.match(html, /只按缴款日期归档；收件时间仅作辅助信息/);
  assert.match(html, /aria-label="按缴款日期筛选缴款单"/);
  assert.doesNotMatch(html, /按缴款日或收件日筛选缴款单/);
  assert.match(app, /renderTranchePaymentReceipts\(selectedProjectId, tranche\)/);
  assert.match(app, /entry\.value\.archiveDate \|\| "缴款日期待识别"/);
  assert.match(app, /buildPaymentReceiptOriginalFileTree\(archive\.receipts, archive\.pendingFiles\)/);
  assert.match(app, /fetchPaymentReceiptArchivePages\(\{ signal: controller\.signal \}\)/);
  assert.match(app, /paymentReceiptPendingFileUrl\(file\.fileId\)/);
  assert.match(app, /paymentReceiptExplorerTrigger/);
  assert.match(app, /未缴款（仍需人工点击）/);
  assert.match(app, /method: "PATCH"/);
  assert.match(app, /method: "DELETE"/);
  assert.match(app, /paymentReceiptSourceUrl\(receipt\.id\)/);
  assert.match(app, /paymentReceiptEmailUrl\(receipt\.id\)/);
  assert.match(app, /projectPaymentReceiptCache/);
  assert.match(app, /从全部项目中人工选择/);
  assert.match(html, /id="paymentReceiptCoverage"/);
  assert.match(app, /paymentReceiptCoverageFilter = "missing"/);
  assert.match(app, /data-receipt-coverage-filter="\$\{filter\.value\}"/);
  assert.match(app, /aria-pressed="\$\{paymentReceiptCoverageFilter === filter\.value\}"/);
  assert.match(app, /paymentReceiptCoverageFilter === "covered" && target\.covered/);
  assert.match(app, /paymentReceiptCoverageFilter === "missing" && !target\.covered/);
  assert.match(html, /id="paymentReceiptRegroupPanel"/);
  assert.match(app, /已人工确认缴款，但缺单/);
  assert.match(app, /data-receipt-regroup/);
  assert.match(app, /data-receipt-delete="\$\{escapeAttribute\(receipt\.id\)\}"/);
  assert.match(app, /\?action=delete-duplicate/);
  assert.match(app, /被判定为原件的缴款单不会删除/);
  assert.match(worker, /kind: "email"/);
  assert.match(worker, /processPaymentReceiptEmail/);
  assert.match(worker, /recordDeadLetterFailure/);
  assert.match(worker, /reconcileStalePaymentReceiptJobs/);
  assert.match(config, /"cpu_ms": 300000/);
  assert.match(config, /"crons": \["\*\/10 \* \* \* \*"\]/);
  assert.match(config, /"queue": "credit-bond-payment-receipts-dlq"/);
  assert.match(styles, /\.payment-receipt-date-group/);
  assert.match(styles, /\.payment-receipt-explorer-dialog/);
  assert.match(styles, /\.payment-receipt-explorer-icon\.folder/);
  assert.match(styles, /\.payment-receipt-explorer-icon\.pdf/);
  assert.match(styles, /\.payment-receipt-summary-filter\[aria-pressed="true"\]/);
  assert.match(styles, /\.payment-receipt-coverage-item\.covered/);
  assert.match(styles, /\.tranche-payment-receipts/);
});
