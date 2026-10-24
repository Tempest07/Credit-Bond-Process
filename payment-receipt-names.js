const SHORT_NAME_LABEL = /(?:债\s*券|证\s*券)\s*(?:简\s*称|短\s*名)\s*[:：]?\s*/g;
const NEXT_FIELD = /(?:债券(?:代码|编码|全称|名称|期限)|证券(?:代码|名称)|票面利率|发行(?:价格|规模|期限)|获配(?:面值|金额)|配售(?:金额|确认|缴款)|应缴款(?:项)?总额|缴款(?:日期|截止|金额)|付款(?:人|单位|金额)|投资者(?:名称)?|收款(?:人|单位|账号)|开户行|银行账号|标题)\s*[:：]?/;
const CODE_LABEL = /(?:债券(?:代码|编码)|证券代码)\s*[:：]?\s*([A-Z]?\d{6,18}(?:\.[A-Z]{2})?)/i;
const FULL_NAME_OR_BODY = /(?:有限公司|股份公司|有限责任|面向专业|公开发行|年度第|配售|缴款通知|确认书|资金(?:营运|运营)中心|付款人|投资者|收款人|人民币|发行规模|获配金额)/;

// Only formatting is corrected here. Missing issuer characters, year, tranche
// letters and thematic suffixes are never invented from a similar-looking name.
export function normalizePaymentReceiptBondShortName(value = "") {
  let text = String(value || "").normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim()
    .replace(/^(?:债\s*券|证\s*券)\s*(?:简\s*称|短\s*名)\s*[:：]?\s*/, "");
  const boundary = text.search(NEXT_FIELD);
  if (boundary >= 0) text = text.slice(0, boundary);
  text = text.replace(/^[\s“”"'「」《》【】]+|[\s“”"'「」《》【】,，;；。:：]+$/g, "")
    .replace(/\s+/g, "")
    .replace(/[a-z]+/g, part => part.toUpperCase());
  if (!text || text.length > 64 || FULL_NAME_OR_BODY.test(text)) return "";
  if (!/^[\u3400-\u9fffA-Z\d][\u3400-\u9fffA-Z\d()+\-/.·]*$/.test(text)) return "";
  let depth = 0;
  for (const character of text) {
    if (character === "(") depth++;
    if (character === ")" && --depth < 0) return "";
  }
  if (depth !== 0) return "";
  // Conventional credit/exchange short names begin with a two-digit year.
  // Explicit product-and-issue or ABS short names without that prefix remain
  // useful evidence, but a security code or a legal full title is not a name.
  const yearly = /^\d{2}(?!\d)(?=.*[\u3400-\u9fffA-Z])[\u3400-\u9fffA-Z\d+\-/.·]*\d{1,5}(?:(?:优先|次级)?[A-Z/]{0,5})(?:\([\u3400-\u9fffA-Z\d+\-/·]*\))*$/.test(text);
  const product = /^[\u3400-\u9fffA-Z][\u3400-\u9fffA-Z\d]{1,24}(?:SCP|CP|MTN|PPN|ABN|ABCP|CD)\d{2,3}[A-Z]{0,3}(?:\(.*\))?$/.test(text);
  const abs = /^[\u3400-\u9fffA-Z][\u3400-\u9fffA-Z\d]{0,20}20\d{2}[-/]\d{1,3}(?:优先|次级)?[A-Z\d]*(?:\(.*\))?$/.test(text);
  if (!(yearly || product || abs) || /\d{6,}/.test(text)) return "";
  return text;
}

function sameSecurityCode(left = "", right = "") {
  const clean = value => String(value).normalize("NFKC").replace(/\s/g, "").toUpperCase();
  const a = clean(left), b = clean(right);
  if (a === b) return Boolean(a);
  const [aCode, aMarket] = a.split("."), [bCode, bMarket] = b.split(".");
  return Boolean(aCode && aCode === bCode && (!aMarket || !bMarket));
}

function bestExplicitName(names, fallback) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 1) return unique[0];
  if (!unique.length) return "";
  const longest = [...unique].sort((a, b) => b.length - a.length)[0];
  const base = longest.split("(")[0];
  // Enrich only a suffix actually present in the labelled text. A/B are part
  // of the base identity and cannot be merged as optional decorations.
  if (unique.every(name => name.split("(")[0] === base && longest.startsWith(name))) return longest;
  return unique.includes(fallback) ? fallback : "";
}

export function extractPaymentReceiptBondShortName(rawText = "", { fallback = "", securityCode = "" } = {}) {
  const text = String(rawText || "").normalize("NFKC").replace(/\r\n?/g, "\n");
  const fallbackName = normalizePaymentReceiptBondShortName(fallback);
  const labels = [...text.matchAll(SHORT_NAME_LABEL)];
  const candidates = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    const start = label.index + label[0].length;
    const end = labels[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const boundary = block.search(NEXT_FIELD);
    const rawName = block.slice(0, boundary >= 0 ? boundary : Math.min(block.length, 160)).trim();
    const name = normalizePaymentReceiptBondShortName(rawName)
      || normalizePaymentReceiptBondShortName(rawName.split("\n").find(line => line.trim()) || "");
    if (!name) continue;
    // The closest code following a label belongs to that field block. Never
    // attach a later continuation/new-document code to the first short name.
    const nextTitle = block.search(/\n\s*标题\s*[:：]?/);
    const identityBlock = nextTitle >= 0 ? block.slice(0, nextTitle) : block;
    const code = identityBlock.match(CODE_LABEL)?.[1] || "";
    candidates.push({ name, code });
  }
  if (!candidates.length) return fallbackName;
  if (securityCode) {
    const matching = candidates.filter(candidate => sameSecurityCode(candidate.code, securityCode));
    if (matching.length) return bestExplicitName(matching.map(candidate => candidate.name), fallbackName);
    if (candidates.some(candidate => candidate.code) || CODE_LABEL.test(text)) return "";
  }
  return bestExplicitName(candidates.map(candidate => candidate.name), fallbackName);
}
