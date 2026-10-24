import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentReceiptBondShortName as normalize, extractPaymentReceiptBondShortName as extract } from "../payment-receipt-names.js";

test("normalizes OCR spacing and width without discarding bond attributes or tranche letters", () => {
  assert.equal(normalize("债券简称：２６ 越秀租赁 ＭＴＮ００２Ｂ（绿 色）"), "26越秀租赁MTN002B(绿色)");
  assert.equal(normalize("26 九川通 SCP003（支持养老产业）"), "26九川通SCP003(支持养老产业)");
  assert.equal(normalize("26 保利 08"), "26保利08");
  assert.equal(normalize("26奔驰财务 MTN001A（BC）"), "26奔驰财务MTN001A(BC)");
  assert.equal(normalize("福建高速 mtn005"), "福建高速MTN005");
  assert.equal(normalize("狮桥 2026-1 优先 A"), "狮桥2026-1优先A");
});

test("rejects legal full titles, payer names and codes rather than guessing an abbreviation", () => {
  for (const value of [
    "苏州吴中国有资产投资发展有限公司2026年面向专业投资者非公开发行公司债券(第四期)",
    "乌鲁木齐城市建设投资(集团)有限公司2026年度第一期定向债务融资工具",
    "兴业银行股份有限公司资金营运中心", "102683999", "26越秀租赁MTN002B(绿色", "26越秀租赁MTN002B)绿色(",
  ]) assert.equal(normalize(value), "", value);
  assert.equal(normalize("26 越秀租 MTN002B"), "26越秀租MTN002B", "formatting alone must not invent missing 赁 or 绿色");
});

test("explicit short-name fields outrank an abbreviated model fallback and retain labelled suffixes", () => {
  const text = "债券简称：26 越秀租赁 MTN002B（绿色）\n债券代码：102683999\n缴款金额3000万元";
  assert.equal(extract(text, { fallback: "26 越秀租 MTN002B", securityCode: "102683999.IB" }), "26越秀租赁MTN002B(绿色)");
  assert.equal(extract(text, { fallback: "广州越秀融资租赁有限公司2026年度第二期绿色中期票据", securityCode: "102683999" }), "26越秀租赁MTN002B(绿色)");
});

test("wrapped short names stop at the next labelled business field", () => {
  assert.equal(extract("证 券 简 称 ：\n26 越秀租赁 MTN002B(绿\n色)\n证券代码102683999"), "26越秀租赁MTN002B(绿色)");
  assert.equal(extract("债券简称 26灵天02 债券代码283234.SH 应缴款总额1000万元"), "26灵天02");
  assert.equal(extract("债券简称26测试MTN001\n资金中心"), "26测试MTN001", "unlabelled body lines must not be appended to the short name");
  assert.equal(normalize("26测试MTN001资金中心"), "");
});

test("a multi-receipt group selects only the short name belonging to the requested code", () => {
  const text = "标题 苏交缴款通知\n债券简称 26 苏交通 CP008\n债券代码042680338\n缴款金额42000万元\n\n标题 其他缴款通知\n债券简称26乌城投PPN001\n债券代码032680566\n缴款金额4000万元\n\n标题 福建高速缴款通知\n债券简称26福建高速MTN005\n债券代码102683994";
  assert.equal(extract(text, { securityCode: "042680338" }), "26苏交通CP008");
  assert.equal(extract(text, { securityCode: "102683994" }), "26福建高速MTN005");
  assert.equal(extract(text, { securityCode: "999999999", fallback: "26苏交通CP008" }), "");
  assert.equal(extract(text), "", "multiple identities cannot silently collapse to the first name");
  assert.equal(extract(text, { fallback: "26乌城投PPN001" }), "26乌城投PPN001");
});

test("conflicting market suffixes or tranche letters are never merged as spelling variations", () => {
  assert.equal(extract("债券简称26测试01\n债券代码246129.SH", { securityCode: "246129.SZ", fallback: "26测试01" }), "");
  const text = "债券简称26越秀租赁MTN002A\n债券代码102683999\n债券简称26越秀租赁MTN002B\n债券代码102683999";
  assert.equal(extract(text, { securityCode: "102683999" }), "");
  assert.equal(extract(text, { securityCode: "102683999", fallback: "26越秀租赁MTN002A" }), "26越秀租赁MTN002A");
});

test("does not borrow a later receipt's code when its short-name field was not recognized", () => {
  const text = "债券简称26苏交通CP008\n缴款金额42000万元\n\n标题 另一项目缴款通知\n债券代码032680566";
  assert.equal(extract(text, { securityCode: "032680566" }), "");
});

test("a clear labelled suffix may enrich its own base, while a title remains only raw source evidence", () => {
  assert.equal(extract("债券简称26测试MTN001\n债券简称26测试MTN001(科创债)"), "26测试MTN001(科创债)");
  assert.equal(extract("债券简称 某某股份有限公司2026年度第三期中期票据"), "");
  assert.equal(extract("某某股份有限公司2026年度第三期中期票据", { fallback: "26测试MTN003" }), "26测试MTN003");
});
