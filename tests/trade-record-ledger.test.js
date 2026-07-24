import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTradeRecordRowsToState,
  buildTradeRecordRows,
  buildTradeRecordTableText,
  secondaryTradeRecordForOutput,
} from "../trade-record-ledger.js";

test("overlays workflow values without losing the canonical trade record", () => {
  const row = secondaryTradeRecordForOutput({
    tradeRecord: {
      谈判日: "2026-07-23",
      交易日: "2026-07-24",
      债券代码: "102681963.IB",
      "收益率(%)": "2.1081",
      我行方向: "卖出",
      "面值（万元）": "5000",
      真实交易对手: "东方财富证券",
      中介: "国利",
      "清算速度(0/1)": "0",
    },
    shortName: "26国新控股MTN002",
    account: "SDR",
    frontOfficePrice: "99.841",
  });

  assert.equal(Object.keys(row).length, 19);
  assert.equal(row["债券简称"], "26国新控股MTN002");
  assert.equal(row["净价"], "99.841");
  assert.equal(row["收益率(%)"], "2.1081");
  assert.equal(row["组合"], "SDR");
});

test("builds one shared 19-column row set for ledger and mail", () => {
  const state = {
    secondaryTrades: [{
      id: "trade-1",
      shortName: "26国新控股MTN002",
      code: "102681963.IB",
      quantityWan: 5000,
      side: "sell",
      account: "SDR",
      frontOfficeDone: true,
      frontOfficePrice: "99.841",
      tradeDate: "2026-07-24",
      ledgerDate: "2026-07-24",
      tradeRecord: {
        谈判日: "2026-07-23",
        交易日: "2026-07-24",
        债券代码: "102681963.IB",
        "收益率(%)": "2.1081",
        我行方向: "卖出",
        "面值（万元）": "5000",
        真实交易对手: "东方财富证券",
        中介: "国利",
        "清算速度(0/1)": "0",
      },
    }],
    protocolTransfers: [{
      id: "protocol-1",
      code: "280680.SH",
      shortName: "25联投17",
      tradeDate: "2026-07-24",
      buyer: "某资管",
      seller: "兴业银行",
      price: "100.99",
      amountTenThousand: 1000,
      type: "商业银行",
    }],
  };

  const rows = buildTradeRecordRows(state, "2026-07-24");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].record["债券简称"], "25联投17");
  assert.equal(rows[0].record["我行方向"], "卖出");
  assert.equal(rows[1].record["债券简称"], "26国新控股MTN002");

  const lines = buildTradeRecordTableText(rows).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split("\t").length, 19);
  assert.equal(lines[1].split("\t").length, 19);
  assert.equal(lines[2].split("\t").length, 19);
});

test("writes edited spreadsheet rows back to secondary trades and clears the sent marker", () => {
  const state = {
    secondaryTrades: [{
      id: "trade-1",
      code: "102682402.IB",
      shortName: "旧简称",
      tradeDate: "2026-07-27",
      settlementDate: "2026-07-27",
      ledgerSentAt: "2026-07-27T10:00:00.000Z",
      tradeStage: "sent",
      frontOfficeDone: true,
      tradeRecord: {
        谈判日: "2026-07-24",
        交易日: "2026-07-27",
        债券代码: "102682402.IB",
        债券简称: "旧简称",
      },
    }],
    protocolTransfers: [],
  };
  const next = applyTradeRecordRowsToState(state, [{
    id: "trade-1",
    source: "secondary",
    dirty: true,
    record: {
      谈判日: "2026-07-24",
      交易日: "2026-07-27",
      债券代码: "102682402.IB",
      债券简称: "26青岛城投MTN003",
      债券类型: "中期票据",
      净价: "100",
      "收益率(%)": "1.97",
      估值收益率: "1.955",
      我行方向: "卖出",
      "面值（万元）": "5000",
      真实交易对手: "平安资产管理",
      组合: "SDR",
      中介: "上田",
      "清算速度(0/1)": "0",
    },
    fieldSources: { 债券简称: "dm", 债券类型: "dm", 估值收益率: "dm" },
    dmLookup: { status: "complete", valuationDate: "2026-07-23", valuationField: "cbYtm" },
  }]);

  assert.equal(next.secondaryTrades[0].shortName, "26青岛城投MTN003");
  assert.equal(next.secondaryTrades[0].yieldRate, 1.97);
  assert.equal(next.secondaryTrades[0].quantityWan, 5000);
  assert.equal(next.secondaryTrades[0].tradeRecord["估值收益率"], "1.955");
  assert.equal(next.secondaryTrades[0].tradeRecordSources["估值收益率"], "dm");
  assert.equal(next.secondaryTrades[0].tradeRecordDm.valuationField, "cbYtm");
  assert.equal(next.secondaryTrades[0].ledgerSentAt, "");
  assert.equal(next.secondaryTrades[0].tradeStage, "front_office_done");
});

test("recalculates settlement date when the editable speed changes", () => {
  const state = {
    secondaryTrades: [{
      id: "trade-1",
      code: "102682402.IB",
      shortName: "测试债",
      tradeDate: "2026-07-27",
      settlementDate: "2026-07-27",
      settlementSpeed: 0,
      frontOfficeDone: true,
    }],
    protocolTransfers: [],
  };
  const next = applyTradeRecordRowsToState(state, [{
    id: "trade-1",
    source: "secondary",
    dirty: true,
    record: {
      谈判日: "2026-07-24",
      交易日: "2026-07-27",
      债券代码: "102682402.IB",
      债券简称: "测试债",
      "清算速度(0/1)": "1",
    },
  }]);

  assert.equal(next.secondaryTrades[0].settlementSpeed, 1);
  assert.equal(next.secondaryTrades[0].settlementDate, "2026-07-28");
});
