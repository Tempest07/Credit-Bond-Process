const DATE_PATTERN = /(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/;
const PREPAYMENT_PATTERN = /\bW20\d{11}\b/i;
const MONEY_LABEL_PATTERN = /(?:应缴款项总额|应缴款总额|交易金额|付款金额|转账金额|汇款金额|缴款金额|发生额)[^\d+-]{0,24}(?:人民币|CNY|RMB|[¥￥])?\s*([+-]?\d[\d,]*(?:\.\d{1,4})?)\s*(万元|万人民币|元|人民币)?/i;
const RECEIPT_START_PATTERN = /(?:配售(?:确认及)?缴款通知书|配售缴款通知书|配售确认书|缴款通知书)/;
const RECEIPT_CONTINUATION_PATTERN = /(?:^|\n)\s*(?:附件[一二三四五六七八九十\d]*\s*[：:]?|.*(?:获配金额分配信息表|配售金额分配信息表|认购账户表|账户分配信息表))/i;

export const PAYMENT_RECEIPT_MATCH_STATUSES = new Set([
  "matched",
  "review",
  "unmatched",
  "duplicate",
  "error",
]);

export function recognizePaymentReceiptText(rawText = "", fallback = {}) {
  const text = normalizeWhitespace(rawText);
  const paymentDate = normalizeDate(fallback.paymentDate) || extractPaymentDate(text);
  const prepaymentNumber = normalizePrepaymentNumber(
    fallback.prepaymentNumber || text.match(PREPAYMENT_PATTERN)?.[0],
  );
  const amountFen = normalizeAmountFen(
    fallback.amountFen ?? extractAmountFen(text),
  );

  return {
    paymentDate,
    amountFen,
    prepaymentNumber,
    securityCode: cleanIdentifier(
      fallback.securityCode || extractLabelValue(text, ["债券代码", "证券代码", "债券编码"], /[A-Z]?\d{6,18}(?:\.[A-Z]{2})?/i),
    ),
    bondShortName: cleanBondShortName(
      fallback.bondShortName || extractLabelValue(text, ["债券简称", "证券简称", "缴款项目"], /[^\n；;]{2,50}/),
    ),
    payerName: cleanTextField(
      fallback.payerName || extractLabelValue(text, ["投资者名称", "付款人", "付款单位", "汇款人", "缴款人"], /[^\n；;]{2,80}/),
    ),
    payeeName: cleanTextField(
      fallback.payeeName || extractLabelValue(text, ["收款人", "收款单位", "收款方"], /[^\n；;]{2,80}/),
    ),
    bankReference: cleanIdentifier(
      fallback.bankReference || extractLabelValue(text, ["银行流水号", "交易流水号", "业务编号", "凭证号", "参考号"], /[A-Z0-9-]{5,40}/i),
    ),
    recognizedText: text,
  };
}

export function groupPaymentReceiptPages(pageInputs = []) {
  const groups = [];
  const blankPages = [];
  const uncertainPages = [];
  let current = null;

  for (const rawPage of Array.isArray(pageInputs) ? pageInputs : []) {
    const page = normalizeReceiptPage(rawPage);
    if (page.classification === "blank") {
      blankPages.push(page.pageNumber);
      continue;
    }
    if (page.classification === "uncertain") uncertainPages.push(page.pageNumber);

    if (!current || page.startsReceipt) {
      current = {
        pageNumbers: [],
        pages: [],
        recognizedText: "",
      };
      groups.push(current);
    }

    current.pageNumbers.push(page.pageNumber);
    current.pages.push(page);
    current.recognizedText = [current.recognizedText, page.text].filter(Boolean).join("\n\n");
  }

  return {
    groups: groups.map((group, index) => ({
      ...group,
      index,
      firstPage: group.pageNumbers[0] || null,
      lastPage: group.pageNumbers.at(-1) || null,
      pageLabel: formatPageNumbers(group.pageNumbers),
    })),
    blankPages,
    uncertainPages,
  };
}

export function classifyPaymentReceiptPage(input = {}) {
  return normalizeReceiptPage(input);
}

export function selectPaymentReceiptMatch(receiptInput = {}, projects = []) {
  const receipt = normalizeReceipt(receiptInput);
  const allCandidates = flattenPaymentProjects(projects);
  const datedCandidates = receipt.paymentDate
    ? allCandidates.filter((item) => item.paymentDate === receipt.paymentDate)
    : allCandidates;
  const identifierCandidates = allCandidates.filter((candidate) => candidateHasExactIdentifier(receipt, candidate));
  const candidatePool = identifierCandidates.length ? identifierCandidates : datedCandidates;
  const candidates = candidatePool
    .map((candidate) => scoreCandidate(receipt, candidate))
    .filter((candidate) => candidate.score > 0)
    .sort(compareCandidates);

  if (!candidates.length) {
    return {
      status: "unmatched",
      projectId: "",
      trancheId: "",
      score: 0,
      reason: receipt.paymentDate ? "当日项目中没有可识别的匹配项" : "缴款单未识别出日期或业务标识",
      candidates: [],
    };
  }

  const best = candidates[0];
  const second = candidates[1];
  const uniqueBest = !second || best.score - second.score >= 20;
  const exactIdentifier = best.signals.prepaymentNumber || best.signals.securityCode;
  const exactBusinessMatch = best.signals.shortName
    && (best.signals.amount || datedCandidates.length === 1);
  const canAutoMatch = uniqueBest && (exactIdentifier || exactBusinessMatch);

  return {
    status: canAutoMatch ? "matched" : "review",
    projectId: canAutoMatch ? best.projectId : "",
    trancheId: canAutoMatch ? best.trancheId : "",
    score: best.score,
    reason: canAutoMatch
      ? describeMatch(best)
      : `存在${Math.min(candidates.length, 5)}个候选项目，需要人工确认`,
    candidates: candidates.slice(0, 5).map(publicCandidate),
  };
}

function candidateHasExactIdentifier(receipt, candidate) {
  return Boolean(
    candidate.prepaymentNumber
      && (candidate.prepaymentNumber === receipt.prepaymentNumber
        || receipt.searchText.includes(normalizeMatchText(candidate.prepaymentNumber))),
  ) || Boolean(
    candidate.securityCode
      && (candidate.securityCode === receipt.securityCode
        || receipt.searchText.includes(normalizeMatchText(candidate.securityCode))),
  );
}

export function flattenPaymentProjects(projects = []) {
  return (Array.isArray(projects) ? projects : []).flatMap((project) =>
    (Array.isArray(project?.tranches) ? project.tranches : []).flatMap((tranche) => {
      const paymentDate = normalizeDate(tranche?.paymentDate);
      if (!project?.id || !tranche?.id || !paymentDate) return [];
      return [{
        projectId: String(project.id),
        trancheId: String(tranche.id),
        projectShortName: cleanTextField(project.shortName),
        shortName: cleanTextField(tranche.shortName || project.shortName),
        issuerName: cleanTextField(project.issuerName),
        paymentDate,
        paymentCompleted: Boolean(tranche.paymentCompleted),
        prepaymentNumber: normalizePrepaymentNumber(tranche.prepaymentNumber),
        securityCode: cleanIdentifier(tranche.securityCode),
        winningAmountWan: finiteNumber(tranche.winningAmountWan),
      }];
    }),
  );
}

export function buildPaymentReceiptCoverage(projects = [], matches = [], filters = {}) {
  const date = normalizeDate(filters.date);
  const matchedByTarget = new Map((Array.isArray(matches) ? matches : []).flatMap((match) => {
    const projectId = String(match?.projectId || "");
    const trancheId = String(match?.trancheId || "");
    if (!projectId || !trancheId) return [];
    return [[`${projectId}:${trancheId}`, {
      receiptId: String(match.receiptId || ""),
      matchSource: String(match.matchSource || ""),
      matchScore: Number(match.matchScore) || 0,
    }]];
  }));

  const targets = (Array.isArray(projects) ? projects : []).flatMap((project) =>
    (Array.isArray(project?.tranches) ? project.tranches : []).flatMap((tranche) => {
      const paymentDate = normalizeDate(tranche?.paymentDate);
      if (!project?.id || !tranche?.id || !paymentDate || (date && paymentDate !== date)) return [];
      if (!paymentReceiptExpectedForTranche(project, tranche)) return [];
      const match = matchedByTarget.get(`${project.id}:${tranche.id}`) || null;
      return [{
        projectId: String(project.id),
        trancheId: String(tranche.id),
        projectShortName: cleanTextField(project.shortName),
        shortName: cleanTextField(tranche.shortName || project.shortName),
        issuerName: cleanTextField(project.issuerName),
        paymentDate,
        paymentCompleted: Boolean(tranche.paymentCompleted),
        winningAmountWan: finiteNumber(tranche.winningAmountWan),
        receiptId: match?.receiptId || "",
        matchSource: match?.matchSource || "",
        covered: Boolean(match?.receiptId),
      }];
    }),
  ).sort((left, right) =>
    `${right.paymentDate}:${right.shortName}`.localeCompare(`${left.paymentDate}:${left.shortName}`, "zh-CN"),
  );
  const covered = targets.filter((target) => target.covered).length;
  return {
    expected: targets.length,
    covered,
    missing: targets.length - covered,
    targets,
  };
}

export function normalizePaymentReceiptPageGroups(input = {}, pageCountValue = 0) {
  const pageCount = Number(pageCountValue);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 60) {
    throw new Error("原始 PDF 页数无效或超过 60 页上限");
  }
  const rawGroups = Array.isArray(input.groups) ? input.groups : [];
  const rawBlankPages = Array.isArray(input.blankPages) ? input.blankPages : [];
  const groups = rawGroups.map((group, index) => {
    if (!Array.isArray(group) || !group.length) throw new Error(`第 ${index + 1} 组没有页面`);
    return normalizePaymentReceiptPageList(group, pageCount, `第 ${index + 1} 组`);
  });
  const blankPages = normalizePaymentReceiptPageList(rawBlankPages, pageCount, "空白页");
  const seen = new Map();
  groups.forEach((group, groupIndex) => group.forEach((pageNumber) => {
    if (seen.has(pageNumber)) throw new Error(`第 ${pageNumber} 页被重复分组`);
    seen.set(pageNumber, `第 ${groupIndex + 1} 组`);
  }));
  blankPages.forEach((pageNumber) => {
    if (seen.has(pageNumber)) throw new Error(`第 ${pageNumber} 页同时出现在单据分组和空白页中`);
    seen.set(pageNumber, "空白页");
  });
  const missing = Array.from({ length: pageCount }, (_, index) => index + 1).filter((pageNumber) => !seen.has(pageNumber));
  if (missing.length) throw new Error(`尚未归类第 ${missing.join("、")} 页`);
  return { groups, blankPages };
}

function normalizePaymentReceiptPageList(values, pageCount, label) {
  const normalized = values.map(Number);
  for (const pageNumber of normalized) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`${label}包含无效页码`);
    }
  }
  const unique = [...new Set(normalized)].sort((left, right) => left - right);
  if (unique.length !== normalized.length) throw new Error(`${label}包含重复页码`);
  return unique;
}

function paymentReceiptExpectedForTranche(project = {}, tranche = {}) {
  if (tranche.resultStatus === "未中标" && !tranche.paymentCompleted) return false;
  const won = tranche.resultStatus === "中标"
    || positiveFiniteNumber(tranche.winningAmountWan)
    || tranche.outsourcedBids?.some((bid) => positiveFiniteNumber(bid?.winningAmountWan));
  const projectWon = ["部分中标", "已中标", "待缴款", "已缴款"].includes(String(project.status || ""));
  return Boolean(tranche.paymentCompleted || won || (projectWon && tranche.resultStatus !== "未中标"));
}

export function normalizeAmountFen(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : Math.round(value);
  const amount = Number(String(value).replace(/[，,\s]/g, ""));
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

export function normalizeDate(value) {
  const text = String(value || "").trim();
  const match = text.match(DATE_PATTERN) || text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeReceipt(input = {}) {
  const recognized = recognizePaymentReceiptText(input.recognizedText, input);
  return {
    ...recognized,
    searchText: normalizeMatchText([
      recognized.recognizedText,
      recognized.bondShortName,
      recognized.prepaymentNumber,
      recognized.securityCode,
      recognized.bankReference,
      recognized.payerName,
      recognized.payeeName,
    ].join(" ")),
  };
}

function positiveFiniteNumber(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) && number > 0;
}

function scoreCandidate(receipt, candidate) {
  const signals = {
    date: Boolean(receipt.paymentDate && receipt.paymentDate === candidate.paymentDate),
    prepaymentNumber: Boolean(candidate.prepaymentNumber
      && (candidate.prepaymentNumber === receipt.prepaymentNumber || receipt.searchText.includes(normalizeMatchText(candidate.prepaymentNumber)))),
    securityCode: Boolean(candidate.securityCode
      && (candidate.securityCode === receipt.securityCode || receipt.searchText.includes(normalizeMatchText(candidate.securityCode)))),
    shortName: textContainsBusinessName(receipt.searchText, candidate.shortName)
      || textContainsBusinessName(receipt.searchText, candidate.projectShortName),
    issuerName: textContainsBusinessName(receipt.searchText, candidate.issuerName),
    amount: amountsMatch(receipt.amountFen, candidate.winningAmountWan),
  };
  const score = (signals.date ? 20 : 0)
    + (signals.prepaymentNumber ? 120 : 0)
    + (signals.securityCode ? 90 : 0)
    + (signals.shortName ? 65 : 0)
    + (signals.amount ? 45 : 0)
    + (signals.issuerName ? 15 : 0);
  return { ...candidate, score, signals };
}

function amountsMatch(amountFen, winningAmountWan) {
  if (!Number.isSafeInteger(amountFen) || !Number.isFinite(winningAmountWan)) return false;
  const expectedFen = Math.round(winningAmountWan * 10_000 * 100);
  return Math.abs(amountFen - expectedFen) <= 1;
}

function compareCandidates(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  if (left.paymentCompleted !== right.paymentCompleted) return Number(left.paymentCompleted) - Number(right.paymentCompleted);
  return `${left.projectId}:${left.trancheId}`.localeCompare(`${right.projectId}:${right.trancheId}`);
}

function publicCandidate(candidate) {
  return {
    projectId: candidate.projectId,
    trancheId: candidate.trancheId,
    shortName: candidate.shortName,
    issuerName: candidate.issuerName,
    paymentDate: candidate.paymentDate,
    paymentCompleted: candidate.paymentCompleted,
    score: candidate.score,
    signals: candidate.signals,
  };
}

function describeMatch(candidate) {
  const labels = [];
  if (candidate.signals.prepaymentNumber) labels.push("预缴款编号");
  if (candidate.signals.securityCode) labels.push("债券代码");
  if (candidate.signals.shortName) labels.push("债券简称");
  if (candidate.signals.amount) labels.push("金额");
  if (candidate.signals.date) labels.push("缴款日期");
  return `${labels.join("、")}唯一匹配`;
}

function extractPaymentDate(text) {
  const labelled = text.match(/(?:缴款截止时间|交易日期|付款日期|缴款日期|汇款日期|记账日期)[^\d]{0,16}(20\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)/);
  const deadline = text.match(/(?:请[^\n]{0,12}?于|须于|应于)\s*(20\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)[^\n]{0,24}?(?:前|之前)/);
  return normalizeDate(labelled?.[1] || deadline?.[1] || text.match(DATE_PATTERN)?.[0]);
}

function extractAmountFen(text) {
  const match = text.match(MONEY_LABEL_PATTERN);
  if (!match) return null;
  const yuan = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(yuan)) return null;
  const multiplier = /万元|万人民币/.test(`${match[0]} ${match[2] || ""}`) ? 10_000 : 1;
  return Math.round(yuan * multiplier * 100);
}

function normalizeReceiptPage(input = {}) {
  const pageNumber = Math.max(1, Math.trunc(Number(input.pageNumber) || 1));
  const text = normalizeWhitespace(input.text || input.recognizedText);
  const inkRatio = finiteNumber(input.inkRatio);
  const explicitBlank = input.isBlank === true;
  const visualBlank = Number.isFinite(inkRatio) && inkRatio < 0.006;
  const hasUsefulText = normalizeMatchText(text).length >= 12;
  const requestedClassification = String(input.classification || "");
  const classification = requestedClassification === "uncertain"
    ? "uncertain"
    : requestedClassification === "blank" || explicitBlank || (visualBlank && !hasUsefulText)
    ? "blank"
    : !hasUsefulText && !Number.isFinite(inkRatio)
      ? "uncertain"
      : "content";
  const startsReceipt = classification !== "blank" && isPaymentReceiptStart(text, input);
  return {
    pageNumber,
    text,
    inkRatio,
    classification,
    startsReceipt,
  };
}

function isPaymentReceiptStart(text, input = {}) {
  if (RECEIPT_CONTINUATION_PATTERN.test(text)) return false;
  if (input.startsReceipt === true) return true;
  if (input.startsReceipt === false) return false;
  if (!RECEIPT_START_PATTERN.test(text)) return false;
  const hasBondIdentity = /债券(?:简称|代码|名称)/.test(text)
    || /\b\d{2}[\u4e00-\u9fa5A-Z0-9]{2,}(?:SCP|CP|MTN|PPN|ABN)\d{3}\b/i.test(normalizeWhitespace(text).replace(/\s+/g, ""));
  return hasBondIdentity || text.length >= 80;
}

function formatPageNumbers(values = []) {
  if (!values.length) return "";
  const parts = [];
  let start = values[0];
  let previous = values[0];
  for (const value of values.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = value;
    previous = value;
  }
  parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  return parts.join("、");
}

function extractLabelValue(text, labels, valuePattern) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*(${valuePattern.source})`, valuePattern.flags));
  return match?.[1] || "";
}

function normalizePrepaymentNumber(value) {
  const text = cleanIdentifier(value).toUpperCase();
  return PREPAYMENT_PATTERN.test(text) ? text.match(PREPAYMENT_PATTERN)[0].toUpperCase() : "";
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s·•:：,，.。()（）\[\]【】_-]+/g, "");
}

function textContainsBusinessName(haystack, value) {
  const needle = normalizeMatchText(value);
  return needle.length >= 4 && haystack.includes(needle);
}

function cleanIdentifier(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, "");
}

function cleanTextField(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function cleanBondShortName(value) {
  return cleanTextField(value)
    .replace(/\s*(?:债券代码|证券代码|债券编码|缴款金额|应缴款(?:项)?总额|付款金额|交易金额)\s*[:：]?.*$/i, "")
    .trim();
}

function normalizeWhitespace(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
