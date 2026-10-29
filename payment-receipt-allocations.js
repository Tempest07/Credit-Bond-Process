import { normalizeDate, recognizePaymentReceiptText } from './payment-receipts.js';
import { normalizePaymentReceiptBondShortName } from './payment-receipt-names.js';
import { paymentReceiptCodeIdentity } from './payment-receipt-security.js';

/** Accept the next OCR schema as well as already-stored native table text.
 * Amounts are taken from each row's payment column, never from issuance size
 * or the last amount belonging to another tranche. No project data is inferred. */
export function readPaymentReceiptAllocations(rawText = '', fields = {}) {
  const text = allocationText(rawText);
  const shared = sharedReceipt(text, fields);
  const rows = allocationInputs(text, fields);
  const unique = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (explicitlyUnallocated(row)) continue;
    const name = normalizePaymentReceiptBondShortName(row.bondShortName || row.bond_short_name || row.name || '');
    const code = paymentReceiptCodeIdentity(row.securityCode || row.security_code || row.code || '');
    const amountFen = allocationAmount(row);
    const paymentDate = normalizeDate(row.paymentDate || row.payment_date || row.date) || shared.paymentDate;
    const coupon = String(row.couponRate ?? row.coupon_rate ?? '').normalize('NFKC').trim();
    const couponRate = /^\d+(?:\.\d+)?\s*%?$/.test(coupon) ? coupon.replace(/\s|%/g, '') + '%' : '';
    const allocationKey = code && !code.invalid ? code.text : name ? 'name:' + name : 'unresolved:' + (index + 1);
    const allocation = { allocationKey, bondShortName: name, securityCode: code?.text || '', amountFen, paymentDate,
      couponRate, tenor: String(row.tenor || row.term || '').normalize('NFKC').trim().slice(0, 40),
      prepaymentNumber: String(row.prepaymentNumber || row.prepayment_number || '').trim(),
      requiresReview: !name || !code || code.invalid === true || amountFen === null || row.requiresReview === true };
    if (unique.has(allocationKey)) {
      const previous = unique.get(allocationKey);
      if (previous.bondShortName !== name || previous.amountFen !== amountFen || previous.paymentDate !== paymentDate) {
        previous.requiresReview = true;
      }
      continue;
    }
    unique.set(allocationKey, allocation);
  }
  return [...unique.values()];
}

/** Expand physical page groups into logical receipts while retaining the same
 * original pages. Single-tranche IDs/page labels remain on the legacy path.
 * Multi-tranche IDs and fallback fingerprints must include allocationKey. */
export function expandPaymentReceiptAllocationGroup(group = {}, pageAnalyses = []) {
  const pageNumbers = Array.isArray(group.pageNumbers) ? [...group.pageNumbers] : [];
  const pages = pageAnalyses.filter(page => pageNumbers.includes(page.pageNumber));
  const first = pages.find(page => page.classification === 'receipt_start') || pages[0] || {};
  const text = pages.map(page => page.recognizedText || '').filter(Boolean).join('\n\n');
  const shared = sharedReceipt(text, first.fields || {});
  const rows = readPaymentReceiptAllocations(first.recognizedText || text, first.fields || {});
  const originalRows = allocationInputs(allocationText(first.recognizedText || text), first.fields || {});
  const physicalPageLabel = String(group.pageLabel || pageNumbers.join(','));
  if (!rows.length && originalRows.length && originalRows.every(explicitlyUnallocated)) return [];
  if (rows.length < 2 && originalRows.length < 2) {
    const row = rows[0];
    const recognized = row ? { ...recognizePaymentReceiptText(text, { ...shared, ...row }), amountFen: row.amountFen,
      securityCode: row.securityCode, bondShortName: row.bondShortName, paymentDate: row.paymentDate } : shared;
    return [{ ...group, pageNumbers, sourcePages: pageNumbers, physicalPageLabel, pageLabel: physicalPageLabel,
      sourcePageLabel: physicalPageLabel, allocationKey: '', recognized, requiresReview: Boolean(row?.requiresReview) }];
  }
  return rows.map(row => {
    // Do not inherit the shared prepayment number: a shared number with equal
    // allocations must not make distinct securities duplicate one another.
    const prepaymentNumber = row.prepaymentNumber && rows.filter(other => other.prepaymentNumber === row.prepaymentNumber).length === 1
      ? row.prepaymentNumber : '';
    const fields = { paymentDate: row.paymentDate, amountFen: row.amountFen, bondShortName: row.bondShortName,
      securityCode: row.securityCode, prepaymentNumber,
      payerName: shared.payerName, payeeName: shared.payeeName, bankReference: shared.bankReference };
    const recognizedText = [
      row.bondShortName && `债券简称 ${row.bondShortName}`,
      row.securityCode && `债券代码 ${row.securityCode}`,
      row.paymentDate && `缴款日期 ${row.paymentDate}`,
      row.amountFen !== null && `缴款金额 ${row.amountFen / 100}元`,
      row.couponRate && `票面利率 ${row.couponRate}`,
      row.tenor && `债券期限 ${row.tenor}`,
      fields.payerName && `付款人 ${fields.payerName}`,
      fields.payeeName && `收款人 ${fields.payeeName}`,
      prepaymentNumber && `预缴款编号 ${prepaymentNumber}`,
    ].filter(Boolean).join('\n');
    const allocationKey = rows.length > 1 ? row.allocationKey : '';
    const label = allocationKey ? `${physicalPageLabel}#${allocationKey}` : physicalPageLabel;
    return { ...group, pageNumbers: [...pageNumbers], sourcePages: [...pageNumbers], physicalPageLabel,
      pageLabel: label, sourcePageLabel: label, allocationKey, allocation: row,
      requiresReview: row.requiresReview, recognized: { ...fields, recognizedText } };
  });
}

function tableAllocations(text) {
  const header = text.match(/债券简称\s+债券代码[\s\S]{0,300}?缴款金额\s*\(\s*(万\s*元|亿\s*元|元)\s*\)/i);
  if (!header || header.index === undefined) return [];
  const tail = text.slice(header.index + header[0].length).split(/请贵公司|请将|请于|收款人名称|开户行名称|银行账号|贵公司办理|联系人/)[0];
  const rows = [];
  for (const line of tail.split('\n')) {
    const code = line.match(/(?<![A-Z0-9])(?:\d{6}|\d{9})(?:\.(?:IB|SH|SZ))?(?![A-Z0-9])/i);
    if (!code || code.index === undefined) continue;
    const name = normalizePaymentReceiptBondShortName(line.slice(0, code.index).replace(/^[\s:|]+|[\s:|]+$/g, ''));
    const rest = line.slice(code.index + code[0].length).replace(/[|\s]+$/g, '');
    const lastAmount = rest.match(/(\d[\d,]*(?:\.\d+)?)\s*(亿元|万元|元)?$/);
    const unpaid = /(?:-|—|–)\s*$/.test(rest);
    if (!name || !lastAmount && !unpaid) continue;
    rows.push({ name, code: code[0], amount_text: unpaid ? '-' : lastAmount[1] + (lastAmount[2] || header[1].replace(/\s/g, '')),
      tenor: rest.match(/\d+(?:\.\d+)?\s*(?:年|天|日)/)?.[0] || '', coupon_rate: rest.match(/\d+(?:\.\d+)?\s*%/)?.[0] || '' });
  }
  return rows;
}

function allocationInputs(text, fields) {
  if (Array.isArray(fields.allocations) && fields.allocations.length) return fields.allocations;
  return transposedAllocations(text) || labelledAllocations(text) || tableAllocations(text);
}

function labelledAllocations(text) {
  const labels = [...text.matchAll(/债券简称\s*[:：]?\s*/g)];
  if (labels.length < 2) return null;
  const rows = labels.map((label, index) => {
    const block = text.slice(label.index + label[0].length, labels[index + 1]?.index ?? text.length);
    const name = normalizePaymentReceiptBondShortName(block);
    const code = block.match(/债券代码\s*[:：]?\s*((?:\d{6}|\d{9})(?:\.(?:SH|SZ|IB))?)/i)?.[1];
    const amount = block.match(/缴款金额\s*\(\s*(亿元|万元|元)\s*\)\s*[:：]?\s*([\d,]+(?:\.\d+)?|[-—–]+)/);
    return name && code ? { name, code, amount_text: amount ? /[-—–]/.test(amount[2]) ? '-' : amount[2] + amount[1] : '',
      coupon_rate: block.match(/票面利率\s*[:：]?\s*(\d+(?:\.\d+)?\s*%)/)?.[1] || '',
      tenor: block.match(/(?:发行|债券)期限\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:年|天|日))/)?.[1] || '' } : null;
  }).filter(Boolean);
  return rows.length ? rows : null;
}

function transposedAllocations(text) {
  const lines = text.split('\n').map(line => line.trim());
  const namesLine = lines.find(line => /^债券简称\s/.test(line));
  if (!namesLine) return null;
  const rawNames = namesLine.replace(/^债券简称\s*[:：]?\s*/, '');
  const starts = [...rawNames.matchAll(/\d{2}\s*(?=[\u3400-\u9fffA-Z])/g)];
  if (starts.length < 2) return null;
  const names = starts.map((start, index) => normalizePaymentReceiptBondShortName(rawNames.slice(start.index, starts[index + 1]?.index)));
  const codesLine = lines.find(line => /^债券代码\s/.test(line)) || '';
  const codes = [...codesLine.matchAll(/(?<![A-Z0-9])(?:\d{6}|\d{9})(?:\.(?:IB|SH|SZ))?(?![A-Z0-9])/gi)].map(match => match[0]);
  if (names.some(name => !name) || codes.length !== names.length) return null;
  const amountValues = label => {
    const line = lines.find(value => label.test(value)); if (!line) return null;
    const unit = line.match(/\(\s*(亿元|万元|元)\s*\)/)?.[1];
    if (!unit) return null;
    const tail = line.slice(line.indexOf(')') + 1);
    const values = [...tail.matchAll(/\d[\d,]*(?:\.\d+)?|[-—–]+/g)].map(match => /[-—–]/.test(match[0]) ? '-' : match[0] + unit);
    return values.length ? values : null;
  };
  let payments = amountValues(/^缴款金额\s*\(/);
  const face = amountValues(/^获配(?:面值|金额)\s*\(/);
  const total = amountValues(/^缴款金额合计\s*\(/)?.[0];
  if ((!payments || payments.length !== names.length) && face?.length === names.length) {
    const positive = face.map((value, index) => allocationAmount({ amount_text: value }) !== null ? index : -1).filter(index => index >= 0);
    if (positive.length === 1 && face.every(value => allocationAmount({ amount_text: value }) !== null || explicitlyUnallocated({ amount_text: value })) && total) {
      payments = face.map((value, index) => index === positive[0] ? total : value);
    } else {
      const prices = (lines.find(line => /^发行价格\s/.test(line)) || '').replace(/^发行价格\s*/, '').trim().split(/\s+/);
      if (prices.length === names.length && prices.every(price => /^100(?:\.0+)?(?:元)?$/.test(price))) payments = face;
    }
  }
  const coupons = [...(lines.find(line => /^票面利率\s/.test(line)) || '').matchAll(/\d+(?:\.\d+)?\s*%/g)].map(match => match[0]);
  const tenors = [...(lines.find(line => /^(?:债券|发行)期限\s/.test(line)) || '').matchAll(/\d+(?:\.\d+)?\s*(?:年|天|日)/g)].map(match => match[0]);
  return names.map((name, index) => ({ name, code: codes[index], amount_text: payments?.[index] || '', coupon_rate: coupons[index] || '', tenor: tenors[index] || '' }));
}

function explicitlyUnallocated(row) {
  if (!row || typeof row !== 'object') return false;
  for (const field of ['amountFen', 'amount_fen', 'amountWan', 'amount_wan', 'amountYuan', 'amount_yuan']) {
    if (row[field] !== null && row[field] !== undefined && row[field] !== '' && Number(String(row[field]).replace(/[,，\s]/g, '')) === 0) return true;
  }
  const text = String(row.amountText || row.amount_text || row.paymentAmount || '').normalize('NFKC').replace(/[,\s]/g, '');
  return /^[-—–]+$/.test(text) || /^0+(?:\.0+)?(?:亿元|万元|元)?$/.test(text);
}

function allocationAmount(row) {
  const fen = row.amountFen ?? row.amount_fen;
  if (fen !== undefined && fen !== null && fen !== '') return validAmount(Number(String(fen).replace(/[,，\s]/g, '')));
  for (const [field, factor] of [['amountWan', 1_000_000], ['amount_wan', 1_000_000], ['amountYuan', 100], ['amount_yuan', 100]]) {
    if (row[field] !== undefined && row[field] !== null && row[field] !== '') return validAmount(Number(String(row[field]).replace(/[,，\s]/g, '')) * factor);
  }
  const text = String(row.amountText || row.amount_text || row.paymentAmount || '').normalize('NFKC').replace(/[,\s]/g, '');
  const match = text.match(/^(\d+(?:\.\d+)?)(亿元|万元|元)$/);
  return match ? validAmount(Number(match[1]) * (match[2] === '亿元' ? 10_000_000_000 : match[2] === '万元' ? 1_000_000 : 100)) : null;
}
function validAmount(value) { const fen = Math.round(value); return Number.isFinite(value) && Number.isSafeInteger(fen) && fen > 0 ? fen : null; }
function sharedReceipt(text, fields) {
  return recognizePaymentReceiptText(text, { ...fields, paymentDate: fields.paymentDate || fields.payment_date || fields.date,
    payerName: fields.payerName || fields.payer_name, payeeName: fields.payeeName || fields.payee_name,
    bankReference: fields.bankReference || fields.bank_reference });
}
function allocationText(value) {
  return String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n').slice(0, 64000)
    .replace(/(?<![A-Z0-9])(\d{6}|\d{9})\s*\.\s*(S\s*[HZ]|I\s*B)(?![A-Z0-9])/gi,
      (_match, code, market) => code + '.' + market.replace(/\s/g, '').toUpperCase());
}
