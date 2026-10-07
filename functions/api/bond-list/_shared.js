import { isLocalRequest, json } from '../_auth.js';

export const DEFAULT_BRANCHES = ['北京/上海', '陕西（西安）', '山东（青岛）', '湖北（武汉）', '广东（广州）', '甘肃（兰州）', '江苏（苏州）', '山西（太原）', '福建（泉州）', '福建（南平）', '河北（石家庄）', '内蒙古（呼和浩特）', '河南（郑州）', '云南（昆明）', '浙江（宁波）', '宁夏（银川）', '浙江（杭州）', '江苏（南京）', '广西（南宁）', '安徽（合肥）', '辽宁（大连）', '福建（龙岩）', '其他/TLAC'];

export function checkWriteRequest(request) {
  const allowed = new Set(['https://tempest07.com', 'https://www.tempest07.com']);
  if (isLocalRequest(request)) allowed.add(new URL(request.url).origin);
  if (!allowed.has(request.headers.get('Origin')) || request.headers.get('X-Bond-List') !== '1') {
    return json({error: '请求来源不受支持'}, 403);
  }
  return null;
}

export async function readBody(request, limit = 400000) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = []; let size = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data));
}

export function validateSections(sections) {
  if (!Array.isArray(sections) || !sections.length || sections.length > 100) throw new Error('sections');
  const titles = new Set();
  return sections.map(section => {
    if (!section || typeof section.title !== 'string' || typeof section.text !== 'string' || !section.title.trim() || /[\r\n]/.test(section.title) || section.title.length > 80 || section.text.length > 100000 || titles.has(section.title)) throw new Error('section');
    titles.add(section.title);
    return {title: section.title, text: section.text};
  });
}

export async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS bond_list_drafts (
    user_id TEXT PRIMARY KEY, sections TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`).run();
}

export function normalizeName(value) { return value.normalize('NFKC').replace(/\s+/g, '').toUpperCase(); }
export function nameCandidates(value) {
  return [...new Set([value, value.normalize('NFKC'), value.replace(/[（(](?:科创债|科创|绿色|并购)(?:[/、](?:科创债|科创|绿色|并购))*[）)]$/, '')])];
}
function rowName(row) { return row.secShortName ?? row.sec_short_name; }
function rowCode(row) {
  const value = String(row.securityId ?? row.security_id ?? '').trim().toUpperCase();
  if (/^\d{6,12}\.(IB|SH|SZ|BJ)$/.test(value)) return value;
  const prefixed = value.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (prefixed) return `${prefixed[2]}.${prefixed[1]}`;
  const market = row.secondaryMarket ?? row.secondary_market ?? '';
  if (/^\d{9}$/.test(value) && /银行间/.test(market)) return `${value}.IB`;
  return '';
}
export function matchRows(names, rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof rowName(row) !== 'string')) throw new Error('invalid_dm_response');
  const results = Object.create(null);
  for (const name of names) {
    const exact = rows.filter(row => normalizeName(rowName(row)) === normalizeName(name));
    const candidates = new Set(nameCandidates(name).map(normalizeName));
    const matched = exact.length ? exact : rows.filter(row => candidates.has(normalizeName(rowName(row))));
    const bonds = new Map(); let invalid = false;
    for (const row of matched) {
      const code = rowCode(row);
      if (!code) { invalid = true; continue; }
      bonds.set(code, {code, name: rowName(row), market: String(row.secondaryMarket ?? row.secondary_market ?? '')});
    }
    const matches = [...bonds.values()];
    results[name] = {status: invalid ? 'error' : matches.length === 1 ? 'matched' : matches.length ? 'ambiguous' : 'missing', matches};
  }
  return results;
}
