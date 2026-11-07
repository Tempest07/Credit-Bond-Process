import test from "node:test";
import assert from "node:assert/strict";
import {planInventoryQuestion} from "../tools/inventory-openai.mjs";

const date = "2026-10-29";
function explain(question, reason, previousPlan, extra = {}) {
  const decision = {kind:"explain", reason, changes:[], lookup:null, ...extra};
  return planInventoryQuestion({question, dates:[date], apiKey:"test", previousPlan,
    inspectEvidence() { assert.fail("an explanation should not query holdings"); },
    fetchImpl: async () => Response.json({status:"completed", output:[{type:"message",
      content:[{type:"output_text", text:JSON.stringify(decision)}]}]}),
  });
}

test("explains the actual scoped calculation without computing or claiming a new balance", async () => {
  const plan = {date, group:"code", metric:"principal", filters:{
    branch:"广州分行", guarantor:"甲集团", marketType:"资产支持证券", holdingStatus:"存续",
  }};
  const reply = await explain("这个金额是怎么得出来的？", "method", plan);
  assert.equal(reply.conversational, true);
  for (const fact of [date, "广州分行", "增信占用方（损益还原客户）", "甲集团", "按券码分组", "人民币名义本金", "本金为正"]) {
    assert.ok(reply.clarification.includes(fact), fact);
  }
  assert.equal(reply.plan, undefined);
});

test("clarifies a calculation or asks a specific question without relaying provider claims", async () => {
  const terms = await explain("怎么会有两种数量？", "counts", undefined, {text:"随口报出的余额为 888 亿元"});
  assert.match(terms.clarification, /一个券码/);
  assert.doesNotMatch(terms.clarification, /888/);
  const ambiguous = await explain("另一家呢？", "chooseEntity");
  assert.match(ambiguous.clarification, /哪一家/);
  await assert.rejects(explain("解释一下", "constructor"), {status:502});
  await assert.rejects(explain("解释一下", "method", undefined, {changes:[{field:"issuer",value:"甲公司"}]}), {status:502});
});
