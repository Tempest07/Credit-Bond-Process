import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBrokerSellList,
  buildDailySecondaryTradeSummary,
  buildSecondaryTradeLedgerRows,
  markSecondaryTradeAction,
  parseSecondaryTradeBatch,
  parseSecondaryTradeText,
  secondaryTradeTodos,
  standardizeSecondaryTradeText,
} from "../secondary-trading.js";

test("parses a morning sell listing line", () => {
  const parsed = parseSecondaryTradeText(
    "102682132.IB 26珠海正方MTN001 SDR 卖出5000万 1.83% 中信证券 T+1",
    { kind: "listing", referenceDate: new Date("2026-06-14T09:00:00+08:00") },
  );

  assert.equal(parsed.code, "102682132.IB");
  assert.equal(parsed.shortName, "26珠海正方MTN001");
  assert.equal(parsed.direction, "卖出");
  assert.equal(parsed.account, "SDR");
  assert.equal(parsed.status, "拟挂卖");
  assert.equal(parsed.amountWan, 5000);
  assert.equal(parsed.price, 1.83);
  assert.equal(parsed.priceType, "收益率");
  assert.equal(parsed.broker, "中信证券");
  assert.equal(parsed.settlementDate, "");
});

test("parses an executed secondary trade with default T+1 settlement", () => {
  const parsed = parseSecondaryTradeText(
    "26珠海正方MTN001 卖出 1.2亿 1.82 中信证券 成交",
    { kind: "trade", referenceDate: new Date("2026-06-15T10:00:00+08:00") },
  );

  assert.equal(parsed.direction, "卖出");
  assert.equal(parsed.status, "待交割");
  assert.equal(parsed.tradeDate, "2026-06-15");
  assert.equal(parsed.settlementDate, "2026-06-16");
  assert.equal(parsed.amountWan, 12000);
  assert.equal(parsed.price, 1.82);
});

test("parses batch lines and ignores contact noise", () => {
  const parsed = parseSecondaryTradeBatch(`102682132.IB 26珠海正方MTN001 SDR 卖出5000万 1.83% 中信证券
联系人 张三 13800000000
012681422.IB 26远东租赁SCP005 TX 买入3000万 1.45 任务内收券`, {
    kind: "trade",
    referenceDate: new Date("2026-06-15T10:00:00+08:00"),
  });

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].shortName, "26珠海正方MTN001");
  assert.equal(parsed[1].direction, "买入");
  assert.equal(parsed[1].account, "TX");
  assert.equal(parsed[1].isTaskPurchase, true);
});

test("builds settlement todos and advances action status", () => {
  const parsed = parseSecondaryTradeText("26珠海正方MTN001 卖出 5000万 1.82 成交", {
    kind: "trade",
    referenceDate: new Date("2026-06-15T10:00:00+08:00"),
  });

  const todos = secondaryTradeTodos([parsed], new Date("2026-06-16T09:00:00+08:00"));
  assert.equal(todos[0].step.label, "交割");
  assert.equal(todos[0].timing, "today");

  const settled = markSecondaryTradeAction(parsed, "settled");
  assert.equal(settled.status, "已交割");
  assert.equal(secondaryTradeTodos([settled], new Date("2026-06-16T09:00:00+08:00")).length, 0);
});

test("builds broker sell list, daily summary and ledger rows", () => {
  const listing = parseSecondaryTradeText("102682132.IB 26珠海正方MTN001 SDR 卖出5000万 1.83% 中信证券", {
    kind: "listing",
    referenceDate: new Date("2026-06-15T10:00:00+08:00"),
  });
  const deal = parseSecondaryTradeText("012681422.IB 26远东租赁SCP005 TX 买入3000万 1.45 任务内收券", {
    kind: "trade",
    referenceDate: new Date("2026-06-15T10:00:00+08:00"),
  });

  assert.match(buildBrokerSellList([listing], "2026-06-15"), /今日挂卖|2026\/06\/15挂卖/);
  assert.match(buildBrokerSellList([listing], "2026-06-15"), /26珠海正方MTN001/);
  assert.match(buildDailySecondaryTradeSummary([deal], "2026-06-15"), /任务内收券/);
  assert.match(standardizeSecondaryTradeText(deal), /二级成交/);

  const rows = buildSecondaryTradeLedgerRows([listing, deal]);
  assert.deepEqual(rows[0].slice(0, 6), ["序号", "交易日", "交割日", "状态", "方向", "组合"]);
  assert.equal(rows.length, 3);
});
