import { extractPaymentReceiptBondShortName, normalizePaymentReceiptBondShortName } from "./payment-receipt-names.js?v=20261028v540";
import { paymentReceiptCodeIdentity as codeIdentity, samePaymentReceiptCode as sameCode,
  paymentReceiptSourceCodes as sourceCodes } from './payment-receipt-security.js?v=20261028v540';

const SHORT_NAME_LABEL = /(?:债\s*券|证\s*券)\s*(?:简\s*称|短\s*名)\s*[:：]?\s*/g;
const compact = value => String(value || "").normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]/g, "").toUpperCase();
const targetKey = (projectId, trancheId) => JSON.stringify([String(projectId || ""), String(trancheId || "")]);

function cleanedFallback(value) {
  const original = String(value || "").normalize("NFKC").trim();
  const withoutLabels = original.replace(/^\(代码\)\s*/, "")
    .replace(/[,，;；]?\s*(?:代码\s*[:：]|债券期限\s*[:：]?).*$/, "")
    .replace(/\(\d{6}(?:\.(?:SH|SZ|IB))?\)\s*$/i, "");
  return normalizePaymentReceiptBondShortName(withoutLabels);
}

function nameIdentity(value) {
  const text = compact(value).split("(")[0];
  if (!text || /有限公司|有限责任|面向专业|公开发行|年度第/.test(text)) return null;
  const yearMatch = text.match(/^(\d{2})(?!\d)/);
  const rest = yearMatch ? text.slice(2) : text;
  const product = rest.match(/^(.*?)(ABCP|SCP|MTN|PPN|ABN|TLAC|CP|GN|CD)(\d{1,5})([A-Z/]{0,5})$/);
  if (product) return { year: yearMatch?.[1] || "", issuer: product[1], product: product[2], issue: Number(product[3]), letters: product[4] };
  const exchange = rest.match(/^(.*?)([A-Z]?)(\d{1,5})([A-Z/]{0,5})$/);
  if (exchange && exchange[1]) return { year: yearMatch?.[1] || "", issuer: exchange[1], product: exchange[2], issue: Number(exchange[3]), letters: exchange[4] };
  // An incomplete short-name field still supplies explicit issuer evidence.
  if (yearMatch && /^[\u3400-\u9fff·]{2,24}$/.test(rest)) return { year: yearMatch[1], issuer: rest, product: "", issue: null, letters: null };
  return null;
}

function nameConflict(recognized, canonical, allowBoundAbbreviation = false) {
  const left = nameIdentity(recognized), right = nameIdentity(canonical);
  if (!left || !right) return "";
  if (left.year && right.year && left.year !== right.year) return "识别简称与项目年份不一致";
  if (left.issue !== null && right.issue !== null && left.product !== right.product) return "识别简称与项目债券品种不一致";
  if (left.issue !== null && right.issue !== null && left.issue !== right.issue) return "识别简称与项目期次不一致";
  if (left.letters !== null && right.letters !== null && left.letters !== right.letters) return "识别简称与项目品种字母不一致";
  if (left.issuer !== right.issuer) {
    // Existing correspondence may supply a short missing issuer tail, such as
    // 越秀租 → 越秀租赁. This is never used to find a new correspondence.
    const boundAbbreviation = allowBoundAbbreviation && left.issuer.length >= 3
      && right.issuer.startsWith(left.issuer) && right.issuer.length - left.issuer.length <= 2;
    if (!boundAbbreviation) return "识别简称与项目发行人简称不一致";
  }
  return "";
}

function rawHasMultipleNames(value) {
  const nameField = String(value || "").normalize("NFKC")
    .replace(/[,，;；]?\s*(?:代码\s*[:：]|债券期限\s*[:：]?).*$/, "")
    .replace(/\(\d{6}(?:\.(?:SH|SZ|IB))?\)\s*$/i, "");
  return [...compact(nameField).matchAll(/\d{2}(?!\d)(?=[\u3400-\u9fff])/g)].length > 1;
}

function sourceNames(text) {
  const raw = String(text || "").normalize("NFKC");
  const labels = [...raw.matchAll(SHORT_NAME_LABEL)];
  const names = [];
  for (let index = 0; index < labels.length; index++) {
    const block = raw.slice(labels[index].index, labels[index + 1]?.index ?? raw.length);
    const name = extractPaymentReceiptBondShortName(block);
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

function hasSourceConflict(names) {
  if (names.some(rawHasMultipleNames)) return true;
  const bases = new Set(names.map(name => name.split("(")[0]));
  return bases.size > 1;
}

function preserveExplicitAttributes(canonical, recognized) {
  const attributes = recognized?.match(/\([^()]+\)/g) || [];
  let result = canonical;
  const existing = new Set(canonical.match(/\([^()]+\)/g) || []);
  for (const attribute of attributes) {
    if (!existing.has(attribute)) result += attribute;
    existing.add(attribute);
  }
  return result;
}

/** Presentation only: this resolver never changes a receipt or correspondence. */
export function createPaymentReceiptNameResolver(projects = []) {
  const targets = new Map();
  const securities = new Map();
  for (const project of Array.isArray(projects) ? projects : []) {
    for (const tranche of Array.isArray(project?.tranches) ? project.tranches : []) {
      const entry = { name: normalizePaymentReceiptBondShortName(tranche.shortName), code: codeIdentity(tranche.securityCode) };
      targets.set(targetKey(project.id, tranche.id), entry);
      if (entry.name && entry.code && !entry.code.invalid) {
        const entries = securities.get(entry.code.body) || [];
        entries.push(entry);
        securities.set(entry.code.body, entries);
      }
    }
  }

  function resolveOriginal(receipt = {}) {
    const rawName = String(receipt.bondShortName || "").trim();
    const code = codeIdentity(receipt.securityCode);
    const fallbackName = cleanedFallback(rawName);
    const extracted = extractPaymentReceiptBondShortName(receipt.recognizedText, { fallback: fallbackName, securityCode: code && !code.invalid ? code.text : "" });
    const recognized = extracted || fallbackName;
    const labels = sourceNames(receipt.recognizedText);
    const explicitCodes = sourceCodes(receipt.recognizedText);
    const multiple = rawHasMultipleNames(rawName) || hasSourceConflict(labels);
    const fallbackResult = warning => ({
      title: rawHasMultipleNames(rawName) ? (rawName || "简称待核对") : (recognized || "简称待核对"),
      rawName,
      source: recognized || (multiple && rawName) ? "recognized" : "unavailable",
      warning: warning || (!recognized ? "未识别到可靠债券简称" : ""),
    });
    if (multiple) return fallbackResult("原识别内容包含多个债券简称，需核对原件与对应项目");
    if (code?.invalid) return fallbackResult("识别证券代码格式异常，需核对原件");
    if (explicitCodes.some(explicit => explicit.invalid)) return fallbackResult("原文证券代码格式异常，需核对原件");
    if (code && explicitCodes.some(explicit => !sameCode(code, explicit))) return fallbackResult("识别证券代码与原文证券代码不一致");

    if (receipt.matchStatus === "matched") {
      const target = targets.get(targetKey(receipt.projectId, receipt.trancheId));
      if (!target) return fallbackResult("已对应的项目或品种不存在，需核对对应关系");
      if (target.code?.invalid) return fallbackResult("项目证券代码格式异常，需核对对应关系");
      if (code && target.code && !sameCode(code, target.code)) return fallbackResult("识别证券代码与已对应品种不一致");
      if (target.code && explicitCodes.some(explicit => !sameCode(target.code, explicit))) return fallbackResult("原文证券代码与已对应品种不一致");
      if (!target.name) return fallbackResult("已对应品种没有可靠债券简称");
      const evidence = [...new Set([recognized, cleanedFallback(rawName), ...labels].filter(Boolean))];
      for (const name of evidence) {
        const conflict = nameConflict(name, target.name, true);
        if (conflict) return fallbackResult(conflict);
      }
      // A full legal title still carries an explicit year; do not hide a wrong
      // year's manual correspondence merely because it has no short-name field.
      const fullYear = rawName.match(/\b20(\d{2})\s*年/);
      const targetYear = nameIdentity(target.name)?.year;
      if (fullYear && targetYear && fullYear[1] !== targetYear) return fallbackResult("识别原文与项目年份不一致");
      return { title: preserveExplicitAttributes(target.name, recognized), rawName, source: "matched-project", warning: "" };
    }

    if (code) {
      const entries = (securities.get(code.body) || []).filter(entry => sameCode(code, entry.code));
      const names = [...new Set(entries.map(entry => entry.name))];
      if (names.length === 1) {
        const conflict = nameConflict(recognized || rawName, names[0]);
        if (conflict) return fallbackResult(conflict);
        return { title: preserveExplicitAttributes(names[0], recognized), rawName, source: "security-code", warning: "" };
      }
      if (names.length > 1) return fallbackResult("同一证券代码对应多个项目简称，需核对");
      if (securities.has(code.body)) return fallbackResult("识别证券代码与项目交易市场不一致");
    }
    return fallbackResult("");
  }

  return function resolve(receipt = {}) {
    const original = resolveOriginal(receipt);
    const review = receipt.identityReview;
    const name = normalizePaymentReceiptBondShortName(review?.name);
    const code = codeIdentity(review?.code);
    const readings = review?.readings || {};
    const field = normalizePaymentReceiptBondShortName(readings.nameField);
    const reference = normalizePaymentReceiptBondShortName(readings.remittanceName);
    const originalCode = codeIdentity(receipt.securityCode);
    if(review?.source==='manual'&&review.status==='verified'&&name&&review.acceptedAt&&review.reviewId
      &&review.pageNumber===receipt.sourcePages?.[0]&&(String(review.code||'').trim()===String(receipt.securityCode||'').trim()
        ||originalCode&&!originalCode.invalid&&code&&!code.invalid&&sameCode(originalCode,code))){
      return{...original,title:name,source:'manual-review'};
    }
    if (review?.status !== "verified" || !name || !field || !reference
        || !code || code.invalid || !sameCode(code, codeIdentity(readings.securityCode))
        || (originalCode && !sameCode(code, originalCode))
        || review.pageNumber !== receipt.sourcePages?.[0]
        || [field, reference].some(value => value.split("(")[0] !== name.split("(")[0])
        || !Array.isArray(readings.uncertainties) || readings.uncertainties.length) return original;
    // This is a separately accepted transcription of one original page, not a
    // rewrite of historical OCR or proof that a multi-page group is one bond.
    const warning = original.warning.includes("多个债券")
      ? "本页简称已复核，但原分组包含多个债券，请核对拆页与对应项目"
      : original.warning;
    return { ...original, title: name, source: "page-review", warning };
  };
}
