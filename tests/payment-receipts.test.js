import test from "node:test";
import assert from "node:assert/strict";
import { prepareStoredState, StateStorageError } from "../state-storage.js";

import {
  applyPaymentReceiptArchiveMutation,
  applyPaymentReceiptCoverageMutation,
  buildPaymentReceiptOriginalFileTree,
  buildPaymentReceiptCoverage,
  groupPaymentReceiptPages,
  normalizePaymentReceiptPageGroups,
  recognizePaymentReceiptText,
  selectPaymentReceiptMatch,
} from "../payment-receipts.js";

test('an OCR code coinciding with another bond cannot override three contradictory business fields', () => {
  const projects = [{id:'yuexin',shortName:'26越新G1',tranches:[{id:'g1',shortName:'26越新G1',
    securityCode:'524963.SZ',paymentDate:'2026-07-24',winningAmountWan:4000}]}];
  const receipt = {bondShortName:'26越租G2',securityCode:'524963.SZ',paymentDate:'2026-08-05',amountFen:1_000_000_000};
  const result = selectPaymentReceiptMatch(receipt, projects);
  assert.equal(result.status,'review');
  assert.equal(result.projectId,'');
  assert.equal(result.candidates[0].businessIdentityConflict,true);
  assert.match(result.reason,/简称、缴款日期和金额/);
  assert.equal(selectPaymentReceiptMatch({...receipt,bondShortName:'26越新G1'},projects).status,'matched');
});

test('a visually confirmed seal continuation needs no repeated business text, while an unreadable page remains uncertain', () => {
  const start = {pageNumber:1,text:'债券简称 26粤海水务01 债券代码524962.SZ',startsReceipt:true};
  const sealed = groupPaymentReceiptPages([start,{pageNumber:2,text:'',classification:'continuation',startsReceipt:false}]);
  assert.deepEqual(sealed.groups.map(group=>group.pageNumbers),[[1,2]]);
  assert.deepEqual(sealed.uncertainPages,[]);
  const unknown = groupPaymentReceiptPages([start,{pageNumber:2,text:'',classification:'uncertain',startsReceipt:false}]);
  assert.deepEqual(unknown.uncertainPages,[2]);
});

test("updates a receipt action locally while honoring the active archive filters", () => {
  const before = [
    { id: "receipt-1", fileId: "file-1", paymentDate: "2026-07-21", matchStatus: "review", createdAt: "2026-07-21T10:00:00Z" },
    { id: "receipt-2", fileId: "file-2", paymentDate: "2026-07-21", matchStatus: "review", createdAt: "2026-07-21T09:00:00Z" },
  ];
  const matched = {
    ...before[0],
    matchStatus: "matched",
    projectId: "project-1",
    trancheId: "tranche-1",
  };

  assert.deepEqual(applyPaymentReceiptArchiveMutation(before, {
    removedReceiptIds: ["receipt-1"],
    receipts: [matched],
  }, { date: "2026-07-21", status: "review" }).map((receipt) => receipt.id), ["receipt-2"]);
  assert.deepEqual(applyPaymentReceiptArchiveMutation(before, {
    removedReceiptIds: ["receipt-1"],
    receipts: [matched],
  }, { date: "2026-07-21" }).map((receipt) => receipt.id), ["receipt-1", "receipt-2"]);
});

test("moves receipt coverage locally without refetching the archive", () => {
  const coverage = {
    expected: 2,
    covered: 1,
    missing: 1,
    targets: [
      { projectId: "project-old", trancheId: "tranche-old", receiptId: "receipt-1", matchSource: "manual", covered: true },
      { projectId: "project-new", trancheId: "tranche-new", receiptId: "", matchSource: "", covered: false },
    ],
  };
  const updated = applyPaymentReceiptCoverageMutation(coverage, {
    removedReceiptIds: ["receipt-1"],
    receipts: [{
      id: "receipt-1",
      projectId: "project-new",
      trancheId: "tranche-new",
      matchStatus: "matched",
      matchSource: "manual",
    }],
  });

  assert.equal(updated.covered, 1);
  assert.equal(updated.missing, 1);
  assert.equal(updated.targets[0].covered, false);
  assert.equal(updated.targets[1].covered, true);
  assert.equal(updated.targets[1].receiptId, "receipt-1");
});
import {
  assignPaymentReceipt,
  listPaymentReceipts,
  listPendingPaymentReceiptBatches,
  listPendingPaymentReceiptFiles,
  readPaymentProjects,
} from "../functions/api/_payment-receipts.js";

test("manual receipt assignment backfills the selected tranche payment date", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          this.values = values;
          return this;
        },
      };
    },
    async batch(items) {
      statements.push(...items);
      return items.map(() => ({ meta: { changes: 1 } }));
    },
  };
  await assignPaymentReceipt(db, {
    ownerUserId: "admin",
    receiptId: "receipt-1",
    projectId: "project-1",
    trancheId: "tranche-1",
    paymentDate: "2026-07-23",
  });
  const update = statements.find((statement) => /SET payment_date/i.test(statement.sql));
  assert.equal(update.values[0], "2026-07-23");
  assert.match(update.sql, /match_status = 'matched'/);
});

test("builds an Explorer-style original PDF tree by payment date and file id", () => {
  const tree = buildPaymentReceiptOriginalFileTree([
    { id: "r1", fileId: "file-a", sourceFilename: "合并缴款单.pdf", paymentDate: "2026-07-22", sourcePageLabel: "1", receivedAt: "2026-07-22T09:00:00Z" },
    { id: "r2", fileId: "file-a", sourceFilename: "合并缴款单.pdf", paymentDate: "2026-07-22", sourcePageLabel: "2-3", receivedAt: "2026-07-22T09:00:00Z" },
    { id: "r3", fileId: "file-a", sourceFilename: "合并缴款单.pdf", paymentDate: "2026-07-21", sourcePageLabel: "4", receivedAt: "2026-07-22T09:00:00Z" },
    { id: "r4", fileId: "file-a", sourceFilename: "合并缴款单.pdf", paymentDate: "", archiveDate: "2026-07-20", sourcePageLabel: "5", receivedAt: "2026-07-22T09:00:00Z" },
    { id: "r5", fileId: "file-b", sourceFilename: "合并缴款单.pdf", paymentDate: "2026-07-22", sourcePageLabel: "1" },
    { id: "ignored", fileId: "", sourceFilename: "无文件标识.pdf", paymentDate: "2026-07-22" },
  ], [
    { id: "file-pending", sourceFilename: "待识别原件", mimeType: "application/pdf", pageCount: 6, receivedAt: "2026-07-22T10:00:00Z" },
    { id: "not-pdf", sourceFilename: "说明.txt", mimeType: "text/plain" },
  ]);

  assert.equal(tree.rootLabel, "缴款单");
  assert.equal(tree.physicalFileCount, 3);
  assert.equal(tree.folderReferenceCount, 5);
  assert.deepEqual(tree.folders.map((folder) => folder.label), ["2026-07-22", "2026-07-21", "缴款日期待识别"]);
  const july22 = tree.folders[0];
  assert.equal(july22.fileCount, 2);
  assert.deepEqual(july22.files.map((file) => file.fileId), ["file-a", "file-b"]);
  assert.equal(july22.files[0].receiptCount, 2);
  assert.deepEqual(july22.files[0].sourcePageLabels, ["1", "2-3"]);
  assert.deepEqual(july22.files[0].otherPaymentDates, ["2026-07-21", "缴款日期待识别"]);
  const undated = tree.folders[2];
  assert.deepEqual(undated.files.map((file) => file.fileId), ["file-pending", "file-a"]);
  assert.equal(undated.files[0].name, "待识别原件.pdf");
  assert.equal(undated.files[0].pageCount, 6);
  assert.equal(undated.files.some((file) => file.fileId === "not-pdf"), false);
});

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

test("receipt matching reads existing projects and preserves missing-row behavior", async () => {
  const projects = [{ id: "existing", targetQuoteNote: "保留备注", tranches: [{ id: "tranche", winningAmountWan: 3000 }] }];
  for (const [row, expected] of [[{ data: JSON.stringify({ projects }) }, projects], [null, []]]) {
    const db = { prepare: () => ({ bind() { return this; }, async first() { return row; } }) };
    assert.deepEqual(await readPaymentProjects(db, "admin"), expected);
  }
});

test("receipt matching does not hide corrupt state or database errors as an empty population", async () => {
  const corruptDb = { prepare: () => ({ bind() { return this; }, async first() { return { data: "{broken" }; } }) };
  await assert.rejects(readPaymentProjects(corruptDb, "admin"));
  const unavailableDb = { prepare: () => ({ bind() { return this; }, async first() { throw new Error("D1_ERROR: database unavailable"); } }) };
  await assert.rejects(readPaymentProjects(unavailableDb, "admin"), /database unavailable/);
});

test("receipt matching reads projects and tranche details from a multi-chunk state", async () => {
  const projects = [{ id: "project-original", targetQuoteNote: "保留备注", tranches: [{ id: "tranche", winningAmountWan: 3000 }] }];
  const storage = await prepareStoredState(JSON.stringify({ projects, originalSource: "原始资料".repeat(120_000) }));
  assert.ok(storage.chunks.length > 1);
  assert.deepEqual(await readPaymentProjects(receiptChunkDb(storage), "admin"), projects);
});

test("receipt matching rejects incomplete or corrupted chunks rather than reporting no matches", async () => {
  const storage = await prepareStoredState(JSON.stringify({ projects: [], originalSource: "原始资料".repeat(120_000) }));
  await assert.rejects(readPaymentProjects(receiptChunkDb(storage, storage.chunks.slice(1)), "admin"), StateStorageError);
  const corrupted = storage.chunks.map((chunk, index) => index === 0 ? chunk.replace("原", "旧") : chunk);
  await assert.rejects(readPaymentProjects(receiptChunkDb(storage, corrupted), "admin"), StateStorageError);
});

function receiptChunkDb(storage, chunks = storage.chunks) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM user_app_state\b/i);
      return {
        bind(owner) { assert.equal(owner, "admin"); return this; },
        async first() { return { data: storage.serialized }; },
        async all() {
          assert.match(sql, /LEFT JOIN app_state_chunks/);
          return { results: chunks.map((chunk_data, chunk_index) => ({ data: storage.serialized, chunk_index, chunk_data })) };
        },
      };
    },
  };
}

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
  assert.equal(result.bondShortName, "26国新租赁SCP007");
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
  assert.equal(result.bondShortName, "26香建03");
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
  assert.equal(result.bondShortName, "26保利08");
});

test("explicit receipt short names take precedence over truncated AI fallback and preserve qualifiers", () => {
  const result = recognizePaymentReceiptText("债券简称 26越秀租赁MTN002B（绿色）\n债券代码102683999\n缴款金额3000万元", {
    bondShortName: "26越秀租MTN002B", securityCode: "102683999",
  });
  assert.equal(result.bondShortName, "26越秀租赁MTN002B(绿色)");
});

test("a valid payment-project fallback remains usable but legal full titles are never abbreviated by guesswork", () => {
  assert.equal(recognizePaymentReceiptText("缴款项目 26 测试 MTN001\n缴款金额1000万元").bondShortName, "26测试MTN001");
  assert.equal(recognizePaymentReceiptText("债券简称 某某有限公司2026年度第一期中期票据").bondShortName, "");
});

test("receipt recognition preserves the same name, code and amount for either field order", () => {
  for (const fields of [
    ['债券代码246129.SH', '债券简称26测试01'],
    ['债券简称26测试01', '债券代码246129.SH'],
  ]) {
    const text = fields.join('\n') + '\n缴款日期2026-10-26\n缴款金额1000万元';
    for (const fallback of [{}, { bondShortName: '26测试01', securityCode: '246129.SH' }]) {
      const result = recognizePaymentReceiptText(text, fallback);
      assert.equal(result.bondShortName, '26测试01');
      assert.equal(result.securityCode, '246129.SH');
      assert.equal(result.paymentDate, '2026-10-26');
      assert.equal(result.amountFen, 1_000_000_000);
    }
    assert.equal(recognizePaymentReceiptText(text, { bondShortName: '26测试01', securityCode: '246130.SH' }).bondShortName, '');
  }
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

test("archives a clearly different issuer stem instead of suggesting an unrelated same-amount project", () => {
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

  assert.equal(result.status, "unmatched");
  assert.equal(result.projectId, "");
  assert.equal(result.trancheId, "");
  assert.deepEqual(result.candidates, []);
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

test('a different security or market vetoes automatic correspondence despite all other matching signals', () => {
  const projects = [{ id: 'p', shortName: '26测试01', tranches: [{ id: 't', shortName: '26测试01',
    securityCode: '246129.SH', paymentDate: '2026-10-26', winningAmountWan: 1000, prepaymentNumber: 'W2026102600001' }] }];
  for (const securityCode of ['246130.SH', '246129.SZ']) {
    const receipt = { bondShortName: '26测试01', securityCode, paymentDate: '2026-10-26', amountFen: 1_000_000_000,
      prepaymentNumber: 'W2026102600001' };
    const before = JSON.stringify([receipt, projects]);
    const result = selectPaymentReceiptMatch(receipt, projects);
    assert.equal(result.status, 'review'); assert.equal(result.projectId, ''); assert.equal(result.trancheId, '');
    assert.match(result.reason, /代码|市场/);
    assert.equal(result.candidates[0].securityCodeConflict, true);
    assert.equal(result.candidates[0].signals.prepaymentNumber, true, 'even the prepayment number cannot override a conflicting code');
    assert.equal(JSON.stringify([receipt, projects]), before);
  }
});

test('structured and labelled source securities must agree before automatic matching', () => {
  const makeProject = securityCode => [{ id: 'p', shortName: '26测试01', tranches: [{ id: 't', shortName: '26测试01',
    securityCode, paymentDate: '2026-10-26', winningAmountWan: 1000 }] }];
  for (const targetCode of ['246129.SH', '246130.SH', '246129.SZ']) {
    const result = selectPaymentReceiptMatch({ bondShortName: '26测试01', securityCode: '246129.SH',
      paymentDate: '2026-10-26', amountFen: 1_000_000_000, recognizedText: '证券代码246130.SH' }, makeProject(targetCode));
    assert.equal(result.status, 'review', targetCode);
    assert.equal(result.projectId, '');
  }
  const rawOnly = selectPaymentReceiptMatch({ bondShortName: '26测试01', recognizedText: '证券代码246130.SH',
    paymentDate: '2026-10-26', amountFen: 1_000_000_000 }, makeProject('246129.SH'));
  assert.equal(rawOnly.status, 'review');
  const mixedMarkets = selectPaymentReceiptMatch({ bondShortName: '26测试01', securityCode: '246129',
    recognizedText: '债券代码246129.SH\n证券代码246129.SZ', paymentDate: '2026-10-26', amountFen: 1_000_000_000 }, makeProject('246129'));
  assert.equal(mixedMarkets.status, 'review');
  for (const code of ['246129 . SH', '246129. SH', '246129 .SH', '２４６１２９ ． ＳＨ']) {
    const receipt = { bondShortName: '26测试01', paymentDate: '2026-10-26', amountFen: 1_000_000_000,
      recognizedText: `债券简称26测试01\n债券代码${code}\n缴款金额1000万元` };
    assert.equal(selectPaymentReceiptMatch(receipt, makeProject('246129.SZ')).status, 'review', code);
    assert.equal(selectPaymentReceiptMatch(receipt, makeProject('246129.SH')).status, 'matched', code);
  }
});

test('missing suffixes stay compatible while exact code signals never come from account substrings', () => {
  const project = securityCode => [{ id: 'p', tranches: [{ id: 't', shortName: '26测试SCP001', securityCode,
    paymentDate: '2026-10-26', winningAmountWan: 1000 }] }];
  for (const [receiptCode, targetCode] of [['012682531', '012682531.IB'], ['246129.SH', '246129'], ['２４６１２９．ＳＨ', '246129.SH']]) {
    const result = selectPaymentReceiptMatch({ securityCode: receiptCode, paymentDate: '2026-10-25' }, project(targetCode));
    assert.equal(result.status, 'matched'); assert.equal(result.candidates[0].signals.securityCode, true);
  }
  for (const [receiptCode, targetCode] of [['012682531', '12682531'], ['123456789', '123456']]) {
    assert.notEqual(selectPaymentReceiptMatch({ securityCode: receiptCode, bondShortName: '26测试SCP001',
      paymentDate: '2026-10-26', amountFen: 1_000_000_000 }, project(targetCode)).status, 'matched');
  }
  const account = selectPaymentReceiptMatch({ recognizedText: '银行账号6222123456789012', paymentDate: '2026-10-25' }, project('123456'));
  assert.notEqual(account.status, 'matched');
  assert.equal(selectPaymentReceiptMatch({ bondShortName: '26测试SCP001', paymentDate: '2026-10-26',
    amountFen: 1_000_000_000 }, project('')).status, 'matched', 'absence of codes is not an explicit conflict');
});

test('multi-tranche projects compare each security independently and code conflicts cannot win by a larger score', () => {
  const projects = [{ id: 'p', shortName: '26测试01/02', tranches: [
    { id: 'a', shortName: '26测试01', securityCode: '246129.SH', paymentDate: '2026-10-26', winningAmountWan: 1000 },
    { id: 'b', shortName: '26测试02', securityCode: '246130.SH', paymentDate: '2026-10-26', winningAmountWan: 1000 },
  ] }];
  for (const [securityCode, trancheId] of [['246129.SH', 'a'], ['246130.SH', 'b']]) {
    const result = selectPaymentReceiptMatch({ securityCode, paymentDate: '2026-10-26', amountFen: 1_000_000_000 }, projects);
    assert.equal(result.status, 'matched'); assert.equal(result.trancheId, trancheId);
  }
  projects[0].tranches[0].securityCode = '';
  projects[0].tranches[1].prepaymentNumber = 'W2026102600001';
  const result = selectPaymentReceiptMatch({ securityCode: '246129.SH', bondShortName: '26测试01',
    paymentDate: '2026-10-26', amountFen: 1_000_000_000, prepaymentNumber: 'W2026102600001' }, projects);
  assert.equal(result.status, 'matched'); assert.equal(result.trancheId, 'a');
});
