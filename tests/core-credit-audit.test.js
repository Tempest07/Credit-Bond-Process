import test from "node:test";
import assert from "node:assert/strict";

import {
  applyIssuerCommonFields,
  calculateSuggestion,
  durationParts,
  durationToDays,
  generateOpinion,
  normalizeIssuer,
  parseProjectBrief,
} from "../core.js";
import { parseCreditText } from "../history-parser.js";

function projectWithTerm(durationText = "5年") {
  return parseProjectBrief(`26测试MTN001 非我行主承 广州分行
${durationText}期 规模10亿 AA(联合资信)/隐含AA
询价区间1.5-2.5 银行间 中信银行
26测试MTN001 市场估值约1.8`);
}

function issuerWithTerm(investmentTermText = "3年") {
  return normalizeIssuer({
    legalName: "审计合成主体有限公司",
    linkedBranch: "苏州分行",
    subjectRating: "AAA",
    ratingAgency: "中诚信国际",
    hiddenRating: "AAA",
    credit: { approvedRatio: 30, investmentTermText },
  });
}

test("F01 valid DM, QB and Wind implied ratings survive stale issuer fields and retain their dates", () => {
  const issuer = issuerWithTerm();
  for (const [source, fieldSource] of [
    ["dm", "dm"],
    ["dm-rating-api", "dm"],
    ["qb-rating-api", "qb"],
    ["qb-implied-rating", "qb"],
    ["wind-analytics", "wind"],
  ]) {
    for (const commonFieldSources of [undefined, { hiddenRating: fieldSource }]) {
      const project = {
        ...projectWithTerm(),
        hiddenRatingSource: source,
        hiddenRatingAsOf: "2026-10-25",
        ...(commonFieldSources ? { commonFieldSources } : {}),
      };
      const before = structuredClone(project);
      const applied = applyIssuerCommonFields(project, issuer);
      assert.equal(applied.hiddenRating, "AA", source);
      assert.equal(applied.hiddenRatingSource, source, source);
      assert.equal(applied.hiddenRatingAsOf, "2026-10-25", source);
      assert.equal(calculateSuggestion(applied, issuer).suggestedRatio, 15, source);
      assert.deepEqual(project, before, "applying common fields must not rewrite the input evidence");
    }
  }
});

test("F01 mixed per-field origins protect external ratings while filling only missing agency from cloud", () => {
  const project = {
    ...projectWithTerm(),
    subjectRating: "AA+",
    ratingAgency: "",
    hiddenRating: "AA",
    hiddenRatingSource: "qb-implied-rating",
    hiddenRatingAsOf: "2026-10-25",
    commonFieldSources: { subjectRating: "dm", ratingAgency: "qb", hiddenRating: "qb" },
  };
  const applied = applyIssuerCommonFields(project, issuerWithTerm());
  assert.equal(applied.subjectRating, "AA+");
  assert.equal(applied.hiddenRating, "AA");
  assert.equal(applied.ratingAgency, "中诚信国际");
  assert.equal(applied.commonFieldSources.subjectRating, "dm");
  assert.equal(applied.commonFieldSources.hiddenRating, "qb");
  assert.equal(applied.commonFieldSources.ratingAgency, "cloud");

  const externalAgency = applyIssuerCommonFields({
    ...project,
    ratingAgency: "联合资信",
    commonFieldSources: { ...project.commonFieldSources, ratingAgency: "qb" },
  }, issuerWithTerm());
  assert.equal(externalAgency.ratingAgency, "联合资信");
});

test("F01 missing external implied rating takes cloud value together with cloud provenance", () => {
  const applied = applyIssuerCommonFields({
    ...projectWithTerm(),
    hiddenRating: "",
    hiddenRatingSource: "dm-rating-api",
    hiddenRatingAsOf: "2026-10-25",
    commonFieldSources: { hiddenRating: "dm" },
  }, issuerWithTerm());
  assert.equal(applied.hiddenRating, "AAA");
  assert.equal(applied.hiddenRatingSource, "cloud");
  assert.equal(applied.hiddenRatingAsOf, "");
  assert.equal(applied.commonFieldSources.hiddenRating, "cloud");
});

test("F01 unlabelled brief fields still use issuer common data while explicit manual edits remain authoritative", () => {
  const issuer = issuerWithTerm();
  const parsed = projectWithTerm();
  assert.equal(applyIssuerCommonFields(parsed, issuer).hiddenRating, "AAA");
  assert.equal(applyIssuerCommonFields({ ...parsed, hiddenRatingSource: "manual" }, issuer).hiddenRating, "AA");

  const manual = {
    ...parsed,
    hiddenRatingSource: "manual",
    hiddenRatingAsOf: "",
    commonFieldSources: { subjectRating: "manual", ratingAgency: "manual", hiddenRating: "manual" },
    sourceCommonFields: { branch: "广州分行", subjectRating: "AAA", ratingAgency: "中诚信国际", hiddenRating: "AAA" },
  };
  for (const selectedIssuer of [issuer, null]) {
    const applied = applyIssuerCommonFields(manual, selectedIssuer);
    assert.equal(applied.subjectRating, "AA");
    assert.equal(applied.ratingAgency, "联合资信");
    assert.equal(applied.hiddenRating, "AA");
    assert.equal(applied.hiddenRatingSource, "manual");
  }
});

test("F01 removing an issuer selection cannot restore an old brief over explicit external evidence", () => {
  const applied = applyIssuerCommonFields({
    ...projectWithTerm(),
    hiddenRatingSource: "qb-implied-rating",
    hiddenRatingAsOf: "2026-10-25",
    commonFieldSources: { subjectRating: "dm", ratingAgency: "dm", hiddenRating: "qb" },
    sourceCommonFields: { branch: "广州分行", subjectRating: "AAA", ratingAgency: "中诚信国际", hiddenRating: "AAA" },
  }, null);
  assert.equal(applied.subjectRating, "AA");
  assert.equal(applied.ratingAgency, "联合资信");
  assert.equal(applied.hiddenRating, "AA");
  assert.equal(applied.hiddenRatingSource, "qb-implied-rating");
  assert.equal(applied.hiddenRatingAsOf, "2026-10-25");
});

test("F02 month labels, full-width input and whitespace describe the same credit term", () => {
  for (const value of ["18个月", "18月", "18M", "１８ 个 月", " 18 个月期 "]) {
    assert.equal(durationToDays(value), 540, value);
    const parts = durationParts(value);
    assert.equal(parts.length, 1, value);
    assert.equal(durationToDays(parts[0]), 540, value);
  }
  assert.equal(durationToDays("3+2年期"), 3 * 365);
  assert.equal(durationToDays("5+5+5年期"), 5 * 365);
  assert.equal(durationToDays("3+2/5+2年期"), 5 * 365);
  assert.deepEqual(durationParts("3+2/5+2年期").map(durationToDays), [3 * 365, 5 * 365]);
});

test("F02 normalizing an 18-month credit approval applies the overdue AA cap in the final opinion", () => {
  const issuer = issuerWithTerm("18个月");
  const project = projectWithTerm("2年");
  const generated = generateOpinion(project, issuer);
  assert.equal(issuer.credit.investmentTermDays, 540);
  assert.equal(generated.suggestion.suggestedRatio, 15);
  assert.equal(generated.suggestion.investmentAmount, 1.5);
  assert.equal(generated.suggestion.trancheSuggestions[0].exceedsCreditTerm, true);
  assert.match(generated.opinion, /投资比例不超过最终发行规模的15%/);
  assert.match(generated.opinion, /本笔业务期限不覆盖/);
});

test("F02 historical Word credit text with months participates in the same calculation", () => {
  const credit = parseCreditText("总行批20亿，公募，30%，6个月");
  assert.equal(credit.investmentTermText, "6个月");
  assert.equal(credit.investmentTermDays, 180);
  const suggestion = calculateSuggestion(projectWithTerm("1年"), { credit });
  assert.equal(suggestion.suggestedRatio, 15);
  assert.equal(suggestion.trancheSuggestions[0].exceedsCreditTerm, true);
});

test("F02 an unparseable explicit credit term cannot silently reuse old days or emit an actionable recommendation", () => {
  const input = {
    legalName: "审计合成主体有限公司",
    credit: { approvedRatio: 30, investmentTermText: "期限待核实", investmentTermDays: 3 * 365 },
  };
  const normalized = normalizeIssuer(input);
  assert.equal(normalized.credit.investmentTermDays, null);
  for (const issuer of [input, normalized]) {
    const generated = generateOpinion(projectWithTerm("2年"), issuer);
    assert.equal(generated.suggestion.suggestedRatio, null);
    assert.equal(generated.suggestion.investmentAmount, null);
    assert.match(generated.suggestion.warnings.join("；"), /(?:无法|不能|未能|待|缺失).*期限|期限.*(?:无法|不能|未能|待|缺失)/);
    assert.match(generated.warnings.join("；"), /(?:无法|不能|未能|待|缺失).*期限|期限.*(?:无法|不能|未能|待|缺失)/);
    assert.doesNotMatch(generated.opinion, /建议投资金额不超过3亿元/);
    assert.doesNotMatch(generated.opinion, /投资比例不超过最终发行规模的30%/);
  }
});

test("F02 unknown project terms cannot borrow stale parsed parts or cached days", () => {
  const issuer = issuerWithTerm();
  for (const durationText of ["期限待核实", "3++2Y", "3/未知Y", "0个月"]) {
    const project = { ...projectWithTerm(), durationText, durationDays: 365, durationParts: ["1Y"] };
    const result = generateOpinion(project, issuer);
    assert.equal(result.suggestion.suggestedRatio, null, durationText);
    assert.equal(result.suggestion.investmentAmount, null, durationText);
    assert.match(result.warnings.join("；"), /期限.*无法解析/, durationText);
    assert.equal(result.suggestion.trancheSuggestions[0].termCoverageKnown, false);
  }
});

test("F02 missing credit terms remain unconfirmed while legacy numeric-only approvals stay compatible", () => {
  const project = projectWithTerm("2年");
  const missing = calculateSuggestion(project, { credit: { approvedRatio: 30 } });
  assert.equal(missing.suggestedRatio, null);
  assert.equal(missing.investmentAmount, null);
  assert.match(missing.warnings.join("；"), /授信投资期限缺失或无法解析/);
  const legacy = calculateSuggestion(project, { credit: { approvedRatio: 30, investmentTermDays: 540 } });
  assert.equal(legacy.suggestedRatio, 15);
  assert.equal(legacy.trancheSuggestions[0].exceedsCreditTerm, true);
});
