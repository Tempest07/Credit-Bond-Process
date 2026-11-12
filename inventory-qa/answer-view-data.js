// Adapters for the saved inventory, flow and joint answer contracts. All values
// come from the answer being displayed, including its original data vintage.
const labels = {
  issuer: '发行人', branch: '联动分行', account: '会计科目', portfolio: '交易组合',
  scope: '持仓范围', marketType: '债券类型', sourceMarketType: '原表债券类型',
  code: '债券代码', name: '债券简称', institution: '机构名称', maturity: '到期日期',
  legal: '法定到期日', expected: 'ABS 预计到期日', guarantor: '台账列明担保人',
  attribution: '资产端损益还原客户名称', holdingStatus: '台账状态',
};
const label = key => Object.hasOwn(labels, key) ? labels[key] : String(key).replace(/^原表:/, '');
const list = a => Array.isArray(a) ? a : [];
const finite = n => Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER;
const yi = n => Number.isSafeInteger(n) ? n / 1e10 : null;
const shown = n => n == null ? '待核' : n.toLocaleString('zh-CN', n !== 0 && Math.abs(n) < 0.01
  ? {maximumSignificantDigits: 3} : {maximumFractionDigits: 4});
const field = (key, label, kind = 'category') => ({key, label, kind});
const measure = (key, label, unit, options = {}) => ({key, label, unit, ...options});
const principal = measure('principal', '在账本金', '亿元', {additive: true});
const ledgerMetrics = {
  principal, count: measure('count', '持仓行数', '条', {additive: true}),
  securities: measure('securities', '不同券数', '只'),
};
const flowMetrics = {
  buy: measure('buy', '买入本金', '亿元', {additive: true}),
  sell: measure('sell', '卖出本金', '亿元', {additive: true}),
  gross: measure('gross', '买卖合计本金', '亿元', {additive: true}),
  net: measure('net', '净买入本金', '亿元', {signed: true}),
  rows: measure('rows', '交易笔数', '笔', {additive: true}),
  bonds: measure('bonds', '不同券数', '只'),
  average: measure('average', '每笔平均本金', '亿元/笔'),
};
function sample(shortTitle, answer, source, dimensions, measures, rows, extra = {}) {
  const hasValues = rows.some(row => measures.some(m => finite(row[m.key])));
  return {shortTitle, answer, source, result: {
    dimensions, measures, rows, coverage: 'complete', ...extra, ...(!hasValues ? {coverage:'missing'} : {}),
  }};
}
function scalar(title, text, source, m, value, extra = {}) {
  return sample(title, text, source, [], [m], value == null ? [] : [{[m.key]:value}], extra);
}
function notes(items) {
  return list(items).map(item => typeof item === 'string' ? item : item?.message).filter(Boolean).join(' ');
}
function range(a, b) {
  return [a, b !== a && b].filter(Boolean).join(' 至 ');
}
function entryText(m, value) {
  return m.label + ' ' + shown(value) + (value == null ? '' : ' ' + m.unit);
}
function summaryRows(rows, dims, m, limit = 3) {
  return rows.slice(0, limit).map(row =>
    dims.map(d => row[d.key]).join(' / ') + ' ' + shown(row[m.key]) + (row[m.key] == null ? '' : ' ' + m.unit)
  ).join('、');
}
function inventoryMetric(d) {
  if (!d.measure) return Object.hasOwn(ledgerMetrics, d.plan?.metric) ? ledgerMetrics[d.plan.metric] : null;
  if (d.measure.fn === 'principalShare') return measure('derived', '本金占比', '%');
  if (d.measure.fn === 'distinct') return measure('derived', label(d.measure.field) + '不同取值数', '个');
  // For open-ended original columns the ledger does not provide a reliable unit.
  return null;
}
function inventoryValue(d, m, group) {
  switch (m.key) {
    case 'principal': return yi(group ? group.cents : d.totalCents);
    case 'derived': {
      const value = group ? group.measureValue : d.measureTotal;
      return finite(value) ? value : null;
    }
    default: {
      const value = m.key === 'securities' ? (group || d).securityCount : group ? group.count : d.rowCount;
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
  }
}
function ledgerScope(d) {
  return Object.entries(d.plan?.filters || {}).map(([k,v]) => label(k) + ' ' + v).join('、');
}
function ledgerSource(d) {
  return [d.snapshot?.date || d.plan?.date, '余额台账', ledgerScope(d)].filter(Boolean).join('　');
}
function uncertainRole(d) {
  return ['unknown','candidate'].includes(d?.roleEvidence?.kind);
}
function inventory(d) {
  if (!d?.plan || !Array.isArray(d.groups) || uncertainRole(d)) return null;
  const m = inventoryMetric(d);
  if (!m) return null;
  const group = d.plan.group, rank = d.plan.rank;
  const fields = d.dimensions ?? (rank ? [rank.by, group] : group && group !== 'none' ? [group] : []);
  if (!Array.isArray(fields)) return null;
  const dims = fields.map((key, i) => field('d' + i, label(key)));
  const total = inventoryValue(d,m);
  const risk = d.roleEvidence;
  const restricted = risk && (risk.missingGuarantorRows > 0 || risk.missingAttributionRows > 0);
  const tail = (d.groupCount ?? d.groups.length) > d.groups.length || Boolean(d.groupsTruncated);
  const warning = notes(d.warnings);
  const note = [tail && ('本图列出已返回的 ' + d.groups.length + ' 组' +
    (Number.isSafeInteger(d.groupCount) ? '，共有 ' + d.groupCount + ' 组' : '') + '。'), warning].filter(Boolean).join(' ');
  const extra = {coverage: restricted ? 'partial' : 'complete', note};
  const text = [d.summary || entryText(m,total), d.rowCount>0 && Number.isSafeInteger(d.securityCount) && m.key==='principal'
    ? d.securityCount + ' 只券' : '', restricted ? '主体归属仅覆盖可核实持仓。' : ''].filter(Boolean).join('，');
  if (fields.length && !d.groups.length && d.rowCount===0 && !restricted) {
    return sample('按'+dims.map(v=>v.label).join('和')+'查询',
      '当前条件没有匹配持仓（0 条）。',ledgerSource(d),dims,[m],[],{note});
  }
  if (!fields.length || !d.groups.length) return scalar(m.label, text, ledgerSource(d), m, total, extra);
  const measures=[m];
  // A bucket's threshold or sort may use another verified aggregate. Expose the
  // number that decided membership beside the requested measure.
  const aggregateKeys={securityCount:'securities',rowCount:'count',principalCents:'principal'};
  for(const step of list(d.plan.analysis)){
    const key=aggregateKeys[step.metric];
    if(['having','sort'].includes(step.op) && key && !measures.some(x=>x.key===key))measures.push(ledgerMetrics[key]);
  }
  const rows = [];
  for (const g of d.groups) {
    const names = g.labels ?? (rank ? [g.rankName, g.bucketName] : [g.name]);
    if (!Array.isArray(names) || names.length !== dims.length) return null;
    const row = Object.fromEntries(measures.map(metric=>[metric.key,inventoryValue(d,metric,g)]));
    dims.forEach((dim,i) => {row[dim.key] = names[i] == null || names[i] === '' ? '未填写' : String(names[i]);});
    rows.push(row);
  }
  // Only partitioned ledger categories and an independently returned, reconciled
  // total are eligible for a whole. An analysis "take" may already have removed
  // rows from totalCents, so it cannot establish the original denominator.
  const narrowed = list(d.plan.analysis).some(s => ['take','having','expand'].includes(s.op));
  const shareOfPrincipal=d.measure?.fn==='principalShare';
  if (fields.length === 1 && ['account','scope','marketType','sourceMarketType'].includes(fields[0]) &&
      (m.key === 'principal' || shareOfPrincipal) && !rank && !tail && !narrowed && !restricted && yi(d.totalCents)>0 &&
      d.groups.every(g => Number.isSafeInteger(g.cents) && g.cents >= 0) &&
      d.groups.reduce((n,g) => n + BigInt(g.cents),0n) === BigInt(d.totalCents)) {
    if(shareOfPrincipal){
      const principalIndex=measures.findIndex(x=>x.key===principal.key);
      if(principalIndex>=0)measures.splice(principalIndex,1);
      measures.unshift(principal);
      rows.forEach((row,i)=>{row.principal=yi(d.groups[i].cents);});
    }
    extra.whole = {measureKey:'principal', value:yi(d.totalCents), label:'本次查询全部匹配持仓本金'};
  }
  // Preserve an actual backend order (the SQL and analysis paths can rank by different metrics).
  const sorts = list(d.plan.analysis).filter(s => s.op === 'sort');
  const sort = sorts.at(-1);
  const sortMetric = {principal:'principalCents', securities:'securityCount', count:'rowCount', derived:'measure'}[m.key];
  if (dims.length===1 && !rank && (!d.plan.analysis || (sort?.metric || d.analysisMetric)===sortMetric)) {
    const direction = sort?.descending === false ? 'asc' : 'desc';
    const order = direction==='asc' ? 1 : -1;
    if(rows.every((r,i) => finite(r[m.key]) && (!i || order*(r[m.key]-rows[i-1][m.key]) >= 0))) {
      extra.orderedBy = {key:m.key,direction};
    }
  }
  return sample('按' + dims.map(x=>x.label).join('和') + '汇总', text, ledgerSource(d), dims, measures, rows, extra);
}
function overview(d) {
  const parts = list(d.overview);
  if(parts.some(p => p?.role || p?.result?.roleEvidence?.basis==='enhancement'))return subjectOverview(d,parts);
  if (!parts.length || parts.some(p=>!p.title || !p.result || uncertainRole(p.result) || p.result.roleEvidence)) return null;
  const m = inventoryMetric(parts[0].result);
  if (!m || parts.some(p=>inventoryMetric(p.result)?.key!==m.key || p.result.measure || !p.result.snapshot?.date)) return null;
  const byDate = new Map(), scopes = new Map();
  for(const {title,result} of parts){
    const day = result.snapshot.date;
    const scope = title.replace(day,'').trim() || ledgerScope(result) || '全部匹配持仓';
    if (!scopes.has(scope)) scopes.set(scope,'s'+scopes.size);
    if (!byDate.has(day)) byDate.set(day,{date:day});
    const r=byDate.get(day), key=scopes.get(scope);
    if(Object.hasOwn(r,key)) return null;
    r[key]=inventoryValue(result,m);
  }
  const source = [...byDate.keys()].sort().join('、')+' 余额台账';
  // Keep the backend's narrative (it may also include verified intersections or a deduplicated union).
  const answer = d.clarification || parts.map(p => p.title+' '+entryText(m,inventoryValue(p.result,m))).join('。');
  const note = notes(parts.flatMap(p=>list(p.result.warnings)).filter((s,i,a)=>a.indexOf(s)===i));
  if (byDate.size===1) {
    const rows=parts.map(p=>({scope:p.title.replace(p.result.snapshot.date,'').trim()||p.title,[m.key]:inventoryValue(p.result,m)}));
    return sample('不同范围对照',answer,source,[field('scope','查询范围')],[m],rows,{note});
  }
  const measures=[...scopes].map(([title,k])=>measure(k,title+' '+m.label,m.unit));
  const rows=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  for(const row of rows)for(const met of measures)if(!Object.hasOwn(row,met.key))row[met.key]=null;
  const gaps=rows.some(row=>measures.some(metric=>row[metric.key]===null));
  return sample('余额台账跨期对照',answer,source,[field('date','台账日期','date')],measures,rows,
    {coverage:gaps?'partial':'complete',note:[gaps && '空白表示本期结果未列示该项。',note].filter(Boolean).join(' ')});
}
function subjectOverview(d,parts) {
  const issuer=parts.find(p=>p.role==='issuer') || parts.find(p=>p.result?.plan?.filters?.issuer);
  const enhanced=parts.find(p=>p.role==='enhancement') || parts.find(p=>p.result?.roleEvidence?.basis==='enhancement');
  if(!issuer || !enhanced)return null;
  const a=issuer.result, b=enhanced.result, evidence=b?.roleEvidence;
  if(a?.identity || b?.identity || uncertainRole(a) || uncertainRole(b))return null;
  const issuerName=a?.plan?.filters?.issuer, enhancerName=evidence?.entity;
  if((issuerName && enhancerName && issuerName!==enhancerName) ||
    (a?.snapshot?.date && b?.snapshot?.date && a.snapshot.date!==b.snapshot.date))return null;
  const issuerValue=a?.resultId && issuerName && a.plan.metric==='principal'?yi(a.totalCents):null;
  const limited=evidence?.missingAttributionRows>0 || evidence?.hasAttribution===false;
  const enhancedValue=b?.resultId && evidence?.kind==='enhancement' && b.plan?.metric==='principal' && !limited?yi(b.totalCents):null;
  if(issuerValue===null && enhancedValue===null)return null;
  const items=[{role:'自发债',principal:issuerValue},{role:'增信 ABS',principal:enhancedValue}];
  const describe=(item,raw)=>item.principal===null ? (raw?.clarification || item.role+'完整金额待核。') :
    item.principal===0 && raw?.rowCount===0 ? item.role+'按此口径未匹配持仓。' : item.role+'在账本金 '+shown(item.principal)+' 亿元。';
  const subject=issuerName || enhancerName || '';
  const union=parts.find(p=>p.role==='union')?.result;
  const note='自发债按发行人全称核对；增信 ABS 按资产支持证券的资产端损益还原客户名称认定授信占用。';
  // A union is only authoritative when computed from original holding-row IDs.
  const complete=issuerValue!==null && enhancedValue!==null;
  const answer=complete && union?.resultId && yi(union.totalCents)!==null && d.clarification ?
    d.clarification : [subject,describe(items[0],a),describe(items[1],b)].filter(Boolean).join(' ');
  return sample('自发债与增信 ABS',answer,[a?.snapshot?.date||b?.snapshot?.date,'余额台账',subject].filter(Boolean).join('　'),
    [field('role','主体角色')],[measure('principal','已核实在账本金','亿元')],items,
    {coverage:complete?'complete':'partial',note:limited ? '部分 ABS 持仓未填增信归属，完整金额待核。'+note : note});
}
function flowValue(r,key) {
  if(key==='rows' || key==='bonds') return Number.isSafeInteger(r[key]) && r[key]>=0 ? r[key] : null;
  if(key==='average') return finite(r.averageCents) ? r.averageCents / 1e10 : null;
  return yi(r[key+'Cents']);
}
function trade(d) {
  const {plan:p,result:r}=d;
  if(!p || !r?.totals || !Object.hasOwn(flowMetrics,p.metric))return null;
  const m=flowMetrics[p.metric];
  const partial=r.completeCoverage===false || (r.completeCoverage==null && /仅覆盖至|尚未导入|尚未覆盖|缺少.*台账/u.test(notes(r.warnings)));
  const dates=range(p.start,p.end), filter=list(p.filters).map(f=>f.field+' '+[].concat(f.value??'').join('、')).join('、');
  const source=[dates,'增减持流水',filter].filter(Boolean).join('　');
  if(partial && !(r.totals.rows>0))return scalar('交易流水覆盖','流水覆盖不足，所问期间的实际结果待核。',source,m,null,{note:notes(r.warnings)});
  const groupBy=list(p.groupBy), groups=list(r.groups),total=flowValue(r.totals,m.key);
  const cols = [...new Set([p.metric,...(p.direction==='both' ? ['buy','sell','net'] : [p.direction]),'rows'])].filter(k=>Object.hasOwn(flowMetrics,k));
  const measures=cols.map(k=>flowMetrics[k]);
  const dims=groupBy.map((k,i)=>field('d'+i,k,/^(?:交易日期|交易交割日|交易月份|交易年份|交易年度|台账年度)$/.test(k)?'date':'category'));
  const reduced=Number.isSafeInteger(r.groupCount)&&r.groupCount>groups.length;
  const note=[partial && '仅反映已覆盖的流水。', reduced && '本图列出 '+groups.length+' 组，查询范围共有 '+r.groupCount+' 组。', notes(r.warnings)].filter(Boolean).join(' ');
  const extra={coverage:partial?'partial':'complete',note};
  if(groupBy.length===1 && groupBy[0]==='交易月份')extra.cadence='monthly';
  const text=(partial?'已覆盖部分的':'')+entryText(m,total);
  if(!dims.length || !groups.length) return scalar(m.label,text,source,m,total,extra);
  const rows=[];
  for(const g of groups) {
    if(!Array.isArray(g.values) || g.values.length!==dims.length)return null;
    const row={};
    dims.forEach((dim,i)=>{row[dim.key]=g.values[i]===''||g.values[i]==null?'未填写':String(g.values[i]);});
    cols.forEach(key=>{row[key]=flowValue(g,key);});
    rows.push(row);
  }
  if(p.share && dims.length===1 && !partial && total>0 && m.additive && rows.every((row,i)=>finite(row[m.key]) && finite(groups[i].share) && Math.abs(row[m.key]/total-groups[i].share)<1e-8)) {
    extra.whole={measureKey:m.key,value:total,label:'查询范围内全部匹配交易的'+m.label};
  }
  if(p.limit && dims.length===1 && ['asc','desc'].includes(p.order))extra.orderedBy={key:m.key,direction:p.order};
  const scoped=rows.length<=3 || extra.orderedBy ? summaryRows(rows,dims,m) : '';
  const answer=[partial && '以下为已覆盖部分。',dates,scoped||text, reduced && '本次列出 '+rows.length+' 组，共 '+r.groupCount+' 组。'].filter(Boolean).join('　');
  return sample(dims.map(x=>x.label).join('和')+'的'+m.label, answer, source, dims, measures, rows, extra);
}

function portfolio(d) {
  const p=d.spec;
  if(!p || !d.headline)return null;
  const source=[range(p.start,p.end),p.branch,p.account,'组合指标'].filter(Boolean).join('　');
  const note=notes(d.notes);
  if(p.metric==='weeklyMean') {
    if(!Array.isArray(d.rows))return null;
    const rows=[];
    for(const values of d.rows) {
      if(!Array.isArray(values) || values.length<3)return null;
      const [week,day,value]=values;
      if(day==='缺台账' && value==='—'){
        const end=typeof week==='string' && week.match(/ 至 (\d{4}-\d{2}-\d{2})$/)?.[1];
        if(!end)return null;
        rows.push({date:end,principal:null});
      }else{
        // The public weekly contract stores rounded, formatted billions alongside
        // an unrounded mean. Never recompute the headline from plotted points.
        const number=typeof value==='number'?value:typeof value==='string' &&
          /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value) ? Number(value.replaceAll(',','')) : null;
        if(!finite(number)||typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
        rows.push({date:day,principal:number});
      }
    }
    return sample('周均规模',d.headline,source,[field('date','观察日期','date')],[principal],rows,
      {coverage:rows.some(r=>r.principal===null)?'partial':'complete',cadence:'weekly',
        ...(finite(d.mean)?{headline:{measureKey:'principal',value:d.mean}}:{}),note});
  }
  if(p.metric==='valuationAudit'){
    // A list of credit events or securities is itself the requested material.
    // Collapsing it to a scalar hides its purpose; use the existing ledger view.
    return null;
  }
  if(!['modifiedDuration','impliedRatingShare'].includes(p.metric) || !Array.isArray(d.values))return null;
  const m=p.metric==='modifiedDuration' ? measure('value','修正久期','年') :
    measure('value',(p.threshold || '')+'及以下持仓占比','%');
  const rows=d.values.map(v=>({date:v.date,value:finite(v.value)?v.value:null}));
  return sample(m.label,d.headline,source,[field('date','估值日','date')],[m],rows,
    {coverage:rows.some(r=>r.value===null)?'partial':'complete',note});
}
function comparison(c,steps) {
  if(!['balanceChange','reconcile'].includes(c.kind) || !Number.isSafeInteger(c.changeCents))return null;
  const dates=steps.slice(0,2).map(s=>s.data?.snapshot?.date);
  if(dates.length!==2 || !dates.every(Boolean) || !Number.isSafeInteger(c.openingCents)||!Number.isSafeInteger(c.closingCents))return null;
  const source=range(...dates)+' 余额台账'+(c.kind==='reconcile'?'与期间交易流水':'');
  const change=yi(c.changeCents), direction=change<0?'减少':change>0?'增加':'变动';
  const answer='期初余额 '+shown(yi(c.openingCents))+' 亿元，期末余额 '+shown(yi(c.closingCents))+' 亿元，'+direction+' '+shown(Math.abs(change))+' 亿元。';
  if(c.kind==='balanceChange')return sample('余额变动',answer,source,[field('date','台账日期','date')],[principal],
    [{date:dates[0],principal:yi(c.openingCents)},{date:dates[1],principal:yi(c.closingCents)}],{note:c.note});
  const net=yi(c.netCents),gap=yi(c.gapCents);
  const complete=net!==null && gap!==null;
  return sample('余额变动与净增持核对',answer+(complete?'期间净增持 '+shown(net)+' 亿元，余额变动减净增持为 '+shown(gap)+' 亿元。':c.note || '期间净增持尚待核实。'),
    source,[field('item','指标')],[measure('value','金额','亿元',{signed:true})],
    [{item:'余额变动',value:change},{item:'期间净增持',value:net},{item:'余额变动减净增持',value:gap}],
    {coverage:complete?'complete':'partial',note:c.note});
}
// Independent snapshots can form a time series only when the same scope is
// observable at multiple dates. Snapshot ranks and previous-answer row IDs do
// not define a stable membership across dates.
function inventoryPeriods(steps) {
  if(steps.length<2 || steps.some(s=>s.source!=='inventory' || !s.data?.plan || !s.data.resultId ||
    s.data.overview || s.data.plan.rank || s.data.roleEvidence || s.data.scopedToPrevious || s.appliedSelection ||
    s.data.groupsTruncated || s.data.groupCount>list(s.data.groups).length || s.data.measure))return null;
  const first=steps[0].data, met=inventoryMetric(first);
  const keys=d=>d.dimensions || (d.plan.group && d.plan.group!=='none'?[d.plan.group]:[]);
  const groups=keys(first);
  const criteria=d=>list(d.plan.analysis).filter(s=>s.op==='filter').map(s=>JSON.stringify([s.field,s.operator,s.value])).sort().join('|');
  if(!met || groups.length>1 || steps.some(({data})=>inventoryMetric(data)?.key!==met.key ||
    JSON.stringify(keys(data))!==JSON.stringify(groups) || criteria(data)!==criteria(first) ||
    list(data.plan.analysis).some(s=>!['group','filter','sort'].includes(s.op)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.snapshot?.date || '')))return null;
  const filters=steps.map(s=>s.data.plan.filters || {});
  const varying=[...new Set(filters.flatMap(Object.keys))].filter(k=>new Set(filters.map(f=>JSON.stringify(f[k]))).size>1);
  if(varying.length>1 || (varying.length && (groups.length || filters.some(f=>typeof f[varying[0]]!=='string'))))return null;
  const dates=new Map(), scopes=new Map(), series=new Map(), seen=new Set();
  for(const {data} of steps) {
    const date=data.snapshot.date, scopeKey=varying.length?data.plan.filters[varying[0]]:'';
    const cellKey=JSON.stringify([date,scopeKey]);
    if(seen.has(cellKey))return null;
    seen.add(cellKey);
    if(!scopes.has(scopeKey))scopes.set(scopeKey,new Set());
    scopes.get(scopeKey).add(date);
    if(!dates.has(date))dates.set(date,{date});
    const row=dates.get(date);
    function add(key,value){
      if(!series.has(key))series.set(key,'s'+series.size);
      const col=series.get(key);
      if(Object.hasOwn(row,col))return false;
      row[col]=value;
      return true;
    }
    if(!groups.length){
      if(!add(scopeKey,inventoryValue(data,met)))return null;
    }else{
      for(const group of list(data.groups)){
        const category=group.labels?.[0] ?? group.name;
        if(!add(category===null || category===''?'未填写':category,inventoryValue(data,met,group)))return null;
      }
    }
  }
  if(dates.size<2 || !series.size || series.size>12 || [...scopes.values()].some(s=>s.size<2))return null;
  const measures=[...series].map(([name,key])=>measure(key,[name,met.label].filter(Boolean).join(' '),met.unit));
  const rows=[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));
  let gaps=false;
  for(const row of rows)for(const m of measures)if(!finite(row[m.key])){row[m.key]=null;gaps=true;}
  const fmt=row=>row.date+' '+measures.slice(0,3).map(m=>entryText(m,row[m.key])).join('，');
  const text=fmt(rows[0])+'。'+fmt(rows.at(-1))+'。';
  const commonScope=Object.entries(first.plan.filters || {}).filter(([k])=>!varying.includes(k)).map(([k,v])=>label(k)+' '+v);
  const source=[range(rows[0].date,rows.at(-1).date),'余额台账',...commonScope].join('　');
  const note=[gaps && '空白表示本期结果未列示该项。',notes([...new Set(steps.flatMap(s=>list(s.data.warnings)))])].filter(Boolean).join(' ');
  return sample('多期'+met.label+'对照',text,source,[field('date','台账日期','date')],measures,rows,
    {coverage:gaps?'partial':'complete',note});
}
function alignment(a,steps) {
  if (!a.field || !a.rows?.length || !a.columns?.length) return null;
  const ms=a.columns.map((c,i)=>measure('v'+i,c.label,'亿元'));
  const rows=[];
  for (const item of a.rows) {
    if(!item.name || !Array.isArray(item.values) || item.values.length!==ms.length)return null;
    const row={name:item.name};
    ms.forEach((m,i)=>{row[m.key]=yi(item.values[i]);});
    rows.push(row);
  }
  const scopes=steps.map(s=>s.source==='inventory'?ledgerSource(s.data||{}):range(s.data?.plan?.start,s.data?.plan?.end)+' 交易流水');
  const partial=rows.some(row=>ms.some(m=>row[m.key]===null)) ||
    steps.some(s=>s.data?.result?.completeCoverage===false || s.data?.groupsTruncated || s.data?.result?.groupCount>list(s.data?.result?.groups).length);
  return sample('按'+a.field+'对照','已按'+a.field+'对照 '+rows.length+' 组。'+(a.note || ''),scopes.join('；'),
    [field('name',a.field)],ms,rows,{coverage:partial?'partial':'complete',note:a.note});
}
function arithmetic(a, preferred, steps) {
  const computed=list(a.rows);
  if(!computed.length || computed.some(r=>!r?.label || !r.unit || (r.value!==null && !finite(r.value))))return null;
  const missing=a.missing || (computed.some(r=>r.value===null)?'部分计算缺少有效值或分母为零。':'');
  const rowText=r=>{
    if(r.value===null)return r.label+' 无法计算';
    const short=['亿元','%','个百分点'].includes(r.unit) && Math.abs(r.value)>=0.01;
    const value=short?r.value.toLocaleString('zh-CN',{maximumFractionDigits:2}):shown(r.value);
    return [r.label,r.flowDirection].filter(Boolean).join(' · ')+' '+value+(r.unit==='%'?'':' ')+r.unit;
  };
  const derived=computed.filter(r=>r.op!=='value');
  // Preserve both the absolute change and relative change. Intermediate shares
  // may be shown as operands in a longer calculation containing both.
  const changes=derived.filter(r=>['difference','absoluteDifference','growth','contribution'].includes(r.op));
  const summary=computed.length<=4?computed:changes.length?changes:derived.length?derived:computed;
  const text=summary.map(rowText).join('，')+'。';
  const source=preferred?.source || [...new Set(steps.map(s=>{
    if(s.source==='inventory' && s.data?.snapshot)return ledgerSource(s.data);
    if(s.source==='portfolio')return range(s.data?.spec?.start,s.data?.spec?.end)+' 组合指标';
    if(s.source==='trade')return range(s.data?.plan?.start,s.data?.plan?.end)+' 交易流水';
    return null;
  }).filter(Boolean))].join('；')||'本次台账查询的计算结果';
  if(preferred && !missing) {
    const r=preferred.result;
    const known=new Map();
    const remember=(unit,n)=>{if(finite(n)){if(!known.has(unit))known.set(unit,new Set());known.get(unit).add(n);}};
    for(const m of r.measures){
      for(const row of r.rows)remember(m.unit,row[m.key]);
      if(r.whole?.measureKey===m.key && r.whole.value>0) {
        remember(m.unit,r.whole.value);
        for(const row of r.rows)if(finite(row[m.key]))remember('%',row[m.key]/r.whole.value*100);
      }
    }
    const p=steps[0]?.data;
    if(p?.spec?.metric==='weeklyMean'){remember('亿元',p.mean);remember('周',p.extremes?.weeks);}
    if(computed.every(row=>['value','share'].includes(row.op) && row.value!==null && [...(known.get(row.unit)||[])].some(n=>
      Math.abs(row.value-n)<=8*Number.EPSILON*Math.max(1,Math.abs(row.value),Math.abs(n))))) {
      // The primary text still states every requested calculation (e.g. weekly
      // mean) even when the highlighted chart row shows one weekly observation.
      if(p?.spec?.metric==='weeklyMean'){
        const meanAndWeeks=computed.every(row=>(row.unit==='亿元' && row.value===p.mean) ||
          (row.unit==='周' && row.value===p.extremes?.weeks));
        return {...preferred,answer:meanAndWeeks ? preferred.answer.split('。')[0]+'。' : text};
      }
      if(p?.resultId && r.whole && computed.some(x=>x.op==='share')) {
        const m=r.measures.find(m=>m.key===r.whole.measureKey);
        const ordered=r.rows.filter(row=>finite(row[m.key])).slice().sort((a,b)=>b[m.key]-a[m.key]);
        const top=ordered[0], dim=r.dimensions[0];
        if(top && dim)return {...preferred,answer:preferred.answer+'。其中'+top[dim.key]+'最多，为 '+shown(top[m.key])+
          ' '+m.unit+'，占 '+shown(100*top[m.key]/r.whole.value)+'%。'};
      }
      const intro=p?.overview?.length && (p.codeComparisons || p.codeUnion) ? preferred.answer+' ' : '';
      return {...preferred,answer:intro+text};
    }
  }
  const units=[...new Set(computed.map(r=>r.unit))];
  const answer=text+(missing?' '+missing:'');
  const extra={coverage:missing?'partial':'complete',note:missing};
  if(computed.length===1){
    const row=computed[0];
    const label=[row.label,row.flowDirection].filter(Boolean).join(' · ');
    return scalar(row.label,answer,source,measure('value',label,row.unit),row.value,extra);
  }
  if(units.length===1)return sample('计算结果',answer,source,[field('item','计算项')],
    [measure('value','计算结果',units[0])],computed.map(r=>({item:[r.label,r.flowDirection].filter(Boolean).join(' · '),value:r.value})),extra);
  // Show unlike units in a table. Never put percentages, counts and principal
  // on one axis, or sum operands whose original scopes may overlap.
  return sample('计算结果',answer,source,[field('item','计算项'),field('unit','单位')],
    [measure('value','数值','')],computed.map(r=>({item:[r.label,r.flowDirection].filter(Boolean).join(' · '),unit:r.unit,value:r.value})),extra);
}
function oneStep(step) {
  const d=step?.data;
  if(!d)return null;
  if(step.source==='inventory')return d.overview ? overview(d) : inventory(d);
  if(step.source==='portfolio')return portfolio(d);
  if(step.source==='trade')return trade(d);
  return null;
}

function weeklyPeriods(steps){
  if(steps.length<2||steps.some(s=>s.source!=='portfolio'||s.data?.spec?.metric!=='weeklyMean'))return null;
  const ordered=steps.map(s=>s.data).sort((a,b)=>a.spec.start.localeCompare(b.spec.start));
  const first=ordered[0].spec;
  if(ordered.some((d,i)=>d.spec.account!==first.account||d.spec.branch!==first.branch||
    (i>0&&d.spec.start<=ordered[i-1].spec.end)))return null;
  const models=ordered.map(portfolio);
  if(models.some(m=>!m))return null;
  const rows=models.flatMap(m=>m.result.rows);
  const absent=rows.filter(r=>r.principal===null).length;
  const observations=models.map((m,i)=>{
    const gaps=m.result.rows.filter(r=>r.principal===null).length;
    return range(ordered[i].spec.start,ordered[i].spec.end)+' 有效 '+(m.result.rows.length-gaps)+' 周，缺台账 '+gaps+' 周';
  });
  return sample('各期间周观察值',ordered.map(d=>d.headline).join(' '),models.map(m=>m.source).join('；'),
    [field('date','观察日期','date')],[principal],rows,{cadence:'weekly',coverage:absent?'partial':'complete',
      note:observations.join('；')+'。各周按该期间内最后一个可用业务日取值，缺周在图中留空，不进入均值。'});
}
function periodCalculations(candidate,calculated,arithmetic) {
  const result=candidate?.result;
  if(!result || result===calculated.result || result.dimensions.length!==1 ||
      result.dimensions[0].kind!=='date' || result.coverage==='missing')return null;
  const dateKey=result.dimensions[0].key;
  const comparable=result.measures.filter(m=>new Set(result.rows.filter(r=>finite(r[m.key])).map(r=>r[dateKey])).size>=2);
  if(!comparable.length)return null;
  // For multi-scope balances put the actual operands of a change first. Only
  // a unique match can change the default series; equal values are ambiguous.
  let primary;
  for(const r of arithmetic.rows) {
    if(!['difference','absoluteDifference','growth'].includes(r.op) || r.inputs?.length!==2)continue;
    const [a,b]=r.inputs;
    if(!finite(a.value)||!finite(b.value)||a.value===b.value||a.unit!==b.unit)continue;
    const matches=comparable.filter(m=>m.unit===a.unit && [a,b].every(input=>
      result.rows.some(row=>row[m.key]===input.value)));
    if(matches.length===1){primary=matches[0];break;}
  }
  const measures=primary?[primary,...result.measures.filter(m=>m!==primary)]:result.measures;
  return [
    {...candidate,answer:calculated.answer,result:{...result,measures}},
    {...calculated,shortTitle:'全部计算'},
  ];
}

function modelsFrom(input) {
  const a=input?.answer ?? input?.data ?? input;
  if(!a || typeof a!=='object')return [];
  if(!Array.isArray(a.steps)){
    const source=a.spec?'portfolio':a.result?.totals?'trade':a.resultId||a.overview||a.plan?.group?'inventory':null;
    const model=oneStep({source,data:a});
    return model?[model]:[];
  }
  const steps=a.steps;
  if(a.memberSets || list(a.methodNotes).length || steps.some(s=>!s?.data || uncertainRole(s.data) ||
    list(s.data.overview).some(p=>uncertainRole(p?.result))))return [];
  if(a.clarification) {
    if(!steps.length && /未覆盖|缺少.*台账|覆盖至|未导入|未齐|不覆盖/u.test(a.clarification)){
      return [scalar('数据覆盖',a.clarification,'本次台账查询',measure('value','查询结果',''),null,{note:a.clarification})];
    }
    return [];
  }
  const candidate=steps.length===1?oneStep(steps[0]):inventoryPeriods(steps)||weeklyPeriods(steps);
  if(a.arithmetic?.rows?.length){
    const answer=arithmetic(a.arithmetic,candidate,steps);
    if(!answer)return [];
    if(candidate?.result.whole && steps.length===1 && steps[0].data.measure?.fn==='principalShare' &&
      a.arithmetic.rows.every(r=>r.op==='share' || r.op==='value') && a.arithmetic.rows.some(r=>r.op==='share')){
      return [{...candidate,answer:answer.answer},{...answer,shortTitle:'全部计算'}];
    }
    const ranked=candidate?.result;
    if(ranked?.orderedBy && ranked.dimensions.length===1 && ranked.dimensions[0].kind==='category' && !a.arithmetic.missing){
      const key=ranked.orderedBy.key, unit=ranked.measures.find(m=>m.key===key)?.unit;
      const matches=input=>input?.unit===unit && finite(input.value) && ranked.rows.some(row=>
        finite(row[key]) && Math.abs(input.value-row[key])<=8*Number.EPSILON*Math.max(1,Math.abs(row[key])));
      const differences=a.arithmetic.rows.filter(r=>r.op!=='value');
      if(differences.length && differences.every(r=>['absoluteDifference','difference'].includes(r.op) &&
          list(r.inputs).length===2 && r.inputs.every(matches))){
        const changes=arithmetic({rows:differences},null,steps);
        if(changes)return [candidate,{...changes,shortTitle:'差额'}];
      }
    }
    // The same calculate operation may return several dated slices in a single
    // overview, or separate same-scope steps. Keep the conclusion with its chart.
    return periodCalculations(candidate,answer,a.arithmetic) || [answer];
  }
  if(a.arithmetic?.missing)return [];
  if(a.comparison || a.alignment){
    const cmp=a.comparison && comparison(a.comparison,steps);
    if(a.comparison && !cmp)return [];
    const aligned=a.alignment && alignment(a.alignment,steps);
    return [cmp,aligned].filter(Boolean);
  }
  // A sequence may have been produced solely to collect evidence for a list,
  // clarification or a further calculation. Do not promote an arbitrary step.
  return candidate?[candidate]:[];
}

// A question may specify display units independently of ledger units. A filter
// like “超过一万元” is not a unit instruction.
function outputMoneyUnit(question) {
  const explicit=String(question||'').match(/(?:单位\s*(?:为|是|用|改为|改成)?|换算(?:成|为)?|换成|改用|请用|以|用)\s*(?:人民币)?(亿元|万元|元)(?=报|为单位|列|填|给|显示|表示|计|呈现|出|写|做|的|[，。！？、,.!?\s]|$)/u);
  return explicit?.[1];
}
const currencyScale={'亿元':100000000,'万元':10000,'元':1};
function requestedUnitModel(model,unit) {
  const r=model.result, factors=new Map(), originals=new Map();
  const record=(original,value)=>{
    if(!finite(value))return;
    if(!originals.has(original))originals.set(original,new Set());
    originals.get(original).add(value);
  };
  const measures=r.measures.map(m=>{
    const match=/^(亿元|万元|元)(\/笔)?$/.exec(m.unit);
    if(!match || match[1]===unit)return m;
    factors.set(m.key,currencyScale[match[1]]/currencyScale[unit]);
    for(const row of r.rows)record(match[1],row[m.key]);
    for(const ref of [r.whole,r.headline])if(ref?.measureKey===m.key)record(match[1],ref.value);
    return {...m,unit:unit+(match[2]||'')};
  });
  // Mixed computations retain a unit column for each operand.
  const mixed=r.dimensions.some(d=>d.key==='unit') && r.measures.length===1 && r.measures[0].key==='value' &&
    !r.measures[0].unit && r.rows.some(row=>Object.hasOwn(currencyScale,row.unit) && row.unit!==unit);
  if(!factors.size && !mixed)return model;
  const rows=r.rows.map(row=>{
    const converted={...row};
    for(const [key,scale] of factors) if(finite(row[key]))converted[key]=row[key]*scale;
    if(mixed && Object.hasOwn(currencyScale,row.unit) && row.unit!==unit){
      record(row.unit,row.value);
      converted.unit=unit;
      if(finite(row.value))converted.value=row.value*currencyScale[row.unit]/currencyScale[unit];
    }
    return converted;
  });
  function scaleRef(ref) {
    return ref && factors.has(ref.measureKey)?{...ref,value:ref.value*factors.get(ref.measureKey)}:ref;
  }
  const result={...r,measures,rows};
  if(r.whole)result.whole=scaleRef(r.whole);
  if(r.headline)result.headline=scaleRef(r.headline);
  const answer=model.answer.replace(/([+\-−]?[\d,]+(?:\.\d+)?)\s*(亿元|万元|元)(?![年月])/g,(raw,num,original)=>{
    if(original===unit)return raw;
    const n=Number(num.replaceAll(',','').replace('−','-'));
    const resolution=10**(-(num.split('.')[1]||'').length);
    // A unique matching typed observation resolves rounding in prose without
    // selecting between amounts that share the same displayed value.
    const candidates=[...(originals.get(original)||[])].filter(x=>
      Math.abs(n-x)<=resolution/2+Number.EPSILON*Math.abs(n));
    const exact=candidates.length===1?candidates[0]:n;
    return shown(exact*currencyScale[original]/currencyScale[unit])+' '+unit;
  });
  return {...model,answer,result};
}

function reportModel(report) {
  if (!Array.isArray(report?.rows)||!Array.isArray(report.columns)||!report.columns.length)return null;
  const dims=[],measures=[],keys=new Set();
  for(const col of report.columns){
    if (!col || typeof col.key!=='string'||typeof col.label!=='string'||keys.has(col.key))return null;
    keys.add(col.key);
    if(col.kind==='number')measures.push(measure(col.key,col.label,col.unit||''));
    else if(['category','date'].includes(col.kind))dims.push(field(col.key,col.label,col.kind));
    else return null;
  }
  if(report.rows.some(row=>!row||typeof row!=='object'))return null;
  return {shortTitle:report.title||'核对结果',answer:report.summary||(report.rows.length?'':'当前范围没有匹配记录。'),
    source:report.source||'',result:{dimensions:dims,measures,rows:report.rows,columns:report.columns,
      coverage:'complete',note:report.note||'',defaultTable:true}};
}

function ratingCoverage(data, unit='亿元') {
  if(data?.spec?.metric!=='impliedRatingShare')return [];
  const countIndex=Object.fromEntries(['已覆盖','已剔除','待核'].map(label=>
    [label,list(data.columns).indexOf(label+'券数')]));
  return list(data.values).flatMap(v=>{
    const row=list(data.rows).find(r=>Array.isArray(r) && r[0]===v.date);
    const parts=[['有效评级','已覆盖',v.covered],['缺评级或信用事件资料待核','待核',v.unknown],
      ['已剔除','已剔除',v.excluded]].flatMap(([title,label,cents])=>{
      if(!Number.isSafeInteger(cents))return [];
      const count=row?.[countIndex[label]];
      return [title+' '+shown(cents/100/currencyScale[unit])+' '+unit+
        (Number.isSafeInteger(count)?'（'+count+' 只）':'')];
    });
    return parts.length?[[v.date,data.spec.account,data.spec.branch].filter(Boolean).join(' ')+'　'+parts.join('，')+'。']:[];
  });
}

/** Project saved results into chart inputs. [] keeps the existing full answer visible. */
export function answerViewModels(input) {
  const a=input?.answer ?? input?.data ?? input;
  const question=input?.question || input?.label || '';
  let models=modelsFrom(input);
  // A concentration calculation may use the subtotal of a ranked step as
  // one operand. That operand holds an amount, while its source retains the
  // members and their values. Keep the verified breakdown available.
  if(models.length && list(a.arithmetic?.rows).some(row=>row.op==='share')){
    for(const step of list(a.steps)){
      if(step.source!=='inventory' || !list(step.data?.plan?.analysis).some(op=>op.op==='take'))continue;
      const ranking=oneStep(step);
      if(ranking?.result.orderedBy && ranking.result.rows.length &&
        !models.some(m=>m.result===ranking.result || m.shortTitle===ranking.shortTitle && m.source===ranking.source)){
        models.push(ranking);
      }
    }
  }
  if(models.length && list(a.arithmetic?.rows).length){
    for(const s of list(a.steps).filter(s=>s.source==='trade'&&s.data?.plan?.groupBy?.length)){
      const grouped=trade(s.data);
      if(grouped?.result.rows.length>1 && !models.some(m=>m.source===grouped.source&&
        m.result.rows.length===grouped.result.rows.length&&m.result.dimensions[0]?.label===grouped.result.dimensions[0]?.label)){
        models.push(grouped);
      }
    }
  }
  const report=reportModel(a?.ledgerReport);
  if(report) models.unshift(report);
  if(!models.length)return models;
  const unit=outputMoneyUnit(question);
  if(unit) models=models.map(model=>requestedUnitModel(model,unit));
  const indicators=Array.isArray(a.steps)?a.steps.filter(s=>s.source==='portfolio').map(s=>s.data):[a];
  const coverage=[...new Set(indicators.flatMap(d=>ratingCoverage(d,unit)))];
  if(coverage.length)models[0]={...models[0],ratingCoverage:coverage};
  const calculations=list(a.arithmetic?.rows).filter(r=>['sum','share','divide','mean','average','weightedAverage'].includes(r.op) &&
    list(r.inputs).length && r.inputs.every(input=>input?.label && (input.value===null || finite(input.value))));
  if(calculations.length)models[0]={...models[0],calculations};
  const wantsTable=/(?:做成|列成|整理成|做一张|放在一张|给我一张|用)\s*(?:明细|汇总|对照|数据|可排序的)?表(?:格)?|(?:本金|金额|笔数|发行人|券码)(?:明细|汇总|排名)?表(?:格)?(?=[，。？！\s]|$)|打开分析台/u.test(question);
  if(wantsTable) models[0]={...models[0],result:{...models[0].result,defaultTable:true}};
  const datasets=Array.isArray(a.steps)?a.steps.filter(s=>s.source==='inventory').map(s=>s.data):[a];
  const warnings=new Set();
  const parts=datasets.flatMap(d=>d?.overview?list(d.overview).map(p=>p?.result):[d]);
  const dated=new Set(parts.map(p=>p?.snapshot?.date).filter(Boolean)).size>1;
  for(const part of parts){
    for(const w of list(part?.warnings)){
      const text=typeof w==='string'?w:w?.message;
      if(!text || !/实际兑付待核|无法确定完整担保余额|增信占用归属未明确|仅覆盖可识别部分/u.test(text))continue;
      // Keep a materially incomplete role or redemption visible even when the
      // user has not opened the detailed evidence. Qualify multi-date notes.
      const date=dated && part.snapshot?.date ? part.snapshot.date+'　' : '';
      warnings.add(date+text);
    }
  }
  if(warnings.size)models[0]={...models[0],cautions:[...warnings]};
  return models;
}
