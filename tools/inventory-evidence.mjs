import { issuanceStem } from './inventory-issuer-hints.mjs';
import {lookupInventorySecurity} from './inventory-security.mjs';
import { ledgerGuarantors, readVerifiedRoleWorkbook } from './inventory-store.mjs';

const fields = {
  issuer: ['issuer'],
  attribution: ['attribution'],
  enhancement: ['enhancement'],
  guarantor: ['guarantor'],
  overviewSubject: ['issuer', 'enhancement'],
  code: ['issuer', 'attribution', 'guarantor'],
};
const strength = {code: 5, exact: 4, bondStem: 3, nameFragment: 2, bondFragment: 1};
const securities = /^[A-Z0-9-]{1,30}(?:\.[A-Z]{2,5})?$/i;
const boundedLabel = /^[\p{L}\p{N} ()（）·&./\-]{1,100}$/u;
const publicOrganization = /(?:公司|银行|集团|政府|财政部|国库|人民银行|委员会|管理局|省|自治区|特别行政区|合作社|合作联社|基金会|合伙企业|有限合伙[）)]?|Bank|Limited|Ltd\.?|Corporation|Inc\.?|PLC|LLC)$/iu;
const isABS = value => ['ABS', '资产证券化', '资产支持证券'].includes(value.trim().toUpperCase());
const fallbackByDb = new WeakMap();

export function isEvidenceOrganization(name) {
  return typeof name === 'string' && boundedLabel.test(name) && publicOrganization.test(name);
}

// Restrict negative full-name conclusions to explicit legal forms; a group
// or bank nickname can still identify an issuer through a bond abbreviation.
export function isFullLedgerName(name) {
  return isEvidenceOrganization(name) && /(?:有限公司|有限责任公司|股份公司|合伙企业[（(]有限合伙[）)]|\b(?:Limited|Ltd\.?|Corporation|Inc\.?|PLC|LLC))$/iu.test(name);
}

// On a historical snapshot without a role index, read its immutable original.
// Keep only identifiers in the transient cache. The evidence tool does no writes.
function originalLabels(db, bucket, snapshot) {
  const current = fallbackByDb.get(db);
  if (current?.id === snapshot.id) return current.rows;
  const rows = readVerifiedRoleWorkbook(db, snapshot, bucket).then(workbook => workbook.rows.map(row => ({
    code: row.code, bondName: row.name, attribution: row.attribution,
    guarantors: ledgerGuarantors(row.guarantor).guarantors, abs: isABS(row.marketType),
  })));
  const entry = {id: snapshot.id, rows};
  fallbackByDb.set(db, entry);
  rows.catch(() => { if (fallbackByDb.get(db) === entry) fallbackByDb.delete(db); });
  return rows;
}

async function hasPublishedRoleIndex(db, snapshot) {
  const exists = await db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='inventory_role_sources'").first();
  return exists && await db.prepare('SELECT 1 AS found FROM inventory_role_sources WHERE version=?').bind(snapshot.id).first();
}

const rows = 'inventory_rows r';
const roles = rows + ' JOIN inventory_role_rows s USING(version,sourceRow)';
const source = {
  issuer: {from: rows, label: 'r.issuer'},
  attribution: {from: roles, label: 's.attribution'},
  enhancement: {from: roles, label: 's.attribution', restrict: " AND upper(trim(r.marketType)) IN ('ABS','资产证券化','资产支持证券')"},
  guarantor: {from: roles + ' JOIN json_each(s.guarantors) g', label: 'g.value'},
};

function appendMatch(best, requestedRole, name, code, bondName, key) {
  if (!isEvidenceOrganization(name) ||
      !securities.test(code) || !boundedLabel.test(bondName)) return;
  const role = requestedRole === 'enhancement' ? 'attribution' : requestedRole;
  const full = name.toUpperCase(), short = bondName.toUpperCase();
  let basis;
  if (code.toUpperCase() === key) basis = 'code';
  else if (full === key) basis = 'exact';
  // A name embedded in the security can identify its issuer, but does not
  // establish who guarantees the debt or whose credit is used.
  else if (requestedRole === 'issuer' && issuanceStem(short) === key) basis = 'bondStem';
  else if (full.includes(key)) basis = 'nameFragment';
  else if (short.includes(key)) basis = 'bondFragment';
  if (!basis) return;
  const entityKey = role + '\0' + name;
  const old = best.get(entityKey);
  if (!old || strength[basis] > strength[old.basis] || (basis === old.basis && code < old.code)) {
    best.set(entityKey, {name, role, code, bondName, basis});
  }
}

export async function readInventoryEvidence({db, bucket}, snapshot, {term, field}) {
  const key = typeof term === 'string' ? term.trim().toUpperCase() : '';
  if (!Object.hasOwn(fields, field) || !snapshot?.id || !key || key.length > 100 ||
      /[\x00-\x1f]/.test(key) || /^(集团|公司|股份|有限公司|债券|全部|所有|担保人|发行人)$/.test(key))
    return {matches: []};
  const requested = fields[field];
  const indexed = requested.includes('issuer') && requested.length === 1 || await hasPublishedRoleIndex(db, snapshot);
  const best = new Map();
  for (const role of requested) {
    if (role === 'issuer' || indexed) {
      const {from, label, restrict = ''} = source[role];
      const sql = `SELECT DISTINCT ${label} AS entity,r.code,r.name AS bondName FROM ${from}
        WHERE r.version=? ${restrict} AND (upper(r.code)=? OR instr(upper(${label}),?)>0 OR instr(upper(r.name),?)>0)`;
      const {results} = await db.prepare(sql).bind(snapshot.id, key, key, key).all();
      for (const row of results) appendMatch(best, role, row.entity, row.code, row.bondName, key);
    } else {
      const labels = await originalLabels(db, bucket, snapshot);
      for (const row of labels) {
        if (role === 'enhancement' && !row.abs) continue;
        const names = role === 'guarantor' ? row.guarantors : [row.attribution];
        for (const name of names) appendMatch(best, role, name, row.code, row.bondName, key);
      }
    }
  }
  const matches = [...best.values()].sort((a,b) => strength[b.basis] - strength[a.basis] ||
    a.name.localeCompare(b.name, 'zh-CN') || a.role.localeCompare(b.role));
  return {matches:matches.slice(0,8),...(field==='code'?{securities:await lookupInventorySecurity(db,snapshot,key)}:{})};
}
