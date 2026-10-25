import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { calculateSuggestion, generateOpinion } from "../core.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const absProject = () => ({ instrumentType: "ABS", shortName: "测试优先A1", warnings: [],
  absInfo: { creditApprovalId: "approval", approvalRatio: 20, approvalAmount: 2,
    planName: "合成专项计划", tranches: [{ className: "A1", shortName: "测试优先A1", scale: 1, selected: true }] } });

test("the ABS amount rule is preserved while a ratio conflict is visible in the final opinion warnings", () => {
  const project = absProject();
  const generated = generateOpinion(project, null);
  assert.equal(generated.suggestion.investmentAmount, 2);
  assert.equal(generated.suggestion.recommendedAmount, 2);
  assert.equal(generated.suggestion.amountRatioConflict, true);
  assert.equal(generated.suggestion.trancheSuggestions[0].investmentAmount, 0.2);
  assert.match(generated.warnings.join("；"), /超过所选分档规模的20%（0.2亿元）.*请核对/);
  assert.match(generated.opinion, /金额不超过2亿元/);
  project.absInfo.approvalAmount = 0.2;
  assert.equal(calculateSuggestion(project, null).amountRatioConflict, false);
});

test("both single and batch ledger entry paths require confirmation for an ABS amount conflict", () => {
  const start = app.indexOf("function upsertParsedProjectToLedger(");
  const body = app.slice(start, app.indexOf("\nfunction ", start + 1));
  for (const confirmed of [false, true]) {
    const original = { projects: [] };
    let prompts = 0;
    const context = vm.createContext({ state: original,
      window: { confirm(message) { prompts++; assert.match(message, /请核对.*\n是否已核对/); return confirmed; } },
      projectIssuerSaveStatus: () => ({ ok: true }), findExistingLedgerProject: () => null,
      buildLedgerProjectRecord: (project, issuer, generated) => ({ id: "p", amount: generated.suggestion.investmentAmount }),
      upsertProject: (state, record) => ({ projects: [...state.projects, record] }), linkAbsCreditApprovalToProject: state => state,
    });
    vm.runInContext(body, context);
    const result = context.upsertParsedProjectToLedger(absProject(), null, generateOpinion(absProject(), null));
    assert.equal(prompts, 1);
    if (confirmed) assert.equal(result.record.amount, 2);
    else { assert.equal(result, null); assert.equal(context.state, original); }
  }
});

test("published overdue rule branches agree with actual ordinary-credit calculations", () => {
  for (const [rating, publicCap, privateCap] of [["AA+", 20, 10], ["AA", 15, 0], ["AA(2)", 10, 0], ["A+", 10, 0], ["BBB", 10, 0]]) {
    for (const [offeringType, expected] of [["公募", publicCap], ["私募", privateCap]]) {
      const result = calculateSuggestion({ hiddenRating: rating, durationText: "5Y", issueScale: 10, offeringType },
        { credit: { approvedRatio: 30, investmentTermText: "3年" } });
      assert.equal(result.suggestedRatio, expected, `${rating}/${offeringType}`);
    }
  }
  const cards = html.match(/<article class="rule-card">[\s\S]*?<\/article>/g);
  assert.ok(cards.some(card => /AA\+ 超授信/.test(card) && /公募上限20%，私募上限10%/.test(card)));
  assert.ok(cards.some(card => /AA 超授信/.test(card) && /公募上限15%，私募不可投资/.test(card)));
  assert.ok(cards.some(card => /AA\(2\)及以下/.test(card) && /公募上限10%，私募不可投资/.test(card)));
  assert.match(html, /向下取整到1000万元（0.1亿元）/);
  assert.match(html, /等于阈值时归下一级/);
});
