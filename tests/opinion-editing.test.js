import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\nfunction ", start + 1));
}
function harness() {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {value:"", classList:{toggle(){}}});
    return nodes.get(selector);
  };
  const context = vm.createContext({
    $, project:{shortName:"测试A",issueScale:2.7}, selectedIssuerId:"issuer",
    state:{issuers:[{id:"issuer"}]}, opinionManuallyEdited:false,
    generateOpinion: p => ({opinion:`标准金额：${p.issueScale}`,suggestion:{investmentAmount:p.issueScale,trancheSuggestions:[]}}),
    normalizeBondFullNameForProject: () => "", buildBondFullName: () => "",
    renderNewProjectCutoffControl(){}, scheduleDmValuationAssist(){}, renderWarnings(){}, renderRuleTrace(){},
    formatSuggestionRatios: () => "20%", formatNumber:String,
    clonePlain: structuredClone, buildDmProjectSourceText: () => "", formatRateListInput: () => "",
  });
  for (const name of ["regenerate", "resetOpinionForDifferentProject", "projectDmHistoryItemFromCurrent", "projectDmHasContent"]) vm.runInContext(functionSource(name), context);
  return {context,$};
}

test("field changes update suggestions but retain manual wording, whitespace and deliberate empty content", () => {
  const {context,$} = harness();
  context.regenerate();
  assert.equal($("#opinionOutput").value,"标准金额：2.7");
  for (const manual of ["手动意见\n\n  保留格式。", ""]) {
    context.opinionManuallyEdited = true;
    $("#opinionOutput").value = manual;
    context.project.issueScale = 9;
    context.regenerate();
    assert.equal($("#opinionOutput").value, manual);
    assert.match($("#suggestionSummary").textContent,/9亿元/);
    assert.equal(context.projectDmHistoryItemFromCurrent().opinion,manual);
  }
  context.opinionManuallyEdited = false;
  context.regenerate();
  assert.equal($("#opinionOutput").value,"标准金额：9");
  assert.equal("opinion" in context.projectDmHistoryItemFromCurrent(),false);
});

test("same-bond refresh preserves manual mode; a new DM bond starts with its own standard opinion", () => {
  const {context} = harness();
  context.opinionManuallyEdited = true;
  context.resetOpinionForDifferentProject({shortName:"测试A"});
  assert.equal(context.opinionManuallyEdited,true);
  context.resetOpinionForDifferentProject({shortName:"测试B"});
  assert.equal(context.opinionManuallyEdited,false);
});
