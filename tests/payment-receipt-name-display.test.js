import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentReceiptNameResolver } from "../payment-receipt-name-display.js";

function fixture(shortName, securityCode = "") {
  const projects = [{ id: "project", tranches: [{ id: "tranche", shortName, securityCode }] }];
  return { resolve: createPaymentReceiptNameResolver(projects), matched: { matchStatus: "matched", projectId: "project", trancheId: "tranche" } };
}

test("already-corresponding tranche safely supplies missing issuer tail and explicit green attribute", () => {
  const { resolve, matched } = fixture("26越秀租赁MTN002B(绿色)");
  const receipt = { ...matched, bondShortName: "26 越秀租 MTN002B", securityCode: "102683999", recognizedText: "债券简称26 越秀租 MTN002B\n债券代码102683999" };
  assert.deepEqual(resolve(receipt), { title: "26越秀租赁MTN002B(绿色)", rawName: receipt.bondShortName, source: "matched-project", warning: "" });
  assert.equal(receipt.bondShortName, "26 越秀租 MTN002B");
});

test("manual correspondence can display Wu Tou short name instead of a long legal title", () => {
  const { resolve, matched } = fixture("26吴投04", "284328.SH");
  const result = resolve({ ...matched, bondShortName: "苏州吴中开国有资产投资发展有限公司 2026 年面向专业投资者非公开发行公司债券(第四期)" });
  assert.equal(result.title, "26吴投04");
  assert.equal(result.source, "matched-project");
  assert.equal(result.warning, "");
});

test("real wrong issue and wrong code examples remain visible for review", () => {
  const jin = fixture("26晋金04", "246130.SH");
  const result = jin.resolve({ ...jin.matched, bondShortName: "26 晋金 03", securityCode: "246129" });
  assert.equal(result.title, "26晋金03");
  assert.equal(result.source, "recognized");
  assert.match(result.warning, /代码/);
  const qing = fixture("26青信08");
  assert.match(qing.resolve({ ...qing.matched, bondShortName: "26 青信 07", securityCode: "245774.SH" }).warning, /期次/);
});

test("multiple names are not concatenated or hidden by existing correspondence", () => {
  const { resolve, matched } = fixture("26工投K5", "245600.SH");
  const rawName = "26 工投 K4 26 工投 K5";
  const result = resolve({ ...matched, bondShortName: rawName, securityCode: "245599.SH" });
  assert.equal(result.title, rawName);
  assert.match(result.warning, /多个债券/);
  assert.equal(result.source, "recognized");
  assert.match(resolve({ ...matched, bondShortName: "26工投K5", recognizedText: "债券简称26工投K4\n债券代码245599\n债券简称26工投K5\n债券代码245600" }).warning, /多个债券/);
});

test("suspicious account-like codes and F-prefixed project codes are never stripped", () => {
  const account = fixture("26苏农K1", "246045.SH");
  assert.match(account.resolve({ ...account.matched, bondShortName: "26 上海K1", securityCode: "1102060900450972" }).warning, /代码格式异常/);
  const prefixed = fixture("26苏州资产MTN002", "F102682475");
  const result = prefixed.resolve({ ...prefixed.matched, bondShortName: "26 苏州资产 MTN002", securityCode: "102682475" });
  assert.equal(result.title, "26苏州资产MTN002");
  assert.equal(result.source, "recognized");
  assert.match(result.warning, /项目证券代码格式异常/);
});

test("code matching keeps leading zeros and accepts a single market suffix", () => {
  const { resolve } = fixture("26测试SCP001", "012682531.IB");
  const result = resolve({ bondShortName: "26 测试 SCP001", securityCode: "０１２６８２５３１" });
  assert.equal(result.source, "security-code");
  assert.equal(result.title, "26测试SCP001");
  assert.equal(resolve({ bondShortName: "26测试SCP001", securityCode: "12682531" }).source, "recognized");
  assert.match(resolve({ bondShortName: "26测试SCP001", securityCode: "12682531" }).warning, /代码格式异常/);
  const reverse = fixture("26测试01", "246129");
  assert.equal(reverse.resolve({ securityCode: "246129.SH" }).source, "security-code");
  const government = fixture("26国开01", "260201.IB");
  assert.equal(government.resolve({ securityCode: "260201" }).source, "security-code");
});

test("explicitly differing markets cannot share one numeric code", () => {
  const { resolve, matched } = fixture("26测试01", "246129.SH");
  assert.match(resolve({ ...matched, bondShortName: "26测试01", securityCode: "246129.SZ" }).warning, /代码/);
  assert.match(resolve({ bondShortName: "26测试01", securityCode: "246129.SZ" }).warning, /交易市场/);
});

test("different year, product, issuer and A/B/AB are identity conflicts", () => {
  for (const [raw, canonical, expected] of [
    ["25越秀租赁MTN002B", "26越秀租赁MTN002B", /年份/],
    ["26越秀租赁PPN002B", "26越秀租赁MTN002B", /品种/],
    ["26越秀租赁MTN002AB", "26越秀租赁MTN002B", /字母/],
    ["26越秀租赁MTN002", "26越秀租赁MTN002B", /字母/],
    ["26测试G1", "26测试01", /品种/],
    ["26广西地铁SCP006", "26广州地铁SCP006", /发行人/],
    ["26上海建工CP005", "26陕西建工CP005", /发行人/],
    ["26中交航SCP006", "26中交广航SCP006", /发行人/],
  ]) {
    const { resolve, matched } = fixture(canonical);
    assert.match(resolve({ ...matched, bondShortName: raw }).warning, expected, raw);
  }
});

test("code lookup is display-only and refuses contradictory or ambiguous ledger names", () => {
  const projects = [{ id: "a", tranches: [{ id: "a1", shortName: "26测试03", securityCode: "246129.SH" }] }];
  const receipt = { bondShortName: "26测试04", securityCode: "246129" };
  assert.match(createPaymentReceiptNameResolver(projects)(receipt).warning, /期次/);
  assert.equal(receipt.projectId, undefined);
  projects[0].tranches.push({ id: "a2", shortName: "26测试04", securityCode: "246129.SH" });
  assert.match(createPaymentReceiptNameResolver(projects)({ securityCode: "246129" }).warning, /多个项目简称/);
});

test("explicit source attributes survive only after the base is checked", () => {
  const { resolve, matched } = fixture("26测试MTN001");
  assert.equal(resolve({ ...matched, bondShortName: "26测试MTN001(科创债)" }).title, "26测试MTN001(科创债)");
  const conflict = resolve({ ...matched, bondShortName: "26测试MTN002(科创债)" });
  assert.match(conflict.warning, /期次/);
  assert.equal(conflict.source, "recognized");
  const green = fixture("26测试MTN001(绿色)");
  assert.equal(green.resolve({ ...green.matched, bondShortName: "26测试MTN001(绿色)(科创)(绿色)" }).title, "26测试MTN001(绿色)(科创)");
});

test("uses exact labelled transcription and cleans only field wrappers", () => {
  const resolve = createPaymentReceiptNameResolver([]);
  assert.equal(resolve({ bondShortName: "26 越秀租 MTN002B", securityCode: "102683999", recognizedText: "债券简称26 越秀租赁 MTN002B(绿色)\n债券代码102683999" }).title, "26越秀租赁MTN002B(绿色)");
  assert.equal(resolve({ bondShortName: "26 鄂基 K3,代码:283404债券期限 3 年" }).title, "26鄂基K3");
  assert.equal(resolve({ bondShortName: "(代码) 26 晋中 01(245733)" }).title, "26晋中01");
  assert.equal(resolve({ bondShortName: "某某股份有限公司2026年度第三期中期票据" }).title, "简称待核对");
  assert.equal(resolve({ bondShortName: "" }).source, "unavailable");
});

test("missing targets do not borrow a code match behind an obsolete correspondence", () => {
  const { resolve } = fixture("26测试01", "246129.SH");
  const result = resolve({ matchStatus: "matched", projectId: "deleted", trancheId: "tranche", bondShortName: "26 测试 01", securityCode: "246129.SH" });
  assert.equal(result.source, "recognized");
  assert.match(result.warning, /不存在/);
});

test("a contradictory code in the original is not hidden by a valid structured field", () => {
  const { resolve, matched } = fixture("26测试01", "246129.SH");
  const result = resolve({ ...matched, bondShortName: "26测试01", securityCode: "246129", recognizedText: "债券简称26测试01\n债券代码246130.SH" });
  assert.equal(result.source, "recognized");
  assert.match(result.warning, /原文证券代码不一致/);
});

test("full legal titles reveal explicit year conflicts but their issuance period is not a short-name sequence", () => {
  const { resolve, matched } = fixture("26吴投04", "284328.SH");
  assert.match(resolve({ ...matched, bondShortName: "某某有限公司2025年非公开发行公司债券(第四期)" }).warning, /年份/);
  assert.equal(resolve({ ...matched, bondShortName: "某某有限公司2026年非公开发行公司债券(第三期)" }).title, "26吴投04");
});
