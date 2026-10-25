import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizeBondSettlementDate, settlementDateWarnings } from "../bond-settlement-calendar.js";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function load(context, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  const tail = source.slice(start), end = tail.slice(1).search(/\n(?:async )?function /);
  vm.runInContext(end < 0 ? tail : tail.slice(0, end + 1), context);
}
function harness(answer) {
  let prompts = 0;
  const warnings = [];
  const context = vm.createContext({ normalizeBondSettlementDate, settlementDateWarnings,
    window: { prompt() { prompts++; return answer; } }, showToast: message => warnings.push(message) });
  load(context, "confirmSecondarySettlementDate");
  return { context, warnings, get prompts() { return prompts; } };
}

test("a trade outside the verified calendar has an executable manual settlement-date path", () => {
  const trade = { id: "t", code: "246129.SH", tradeDate: "2027-01-04", settlementDate: "", parseWarnings: ["结算日期待人工确认"] };
  const before = JSON.stringify(trade);
  const h = harness("2027-01-06");
  const confirmed = h.context.confirmSecondarySettlementDate(trade);
  assert.equal(confirmed.settlementDate, "2027-01-06");
  assert.deepEqual(Array.from(confirmed.parseWarnings), []);
  assert.equal(h.prompts, 1);
  assert.equal(JSON.stringify(trade), before);
  assert.equal(h.context.confirmSecondarySettlementDate(confirmed), confirmed);
  assert.equal(h.prompts, 1, "an agreed date never prompts again");
});

test("manual settlement cancellation, invalid dates and silent saves leave the trade unmodified", () => {
  const trade = { id: "t", tradeDate: "2027-01-04", settlementDate: "" };
  for (const answer of [null, "", "2027-02-30", "2027-01-03"]) {
    const h = harness(answer);
    assert.equal(h.context.confirmSecondarySettlementDate(trade), null);
    assert.equal(trade.settlementDate, "");
  }
  const silent = harness("2027-01-06");
  assert.equal(silent.context.confirmSecondarySettlementDate(trade, { silent: true }), null);
  assert.equal(silent.prompts, 0);
  assert.match(silent.warnings[0], /结算日期待人工确认/);
});

test("ledger save obtains a missing date before changing state or uploading", async () => {
  for (const answer of [null, "2027-01-06"]) {
    const h = harness(answer);
    let puts = 0;
    const original = { secondaryTrades: [{ id: "t", tradeDate: "2026-10-23", settlementDate: "2026-10-26" }] };
    Object.assign(h.context, { state: original, secondaryLedgerSavePending: false,
      secondaryLedgerDraftRows: [{ id: "t", source: "secondary", dirty: true }],
      validateTradeRecordDraftRows: () => [],
      applyTradeRecordRowsToState: () => ({ secondaryTrades: [{ id: "t", tradeDate: "2027-01-04", settlementDate: "" }] }),
      updateSecondaryLedgerControls() {}, persistLocal() {},
      saveCloudState: async () => { puts++; return true; }, resetSecondaryLedgerDraft() {}, renderSecondaryLedger() {},
    });
    load(h.context, "saveSecondaryLedgerDraft");
    assert.equal(await h.context.saveSecondaryLedgerDraft(), answer !== null);
    if (answer === null) { assert.equal(puts, 0); assert.equal(h.context.state, original); }
    else { assert.equal(puts, 1); assert.equal(h.context.state.secondaryTrades[0].settlementDate, answer); }
  }
});
