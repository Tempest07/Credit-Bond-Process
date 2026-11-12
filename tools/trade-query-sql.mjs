// The file-backed reader supports arbitrary source columns and security-code
// disambiguation. Only route questions whose full semantics exist in the index.
const groupFields={
  '发行人全称':'r.issuer','联动分行':'r.branch','会计科目':'r.account','会计分类':'r.account',
  '交易日期':'r.day','交易年份':'substr(r.day,1,4)','交易月份':'substr(r.day,1,7)',
  '交易季度':"substr(r.day,1,4)||'Q'||((cast(substr(r.day,6,2) as integer)+2)/3)",
  '增减方向':"CASE WHEN books.side='buy' THEN '增持' ELSE '减持' END",
};
const filterFields={'发行人全称':'r.issuerKey','联动分行':'r.branchKey','会计科目':'r.accountKey','会计分类':'r.accountKey'};

export function canUseTradeIndex(plan){
  return plan.metric!=='dateRange' && !plan.auditCodeRows && !plan.dateExtreme &&
    plan.groupBy.length<=1 && plan.groupBy.every(field=>Object.hasOwn(groupFields,field)) &&
    plan.filters.every(filter=>filter.field==='台账类别' ||
      Object.hasOwn(filterFields,filter.field) && ['eq','in'].includes(filter.op));
}

export async function readTradeAggregates(db,scope,canonical){
  const {plan,relevant}=scope;
  const args=[JSON.stringify(relevant.map(v=>[v.id,v.direction]))];
  const conditions=['r.version=books.version'];
  if(plan.start){conditions.push('r.day>=?');args.push(plan.start);}
  if(plan.end){conditions.push('r.day<=?');args.push(plan.end);}
  for(const filter of plan.filters){
    if(filter.field==='台账类别')continue; // setup() has restricted the manifests.
    const field=filterFields[filter.field];
    if(filter.op==='eq'){conditions.push(field+'=?');args.push(canonical(filter,filter.value));}
    else {conditions.push(field+' IN (SELECT value FROM json_each(?))');args.push(JSON.stringify(filter.value.map(v=>canonical(filter,v))));}
  }
  const dimension=groupFields[plan.groupBy[0]];
  const source=' FROM books CROSS JOIN trade_query_rows r WHERE '+conditions.join(' AND ');
  const select="SELECT books.side,r.cents,r.code"+(dimension?','+dimension+' AS label,books.ord,r.sourceRow':'')+source;
  const sums="coalesce(sum(CASE WHEN side='buy' THEN cents ELSE 0 END),0) AS buyCents,"+
    "coalesce(sum(CASE WHEN side='sell' THEN cents ELSE 0 END),0) AS sellCents,"+
    "count(*) AS rows,count(DISTINCT code) AS bonds,count(CASE WHEN side='buy' THEN 1 END) AS buyRows";
  // Count distinct bonds across the complete selection as well as within each
  // group. A security can trade in several groups or on both sides.
  // Preserve first-seen order for labels that tie under the final Chinese
  // collation (e.g. composed and decomposed accents). The ordinal stays in
  // SQLite int64: at most 200 annual books and safe-integer source row numbers.
  const sql="WITH books AS MATERIALIZED (SELECT key AS ord,value->>0 AS version,value->>1 AS side FROM json_each(?)),"+
    ' selected AS ('+select+') SELECT NULL AS name,'+sums+' FROM selected'+
    (dimension?" UNION ALL SELECT * FROM (SELECT coalesce(nullif(label,''),'（未填）') AS name,"+sums+
      ' FROM selected GROUP BY 1 ORDER BY min(ord*9007199254740992+sourceRow) LIMIT 100001)':'');
  const {results}=await db.prepare(sql).bind(...args).all();
  const [total,...groups]=results;
  return {total,groups};
}
