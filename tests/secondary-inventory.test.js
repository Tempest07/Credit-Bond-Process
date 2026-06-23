import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCodeMappingText,
  buildPrimaryAwardTrades,
  calculateShadowInventory,
  parseInventoryLedgerRows,
  parseInventorySnapshotText,
  parseSecondaryOrderText,
  parseSecondaryTradeText,
  pendingCodeTrades,
  upsertInventoryPositions,
  upsertSecondaryOrders,
  upsertSecondaryTrades,
} from "../secondary-inventory.js";

test("parses inventory snapshots and daily offer lists", () => {
  const positions = parseInventorySnapshotText("SDR 280680.SH 25联投17 余额5000万", {
    snapshotDate: "2026-06-18",
  });
  const orders = parseSecondaryOrderText("SDR 280680.SH 25联投17 挂卖2000万 净价100.99");

  assert.equal(positions[0].code, "280680.SH");
  assert.equal(positions[0].shortName, "25联投17");
  assert.equal(positions[0].quantityWan, 5000);
  assert.equal(positions[0].snapshotDate, "2026-06-18");
  assert.equal(orders[0].side, "offer");
  assert.equal(orders[0].quantityWan, 2000);
  assert.equal(orders[0].price, "100.99");
});

test("parses internal balance ledger xlsx rows", () => {
  const rows = [
    ["机构名称", "联动分行", "会计分类", "交易组合", "表内/委外", "债券代码", "债券标准代码", "债券简称", "票面利率", "名义本金", "投组信息", "数据业务日期"],
    ["资金营运中心", "南京分行", "AFS", "表内", "表内", "012681333.IB", "012681333", "26苏国信SCP003", 0.0128, 50000000, "BK_BD_AS_SDR", new Date("2026-06-22T00:00:00+08:00")],
    ["资金营运中心", "三明分行", "RECEIVABLE", "表内", "表内", "102501628.IB", "102501628", "25三明城投MTN001", 0.028, 80000000, "BK_BD_RC_THR", new Date("2026-06-22T00:00:00+08:00")],
    ["资金营运中心", "", "TRADING", "表内", "表内", "", "SH265871", "G环农2A3", 0.024, 12000000, "BK_BD_AS_TX", "2026-06-22"],
  ];
  const positions = parseInventoryLedgerRows(rows);

  assert.equal(positions.length, 3);
  assert.equal(positions[0].account, "SDR");
  assert.equal(positions[0].quantityWan, 5000);
  assert.equal(positions[0].snapshotDate, "2026-06-22");
  assert.equal(positions[1].account, "THR");
  assert.equal(positions[1].quantityWan, 8000);
  assert.equal(positions[2].account, "TX");
  assert.equal(positions[2].code, "265871.SH");
  assert.equal(positions[2].quantityWan, 1200);
});

test("parses regional OFR quote lists with optional amount", () => {
  const orders = parseSecondaryOrderText(`OFR
陕西（西安）
281640.SH，26西轨03，1.93*ofr
012681284.IB，26陕西金控SCP003，3000，净价100*ofr
24广越04，OFR估值
25广越03，OFR净价100
24华阳新材MTN010B，估值-2*ofr`);

  assert.equal(orders.length, 5);
  assert.equal(orders[0].code, "281640.SH");
  assert.equal(orders[0].shortName, "26西轨03");
  assert.equal(orders[0].quantityWan, 0);
  assert.equal(orders[0].yieldRate, 1.93);
  assert.equal(orders[1].quantityWan, 3000);
  assert.equal(orders[1].price, "100");
  assert.equal(orders[2].shortName, "24广越04");
  assert.equal(orders[2].price, "估值");
  assert.equal(orders[3].price, "100");
  assert.equal(orders[4].price, "估值-2");
  assert.equal(orders[4].yieldRate, null);
});

test("subtracts unsettled sells from available inventory after a real snapshot", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertInventoryPositions(state, parseInventorySnapshotText("SDR 280680.SH 25联投17 余额5000万", {
    snapshotDate: "2026-06-18",
  }));
  state = upsertSecondaryTrades(state, parseSecondaryTradeText(
    "SDR 280680.SH 25联投17 5000万 06.18 兴业银行 出给 首创证券 100.990",
    { referenceDate: new Date("2026-06-18T09:00:00+08:00") },
  ));

  const row = calculateShadowInventory(state, { asOfDate: "2026-06-18" })[0];
  assert.equal(row.snapshotQuantityWan, 5000);
  assert.equal(row.soldWan, 5000);
  assert.equal(row.unsettledSellWan, 5000);
  assert.equal(row.availableWan, 0);
  assert.match(row.warning, /未交割卖出/);
});

test("keeps negotiated T+1 sells locked before settlement and applies same-day sells explicitly", () => {
  const nextDayTrade = parseSecondaryTradeText("280680.SH 25联投17 1000万 06.18 兴业银行 出给 首创证券 100.990", {
    referenceDate: new Date("2026-06-18T09:00:00+08:00"),
  })[0];
  const sameDayTrade = parseSecondaryTradeText("280680.SH 25联投17 1000万 06.18 +0 兴业银行 出给 首创证券 100.990", {
    referenceDate: new Date("2026-06-18T09:00:00+08:00"),
  })[0];

  assert.equal(nextDayTrade.settlementSpeed, 1);
  assert.equal(nextDayTrade.settlementDate, "2026-06-19");
  assert.equal(sameDayTrade.settlementSpeed, 0);
  assert.equal(sameDayTrade.settlementDate, "2026-06-18");
});

test("warns when active offers exceed inventory after confirmed sells", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertInventoryPositions(state, parseInventorySnapshotText("SDR 280680.SH 25联投17 余额5000万", {
    snapshotDate: "2026-06-18",
  }));
  state = upsertSecondaryTrades(state, parseSecondaryTradeText(
    "SDR 280680.SH 25联投17 3000万 06.18 兴业银行 出给 首创证券 100.990",
    { referenceDate: new Date("2026-06-18T09:00:00+08:00") },
  ));
  state = upsertSecondaryOrders(state, parseSecondaryOrderText("SDR 280680.SH 25联投17 挂卖2500万 净价101.01"));

  const row = calculateShadowInventory(state, { asOfDate: "2026-06-18" })[0];
  assert.equal(row.availableWan, -500);
  assert.match(row.warning, /可能卖空\s*500万/);
});

test("does not treat order quantity as available inventory", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertSecondaryOrders(state, parseSecondaryOrderText("102681284.IB 26陕西金控SCP003 3000 净价100*ofr"));

  const rowWithoutSnapshot = calculateShadowInventory(state, { asOfDate: "2026-06-23" })[0];
  assert.equal(rowWithoutSnapshot.snapshotQuantityWan, 0);
  assert.equal(rowWithoutSnapshot.activeOfferWan, 3000);
  assert.equal(rowWithoutSnapshot.availableWan, -3000);
  assert.match(rowWithoutSnapshot.warning, /可能卖空\s*3000万/);

  state = upsertInventoryPositions(state, parseInventorySnapshotText("SDR 102681284.IB 26陕西金控SCP003 余额1000万", {
    snapshotDate: "2026-06-23",
  }));
  const rowWithSnapshot = calculateShadowInventory(state, { asOfDate: "2026-06-23" })[0];
  assert.equal(rowWithSnapshot.snapshotQuantityWan, 1000);
  assert.equal(rowWithSnapshot.activeOfferWan, 3000);
  assert.equal(rowWithSnapshot.availableWan, -2000);
  assert.match(rowWithSnapshot.warning, /可能卖空\s*2000万/);
});

test("creates primary award inventory drafts and lets code mapping fill missing codes", () => {
  const projects = [{
    id: "p1",
    shortName: "26测试SCP001",
    leadUnderwriter: "兴业银行",
    cutoffAt: "2026-06-18T18:00",
    sourceText: "一级项目简表",
    tranches: [{
      id: "tr1",
      shortName: "26测试SCP001",
      winningAmountWan: 12000,
      winningRate: 1.52,
      paymentDate: "2026-06-19",
      securityCode: "",
    }],
  }];

  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertSecondaryTrades(state, buildPrimaryAwardTrades(projects, []));

  assert.equal(state.secondaryTrades[0].side, "buy");
  assert.equal(state.secondaryTrades[0].quantityWan, 12000);
  assert.equal(state.secondaryTrades[0].codeStatus, "pending");
  assert.equal(pendingCodeTrades(state).length, 1);

  const result = applyCodeMappingText(state, "26测试SCP001 012681999.IB");
  assert.equal(result.updatedCount, 1);
  assert.equal(result.state.secondaryTrades[0].code, "012681999.IB");
  assert.equal(result.state.secondaryTrades[0].codeStatus, "confirmed");
});
