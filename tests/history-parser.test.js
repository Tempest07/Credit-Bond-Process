import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveIssuerAlias,
  extractIssuerLegalName,
  parseCreditText,
  parseHistoryText,
  parseStandardOpinion,
} from "../history-parser.js";

const standardHeader = "26粤交投SCP002 非我行主承 广州分行";
const standardOpinion = "广州分行申请与资金营运中心一二级联动投资广州交通投资集团有限公司2026年度第二期超短期融资券。预计发行规模7亿元，发行期限270天，主体信用评级为AAA(中诚信国际)，主承销商为中信银行，预计利率区间为1.25%-1.45%。授信方面，总行批20亿，公募，30%，3年。广州分行拟申请投资金额不超过1.4亿元、一级投标利率不低于1.38%。建议投资金额不超过1.4亿元、投资比例不超过最终发行规模的20%、一级投标利率不低于1.38%。本流程可用于一级、二级市场投资。以上妥否，请领导审核。本笔业务由处室终批。";
const absOpinion = "【20260609簿记】武汉分行拟与资金营运中心联动投资“九州通医药集团股份有限公司2026年度第一期资产支持票据”，发行规模10亿元。授信方面，总行储架批4亿，每期投资金额不超过该期优先级发行规模的20%，投资期限不超过2年且不超过优先级预期到期日。以上妥否，请领导审核。本笔业务由处室终批。";

test("extracts issuer and credit from a standard historical opinion", () => {
  const record = parseStandardOpinion(standardOpinion, {
    shortName: "26粤交投SCP002",
    alias: "粤交投",
    branch: "广州分行",
  });
  assert.equal(record.issuerLegalName, "广州交通投资集团有限公司");
  assert.equal(record.credit.approvedAmount, 20);
  assert.equal(record.credit.approvedRatio, 30);
  assert.equal(record.credit.investmentTermDays, 1095);
  assert.equal(record.subjectRating, "AAA");
  assert.equal(record.ratingAgency, "中诚信国际");
});

test("parses public and private credit ratios separately", () => {
  const credit = parseCreditText("总行批20亿，公私募（私募7亿），30%（私募20%），3年");
  assert.equal(credit.approvedRatio, 30);
  assert.equal(credit.privateRatio, 20);
  assert.equal(credit.privateAmount, 7);
});

test("derives reusable issuer aliases from bond short names", () => {
  assert.equal(deriveIssuerAlias("26粤交投SCP002"), "粤交投");
  assert.equal(deriveIssuerAlias("26国创G2"), "国创");
  assert.equal(deriveIssuerAlias("26广城03/04"), "广城");
});

test("extracts issuer legal name from standard bond full name", () => {
  assert.equal(
    extractIssuerLegalName("广州交通投资集团有限公司2026年度第二期超短期融资券"),
    "广州交通投资集团有限公司",
  );
  assert.equal(
    extractIssuerLegalName("青岛市北城市发展集团有限公司2026 年度第一期中期票据"),
    "青岛市北城市发展集团有限公司",
  );
  assert.equal(
    extractIssuerLegalName("珠海港控股集团有限公司第三期超短期融资券"),
    "珠海港控股集团有限公司",
  );
});

test("separates standard credit records and ABS records", () => {
  const parsed = parseHistoryText([
    "模板噪音",
    standardHeader,
    "270D 规模7亿 AAA(中诚信国际)/隐含AAA",
    standardOpinion,
    "26九州通ABN001优先 非我行主承 武汉分行",
    absOpinion,
    absOpinion,
  ].join("\n\n"));
  assert.equal(parsed.standardRecordCount, 1);
  assert.equal(parsed.absRecordCount, 2);
  assert.equal(parsed.issuers.length, 1);
  assert.equal(parsed.issuers[0].subjectRating, "AAA");
  assert.equal(parsed.issuers[0].ratingAgency, "中诚信国际");
  assert.equal(parsed.issuers[0].hiddenRating, "AAA");
});
