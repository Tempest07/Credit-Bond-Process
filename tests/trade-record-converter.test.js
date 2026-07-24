import test from "node:test";
import assert from "node:assert/strict";

import {
  TRADE_RECORD_COLUMNS,
  buildTradeRecordClipboardText,
  parseTradeRecordLine,
  parseTradeRecordText,
  tradeRecordFormula,
} from "../trade-record-converter.js";

const negotiationDate = new Date(2026, 6, 23);
const bankName = "兴业银行";

test("keeps the Trade-Phraser 19-column order", () => {
  assert.deepEqual(TRADE_RECORD_COLUMNS, [
    "谈判日",
    "交易日",
    "债券代码",
    "债券简称",
    "债券类型",
    "净价",
    "收益率(%)",
    "估值收益率",
    "我行方向",
    "面值（万元）",
    "真实交易对手",
    "交易对手",
    "组合",
    "中介",
    "清算速度(0/1)",
    "成本",
    "价差",
    "清算速度",
    "结算方式",
  ]);
});

test("parses the canonical interbank sell row exactly", () => {
  const { trade, warnings } = parseTradeRecordLine(
    "【中诚】 174D 012580499 25鄂交投SCP001 2.10 3000 03.05+0 兴业银行 出给 天弘基金",
    negotiationDate,
    bankName,
  );

  assert.deepEqual(trade, {
    谈判日: "2026-07-23",
    交易日: "2026-03-05",
    债券代码: "012580499.IB",
    债券简称: "",
    债券类型: "",
    净价: "",
    "收益率(%)": "2.10",
    估值收益率: "",
    我行方向: "卖出",
    "面值（万元）": "3000",
    真实交易对手: "天弘基金",
    交易对手: "",
    组合: "",
    中介: "中诚",
    "清算速度(0/1)": "0",
    成本: "",
    价差: "",
    清算速度: "",
    结算方式: "",
  });
  assert.deepEqual(warnings, []);
});

test("keeps exchange suffix and treats exchange date as T+1", () => {
  const { trade, warnings } = parseTradeRecordLine(
    "【国利】 1) 2.37Y(休2) 245008.SH 26创控K1 1.62 3000 06.03交易所 兴业银行 出给 工银瑞信基金",
    negotiationDate,
    bankName,
  );

  assert.equal(trade["债券代码"], "245008.SH");
  assert.equal(trade["交易日"], "2026-06-03");
  assert.equal(trade["清算速度(0/1)"], "1");
  assert.equal(trade["我行方向"], "卖出");
  assert.equal(trade["真实交易对手"], "工银瑞信基金");
  assert.equal(trade["收益率(%)"], "1.62");
  assert.equal(trade["面值（万元）"], "3000");
  assert.deepEqual(warnings, []);
});

test("parses net-price buys and amount units without inventing a yield", () => {
  const { trade, warnings } = parseTradeRecordLine(
    "【宁波】 25穗投06 243375.SH 净价100.567 2000w 6.3+0 华创证券 to 兴业银行",
    negotiationDate,
    bankName,
  );

  assert.equal(trade["我行方向"], "买入");
  assert.equal(trade["真实交易对手"], "华创证券");
  assert.equal(trade["净价"], "100.567");
  assert.equal(trade["收益率(%)"], "");
  assert.equal(trade["面值（万元）"], "2000");
  assert.equal(trade["交易日"], "2026-06-03");
  assert.equal(trade["清算速度(0/1)"], "0");
  assert.deepEqual(warnings, []);
});

test("preserves four decimal places and converts k to ten-thousand yuan", () => {
  const { trade } = parseTradeRecordLine(
    "【国利】 9.85Y 102681963.IB 26国新控股MTN002 2.1081 5k 07.24+0 兴业银行 出给 东方财富证券",
    negotiationDate,
    bankName,
  );

  assert.equal(trade["收益率(%)"], "2.1081");
  assert.equal(trade["面值（万元）"], "5000");
});

test("keeps every non-empty row and reports missing fields", () => {
  const result = parseTradeRecordText(
    "【测试】 26债券名称 1.55 兴业银行 出给 某基金\n\n012681818 1.58 4000 07.24+0 兴业银行 出给 某资管",
    negotiationDate,
    bankName,
  );

  assert.equal(result.trades.length, 2);
  assert.equal(result.diagnostics.length, 2);
  assert.match(result.diagnostics[0].message, /未识别债券代码/);
  assert.match(result.diagnostics[0].message, /未识别交易日/);
  assert.match(result.diagnostics[0].message, /未识别面值/);
  assert.match(result.diagnostics[1].message, /未识别中介/);
});

test("uses the original Wind formulas for files and clipboard output", () => {
  const { trade } = parseTradeRecordLine(
    "【中诚】 012681818 1.58 4000 07.24+0 兴业银行 出给 某资管",
    negotiationDate,
    bankName,
  );

  assert.equal(tradeRecordFormula("债券简称", 2), "@B_INFO_NAME(C2)");
  assert.equal(
    tradeRecordFormula("估值收益率", 2),
    '@IF(@B_ANAL_YIELD_CNBD(C2,A2-1,1)=0,"-",B_ANAL_YIELD_CNBD(C2,A2-1,1))',
  );

  const cells = buildTradeRecordClipboardText([trade]).split("\t");
  assert.equal(cells.length, 19);
  assert.equal(cells[3], '= @B_INFO_NAME(INDIRECT("RC[-1]",FALSE))'.replace("= ", "="));
  assert.equal(cells[4], '=B_INFO_WINDL2TYPE(INDIRECT("RC[-2]",FALSE))');
  assert.equal(
    cells[7],
    '=@IF(@B_ANAL_YIELD_CNBD(INDIRECT("RC[-5]",FALSE),INDIRECT("RC[-7]",FALSE)-1,1)=0,"-",B_ANAL_YIELD_CNBD(INDIRECT("RC[-5]",FALSE),INDIRECT("RC[-7]",FALSE)-1,1))',
  );
});
