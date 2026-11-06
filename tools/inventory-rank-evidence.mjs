import {isEvidenceOrganization} from './inventory-evidence.mjs';

// Return issuer identities only. Amounts remain in D1, including for ties.
export async function readTopIssuer(db, snapshot, term, inherited = {}) {
  const parts = String(term).split('|').map(value => value.trim()).filter(Boolean);
  const valid = Object.fromEntries(Object.entries(inherited).filter(([,v]) => v));
  if (Object.keys(valid).some(key => !['branch','scope','holdingStatus'].includes(key))) return {matches:[]};
  // The planner validates inherited scope and requests the full effective
  // scope in term. Do not silently reapply a filter the user cleared.
  const filters = {};
  for (const part of parts) {
    if (part === '不限') continue;
    if (/^[\p{L}]{1,30}分行$/u.test(part)) filters.branch = part;
    else if (['表内','委外','委外(公募)','委外(专户)'].includes(part)) filters.scope = part;
    else if (part === '存续') filters.holdingStatus = part;
    else return {matches:[]};
  }
  const clauses = ['version=?'], args = [snapshot.id];
  if (filters.branch) { clauses.push('branch=?'); args.push(filters.branch); }
  if (filters.scope === '委外') clauses.push("scope LIKE '委外%'");
  else if (filters.scope) { clauses.push('scope=?'); args.push(filters.scope); }
  if (filters.holdingStatus) { clauses.push('cents>0 AND maturity>?'); args.push(snapshot.date); }
  const sql = 'WITH totals AS (SELECT issuer,sum(cents) AS total FROM inventory_rows WHERE ' +
    clauses.join(' AND ') + ' GROUP BY issuer) SELECT issuer FROM totals WHERE total=(SELECT max(total) FROM totals) ORDER BY issuer LIMIT 9';
  const {results} = await db.prepare(sql).bind(...args).all();
  if (results.some(row=>!isEvidenceOrganization(row.issuer)) || results.length>8) return {matches:[]};
  return {matches:results.map(row=>({name:row.issuer,role:'issuer',basis:'ranking',code:'',bondName:''}))};
}

