import {accountLabel,accountSql} from './inventory-account.mjs';
const exactFields = new Set(['branch', 'scope', 'portfolio', 'code']);
const genericWords = new Set(['公司', '集团', '有限', '有限公司', '股份', '债券', '发行人']);
const codePattern = /^[a-z0-9]+\.(?:IB|SH|SZ|HK)$/i;

function scopeFor(snapshot, filters, subject) {
  const predicates = ["version=?", "issuer<>''"];
  const bindings = [snapshot.id];
  for (const [field, value] of Object.entries(filters || {})) {
    if (!value || (field === 'issuer' && value === subject)) continue;
    if (field === 'holdingStatus' && value === '存续') {
      predicates.push('cents>0 AND maturity>?');
      bindings.push(snapshot.date);
    } else if (field === 'scope' && value === '委外') {
      predicates.push("scope LIKE '委外%'");
    } else if (field === 'account') {
      predicates.push(accountSql + '=?');
      bindings.push(value === '未填写' ? '' : accountLabel(value));
    } else if (exactFields.has(field)) {
      predicates.push(field + '=?');
      bindings.push(value === '未填写' ? '' : value);
    } else {
      return null;
    }
  }
  return {where:predicates.join(' AND '), bindings};
}

// Only a recognized issuance suffix can turn a name fragment into strong evidence.
// 26电网SCP019 -> 电网; 26内蒙电网SCP004 -> 内蒙电网.
export function issuanceStem(name) {
  const match = /^(?:20)?\d{2}(.+?)(?:(?:SCP|MTN|CP|PPN|GN|ABN|S|K)\s*\d+|\d{2,3})(?:\([^)]*\))?$/i.exec(name.normalize('NFKC').trim());
  return match?.[1].trim() || '';
}

function matchEvidence(row, query, isCode) {
  if (isCode) return {rank:4,source:'券码 ' + row.code + ' 对应的发行人'};
  if (row.issuer === query) return {rank:4,source:'发行人全称完全匹配'};
  if (issuanceStem(row.name) === query) return {rank:3,source:'券简称“' + row.name + '”中的主体简称匹配'};
  if (row.issuer.includes(query)) return {rank:2,source:'发行人全称含“' + query + '”'};
  if (row.name.includes(query)) return {rank:1,source:'库存券简称“' + row.name + '”含该词'};
  return {rank:0,source:'库存发行人名称候选'};
}

export async function issuerHints(db, snapshot, query, filters = {}, candidates = []) {
  const key = typeof query === 'string' ? query.trim() : '';
  if (key.length < 2 || key.length > 180 || genericWords.has(key)) return [];
  const scope = scopeFor(snapshot, filters, key);
  if (!scope) return [];
  const isCode = codePattern.test(key);
  const names = candidates.filter(name => typeof name === 'string' && name).slice(0,12);
  const clues = isCode ? ['upper(code)=?'] : ['instr(issuer,?)>0','instr(name,?)>0'];
  const bindings = isCode ? [key.toUpperCase()] : [key,key];
  if (!isCode && names.length) {
    clues.push('issuer IN (' + names.map(() => '?').join(',') + ')');
    bindings.push(...names);
  }
  const hits = await db.prepare('SELECT DISTINCT issuer,name,code FROM inventory_rows WHERE ' +
    scope.where + ' AND (' + clues.join(' OR ') + ') ORDER BY issuer,code,name')
    .bind(...scope.bindings,...bindings).all();
  const best = new Map();
  for (const row of hits.results) {
    const evidence = matchEvidence(row, key, isCode);
    if (!best.has(row.issuer) || best.get(row.issuer).rank < evidence.rank) best.set(row.issuer,evidence);
  }
  const ranked = [...best].sort(([a,x],[b,y])=>y.rank-x.rank || a.localeCompare(b,'zh-CN'));
  if (!ranked.length) return [];
  const primaryName = ranked[0][1].rank >= 3 && ranked[0][1].rank > (ranked[1]?.[1].rank ?? -1)
    ? ranked[0][0] : '';
  const limit = ranked.slice(0,5);
  // Aggregate all scoped holdings for the candidate issuers, not just the rows
  // whose names matched the clue. Partition lots by issuer and security code.
  const grouped = await db.prepare('SELECT issuer,code,min(name) AS name,sum(cents) AS cents ' +
    'FROM inventory_rows WHERE ' + scope.where +' AND issuer IN (' + limit.map(()=>'?').join(',') +
    ') GROUP BY issuer,code ORDER BY cents DESC,code').bind(...scope.bindings,...limit.map(([name])=>name)).all();
  return limit.map(([name,evidence])=>{
    const securities = grouped.results.filter(row=>row.issuer===name);
    return {name,securityCount:securities.length,totalCents:securities.reduce((sum,r)=>sum+r.cents,0),
      securities:securities.slice(0,3).map(row=>({name:row.name,code:row.code})),
      source:evidence.source,primary:name===primaryName};
  });
}

// Used as evidence for a trade question when the issuer did not trade in the
// requested period. Match the user's literal clue across every in-scope issuer.
export async function tradeIssuerCandidates(db,snapshot,alias) {
  if(!snapshot?.id || typeof alias!=='string' || alias.length<2 || alias.length>80 || genericWords.has(alias))return [];
  const {results}=await db.prepare("SELECT DISTINCT issuer,name FROM inventory_rows WHERE version=? AND issuer<>''").bind(snapshot.id).all();
  const collation=s=>s.normalize('NFKC').trim().toLowerCase();
  const word=collation(alias),ranks=new Map();
  for(const row of results){
    const issuer=collation(row.issuer),core=issuer.replace(/(?:股份有限公司|有限责任公司|有限公司)$/,''),stem=collation(issuanceStem(row.name||''));
    let rank=0;
    if(issuer===word)rank=4;
    else if(stem===word)rank=3;
    else if(issuer.includes(word))rank=2;
    else if(word.length>=3 && core.startsWith(word[0]) && core.endsWith(word.at(-1))){
      let index=0;
      for(const char of core)if(char===word[index])index++;
      if(index===word.length)rank=1;
    }
    if(rank)ranks.set(row.issuer,Math.max(rank,ranks.get(row.issuer)||0));
  }
  const highest=Math.max(0,...ranks.values());
  return [...ranks].filter(([,rank])=>rank===highest).map(([name])=>name).sort();
}
