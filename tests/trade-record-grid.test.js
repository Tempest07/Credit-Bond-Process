import assert from "node:assert/strict";
import test from "node:test";
import { TRADE_RECORD_COLUMNS } from "../trade-record-converter.js";

import {
  cloneTradeRecordDraftRows,
  createTradeRecordDraftRows,
  mergeTradeRecordDmResults,
  pasteTradeRecordDraftCells,
  isTradeRecordCellValueValid,
  tradeRecordDmRequestRows,
  updateTradeRecordDraftCell,
  validateTradeRecordDraftRows,
} from "../trade-record-grid.js";

function draftRows() {
  return createTradeRecordDraftRows([
    {
      id: "one",
      source: "secondary",
      record: {
        谈判日: "2026-07-24",
        交易日: "2026-07-27",
        债券代码: "102682206.IB",
        债券简称: "",
        债券类型: "",
        估值收益率: "",
      },
    },
    {
      id: "two",
      source: "secondary",
      record: {
        谈判日: "2026-07-24",
        交易日: "2026-07-27",
        债券代码: "102682402.IB",
      },
    },
  ]);
}

test("edits one spreadsheet cell and protects manual values from DM refresh", () => {
  let rows = draftRows();
  rows = updateTradeRecordDraftCell(rows, {
    key: "secondary:one",
    column: "债券简称",
    value: "人工简称",
  });
  rows = mergeTradeRecordDmResults(rows, [{
    id: "secondary:one",
    securityId: "102682206.IB",
    shortName: "DM简称",
    bondType: "中期票据",
    valuationYield: 1.955,
    requestedDate: "2026-07-23",
    valuationDate: "2026-07-23",
    valuationField: "cbYtm",
    status: "complete",
  }]);

  assert.equal(rows[0].record["债券简称"], "人工简称");
  assert.equal(rows[0].fieldSources["债券简称"], "manual");
  assert.equal(rows[0].record["债券类型"], "中期票据");
  assert.equal(rows[0].fieldSources["债券类型"], "dm");
  assert.equal(rows[0].record["估值收益率"], "1.955");
  assert.equal(rows[0].dmLookup.valuationField, "cbYtm");
  assert.equal(rows[0].dirty, true);
});

test("pastes a rectangular TSV block without growing past existing ledger rows", () => {
  const rows = pasteTradeRecordDraftCells(draftRows(), {
    rowIndex: 0,
    columnIndex: 2,
    text: "111111.IB\t简称一\n222222.IB\t简称二\n333333.IB\t忽略",
  });

  assert.equal(rows[0].record["债券代码"], "111111.IB");
  assert.equal(rows[0].record["债券简称"], "简称一");
  assert.equal(rows[1].record["债券代码"], "222222.IB");
  assert.equal(rows[1].record["债券简称"], "简称二");
  assert.equal(rows.length, 2);
});

test("strips the matching header when pasting a copied full trade-record table", () => {
  const first = TRADE_RECORD_COLUMNS.map((column) => column === "债券代码" ? "111111.IB" : `一-${column}`);
  const second = TRADE_RECORD_COLUMNS.map((column) => column === "债券代码" ? "222222.IB" : `二-${column}`);
  const rows = pasteTradeRecordDraftCells(draftRows(), {
    text: [TRADE_RECORD_COLUMNS, first, second].map((values) => values.join("\t")).join("\n"),
    columns: TRADE_RECORD_COLUMNS,
    skipMatchingHeader: true,
  });

  assert.equal(rows[0].record["谈判日"], "一-谈判日");
  assert.equal(rows[0].record["债券代码"], "111111.IB");
  assert.equal(rows[1].record["债券代码"], "222222.IB");
});

test("maps spreadsheet paste across only the currently visible columns", () => {
  const rows = pasteTradeRecordDraftCells(draftRows(), {
    text: "对手A\t中介A",
    columns: ["真实交易对手", "中介"],
  });

  assert.equal(rows[0].record["真实交易对手"], "对手A");
  assert.equal(rows[0].record["中介"], "中介A");
  assert.equal(rows[0].record["交易对手"], "");
});

test("builds DM requests only for formula columns that still need values", () => {
  const rows = draftRows();
  const request = tradeRecordDmRequestRows(rows);
  assert.deepEqual(request.map((row) => row.id), ["secondary:one", "secondary:two"]);
  assert.equal(request[0].securityId, "102682206.IB");
  assert.equal(request[0].negotiationDate, "2026-07-24");

  const snapshot = cloneTradeRecordDraftRows(rows);
  snapshot[0].record["债券简称"] = "齐全";
  snapshot[0].record["债券类型"] = "中期票据";
  snapshot[0].record["估值收益率"] = "1.9";
  assert.deepEqual(tradeRecordDmRequestRows(snapshot).map((row) => row.id), ["secondary:two"]);
});

test("marks a DM lookup result dirty even when DM has no field value to fill", () => {
  const rows = mergeTradeRecordDmResults(draftRows(), [{
    id: "secondary:one",
    securityId: "102682206.IB",
    requestedDate: "2026-07-23",
    status: "missing",
    missing: ["债券简称", "债券类型", "估值收益率"],
    queriedAt: "2026-07-24T10:00:00.000Z",
  }]);

  assert.equal(rows[0].dirty, true);
  assert.equal(rows[0].dmLookup.status, "missing");
});

test("changing a security code clears only DM-derived cells and ignores a stale response", () => {
  let rows = draftRows();
  rows = mergeTradeRecordDmResults(rows, [{
    id: "secondary:one",
    securityId: "102682206.IB",
    shortName: "旧简称",
    bondType: "公司债",
    valuationYield: 2.1,
    requestedDate: "2026-07-23",
    valuationDate: "2026-07-23",
    valuationField: "cbYtm",
    status: "complete",
  }]);
  rows = updateTradeRecordDraftCell(rows, {
    key: "secondary:one",
    column: "债券代码",
    value: "102699999.IB",
  });

  assert.equal(rows[0].record["债券简称"], "");
  assert.equal(rows[0].record["债券类型"], "");
  assert.equal(rows[0].record["估值收益率"], "");
  assert.equal(rows[0].dmLookup.status, "");

  const stale = mergeTradeRecordDmResults(rows, [{
    id: "secondary:one",
    securityId: "102682206.IB",
    shortName: "不应写回",
    bondType: "中期票据",
    valuationYield: 1.9,
    requestedDate: "2026-07-23",
    status: "complete",
  }]);
  assert.equal(stale[0].record["债券简称"], "");
});

test("changing negotiation date invalidates the DM valuation but keeps security master data", () => {
  let rows = draftRows();
  rows = mergeTradeRecordDmResults(rows, [{
    id: "secondary:one",
    securityId: "102682206.IB",
    shortName: "测试债",
    bondType: "公司债",
    valuationYield: 2.1,
    requestedDate: "2026-07-23",
    status: "complete",
  }]);
  rows = updateTradeRecordDraftCell(rows, {
    key: "secondary:one",
    column: "谈判日",
    value: "2026-07-25",
  });
  assert.equal(rows[0].record["债券简称"], "测试债");
  assert.equal(rows[0].record["债券类型"], "公司债");
  assert.equal(rows[0].record["估值收益率"], "");
});

test("validates spreadsheet dates, numbers, direction and settlement speed", () => {
  assert.equal(isTradeRecordCellValueValid("谈判日", "2026-02-29"), false);
  assert.equal(isTradeRecordCellValueValid("交易日", "2026-07-27"), true);
  assert.equal(isTradeRecordCellValueValid("净价", "abc"), false);
  assert.equal(isTradeRecordCellValueValid("清算速度(0/1)", "2"), false);
  assert.equal(isTradeRecordCellValueValid("我行方向", "卖出"), true);

  const rows = updateTradeRecordDraftCell(draftRows(), {
    key: "secondary:one",
    column: "交易日",
    value: "2026-13-01",
  });
  assert.equal(validateTradeRecordDraftRows(rows)[0].column, "交易日");
});
