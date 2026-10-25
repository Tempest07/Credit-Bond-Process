import test from "node:test";
import assert from "node:assert/strict";
import {
  isBondSettlementDay,
  normalizeBondSettlementDate,
  resolveBondSettlementDate,
  settlementDateAfterEdit,
} from "../bond-settlement-calendar.js";

const next = (date, market) => resolveBondSettlementDate({ tradeDate: date, settlementSpeed: 1, market });

test("T+1 follows the verified market calendar over weekends and long holidays", () => {
  for (const market of ["IB", "SH", "SZ"]) {
    assert.equal(next("2026-10-23", market), "2026-10-26");
    assert.equal(next("2026-09-24", market), "2026-09-28");
    assert.equal(next("2026-09-30", market), "2026-10-08");
    assert.equal(next("2026-06-18", market), "2026-06-22");
    assert.equal(next("2026-04-30", market), "2026-05-06");
  }
});

test("interbank compensating weekends are open while exchange settlement weekends stay closed", () => {
  for (const [before, interbank, exchange] of [
    ["2026-02-13", "2026-02-14", "2026-02-24"],
    ["2026-02-27", "2026-02-28", "2026-03-02"],
    ["2026-05-08", "2026-05-09", "2026-05-11"],
    ["2026-09-18", "2026-09-20", "2026-09-21"],
    ["2026-10-09", "2026-10-10", "2026-10-12"],
  ]) {
    assert.equal(next(before, "IB"), interbank);
    assert.equal(next(before, "SH"), exchange);
    assert.equal(next(before, "SZ"), exchange);
  }
  assert.equal(isBondSettlementDay("2026-01-04", "IB"), true);
  assert.equal(isBondSettlementDay("2026-01-04", "SH"), false);
});

test("unknown calendars require an explicit date rather than inventing a precise T+1 date", () => {
  assert.equal(next("2027-01-04", "IB"), "");
  assert.equal(next("2026-12-31", "IB"), "", "do not extend the calendar beyond its coverage");
  assert.equal(next("2026-10-23", ""), "");
  assert.equal(next("2026-10-24", "SH"), "", "a closed trade date cannot anchor an inferred settlement");
  assert.equal(isBondSettlementDay("2027-01-04", "IB"), null);
  assert.equal(resolveBondSettlementDate({ tradeDate: "2027-01-04", settlementSpeed: 1, code: "246129.SH", settlementDate: "2027-01-06" }), "2027-01-06");
  assert.equal(resolveBondSettlementDate({ tradeDate: "2027-01-04", settlementSpeed: 0 }), "2027-01-04");
  assert.equal(resolveBondSettlementDate({ tradeDate: "2026-10-23", settlementSpeed: 1, code: "246129.SH", market: "IB" }), "");
  assert.equal(normalizeBondSettlementDate("2026-02-30"), "");
  assert.equal(resolveBondSettlementDate({ tradeDate: "2026-10-23", settlementSpeed: 1, market: "IB", settlementDate: "2026-02-30" }), "");
});

test("edits retain an existing agreement unless date, speed or market changes", () => {
  const previous = { tradeDate: "2026-10-23", settlementSpeed: 1, code: "102683999.IB", settlementDate: "2026-10-27" };
  assert.equal(settlementDateAfterEdit(previous, { quantityWan: 2000 }), "2026-10-27");
  assert.equal(settlementDateAfterEdit(previous, { settlementDate: "2026-10-28" }), "2026-10-28");
  assert.equal(settlementDateAfterEdit(previous, { settlementSpeed: 0 }), "2026-10-23");
  assert.equal(settlementDateAfterEdit(previous, { tradeDate: "2026-10-26" }), "2026-10-27");
  assert.equal(settlementDateAfterEdit({ ...previous, settlementSpeed: undefined, tradeRecord: { "清算速度(0/1)": "1" } }, { quantityWan: 2000 }), "2026-10-27");
  const adjustedFriday = { tradeDate: "2026-10-09", settlementSpeed: 1, code: "102683999.IB", market: "IB", settlementDate: "2026-10-10" };
  assert.equal(settlementDateAfterEdit(adjustedFriday, { code: "246129.SH" }), "2026-10-12");
});
