import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBondFullName,
  calculateSuggestion,
  determineApprover,
  durationToDays,
  generateOpinion,
  mergeImportedIssuers,
  parseProjectBrief,
  splitProjectBriefs,
} from "../core.js";

const issuer = {
  legalName: "广州交通投资集团有限公司",
  aliases: ["粤交投"],
  defaultBranch: "广州分行",
  isRealEstate: false,
  credit: {
    approvalLevel: "总行",
    approvedAmount: 20,
    offeringType: "公募",
    approvedRatio: 30,
    investmentTermText: "3年",
    investmentTermDays: 1095,
    rawText: "总行批20亿，公募，30%，3年",
  },
};

const sample = `26粤交投SCP002 非我行主承 广州分行
270D 规模7亿 AAA(中诚信国际)/隐含AAA
询价区间1.25-1.45 银行间 中信银行

26粤交投SCP002 市场估值约1.46
如需综合定价，指导价约1.48`;

test("parses the sample project brief", () => {
  const parsed = parseProjectBrief(sample);
  assert.equal(parsed.shortName, "26粤交投SCP002");
  assert.equal(parsed.durationDays, 270);
  assert.equal(parsed.issueScale, 7);
  assert.equal(parsed.subjectRating, "AAA");
  assert.equal(parsed.ratingAgency, "中诚信国际");
  assert.equal(parsed.hiddenRating, "AAA");
  assert.equal(parsed.leadUnderwriter, "中信银行");
});

test("builds standard interbank bond full name", () => {
  assert.equal(
    buildBondFullName("26粤交投SCP002", issuer.legalName),
    "广州交通投资集团有限公司2026年度第二期超短期融资券",
  );
});

test("builds exchange bond full names when offering type is known", () => {
  assert.equal(
    buildBondFullName("26国创G2", "昆山国创投资集团有限公司", { venue: "上交所", offeringType: "公募" }),
    "昆山国创投资集团有限公司2026年面向专业投资者公开发行公司债券(第二期)",
  );
  assert.equal(
    buildBondFullName("26吴发F2", "江苏省吴中经济技术发展集团有限公司", { venue: "上交所", offeringType: "私募" }),
    "江苏省吴中经济技术发展集团有限公司2026年面向专业投资者非公开发行公司债券(第二期)",
  );
  assert.equal(
    buildBondFullName("26苏轨04", "苏州市轨道交通集团有限公司", { venue: "上交所", offeringType: "公募" }),
    "苏州市轨道交通集团有限公司2026年面向专业投资者公开发行公司债券(第四期)",
  );
  assert.equal(
    buildBondFullName("26发展01", "山东发展投资控股集团有限公司", { venue: "上交所", offeringType: "公募" }),
    "山东发展投资控股集团有限公司2026年面向专业投资者公开发行公司债券(第一期)",
  );
  assert.equal(
    buildBondFullName("26示例K1", "示例有限公司", { venue: "上交所", offeringType: "公募" }),
    "",
  );
});

test("parses explicit exchange offering type and only weakly infers G or F series", () => {
  const explicit = parseProjectBrief("26发展01 非我行主承 济南分行\n3年期 规模10亿 AAA(联合资信)/隐含AAA 公开\n询价区间1.5-2.5 上交所 中信证券");
  assert.equal(explicit.offeringType, "公募");
  assert.equal(explicit.offeringTypeSource, "explicit");
  assert.equal(explicit.leadUnderwriter, "中信证券");

  const inferred = parseProjectBrief("26吴发F2 非我行主承 苏州分行\n3年期 规模5亿 AAA(联合资信)/隐含AA+\n询价区间1.8-2.8 上交所 东吴证券");
  assert.equal(inferred.offeringType, "私募");
  assert.equal(inferred.offeringTypeSource, "short-name");
  assert.match(inferred.warnings.join(""), /请确认/);

  const unknown = parseProjectBrief("26苏轨04 非我行主承 苏州分行\n3年期 规模5亿 AAA(联合资信)/隐含AAA\n询价区间1.8-2.8 上交所 中信证券");
  assert.equal(unknown.offeringType, "");
  assert.match(unknown.warnings.join(""), /无法仅凭简称可靠判断/);
  assert.equal(calculateSuggestion(unknown, issuer).suggestedRatio, null);

  const privateExchange = parseProjectBrief("26吴发F2 非我行主承 苏州分行\n3年期 规模5亿 AAA(联合资信)/隐含AA+ 非公开\n询价区间1.8-2.8 上交所 东吴证券");
  assert.equal(calculateSuggestion(privateExchange, {
    ...issuer,
    credit: { ...issuer.credit, approvedRatio: 30, privateRatio: 20 },
  }).suggestedRatio, 20);
});

test("uses approved ratio for non-bank-led sample", () => {
  const suggestion = calculateSuggestion(parseProjectBrief(sample), issuer);
  assert.equal(suggestion.suggestedRatio, 30);
  assert.equal(suggestion.investmentAmount, 2.1);
});

test("caps Xingye-led investments at 20 percent", () => {
  const project = { ...parseProjectBrief(sample), sponsorStatus: "牵头" };
  const suggestion = calculateSuggestion(project, issuer);
  assert.equal(suggestion.suggestedRatio, 20);
  assert.equal(suggestion.investmentAmount, 1.4);
});

test("caps overdue AA and AA(2) bonds", () => {
  const base = { ...parseProjectBrief(sample), durationDays: 1460 };
  assert.equal(calculateSuggestion({ ...base, hiddenRating: "AA" }, issuer).suggestedRatio, 15);
  assert.equal(calculateSuggestion({ ...base, hiddenRating: "AA(2)" }, issuer).suggestedRatio, 10);
});

test("uses the longest possible term for option and dual-tranche durations", () => {
  assert.equal(durationToDays("3+2年期"), 5 * 365);
  assert.equal(durationToDays("3+2/5+2年期"), 7 * 365);
  const parsed = parseProjectBrief("26广城04 非我行主承 广州分行\n3+2/5+2年期 规模19亿 AAA(中诚信国际)/隐含AAA-\n询价区间1.5-2.5 上交所 中信证券");
  assert.equal(parsed.durationDays, 7 * 365);
  assert.equal(parsed.hiddenRating, "AAA-");
});

test("splits multiple project briefs by their project headers", () => {
  const blocks = splitProjectBriefs(`${sample}

26神木国资MTN001 非我行主承 西安分行
3+2年期 规模15亿 AAA(中证鹏元)/隐含AA(2)
询价区间1.5-2.5 银行间 广发证券

26神木国资MTN001 市场估值约1.90`);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /26粤交投SCP002/);
  assert.match(blocks[1], /26神木国资MTN001/);
});

test("applies approval thresholds and real estate override", () => {
  assert.equal(determineApprover("AAA", 8, false), "本笔业务由处室终批。");
  assert.equal(determineApprover("AAA", 8.01, false), "本笔业务由金处终批。");
  assert.equal(determineApprover("AAA", 10.01, false), "本笔业务由周总终批。");
  assert.equal(determineApprover("AA+", 3.21, false), "本笔业务由金处终批。");
  assert.equal(determineApprover("AA+", 4.01, false), "本笔业务由周总终批。");
  assert.equal(determineApprover("AAA", 20, true), "本笔为房地产债业务，由林总终批。");
});

test("generates a complete opinion while leaving bid rate blank", () => {
  const generated = generateOpinion(parseProjectBrief(sample), issuer);
  assert.match(generated.opinion, /广州交通投资集团有限公司2026年度第二期超短期融资券/);
  assert.match(generated.opinion, /拟申请投资金额不超过2.1亿元/);
  assert.match(generated.opinion, /一级投标利率不低于【待填写】%/);
  assert.match(generated.opinion, /本笔业务由处室终批。/);
});

test("keeps the newest imported credit record based on document order", () => {
  const state = mergeImportedIssuers({ version: 1, issuers: [] }, [
    { ...issuer, id: "new", credit: { ...issuer.credit, rawText: "最新授信", sourceRank: 0 } },
    { ...issuer, id: "old", credit: { ...issuer.credit, rawText: "旧授信", sourceRank: 10 } },
  ]);
  assert.equal(state.issuers.length, 1);
  assert.equal(state.issuers[0].credit.rawText, "最新授信");
});
