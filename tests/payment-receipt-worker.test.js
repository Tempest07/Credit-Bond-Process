import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzePaymentReceiptPage,
  finalizeBatchStatus,
  paymentReceiptFingerprintMaterial,
  paymentReceiptMessageIdConflict,
  paymentReceiptRetryDelaySeconds,
  paymentReceiptWorkerReadiness,
  recordDeadLetterFailure,
  recipientAllowed,
} from "../payment-receipt-worker.js";

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
  }, new Uint8Array([0x25, 0x50, 0x44, 0x46]), 1);

  assert.equal(request.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(request.input.response_format.json_schema.name, "payment_receipt_page");
  assert.equal(request.input.response_format.json_schema.schema.type, "object");
  assert.match(request.input.messages[0].content[1].file.file_data, /^data:application\/pdf;base64,/);
  assert.equal(result.classification, "receipt_start");
  assert.equal(result.fields.securityCode, "283234.SH");
  assert.match(result.recognizedText, /9,000万元/);
});

test("downgrades a low-confidence page to uncertain and supplies prior-page context", async () => {
  let request;
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
  }, new Uint8Array([0x25, 0x50, 0x44, 0x46]), 2, {
    classification: "receipt_start",
    recognizedText: "26示例01",
  });

  assert.equal(result.classification, "uncertain");
  assert.equal(result.confidence, 0.62);
  assert.match(request.messages[0].content[0].text, /26示例01/);
  assert.match(request.messages[0].content[0].text, /低于 0\.8/);
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
  assert.match(html, /缴款状态仍由人工确认/);
  assert.match(app, /renderTranchePaymentReceipts\(selectedProjectId, tranche\)/);
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
  assert.match(styles, /\.payment-receipt-summary-filter\[aria-pressed="true"\]/);
  assert.match(styles, /\.payment-receipt-coverage-item\.covered/);
  assert.match(styles, /\.tranche-payment-receipts/);
});
