import {accountLabel} from './inventory-account.mjs';
import {exportData,newInventoryAnswer} from './inventory-store.mjs';
import {InventoryError} from './inventory-workbook.mjs';

const groupFields={issuer:'发行人',branch:'联动分行',account:'会计科目',portfolio:'交易组合',code:'债券代码',sourceMarketType:'原表债券类型'};
const dateFields={legal:'法定到期日',expected:'ABS预计到期日',maturity:'台账到期日'};
const num=(key,label,unit)=>({key,label,unit,kind:'number'});
const cat=(key,label)=>({key,label,kind:'category'});
const yuan=cents=>cents/1e10;
const show=value=>value.toLocaleString('zh-CN',{maximumFractionDigits:8});
const safeText=(x,map)=>typeof x==='string'&&Object.hasOwn(map,x);
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().startsWith(s);
export function validateProfile(p,check){
  check(p&&typeof p==='object','请指定分组或日期核对方式。');
  if(p.type==='groups'){
    check(safeText(p.by,groupFields)&&['counts','concentration','threshold','breakdown','ranking','withinRanking'].includes(p.stat),'请选择已知的分组与统计口径。');
    if(['ranking','withinRanking'].includes(p.stat)){
      check(Number.isInteger(p.limit)&&p.limit>=1&&p.limit<=100,'请选择 1 至 100 的排名上限。');
      if(p.stat==='withinRanking')check(safeText(p.within,groupFields)&&p.by!==p.within,'请选择不同的组别和组内排名维度。');
      if(p.membersContain!=null)check(typeof p.membersContain==='string'&&p.membersContain.trim().length>0&&p.membersContain.length<=200,'请指定要匹配的名称片段。');
    }
    if(p.stat==='breakdown')check(safeText(p.within,groupFields)&&p.within!==p.by&&
      (p.limit==null||Number.isInteger(p.limit)&&p.limit>=1&&p.limit<=100),'请选择第二级分组和有效的一级排名数量。');
    if(p.stat==='concentration')check(safeText(p.within,groupFields)&&p.within!==p.by&&Number.isInteger(p.minMembers)&&p.minMembers>=1,'请指定子分组和有效成员数量。');
    if(p.stat==='threshold')check(Number.isFinite(p.thresholdYuan)&&p.thresholdYuan>=0&&Number.isSafeInteger(Math.round(p.thresholdYuan*100))&&['gt','gte'].includes(p.compare),'请指定明确的人民币本金门槛和是否含边界。');
  }else{
    check(p.type==='dates'&&safeText(p.field,dateFields)&&['inRange','differentYears'].includes(p.stat),'请选择台账日期字段及比较方式。');
    if(p.stat==='inRange'){
      check(iso(p.start)&&iso(p.end)&&p.start<=p.end,'请给出有效的起止日期。');
      check(p.rankIssuers==null||Number.isInteger(p.rankIssuers)&&p.rankIssuers>=1&&p.rankIssuers<=100,'发行人排名须为 1 至 100。');
    }
    else check(safeText(p.other,dateFields)&&p.other!==p.field,'请选择两个不同的到期日期字段。');
  }
  return p;
}
function fieldValue(r,f){
  if(f==='account')return accountLabel(r.account||'');
  return r[f==='sourceMarketType'?'marketType':f]||'';
}
function buckets(rows,field){
  const groups=new Map();
  for(const r of rows){
    const name=fieldValue(r,field);
    if(!groups.has(name))groups.set(name,{cents:0,records:[],codes:new Set()});
    const g=groups.get(name);g.cents+=r.cents;g.records.push(r);if(r.code)g.codes.add(r.code);
  }
  return groups;
}
function rankNames(groups,limit,contains) {
  const ordered=[...groups].filter(([name])=>name.trim()&&(!contains||name.includes(contains))).sort((a,b)=>
    b[1].cents-a[1].cents || a[0].localeCompare(b[0],'zh-CN'));
  let lastAmount,rank=0;
  const rows=[];
  for(const [i,[name,g]] of ordered.entries()){
    if(lastAmount!==g.cents)rank=i+1;
    if(rank>limit)break;
    rows.push({rank,name,principal:yuan(g.cents)});
    lastAmount=g.cents;
  }
  return rows;
}
function rankingReport(p,grouped) {
  const child=groupFields[p.within], parent=groupFields[p.by];
  const nested=p.stat==='withinRanking', entity=nested?child:parent;
  const columns=[...(nested?[cat('group',parent)]:[]),num('rank','名次',''),cat('name',entity),num('principal','在账本金','亿元')];
  let rows,summary,missing=0;
  if(nested){
    rows=[];
    const groups=[...grouped].sort(([a],[b])=>a&&b?a.localeCompare(b,'zh-CN'):a?-1:b?1:0);
    for(const [group,g] of groups){
      const members=buckets(g.records,p.within);
      missing+=members.get('')?.cents||0;
      for(const r of rankNames(members,p.limit,p.membersContain))rows.push({group:group||'未填写',...r});
    }
    summary='从本次筛选的全部持仓出发，在 '+groups.length+' 个'+parent+'分组内分别列出本金前 '+p.limit+' 名具名'+entity+'。';
    if(grouped.has(''))summary+='未填写'+parent+'单列为一组。';
  }else{
    rows=rankNames(grouped,p.limit,p.membersContain);
    missing=grouped.get('')?.cents||0;
    summary=rows.length?'具名'+entity+'本金前 '+p.limit+' 名中，第一名为'+rows.filter(r=>r.rank===1)
      .map(r=>r.name).join('、')+'，本金 '+show(rows[0].principal)+' 亿元。':'当前范围没有具名'+entity+'。';
  }
  const note='先按原表持仓行汇总人民币名义本金，再按金额降序排列；并列使用同一名次，保留边界并列项。'+
    (p.membersContain?'仅纳入'+entity+'名称包含“'+p.membersContain+'”的具名成员。':'未填写'+entity+'本金 '+show(yuan(missing))+' 亿元，单列在排名之外。');
  return {title:nested?'各'+parent+'的'+entity+'排名':'具名'+entity+'本金排名',summary,note,columns,rows};
}
function groupReport(p,records){
  const grouped=buckets(records,p.by), title=groupFields[p.by];
  if(['ranking','withinRanking'].includes(p.stat))return rankingReport(p,grouped);
  let rows=[],columns=[cat('name',title)],summary,note='';
  if(p.stat==='counts'){
    columns.push(num('principal','在账本金','亿元'),num('count','持仓行数','条'),num('codes','不同券数','只'),num('extra','行数减不同券数','条'));
    for(const [name,g] of grouped)rows.push({name:name||'未填写',principal:yuan(g.cents),count:g.records.length,codes:g.codes.size,extra:g.records.length-g.codes.size});
    rows.sort((a,b)=>b.extra-a.extra||a.name.localeCompare(b.name,'zh-CN'));
    const max=rows[0]?.extra;
    summary=rows.length?'行数减去不同券数的最大差额为 '+max+' 条，对应'+rows.filter(x=>x.extra===max).map(x=>x.name).join('、')+'。':'本范围无持仓行。';
    note='同券多条持仓分别计行，券数按有效券码去重。缺少券码的行有 '+records.filter(r=>!r.code).length+' 条。';
  }else if(p.stat==='breakdown'){
    const childLabel=groupFields[p.within],ordered=[...grouped].filter(([name])=>!p.limit||name).sort((a,b)=>b[1].cents-a[1].cents||a[0].localeCompare(b[0],'zh-CN'));
    const parents=p.limit?ordered.slice(0,p.limit):ordered,descriptions=[];
    columns=[cat('name',title),cat('child',childLabel),num('principal','在账本金','亿元'),num('count','持仓行数','条'),num('codes','不同券数','只')];
    for(const [name,g] of parents){
      const children=buckets(g.records,p.within);
      const sorted=[...children].sort((a,b)=>b[1].cents-a[1].cents||a[0].localeCompare(b[0],'zh-CN'));
      for(const [child,item] of sorted)rows.push({name:name||'未填写',child:child||'未填写',principal:yuan(item.cents),count:item.records.length,codes:item.codes.size});
      const top=sorted.find(([child])=>child);
      if(parents.length<=15)descriptions.push((name||'未填写')+'：'+(top?'首位 '+sorted.filter(([child,x])=>child&&x.cents===top[1].cents).map(([child])=>child).join('、')+'各 '+show(yuan(top[1].cents))+' 亿元，':'')+'未填写'+childLabel+' '+show(yuan(children.get('')?.cents||0))+' 亿元');
    }
    summary='按本金'+(p.limit?'选取前 '+p.limit+' 个具名'+title:'汇总 '+parents.length+' 个'+title+'分组')+'，再按'+childLabel+'拆分。'+descriptions.join('；');
    note='同一持仓行按原表归入一个分组。未填写的次级字段保留。';
  }else if(p.stat==='threshold'){
    const boundary=Math.round(p.thresholdYuan*100);
    columns.push(num('principal','在账本金','亿元'),num('count','持仓行数','条'),num('codes','不同券数','只'));
    let total=0;
    for(const [name,g] of grouped){
      if(!name||(p.compare==='gt'?g.cents<=boundary:g.cents<boundary))continue;
      total+=g.cents;rows.push({name,principal:yuan(g.cents),count:g.records.length,codes:g.codes.size});
    }
    rows.sort((a,b)=>b.principal-a.principal||a.name.localeCompare(b.name,'zh-CN'));
    summary='按'+title+'合并本金后，'+(p.compare==='gt'?'超过':'达到或超过')+show(p.thresholdYuan)+'元的具名'+title+'有 '+rows.length+' 个，合计 '+show(yuan(total))+' 亿元。';
  }else{
    const child=groupFields[p.within];
    columns.push(cat('leader','首位'+child),num('members','不同'+child+'数','个'),num('part','首位本金','亿元'),num('total','组内总本金','亿元'),num('share','首位占比','%'));
    for(const [name,g] of grouped){
      if(!name)continue;
      const subs=[...buckets(g.records,p.within)].filter(([key])=>key);
      if(subs.length<p.minMembers||g.cents<=0)continue;
      const top=Math.max(...subs.map(([,v])=>v.cents));
      const leaders=subs.filter(([,v])=>v.cents===top).map(([key])=>key).sort();
      rows.push({name,leader:leaders.join('、'),members:subs.length,part:yuan(top),total:yuan(g.cents),share:100*top/g.cents});
    }
    rows.sort((a,b)=>b.share-a.share||a.name.localeCompare(b.name,'zh-CN'));
    summary=rows.length?'首位'+child+'占比最高的是'+rows.filter(x=>x.share===rows[0].share).map(x=>x.name).join('、')+'，占 '+show(rows[0].share)+'%。':'无满足条件的分组。';
    note='仅比较至少有 '+p.minMembers+' 个具名'+child+'的具名'+title+'。各组分母包含该组未填写'+child+'的金额。首位并列时展示所有并列名称。';
  }
  return {title:'按'+title+'核对持仓',summary,note,columns,rows};
}
function dateReport(p,records){
  const byCode=new Map(),missingCodes=new Set(),matchedIssuers=new Map();
  let unknown=0,unknownCents=0,matched=0,total=0;
  const otherField=p.stat==='differentYears'?p.other:p.field==='expected'?'legal':null;
  for(const r of records){
    const a=r[p.field],b=otherField?r[otherField]:null;
    if(!a||(p.stat==='differentYears'&&!b)){unknown++;unknownCents+=r.cents;if(r.code)missingCodes.add(r.code);continue;}
    if(p.stat==='differentYears'?a.slice(0,4)===b.slice(0,4):a<p.start||a>p.end)continue;
    matched++;total+=r.cents;
    if(r.issuer)matchedIssuers.set(r.issuer,(matchedIssuers.get(r.issuer)||0)+r.cents);
    const k=JSON.stringify([r.code,a,b]);
    const g=byCode.get(k)||{code:r.code,name:r.name,date:a,...(b?{other:b}:{}),cents:0};
    g.cents+=r.cents;byCode.set(k,g);
  }
  const rows=[...byCode.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code)).map(({cents,...g})=>({...g,principal:yuan(cents)}));
  const columns=[cat('code','债券代码'),cat('name','债券简称'),{key:'date',label:dateFields[p.field],kind:'date'}];
  if(otherField)columns.push({key:'other',label:dateFields[otherField],kind:'date'});
  columns.push(num('principal','在账本金','亿元'));
  const matchedCodes=new Set(rows.map(r=>r.code)).size;
  const scope=p.stat==='differentYears'?dateFields[p.field]+'与'+dateFields[p.other]+'跨年':dateFields[p.field]+'在 '+p.start+' 至 '+p.end;
  const note='缺少所查日期的持仓 '+unknown+' 条、'+missingCodes.size+' 只，本金 '+show(yuan(unknownCents))+' 亿元，单列待核。';
  if(p.rankIssuers){
    const all=buckets(records,'issuer');
    const ranked=[...matchedIssuers].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN')).slice(0,p.rankIssuers);
    return {title:'到期本金的发行人排名',summary:scope+'的具名发行人共 '+matchedIssuers.size+' 家，实际可列 '+ranked.length+' 家。',note,
      columns:[cat('issuer','发行人'),num('due','到期本金','亿元'),num('total','全部在账本金','亿元'),num('share','占本发行人本金','%')],
      rows:ranked.map(([issuer,cents])=>({issuer,due:yuan(cents),total:yuan(all.get(issuer).cents),share:all.get(issuer).cents>0?100*cents/all.get(issuer).cents:null}))};
  }
  return {title:'到期日期核对',summary:scope+'的已填记录有 '+matched+' 条、'+matchedCodes+' 只，合计 '+show(yuan(total))+' 亿元。'+(rows.length?'最早日期为 '+rows[0].date+'。':'没有已核实的匹配券。'),
    note,columns,rows};
}
export function buildProfile(p,records,snapshot){
  const report=p.type==='dates'?dateReport(p,records):groupReport(p,records);
  return {...report,source:snapshot.date+' 余额台账 · '+snapshot.filename};
}
export async function inventoryProfile({db,bucket},step,ctx){
  const snapshot=ctx.snapshots.find(s=>s.date===step.snapshotDate);
  if(!snapshot)throw new InventoryError('所选业务日缺少余额台账。',422);
  const data=await newInventoryAnswer(db,snapshot,{date:snapshot.date,metric:'principal',group:'none',filters:step.filters},bucket);
  if(!data.resultId)return data;
  const {rows}=await exportData(db,data.resultId);
  const full=buildProfile(step.profile,rows,snapshot);
  const cap=150;
  const ledgerReport=full.rows.length>cap?{...full,rows:full.rows.slice(0,cap),note:full.note+' 页面列出前 '+cap+' 项，共 '+full.rows.length+' 项，完整结果可下载。'}:full;
  const rankedMembers=step.profile.stat==='ranking'?{field:step.profile.by,names:full.rows.map(r=>r.name)}:null;
  return {...data,profileSpec:step.profile,ledgerReport,...(rankedMembers?{rankedMembers}:{})};
}

