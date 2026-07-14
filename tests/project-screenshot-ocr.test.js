import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeProjectScreenshotOcrPasses,
  parseProjectScreenshotOcrText,
  selectReliableProjectScreenshotSuggestion,
} from "../project-screenshot-ocr.js";

test("parses a standard branch and full bond name without retaining the branch prefix", () => {
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 广州地铁集团有限公司2026年度第六期超短期融资券"),
    [{ branch: "广州分行", fullName: "广州地铁集团有限公司2026年度第六期超短期融资券" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行\n广州地铁集团有限公司2026年度第六期\n超短期融资券"),
    [{ branch: "广州分行", fullName: "广州地铁集团有限公司2026年度第六期超短期融资券" }],
  );
});

test("normalizes table rules and common Chinese OCR substitutions", () => {
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分衍│广州地铁集团有限公司┃2O26年度第六期│超短期融资劵"),
    [{ branch: "广州分行", fullName: "广州地铁集团有限公司2026年度第六期超短期融资券" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("武汉分行｜九州通医药集团股份有限公司｜20Z6年度第一期｜中期票锯品种二"),
    [{ branch: "武汉分行", fullName: "九州通医药集团股份有限公司2026年度第一期中期票据品种二" }],
  );
  for (const separator of ["¦", "┆", "╎", "┊", "丨"]) {
    assert.deepEqual(
      parseProjectScreenshotOcrText(`广州分行${separator}广州地铁集团有限公司${separator}2026年度第六期${separator}超短期融资券`),
      [{ branch: "广州分行", fullName: "广州地铁集团有限公司2026年度第六期超短期融资券" }],
    );
  }
});

test("preserves tranche, repeated-parenthesis, and ABS priority suffixes", () => {
  assert.deepEqual(
    parseProjectScreenshotOcrText("苏州分行 某公司2026年度第一期公司债券(第一期)(品种二)"),
    [{ branch: "苏州分行", fullName: "某公司2026年度第一期公司债券(第一期)(品种二)" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("青岛分行 某资产支持专项计划(普惠金融)优先A1级资产支持证券"),
    [{ branch: "青岛分行", fullName: "某资产支持专项计划(普惠金融)优先A1级资产支持证券" }],
  );
  for (const className of ["优先A2", "次级", "劣后"]) {
    assert.deepEqual(
      parseProjectScreenshotOcrText(`青岛分行 某公司2026年度第一期资产支持专项计划${className}资产支持证券`),
      [{ branch: "青岛分行", fullName: `某公司2026年度第一期资产支持专项计划${className}资产支持证券` }],
    );
  }

  const classes = mergeProjectScreenshotOcrPasses(["优先A1", "优先A2", "次级", "劣后"].map((className) => ({
    label: className,
    confidence: 95,
    text: `青岛分行 某公司2026年度第一期资产支持专项计划${className}资产支持证券`,
  })));
  assert.equal(classes.length, 4);
});

test("refuses to guess row relationships when OCR returns whole columns separately", () => {
  const detachedColumns = [
    "广州分行",
    "武汉分行",
    "广州地铁集团有限公司2026年度第六期超短期融资券",
    "九州通医药集团股份有限公司2026年度第一期中期票据",
  ].join("\n");
  assert.deepEqual(parseProjectScreenshotOcrText(detachedColumns), []);
});

test("does not turn real non-target branches into target branches by fuzzy city matching", () => {
  for (const branch of ["广安分行", "宿州分行", "徐州分行", "延安分行", "太仓分行"]) {
    assert.deepEqual(
      parseProjectScreenshotOcrText(`${branch} 某公司2026年度第一期中期票据`),
      [],
    );
  }
});

test("uses cross-pass consensus without merging distinct tranches", () => {
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "soft", confidence: 89, text: "广州分行 广州地铁集团有限公司2O26年度第六期超短期融资劵" },
    { label: "binary", confidence: 94, text: "广州分行 广州地铁集团有限公司2026年度第六期超短期融资券" },
    { label: "row-a", confidence: 92, text: "武汉分行 某公司2026年度第一期中期票据品种一" },
    { label: "row-b", confidence: 91, text: "武汉分行 某公司2026年度第一期中期票据品种二" },
  ]);

  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0], {
    branch: "广州分行",
    fullName: "广州地铁集团有限公司2026年度第六期超短期融资券",
    ocrConfidence: 94,
    ocrVotes: 2,
  });
  assert.deepEqual(merged.slice(1).map((entry) => entry.fullName), [
    "某公司2026年度第一期中期票据品种一",
    "某公司2026年度第一期中期票据品种二",
  ]);
});

test("keeps different issue periods and A/B varieties separate", () => {
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "issue-1", confidence: 95, text: "广州分行 某公司2026年度第一期中期票据" },
    { label: "issue-2", confidence: 95, text: "广州分行 某公司2026年度第二期中期票据" },
    { label: "tranche-a", confidence: 95, text: "武汉分行 某公司2026年度第三期中期票据A" },
    { label: "tranche-b", confidence: 95, text: "武汉分行 某公司2026年度第三期中期票据B" },
  ]);
  assert.deepEqual(merged.map((entry) => entry.fullName), [
    "某公司2026年度第一期中期票据",
    "某公司2026年度第二期中期票据",
    "某公司2026年度第三期中期票据A",
    "某公司2026年度第三期中期票据B",
  ]);

  const decorated = mergeProjectScreenshotOcrPasses([
    { label: "decorated-a", confidence: 95, text: "广州分行 某公司2026年度第三期中期票据品种A(科创票据)" },
    { label: "decorated-b", confidence: 95, text: "广州分行 某公司2026年度第三期中期票据品种B(科创票据)" },
  ]);
  assert.equal(decorated.length, 2);
});

test("does not merge different no-year ABS series", () => {
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "abs-1", confidence: 95, text: "青岛分行 某公司第一号资产支持专项计划优先A1资产支持证券" },
    { label: "abs-2", confidence: 95, text: "青岛分行 某公司第二号资产支持专项计划优先A1资产支持证券" },
  ]);
  assert.equal(merged.length, 2);
});

test("expands compact dual-variety OCR without losing either side", () => {
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 某公司2026年度第三期中期票据A/B"),
    [
      { branch: "广州分行", fullName: "某公司2026年度第三期中期票据A" },
      { branch: "广州分行", fullName: "某公司2026年度第三期中期票据B" },
    ],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 某公司2026年度第三期中期票据品种一/品种二"),
    [
      { branch: "广州分行", fullName: "某公司2026年度第三期中期票据品种一" },
      { branch: "广州分行", fullName: "某公司2026年度第三期中期票据品种二" },
    ],
  );
});

test("keeps multiple projects from the same branch as separate rows", () => {
  const merged = mergeProjectScreenshotOcrPasses([{
    label: "row-cells",
    confidence: 93,
    text: [
      "太原分行 某城投集团有限公司2026年度第一期中期票据",
      "太原分行 某交投集团有限公司2026年度第二期超短期融资券",
    ].join("\n"),
  }]);

  assert.deepEqual(merged.map((entry) => entry.fullName), [
    "某城投集团有限公司2026年度第一期中期票据",
    "某交投集团有限公司2026年度第二期超短期融资券",
  ]);

  const similarIssuers = mergeProjectScreenshotOcrPasses([
    { label: "issuer-1", confidence: 93, text: "广州分行 广州城市建设投资集团有限公司2026年度第一期中期票据" },
    { label: "issuer-2", confidence: 93, text: "广州分行 广州城市开发投资集团有限公司2026年度第一期中期票据" },
  ]);
  assert.equal(similarIssuers.length, 2);
});

test("segments repeated branches and carries merged branch cells forward", () => {
  const first = "广州地铁集团有限公司2026年度第六期超短期融资券";
  const second = "广州产业投资控股集团有限公司2026年度第三期中期票据";
  assert.deepEqual(parseProjectScreenshotOcrText(`广州分行 ${first} 广州分行 ${second}`), [
    { branch: "广州分行", fullName: first },
    { branch: "广州分行", fullName: second },
  ]);
  assert.deepEqual(parseProjectScreenshotOcrText(`广州分行 ${first}\n${second}`), [
    { branch: "广州分行", fullName: first },
    { branch: "广州分行", fullName: second },
  ]);
  const abs = "某公司第一号资产支持专项计划优先A1资产支持证券";
  assert.deepEqual(parseProjectScreenshotOcrText(`青岛分行 ${first}\n${abs}`), [
    { branch: "青岛分行", fullName: first },
    { branch: "青岛分行", fullName: abs },
  ]);

  assert.deepEqual(parseProjectScreenshotOcrText([
    `广州分行 ${first}`,
    "项目表说明",
    second,
  ].join("\n")), [
    { branch: "广州分行", fullName: first },
  ]);
});

test("prefers the nearest completed bond name after a wrapped branch row", () => {
  assert.deepEqual(parseProjectScreenshotOcrText([
    "广州分行 广州地铁集团有限公司2026年度",
    "第六期超短期融资券",
    "广州产业投资控股集团有限公司2026年度第三期中期票据",
  ].join("\n")), [
    { branch: "广州分行", fullName: "广州地铁集团有限公司2026年度第六期超短期融资券" },
  ]);
});

test("only selects a unique high-confidence DM correction candidate", () => {
  const ocrName = "广州地铁集困有限公司2026年度第六期超短期融资券";
  const exact = {
    score: 97,
    shortName: "26广州地铁SCP006",
    securityId: "102600001.IB",
    fullName: "广州地铁集团有限公司2026年度第六期超短期融资券",
  };
  assert.equal(selectReliableProjectScreenshotSuggestion(ocrName, [exact])?.shortName, exact.shortName);
  assert.equal(selectReliableProjectScreenshotSuggestion(ocrName, [{ ...exact, score: 89 }]), null);

  const ambiguous = [
    { ...exact, shortName: "26广州地铁MTN003A", securityId: "102600003.IB" },
    { ...exact, shortName: "26广州地铁MTN003B", securityId: "102600004.IB" },
  ];
  assert.equal(selectReliableProjectScreenshotSuggestion(ocrName, ambiguous), null);

  const trancheQuery = "广州产业投资控股集团有限公司2026年度第三期中期票据品种二";
  assert.equal(selectReliableProjectScreenshotSuggestion(trancheQuery, [{
    ...exact,
    score: 98,
    fullName: "广州产业投资控股集团有限公司2026年度第三期中期票据品种一",
  }]), null);
  assert.equal(selectReliableProjectScreenshotSuggestion(trancheQuery, [{
    ...exact,
    score: 98,
    fullName: "广州产业投资控股集团有限公司2026年度第四期中期票据品种二",
  }]), null);

  const wrongIssuerQuery = "广州城市建设投资集团有限公司2026年度第一期中期票据";
  assert.equal(selectReliableProjectScreenshotSuggestion(wrongIssuerQuery, [{
    ...exact,
    score: 93,
    fullName: "广州城市开发投资集团有限公司2026年度第一期中期票据",
  }]), null);

  const oneCharacterIssuerQuery = "某县城市建设投资集团有限公司2026年度第一期中期票据";
  assert.equal(selectReliableProjectScreenshotSuggestion(oneCharacterIssuerQuery, [{
    ...exact,
    score: 99,
    fullName: "某市城市建设投资集团有限公司2026年度第一期中期票据",
  }]), null);

  const noTrancheQuery = "广州产业投资控股集团有限公司2026年度第三期中期票据";
  assert.equal(selectReliableProjectScreenshotSuggestion(noTrancheQuery, [{
    ...exact,
    score: 98,
    shortName: "26广州产投MTN003B",
    fullName: noTrancheQuery,
  }]), null);


  const noTrancheCpQuery = "某公司2026年度第三期短期融资券";
  assert.equal(selectReliableProjectScreenshotSuggestion(noTrancheCpQuery, [{
    ...exact,
    score: 98,
    shortName: "26某公司CP003B",
    fullName: noTrancheCpQuery,
  }]), null);
});

test("treats official variety labels and Chinese issue numbers as structural equivalents", () => {
  const cases = [
    ["某公司2026年度第三期中期票据A", "某公司2026年度第三期中期票据品种一"],
    ["某公司2026年度第三期中期票据B", "某公司2026年度第三期中期票据品种二"],
    ["某公司2026年度第3期中期票据", "某公司2026年度第三期中期票据"],
    ["某公司2026年度第十期中期票据", "某公司2026年度第10期中期票据"],
    ["某公司2026年度第三期中期票据品种2", "某公司2026年度第三期中期票据品种二"],
  ];
  for (const [query, candidate] of cases) {
    const selected = selectReliableProjectScreenshotSuggestion(query, [{
      score: 98,
      shortName: "26测试MTN003",
      securityId: "102600099.IB",
      fullName: candidate,
    }]);
    assert.equal(selected?.fullName, candidate);
  }
});
