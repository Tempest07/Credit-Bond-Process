import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {isAbsProject, parseProjectBrief} from "../core.js";
import {createProjectRecord, normalizeProjectRecord} from "../lifecycle.js";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\nfunction ", start + 1));
}
function harness(record) {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {value:"", addEventListener(_event,fn){this.click=fn;}});
    return nodes.get(selector);
  };
  const context = vm.createContext({
    $, record, readProjectForm:()=>context.record,
    parseProjectBrief, isAbsProject, createProjectRecord, normalizeProjectRecord,
    compactProjectDurations:parts=>parts.join("/"),
    fillProjectFields(){}, renderIssuerOptions(){}, regenerate(){}, switchView(){},
    newProjectCutoffMode:"auto", project:null, selectedIssuerId:"", opinionManuallyEdited:false,
  });
  const start = app.indexOf('  $("#editProjectOpinionButton").addEventListener("click", () => {');
  const end = app.indexOf('  $("#paymentTodoList").addEventListener',start);
  assert.ok(start>=0 && end>start);
  vm.runInContext(app.slice(start,end),context);
  for (const name of ["buildLedgerProjectRecord","mergeExistingProjectTranches","mergeExistingProjectTranche","formatProjectOfferingSummary"])
    vm.runInContext(functionSource(name),context);
  return {context, returnToOpinion:()=>$("#editProjectOpinionButton").click()};
}
function example(offeringType="公募",shortName="26测试MTN003") {
  return normalizeProjectRecord({
    id:"roundtrip-test",shortName,offeringType,venue:"银行间",issueScale:6,
    sourceText:`${shortName} 非我行主承 武汉分行\n5年 规模6亿 AAA/隐含AA+\n询价区间1.5-2.5 银行间 中信银行`,
    opinion:"手工意见保留。授信方面，总行批10亿，公私募（私募5亿），30%（私募20%），3年。",
    status:"未中标",resultConfirmed:true,cutoffAt:"2026-09-16T18:00",
    tranches:[{shortName,durationText:"5Y",inquiryLow:1.5,inquiryHigh:2.5,bidLevels:[{bidRate:1.69,bidAmount:1.2}],resultStatus:"未中标",winningRate:1.68}],
  });
}
for (const offering of ["公募","私募",""]) test(`return to opinion and save repeatedly preserves stored offering '${offering}'`,()=>{
  const {context,returnToOpinion}=harness(example(offering));
  for(let i=0;i<3;i++) {
    const before=context.record;
    returnToOpinion();
    assert.equal(context.project.offeringType,offering);
    const saved=context.buildLedgerProjectRecord(context.project,null,{opinion:before.opinion,suggestion:{trancheSuggestions:[{suggestedRatio:20}]}},before,{cutoffAt:before.cutoffAt});
    assert.equal(saved.offeringType,offering);
    assert.equal(saved.opinion,before.opinion);
    assert.equal(saved.id,before.id);
    assert.equal(saved.resultConfirmed,true);
    assert.deepEqual(saved.tranches[0].bidLevels,before.tranches[0].bidLevels);
    context.record=saved;
  }
});
test("card fallback does not confuse private credit capacity in the opinion with bond offering",()=>{
  const {context}=harness(example());
  assert.equal(context.formatProjectOfferingSummary(example("")),"公募");
  assert.equal(context.formatProjectOfferingSummary(example("","26测试PPN001")),"私募");
  assert.equal(context.formatProjectOfferingSummary({...example("","26测试01"),venue:"上交所"}),"");
  assert.equal(context.formatProjectOfferingSummary({...example(""),sourceText:"26测试01 非公开发行 上交所"}),"私募");
});
test("explicit stored offering survives contradictory old brief text; deliberate changes can still be saved",()=>{
  const {context,returnToOpinion}=harness({...example(),sourceText:"26测试MTN003 非公开发行"});
  returnToOpinion();
  assert.equal(context.project.offeringType,"公募");
  context.project.offeringType="私募";
  const saved=context.buildLedgerProjectRecord(context.project,null,{opinion:"手动修改",suggestion:{trancheSuggestions:[]}},context.record,{cutoffAt:context.record.cutoffAt});
  assert.equal(saved.offeringType,"私募");
});
