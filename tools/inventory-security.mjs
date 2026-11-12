// Resolve security identity in the pinned ledger, independently of issuer and credit roles.
// Match a complete stored code first, then an exact short name or an unqualified code stem.
const qualified=/^[A-Z0-9-]+\.[A-Z]{2,5}$/i;
export function fullMarketCode(value){return typeof value==='string' && qualified.test(value.trim());}
export async function lookupInventorySecurity(db,snapshot,term,market){
  if(typeof term!=='string'||!term.trim()||term.length>160||/[\u0000-\u001f]/u.test(term))return [];
  const key=term.trim().toUpperCase();
  const {results}=await db.prepare(`SELECT code,min(name) AS name,
      min(CASE WHEN upper(code)=? THEN 0 WHEN upper(name)=? THEN 1 ELSE 2 END) AS priority
    FROM inventory_rows WHERE version=? AND (upper(code)=? OR upper(name)=? OR
      (instr(code,'.')>0 AND upper(substr(code,1,instr(code,'.')-1))=?))
    `+(market?" AND upper(code) LIKE ?":"")+` GROUP BY code ORDER BY priority,code LIMIT 10`).bind(key,key,snapshot.id,key,key,key,...(market?['%.'+market]:[])).all();
  return results.filter(r=>r.priority===results[0]?.priority).map(({code,name})=>({code,name}));
}
export function ambiguousSecurities(term,hits){
  return '“'+term+'”对应多个在账券码，请明确要查哪只：'+hits.map(s=>s.name+'（'+s.code+'）').join('、')+'。';
}
