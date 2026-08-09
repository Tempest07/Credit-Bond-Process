const COMPANY_SUFFIX_PATTERN = /(股份有限公司|有限责任公司|有限公司|证券股份|证券有限)$/g;

export const BUILTIN_PROTOCOL_TRANSFER_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "citic-jiantou",
    label: "中信建投",
    marketMakerName: "中信建投证券股份有限公司",
    aliases: Object.freeze(["中信建投证券股份有限公司", "中信建投证券", "中信建投", "建投"]),
    url: "./templates/protocol-transfer/citic-jiantou.docx",
    sourceFileName: "上交所协议转让N0811 兴业建投 26苏轨03 3000.docx",
    sourceUpdatedAt: "2026-08-07T15:35:30+08:00",
    sourceSample: Object.freeze({
      applicationDate: "2026-08-11",
      code: "282480.SH",
      shortName: "26苏轨03",
      price: "100.483",
      quantityHands: "30000",
    }),
    fixedFields: Object.freeze({
      institutionName: "中信建投证券股份有限公司",
      traderName: "中信建投",
      traderCode: "118",
      shareholderAccount: "D890763989",
      seatNumber: "21988",
      phone: "010-56050516",
    }),
  }),
  Object.freeze({
    id: "huachuang",
    label: "华创证券",
    marketMakerName: "华创证券有限责任公司",
    aliases: Object.freeze(["华创证券有限责任公司", "华创证券"]),
    url: "./templates/protocol-transfer/huachuang.docx",
    sourceFileName: "上交所协议转让N0811 兴业华创 26黄投01 2000.docx",
    sourceUpdatedAt: "2026-08-07T10:50:34+08:00",
    sourceSample: Object.freeze({
      applicationDate: "2026-08-11",
      code: "282305.SH",
      shortName: "26黄投01",
      price: "100.066",
      quantityHands: "20000",
    }),
    fixedFields: Object.freeze({
      institutionName: "华创证券有限责任公司",
      traderName: "华创证券有限责任公司",
      traderCode: "187",
      shareholderAccount: "D890783191",
      seatNumber: "25171",
      phone: "021-61763898",
    }),
  }),
  Object.freeze({
    id: "yintai",
    label: "银泰证券",
    marketMakerName: "银泰证券有限责任公司",
    aliases: Object.freeze(["银泰证券有限责任公司", "银泰证券", "银泰"]),
    url: "./templates/protocol-transfer/yintai.docx",
    sourceFileName: "上交所协议转让N0810 兴业银泰 26晋资03 5000.docx",
    sourceUpdatedAt: "2026-08-06T15:25:59+08:00",
    sourceSample: Object.freeze({
      applicationDate: "2026-08-10",
      code: "283220.SH",
      shortName: "26晋资03",
      price: "100.047",
      quantityHands: "50000",
    }),
    fixedFields: Object.freeze({
      institutionName: "银泰证券有限责任公司",
      traderName: "银泰证券",
      traderCode: "194",
      shareholderAccount: "D890777459",
      seatNumber: "21916",
      phone: "0755-83709146",
    }),
  }),
]);

export function normalizeProtocolTransferParty(value = "") {
  return String(value)
    .replace(/[【】\[\]（）(),，；;：:\s]/g, "")
    .replace(COMPANY_SUFFIX_PATTERN, "")
    .toLowerCase();
}

export function matchesProtocolTransferParty(left = "", right = "") {
  const leftKey = normalizeProtocolTransferParty(left);
  const rightKey = normalizeProtocolTransferParty(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

export function matchProtocolTransferTemplate(marketMaker = "", templates = BUILTIN_PROTOCOL_TRANSFER_TEMPLATES) {
  const value = normalizeProtocolTransferParty(marketMaker);
  if (!value) return null;
  return (templates || []).find((template) =>
    [template.marketMakerName, template.label, ...(template.aliases || [])]
      .some((alias) => matchesProtocolTransferParty(value, alias)),
  ) || null;
}

export function protocolTransferTemplateById(id = "", templates = BUILTIN_PROTOCOL_TRANSFER_TEMPLATES) {
  return (templates || []).find((template) => template.id === id) || null;
}

export function isKnownProtocolTransferMarketMaker(value = "", templates = BUILTIN_PROTOCOL_TRANSFER_TEMPLATES) {
  return Boolean(matchProtocolTransferTemplate(value, templates));
}
