import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCodeMappingText,
  buildPrimaryAwardTrades,
  buildSecondaryOfferListText,
  calculateShadowInventory,
  markSecondaryTradeFrontOffice,
  parseInventoryLedgerRows,
  parseInventorySnapshotText,
  parseSecondaryOrderText,
  parseSecondaryTradeText,
  pendingCodeTrades,
  secondaryTradesForLedger,
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
  assert.equal(orders[0].region, "陕西（西安）");
  assert.equal(orders[1].quantityWan, 3000);
  assert.equal(orders[1].price, "100");
  assert.equal(orders[2].shortName, "24广越04");
  assert.equal(orders[2].price, "估值");
  assert.equal(orders[3].price, "100");
  assert.equal(orders[4].shortName, "24华阳新材MTN010B");
  assert.equal(orders[4].price, "估值-2");
  assert.equal(orders[4].yieldRate, null);
});

test("exports active offer orders as grouped OFR text", () => {
  const cleanOrders = parseSecondaryOrderText(`OFR
陕西（西安）
281640.SH，26西轨03，1.93*ofr
012681284.IB，26陕西金控SCP003，3000，净价100*ofr

广东（广州）
25广越03，OFR净价100
24广越04，OFR估值`);
  const dirtyOldOrders = [
    { side: "offer", code: "281640.SH", shortName: "26??03", quantityWan: 0, yieldRate: 1.93, status: "active", sourceText: "281640.SH，26??03，1.93*ofr" },
    { side: "offer", code: "", shortName: "24????", quantityWan: 0, price: "??-2", status: "active", sourceText: "24????，??-2*ofr" },
  ];

  const text = buildSecondaryOfferListText([...cleanOrders, ...dirtyOldOrders]);

  assert.equal(text, [
    "OFR",
    "",
    "陕西（西安）",
    "281640.SH，26西轨03，1.93*ofr",
    "012681284.IB，26陕西金控SCP003，3000，净价100*ofr",
    "",
    "广东（广州）",
    "25广越03，净价100*ofr",
    "24广越04，OFR估值",
  ].join("\n"));
});

test("updates existing secondary offer by code when a grouped quote is re-imported", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertSecondaryOrders(state, [{ code: "281640.SH", shortName: "26??03", yieldRate: 1.93, status: "active" }]);
  state = upsertSecondaryOrders(state, parseSecondaryOrderText(`OFR
陕西（西安）
281640.SH，26西轨03，1.93*ofr`));

  assert.equal(state.secondaryOrders.length, 1);
  assert.equal(state.secondaryOrders[0].shortName, "26西轨03");
  assert.equal(state.secondaryOrders[0].region, "陕西（西安）");
});

test("re-imported secondary offer list controls export order", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertSecondaryOrders(state, [
    { code: "524474.SZ", shortName: "25??K2", yieldRate: 1.84, status: "active" },
    { code: "281640.SH", shortName: "26??03", yieldRate: 1.93, status: "active" },
  ]);
  state = upsertSecondaryOrders(state, parseSecondaryOrderText(`OFR
陕西（西安）
281640.SH，26西轨03，1.93*ofr
524474.SZ，25长汇K2，1.84*ofr`));

  const text = buildSecondaryOfferListText(state.secondaryOrders);
  assert.match(text, /281640\.SH，26西轨03，1\.93\*ofr\n524474\.SZ，25长汇K2，1\.84\*ofr/);
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

test("parses Trade-Phraser style trade elements into pending secondary trades", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertInventoryPositions(state, parseInventorySnapshotText("SDR 102682346.IB 26酒钢MTN002 余额6000万", {
    snapshotDate: "2026-06-25",
  }));
  const trades = parseSecondaryTradeText(
    "【上海】06.26+0 26酒钢MTN002  102682346.IB 1.9% 5k 兴业银行 出给 建信基金 对话发俞维谦",
    {
      referenceDate: new Date("2026-06-25T09:00:00+08:00"),
      negotiationDate: "2026-06-25",
    },
  );
  state = upsertSecondaryTrades(state, trades);

  assert.equal(trades.length, 1);
  assert.equal(trades[0].intermediary, "上海");
  assert.equal(trades[0].side, "sell");
  assert.equal(trades[0].counterparty, "建信基金");
  assert.equal(trades[0].shortName, "26酒钢MTN002");
  assert.equal(trades[0].code, "102682346.IB");
  assert.equal(trades[0].yieldRate, 1.9);
  assert.equal(trades[0].quantityWan, 5000);
  assert.equal(trades[0].tradeDate, "2026-06-26");
  assert.equal(trades[0].settlementSpeed, 0);
  assert.equal(trades[0].settlementDate, "2026-06-26");
  assert.equal(trades[0].tradeStage, "negotiated");
  assert.equal(trades[0].frontOfficeDone, false);

  const row = calculateShadowInventory(state, { asOfDate: "2026-06-25" })[0];
  assert.equal(row.snapshotQuantityWan, 6000);
  assert.equal(row.soldWan, 5000);
  assert.equal(row.availableWan, 1000);
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

test("adds front-office confirmed secondary trades to the daily ledger", () => {
  let state = { secondaryInventoryPositions: [], secondaryOrders: [], secondaryTrades: [] };
  state = upsertSecondaryTrades(state, parseSecondaryTradeText(
    "SDR 280680.SH 25联投17 3000万 06.18 兴业银行 出给 首创证券 100.990",
    { referenceDate: new Date("2026-06-18T09:00:00+08:00") },
  ));

  assert.equal(secondaryTradesForLedger(state, "2026-06-18").length, 0);

  state = {
    ...state,
    secondaryTrades: [
      markSecondaryTradeFrontOffice(state.secondaryTrades[0], {
        frontOfficePrice: "100.98",
        now: "2026-06-18T10:20:00.000Z",
      }),
    ],
  };

  const rows = secondaryTradesForLedger(state, "2026-06-18");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].frontOfficeDone, true);
  assert.equal(rows[0].tradeStage, "front_office_done");
  assert.equal(rows[0].frontOfficePrice, "100.98");
  assert.equal(rows[0].ledgerDate, "2026-06-18");
});
