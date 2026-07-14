import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseProjectScreenshotRowsWithVerifiedMatches,
  groupProjectScreenshotOcrPhysicalRows,
  mergeProjectScreenshotOcrPasses,
  parseProjectScreenshotOcrText,
  selectReliableProjectScreenshotSuggestion,
} from "../project-screenshot-ocr.js";

test("rebuilds physical OCR rows from Tesseract bounding boxes", () => {
  assert.deepEqual(groupProjectScreenshotOcrPhysicalRows([
    { text: "债券全称", confidence: 96, bbox: { x0: 240, y0: 10, x1: 420, y1: 42 } },
    { text: "广州地铁集团有限公司2026年度第六期超短期融资券", confidence: 88, bbox: { x0: 240, y0: 64, x1: 980, y1: 102 } },
    { text: "广州分行", confidence: 91, bbox: { x0: 30, y0: 67, x1: 150, y1: 99 } },
    { text: "武汉分行", confidence: 90, bbox: { x0: 30, y0: 126, x1: 150, y1: 160 } },
    { text: "九州通医药集团股份有限公司2026年度第一期中期票据", confidence: 87, bbox: { x0: 240, y0: 123, x1: 990, y1: 163 } },
  ]).map((row) => row.text), [
    "债券全称",
    "广州分行 广州地铁集团有限公司2026年度第六期超短期融资券",
    "武汉分行 九州通医药集团股份有限公司2026年度第一期中期票据",
  ]);
});

test("does not let an abnormally tall OCR box bridge adjacent physical rows", () => {
  const rows = groupProjectScreenshotOcrPhysicalRows([
    { text: "青岛分行", confidence: 93, bbox: { x0: 10, y0: 10, x1: 130, y1: 160 } },
    { text: "青岛西海岸新区海洋控股集团有限公司2026年度第一期中期票据", confidence: 93, bbox: { x0: 200, y0: 12, x1: 980, y1: 45 } },
    { text: "青岛西海岸新区海运控股集团有限公司2026年度第一期中期票据", confidence: 93, bbox: { x0: 200, y0: 82, x1: 980, y1: 115 } },
  ]);

  assert.deepEqual(rows.map((row) => row.text), [
    "青岛分行 青岛西海岸新区海洋控股集团有限公司2026年度第一期中期票据",
    "青岛分行 青岛西海岸新区海运控股集团有限公司2026年度第一期中期票据",
  ]);
});

test("does not append a second complete project to an incomplete previous row", () => {
  const rows = groupProjectScreenshotOcrPhysicalRows([
    { text: "广州分行 某公司2026年度第一期", confidence: 82, bbox: { x0: 10, y0: 10, x1: 650, y1: 42 } },
    { text: "另一公司2026年度第二期中期票据", confidence: 91, bbox: { x0: 200, y0: 62, x1: 900, y1: 96 } },
  ]);

  assert.deepEqual(rows.map((row) => row.text), [
    "广州分行 某公司2026年度第一期",
    "另一公司2026年度第二期中期票据",
  ]);
});

test("retains a branch context for later complete projects after an incomplete row", () => {
  assert.deepEqual(parseProjectScreenshotOcrText([
    "广州分行 某公司2026年度第一期",
    "另一公司2026年度第二期中期票据",
    "第三公司2026年度第三期中期票据",
  ].join("\n")), [
    { branch: "广州分行", fullName: "另一公司2026年度第二期中期票据" },
    { branch: "广州分行", fullName: "第三公司2026年度第三期中期票据" },
  ]);
});

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
  assert.deepEqual(
    parseProjectScreenshotOcrText("广洲分行 某公司2O25年度第三期中期票居"),
    [{ branch: "广州分行", fullName: "某公司2025年度第三期中期票据" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 某公司2O2G年度第一期公司债劵"),
    [{ branch: "广州分行", fullName: "某公司2026年度第一期公司债券" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("武式分行 九州通医药集团股份有限公同2O2S年度第l期资产文持票居"),
    [{ branch: "武汉分行", fullName: "九州通医药集团股份有限公司2025年度第1期资产支持票据" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("兰洲分打 兰州城市发展投资有限公司2026年度第1O期定向债券融资工具"),
    [{ branch: "兰州分行", fullName: "兰州城市发展投资有限公司2026年度第10期定向债务融资工具" }],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("青岛分行 某公司2O2B年度第B期永读中期票据"),
    [{ branch: "青岛分行", fullName: "某公司2028年度第8期永续中期票据" }],
  );
});

test("recognizes financial and capital bond families", () => {
  const inputs = [
    "招商银行股份有限公司2026年第一期二级资本债券",
    "中国银行股份有限公司2026年第一期无固定期限资本债券",
    "兴业银行股份有限公司2026年第一期金融债券",
    "某金融租赁有限公司2026年第一期次级债券",
    "某保险公司2026年第一期资本补充债券",
    "某商业银行2026年第一期混合资本债券",
  ];
  assert.deepEqual(
    parseProjectScreenshotOcrText(inputs.map((name) => `武汉分行 ${name}`).join("\n")),
    inputs.map((fullName) => ({ branch: "武汉分行", fullName })),
  );
});

test("rejects ordinary no-year descriptions while retaining structured no-year ABS names", () => {
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 本周计划发行中期票据 项目共5单"),
    [],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 本周计划发行CP 项目共5单"),
    [],
  );
  assert.deepEqual(
    parseProjectScreenshotOcrText("青岛分行 中信证券-中电投租赁1期资产支持专项计划优先A1级资产支持证券"),
    [{ branch: "青岛分行", fullName: "中信证券-中电投租赁1期资产支持专项计划优先A1级资产支持证券" }],
  );
  assert.deepEqual(parseProjectScreenshotOcrText("广州分行 2026年度第一期中期票据项目汇总"), []);
  assert.deepEqual(parseProjectScreenshotOcrText("青岛分行 本期第一号资产支持专项计划项目清单"), []);
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
  for (const className of ["优先A2", "次级", "劣后", "夹层", "中间级", "权益级"]) {
    assert.deepEqual(
      parseProjectScreenshotOcrText(`青岛分行 某公司2026年度第一期资产支持专项计划${className}资产支持证券`),
      [{ branch: "青岛分行", fullName: `某公司2026年度第一期资产支持专项计划${className}资产支持证券` }],
    );
  }

  const classes = mergeProjectScreenshotOcrPasses(["优先A1", "优先A2", "次级", "劣后", "夹层", "中间级", "权益级"].map((className) => ({
    label: className,
    confidence: 95,
    text: `青岛分行 某公司2026年度第一期资产支持专项计划${className}资产支持证券`,
  })));
  assert.equal(classes.length, 7);
  assert.deepEqual(
    parseProjectScreenshotOcrText("青岛分行 中信证券-中电投租赁1期资产支持专项计划夹层资产支持证券"),
    [{ branch: "青岛分行", fullName: "中信证券-中电投租赁1期资产支持专项计划夹层资产支持证券" }],
  );
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

test("never merges or auto-corrects bonds with different structural features", () => {
  const issuer = "青岛城市建设投资集团有限公司";
  const perpetual = `${issuer}2025年度第二期永续中期票据`;
  const ordinary = `${issuer}2025年度第二期中期票据`;
  assert.equal(mergeProjectScreenshotOcrPasses([
    { label: "perpetual", confidence: 93, text: `青岛分行 ${perpetual}` },
    { label: "ordinary", confidence: 94, text: `青岛分行 ${ordinary}` },
  ]).length, 2);

  const green = "广州越秀新能源投资有限公司2026年度第一期绿色中期票据";
  const tech = "广州越秀新能源投资有限公司2026年度第一期科创中期票据";
  assert.equal(selectReliableProjectScreenshotSuggestion(green, [{
    score: 99,
    shortName: "26越秀新能源MTN001",
    securityId: "102600001.IB",
    fullName: tech,
  }]), null);
  assert.equal(selectReliableProjectScreenshotSuggestion(
    "某公司2026年面向专业投资者公开发行可续期公司债券(第一期)",
    [{
      score: 99,
      shortName: "26某公司01",
      securityId: "123456.SH",
      fullName: "某公司2026年面向专业投资者公开发行公司债券(第一期)",
    }],
  ), null);

  const guaranteed = "某公司2026年面向专业投资者公开发行有担保公司债券(第一期)";
  const unsecured = "某公司2026年面向专业投资者公开发行无担保公司债券(第一期)";
  assert.equal(mergeProjectScreenshotOcrPasses([
    { label: "guaranteed", confidence: 93, text: `青岛分行 ${guaranteed}` },
    { label: "unsecured", confidence: 94, text: `青岛分行 ${unsecured}` },
  ]).length, 2);
  assert.equal(selectReliableProjectScreenshotSuggestion(guaranteed, [{
    score: 99,
    shortName: "26某公司01",
    securityId: "123456.SH",
    fullName: unsecured,
  }]), null);

  const publicBond = "苏州高新集团有限公司2026年面向专业投资者公开发行公司债券(第一期)";
  const privateBond = "苏州高新集团有限公司2026年面向专业投资者非公开发行公司债券(第一期)";
  assert.equal(mergeProjectScreenshotOcrPasses([
    { label: "public", confidence: 94, text: `苏州分行 ${publicBond}` },
    { label: "private", confidence: 94, text: `苏州分行 ${privateBond}` },
  ]).length, 2);
  assert.equal(selectReliableProjectScreenshotSuggestion(publicBond, [{
    score: 99,
    shortName: "26苏高01",
    securityId: "123456.SH",
    fullName: privateBond,
  }]), null);

  for (const [left, right] of [
    ["某公司2026年无抵押公司债券", "某公司2026年抵押公司债券"],
    ["某公司2026年抵质押公司债券", "某公司2026年质押公司债券"],
    ["某公司2026年非次级公司债券", "某公司2026年次级公司债券"],
    ["某公司2026年保证公司债券", "某公司2026年普通公司债券"],
    ["某公司2026年递延付息中期票据", "某公司2026年普通中期票据"],
  ]) {
    assert.equal(mergeProjectScreenshotOcrPasses([
      { label: "left", confidence: 92, text: `青岛分行 ${left}` },
      { label: "right", confidence: 93, text: `青岛分行 ${right}` },
    ]).length, 2, `${left} and ${right} must remain separate`);
  }
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
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 某公司2026年度第三期中期票据品种一/二"),
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

  assert.deepEqual(parseProjectScreenshotOcrText([
    `广州分行 ${first}`,
    "广州产业投资控股集团有限公司2026年度第三期",
    "中期票据",
  ].join("\n")), [
    { branch: "广州分行", fullName: first },
    { branch: "广州分行", fullName: "广州产业投资控股集团有限公司2026年度第三期中期票据" },
  ]);

  assert.deepEqual(parseProjectScreenshotOcrText([
    `广州分行 ${first}`,
    "广州产业投资控股集团有限公司",
    "2026年度第三期",
    "中期",
    "票据",
  ].join("\n")), [
    { branch: "广州分行", fullName: first },
    { branch: "广州分行", fullName: "广州产业投资控股集团有限公司2026年度第三期中期票据" },
  ]);
});

test("retains a tranche when OCR drops the closing parenthesis", () => {
  assert.deepEqual(
    parseProjectScreenshotOcrText("广州分行 某公司2026年度第三期中期票据(品种二"),
    [{ branch: "广州分行", fullName: "某公司2026年度第三期中期票据(品种二" }],
  );
});

test("only tolerates issuer OCR drift within the same detected row", () => {
  const first = "某县城市建设投资集团有限公司2026年度第一期中期票据";
  const second = "某市城市建设投资集团有限公司2026年度第一期中期票据";
  assert.equal(mergeProjectScreenshotOcrPasses([
    { label: "row-soft", sourceKey: "row:7", confidence: 88, text: `广州分行 ${first}` },
    { label: "row-binary", sourceKey: "row:7", confidence: 93, text: `广州分行 ${second}` },
  ]).length, 1);
  assert.equal(mergeProjectScreenshotOcrPasses([
    { label: "row-7", sourceKey: "row:7", confidence: 88, text: `广州分行 ${first}` },
    { label: "row-8", sourceKey: "row:8", confidence: 93, text: `广州分行 ${second}` },
  ]).length, 2);
});

test("treats nearby global OCR y-coordinates as the same physical row", () => {
  const wrong = "青岛西海岸新区海坟控股集团有限公司2026年度第二期短期融资券";
  const correct = "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资券";
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "narrow", sourceKey: "source-y:520:104", confidence: 76, text: `青岛分行 ${wrong}` },
    { label: "wide", sourceKey: "source-y:568:177", confidence: 94, text: `青岛分行 ${correct}` },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.fullName, correct);
});

test("keeps compact adjacent physical rows independent", () => {
  const first = "青岛海洋控股集团有限公司2026年度第二期短期融资券";
  const second = "青岛海运控股集团有限公司2026年度第二期短期融资券";
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "row-1", sourceKey: "source-y:100:18", confidence: 94, text: `青岛分行 ${first}` },
    { label: "row-2", sourceKey: "source-y:119:18", confidence: 94, text: `青岛分行 ${second}` },
  ]);
  assert.equal(merged.length, 2);
});

test("drops a short OCR artifact prefixed to an otherwise complete bond name", () => {
  const correct = "广州产业投资控股集团有限公司2026年度第三期中期票据品种A";
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "column", confidence: 80, text: `广州分行 人4一${correct}` },
    { label: "row", confidence: 94, text: `广州分行 ${correct}` },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.fullName, correct);
});

test("a physical row bridge collapses an earlier exact-name cluster", () => {
  const wrong = "青岛西海岸新区海坟控股集团有限公司2026年度第二期短期融资券";
  const correct = "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资券";
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "row-soft", sourceKey: "row:4", confidence: 73, text: `青岛分行 ${wrong}` },
    { label: "column", sourceKey: "column:1", confidence: 90, text: `青岛分行 ${correct}` },
    { label: "row-binary", sourceKey: "row:4", confidence: 94, text: `青岛分行 ${correct}` },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.fullName, correct);
});

test("a later layout pass reuses every name observed in a physical-row cluster", () => {
  const wrong = "青岛西海岸新区海坟控股集团有限公司2026年度第二期短期融资券";
  const correct = "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资券";
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "row-soft", sourceKey: "row:4", confidence: 75, text: `青岛分行 ${wrong}` },
    { label: "row-binary", sourceKey: "row:4", confidence: 89, text: `青岛分行 ${correct}` },
    { label: "layout", sourceKey: "region:1:layout", confidence: 94, text: `青岛分行 ${correct}` },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.fullName, correct);
});

test("a physical row tolerates a one-character error in a short issuer", () => {
  const wrong = "苏州资产过理有限公司2026年度第一期资产支持票据(优先A)";
  const correct = "苏州资产管理有限公司2026年度第一期资产支持票据(优先A)";
  const merged = mergeProjectScreenshotOcrPasses([
    { label: "row-soft", sourceKey: "row:6", confidence: 79, text: `苏州分行 ${wrong}` },
    { label: "row-binary", sourceKey: "row:6", confidence: 94, text: `苏州分行 ${correct}` },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.fullName, correct);
});

test("deduplicates only independently DM-verified rows with the same security", () => {
  const wrong = "青岛西海岸新区海坟控股集团有限公司2026年度第二期短期融资券";
  const correct = "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资券";
  const rows = collapseProjectScreenshotRowsWithVerifiedMatches([
    {
      id: "wrong",
      branch: "青岛分行",
      status: "error",
      dmVerified: false,
      draftFullName: wrong,
      candidateSecurityId: "102600001.IB",
    },
    {
      id: "correct",
      branch: "青岛分行",
      status: "ok",
      dmVerified: true,
      draftFullName: correct,
      verifiedFullName: correct,
      verifiedSecurityId: "102600001.IB",
    },
    { id: "manual", branch: "青岛分行", status: "draft", dmVerified: false, isManual: true, draftFullName: wrong },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["wrong", "correct", "manual"]);

  const bothVerified = collapseProjectScreenshotRowsWithVerifiedMatches([
    { id: "one", branch: "青岛分行", status: "ok", dmVerified: true, verifiedFullName: wrong, verifiedSecurityId: "same-id" },
    { id: "two", branch: "青岛分行", status: "ok", dmVerified: true, verifiedFullName: correct, verifiedSecurityId: "same-id" },
  ]);
  assert.deepEqual(bothVerified.map((row) => row.id), ["one"]);

  const similarButDifferent = collapseProjectScreenshotRowsWithVerifiedMatches([
    {
      id: "green",
      branch: "广州分行",
      status: "ok",
      dmVerified: true,
      verifiedFullName: "某公司2026年度第一期绿色中期票据",
      verifiedSecurityId: "green-id",
    },
    {
      id: "tech",
      branch: "广州分行",
      status: "error",
      dmVerified: false,
      draftFullName: "某公司2026年度第一期科创中期票据",
      candidateSecurityId: "tech-id",
    },
  ]);
  assert.deepEqual(similarButDifferent.map((row) => row.id), ["green", "tech"]);
});

test("replays text captured from a real multi-pass Chinese Tesseract table run", () => {
  const passes = [
    {
      label: "目标列稀疏识别",
      sourceKey: "region:0:0",
      confidence: 89,
      text: [
        "分行",
        "债卷全称",
        "广州产业投资控股集团有限公司2026年度第三期中期票据(品种A/",
        "广州分行",
        "B)",
        "武汉分行",
        "武汉金融控股(集团)有限公司2026年度第一期中期票据",
        "青鸟分行",
        "青岛西海岸新区海坟控股集团有限公司2026年度第二期短期融资",
        "券",
        "兰州分行",
        "兰州城市发展投资有限公司2026年度第一期超短期融资券",
        "苏州分行",
        "苏州资产管理有限公司2026年度第一期资产文持票据(优先A)",
        "太原分行",
        "太原国有投资集团有限公司2026年度第二期定向债务融资工具",
        "西安分行",
        "西安产业投资集团有限公司2026年度第一期公司债券",
        "广州分行",
        "广州交通投资集团有限公司2026年度第四期短期融资券",
      ].join("\n\n"),
    },
    {
      label: "全表稀疏识别",
      sourceKey: "region:1:0",
      confidence: 92,
      text: [
        "分行", "债券全称", "期限", "规模", "状态",
        "广州产业投资控股集团有限公司2026年度第三期中期票据(品种A/",
        "广州分行", "3Y/5Y", "16亿", "未投标", "B)", "3Y",
        "武汉分行", "武汉金融控股(集团)有限公司2026年度第一期中期票据", "10亿", "未投标",
        "青岛分行", "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资", "270D", "10亿", "待投标", "券",
        "兰州分行", "兰州城市发展投资有限公司2026年度第一期超短期融资券", "180D", "8亿", "待投标",
        "苏州分行", "苏州资产管理有限公司2026年度第一期资产支持票据(优先A)", "2Y", "12亿", "未投标",
        "太原分行", "太原国有投资集团有限公司2026年度第二期定向债务融资工具", "3Y", "6亿", "未投标",
        "西安分行", "西安产业投资集团有限公司2026年度第一期公司债券", "5Y", "15亿", "待投标",
        "广州分行", "广州交通投资集团有限公司2026年度第四期短期融资券", "1Y", "9亿", "未投标",
      ].join("\n\n"),
    },
  ];
  const correctQingdao = "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资券";
  const rows = mergeProjectScreenshotOcrPasses(passes).map((entry, index) => ({
    ...entry,
    id: `ocr-${index}`,
    status: entry.fullName === correctQingdao ? "ok" : "error",
    dmVerified: entry.fullName === correctQingdao,
    draftFullName: entry.fullName,
    verifiedFullName: entry.fullName === correctQingdao ? entry.fullName : "",
    verifiedSecurityId: entry.fullName === correctQingdao ? "102600001.IB" : "",
    candidateSecurityId: entry.fullName.includes("海坟") ? "102600001.IB" : "",
  }));
  const finalRows = collapseProjectScreenshotRowsWithVerifiedMatches(rows);
  assert.deepEqual(finalRows.map((row) => `${row.branch}|${row.fullName}`), [
    "广州分行|广州产业投资控股集团有限公司2026年度第三期中期票据品种A",
    "广州分行|广州产业投资控股集团有限公司2026年度第三期中期票据品种B",
    "广州分行|广州交通投资集团有限公司2026年度第四期短期融资券",
    "武汉分行|武汉金融控股(集团)有限公司2026年度第一期中期票据",
    "青岛分行|青岛西海岸新区海坟控股集团有限公司2026年度第二期短期融资券",
    `青岛分行|${correctQingdao}`,
    "兰州分行|兰州城市发展投资有限公司2026年度第一期超短期融资券",
    "苏州分行|苏州资产管理有限公司2026年度第一期资产支持票据(优先A)",
    "太原分行|太原国有投资集团有限公司2026年度第二期定向债务融资工具",
    "西安分行|西安产业投资集团有限公司2026年度第一期公司债券",
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

test("does not steal the previous row and rebuilds a split A/B name around the branch cell", () => {
  assert.deepEqual(parseProjectScreenshotOcrText([
    "武汉分行",
    "武汉金融控股集团有限公司2026年度第一期中期票据",
    "青岛分行",
    "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资",
    "270D",
    "10亿",
    "待投标",
    "券",
    "兰州分行",
    "兰州城市发展投资有限公司2026年度第一期超短期融资券",
    "苏州分行",
    "苏州资产管理有限公司2026年度第一期资产广持票据(优先A)",
  ].join("\n")), [
    { branch: "武汉分行", fullName: "武汉金融控股集团有限公司2026年度第一期中期票据" },
    { branch: "青岛分行", fullName: "青岛西海岸新区海洋控股集团有限公司2026年度第二期短期融资券" },
    { branch: "兰州分行", fullName: "兰州城市发展投资有限公司2026年度第一期超短期融资券" },
    { branch: "苏州分行", fullName: "苏州资产管理有限公司2026年度第一期资产支持票据(优先A)" },
  ]);

  assert.deepEqual(parseProjectScreenshotOcrText([
    "广州产业投资控股集团有限公司2026年度第三期中期票据(品种A/",
    "广州分行",
    "3Y/5Y",
    "16亿",
    "未投标",
    "B)",
  ].join("\n")), [
    { branch: "广州分行", fullName: "广州产业投资控股集团有限公司2026年度第三期中期票据品种A" },
    { branch: "广州分行", fullName: "广州产业投资控股集团有限公司2026年度第三期中期票据品种B" },
  ]);

  const merged = mergeProjectScreenshotOcrPasses([
    {
      label: "wide-table",
      confidence: 92,
      text: "广州分行 广州产业投资控股集团有限公司2026年度第三期中期票据(品种A",
    },
    {
      label: "branch-name-crop",
      confidence: 89,
      text: "广州分行 广州产业投资控股集团有限公司2026年度第三期中期票据品种A",
    },
  ]);
  assert.equal(merged[0]?.fullName, "广州产业投资控股集团有限公司2026年度第三期中期票据品种A");
});

test("stops a wrapped-name window at a second project year and skips labeled metadata", () => {
  assert.deepEqual(parseProjectScreenshotOcrText([
    "广州分行",
    "广州城市建设投资集团有限公司2026年度第一期短期融资",
    "期限3Y",
    "规模10亿",
    "状态未投标",
    "青岛城市发展集团有限公司2026年度第二期短期融资券",
  ].join("\n")), []);

  assert.deepEqual(parseProjectScreenshotOcrText([
    "广州分行",
    "广州城市建设投资集团有限公司",
    "青岛城市发展集团有限公司2026年度第二期短期融资券",
  ].join("\n")), []);

  assert.deepEqual(parseProjectScreenshotOcrText([
    "广州分行",
    "广州城市建设投资集团",
    "青岛城市发展集团有限公司2026年度第二期短期融资券",
  ].join("\n")), []);
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
