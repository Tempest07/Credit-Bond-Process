import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProtocolTransferLedgerRows,
  markProtocolTransferStep,
  parseProtocolTransferText,
  protocolTransferStatus,
  protocolTransferTodos,
} from "../protocol-transfer.js";

const sample = `申请日期：     2026年 6月10日
交易机构 1 银泰证券有限责任公司 交易方向 买入 交易商名称 银泰证券
交易机构 2 兴业银行股份有限公司 交易方向 卖出 交易商名称 兴业银行
债券代码 281926.SH
债券简称 26光交01
交易净价（元） (特定转让债券为全价) 100.659
交易数量（手） 100000
备注 本笔价格由买卖双方协商达成`;

const tradeElements = `【深圳】 4.42Y(休1)  280607.SH  25汉投03  私募债  2.0  3k  06.15交易所  兴业银行 出给 南方基金，华创证券发 101.033/101.031
南方基金 呼啸 3005263171
华创证券 吴嘉仪 3007411566
兴业银行 张夷尘 2853271332`;

const contactBridgeElements = `【深圳】 4.42Y(休1)  280607.SH  25汉投03  私募债  2.0  3k  06.15交易所  兴业银行 出给 南方基金 101.031
南方基金 呼啸 3005263171
华创证券 吴嘉仪 3007411566
兴业银行 张夷尘 2853271332`;

const internationalElements = `【国际】2.41Y  280680.SH  25联投17  私募债  1.87  5000  06.18交易所  兴业银行 出给 首创证券 100.992/100.990`;

test("parses SSE protocol transfer Word-style text", () => {
  const parsed = parseProtocolTransferText(sample, new Date("2026-06-12T09:00:00+08:00"));
  assert.equal(parsed.code, "281926.SH");
  assert.equal(parsed.shortName, "26光交01");
  assert.equal(parsed.tradeDate, "2026-06-10");
  assert.equal(parsed.buyer, "银泰证券");
  assert.equal(parsed.seller, "兴业银行");
  assert.equal(parsed.type, "商业银行");
  assert.equal(parsed.price, 100.659);
  assert.equal(parsed.amountTenThousand, 10000);
  assert.equal(parsed.quantityHands, 100000);
  assert.equal(parsed.counterpartySealDate, "2026-06-08");
  assert.equal(parsed.ownSealDate, "2026-06-09");
  assert.equal(parsed.exchangeSubmitDate, "2026-06-10");
});

test("parses chat-style protocol transfer trade elements", () => {
  const parsed = parseProtocolTransferText(tradeElements, new Date("2026-06-12T09:00:00+08:00"));
  assert.equal(parsed.code, "280607.SH");
  assert.equal(parsed.shortName, "25汉投03");
  assert.equal(parsed.tradeDate, "2026-06-15");
  assert.equal(parsed.buyer, "华创证券");
  assert.equal(parsed.seller, "兴业银行");
  assert.equal(parsed.finalBuyer, "南方基金");
  assert.equal(parsed.type, "商业银行");
  assert.equal(parsed.price, 101.031);
  assert.equal(parsed.amountTenThousand, 3000);
  assert.equal(parsed.quantityHands, 30000);
  assert.equal(parsed.counterpartySealDate, "2026-06-11");
  assert.equal(parsed.ownSealDate, "2026-06-12");
  assert.match(parsed.remarks, /深圳/);
  assert.match(parsed.remarks, /4\.42Y/);
  assert.match(parsed.remarks, /华创证券发 101\.033\/101\.031/);
  assert.doesNotMatch(parsed.remarks, /过桥费/);
  assert.match(parsed.remarks, /南方基金 呼啸 3005263171/);
});

test("uses contact list to identify the bridge party when no sent-by quote exists", () => {
  const parsed = parseProtocolTransferText(contactBridgeElements, new Date("2026-06-12T09:00:00+08:00"));

  assert.equal(parsed.buyer, "华创证券");
  assert.equal(parsed.seller, "兴业银行");
  assert.equal(parsed.finalBuyer, "南方基金");
  assert.equal(parsed.amountTenThousand, 3000);
  assert.equal(parsed.price, 101.031);
});

test("derives seal dates as T-2 and T-1 from chat-style trade dates", () => {
  const parsed = parseProtocolTransferText(internationalElements, new Date("2026-06-16T09:00:00+08:00"));

  assert.equal(parsed.tradeDate, "2026-06-18");
  assert.equal(parsed.counterpartySealDate, "2026-06-16");
  assert.equal(parsed.ownSealDate, "2026-06-17");
});

test("exports all ledger date columns as the trade date", () => {
  const rows = buildProtocolTransferLedgerRows([{
    code: "280607.SH",
    shortName: "25汉投03",
    tradeDate: "2026-06-15",
    materialFirstReceivedDate: "2026-06-12",
    materialConfirmedDate: "2026-06-11",
    buyer: "华创证券",
    seller: "兴业银行",
    price: 101.031,
    amountTenThousand: 3000,
  }]);

  assert.equal(rows[1][3], "2026-06-15");
  assert.equal(rows[1][4], "2026-06-15");
  assert.equal(rows[1][5], "2026-06-15");
  assert.equal(rows[1][7], "");
  assert.equal(rows[1][11], 30000);
});

test("leaves ledger remarks blank unless same-day trades have identical elements", () => {
  const rows = buildProtocolTransferLedgerRows([
    {
      code: "280607.SH",
      shortName: "25汉投03",
      tradeDate: "2026-06-16",
      buyer: "华创证券",
      seller: "兴业银行",
      finalBuyer: "南方基金",
      price: 101.031,
      amountTenThousand: 3000,
      remarks: "系统内备注不导出",
      createdAt: "2026-06-16T10:00:00.000Z",
    },
    {
      code: "280607.SH",
      shortName: "25汉投03",
      tradeDate: "2026-06-15",
      buyer: "华创证券",
      seller: "兴业银行",
      finalBuyer: "南方基金",
      price: 101.031,
      amountTenThousand: 3000,
      createdAt: "2026-06-15T10:00:00.000Z",
    },
    {
      code: "280607.SH",
      shortName: "25汉投03",
      tradeDate: "2026-06-15",
      buyer: "华创证券",
      seller: "兴业银行",
      finalBuyer: "南方基金",
      price: 101.031,
      amountTenThousand: 3000,
      createdAt: "2026-06-15T09:00:00.000Z",
    },
  ]);

  assert.equal(rows[1][7], "");
  assert.equal(rows[2][7], "序号2、3是两笔不同的交易");
  assert.equal(rows[3][7], "序号2、3是两笔不同的交易");
});

test("advances protocol transfer workflow by action buttons", () => {
  const parsed = parseProtocolTransferText(sample);
  assert.equal(protocolTransferStatus(parsed), "待对手方用印");

  const counterparty = markProtocolTransferStep(parsed, "counterparty");
  assert.equal(protocolTransferStatus(counterparty), "待本方用印");

  const own = markProtocolTransferStep(counterparty, "own");
  assert.equal(protocolTransferStatus(own), "待递交上交所");

  const submitted = markProtocolTransferStep(own, "submit");
  assert.equal(protocolTransferStatus(submitted), "已递交");
});

test("builds protocol transfer todos and ledger rows", () => {
  const parsed = parseProtocolTransferText(sample);
  const todos = protocolTransferTodos([parsed], new Date("2026-06-08T09:00:00+08:00"));
  assert.equal(todos[0].step.label, "对手方用印");
  assert.equal(todos[0].timing, "today");

  const rows = buildProtocolTransferLedgerRows([parsed]);
  assert.deepEqual(rows[0], ["序号", "代码", "简称", "材料首次收悉日期", "材料确认日期", "交易日", "类型", "备注", "买入方", "卖出方", "价格（全价请标注）", "数量（手）"]);
  assert.equal(rows[1][1], "281926.SH");
  assert.equal(rows[1][2], "26光交01");
  assert.equal(rows[1][8], "银泰证券");
  assert.equal(rows[1][9], "兴业银行");
});
