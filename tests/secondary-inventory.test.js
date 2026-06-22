import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCodeMappingText,
  buildPrimaryAwardTrades,
  calculateShadowInventory,
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
