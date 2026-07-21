import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPaymentReceiptCoverage,
  groupPaymentReceiptPages,
  normalizePaymentReceiptPageGroups,
  recognizePaymentReceiptText,
  selectPaymentReceiptMatch,
} from "../payment-receipts.js";
import {
  listPaymentReceipts,
  listPendingPaymentReceiptBatches,
  listPendingPaymentReceiptFiles,
  readPaymentProjects,
} from "../functions/api/_payment-receipts.js";

test("archives receipts strictly by payment date without falling back to received date", async () => {
  const queries = [];
  const db = archiveListDb(queries, [{
    id: "receipt-undated",
    payment_date: "",
    received_date: "2026-07-21",
    received_at: "2026-07-21T14:00:00.000Z",
  }]);

  const [receipt] = await listPaymentReceipts(db, "admin", { date: "2026-07-17" });

  assert.match(queries[0].sql, /r\.payment_date = \?/);
  assert.doesNotMatch(queries[0].sql, /COALESCE\s*\(\s*r\.payment_date/i);
  assert.match(queries[0].sql, /r\.created_at DESC,\s*r\.id DESC/);
  assert.deepEqual(queries[0].values, ["admin", "2026-07-17", 200, 0]);
  assert.equal(receipt.archiveDate, "");
  assert.equal(receipt.receivedAt, "2026-07-21T14:00:00.000Z");
});

test("keeps files without a recognized payment date in the undated archive group", async () => {
  const fileQueries = [];
  const [file] = await listPendingPaymentReceiptFiles(archiveListDb(fileQueries, [{
    id: "file-undated",
    received_date: "2026-07-21",
    received_at: "2026-07-21T14:00:00.000Z",
  }]), "admin", { date: "2026-07-17" });
  const batchQueries = [];
  const [batch] = await listPendingPaymentReceiptBatches(archiveListDb(batchQueries, [{
    id: "batch-undated",
    received_date: "2026-07-21",
    received_at: "2026-07-21T14:00:00.000Z",
  }]), "admin", { date: "2026-07-17" });

  assert.doesNotMatch(fileQueries[0].sql, /received_date\s*=\s*\?/i);
  assert.doesNotMatch(batchQueries[0].sql, /received_date\s*=\s*\?/i);
  assert.match(fileQueries[0].sql, /f\.created_at DESC, f\.id DESC/);
  assert.match(batchQueries[0].sql, /b\.created_at DESC, b\.id DESC/);
  assert.equal(file.archiveDate, "");
  assert.equal(batch.archiveDate, "");
  assert.equal(file.receivedAt, "2026-07-21T14:00:00.000Z");
  assert.equal(batch.receivedAt, "2026-07-21T14:00:00.000Z");
});

test("reconciles receipt coverage for both manually paid and unpaid winning tranches", () => {
  const projects = [{
    id: "project-1",
    shortName: "26测试01",
    issuerName: "测试发行人",
    status: "待缴款",
    tranches: [
      { id: "paid", shortName: "26测试01A", resultStatus: "中标", paymentDate: "2026-07-21", paymentCompleted: true },
      { id: "unpaid", shortName: "26测试01B", winningAmountWan: 3000, paymentDate: "2026-07-21", paymentCompleted: false },
      { id: "lost", shortName: "26测试01C", resultStatus: "未中标", paymentDate: "2026-07-21", paymentCompleted: false },
    ],
  }];
  const result = buildPaymentReceiptCoverage(projects, [{
    projectId: "project-1",
    trancheId: "unpaid",
    receiptId: "receipt-1",
    matchSource: "auto",
  }], { date: "2026-07-21" });

  assert.equal(result.expected, 2);
  assert.equal(result.covered, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.targets.find((target) => target.trancheId === "paid")?.paymentCompleted, true);
  assert.equal(result.targets.find((target) => target.trancheId === "paid")?.covered, false);
  assert.equal(result.targets.find((target) => target.trancheId === "unpaid")?.covered, true);
  assert.equal(result.targets.some((target) => target.trancheId === "lost"), false);
});

function archiveListDb(queries, results) {
  return {
    prepare(sql) {
      const query = { sql, values: [] };
      queries.push(query);
      return {
        bind(...values) {
          query.values = values;
          return this;
        },
        async all() {
          return { results };
        },
      };
    },
  };
}

test("validates manual PDF receipt groups and keeps blank pages outside every receipt", () => {
  assert.deepEqual(normalizePaymentReceiptPageGroups({
    groups: [[2, 1], [4, 5]],
    blankPages: [3],
  }, 5), {
    groups: [[1, 2], [4, 5]],
    blankPages: [3],
  });
  assert.throws(() => normalizePaymentReceiptPageGroups({ groups: [[1, 2], [2, 3]], blankPages: [] }, 3), /重复分组/);
  assert.throws(() => normalizePaymentReceiptPageGroups({ groups: [[1]], blankPages: [3] }, 3), /尚未归类第 2 页/);
  assert.deepEqual(normalizePaymentReceiptPageGroups({ groups: [], blankPages: [1, 2] }, 2), {
    groups: [],
    blankPages: [1, 2],
  });
});

test("treats a not-yet-created project state table as an empty matching population", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first() { throw new Error("D1_ERROR: no such table: user_app_state: SQLITE_ERROR"); },
      };
    },
  };
  assert.deepEqual(await readPaymentProjects(db, "admin"), []);
});

test("recognizes investment-bank scanned notice fields expressed in ten-thousand yuan", () => {
  const result = recognizePaymentReceiptText(`
    国新融资租赁有限公司2026年度第七期超短期融资券 配售确认及缴款通知书
    债券简称：26 国新租赁 SCP007
    债券代码：012681839
    应缴款项总额：30,000.0000 万元人民币
    请将上述应缴款项于2026年07月21日16:30前划拨至主承销商指定账户。
  `);

  assert.equal(result.paymentDate, "2026-07-21");
  assert.equal(result.amountFen, 30_000_000_000);
  assert.equal(result.securityCode, "012681839");
  assert.equal(result.bondShortName, "26 国新租赁 SCP007");
});

test("recognizes broker allocation notices and exchange security codes", () => {
  const result = recognizePaymentReceiptText(`
    苏州市吴中灵天建设投资发展有限公司2026年面向专业投资者非公开发行公司债券（第二期）配售缴款通知书
    投资者名称 兴业银行股份有限公司资金营运中心
    债券简称 26灵天02 债券代码 283234.SH
    缴款金额（万元） 9,000.00
    缴款截止时间 2026年7月8日17:00前
  `);

  assert.equal(result.paymentDate, "2026-07-08");
  assert.equal(result.amountFen, 9_000_000_000);
  assert.equal(result.securityCode, "283234.SH");
  assert.equal(result.bondShortName, "26灵天02");
  assert.equal(result.payerName, "兴业银行股份有限公司资金营运中心");
});

test("recognizes the embedded-text CICC sample with spaces in the bond short name", () => {
  const result = recognizePaymentReceiptText(`
    中山城市建设集团有限公司2026年面向专业投资者公开发行公司债券（第二期）配售缴款通知书
    兴业银行股份有限公司资金营运中心：
    债券简称 26 香建 03 债券代码 524901
    获配面值（万元）5,000 缴款金额（万元）5,000
    请贵公司于2026年7月17日北京时间17:00之前，将上述获配债券对应的款项划至募集资金账户。
  `);

  assert.equal(result.paymentDate, "2026-07-17");
  assert.equal(result.amountFen, 5_000_000_000);
  assert.equal(result.securityCode, "524901");
  assert.equal(result.bondShortName, "26 香建 03");
});

test("recognizes the live allocation-table row after its column headers", () => {
  const result = recognizePaymentReceiptText(`
    保利发展控股集团股份有限公司 2026 年面向专业投资者公开发行公司债券(第五期)配售确认及缴款通知书
    债券简称 债券代码 发行规模 (万元) 期限 票面利率/价格 获配面值 (万元) 缴款金额 (万元)
    26 保利 08 245694.SH 270,000.00 5+2 年 2.20% 30,000.00 30,000.00
    请贵公司将上述应缴款项于 2026 年 07 月 17 日 15:00 前划至簿记管理人指定账户。
  `);

  assert.equal(result.paymentDate, "2026-07-17");
  assert.equal(result.amountFen, 30_000_000_000);
  assert.equal(result.securityCode, "245694.SH");
  assert.equal(result.bondShortName, "26 保利 08");
});

test("groups a mixed PDF into project receipts while retaining blank-page provenance", () => {
  const grouped = groupPaymentReceiptPages([
    { pageNumber: 1, text: "26项目A 配售缴款通知书 债券简称 26项目A01", inkRatio: 0.15 },
    { pageNumber: 2, text: "附件一：账户分配信息表", inkRatio: 0.08 },
    { pageNumber: 3, text: "", inkRatio: 0.001 },
    { pageNumber: 4, text: "26项目B 配售确认及缴款通知书 债券代码 012681888", inkRatio: 0.16 },
    { pageNumber: 5, text: "联系人及募集账户信息", inkRatio: 0.07 },
  ]);

  assert.deepEqual(grouped.blankPages, [3]);
  assert.equal(grouped.groups.length, 2);
  assert.deepEqual(grouped.groups[0].pageNumbers, [1, 2]);
  assert.equal(grouped.groups[0].pageLabel, "1-2");
  assert.deepEqual(grouped.groups[1].pageNumbers, [4, 5]);
  assert.equal(grouped.groups[1].pageLabel, "4-5");
});

test("covers all three supplied sample page shapes", () => {
  const investmentBank = groupPaymentReceiptPages([
    { pageNumber: 1, text: "国新融资租赁2026年度第七期超短期融资券配售确认及缴款通知书 债券简称 26国新租赁SCP007", startsReceipt: true },
    { pageNumber: 2, text: "", isBlank: true },
  ]);
  const brokerThreePages = groupPaymentReceiptPages([
    { pageNumber: 1, text: "中山城市建设集团公司债券配售缴款通知书 债券简称 26香建03", startsReceipt: true },
    { pageNumber: 2, text: "同时，为尽快办理债券登记业务", startsReceipt: false },
    { pageNumber: 3, text: "获配金额分配信息表", startsReceipt: false },
  ]);
  const brokerTwoPages = groupPaymentReceiptPages([
    { pageNumber: 1, text: "苏州市吴中灵天建设投资发展有限公司配售缴款通知书 债券简称 26灵天02", startsReceipt: true },
    { pageNumber: 2, text: "附件一：认购账户表", startsReceipt: false },
  ]);

  assert.deepEqual(investmentBank.blankPages, [2]);
  assert.deepEqual(investmentBank.groups.map((group) => group.pageNumbers), [[1]]);
  assert.deepEqual(brokerThreePages.groups.map((group) => group.pageNumbers), [[1, 2, 3]]);
  assert.deepEqual(brokerTwoPages.groups.map((group) => group.pageNumbers), [[1, 2]]);
});

test("never lets an AI start label split obvious attachment and allocation-table pages", () => {
  const grouped = groupPaymentReceiptPages([
    { pageNumber: 1, text: "26香建03 配售缴款通知书 债券简称 26香建03", startsReceipt: true },
    { pageNumber: 2, text: "附件一：认购账户表", startsReceipt: true },
    { pageNumber: 3, text: "中山城市建设集团债券（第二期）获配金额分配信息表", startsReceipt: true },
  ]);

  assert.deepEqual(grouped.groups.map((group) => group.pageNumbers), [[1, 2, 3]]);
});

test("keeps a valid scanned page and drops an explicitly detected blank scan", () => {
  const grouped = groupPaymentReceiptPages([
    { pageNumber: 1, text: "", inkRatio: 0.14, startsReceipt: true },
    { pageNumber: 2, text: "", inkRatio: 0.002 },
  ]);

  assert.deepEqual(grouped.blankPages, [2]);
  assert.deepEqual(grouped.groups[0].pageNumbers, [1]);
});

test("retains explicitly uncertain pages for review instead of treating them as blank", () => {
  const grouped = groupPaymentReceiptPages([
    { pageNumber: 1, text: "26示例01 配售缴款通知书 债券简称 26示例01", startsReceipt: true },
    { pageNumber: 2, text: "边界与文字均不清晰", classification: "uncertain" },
    { pageNumber: 3, text: "", classification: "blank" },
  ]);

  assert.deepEqual(grouped.uncertainPages, [2]);
  assert.deepEqual(grouped.blankPages, [3]);
  assert.deepEqual(grouped.groups[0].pageNumbers, [1, 2]);
});

test("automatically matches both unpaid and paid candidate populations without changing payment state", () => {
  const projects = [
    {
      id: "project-paid",
      shortName: "26香建03",
      issuerName: "中山城市建设集团有限公司",
      tranches: [{
        id: "tranche-paid",
        shortName: "26香建03",
        securityCode: "524901",
        winningAmountWan: 5_000,
        paymentDate: "2026-07-17",
        paymentCompleted: true,
      }],
    },
    {
      id: "project-unpaid",
      shortName: "26灵天02",
      issuerName: "苏州市吴中灵天建设投资发展有限公司",
      tranches: [{
        id: "tranche-unpaid",
        shortName: "26灵天02",
        securityCode: "283234.SH",
        winningAmountWan: 9_000,
        paymentDate: "2026-07-08",
        paymentCompleted: false,
      }],
    },
  ];
  const before = structuredClone(projects);

  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-08",
    amountFen: 9_000_000_000,
    securityCode: "283234.SH",
    bondShortName: "26灵天02",
    recognizedText: "债券简称 26灵天02 债券代码 283234.SH 缴款金额9000万元",
  }, projects);

  assert.equal(result.status, "matched");
  assert.equal(result.projectId, "project-unpaid");
  assert.equal(result.trancheId, "tranche-unpaid");
  assert.deepEqual(projects, before);
  assert.equal(projects[1].tranches[0].paymentCompleted, false);
});

test("auto-matches a unique same-day short-name and issuer pair even when the OCR amount is wrong", () => {
  const projects = [{
    id: "project-poly",
    shortName: "26保利07/08",
    issuerName: "保利发展控股集团股份有限公司",
    tranches: [
      {
        id: "tranche-07",
        shortName: "26保利07",
        winningAmountWan: 0,
        paymentDate: "2026-07-17",
        paymentCompleted: false,
      },
      {
        id: "tranche-08",
        shortName: "26保利08",
        winningAmountWan: 30_000,
        paymentDate: "2026-07-17",
        paymentCompleted: true,
      },
    ],
  }];
  const before = structuredClone(projects);

  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-17",
    amountFen: 26_000_000,
    bondShortName: "26保利08",
    recognizedText: "保利发展控股集团股份有限公司 债券简称 26保利08",
  }, projects);

  assert.equal(result.status, "matched");
  assert.equal(result.projectId, "project-poly");
  assert.equal(result.trancheId, "tranche-08");
  assert.deepEqual(projects, before);
  assert.equal(projects[0].tranches[0].paymentCompleted, false);
  assert.equal(projects[0].tranches[1].paymentCompleted, true);
});

test("auto-matches a standard bond short name with a conservative issuer abbreviation", () => {
  const projects = [{
    id: "project-yuexiu",
    shortName: "26越秀租赁SCP005",
    issuerName: "广州越秀融资租赁有限公司",
    tranches: [{
      id: "tranche-yuexiu",
      shortName: "26越秀租赁SCP005",
      winningAmountWan: 18_000,
      paymentDate: "2026-07-21",
      paymentCompleted: true,
    }],
  }];
  const before = structuredClone(projects);

  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-21",
    amountFen: 18_000_000_000,
    bondShortName: "26越秀租SCP005",
    recognizedText: "债券简称 26越秀租SCP005 缴款金额 18,000 万元",
  }, projects);

  assert.equal(result.status, "matched");
  assert.equal(result.projectId, "project-yuexiu");
  assert.equal(result.trancheId, "tranche-yuexiu");
  assert.deepEqual(projects, before);
  assert.equal(projects[0].tranches[0].paymentCompleted, true);
});

test("does not treat a different issuer stem as a short-name abbreviation", () => {
  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-21",
    amountFen: 18_000_000_000,
    bondShortName: "26越秀资本SCP005",
    recognizedText: "债券简称 26越秀资本SCP005 缴款金额 18,000 万元",
  }, [{
    id: "project-yuexiu-lease",
    shortName: "26越秀租赁SCP005",
    tranches: [{
      id: "tranche-yuexiu-lease",
      shortName: "26越秀租赁SCP005",
      winningAmountWan: 18_000,
      paymentDate: "2026-07-21",
      paymentCompleted: false,
    }],
  }]);

  assert.equal(result.status, "review");
  assert.equal(result.projectId, "");
  assert.equal(result.trancheId, "");
  assert.equal(result.candidates[0].signals.shortName, false);
});

test("requires corroboration before auto-matching an abbreviated short name", () => {
  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-21",
    bondShortName: "26高新发展MTN001",
    recognizedText: "债券简称 26高新发展MTN001",
  }, [{
    id: "project-shanghai-high-tech",
    shortName: "26上海高新发展MTN001",
    tranches: [{
      id: "tranche-shanghai-high-tech",
      shortName: "26上海高新发展MTN001",
      winningAmountWan: 5_000,
      paymentDate: "2026-07-21",
      paymentCompleted: false,
    }],
  }]);

  assert.equal(result.status, "review");
  assert.equal(result.projectId, "");
  assert.equal(result.trancheId, "");
  assert.equal(result.candidates[0].signals.abbreviatedShortName, true);
  assert.equal(result.candidates[0].signals.amount, false);
});

test("does not auto-match two same-day projects from amount alone", () => {
  const projects = ["a", "b"].map((suffix) => ({
    id: `project-${suffix}`,
    shortName: `26测试0${suffix}`,
    tranches: [{
      id: `tranche-${suffix}`,
      shortName: `26测试0${suffix}`,
      winningAmountWan: 1_000,
      paymentDate: "2026-07-21",
      paymentCompleted: suffix === "a",
    }],
  }));

  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-21",
    amountFen: 1_000_000_000,
    recognizedText: "缴款金额 1000 万元",
  }, projects);

  assert.equal(result.status, "review");
  assert.equal(result.projectId, "");
  assert.equal(result.trancheId, "");
  assert.equal(result.candidates.length, 2);
});

test("lets an exact security code recover from an incorrectly recognized payment date", () => {
  const result = selectPaymentReceiptMatch({
    paymentDate: "2026-07-20",
    securityCode: "012681839",
    recognizedText: "债券代码 012681839",
  }, [{
    id: "project-identifier",
    shortName: "26国新租赁SCP007",
    tranches: [{
      id: "tranche-identifier",
      shortName: "26国新租赁SCP007",
      securityCode: "012681839",
      paymentDate: "2026-07-21",
      paymentCompleted: false,
    }],
  }]);

  assert.equal(result.status, "matched");
  assert.equal(result.projectId, "project-identifier");
  assert.equal(result.trancheId, "tranche-identifier");
});
