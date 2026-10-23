import { requireUser, json } from '../_auth.js';
import { makeDmClient, validateDmConfig, rowsFromDm } from '../dm/lookup.js';
import { checkWriteRequest, readBody } from './_shared.js';
import { withDataSources } from '../qb/fallback.js';
import { rowProvenance, fieldProvider } from '../qb/provenance.js';

const BASIC_INFO_PATH = '/dm-quant-func-service/api/v1/bond/basic-info/info';
const COUPON_FIELDS = ['securityId', 'secShortName', 'newCoupRate', 'rateTypeParDesc', 'bondTypeDesc', 'specialItem', 'paymentOrder'];

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.response) return auth.response;
  const rejected = checkWriteRequest(context.request);
  if (rejected) return rejected;

  let codes;
  try {
    const body = await readBody(context.request, 10000);
    if (!Array.isArray(body?.codes) || !body.codes.length || body.codes.length > 20) throw new Error('codes');
    codes = body.codes.map(normalizeCouponCode);
    if (codes.some(code => !code)) throw new Error('codes');
    codes = [...new Set(codes)];
  } catch {
    return json({ error: '每次最多查询 20 个含市场后缀的有效债券代码。' }, 400);
  }
  const configError = validateDmConfig(context.env, context.request);
  if (configError) return configError;

  try {
    const client = makeDmClient(context.env, context.request);
    const raw = await client.post(BASIC_INFO_PATH, {
      securityIdList: codes,
      fieldNames: COUPON_FIELDS,
    }, { signal: AbortSignal.timeout(12000) });
    return json(withDataSources({
      source: 'DM',
      sourcePath: BASIC_INFO_PATH,
      fetchedAt: new Date().toISOString(),
      results: matchCouponRows(codes, rowsFromDm(raw)),
    }, client));
  } catch {
    return json({ error: '债券资料查询暂时失败或超时，请稍后重试。' }, 502);
  }
}

export function normalizeCouponCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return /^\d{6,12}\.(?:IB|SH|SZ|BJ)$/.test(code) ? code : '';
}

function latestCoupon(row) {
  // DM V2.5 basic-info: new_coup_rate is the latest coupon in %, not issue yield.
  const values = [row.newCoupRate, row.new_coup_rate].filter(value => value !== null && value !== undefined);
  const parsed = values.map(value => {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string' || !/^\s*\d+(?:\.\d+)?\s*%?\s*$/.test(value)) return null;
    const number = Number(value.replace('%', '').trim());
    return Number.isFinite(number) ? number : null;
  });
  if (!parsed.length || parsed.some(value => value === null) || new Set(parsed).size !== 1) return null;
  return parsed[0];
}

function rowCode(row) {
  const values = [row.securityId, row.security_id].filter(value => value !== null && value !== undefined);
  const codes = values.map(normalizeCouponCode);
  return codes.length && codes.every(Boolean) && new Set(codes).size === 1 ? codes[0] : '';
}

function textField(row, camel, snake) {
  const values = [row[camel], row[snake]].filter(value => value !== null && value !== undefined);
  if (values.some(value => typeof value !== 'string')) return { value: '', ambiguous: true };
  const texts = values.map(value => value.trim());
  return { value: texts[0] || '', ambiguous: new Set(texts).size > 1 };
}

function classifyType(description) {
  const text = description.normalize('NFKC').trim();
  if (!text || /^(?:未知|不详|暂无|未分类|N\/?A|NULL|NONE|[-—]+)$/i.test(text)) return '未知';
  const types = new Set();
  if (/超短期融资券|\bSCP\b/i.test(text)) types.add('SCP');
  if (/(?<!超)短期融资券|\bCP\b/i.test(text)) types.add('CP');
  if (/中期票据|\bMTN\b/i.test(text)) types.add('MTN');
  if (/定向(?:债务融资)?工具|\bPPN\b/i.test(text)) types.add('PPN');
  if (/资产支持(?:商业)?(?:证券|票据)|\b(?:ABS|ABN|ABCP|MBS|RMBS)\b/i.test(text)) types.add('ABS');
  const financial = /金融债|(?:商业|政策性|开发性)银行.*债|(?:证券公司|保险公司|其他金融机构).*债|(?:二级资本|总损失吸收能力|TLAC).*债/i.test(text);
  if (financial) types.add('金融债');
  if (/(?<!证券)(?<!保险)公司债/.test(text)) types.add('公司债');
  if (/企业债/.test(text)) types.add('企业债');
  if (/^(?:(?:记账式|储蓄|凭证式|特别|附息|贴现).*)?国债|地方政府(?:一般|专项)?债|地方债|^政府债/.test(text)) types.add('政府债');
  return types.size > 1 ? '未知' : [...types][0] || '其他';
}

function affirmativeMention(text, pattern) {
  for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    const after = text.slice(match.index + match[0].length);
    if (/(?:非|不属于|并非|不是|不适用|不涉及|不含|未设置|不设置|无)\s*$/.test(before)) continue;
    if (/^\s*(?:不适用|为否|[:：]?否)/.test(after)) continue;
    return true;
  }
  return false;
}

function typeDetails(row) {
  // These are documented basic-info fields. Security names and issuance prose are not classification evidence.
  const fields = [
    textField(row, 'bondTypeDesc', 'bond_type_desc'),
    textField(row, 'specialItem', 'special_item'),
    textField(row, 'paymentOrder', 'payment_order'),
  ];
  const typeDescription = fields[0].value;
  const evidence = fields.map(field => field.value);
  const attributes = [];
  if (evidence.some(text => affirmativeMention(text, '永续|无固定期限|可续期|发行人续期选择权'))) attributes.push('永续');
  if (evidence.some(text => affirmativeMention(text, '二级资本'))) attributes.push('二级资本');
  if (evidence.some(text => affirmativeMention(text, '\\bTLAC\\b|总损失吸收能力'))) attributes.push('TLAC');
  return {
    bondType: classifyType(typeDescription), attributes, typeDescription,
    ambiguous: fields.some(field => field.ambiguous), evidence,
  };
}

export function matchCouponRows(codes, rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('invalid_dm_response');
  }
  const results = Object.create(null);
  for (const code of codes) {
    const matches = rows.filter(row => rowCode(row) === code);
    const empty = { status: 'missing', couponRate: null, name: '', rateType: '', bondType: '未知', attributes: [], typeDescription: '' };
    if (!matches.length) {
      results[code] = { ...empty, reason: 'not_found' };
      continue;
    }
    const details = matches.map(typeDetails);
    const values = matches.map((row, index) => ({
      couponRate: latestCoupon(row),
      name: String(row.secShortName ?? row.sec_short_name ?? '').trim(),
      rateType: String(row.rateTypeParDesc ?? row.rate_type_par_desc ?? '').trim(),
      bondType: details[index].bondType,
      attributes: details[index].attributes,
      typeDescription: details[index].typeDescription,
    }));
    const distinct = new Set(values.map(value => JSON.stringify(value)));
    const distinctEvidence = new Set(details.map(detail => JSON.stringify(detail.evidence)));
    if (distinct.size !== 1 || distinctEvidence.size !== 1 || details.some(detail => detail.ambiguous)) {
      results[code] = { ...empty, reason: 'ambiguous' };
      continue;
    }
    const value = values[0];
    const provenance = rowProvenance(matches[0]);
    if (provenance.provider) {
      Object.assign(value, provenance, { fieldSources: {
        couponRate: fieldProvider(matches[0], ['newCoupRate', 'new_coup_rate']),
        bondType: fieldProvider(matches[0], ['bondTypeDesc', 'bond_type_desc']),
      } });
    }
    results[code] = value.couponRate === null
      ? { ...empty, ...value, reason: 'coupon_unavailable' }
      : { status: 'matched', ...value };
  }
  return results;
}
