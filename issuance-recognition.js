// Shared by the API and browser: model output is untrusted until validated.
export const ISSUANCE_FIELDS = {
  securityCode: "债券代码", durationText: "期限", issueScale: "发行规模（亿元）",
  couponRate: "票面利率（%）", fullMarketMultiple: "全场倍数", marginalMultiple: "边际倍数",
  paymentDate: "缴款日期", startDate: "起息日期",
};
export const ISSUANCE_OUTCOMES = { issued: "正常发行", cancelled: "取消发行", reallocated: "全部回拨", unknown: "尚未确认发行结果" };

const compact = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
const nameKey = (value) => compact(value).toUpperCase().replace(/[（(](?:科创债?|绿色债?|碳中和债?)[）)]/g, "");
const codeKey = (value) => compact(value).toUpperCase().replace(/\.(?:SH|SZ|IB)$/, "");
const hasQuote = (text, quote) => Boolean(compact(quote)) && compact(text).includes(compact(quote));
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mentionsTranche(text, tranche) {
  return nameKey(text).includes(nameKey(tranche.shortName))
    || Boolean(tranche.securityCode && new RegExp(`(?<!\\d)${escapePattern(codeKey(tranche.securityCode))}(?!\\d)`).test(compact(text)));
}
function hasValueQuote(text, raw) {
  const value = compact(raw);
  if (!hasQuote(text, value)) return false;
  // A model cannot justify "1" using the token "1.99" (or "5亿" using "25亿").
  const escaped = escapePattern(value);
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(compact(text));
}

export function validateRecognitionRequest(input) {
  if (!input || typeof input !== "object") throw new Error("请求格式错误。");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > 12000) throw new Error("请提供 1–12000 字的发行通知。");
  const noticeDate = typeof input.noticeDate === "string" ? input.noticeDate : "";
  if (noticeDate && !validDate(noticeDate)) throw new Error("通知日期无效。");
  if (!Array.isArray(input.tranches) || !input.tranches.length || input.tranches.length > 10) throw new Error("请选择含 1–10 个品种的项目。");
  const tranches = input.tranches.map((item) => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100
      || typeof item.shortName !== "string" || !item.shortName.trim() || item.shortName.length > 120) throw new Error("项目品种标识不完整。");
    return { id: item.id, shortName: item.shortName.trim(), securityCode: String(item.securityCode || "").slice(0, 30), durationText: String(item.durationText || "").slice(0, 60) };
  });
  if (new Set(tranches.map((item) => item.id)).size !== tranches.length) throw new Error("项目品种标识重复。");
  return { text, noticeDate, tranches };
}

export function validateSemanticResult(request, result) {
  const errors = [];
  const warnings = [];
  const items = [];
  let needsModelRepair = false;
  if (!result || !Array.isArray(result.items) || result.items.length > 10) throw new Error("模型返回的结构不完整，请重新识别。");
  const shared = Array.isArray(result.sharedEvidence) ? result.sharedEvidence.filter((quote) => typeof quote === "string" && hasQuote(request.text, quote)) : [];
  const used = new Set();
  for (const extracted of result.items) {
    const name = typeof extracted.shortName === "string" ? extracted.shortName : "";
    const source = typeof extracted.sourceText === "string" ? extracted.sourceText : "";
    const code = extracted.fields?.securityCode?.raw || "";
    const named = request.tranches.filter((t) => nameKey(t.shortName) === nameKey(name));
    const coded = code ? request.tranches.filter((t) => t.securityCode && codeKey(t.securityCode) === codeKey(code)) : [];
    const target = named.length === 1 ? named[0] : coded.length === 1 ? coded[0] : null;
    if (!target || (named.length && coded.length && named[0].id !== coded[0].id)) {
      needsModelRepair = true;
      errors.push(`${name || "通知中的品种"}：无法唯一匹配当前项目，未采用。`);
      continue;
    }
    const prefix = `${target.shortName}：`;
    if (used.has(target.id)) { needsModelRepair = true; errors.push(`${prefix}同一品种返回多组结果，请拆分或核对通知。`); continue; }
    used.add(target.id);
    const sourceIdentifiesTarget = mentionsTranche(source, target)
      || Boolean(target.securityCode && code && codeKey(target.securityCode) === codeKey(code) && hasQuote(source, code));
    if (!hasQuote(request.text, source) || !sourceIdentifiesTarget) {
      needsModelRepair = true;
      errors.push(`${prefix}品种原文依据无法核对（摘录“${source.slice(0, 250)}”）。`);
      continue;
    }
    if (target.securityCode && code && codeKey(target.securityCode) !== codeKey(code)) errors.push(`${prefix}券码与项目已有券码冲突。`);
    const outcome = extracted.outcome;
    if (!Object.hasOwn(ISSUANCE_OUTCOMES, outcome)) { errors.push(`${prefix}发行状态无效。`); continue; }
    const noIssue = outcome === "cancelled" || outcome === "reallocated";
    const outcomeEvidence = typeof extracted.outcomeEvidence === "string" ? extracted.outcomeEvidence : "";
    if (noIssue && !hasQuote(source, outcomeEvidence)) errors.push(`${prefix}取消/回拨缺少本品种原文依据。`);
    const outcomePattern = outcome === "cancelled" ? /取消发行|暂缓发行|终止发行|不发行|不发了|不再发行/
      : /全(?:部|数|额).{0,12}(?:回拨|转|拨|划)/;
    if (noIssue && (!outcomePattern.test(outcomeEvidence) || /(?:未|不|不会|并非).{0,3}(?:取消发行|回拨)/.test(source))) errors.push(`${prefix}缺少明确的取消发行/全部回拨事实，不能清空结果。`);
    if (noIssue && /部分回拨|回拨部分|剩余.{0,15}(?:发行|保留)|仍(?:将|然)?发行/.test(source)) errors.push(`${prefix}原文仍有实际发行安排，不能按取消/全部回拨清空结果。`);
    const ownSource = noIssue ? source.replace(outcomeEvidence, "") : source;
    if (request.tranches.some((t) => t.id !== target.id && mentionsTranche(ownSource, t))) { needsModelRepair = true; errors.push(`${prefix}源片段混入其他品种，请拆分后重新识别。`); }
    const item = { trancheId: target.id, shortName: target.shortName, outcome, evidence: {}, sourceText: source,
      allocationNote: noIssue ? `${ISSUANCE_OUTCOMES[outcome]}：${outcomeEvidence.replace(/^[-—]+|[-—]+$/g, "").trim()}` : "" };
    for (const [field, label] of Object.entries(ISSUANCE_FIELDS)) {
      const cell = extracted.fields?.[field];
      item[field] = ["securityCode", "durationText", "paymentDate", "startDate"].includes(field) ? "" : null;
      if (cell?.raw == null || cell.raw === "") continue;
      if (typeof cell.raw !== "string" || typeof cell.evidence !== "string" || cell.raw.length > 100 || cell.evidence.length > 2000
        || !hasValueQuote(cell.evidence, cell.raw) || !hasQuote(request.text, cell.evidence)
        || (!hasQuote(source, cell.evidence) && !shared.some((quote) => hasQuote(quote, cell.evidence) && isSharedFor(quote, target, request.tranches)))) {
        needsModelRepair = true;
        errors.push(`${prefix}${label}的摘录与原文不符，未采用（值“${String(cell?.raw || "").slice(0, 60)}”；依据“${String(cell?.evidence || "").slice(0, 120)}”）。`); continue;
      }
      // A field mentioning another explicit tranche cannot silently cross over.
      const mentionsOther = request.tranches.some((t) => t.id !== target.id && mentionsTranche(cell.evidence, t));
      if (mentionsOther && !shared.some((quote) => hasQuote(quote, cell.evidence) && isSharedFor(quote, target, request.tranches))) {
        needsModelRepair = true;
        errors.push(`${prefix}${label}引用了其他品种的内容。`); continue;
      }
      if (noIssue && !["securityCode", "durationText"].includes(field)) {
        errors.push(`${prefix}取消/全部回拨品种不应带入${label}。`); continue;
      }
      try {
        validateEvidenceUnit(field, cell.raw, cell.evidence);
        if (field === "startDate" && !/起息/.test(cell.evidence)) throw new Error("原文未明确起息安排，不能用缴款日代替。");
        if (field === "paymentDate" && !/缴款|缴付|付款|到账/.test(cell.evidence)) throw new Error("缺少缴款安排的明确依据。");
        item[field] = normalizeExtractedValue(field, cell.raw, request.noticeDate);
        item.evidence[field] = cell.evidence;
      } catch (error) { errors.push(`${prefix}${label}：${error.message}`); }
    }
    if (!noIssue && !item.paymentDate) {
      const scopedNoticeEvidence = request.text
        .split(/[\r\n。；;！？!?]+/)
        .map((quote) => quote.trim())
        .filter((quote) => quote && isSharedFor(quote, target, request.tranches));
      const inferredPayment = explicitPaymentDateFromEvidence(
        [source, ...shared.filter((quote) => isSharedFor(quote, target, request.tranches)), ...scopedNoticeEvidence],
        request.noticeDate,
      );
      if (inferredPayment) {
        item.paymentDate = inferredPayment.date;
        item.evidence.paymentDate = inferredPayment.evidence;
      }
    }
    if (outcome === "unknown" || (!noIssue && item.couponRate == null)) errors.push(`${prefix}尚无明确最终票息，不能确认中标结果。`);
    if (!noIssue && !item.paymentDate) warnings.push(`${prefix}未识别出明确缴款日，不会自动补造日期。`);
    if (!noIssue && item.issueScale == null) warnings.push(`${prefix}未识别出实际发行规模，保留现有值，请核对。`);
    items.push(item);
  }
  if (!items.length) errors.push("没有可应用到当前项目的发行结果。");
  for (const target of request.tranches) if (!used.has(target.id)) warnings.push(`${target.shortName}：本次未识别，保持原结果不变。`);
  return { items, errors: [...new Set(errors)], warnings: [...new Set(warnings)], canApply: errors.length === 0 && items.length > 0, needsModelRepair };
}

function isSharedFor(quote, target, tranches) {
  const names = tranches.filter((t) => mentionsTranche(quote, t));
  if (names.length && !names.some((t) => t.id === target.id)) return false;
  if (names.length > 1 && !/均|共同|统一|同为|都是|各|两个品种|全部品种/.test(quote)) return false;
  // A footer explicitly scoped to "B于..." is not a common date for A.
  const alias = compact(quote).match(/^([A-Z])(?:品种)?(?:于|的|缴款|起息)/)?.[1];
  if (alias && !nameKey(target.shortName).endsWith(alias)) return false;
  return true;
}

function explicitPaymentDateFromEvidence(sources, noticeDate) {
  if (!validDate(noticeDate)) return null;
  const relative = "(?:今天|今日|明天|明日|次日|后天|后日|(?:(?:本|这|下)?周|星期)[一二三四五六日天])";
  const patterns = [
    new RegExp(`(${relative})(?:为|是|进行|安排)?(?:缴款|缴付|付款|到账)`, "g"),
    new RegExp(`(?:缴款|缴付|付款|到账)(?:日|日期|时间)?(?:为|是|安排在|定于)?(${relative})`, "g"),
  ];
  const matches = [];
  for (const source of [...new Set(sources.filter(Boolean))]) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        try {
          matches.push({ date: resolveNoticeDate(match[1], noticeDate), evidence: match[0] });
        } catch { /* Keep the model field empty when the phrase cannot be anchored safely. */ }
      }
    }
  }
  const dates = [...new Set(matches.map((item) => item.date))];
  return dates.length === 1 ? matches.find((item) => item.date === dates[0]) : null;
}

function validateEvidenceUnit(field, raw, evidence) {
  if (!["couponRate", "fullMarketMultiple", "marginalMultiple"].includes(field)) return;
  const value = compact(raw);
  const quote = compact(evidence);
  const adjacent = [...quote.matchAll(new RegExp(`(?<![\\d.])${escapePattern(value)}(?![\\d.])(%|倍|亿元?|万元?|元)`, "g"))].map((match) => match[1]);
  if (field === "couponRate" && adjacent.some((unit) => unit !== "%")) throw new Error("原文对应值是倍数或金额，不能作为票息。");
  if (field !== "couponRate" && (adjacent.some((unit) => unit !== "倍") || quote.includes(`百分之${value}`))) throw new Error("原文对应值是利率或金额，不能作为认购倍数。");
}

function normalizeExtractedValue(field, raw, noticeDate) {
  const value = compact(raw);
  if (field === "securityCode") {
    if (!/^\d{6,9}(?:\.(?:SH|SZ|IB))?$/i.test(value)) throw new Error("代码格式无法确认。");
    return value.toUpperCase();
  }
  if (field === "durationText") {
    if (!/^(?:[\d.零〇一二两三四五六七八九十百]+[年月天日YMD]?)(?:[+＋/][\d.年月天日YMD]+)*(?:年|月|天|日|Y|M|D|年期|个月|年永续)?$/i.test(value)) throw new Error("期限需人工核对。");
    const chineseTenor = value.match(/^([零〇一二两三四五六七八九十百]+)(年期?|个月|月|天|日)$/);
    return chineseTenor ? `${chineseNumber(chineseTenor[1])}${chineseTenor[2]}` : value;
  }
  if (field === "paymentDate" || field === "startDate") return resolveNoticeDate(value, noticeDate);
  if (field === "couponRate" && /倍|亿|万|元/.test(value)) throw new Error("票息不能使用倍数或金额单位。");
  if (["fullMarketMultiple", "marginalMultiple"].includes(field) && /%|百分之|亿|万|元/.test(value)) throw new Error("认购倍数不能使用利率或金额单位。");
  let numeric = value.replace(/^百分之/, "").replace(/(?:亿元?|万元?|元|%|倍)$/, "");
  let number = /^\d+(?:\.\d+)?$/.test(numeric) ? Number(numeric) : chineseNumber(numeric);
  if (field === "issueScale") {
    if (/万元?$/.test(value)) number /= 10000;
    else if (/亿元?$/.test(value)) { /* Already in 亿元. */ }
    else if (/元$/.test(value)) number /= 100000000;
    else throw new Error("缺少明确金额单位。");
  }
  const max = field === "couponRate" ? 100 : field === "issueScale" ? 100000 : 10000;
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error("数字或单位无法确认。");
  return Math.round(number * 1e8) / 1e8;
}

function chineseNumber(text) {
  const digits = "零一二三四五六七八九";
  const [integer, decimals] = text.replace(/〇/g, "零").replace(/两/g, "二").split("点");
  let total = 0; let pending = 0;
  if (!integer || !/^[零一二三四五六七八九十百千]+$/.test(integer) || (decimals != null && !/^[零一二三四五六七八九]+$/.test(decimals))) return NaN;
  for (const char of integer) {
    const digit = digits.indexOf(char);
    if (digit >= 0) pending = digit;
    else { total += (pending || 1) * ({ 十: 10, 百: 100, 千: 1000 }[char]); pending = 0; }
  }
  return total + pending + (decimals ? Number(`0.${[...decimals].map((d) => digits.indexOf(d)).join("")}`) : 0);
}

export function resolveNoticeDate(raw, reference) {
  const value = compact(raw);
  const relativeValue = value.match(/^(?:于)?(今天|今日|明天|明日|次日|后天|后日)(?:缴款|缴付|付款|到账)?(?:日)?$/)?.[1] || value;
  const offset = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 次日: 1, 后天: 2, 后日: 2 }[relativeValue];
  if (offset != null) {
    if (!validDate(reference)) throw new Error("请先填写原通知日期，不能按录入日猜测。");
    const date = new Date(`${reference}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  const weekday = value.match(/^(?:于)?((?:本|这|下)?周|星期)([一二三四五六日天])(?:缴款|缴付|付款|到账)?(?:日)?$/);
  if (weekday) {
    if (!validDate(reference)) throw new Error("请先填写原通知日期，不能按录入日猜测。");
    const targetIsoDay = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[weekday[2]];
    const date = new Date(`${reference}T00:00:00Z`);
    const currentIsoDay = date.getUTCDay() || 7;
    const prefix = weekday[1];
    const dayOffset = prefix === "下周"
      ? 7 - currentIsoDay + targetIsoDay
      : ["本周", "这周"].includes(prefix)
        ? targetIsoDay - currentIsoDay
        : (targetIsoDay - currentIsoDay + 7) % 7;
    date.setUTCDate(date.getUTCDate() + dayOffset);
    return date.toISOString().slice(0, 10);
  }
  const match = value.match(/^(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?$/);
  if (!match || (!match[1] && !validDate(reference))) throw new Error("请补充可确认的完整日期或通知日期。");
  const date = `${match[1] || reference.slice(0, 4)}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  if (!validDate(date)) throw new Error("日期不存在。");
  if (!match[1] && Date.parse(date) < Date.parse(reference) - 31 * 86400000) throw new Error("省略年份的日期早于通知日期，请补充完整年份，避免跨年误判。");
  return date;
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// One review session owns one request. Late responses never replace a newer draft.
export function createIssuanceReviewSession() {
  let sequence = 0; let controller = null; let preview = null;
  function invalidate() { sequence += 1; controller?.abort(); controller = null; preview = null; }
  return {
    invalidate,
    async recognize(snapshot, request) {
      invalidate();
      const id = sequence;
      const key = JSON.stringify(snapshot);
      controller = new AbortController();
      try {
        const result = await request(controller.signal);
        if (id !== sequence) return null;
        preview = { key, result };
        return result;
      } catch (error) { if (id !== sequence) return null; throw error; }
      finally { if (id === sequence) controller = null; }
    },
    take(snapshot) {
      if (!preview || preview.key !== JSON.stringify(snapshot) || !preview.result.canApply) return null;
      const result = preview.result;
      invalidate();
      return result;
    },
  };
}
