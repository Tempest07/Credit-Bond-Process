import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import PizZip from "pizzip";
import { normalizeProtocolTransfer, parseProtocolTransferText, protocolTransferFromSecondaryTrade } from "../protocol-transfer.js";
import { parseSecondaryTradeIntake } from "../secondary-inventory.js";

import {
  extractProtocolTransferTemplateMetadata,
  patchProtocolTransferDocumentXml,
  protocolTransferApplicationFilename,
  validateProtocolTransferApplication,
} from "../protocol-transfer-docx.js";
import {
  BUILTIN_PROTOCOL_TRANSFER_TEMPLATES,
  matchProtocolTransferTemplate,
} from "../protocol-transfer-templates.js";

const TEMPLATE_EXPECTATIONS = {
  "citic-jiantou": {
    file: "citic-jiantou.docx",
    institutionName: "中信建投证券股份有限公司",
    traderCode: "118",
    shareholderAccount: "D890763989",
    seatNumber: "21988",
    phone: "010-56050516",
  },
  huachuang: {
    file: "huachuang.docx",
    institutionName: "华创证券有限责任公司",
    traderCode: "187",
    shareholderAccount: "D890783191",
    seatNumber: "25171",
    phone: "021-61763898",
  },
  yintai: {
    file: "yintai.docx",
    institutionName: "银泰证券有限责任公司",
    traderCode: "194",
    shareholderAccount: "D890777459",
    seatNumber: "21916",
    phone: "0755-83709146",
  },
};

test("matches built-in market-maker aliases", () => {
  assert.equal(matchProtocolTransferTemplate("建投")?.id, "citic-jiantou");
  assert.equal(matchProtocolTransferTemplate("中信建投证券股份有限公司")?.id, "citic-jiantou");
  assert.equal(matchProtocolTransferTemplate("华创证券")?.id, "huachuang");
  assert.equal(matchProtocolTransferTemplate("银泰")?.id, "yintai");
  assert.equal(matchProtocolTransferTemplate("未知证券"), null);
});

for (const template of BUILTIN_PROTOCOL_TRANSFER_TEMPLATES) {
  test(`distills fixed maker fields from ${template.label} source template`, async () => {
    const expected = TEMPLATE_EXPECTATIONS[template.id];
    const zip = await readTemplateZip(expected.file);
    const metadata = extractProtocolTransferTemplateMetadata(zip.file("word/document.xml").asText(), {
      id: template.id,
      sourceFileName: expected.file,
    });

    assert.equal(metadata.makerInstitutionNumber, 1);
    assert.equal(metadata.fixedFields.institutionName, expected.institutionName);
    assert.equal(metadata.fixedFields.traderCode, expected.traderCode);
    assert.equal(metadata.fixedFields.shareholderAccount, expected.shareholderAccount);
    assert.equal(metadata.fixedFields.seatNumber, expected.seatNumber);
    assert.equal(metadata.fixedFields.phone, expected.phone);
    assert.equal(protocolTransferApplicationFilename({
      tradeDate: template.sourceSample.applicationDate,
      shortName: template.sourceSample.shortName,
      quantityHands: Number(template.sourceSample.quantityHands),
    }, template), template.sourceFileName);
  });
}

test("generates a Huachuang application using maker and bank only", async () => {
  const template = matchProtocolTransferTemplate("华创证券");
  const zip = await readTemplateZip("huachuang.docx");
  const inputXml = zip.file("word/document.xml").asText();
  const record = {
    tradeDate: "2026-08-12",
    code: "280607.SH",
    shortName: "25汉投03",
    seller: "兴业银行",
    buyer: "南方基金",
    marketMaker: "华创证券",
    price: 101.031,
    amountTenThousand: 3000,
    quantityHands: 30000,
  };
  const outputXml = patchProtocolTransferDocumentXml(inputXml, record, template);
  zip.file("word/document.xml", outputXml);
  const output = zip.generate({ type: "uint8array", compression: "DEFLATE" });
  const reopened = new PizZip(output);
  const text = documentText(reopened.file("word/document.xml").asText());

  assert.equal(String.fromCharCode(output[0], output[1]), "PK");
  assert.match(text, /2026年 8月12日/);
  assert.match(text, /280607\.SH/);
  assert.match(text, /25汉投03/);
  assert.match(text, /101\.031/);
  assert.match(text, /30000/);
  assert.match(text, /华创证券有限责任公司/);
  assert.match(text, /兴业银行股份有限公司/);
  assert.doesNotMatch(text, /南方基金/);
  assert.doesNotMatch(text, /282305\.SH|26黄投01|100\.066|20000/);
  assert.equal(
    protocolTransferApplicationFilename(record, template),
    "上交所协议转让N0812 兴业华创 25汉投03 3000.docx",
  );
});

test("preserves secondary intake amount units while extracting bridge prices", () => {
  for (const [amountText, expected] of [["5000", 5000], ["5000万", 5000], ["5k", 5000], ["0.5e", 5000], ["3.5k", 3500], ["100", 100]]) {
    const text = `【测试】 2.9Y 283353.SH 26测试01 私募债 100 / 99.998 净价 ${amountText} 09.11交易所 兴业银行 出给 某基金`;
    const candidate = parseSecondaryTradeIntake(text, { negotiationDate: "2026-09-11" }).protocolCandidates[0];
    assert.equal(candidate.price, "99.998", amountText);
    assert.equal(candidate.quantityWan, expected, amountText);
  }
});

for (const template of BUILTIN_PROTOCOL_TRANSFER_TEMPLATES) {
  test(`exports the bank-to-bridge price and hands into separate ${template.label} Word cells`, async () => {
    const text = `【测试】 2.9Y 283353.SH 26测试01 100 / 99.998 净价 5000 09.11交易所 兴业银行 出给 某基金\n${template.marketMakerName} 测试联系人 3000000000`;
    const parsed = parseProtocolTransferText(text, new Date("2026-09-11T09:00:00+08:00"));
    // Cover both recognized text and a user-entered slash quote in the form.
    for (const record of [parsed, normalizeProtocolTransfer({ ...parsed, price: "100/99.998" })]) {
      const zip = await readTemplateZip(TEMPLATE_EXPECTATIONS[template.id].file);
      zip.file("word/document.xml", patchProtocolTransferDocumentXml(zip.file("word/document.xml").asText(), record, template));
      const reopened = new PizZip(zip.generate({ type: "uint8array", compression: "DEFLATE" }));
      const rows = rowTexts(reopened.file("word/document.xml").asText());
      assert.match(rows.find(row => row.includes("交易净价")), /99\.998$/);
      assert.match(rows.find(row => row.includes("交易数量")), /50000$/);
      assert.doesNotMatch(rows.find(row => row.includes("交易净价")), /5000/);
    }
  });
}

test("routes secondary intake slash quotes through the same protocol Word price and amount rules", async () => {
  const template = matchProtocolTransferTemplate("华创证券");
  for (const quote of ["净价 100/99.998", "100 / 99.998 净价", "99.998/100 净价"]) {
    const text = `【测试】 2.9Y 283353.SH 26测试01 私募债 ${quote} 5000 09.11交易所 兴业银行 出给 某基金，华创证券发 100/99.998`;
    const candidate = parseSecondaryTradeIntake(text, { negotiationDate: "2026-09-11" }).protocolCandidates[0];
    assert.equal(candidate.price, "99.998", quote);
    assert.equal(candidate.quantityWan, 5000, quote);
    assert.equal(String(candidate.tradeRecord["净价"]), "99.998", quote);
    const record = protocolTransferFromSecondaryTrade(candidate);
    const zip = await readTemplateZip("huachuang.docx");
    const xml = patchProtocolTransferDocumentXml(zip.file("word/document.xml").asText(), record, template);
    const rows = rowTexts(xml);
    assert.match(rows.find(row => row.includes("交易净价")), /99\.998$/);
    assert.match(rows.find(row => row.includes("交易数量")), /50000$/);
    const manual = protocolTransferFromSecondaryTrade({ ...candidate, frontOfficePrice: "99.999", quantityWan: 3000 });
    assert.equal(manual.price, 99.999);
    assert.equal(manual.quantityHands, 30000);
  }
});

test("falls back from hands to the archive amount and compacts a new maker name", () => {
  assert.equal(
    protocolTransferApplicationFilename({
      tradeDate: "2026-12-03",
      shortName: "26测试01",
      marketMaker: "某某证券有限责任公司",
      quantityHands: 12345,
    }, { label: "某某证券" }),
    "上交所协议转让N1203 兴业某某 26测试01 1234.5.docx",
  );
});

test("uses 长城 as the fixed archive alias for Great Wall Securities", () => {
  assert.equal(
    protocolTransferApplicationFilename({
      tradeDate: "2026-12-03",
      shortName: "26测试02",
      marketMaker: "长城证券股份有限公司",
      amountTenThousand: 2000,
    }, {
      label: "长城证券股份有限公司",
      marketMakerName: "长城证券股份有限公司",
    }),
    "上交所协议转让N1203 兴业长城 26测试02 2000.docx",
  );
});

test("swaps application directions when the maker sells to the bank", async () => {
  const template = matchProtocolTransferTemplate("中信建投");
  const zip = await readTemplateZip("citic-jiantou.docx");
  const inputXml = zip.file("word/document.xml").asText();
  const outputXml = patchProtocolTransferDocumentXml(inputXml, {
    tradeDate: "2026-08-12",
    code: "282480.SH",
    shortName: "26苏轨03",
    seller: "某基金",
    buyer: "兴业银行",
    marketMaker: "中信建投",
    price: 100.5,
    quantityHands: 10000,
  }, template);
  const rows = rowTexts(outputXml);

  assert.match(rows.find((row) => row.includes("交易机构 1")), /交易方向卖出/);
  assert.match(rows.find((row) => row.includes("交易机构 2")), /交易方向买入/);
  assert.doesNotMatch(documentText(outputXml), /某基金/);
});

test("does not let the final buyer affect the Word application", async () => {
  const template = matchProtocolTransferTemplate("银泰证券");
  const zip = await readTemplateZip("yintai.docx");
  const inputXml = zip.file("word/document.xml").asText();
  const base = {
    tradeDate: "2026-08-12",
    code: "283220.SH",
    shortName: "26晋资03",
    seller: "兴业银行",
    marketMaker: "银泰证券",
    price: 100.047,
    quantityHands: 50000,
  };
  const first = patchProtocolTransferDocumentXml(inputXml, { ...base, buyer: "最终买方甲" }, template);
  const second = patchProtocolTransferDocumentXml(inputXml, { ...base, buyer: "最终买方乙" }, template);

  assert.equal(first, second);
});

test("blocks generation when maker direction or template is missing", () => {
  const record = {
    tradeDate: "2026-08-12",
    code: "283220.SH",
    shortName: "26晋资03",
    seller: "某基金",
    buyer: "另一基金",
    marketMaker: "未知证券",
    price: 100.047,
    quantityHands: 50000,
  };
  const validation = validateProtocolTransferApplication(record, null);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("；"), /未匹配到做市商 Word 模板/);
  assert.match(validation.errors.join("；"), /无法判断做市商方向/);
});

async function readTemplateZip(file) {
  const buffer = await readFile(new URL(`../templates/protocol-transfer/${file}`, import.meta.url));
  return new PizZip(buffer);
}

function documentText(xml) {
  return [...String(xml).matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function rowTexts(xml) {
  return [...String(xml).matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g)]
    .map((match) => documentText(match[0]));
}

function decodeXml(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
