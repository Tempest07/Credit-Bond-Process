import test from "node:test";
import assert from "node:assert/strict";

import {
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
